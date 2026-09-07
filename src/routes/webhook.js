// Razorpay's server-to-server webhook — the authoritative payment
// confirmation (independent of whether the customer's browser stayed open
// long enough for the client-side /api/payments/verify call to fire).
//
// This needs the RAW request body to check the signature, so it is mounted
// in src/index.js BEFORE the app-wide express.json() middleware, with its
// own express.raw() parser. Keeping it in a separate file (rather than
// alongside the other /api/payments routes) makes that ordering requirement
// impossible to lose track of later.
const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const { settleShopPayment } = require("../lib/commission");

const router = express.Router();

router.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  try {
    var secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    var signature = req.headers["x-razorpay-signature"];
    if (!secret || !signature) return res.status(400).send("Missing webhook signature.");

    var expected = crypto.createHmac("sha256", secret).update(req.body).digest("hex");
    if (expected !== signature) return res.status(400).send("Invalid signature.");

    var event = JSON.parse(req.body.toString("utf8"));
    if (event.event === "payment.captured" || event.event === "order.paid") {
      var orderId =
        (event.payload && event.payload.payment && event.payload.payment.entity && event.payload.payment.entity.order_id) ||
        (event.payload && event.payload.order && event.payload.order.entity && event.payload.order.entity.id);
      var paymentId =
        event.payload && event.payload.payment && event.payload.payment.entity && event.payload.payment.entity.id;

      if (orderId) {
        var shop = db.prepare("SELECT * FROM shops WHERE razorpay_order_id = ?").get(orderId);
        if (shop) settleShopPayment(shop.id, paymentId ? { razorpayPaymentId: paymentId } : {});
      }
    }

    res.status(200).send("ok");
  } catch (err) {
    console.error(err);
    // Razorpay retries on non-2xx — fail loudly so it retries rather than
    // silently swallowing a payment event.
    res.status(500).send("error");
  }
});

module.exports = router;
