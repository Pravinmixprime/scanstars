const express = require("express");
const db = require("../db");
const { requireAuth } = require("../auth");

const router = express.Router();

router.get("/summary", requireAuth, async (req, res) => {
  try {
    var payouts = await db.all(
      `SELECT p.*, s.shop_name FROM payouts p JOIN shops s ON s.id = p.shop_id
       WHERE p.agent_id = $1 ORDER BY p.created_at DESC`,
      [req.userId]
    );

    var totalEarned = payouts.reduce((a, p) => a + p.amount, 0);
    var payable = payouts.filter((p) => p.status === "payable").reduce((a, p) => a + p.amount, 0);
    var paidOut = payouts.filter((p) => p.status === "paid").reduce((a, p) => a + p.amount, 0);

    res.json({
      totalEarned,
      payable,
      paidOut,
      payouts: payouts.map((p) => ({
        id: p.id,
        shopName: p.shop_name,
        level: p.level,
        amount: p.amount,
        status: p.status,
        createdAt: p.created_at,
        paidAt: p.paid_at
      }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load your earnings summary." });
  }
});

router.get("/downline", requireAuth, async (req, res) => {
  try {
    var users = await db.all("SELECT * FROM users WHERE referred_by_id = $1 ORDER BY created_at DESC", [req.userId]);

    var downline = [];
    for (var i = 0; i < users.length; i++) {
      var u = users[i];
      var shops = await db.all("SELECT status FROM shops WHERE agent_id = $1", [u.id]);
      downline.push({
        id: u.id,
        name: u.name,
        phone: u.phone,
        createdAt: u.created_at,
        shopsPaid: shops.filter((s) => s.status === "paid").length,
        shopsTotal: shops.length
      });
    }

    res.json({ downline });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load your network." });
  }
});

module.exports = router;
