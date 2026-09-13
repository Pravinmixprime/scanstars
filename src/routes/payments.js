const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const { requireAuth } = require("../auth");
const { settleShopPayment } = require("../lib/commission");

const router = express.Router();

// Called by the frontend right after Razorpay Checkout reports success.
// This is a UX shortcut, NOT the source of truth — a browser that closes
// before this fires still gets settled by the webhook (src/routes/webhook.js).
// Verifying the signature here stops a forged "it worked" call from the
// client alone.
router.post("/verify", requireAuth, async (req, res) => {
  try {
    var body = req.body || {};
    var orderId = body.razorpay_order_id;
    var paymentId = body.razorpay_payment_id;
    var signature = body.razorpay_signature;
    if (!orderId || !paymentId || !signature) {
      return res.status(400).json({ error: "Missing payment confirmation fields." });
    }

    var secret = process.env.RAZORPAY_KEY_SECRET;
    var expected = crypto.createHmac("sha256", secret).update(orderId + "|" + paymentId).digest("hex");
    if (expected !== signature) {
      return res.status(400).json({ error: "Payment signature did not match." });
    }

    var shop = await db.get("SELECT * FROM shops WHERE razorpay_order_id = $1", [orderId]);
    if (!shop) return res.status(404).json({ error: "No matching shop for this order." });
    if (shop.agent_id !== req.userId) return res.status(403).json({ error: "Not your shop." });

    var updated = await settleShopPayment(shop.id, { razorpayPaymentId: paymentId });
    res.json({ shop: { id: updated.id, status: updated.status } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not verify payment." });
  }
});

module.exports = router;
