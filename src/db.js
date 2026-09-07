// Single shared SQLite connection for the whole process, using Node's own
// built-in `node:sqlite` module (needs Node 22.5+, see the "engines" field
// in package.json). This ships inside Node itself — nothing to compile, so
// no C++ build tools required on any OS (that's what a `better-sqlite3`
// install failure on Windows means: no compiler available, and no prebuilt
// binary for your exact Node version). Node marks this module
// "experimental" — its shape has been stable, but treat this file as the
// one place to touch if a future Node version changes its API. The whole
// database lives in one file (DB_FILE).
//
// This is comfortably enough for a business at "a few thousand shops and a
// few hundred partners" scale. If ScanStars later needs a shared server
// database (e.g. multiple app instances behind a load balancer), swap this
// file for a Postgres client (`pg`) — every other file talks to the small
// query-methods object below, not to SQLite directly, so that swap stays
// contained to this one file.
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const dbFile = process.env.DB_FILE || path.join(__dirname, "..", "data.sqlite3");
const db = new DatabaseSync(dbFile);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    phone          TEXT NOT NULL UNIQUE,
    email          TEXT,
    password_hash  TEXT NOT NULL,
    role           TEXT NOT NULL DEFAULT 'agent',
    referral_code  TEXT NOT NULL UNIQUE,
    referred_by_id TEXT REFERENCES users(id),
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS shops (
    id                  TEXT PRIMARY KEY,
    shop_name           TEXT NOT NULL,
    owner_phone         TEXT,
    review_link         TEXT NOT NULL,
    agent_id            TEXT NOT NULL REFERENCES users(id),
    agent_referrer_id   TEXT,
    amount              INTEGER NOT NULL,
    status              TEXT NOT NULL DEFAULT 'pending',
    razorpay_order_id   TEXT,
    razorpay_payment_id TEXT,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    paid_at             TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_shops_agent ON shops(agent_id);
  CREATE INDEX IF NOT EXISTS idx_shops_order ON shops(razorpay_order_id);

  CREATE TABLE IF NOT EXISTS payouts (
    id         TEXT PRIMARY KEY,
    agent_id   TEXT NOT NULL REFERENCES users(id),
    shop_id    TEXT NOT NULL REFERENCES shops(id),
    level      INTEGER NOT NULL,
    amount     INTEGER NOT NULL,
    status     TEXT NOT NULL DEFAULT 'payable',
    note       TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    paid_at    TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_payouts_agent ON payouts(agent_id);

  CREATE TABLE IF NOT EXISTS config (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    total_amount INTEGER NOT NULL DEFAULT 499,
    l1_amount    INTEGER NOT NULL DEFAULT 150,
    l2_amount    INTEGER NOT NULL DEFAULT 50
  );
`);

module.exports = db;
