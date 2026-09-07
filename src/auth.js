const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const COOKIE_NAME = "ss_session";
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 16) {
  throw new Error(
    "JWT_SECRET is missing or too short. Set a long random value in .env (see .env.example)."
  );
}

function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function signSession(user) {
  return jwt.sign(
    { sub: user.id, role: user.role },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}

function setSessionCookie(res, user) {
  const token = signSession(user);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

// Attaches req.userId / req.userRole when a valid session cookie is present.
// Never rejects by itself — routes decide what to require.
function attachSession(req, _res, next) {
  var token = req.cookies && req.cookies[COOKIE_NAME];
  if (token) {
    try {
      var payload = jwt.verify(token, JWT_SECRET);
      req.userId = payload.sub;
      req.userRole = payload.role;
    } catch (e) {
      // invalid/expired token: treat as logged out
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.userId) return res.status(401).json({ error: "Not logged in." });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.userId || req.userRole !== "admin") {
    return res.status(403).json({ error: "Admin access required." });
  }
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  setSessionCookie,
  clearSessionCookie,
  attachSession,
  requireAuth,
  requireAdmin
};
