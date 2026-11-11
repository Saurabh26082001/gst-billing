// Passwords, session cookies and the access rule (trial or paid).
import crypto from 'crypto';
import { promisify } from 'util';
import { config } from './config.js';
import { sessions } from './db.js';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const DAY = 24 * 60 * 60 * 1000;
export const COOKIE = 'gstb_sid';

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [kind, N, r, p, salt, hash] = String(stored).split('$');
  if (kind !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p });
  return crypto.timingSafeEqual(actual, expected);
}

// A wrong email costs as much time as a wrong password, so login timing does
// not reveal which emails have accounts.
const DUMMY_HASH = await hashPassword(crypto.randomUUID());
export const burnPasswordCheck = (password) => verifyPassword(password, DUMMY_HASH).catch(() => false);

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const ttl = config.sessionDays * DAY;
  sessions.create(sha256(token), userId, ttl);
  setCookie(res, token, Math.floor(ttl / 1000));
}

export function endSession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) sessions.delete(sha256(token));
  setCookie(res, '', 0);
}

export function currentUser(req) {
  const token = readCookie(req, COOKIE);
  return token ? sessions.user(sha256(token)) || null : null;
}

function setCookie(res, value, maxAgeSec) {
  const parts = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (config.secureCookies) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

// The one place that decides whether a business may use the app right now.
export function accessFor(user, now = Date.now()) {
  const paidUntil = user.paid_until ? user.paid_until + config.graceDays * DAY : 0;
  const inTrial = now < user.trial_ends_at;
  const paid = now < paidUntil;
  return {
    allowed: inTrial || paid,
    inTrial,
    paid,
    trialEndsAt: user.trial_ends_at,
    paidUntil: user.paid_until || null,
    trialDaysLeft: inTrial ? Math.ceil((user.trial_ends_at - now) / DAY) : 0,
    subscriptionStatus: user.sub_status || null,
  };
}

// Brute-force brake for login and signup: N attempts per key per window.
const attempts = new Map();
export function tooManyAttempts(key, limit = 10, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  attempts.set(key, list);
  return list.length > limit;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, list] of attempts) if (list.every((t) => now - t > 15 * 60 * 1000)) attempts.delete(k);
  sessions.purgeExpired();
}, 10 * 60 * 1000).unref();
