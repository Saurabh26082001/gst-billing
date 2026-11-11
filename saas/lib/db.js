// Accounts, sessions and payment records in one SQLite file (Node's built-in
// node:sqlite, so there is nothing to install). The books themselves are not
// here: each business keeps its own folder, as the billing app always did.
import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(config.dataRoot, { recursive: true });
export const db = new DatabaseSync(path.join(config.dataRoot, 'accounts.sqlite'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL DEFAULT '',
    business        TEXT NOT NULL DEFAULT '',
    phone           TEXT NOT NULL DEFAULT '',
    password_hash   TEXT NOT NULL,
    created_at      INTEGER NOT NULL,
    trial_ends_at   INTEGER NOT NULL,
    -- Razorpay subscription: its id, its last known status, and the end of
    -- the period already paid for (ms). Access = trial or paid_until.
    sub_id          TEXT,
    sub_status      TEXT,
    paid_until      INTEGER
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS payments (
    payment_id  TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sub_id      TEXT,
    amount      INTEGER,
    created_at  INTEGER NOT NULL
  );

  -- Razorpay retries webhooks; each event is applied once.
  CREATE TABLE IF NOT EXISTS webhook_events (
    id          TEXT PRIMARY KEY,
    received_at INTEGER NOT NULL
  );
`);

const q = {
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  userBySub: db.prepare('SELECT * FROM users WHERE sub_id = ?'),
  insertUser: db.prepare(`INSERT INTO users (id, email, name, business, phone, password_hash, created_at, trial_ends_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  setSub: db.prepare('UPDATE users SET sub_id = ?, sub_status = ? WHERE id = ?'),
  setSubStatus: db.prepare('UPDATE users SET sub_status = ? WHERE id = ?'),
  extendPaid: db.prepare('UPDATE users SET paid_until = MAX(COALESCE(paid_until, 0), ?) WHERE id = ?'),
  insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
  sessionUser: db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
                           WHERE s.token_hash = ? AND s.expires_at > ?`),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
  insertPayment: db.prepare('INSERT OR IGNORE INTO payments (payment_id, user_id, sub_id, amount, created_at) VALUES (?, ?, ?, ?, ?)'),
  insertEvent: db.prepare('INSERT OR IGNORE INTO webhook_events (id, received_at) VALUES (?, ?)'),
};

export const users = {
  byId: (id) => q.userById.get(id),
  byEmail: (email) => q.userByEmail.get(email),
  bySubscription: (subId) => q.userBySub.get(subId),
  create: (u) => q.insertUser.run(u.id, u.email, u.name, u.business, u.phone, u.passwordHash, u.createdAt, u.trialEndsAt),
  setSubscription: (id, subId, status) => q.setSub.run(subId, status, id),
  setSubscriptionStatus: (id, status) => q.setSubStatus.run(status, id),
  extendPaidUntil: (id, untilMs) => q.extendPaid.run(untilMs, id),
};

export const sessions = {
  create: (tokenHash, userId, ttlMs) => { const now = Date.now(); q.insertSession.run(tokenHash, userId, now, now + ttlMs); },
  user: (tokenHash) => q.sessionUser.get(tokenHash, Date.now()),
  delete: (tokenHash) => q.deleteSession.run(tokenHash),
  purgeExpired: () => q.purgeSessions.run(Date.now()),
};

export const payments = {
  record: (paymentId, userId, subId, amount) => q.insertPayment.run(paymentId, userId, subId, amount ?? null, Date.now()),
};

// true the first time an event id is seen.
export const firstTimeEvent = (id) => q.insertEvent.run(id, Date.now()).changes === 1;
