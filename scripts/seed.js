// Creates the admin account and default commission config on first setup.
// Safe to re-run — does nothing if they already exist.
require("dotenv").config();
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("../src/db");

async function main() {
  var adminPhone = process.env.ADMIN_PHONE || "admin";
  var adminPassword = process.env.ADMIN_PASSWORD;
  var adminName = process.env.ADMIN_NAME || "Admin";

  if (!adminPassword) {
    console.warn("ADMIN_PASSWORD not set in .env — skipping admin account creation.");
  } else {
    var existing = db.prepare("SELECT id FROM users WHERE phone = ?").get(adminPhone);
    if (existing) {
      console.log("Admin account already exists (" + adminPhone + ") — leaving it as is.");
    } else {
      var hash = await bcrypt.hash(adminPassword, 10);
      db.prepare(
        "INSERT INTO users (id, name, phone, role, referral_code, password_hash) VALUES (?, ?, ?, 'admin', ?, ?)"
      ).run(crypto.randomUUID(), adminName, adminPhone, "HQ" + Math.floor(Math.random() * 1000), hash);
      console.log("Created admin account: " + adminPhone);
    }
  }

  var cfg = db.prepare("SELECT id FROM config WHERE id = 1").get();
  if (!cfg) {
    db.prepare("INSERT INTO config (id) VALUES (1)").run(); // column defaults: 499 / 150 / 50
    console.log("Created default commission config (₹499 fee / ₹150 L1 / ₹50 L2).");
  } else {
    console.log("Commission config already exists — leaving it as is.");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
