const express = require("express");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const db = require("../db");
const { digits, randCode } = require("../lib/util");
const {
  hashPassword,
  verifyPassword,
  setSessionCookie,
  clearSessionCookie,
  requireAuth
} = require("../auth");

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false
});

function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    role: row.role,
    referralCode: row.referral_code,
    referredById: row.referred_by_id,
    createdAt: row.created_at
  };
}

router.post("/register", authLimiter, async (req, res) => {
  try {
    var body = req.body || {};
    var name = String(body.name || "").trim();
    var phone = digits(body.phone);
    var email = String(body.email || "").trim();
    var password = String(body.password || "");
    var refCode = String(body.refCode || "").trim().toUpperCase();

    if (!name) return res.status(400).json({ error: "Name is required." });
    if (phone.length < 10) return res.status(400).json({ error: "Enter a valid phone number." });
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });

    var existing = await db.get("SELECT id FROM users WHERE phone = $1", [phone]);
    if (existing) return res.status(409).json({ error: "An account with this phone number already exists." });

    var referredById = null;
    if (refCode) {
      var refUser = await db.get("SELECT id FROM users WHERE referral_code = $1", [refCode]);
      if (!refUser) return res.status(400).json({ error: "That referral code wasn't found." });
      referredById = refUser.id;
    }

    var passwordHash = await hashPassword(password);
    var id = crypto.randomUUID();

    // Referral codes are short and drawn from a shared namespace — retry a
    // few times on the (rare) collision rather than trusting one shot.
    var code, done = false;
    for (var attempt = 0; attempt < 5 && !done; attempt++) {
      code = randCode(6);
      try {
        await db.run(
          "INSERT INTO users (id, name, phone, email, password_hash, referral_code, referred_by_id) VALUES ($1, $2, $3, $4, $5, $6, $7)",
          [id, name, phone, email || null, passwordHash, code, referredById]
        );
        done = true;
      } catch (e) {
        if (e.code === "23505" && String(e.constraint || "").indexOf("referral_code") !== -1 && attempt < 4) continue;
        throw e;
      }
    }

    var user = await db.get("SELECT * FROM users WHERE id = $1", [id]);
    setSessionCookie(res, { id: user.id, role: user.role });
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not create account." });
  }
});

router.post("/login", authLimiter, async (req, res) => {
  try {
    var body = req.body || {};
    var loginId = String(body.phone || "").trim();
    var password = String(body.password || "");
    var lookupPhone = loginId.toLowerCase() === "admin" ? "admin" : digits(loginId);

    var user = await db.get("SELECT * FROM users WHERE phone = $1", [lookupPhone]);
    if (!user) return res.status(401).json({ error: "No account found with that phone number." });

    var ok = await verifyPassword(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Incorrect password." });

    setSessionCookie(res, { id: user.id, role: user.role });
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not log in." });
  }
});

router.post("/logout", (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get("/me", requireAuth, async (req, res) => {
  try {
    var user = await db.get("SELECT * FROM users WHERE id = $1", [req.userId]);
    if (!user) return res.status(401).json({ error: "Not logged in." });
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load account." });
  }
});

module.exports = router;
