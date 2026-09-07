const QRCode = require("qrcode");

// Returns a PNG buffer encoding `text`, sized for on-screen + reasonable
// print use. Error correction M is a good balance of density vs.
// scan-reliability for a URL-length payload.
async function generateQrPng(text) {
  return QRCode.toBuffer(text, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 2,
    scale: 10,
    color: { dark: "#202124", light: "#ffffffff" }
  });
}

module.exports = { generateQrPng };
