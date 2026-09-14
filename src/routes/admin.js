const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const { requireAdmin } = require("../auth");
const { getConfig } = require("../lib/commission");
const { digits } = require("../lib/util");

const router = express.Router();

// Every registered account (partners/agents and any bulk buyers) with
// enough detail to answer "who has signed up, and what have they done" at a
// glance — join date, who referred them, how many shops they've added, and
// any bulk credit balance.
router.get("/users", requireAdmin, async (req, res) => {
  try {
    var users = await db.all(`
      SELECT
        u.id, u.name, u.phone, u.email, u.role, u.referral_code, u.bulk_credits, u.created_at,
        ref.name AS referred_by_name, ref.phone AS referred_by_phone,
        COUNT(s.id) FILTER (WHERE s.status = 'paid') AS shops_paid,
        COUNT(s.id) AS shops_total
      FROM users u
      LEFT JOIN users ref ON ref.id = u.referred_by_id
      LEFT JOIN shops s ON s.agent_id = u.id
      GROUP BY u.id, ref.name, ref.phone
      ORDER BY u.created_at DESC
    `);
    res.json({
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        phone: u.phone,
        email: u.email,
        role: u.role,
        referralCode: u.referral_code,
        referredByName: u.referred_by_name,
        referredByPhone: u.referred_by_phone,
        bulkCredits: u.bulk_credits,
        shopsPaid: Number(u.shops_paid),
        shopsTotal: Number(u.shops_total),
        createdAt: u.created_at
      }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load partners." });
  }
});

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
        paidVia: s.paid_via,
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

// Records a negotiated bulk QR deal after you've settled payment with the
// buyer outside the app (bank transfer, UPI, etc.) and credits their
// account with that many QR codes to give out for free, one per shop, until
// the balance runs out. Does NOT charge or move any money itself.
router.post("/bulk-grants", requireAdmin, async (req, res) => {
  var client = await db.pool.connect();
  try {
    var body = req.body || {};
    var phone = digits(body.phone);
    var quantity = Number(body.quantity);
    var unitPrice = Number(body.unitPrice);
    var note = String(body.note || "");

    if (!phone) return res.status(400).json({ error: "Enter the buyer's phone number." });
    if (!Number.isInteger(quantity) || quantity <= 0) return res.status(400).json({ error: "Quantity must be a positive whole number." });
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return res.status(400).json({ error: "Unit price must be a non-negative number." });

    var buyer = await db.get("SELECT id, name FROM users WHERE phone = $1", [phone]);
    if (!buyer) return res.status(404).json({ error: "No account found with that phone number. They need to sign up first." });

    var totalAmount = quantity * unitPrice;
    var id = crypto.randomUUID();

    await client.query("BEGIN");
    await client.query(
      "INSERT INTO bulk_grants (id, user_id, quantity, unit_price, total_amount, note, granted_by) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [id, buyer.id, quantity, unitPrice, totalAmount, note || null, req.userId]
    );
    await client.query("UPDATE users SET bulk_credits = bulk_credits + $1 WHERE id = $2", [quantity, buyer.id]);
    await client.query("COMMIT");

    res.status(201).json({ grant: { id: id, buyerName: buyer.name, quantity: quantity, unitPrice: unitPrice, totalAmount: totalAmount } });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (e2) { /* connection may already be broken */ }
    console.error(err);
    res.status(500).json({ error: "Could not grant bulk credits." });
  } finally {
    client.release();
  }
});

router.get("/bulk-grants", requireAdmin, async (req, res) => {
  try {
    var grants = await db.all(
      `SELECT g.*, u.name AS buyer_name, u.phone AS buyer_phone FROM bulk_grants g
       JOIN users u ON u.id = g.user_id ORDER BY g.created_at DESC`
    );
    res.json({
      grants: grants.map((g) => ({
        id: g.id,
        buyerName: g.buyer_name,
        buyerPhone: g.buyer_phone,
        quantity: g.quantity,
        unitPrice: g.unit_price,
        totalAmount: g.total_amount,
        note: g.note,
        createdAt: g.created_at
      }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load bulk grants." });
  }
});

module.exports = router;
