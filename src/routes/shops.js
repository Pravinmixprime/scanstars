const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const { requireAuth } = require("../auth");
const { getConfig } = require("../lib/commission");
const { generateQrPng } = require("../lib/qr");
const { digits } = require("../lib/util");
const { getRazorpay } = require("../lib/razorpay");

const router = express.Router();

function serializeShop(s) {
  return {
    id: s.id,
    shopName: s.shop_name,
    ownerPhone: s.owner_phone,
    reviewLink: s.review_link,
    amount: s.amount,
    status: s.status,
    createdAt: s.created_at,
    paidAt: s.paid_at
  };
}

function loadOwnedShop(req, res, next) {
  var shop = db.prepare("SELECT * FROM shops WHERE id = ?").get(req.params.id);
  if (!shop) return res.status(404).json({ error: "Shop not found." });
  if (shop.agent_id !== req.userId && req.userRole !== "admin") {
    return res.status(404).json({ error: "Shop not found." });
  }
  req.shop = shop;
  next();
}

router.get("/", requireAuth, (req, res) => {
  var shops = db.prepare("SELECT * FROM shops WHERE agent_id = ? ORDER BY created_at DESC").all(req.userId);
  res.json({ shops: shops.map(serializeShop) });
});

router.post("/", requireAuth, (req, res) => {
  try {
    var body = req.body || {};
    var shopName = String(body.shopName || "").trim();
    var ownerPhone = digits(body.ownerPhone);
    var reviewLink = String(body.reviewLink || "").trim();

    if (!shopName) return res.status(400).json({ error: "Shop name is required." });
    if (!reviewLink.startsWith("http")) return res.status(400).json({ error: "Enter a valid review link." });

    var agent = db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId);
    var cfg = getConfig();
    var id = crypto.randomUUID();

    db.prepare(
      "INSERT INTO shops (id, shop_name, owner_phone, review_link, agent_id, agent_referrer_id, amount) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(id, shopName, ownerPhone, reviewLink, agent.id, agent.referred_by_id || null, cfg.totalAmount);

    var shop = db.prepare("SELECT * FROM shops WHERE id = ?").get(id);
    res.status(201).json({ shop: serializeShop(shop) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not add shop." });
  }
});

router.get("/:id", requireAuth, loadOwnedShop, (req, res) => {
  res.json({ shop: serializeShop(req.shop) });
});

router.post("/:id/create-order", requireAuth, loadOwnedShop, async (req, res) => {
  if (req.shop.status === "paid") return res.status(400).json({ error: "This shop is already paid up." });

  var razorpay = getRazorpay();
  if (!razorpay) {
    return res.status(503).json({
      error: "Payments aren't configured on this server yet. Add RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET to .env."
    });
  }

  try {
    var order = await razorpay.orders.create({
      amount: req.shop.amount * 100, // paise
      currency: "INR",
      receipt: req.shop.id,
      notes: { shopId: req.shop.id, agentId: req.shop.agent_id }
    });

    db.prepare("UPDATE shops SET razorpay_order_id = ? WHERE id = ?").run(order.id, req.shop.id);

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID
    });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Could not create payment order." });
  }
});

router.get("/:id/qr.png", requireAuth, loadOwnedShop, async (req, res) => {
  try {
    var buf = await generateQrPng(req.shop.review_link);
    res.set("Content-Type", "image/png");
    res.send(buf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not generate QR code." });
  }
});

module.exports = router;
