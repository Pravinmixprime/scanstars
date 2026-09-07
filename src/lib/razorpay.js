const Razorpay = require("razorpay");

var instance = null;
var attempted = false;

// Lazily builds the Razorpay client. Returns null (rather than throwing) when
// keys aren't set yet, so the rest of the app can run and give a clear error
// only when someone actually tries to take a payment.
function getRazorpay() {
  if (attempted) return instance;
  attempted = true;
  var keyId = process.env.RAZORPAY_KEY_ID;
  var keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret || keyId.indexOf("xxxx") !== -1) return null;
  instance = new Razorpay({ key_id: keyId, key_secret: keySecret });
  return instance;
}

module.exports = { getRazorpay };
