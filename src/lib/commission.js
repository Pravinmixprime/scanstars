const crypto = require("crypto");
const db = require("../db");

async function getConfig() {
  var row = await db.get("SELECT * FROM config WHERE id = 1");
  if (!row) {
    await db.run("INSERT INTO config (id) VALUES (1) ON CONFLICT (id) DO NOTHING"); // uses column defaults
    row = await db.get("SELECT * FROM config WHERE id = 1");
  }
  return {
    totalAmount: row.total_amount,
    l1Amount: row.l1_amount,
    l2Amount: row.l2_amount
  };
}

// Marks a shop paid and creates the L1 (+ L2, if the agent was referred)
// commission entries. Idempotent: if the shop is already paid, does nothing —
// safe to call from both the client-confirm endpoint and the webhook without
// double-crediting an agent. Runs as one Postgres transaction on a single
// checked-out client (not the shared pool) so concurrent requests can't
// interleave BEGIN/COMMIT across different connections.
async function settleShopPayment(shopId, paymentMeta) {
  var client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    var shopRes = await client.query("SELECT * FROM shops WHERE id = $1 FOR UPDATE", [shopId]);
    var shop = shopRes.rows[0];
    if (!shop) throw new Error("Shop not found.");
    if (shop.status === "paid") {
      await client.query("COMMIT");
      return shop; // already settled — no-op
    }

    var cfgRes = await client.query("SELECT * FROM config WHERE id = 1");
    var cfg = cfgRes.rows[0];
    if (!cfg) {
      await client.query("INSERT INTO config (id) VALUES (1) ON CONFLICT (id) DO NOTHING");
      cfgRes = await client.query("SELECT * FROM config WHERE id = 1");
      cfg = cfgRes.rows[0];
    }

    await client.query(
      "UPDATE shops SET status = 'paid', paid_at = now(), razorpay_payment_id = COALESCE($1, razorpay_payment_id) WHERE id = $2",
      [(paymentMeta && paymentMeta.razorpayPaymentId) || null, shopId]
    );

    await client.query(
      "INSERT INTO payouts (id, agent_id, shop_id, level, amount, status) VALUES ($1, $2, $3, 1, $4, 'payable')",
      [crypto.randomUUID(), shop.agent_id, shop.id, cfg.l1_amount]
    );

    if (shop.agent_referrer_id) {
      await client.query(
        "INSERT INTO payouts (id, agent_id, shop_id, level, amount, status) VALUES ($1, $2, $3, 2, $4, 'payable')",
        [crypto.randomUUID(), shop.agent_referrer_id, shop.id, cfg.l2_amount]
      );
    }

    var updatedRes = await client.query("SELECT * FROM shops WHERE id = $1", [shopId]);
    await client.query("COMMIT");
    return updatedRes.rows[0];
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch (e2) { /* connection may already be broken */ }
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { getConfig, settleShopPayment };
