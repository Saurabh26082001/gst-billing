// v1.10.83 - Problem log and "Report this problem". Pure functions only (no
// window, no storage, no imports) so the server can use the same redaction
// for data/errors.log and scripts/errors-test.mjs can test all of it in Node.
//
// Why redact twice (here AND on the server): an error message can quote
// whatever was on screen - a client's GSTIN, a phone number typed into a
// field. A report goes to a public GitHub issue, so nothing that identifies a
// business or a person may survive into it.

export const ISSUE_NEW_URL = 'https://github.com/IamRamgarhia/Free-GST-Billing-Software/issues/new';
export const TROUBLESHOOTING_URL = 'https://dicecodes.com/free-gst-software-documentation/troubleshooting.html';
export const MAX_ISSUE_URL = 7500;
export const MAX_LOG_ENTRIES = 50;

// Order matters: emails before UPI ids (both have @), GSTIN before PAN (a
// GSTIN contains a PAN), and long digit runs last so the specific labels win.
const REDACTIONS = [
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]'],
  // Not "fn@http://..." - that is how Firefox and Safari write a stack frame.
  [/\b[A-Z0-9._-]{2,}@[A-Z]{2,}\b(?!:)/gi, '[upi-id]'],
  [/\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/gi, '[gstin]'],
  [/\b[A-Z]{5}\d{4}[A-Z]\b/gi, '[pan]'],
  [/\b[A-Z]{4}0[A-Z0-9]{6}\b/gi, '[ifsc]'],
  [/(?:\+91[\s-]?|\b0)?\b[6-9]\d{4}[\s-]?\d{5}\b/g, '[phone]'],
  // ...except a column in a stack frame (index-x.js:9:158939), which only
  // says where in the app's own code it broke.
  [/(?<!\.m?jsx?:\d{1,7}:)\d{6,}/g, '[number]'],
  // A user name in a file path (C:\Users\Ramesh\..., /home/ramesh/...).
  [/([\\/](?:Users|home)[\\/])[^\\/\s]+/gi, '$1[user]'],
];

export function redact(text) {
  let s = String(text ?? '');
  for (const [re, to] of REDACTIONS) s = s.replace(re, to);
  return s;
}

// First few lines of a stack are where it broke; the rest is React internals
// that only make the report URL too long.
export function shortStack(stack, lines = 8) {
  return String(stack || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, lines).join('\n');
}

export function summarizeUA(ua = '') {
  const os = /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iPhone/iPad'
      : /Windows NT/.test(ua) ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua) ? 'Mac'
          : /CrOS/.test(ua) ? 'ChromeOS'
            : /Linux|X11/.test(ua) ? 'Linux' : 'Unknown OS';
  // Edge and Opera also say "Chrome/", and Chrome says "Safari/": most specific first.
  const m = [/(Edg)\/(\d+)/, /(OPR)\/(\d+)/, /(Firefox)\/(\d+)/, /(Chrome)\/(\d+)/, /(Version)\/(\d+)/]
    .map((re) => re.exec(ua)).find(Boolean);
  const name = !m ? 'Unknown browser'
    : m[1] === 'Edg' ? 'Edge' : m[1] === 'OPR' ? 'Opera' : m[1] === 'Version' ? 'Safari' : m[1];
  return `${name}${m ? ` ${m[2]}` : ''} on ${os}`;
}

// The bug form's "Computer" dropdown. Windows 10 and 11 send the same user
// agent, so Windows is left for the user to pick rather than guessed wrong.
export function systemOption(ua = '') {
  if (/Android|iPhone|iPad|iPod|Mobile/.test(ua)) return 'Phone or tablet (browser)';
  if (/Mac OS X|Macintosh/.test(ua)) return 'Mac';
  if (/Linux|X11|CrOS/.test(ua)) return 'Linux';
  return '';
}

export const isChunkLoadError = (msg) =>
  /dynamically imported module|Loading chunk|Failed to fetch dynamically|Importing a module script failed/i.test(String(msg || ''));

