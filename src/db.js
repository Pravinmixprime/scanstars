// Shared Postgres connection pool for the whole process, via the standard
// `pg` driver — a pure network client with nothing to compile, so (unlike
// better-sqlite3) it installs identically on every OS, including Windows
// with no build tools present.
//
// This talks to a real Postgres database over the network rather than a
// local file, which is what makes it safe to deploy on hosts with an
// ephemeral filesystem (e.g. a free Render web service, which wipes local
// disk every time the service spins down from inactivity). A free,
// always-persistent Postgres database is available from Supabase with no
// credit card — see .env.example for how to get a DATABASE_URL from it.
// The exact same connection string works for local development too, so
// there is nothing to install locally either.
const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is missing. Set it in .env (see .env.example) to a Postgres connection string, e.g. from a free Supabase project."
  );
}

const pool = new Pool({
  connectionString,
  // Supabase (and most hosted Postgres) requires TLS; we don't have their
  // CA bundle handy, so we encrypt the connection without verifying the
  // certificate chain. That still stops a plain eavesdropper — it just
  // doesn't defend against a compromised network path spoofing the host.
  ssl: connectionString.indexOf("localhost") === -1 ? { rejectUnauthorized: false } : false
});

async function get(sql, params) {
  var r = await pool.query(sql, params);
  return r.rows[0] || null;
}

async function all(sql, params) {
  var r = await pool.query(sql, params);
  return r.rows;
}

async function run(sql, params) {
  var r = await pool.query(sql, params);
  return { rowCount: r.rowCount, rows: r.rows };
}

// Creates the schema if it doesn't exist yet. Safe to call every time the
// app starts — CREATE TABLE/INDEX IF NOT EXISTS are no-ops once it's there.
async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id             TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      phone          TEXT NOT NULL UNIQUE,
      email          TEXT,
      password_hash  TEXT NOT NULL,
      role           TEXT NOT NULL DEFAULT 'agent',
      referral_code  TEXT NOT NULL UNIQUE,
      referred_by_id TEXT REFERENCES users(id),
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
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
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      paid_at             TIMESTAMPTZ
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      paid_at    TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_payouts_agent ON payouts(agent_id);

    CREATE TABLE IF NOT EXISTS config (
      id           INTEGER PRIMARY KEY CHECK (id = 1),
      total_amount INTEGER NOT NULL DEFAULT 499,
      l1_amount    INTEGER NOT NULL DEFAULT 150,
      l2_amount    INTEGER NOT NULL DEFAULT 50
    );

    -- Bulk QR purchases: a user (e.g. a distributor) pre-pays for a batch of
    -- QR codes at a negotiated discounted rate, granted manually by an admin
    -- after the deal is settled outside the app. Each grant is a permanent
    -- audit record; users.bulk_credits is the running balance of credits
    -- from all grants not yet spent on a shop.
    CREATE TABLE IF NOT EXISTS bulk_grants (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id),
      quantity     INTEGER NOT NULL,
      unit_price   INTEGER NOT NULL,
      total_amount INTEGER NOT NULL,
      note         TEXT,
      granted_by   TEXT REFERENCES users(id),
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_bulk_grants_user ON bulk_grants(user_id);
  `);

  // Added after the tables above already existed in deployed databases —
  // ADD COLUMN IF NOT EXISTS keeps this safe to run on every boot, on a
  // brand-new database and an already-live one alike.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bulk_credits INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS paid_via TEXT;`);
}

module.exports = { pool, get, all, run, init };
