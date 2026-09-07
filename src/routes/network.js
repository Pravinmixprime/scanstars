const express = require("express");
const db = require("../db");
const { requireAuth } = require("../auth");

const router = express.Router();

router.get("/summary", requireAuth, (req, res) => {
  var payouts = db.prepare(
    `SELECT p.*, s.shop_name FROM payouts p JOIN shops s ON s.id = p.shop_id
     WHERE p.agent_id = ? ORDER BY p.created_at DESC`
  ).all(req.userId);

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
});

router.get("/downline", requireAuth, (req, res) => {
  var users = db.prepare("SELECT * FROM users WHERE referred_by_id = ? ORDER BY created_at DESC").all(req.userId);
  var shopCountStmt = db.prepare("SELECT status FROM shops WHERE agent_id = ?");

  res.json({
    downline: users.map((u) => {
      var shops = shopCountStmt.all(u.id);
      return {
        id: u.id,
        name: u.name,
        phone: u.phone,
        createdAt: u.created_at,
        shopsPaid: shops.filter((s) => s.status === "paid").length,
        shopsTotal: shops.length
      };
    })
  });
});

module.exports = router;
