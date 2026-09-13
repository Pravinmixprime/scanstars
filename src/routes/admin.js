const express = require("express");
const db = require("../db");
const { requireAdmin } = require("../auth");
const { getConfig } = require("../lib/commission");

const router = express.Router();

router.get("/shops", requireAdmin, async (req, res) => {
  try {
    var shops = await db.all(
      `SELECT s.*, u.name AS agent_name, u.phone AS agent_phone FROM shops s
       JOIN users u ON u.id = s.agent_id ORDER BY s.created_at DESC`
    );
    res.json({
      shops: shops.map((s) => ({
        id: s.id,
        shopName: s.shop_name,
        agentName: s.agent_name,
        agentPhone: s.agent_phone,
        amount: s.amount,
        status: s.status,
        createdAt: s.created_at,
        paidAt: s.paid_at
      }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load shops." });
  }
});

router.get("/payouts", requireAdmin, async (req, res) => {
  try {
    var payouts = await db.all(
      `SELECT p.*, u.name AS agent_name, u.phone AS agent_phone, s.shop_name FROM payouts p
       JOIN users u ON u.id = p.agent_id
       JOIN shops s ON s.id = p.shop_id
       ORDER BY p.created_at DESC`
    );
    res.json({
      payouts: payouts.map((p) => ({
        id: p.id,
        agentName: p.agent_name,
        agentPhone: p.agent_phone,
        shopName: p.shop_name,
        level: p.level,
        amount: p.amount,
        status: p.status,
        note: p.note,
        createdAt: p.created_at,
        paidAt: p.paid_at
      }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load payouts." });
  }
});

// Records that your team sent the commission by UPI/bank transfer outside
// this app. This does NOT move any money itself.
router.post("/payouts/:id/mark-paid", requireAdmin, async (req, res) => {
  try {
    var note = String((req.body && req.body.note) || "");
    var result = await db.run(
      "UPDATE payouts SET status = 'paid', paid_at = now(), note = $1 WHERE id = $2",
      [note, req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Payout not found." });
    var payout = await db.get("SELECT * FROM payouts WHERE id = $1", [req.params.id]);
    res.json({ payout: { id: payout.id, status: payout.status } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not update payout." });
  }
});

router.get("/config", requireAdmin, async (req, res) => {
  try {
    res.json({ config: await getConfig() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load settings." });
  }
});

router.put("/config", requireAdmin, async (req, res) => {
  try {
    var body = req.body || {};
    var totalAmount = Number(body.totalAmount);
    var l1Amount = Number(body.l1Amount);
    var l2Amount = Number(body.l2Amount);
    if (![totalAmount, l1Amount, l2Amount].every((n) => Number.isFinite(n) && n >= 0)) {
      return res.status(400).json({ error: "Amounts must be non-negative numbers." });
    }
    await getConfig(); // ensures the row exists
    await db.run(
      "UPDATE config SET total_amount = $1, l1_amount = $2, l2_amount = $3 WHERE id = 1",
      [totalAmount, l1Amount, l2Amount]
    );
    res.json({ config: await getConfig() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not save settings." });
  }
});

module.exports = router;