// Known problems -> a section of the Troubleshooting page. docs-site/build.mjs
// fails the docs build if any `id` here is not a section on that page.
// First match wins, so the chunk-load case sits above "Failed to fetch".
export const KNOWN_PROBLEMS = [
  { id: 'app-out-of-date', test: /dynamically imported module|Loading chunk|Importing a module script failed/i,
    fix: 'The browser kept an old copy of the app after an update. Press Ctrl+F5 to reload it.' },
  { id: 'cannot-connect', test: /failed to fetch|networkerror|load failed|network request failed|ECONNREFUSED|ERR_CONNECTION_REFUSED|app not running/i,
    fix: "The app's engine is not running. Click the Free GST Billing icon on your Desktop." },
  { id: 'payload-too-large', test: /request body too large|payload too large|entity too large|-> 413\b|status 413/i,
    fix: 'What you saved is too big, usually a large logo or signature image. Use a smaller image.' },
  { id: 'disk-full', test: /ENOSPC|no space left|disk is full/i,
    fix: 'The disk is full. Free some space (empty the Recycle Bin), then try again.' },
  { id: 'no-permission', test: /EACCES|EPERM|permission denied|operation not permitted|not allowed to write/i,
    fix: 'The app is not allowed to write to its folder. Move the app folder to Documents, or allow it in your antivirus.' },
  { id: 'damaged-file', test: /damaged file/i,
    fix: 'One saved file is damaged and was skipped. Restore it from a backup.' },
  { id: 'port-in-use', test: /EADDRINUSE|address already in use|port \d+ is busy/i,
    fix: 'Another program uses the app\'s port. The app picks a free one; open the app again from its icon.' },
  { id: 'old-node', test: /node\.js[^\n]*too old|unsupported engine|npm ERR!|ERR_REQUIRE_ESM|requires node/i,
    fix: 'This computer has an old Node.js. Open App again, or install Node.js LTS from nodejs.org.' },
  { id: 'pin-forgotten', test: /wrong pin|incorrect pin|forgot[^\n]*pin|too many[^\n]*attempts/i,
    fix: 'PIN lock problem. The guide explains how to reset a forgotten PIN.' },
];

export function matchKnownProblem(text) {
  const s = String(text || '');
  const hit = KNOWN_PROBLEMS.find((k) => k.test.test(s));
  return hit ? { id: hit.id, fix: hit.fix, url: `${TROUBLESHOOTING_URL}#${hit.id}` } : null;
}

// A logged entry's status counts too: a 413 says "too large" even when the
// server's wording changes.
export const knownProblemFor = (e) =>
  (e ? matchKnownProblem(`${e.message || ''}${e.api ? ` -> ${e.api.status}` : ''}`) : null);

const clean = (v, n) => redact(v).slice(0, n);

// One log entry, redacted at the moment it is made, so nothing private is
// ever stored, shown or sent. `api` is method + path + status, never a body.
export function makeEntry({ kind = 'error', message = '', stack = '', view = '', version = 'unknown', ua = '', api = null, time } = {}) {
  const entry = {
    time: time || new Date().toISOString(),
    version: clean(version, 20),
    view: clean(view, 30),
    kind: clean(kind, 20),
    message: clean(message, 500) || '(no message)',
    stack: clean(shortStack(stack), 1500),
    browser: summarizeUA(ua),
    system: systemOption(ua),
  };
  if (api) {
    // Query strings can carry names or numbers: path only.
    const path = String(api.path || '').split('?')[0];
    entry.api = { method: clean(api.method || 'GET', 10).toUpperCase(), path: clean(path, 120), status: Number(api.status) || 0 };
  }
  return entry;
}

// Ring buffer: newest last, at most `max`. Returns a new array.
export const pushEntry = (list, entry, max = MAX_LOG_ENTRIES) =>
  [...(Array.isArray(list) ? list : []), entry].slice(-max);

export function formatDetails(e, { stackLines = 8 } = {}) {
  const lines = [
    `App version: ${e.version || 'unknown'}`,
    `Screen: ${e.view || 'unknown'}`,
    `Time: ${e.time || ''}`,
    `Browser: ${e.browser || ''}`,
    `Kind: ${e.kind || 'error'}`,
  ];
  if (e.api) lines.push(`Request: ${e.api.method} ${e.api.path} -> ${e.api.status || 'no answer'}`);
  lines.push(`Message: ${e.message}`);
  const st = shortStack(e.stack, stackLines);
  if (st) lines.push('Stack:', st);
  return lines.join('\n');
}

const issueBody = (details) =>
  `\`\`\`\n${details}\n\`\`\`\n\nSteps: (please add what you did before this)\n`;

export const reportText = (e) => issueBody(formatDetails(e));

// GitHub issue-form prefill: each query param fills the field with that id in
// .github/ISSUE_TEMPLATE/bug_report.yml. Long URLs are refused by browsers and
// GitHub, so the stack is trimmed until the URL fits.
export function buildIssueUrl(e, maxLen = MAX_ISSUE_URL) {
  const title = `[Problem] ${String(e.message || 'Something went wrong').replace(/\s+/g, ' ').slice(0, 80)}`;
  const make = (what) => {
    const p = [['template', 'bug_report.yml'], ['title', title], ['version', e.version || '']];
    if (e.system) p.push(['system', e.system]);
    p.push(['what', what]);
    return `${ISSUE_NEW_URL}?${p.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
  };
  for (let n = 8; n >= 0; n -= 1) {
    const url = make(issueBody(formatDetails(e, { stackLines: n })));
    if (url.length <= maxLen) return url;
  }
  // Still too long without a stack: a huge message. Halve it until it fits.
  const msg = String(e.message || '');
  for (let len = Math.min(msg.length, 1000); len > 0; len = Math.floor(len / 2)) {
    const url = make(issueBody(formatDetails({ ...e, message: `${msg.slice(0, len)}...` }, { stackLines: 0 })));
    if (url.length <= maxLen) return url;
  }
  return make('Steps: (please add what you did before this)\n');
}
