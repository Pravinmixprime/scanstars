function digits(s) {
  return String(s || "").replace(/\D/g, "");
}

function randCode(len) {
  var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I — easy to read aloud
  var out = "";
  for (var i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

module.exports = { digits, randCode };
