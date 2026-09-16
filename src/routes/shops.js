const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const { requireAuth } = require("../auth");
const { getConfig } = require("../lib/commission");
const { generateQrPng } = require("../lib/qr");
const { digits } = require("../lib/util");
const { getRazorpay } = require("../lib/razorpay");

const router = express.Router();

// Only categories we actually have thought-starter prompts for on the
// public review page — anything else (including missing/old shops) falls
// back to the generic prompt set there.
var SHOP_CATEGORIES = ["restaurant", "salon", "retail", "services", "other"];

function serializeShop(s) {
  return {
    id: s.id,
    shopName: s.shop_name,
    ownerPhone: s.owner_phone,
    reviewLink: s.review_link,
    category: s.category,
    amount: s.amount,
    status: s.status,
    paidVia: s.paid_via,
    createdAt: s.created_at,
    paidAt: s.paid_at
  };
}

async function loadOwnedShop(req, res, next) {
  try {
    var shop = await db.get("SELECT * FROM shops WHERE id = $1", [req.params.id]);
    if (!shop) return res.status(404).json({ error: "Shop not found." });
    if (shop.agent_id !== req.userId && req.userRole !== "admin") {
      return res.status(404).json({ error: "Shop not found." });
    }
    req.shop = shop;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load shop." });
  }
}

router.get("/", requireAuth, async (req, res) => {
  try {
    var shops = await db.all("SELECT * FROM shops WHERE agent_id = $1 ORDER BY created_at DESC", [req.userId]);
    res.json({ shops: shops.map(serializeShop) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load shops." });
  }
});

router.post("/", requireAuth, async (req, res) => {
  try {
    var body = req.body || {};
    var shopName = String(body.shopName || "").trim();
    var ownerPhone = digits(body.ownerPhone);
    var reviewLink = String(body.reviewLink || "").trim();
    var category = String(body.category || "other").trim().toLowerCase();
    if (SHOP_CATEGORIES.indexOf(category) === -1) category = "other";

    if (!shopName) return res.status(400).json({ error: "Shop name is required." });
    if (!reviewLink.startsWith("http")) return res.status(400).json({ error: "Enter a valid review link." });

    var agent = await db.get("SELECT * FROM users WHERE id = $1", [req.userId]);
    var cfg = await getConfig();
    var id = crypto.randomUUID();

    // If this agent has prepaid bulk QR credits, spend one instead of
    // charging for this shop — the atomic conditional UPDATE means two
    // requests racing each other can't both spend the same last credit.
    var creditSpend = await db.run(
      "UPDATE users SET bulk_credits = bulk_credits - 1 WHERE id = $1 AND bulk_credits > 0",
      [agent.id]
    );
    var usedCredit = creditSpend.rowCount > 0;

    if (usedCredit) {
      await db.run(
        `INSERT INTO shops (id, shop_name, owner_phone, review_link, category, agent_id, agent_referrer_id, amount, status, paid_at, paid_via)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'paid', now(), 'bulk_credit')`,
        [id, shopName, ownerPhone, reviewLink, category, agent.id, agent.referred_by_id || null, cfg.totalAmount]
      );
    } else {
      await db.run(
        "INSERT INTO shops (id, shop_name, owner_phone, review_link, category, agent_id, agent_referrer_id, amount) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [id, shopName, ownerPhone, reviewLink, category, agent.id, agent.referred_by_id || null, cfg.totalAmount]
      );
    }

    var shop = await db.get("SELECT * FROM shops WHERE id = $1", [id]);
    res.status(201).json({ shop: serializeShop(shop), usedCredit: usedCredit });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not add shop." });
  }
});

router.get("/:id", requireAuth, loadOwnedShop, (req, res) => {
  res.json({ shop: serializeShop(req.shop) });
});

// Unauthenticated — this is what the customer-facing review-prompt page
// (public/#/r/:id, reached by scanning the QR code) calls to know the shop
// name, category and where the actual Google review composer link goes.
// Deliberately returns only what that page needs, nothing about the agent
// or payment status.
router.get("/:id/public", async (req, res) => {
  try {
    var shop = await db.get("SELECT shop_name, category, review_link FROM shops WHERE id = $1", [req.params.id]);
    if (!shop) return res.status(404).json({ error: "Not found." });
    res.json({ shop: { shopName: shop.shop_name, category: shop.category, reviewLink: shop.review_link } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load shop." });
  }
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

    await db.run("UPDATE shops SET razorpay_order_id = $1 WHERE id = $2", [order.id, req.shop.id]);

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
    // The QR encodes our own review-prompt page, not the raw Google link
    // directly — that page shows the customer a couple of thought-starter
    // prompts and then sends them into Google's real review composer to
    // write and submit their own review.
    var reviewPageUrl = req.protocol + "://" + req.get("host") + "/r/" + req.shop.id;
    var buf = await generateQrPng(reviewPageUrl);
    res.set("Content-Type", "image/png");
    res.send(buf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not generate QR code." });
  }
});

module.exports = router;
