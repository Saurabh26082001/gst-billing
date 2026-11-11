// Forwards a signed-in business's request to its own billing server.
// The billing server only answers requests that look local (Host localhost,
// no foreign Origin), so the gateway presents them that way after doing its
// own origin check. Cookies never reach it: the session is the gateway's.
import http from 'http';
import { config } from './config.js';

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// The app's page gets the account bar (login state, trial, billing, logout),
// the shop's name, and a Content-Security-Policy that names the public
// address where the original named http://localhost (needed for PDF styling).
function rewriteHtml(html) {
  return html
    .replace(/http:\/\/localhost:\* http:\/\/127\.0\.0\.1:\*/g, config.publicOrigin)
    .replace(/connect-src\s+'self' http:\/\/localhost:\*/, "connect-src 'self'")
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(config.brandName)}</title>`)
    .replace('</head>', '<link rel="stylesheet" href="/__saas/static/account.css" />\n<script src="/__saas/static/account.js" defer></script>\n</head>');
}

export function proxyToTenant(req, res, port) {
  const headers = { ...req.headers };
  delete headers.cookie;
  delete headers.origin;
  delete headers.referer;
  headers.host = `127.0.0.1:${port}`;
  headers['accept-encoding'] = 'identity'; // the page is rewritten, so no gzip from upstream

  const upstream = http.request({ host: '127.0.0.1', port, method: req.method, path: req.url, headers }, (up) => {
    const type = String(up.headers['content-type'] || '');
    if (!type.includes('text/html')) {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
      return;
    }
    const chunks = [];
    up.on('data', (c) => chunks.push(c));
    up.on('end', () => {
      const body = Buffer.from(rewriteHtml(Buffer.concat(chunks).toString('utf8')));
      const out = { ...up.headers, 'content-length': body.length, 'cache-control': 'no-store' };
      delete out.etag;
      delete out['last-modified'];
      res.writeHead(up.statusCode, out);
      res.end(body);
    });
  });
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Your billing workspace is restarting. Try again in a moment.' }));
  });
  req.pipe(upstream);
}
