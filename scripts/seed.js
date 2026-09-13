// Creates the database schema (if missing), the admin account, and the
// default commission config on first setup. Safe to re-run — does nothing
// to what already exists. Runs automatically as part of `npm start`, so a
// host like Render (which only runs one start command, with no separate
// step for one-off scripts) always ends up with a ready database.
require("dotenv").config();
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("../src/db");

async function main() {
  await db.init();

  var adminPhone = process.env.ADMIN_PHONE || "admin";
  var adminPassword = process.env.ADMIN_PASSWORD;
  var adminName = process.env.ADMIN_NAME || "Admin";

  if (!adminPassword) {
    console.warn("ADMIN_PASSWORD not set in .env — skipping admin account creation.");
  } else {
    var existing = await db.get("SELECT id FROM users WHERE phone = $1", [adminPhone]);
    if (existing) {
      console.log("Admin account already exists (" + adminPhone + ") — leaving it as is.");
    } else {
      var hash = await bcrypt.hash(adminPassword, 10);
      await db.run(
        "INSERT INTO users (id, name, phone, role, referral_code, password_hash) VALUES ($1, $2, $3, 'admin', $4, $5)",
        [crypto.randomUUID(), adminName, adminPhone, "HQ" + Math.floor(Math.random() * 1000), hash]
      );
      console.log("Created admin account: " + adminPhone);
    }
  }

  var cfg = await db.get("SELECT id FROM config WHERE id = 1");
  if (!cfg) {
    await db.run("INSERT INTO config (id) VALUES (1)"); // column defaults: 499 / 150 / 50
    console.log("Created default commission config (₹499 fee / ₹150 L1 / ₹50 L2).");
  } else {
    console.log("Commission config already exists — leaving it as is.");
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.pool.end());
