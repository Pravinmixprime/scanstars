/**
 * ScanStars Partners — backend entry point.
 *
 * SETUP
 * -----
 *   cp .env.example .env      # then fill in real values, including DATABASE_URL
 *   npm install
 *   npm start                  # runs on http://localhost:3000 by default
 *
 * The database is Postgres, reached over the network via DATABASE_URL (a
 * free Supabase project works well and needs no credit card) — nothing to
 * install locally, nothing to compile on any OS. `npm start` seeds the
 * schema/admin account before booting the server (see scripts/seed.js), so
 * a host that only runs one start command (like Render's free tier) always
 * ends up with a ready database. The frontend in /public is served as
 * static files by this same server — one process, one deploy.
 *
 * See .env.example for what each setting does, including how to wire up
 * Razorpay for real payments.
 */
require("dotenv").config();

const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");

const { attachSession } = require("./auth");
const db = require("./db");

const app = express();
app.set("trust proxy", 1); // needed for secure cookies behind a platform's reverse proxy

app.use(
  helmet({
    contentSecurityPolicy: false // the static frontend sets its own; avoid double-restricting during setup
  })
);

var allowedOrigins = String(process.env.CORS_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : true,
    credentials: true
  })
);

// The Razorpay webhook needs the RAW body for signature verification, so it
// is mounted BEFORE the app-wide express.json() below — once json() has
// consumed and parsed a request body, the raw bytes needed for the
// signature check are gone. Every other route is mounted after json().
app.use("/api/payments", require("./routes/webhook"));

app.use(express.json());
app.use(cookieParser());
app.use(attachSession);

var apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120 });
app.use("/api", apiLimiter);

app.use("/api/auth", require("./routes/auth"));
app.use("/api/shops", require("./routes/shops"));
app.use("/api/payments", require("./routes/payments"));
app.use("/api/network", require("./routes/network"));
app.use("/api/admin", require("./routes/admin"));

app.get("/api/health", (req, res) => res.json({ ok: true }));

// Static frontend (built as plain HTML/CSS/JS — no build step needed).
app.use(express.static(path.join(__dirname, "..", "public")));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Unexpected server error." });
});

var port = process.env.PORT || 3000;

// db.init() is idempotent (CREATE TABLE/INDEX IF NOT EXISTS), so it's safe
// to also run it here even though `npm start` already ran it via seed.js —
// this just protects `npm run dev` (which skips seed.js) from erroring on a
// database with no tables yet.
db.init()
  .then(() => {
    app.listen(port, () => console.log("ScanStars backend listening on :" + port));
  })
  .catch((err) => {
    console.error("Failed to start: could not reach/initialize the database.", err);
    process.exit(1);
  });
