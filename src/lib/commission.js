const crypto = require("crypto");
const db = require("../db");

function getConfig() {
  var row = db.prepare("SELECT * FROM config WHERE id = 1").get();
  if (!row) {
    db.prepare("INSERT INTO config (id) VALUES (1)").run(); // uses column defaults
    row = db.prepare("SELECT * FROM config WHERE id = 1").get();
  }
  return {
    totalAmount: row.total_amount,
    l1Amount: row.l1_amount,
    l2Amount: row.l2_amount
  };
}

function nowIso() {
  return new Date().toISOString();
}

// Marks a shop paid and creates the L1 (+ L2, if the agent was referred)
// commission entries. Idempotent: if the shop is already paid, does nothing —
// safe to call from both the client-confirm endpoint and the webhook without
// double-crediting an agent. Runs as one SQLite transaction (node:sqlite has
// no db.transaction() helper the way better-sqlite3 does, so this wraps the
// statements in BEGIN/COMMIT/ROLLBACK by hand).
function settleShopPayment(shopId, paymentMeta) {
  db.exec("BEGIN");
  try {
    var shop = db.prepare("SELECT * FROM shops WHERE id = ?").get(shopId);
    if (!shop) throw new Error("Shop not found.");
    if (shop.status === "paid") { db.exec("COMMIT"); return shop; } // already settled — no-op

    var cfg = getConfig();
    var paidAt = nowIso();

    db.prepare(
      "UPDATE shops SET status = 'paid', paid_at = ?, razorpay_payment_id = COALESCE(?, razorpay_payment_id) WHERE id = ?"
    ).run(paidAt, (paymentMeta && paymentMeta.razorpayPaymentId) || null, shopId);

    db.prepare(
      "INSERT INTO payouts (id, agent_id, shop_id, level, amount, status) VALUES (?, ?, ?, 1, ?, 'payable')"
    ).run(crypto.randomUUID(), shop.agent_id, shop.id, cfg.l1Amount);

    if (shop.agent_referrer_id) {
      db.prepare(
        "INSERT INTO payouts (id, agent_id, shop_id, level, amount, status) VALUES (?, ?, ?, 2, ?, 'payable')"
      ).run(crypto.randomUUID(), shop.agent_referrer_id, shop.id, cfg.l2Amount);
    }

    var updated = db.prepare("SELECT * FROM shops WHERE id = ?").get(shopId);
    db.exec("COMMIT");
    return updated;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

module.exports = { getConfig, settleShopPayment };
