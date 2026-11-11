// The hosted front door for the GST billing app.
//
//   browser ──https──> reverse proxy (TLS) ──> gateway (this file)
//                                                 ├─ /login /signup /billing, /__saas/*  accounts + payments
//                                                 └─ everything else ──> that business's own billing server
//
// The billing app in ../_system is used unchanged: it still thinks it is a
// single-business app on localhost. This gateway adds who-is-signed-in, the
// free month, the ₹99/month subscription, and keeps businesses apart.
import fs from 'fs';
import http from 'http';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { config, paymentsConfigured } from './lib/config.js';
import { users, payments, firstTimeEvent } from './lib/db.js';
import { hashPassword, verifyPassword, burnPasswordCheck, startSession, endSession, currentUser, accessFor, tooManyAttempts } from './lib/auth.js';
import * as razorpay from './lib/razorpay.js';
import { portFor, stopAll } from './lib/tenants.js';
import { proxyToTenant } from './lib/proxy.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const DAY = 24 * 60 * 60 * 1000;
const billingVersion = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(config.billingAppDir, 'package.json'), 'utf8')).version; } catch { return 'unknown'; }
})();

if (!fs.existsSync(path.join(config.billingAppDir, 'server.js'))) {
  console.error(`  The billing app was not found at ${config.billingAppDir} (set BILLING_APP_DIR).`);
  process.exit(1);
}
if (!fs.existsSync(path.join(config.billingAppDir, 'dist', 'index.html'))) {
  console.error(`  The billing app has no built pages in ${config.billingAppDir}/dist.`);
  process.exit(1);
}

// ---------- small helpers ----------

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};
const redirect = (res, to) => { res.writeHead(302, { location: to, 'cache-control': 'no-store' }); res.end(); };

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) {
  try { return JSON.parse((await readBody(req)).toString('utf8') || '{}'); } catch (e) {
    if (e.status) throw e;
    throw Object.assign(new Error('bad json'), { status: 400 });
  }
}

const clientIp = (req) =>
  (config.trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';

// State-changing requests must come from our own pages. The session cookie is
// SameSite=Lax already; this also covers browsers that ignore that.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (origin) return origin === config.publicOrigin;
  return req.headers['sec-fetch-site'] !== 'cross-site';
}

const wantsPage = (req) => req.method === 'GET' && String(req.headers.accept || '').includes('text/html');

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  if (config.secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}

const STATIC = {
  'app.css': 'text/css', 'auth.js': 'text/javascript', 'billing.js': 'text/javascript',
  'account.js': 'text/javascript', 'account.css': 'text/css',
};
function serveFile(res, file, type) {
  fs.readFile(path.join(PUBLIC_DIR, file), (err, buf) => {
    if (err) return json(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-cache' });
    res.end(buf);
  });
}

const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self' https://checkout.razorpay.com",
  "frame-src https://api.razorpay.com https://checkout.razorpay.com",
  "connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com",
  "img-src 'self' data: https:",
  "style-src 'self' 'unsafe-inline'",
  "form-action 'self'",
  "base-uri 'none'",
].join('; ');
function servePage(res, file) {
  fs.readFile(path.join(PUBLIC_DIR, file), 'utf8', (err, html) => {
    if (err) return json(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': PAGE_CSP });
    res.end(html.replaceAll('{{BRAND}}', config.brandName.replace(/[<>&"]/g, '')));
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v, max) => String(v ?? '').trim().slice(0, max);

function accountView(user) {
  return {
    email: user.email,
    name: user.name,
    business: user.business,
    brand: config.brandName,
    supportEmail: config.supportEmail,
    pricePaise: config.pricePaise,
    trialDays: config.trialDays,
    paymentsReady: paymentsConfigured(),
    ...accessFor(user),
  };
}

// ---------- account routes ----------

async function signup(req, res) {
  if (tooManyAttempts(`signup:${clientIp(req)}`, 5, 60 * 60 * 1000)) return json(res, 429, { error: 'Too many sign-ups from here. Try again later.' });
  const b = await readJson(req);
  const email = clean(b.email, 200).toLowerCase();
  const password = String(b.password ?? '');
  const name = clean(b.name, 100);
  const business = clean(b.business, 150);
  const phone = clean(b.phone, 20).replace(/[^\d+]/g, '');
  if (!EMAIL_RE.test(email)) return json(res, 400, { error: 'Enter a valid email address.' });
  if (password.length < 8 || password.length > 200) return json(res, 400, { error: 'Use a password of at least 8 characters.' });
  if (!name) return json(res, 400, { error: 'Enter your name.' });
  if (users.byEmail(email)) return json(res, 409, { error: 'An account with this email already exists. Log in instead.' });

  const now = Date.now();
  const id = crypto.randomUUID();
  users.create({ id, email, name, business, phone, passwordHash: await hashPassword(password), createdAt: now, trialEndsAt: now + config.trialDays * DAY });
  startSession(res, id);
  json(res, 201, { ok: true });
}

async function login(req, res) {
  const b = await readJson(req);
  const email = clean(b.email, 200).toLowerCase();
  const password = String(b.password ?? '');
  if (tooManyAttempts(`login:${clientIp(req)}`, 30) || tooManyAttempts(`login:${email}`, 10)) {
    return json(res, 429, { error: 'Too many attempts. Wait 15 minutes and try again.' });
  }
  const user = users.byEmail(email);
  const ok = user ? await verifyPassword(password, user.password_hash) : await burnPasswordCheck(password);
  if (!user || !ok) return json(res, 401, { error: 'Wrong email or password.' });
  startSession(res, user.id);
  json(res, 200, { ok: true });
}

// ---------- payment routes ----------

async function subscribe(req, res, user) {
  if (!paymentsConfigured()) return json(res, 503, { error: 'Payments are not set up yet. Please contact support.' });
  if (user.sub_id && ['active', 'authenticated'].includes(user.sub_status)) {
    return json(res, 409, { error: 'You already have an active subscription.' });
  }
  // First charge: after the free month (or after a period already paid for),
  // never earlier. Razorpay needs start_at a little in the future.
  const firstCharge = Math.max(user.trial_ends_at, user.paid_until || 0);
  const startAt = firstCharge > Date.now() + 15 * 60 * 1000 ? Math.floor(firstCharge / 1000) : undefined;
  const sub = await razorpay.createSubscription({ userId: user.id, email: user.email, startAt });
  users.setSubscription(user.id, sub.id, sub.status);
  json(res, 200, {
    keyId: config.razorpay.keyId,
    subscriptionId: sub.id,
    brand: config.brandName,
    name: user.name,
    email: user.email,
    phone: user.phone,
    startsLater: Boolean(startAt),
  });
}

// Applies Razorpay's view of a subscription to the account it belongs to.
function applySubscription(user, sub) {
  if (sub.id === user.sub_id) users.setSubscriptionStatus(user.id, sub.status);
  if (sub.status === 'active' && sub.current_end) users.extendPaidUntil(user.id, sub.current_end * 1000);
}

async function verifyPayment(req, res, user) {
  const b = await readJson(req);
  const paymentId = clean(b.razorpay_payment_id, 100);
  const subscriptionId = clean(b.razorpay_subscription_id, 100);
  const signature = clean(b.razorpay_signature, 200);
  if (subscriptionId !== user.sub_id || !razorpay.verifyCheckout({ paymentId, subscriptionId, signature })) {
    return json(res, 400, { error: 'This payment could not be verified. If money was taken, contact support with the payment id.' });
  }
  payments.record(paymentId, user.id, subscriptionId, null);
  applySubscription(user, await razorpay.fetchSubscription(subscriptionId));
  json(res, 200, accountView(users.byId(user.id)));
}

async function cancel(req, res, user) {
  if (!user.sub_id || !['active', 'authenticated', 'pending'].includes(user.sub_status)) {
    return json(res, 400, { error: 'There is no subscription to cancel.' });
  }
  const sub = await razorpay.cancelSubscription(user.sub_id, user.sub_status === 'active');
  users.setSubscriptionStatus(user.id, sub.status);
  json(res, 200, accountView(users.byId(user.id)));
}

async function webhook(req, res) {
  const raw = await readBody(req, 1024 * 1024);
  if (!razorpay.verifyWebhook(raw, req.headers['x-razorpay-signature'])) return json(res, 400, { error: 'bad signature' });
  const eventId = String(req.headers['x-razorpay-event-id'] || '');
  if (eventId && !firstTimeEvent(eventId)) return json(res, 200, { ok: true, duplicate: true });

  const event = JSON.parse(raw.toString('utf8'));
  const sub = event.payload?.subscription?.entity;
  if (sub) {
    const user = (sub.notes?.user_id && users.byId(sub.notes.user_id)) || users.bySubscription(sub.id);
    if (user) {
      applySubscription(user, sub);
      const payment = event.payload?.payment?.entity;
      if (event.event === 'subscription.charged' && payment) payments.record(payment.id, user.id, sub.id, payment.amount);
    } else {
      console.warn(`  webhook ${event.event} for unknown subscription ${sub.id}`);
    }
  }
  json(res, 200, { ok: true });
}

// ---------- the billing app, behind the gate ----------

// A worker cached from earlier would keep serving the app shell without
// asking the gateway, i.e. without a login check. This one removes itself.
const SW_KILL_SWITCH = `self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.map(k=>caches.delete(k)))).then(()=>self.registration.unregister())));`;

// Desktop-only features of the billing app that must not run on a shared
// server: install/update/uninstall scripts, opening folders on the server,
// restarting it, or writing backups to any folder on the server's disk.
function blockedForHosting(req, pathname) {
  if (pathname.startsWith('/api/control-panel')) return true;
  if (pathname === '/api/backup-folder' && req.method !== 'GET') return true;
  return false;
}

async function app(req, res, pathname, user) {
  if (pathname === '/sw.js') {
    res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
    return res.end(SW_KILL_SWITCH);
  }
  if (!user) return wantsPage(req) ? redirect(res, '/login') : json(res, 401, { error: 'Please log in again.', code: 'logged-out' });
  if (!accessFor(user).allowed) return wantsPage(req) ? redirect(res, '/billing') : json(res, 402, { error: 'Your plan has ended. Renew to continue.', code: 'payment-required' });
  if (pathname === '/control-panel' || pathname.startsWith('/control-panel/')) return redirect(res, '/');
  if (blockedForHosting(req, pathname)) return json(res, 403, { error: 'Not available in the online version.', code: 'forbidden' });
  // Updates are rolled out by you, the operator, for every business at once.
  if (pathname === '/api/check-update') return json(res, 200, { current: billingVersion, latest: billingVersion, updateAvailable: false });
  if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) return json(res, 403, { error: 'Cross-origin request refused' });

  let port;
  try {
    port = await portFor(user.id);
  } catch (err) {
    console.error(`  ${err.message}`);
    return json(res, 503, { error: 'Your billing workspace could not start. Please try again in a minute.' });
  }
  proxyToTenant(req, res, port);
}

// ---------- router ----------

async function handle(req, res) {
  securityHeaders(res);
  const { pathname } = new URL(req.url, 'http://x');
  const user = currentUser(req);
  const post = req.method === 'POST';

  if (pathname === '/healthz') return json(res, 200, { ok: true });
  if (pathname.startsWith('/__saas/static/')) {
    const file = pathname.slice('/__saas/static/'.length);
    return STATIC[file] ? serveFile(res, file, STATIC[file]) : json(res, 404, { error: 'Not found' });
  }
  if (pathname === '/__saas/razorpay/webhook' && post) return webhook(req, res);

  if (pathname.startsWith('/__saas/') && post && !sameOrigin(req)) return json(res, 403, { error: 'Cross-origin request refused' });

  switch (pathname) {
    case '/login':
      return user ? redirect(res, '/') : servePage(res, 'login.html');
    case '/signup':
      return user ? redirect(res, '/') : servePage(res, 'signup.html');
    case '/billing':
      return user ? servePage(res, 'billing.html') : redirect(res, '/login');
    case '/logout': // a plain link works too; it only ever signs out
      endSession(req, res);
      return redirect(res, '/login');
    case '/__saas/signup': if (post) return signup(req, res); break;
    case '/__saas/login': if (post) return login(req, res); break;
    case '/__saas/logout': if (post) { endSession(req, res); return json(res, 200, { ok: true }); } break;
    case '/__saas/me':
      return user ? json(res, 200, accountView(user)) : json(res, 401, { error: 'Not logged in', code: 'logged-out' });
    case '/__saas/billing/subscribe':
    case '/__saas/billing/verify':
    case '/__saas/billing/cancel': {
      if (!post) break;
      if (!user) return json(res, 401, { error: 'Please log in again.', code: 'logged-out' });
      const action = { '/__saas/billing/subscribe': subscribe, '/__saas/billing/verify': verifyPayment, '/__saas/billing/cancel': cancel }[pathname];
      return action(req, res, user);
    }
    default:
      if (pathname.startsWith('/__saas/')) return json(res, 404, { error: 'Not found' });
      return app(req, res, pathname, user);
  }
  json(res, 405, { error: 'Method not allowed' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    const status = err.status || (err.name === 'TimeoutError' ? 504 : 500);
    if (status >= 500) console.error(`  ${req.method} ${req.url}: ${err.stack || err}`);
    if (!res.headersSent) json(res, status, { error: status === 413 ? 'Request too large' : status === 400 ? 'Invalid request' : 'Something went wrong. Please try again.' });
    else res.end();
  });
});
server.requestTimeout = 10 * 60 * 1000; // large backup restores

server.listen(config.port, config.host, () => {
  console.log(`\n  ${config.brandName} gateway on http://${config.host}:${config.port}  (public: ${config.publicOrigin})`);
  console.log(`  Billing app: ${config.billingAppDir}  ·  Books: ${config.dataRoot}`);
  if (!paymentsConfigured()) console.log('  ⚠ Razorpay is not configured: sign-up and the free trial work, subscribing does not.');
  if (!config.razorpay.webhookSecret) console.log('  ⚠ RAZORPAY_WEBHOOK_SECRET is not set: renewals will not be recorded.');
  console.log('');
});

function shutdown() {
  stopAll();
  server.close();
  setTimeout(() => process.exit(0), 4000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
