(function () {
  "use strict";

  var STAR_PATH = "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z";
  var session = null; // { id, name, phone, role, referralCode, referredById } — null until /api/auth/me resolves

  // ---------------------------------------------------------------------
  // API helper
  // ---------------------------------------------------------------------
  async function api(method, path, body) {
    var res = await fetch("/api" + path, {
      method: method,
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    var data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) throw new Error((data && data.error) || "Something went wrong.");
    return data;
  }

  // ---------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  }); }
  function money(n) { return "₹" + Number(n || 0).toLocaleString("en-IN"); }
  function fmtDate(iso) { if (!iso) return "—"; return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }
  function starIcon(size, color) { return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '"><path d="' + STAR_PATH + '" fill="' + (color || "#FBBC05") + '"></path></svg>'; }
  function starsRow(size) { size = size || 22; var one = starIcon(size, "#FBBC05"); return '<div class="row gap-8" style="justify-content:center">' + one + one + one + one + one + '</div>'; }
  function go(path) { location.hash = path; }

  // ---------------------------------------------------------------------
  // Router
  // ---------------------------------------------------------------------
  function parseHash() {
    var raw = location.hash.replace(/^#/, "") || "/";
    var qIdx = raw.indexOf("?");
    var path = qIdx === -1 ? raw : raw.slice(0, qIdx);
    var query = {};
    if (qIdx !== -1) {
      raw.slice(qIdx + 1).split("&").forEach(function (pair) {
        if (!pair) return;
        var kv = pair.split("=");
        query[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || "");
      });
    }
    return { path: path, query: query };
  }

  // ---------------------------------------------------------------------
  // Shell chrome
  // ---------------------------------------------------------------------
  function publicNav() {
    return (
      '<div class="pub-nav"><div class="container">' +
        '<div class="brand"><div class="brand-mark">' + starIcon(16, "#fff") + '</div>ScanStars</div>' +
        '<div class="row gap-12">' +
          '<a href="#/login" class="btn btn-ghost btn-sm">Log in</a>' +
          '<a href="#/register" class="btn btn-primary btn-sm">Become a partner</a>' +
        '</div>' +
      '</div></div>'
    );
  }

  function menuIcon() {
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
  }

  function sidebarNav(active) {
    var items = [
      { key: "overview", path: "#/app", label: "Overview" },
      { key: "shops", path: "#/app/shops", label: "My shops" },
      { key: "network", path: "#/app/network", label: "My network" }
    ];
    var adminItems = [
      { key: "a-transactions", path: "#/admin/transactions", label: "Transactions" },
      { key: "a-payouts", path: "#/admin/payouts", label: "Payouts" },
      { key: "a-bulk", path: "#/admin/bulk-grants", label: "Bulk QR credits" },
      { key: "a-settings", path: "#/admin/settings", label: "Commission settings" }
    ];
    var html = '<div class="sidebar" id="app-sidebar"><div class="brand"><div class="brand-mark">' + starIcon(16, "#fff") + '</div>ScanStars</div>';
    html += '<div class="stack gap-4">';
    items.forEach(function (it) { html += '<a class="nav-link' + (active === it.key ? " active" : "") + '" href="' + it.path + '">' + esc(it.label) + '</a>'; });
    html += '<a class="nav-link btn-primary" style="margin-top:10px;color:var(--accent-contrast);background:var(--accent);justify-content:center" href="#/app/add-shop">+ Add shop</a>';
    html += '</div>';
    if (session && session.role === "admin") {
      html += '<div class="nav-section-label">Admin</div><div class="stack gap-4">';
      adminItems.forEach(function (it) { html += '<a class="nav-link' + (active === it.key ? " active" : "") + '" href="' + it.path + '">' + esc(it.label) + '</a>'; });
      html += '</div>';
    }
    html += '<div class="sidebar-foot stack gap-4">';
    html += '<div style="font-weight:600">' + esc(session.name) + '</div>';
    html += '<div class="muted" style="font-size:12.5px">' + (session.role === "admin" ? "Administrator" : "Partner · " + session.phone) + '</div>';
    html += '<a href="#/" data-action="logout" class="btn btn-ghost btn-sm" style="margin-top:6px">Log out</a>';
    html += '</div></div>';
    return html;
  }

  function appShell(active, title, contentHtml) {
    return '<div class="app-shell">' +
      '<div class="sidebar-backdrop" id="app-sidebar-backdrop" data-action="close-sidebar"></div>' +
      sidebarNav(active) +
      '<div class="main"><div class="topbar">' +
        '<button class="menu-btn" type="button" data-action="toggle-sidebar" aria-label="Open menu">' + menuIcon() + '</button>' +
        '<h1>' + esc(title) + '</h1>' +
      '</div><div class="content">' + contentHtml + '</div></div></div>';
  }

  function centeredMsg(text) { return '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;color:var(--text-muted)">' + esc(text) + '</div>'; }

  function tile(label, value) { return '<div class="card tile"><div class="label">' + esc(label) + '</div><div class="value">' + esc(value) + '</div></div>'; }

  function statusPill(status) {
    if (status === "paid") return '<span class="pill pill-success">Paid</span>';
    if (status === "payable") return '<span class="pill pill-warning">Payable</span>';
    if (status === "pending") return '<span class="pill pill-muted">Awaiting payment</span>';
    return '<span class="pill pill-muted">' + esc(status) + '</span>';
  }

  function shopsTable(shops) {
    if (!shops.length) return '<div class="card table-wrap"><table><tbody><tr class="empty-row"><td>No shops yet — add your first one to get started.</td></tr></tbody></table></div>';
    var rows = shops.map(function (s) {
      var action = s.status === "pending"
        ? '<a class="btn btn-primary btn-sm" href="#/app/pay/' + s.id + '">Collect payment</a>'
        : '<a class="btn btn-ghost btn-sm" href="#/app/success/' + s.id + '">View QR</a>';
      return '<tr><td>' + esc(s.shopName) + '</td><td class="mono">' + esc(s.ownerPhone) + '</td><td>' + statusPill(s.status) + '</td><td class="mono">' + fmtDate(s.createdAt) + '</td><td>' + action + '</td></tr>';
    }).join("");
    return '<div class="card table-wrap"><table><thead><tr><th>Shop</th><th>Owner phone</th><th>Status</th><th>Added</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  // ---------------------------------------------------------------------
  // Views: public
  // ---------------------------------------------------------------------
  function viewLanding() {
    return publicNav() + '<div class="container">' +
      '<div class="hero"><h1>Turn every walk-in into a Google review — and every sign-up into income.</h1>' +
      '<p class="lead">ScanStars partners set up a scan-to-review QR code for local shops. Each shop pays a one-time ₹499 setup fee; you earn a commission the moment it’s paid — no cap on how many shops you sign up.</p>' +
      '<div class="cta-row"><a href="#/register" class="btn btn-primary">Become a partner — it’s free</a><a href="#/login" class="btn btn-ghost">I already have an account</a></div></div>' +
      '<div class="steps">' +
        '<div class="card step-card"><div class="step-num">STEP 1</div><h3>Register free</h3><p>No cost to join. You get your own referral link the moment you sign up.</p></div>' +
        '<div class="card step-card"><div class="step-num">STEP 2</div><h3>Sign up shops</h3><p>Add a shop’s name and their Google review link. We generate their scan card.</p></div>' +
        '<div class="card step-card"><div class="step-num">STEP 3</div><h3>Earn when they pay</h3><p>Once the shop pays the ₹499 setup fee, your commission is confirmed — automatically.</p></div>' +
      '</div>' +
      '<div class="trust-note">Every review is written by the shop’s own customer, directly on Google — the QR code only opens Google’s official review page. Nothing is auto-posted or faked.</div>' +
      '</div><div class="pub-footer"><div class="container">ScanStars Partners</div></div>';
  }

  function viewRegister(query) {
    var refCode = (query.ref || "").toUpperCase();
    return publicNav() + '<div class="auth-wrap"><div class="card auth-card">' +
      '<h2>Become a partner</h2><div class="sub">Free to join. Start earning as soon as your first shop pays.</div>' +
      '<div id="form-msg"></div>' +
      '<form data-form="register">' +
        '<div class="field"><label>Full name</label><input name="name" required></div>' +
        '<div class="field"><label>Phone number</label><input name="phone" inputmode="numeric" placeholder="10-digit mobile number" required></div>' +
        '<div class="field"><label>Email (optional)</label><input name="email" type="email"></div>' +
        '<div class="field"><label>Password</label><input name="password" type="password" minlength="6" required></div>' +
        '<div class="field"><label>Referral code (optional)</label><input name="refCode" value="' + esc(refCode) + '" placeholder="e.g. AB12CD" style="text-transform:uppercase"></div>' +
        '<button class="btn btn-primary btn-block" type="submit">Create account</button>' +
      '</form>' +
      '<div class="muted" style="margin-top:16px;font-size:13px;text-align:center">Already a partner? <a href="#/login">Log in</a></div>' +
      '</div></div>';
  }

  function viewLogin() {
    return publicNav() + '<div class="auth-wrap"><div class="card auth-card">' +
      '<h2>Log in</h2><div class="sub">Welcome back to your partner dashboard.</div>' +
      '<div id="form-msg"></div>' +
      '<form data-form="login">' +
        '<div class="field"><label>Phone number</label><input name="phone" required></div>' +
        '<div class="field"><label>Password</label><input name="password" type="password" required></div>' +
        '<button class="btn btn-primary btn-block" type="submit">Log in</button>' +
      '</form>' +
      '<div class="muted" style="margin-top:16px;font-size:13px;text-align:center">New here? <a href="#/register">Become a partner</a></div>' +
      '</div></div>';
  }

  // ---------------------------------------------------------------------
  // Views: agent app
  // ---------------------------------------------------------------------
  async function viewOverview() {
    var shopsData = await api("GET", "/shops");
    var summary = await api("GET", "/network/summary");
    var shops = shopsData.shops;
    var paidShops = shops.filter(function (s) { return s.status === "paid"; });
    var link = location.origin + "/#/register?ref=" + session.referralCode;

    var html = '<div class="tiles">' +
      tile("Shops signed up", shops.length) +
      tile("Shops paid & live", paidShops.length) +
      tile("Payable now", money(summary.payable)) +
      tile("Paid out to date", money(summary.paidOut)) +
      '</div>';

    if (session.bulkCredits > 0) {
      html += '<div class="card" style="padding:16px 22px;margin-bottom:24px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">' +
        '<div><div style="font-weight:600">' + session.bulkCredits + ' prepaid QR ' + (session.bulkCredits === 1 ? "credit" : "credits") + ' remaining</div>' +
        '<div class="muted" style="font-size:12.5px;margin-top:2px">Add a shop below and it goes live instantly — no payment step, since these were already paid for in bulk.</div></div>' +
        '<a href="#/app/add-shop" class="btn btn-primary btn-sm">Use a credit</a></div>';
    }

    html += '<div class="card" style="padding:20px 22px;margin-bottom:24px">' +
      '<div style="font-weight:600;margin-bottom:10px">Your referral link</div>' +
      '<div class="refbox"><span class="code" style="flex:1;overflow-x:auto">' + esc(link) + '</span>' +
      '<button class="btn btn-ghost btn-sm" data-action="copy-link" data-link="' + esc(link) + '">Copy</button></div>' +
      '<div class="muted" style="font-size:12.5px;margin-top:10px">Share this with people you want as sub-partners. When their shops get paid, you earn an override automatically.</div>' +
      '</div>';

    html += '<div style="font-weight:600;margin-bottom:10px">Recent shops</div>' + shopsTable(shops.slice(0, 5));
    return appShell("overview", "Overview", html);
  }

  async function viewMyShops() {
    var data = await api("GET", "/shops");
    var html = '<div class="row gap-16" style="justify-content:space-between;align-items:center;margin-bottom:16px">' +
      '<div class="muted">' + data.shops.length + ' shop' + (data.shops.length === 1 ? "" : "s") + ' total</div>' +
      '<a href="#/app/add-shop" class="btn btn-primary btn-sm">+ Add shop</a></div>' +
      shopsTable(data.shops);
    return appShell("shops", "My shops", html);
  }

  async function viewMyNetwork() {
    var downlineData = await api("GET", "/network/downline");
    var summary = await api("GET", "/network/summary");
    var l2Total = summary.payouts.filter(function (p) { return p.level === 2; }).reduce(function (a, p) { return a + p.amount; }, 0);
    var downline = downlineData.downline;

    var html = '<div class="tiles tiles-2">' + tile("Sub-partners", downline.length) + tile("Override earned", money(l2Total)) + '</div>';

    if (!downline.length) {
      html += '<div class="card muted" style="padding:32px;text-align:center">No sub-partners yet. Share your referral link from the Overview page to start building your network.</div>';
    } else {
      var rows = downline.map(function (u) {
        return '<tr><td>' + esc(u.name) + '</td><td class="mono">' + esc(u.phone) + '</td><td>' + u.shopsPaid + ' / ' + u.shopsTotal + '</td><td class="mono">' + fmtDate(u.createdAt) + '</td></tr>';
      }).join("");
      html += '<div class="card table-wrap"><table><thead><tr><th>Name</th><th>Phone</th><th>Shops paid / total</th><th>Joined</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }
    return appShell("network", "My network", html);
  }

  function viewAddShop() {
    var hasCredit = session.bulkCredits > 0;
    var html = '<div class="card" style="max-width:480px;padding:26px">';
    if (hasCredit) {
      html += '<div class="form-ok">This will use one of your ' + session.bulkCredits + ' prepaid QR credits — the shop goes live immediately, no payment needed.</div>';
    }
    html += '<div id="form-msg"></div>' +
      '<form data-form="add-shop">' +
        '<div class="field"><label>Shop name</label><input name="shopName" required></div>' +
        '<div class="field"><label>Shop owner’s phone</label><input name="ownerPhone" inputmode="numeric" required></div>' +
        '<div class="field"><label>Google review link</label><input name="reviewLink" placeholder="https://g.page/r/.../review" required>' +
          '<div class="muted" style="font-size:12px;margin-top:6px">The exact link that opens this shop’s Google review composer.</div></div>' +
        '<button class="btn btn-primary btn-block" type="submit">' + (hasCredit ? "Create QR code" : "Continue to payment") + '</button>' +
      '</form></div>';
    return appShell("shops", "Add a shop", html);
  }

  async function viewPay(shopId) {
    var data;
    try { data = await api("GET", "/shops/" + shopId); } catch (e) { return appShell("shops", "Not found", '<div class="muted">Shop not found.</div>'); }
    var shop = data.shop;
    if (shop.status === "paid") { go("/app/success/" + shopId); return ""; }

    var html = '<div class="card" style="max-width:440px;padding:0;overflow:hidden">' +
      '<div class="brand-stripe"><div style="background:#4285F4"></div><div style="background:#EA4335"></div><div style="background:#FBBC05"></div><div style="background:#34A853"></div></div>' +
      '<div style="padding:26px">' +
        '<div class="muted" style="font-size:12.5px;text-transform:uppercase;letter-spacing:.06em;font-weight:600">Setup fee</div>' +
        '<div style="font-size:34px;font-weight:800;font-family:\'Sora\',sans-serif;margin-top:4px">' + money(shop.amount) + '</div>' +
        '<div class="muted" style="margin-top:6px">for <strong style="color:var(--text)">' + esc(shop.shopName) + '</strong></div>' +
        '<div id="pay-msg"></div>' +
        '<button class="btn btn-primary btn-block" style="margin-top:20px" data-action="pay" data-shop="' + shop.id + '">Pay ' + money(shop.amount) + '</button>' +
      '</div></div>';
    return appShell("shops", "Collect payment", html);
  }

  async function viewSuccess(shopId) {
    var data;
    try { data = await api("GET", "/shops/" + shopId); } catch (e) { return appShell("shops", "Not found", '<div class="muted">Shop not found.</div>'); }
    var shop = data.shop;
    var qrUrl = "/api/shops/" + shopId + "/qr.png";

    var html = '<div class="row gap-24" style="align-items:flex-start;flex-wrap:wrap">' +
      '<div class="qr-card-preview">' +
        '<div class="stripe"><div style="background:#4285F4"></div><div style="background:#EA4335"></div><div style="background:#FBBC05"></div><div style="background:#34A853"></div></div>' +
        '<div class="body-p">' +
          '<div class="shop">' + esc(shop.shopName) + '</div>' +
          '<div class="badge">Google Reviews</div>' +
          '<div class="headline">Scan &amp; Review Us</div>' +
          starsRow(18) +
          '<div class="frame">' +
            '<div class="bracket" style="top:0;left:0;border-top:4px solid #4285F4;border-left:4px solid #4285F4"></div>' +
            '<div class="bracket" style="top:0;right:0;border-top:4px solid #EA4335;border-right:4px solid #EA4335"></div>' +
            '<div class="bracket" style="bottom:0;left:0;border-bottom:4px solid #34A853;border-left:4px solid #34A853"></div>' +
            '<div class="bracket" style="bottom:0;right:0;border-bottom:4px solid #FBBC05;border-right:4px solid #FBBC05"></div>' +
            '<img src="' + qrUrl + '" alt="QR code">' +
          '</div>' +
          '<div class="caption">Scan to leave us a review on Google</div>' +
        '</div>' +
      '</div>' +
      '<div class="card stack gap-16" style="flex:1;min-width:260px;padding:24px">' +
        '<div class="pill pill-success" style="width:fit-content">Paid &amp; live</div>' +
        '<div><div class="muted" style="font-size:12.5px;text-transform:uppercase;font-weight:600">Review link</div><div class="mono" style="word-break:break-all;margin-top:4px">' + esc(shop.reviewLink) + '</div></div>' +
        '<a class="btn btn-primary" href="' + qrUrl + '" download="' + esc(shop.shopName.replace(/[^\w\-]+/g, "_")) + '_qr.png">Download QR (PNG)</a>' +
        '<a href="#/app/shops" class="btn btn-ghost">Back to my shops</a>' +
      '</div></div>';
    return appShell("shops", "Shop live", html);
  }

  // ---------------------------------------------------------------------
  // Views: admin
  // ---------------------------------------------------------------------
  async function viewAdminTransactions() {
    var data = await api("GET", "/admin/shops");
    var shops = data.shops;
    var directPaid = shops.filter(function (s) { return s.status === "paid" && s.paidVia !== "bulk_credit"; });
    var bulkPaid = shops.filter(function (s) { return s.status === "paid" && s.paidVia === "bulk_credit"; });
    var totalRevenue = directPaid.reduce(function (a, s) { return a + s.amount; }, 0);
    var html = '<div class="tiles">' +
      tile("Total shops", shops.length) +
      tile("Paid & live", directPaid.length + bulkPaid.length) +
      tile("Direct revenue", money(totalRevenue)) +
      tile("From bulk credits", bulkPaid.length) + '</div>';
    if (!shops.length) {
      html += '<div class="card muted" style="padding:32px;text-align:center">No transactions yet.</div>';
    } else {
      var rows = shops.map(function (s) {
        var via = s.paidVia === "bulk_credit" ? '<span class="pill pill-muted">Bulk credit</span>' : (s.status === "paid" ? '<span class="pill pill-muted">Razorpay</span>' : "—");
        return '<tr><td>' + esc(s.shopName) + '</td><td class="mono">' + esc(s.agentPhone) + '</td><td class="mono">' + money(s.amount) + '</td><td>' + statusPill(s.status) + '</td><td>' + via + '</td><td class="mono">' + fmtDate(s.paidAt || s.createdAt) + '</td></tr>';
      }).join("");
      html += '<div class="card table-wrap"><table><thead><tr><th>Shop</th><th>Agent</th><th>Amount</th><th>Status</th><th>Via</th><th>Date</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }
    html += '<div class="muted" style="font-size:12.5px;margin-top:14px">Bulk-credit shops don’t count toward direct revenue — that money was already collected up front (see Bulk QR credits).</div>';
    return appShell("a-transactions", "Transactions", html);
  }

  async function viewAdminPayouts() {
    var data = await api("GET", "/admin/payouts");
    var payouts = data.payouts;
    var payable = payouts.filter(function (p) { return p.status === "payable"; });
    var paid = payouts.filter(function (p) { return p.status === "paid"; });
    var html = '<div class="tiles tiles-3">' +
      tile("Payable now", money(payable.reduce(function (a, p) { return a + p.amount; }, 0))) +
      tile("Paid out", money(paid.reduce(function (a, p) { return a + p.amount; }, 0))) +
      tile("Total commission entries", payouts.length) + '</div>';
    if (!payouts.length) {
      html += '<div class="card muted" style="padding:32px;text-align:center">No commission entries yet.</div>';
    } else {
      var rows = payouts.map(function (p) {
        var action = p.status === "payable"
          ? '<button class="btn btn-primary btn-sm" data-action="mark-paid" data-id="' + p.id + '">Mark paid</button>'
          : '<span class="muted" style="font-size:12.5px">Paid ' + fmtDate(p.paidAt) + '</span>';
        return '<tr><td class="mono">' + esc(p.agentPhone) + '</td><td>' + esc(p.shopName) + '</td><td>L' + p.level + '</td><td class="mono">' + money(p.amount) + '</td><td>' + statusPill(p.status) + '</td><td>' + action + '</td></tr>';
      }).join("");
      html += '<div class="card table-wrap"><table><thead><tr><th>Agent</th><th>Shop</th><th>Level</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }
    html += '<div class="muted" style="font-size:12.5px;margin-top:14px">“Mark paid” only records that your team sent the money (by UPI/bank transfer outside this app) — it does not move any funds itself.</div>';
    return appShell("a-payouts", "Payouts", html);
  }

  async function viewAdminBulkGrants() {
    var data = await api("GET", "/admin/bulk-grants");
    var grants = data.grants;
    var totalUnits = grants.reduce(function (a, g) { return a + g.quantity; }, 0);
    var totalRevenue = grants.reduce(function (a, g) { return a + g.totalAmount; }, 0);

    var html = '<div class="card" style="max-width:480px;padding:26px;margin-bottom:24px">' +
      '<div style="font-weight:600;margin-bottom:4px">Grant bulk QR credits</div>' +
      '<div class="muted" style="font-size:12.5px;margin-bottom:16px">After you\'ve settled a bulk deal with a buyer outside the app (bank transfer, UPI, etc.), credit their account here. They must already have a free account on this site.</div>' +
      '<div id="form-msg"></div>' +
      '<form data-form="bulk-grant">' +
        '<div class="field"><label>Buyer’s phone number</label><input name="phone" inputmode="numeric" required></div>' +
        '<div class="field"><label>Quantity (number of QR codes)</label><input name="quantity" type="number" min="1" step="1" required></div>' +
        '<div class="field"><label>Price agreed per QR (₹)</label><input name="unitPrice" type="number" min="0" required></div>' +
        '<div class="field"><label>Note (optional)</label><input name="note" placeholder="e.g. paid via UPI, ref #1234"></div>' +
        '<button class="btn btn-primary btn-block" type="submit">Grant credits</button>' +
      '</form></div>';

    html += '<div class="tiles tiles-2">' +
      tile("QR codes granted (all time)", totalUnits) + tile("Bulk revenue collected", money(totalRevenue)) + '</div>';

    if (!grants.length) {
      html += '<div class="card muted" style="padding:32px;text-align:center">No bulk deals recorded yet.</div>';
    } else {
      var rows = grants.map(function (g) {
        return '<tr><td>' + esc(g.buyerName) + '</td><td class="mono">' + esc(g.buyerPhone) + '</td><td class="mono">' + g.quantity + '</td><td class="mono">' + money(g.unitPrice) + '</td><td class="mono">' + money(g.totalAmount) + '</td><td>' + esc(g.note || "—") + '</td><td class="mono">' + fmtDate(g.createdAt) + '</td></tr>';
      }).join("");
      html += '<div class="card table-wrap"><table><thead><tr><th>Buyer</th><th>Phone</th><th>Qty</th><th>Unit price</th><th>Total</th><th>Note</th><th>Date</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }
    return appShell("a-bulk", "Bulk QR credits", html);
  }

  async function viewAdminSettings() {
    var data = await api("GET", "/admin/config");
    var cfg = data.config;
    var html = '<div class="card" style="max-width:420px;padding:26px">' +
      '<div id="form-msg"></div>' +
      '<form data-form="settings">' +
        '<div class="field"><label>Shop setup fee (₹)</label><input name="totalAmount" type="number" min="0" value="' + cfg.totalAmount + '" required></div>' +
        '<div class="field"><label>Level 1 commission — the signing agent (₹)</label><input name="l1Amount" type="number" min="0" value="' + cfg.l1Amount + '" required></div>' +
        '<div class="field"><label>Level 2 override — their referrer (₹)</label><input name="l2Amount" type="number" min="0" value="' + cfg.l2Amount + '" required></div>' +
        '<div class="muted" style="font-size:12.5px;margin-bottom:16px">Company keeps the remainder of the setup fee after both commissions.</div>' +
        '<button class="btn btn-primary btn-block" type="submit">Save settings</button>' +
      '</form></div>';
    return appShell("a-settings", "Commission settings", html);
  }

  // ---------------------------------------------------------------------
  // Render loop
  // ---------------------------------------------------------------------
  var renderToken = 0;
  async function render() {
    var myToken = ++renderToken;
    var app = document.getElementById("app");
    var r = parseHash();
    var path = r.path;
    var needsAuth = path.indexOf("/app") === 0 || path.indexOf("/admin") === 0;

    if (needsAuth && !session) { go("/login"); return; }
    if (path.indexOf("/admin") === 0 && (!session || session.role !== "admin")) { go("/app"); return; }

    var html = "";
    try {
      if (path === "/") html = viewLanding();
      else if (path === "/register") html = viewRegister(r.query);
      else if (path === "/login") html = viewLogin();
      else if (path === "/app") html = await viewOverview();
      else if (path === "/app/shops") html = await viewMyShops();
      else if (path === "/app/network") html = await viewMyNetwork();
      else if (path === "/app/add-shop") html = viewAddShop();
      else if (path.indexOf("/app/pay/") === 0) html = await viewPay(path.slice(9));
      else if (path.indexOf("/app/success/") === 0) html = await viewSuccess(path.slice(13));
      else if (path === "/admin" || path === "/admin/transactions") html = await viewAdminTransactions();
      else if (path === "/admin/payouts") html = await viewAdminPayouts();
      else if (path === "/admin/bulk-grants") html = await viewAdminBulkGrants();
      else if (path === "/admin/settings") html = await viewAdminSettings();
      else html = viewLanding();
    } catch (e) {
      html = centeredMsg(e && e.message ? e.message : "Something went wrong loading this page.");
      console.error(e);
    }

    if (myToken !== renderToken) return;
    if (html) app.innerHTML = html;
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------------
  // Event delegation
  // ---------------------------------------------------------------------
  function showMsg(text, kind, targetId) {
    var box = document.getElementById(targetId || "form-msg");
    if (!box) return;
    box.innerHTML = '<div class="' + (kind === "ok" ? "form-ok" : "form-err") + '">' + esc(text) + '</div>';
  }

  document.addEventListener("submit", async function (e) {
    var form = e.target.closest("form[data-form]");
    if (!form) return;
    e.preventDefault();
    var kind = form.getAttribute("data-form");
    var fd = new FormData(form);
    var btn = form.querySelector("button[type=submit]");
    if (btn) btn.disabled = true;
    try {
      if (kind === "register") {
        var res = await api("POST", "/auth/register", {
          name: fd.get("name"), phone: fd.get("phone"), email: fd.get("email"),
          password: fd.get("password"), refCode: fd.get("refCode")
        });
        session = res.user;
        go("/app");
      } else if (kind === "login") {
        var res2 = await api("POST", "/auth/login", { phone: fd.get("phone"), password: fd.get("password") });
        session = res2.user;
        go(session.role === "admin" ? "/admin" : "/app");
      } else if (kind === "add-shop") {
        var res3 = await api("POST", "/shops", {
          shopName: fd.get("shopName"), ownerPhone: fd.get("ownerPhone"), reviewLink: fd.get("reviewLink")
        });
        if (res3.usedCredit) {
          session.bulkCredits = Math.max(0, (session.bulkCredits || 0) - 1);
          go("/app/success/" + res3.shop.id);
        } else {
          go("/app/pay/" + res3.shop.id);
        }
      } else if (kind === "settings") {
        await api("PUT", "/admin/config", {
          totalAmount: Number(fd.get("totalAmount")), l1Amount: Number(fd.get("l1Amount")), l2Amount: Number(fd.get("l2Amount"))
        });
        showMsg("Saved.", "ok");
      } else if (kind === "bulk-grant") {
        await api("POST", "/admin/bulk-grants", {
          phone: fd.get("phone"), quantity: Number(fd.get("quantity")), unitPrice: Number(fd.get("unitPrice")), note: fd.get("note")
        });
        form.reset();
        render();
      }
    } catch (err) {
      showMsg(err.message, "err");
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.addEventListener("click", async function (e) {
    var t = e.target.closest("[data-action]");
    if (!t) return;
    var action = t.getAttribute("data-action");

    if (action === "toggle-sidebar") {
      e.preventDefault();
      var sbEl = document.getElementById("app-sidebar");
      var bdEl = document.getElementById("app-sidebar-backdrop");
      if (sbEl) sbEl.classList.toggle("open");
      if (bdEl) bdEl.classList.toggle("open");
    }
    if (action === "close-sidebar") {
      e.preventDefault();
      var sbEl2 = document.getElementById("app-sidebar");
      var bdEl2 = document.getElementById("app-sidebar-backdrop");
      if (sbEl2) sbEl2.classList.remove("open");
      if (bdEl2) bdEl2.classList.remove("open");
    }
    if (action === "logout") {
      e.preventDefault();
      try { await api("POST", "/auth/logout"); } catch (err) {}
      session = null;
      go("/");
    }
    if (action === "copy-link") {
      e.preventDefault();
      var link = t.getAttribute("data-link");
      try { await navigator.clipboard.writeText(link); t.textContent = "Copied!"; setTimeout(function () { t.textContent = "Copy"; }, 1500); }
      catch (err) { /* clipboard unavailable — ignore */ }
    }
    if (action === "mark-paid") {
      e.preventDefault();
      var id = t.getAttribute("data-id");
      t.disabled = true; t.textContent = "Saving…";
      try { await api("POST", "/admin/payouts/" + id + "/mark-paid", {}); render(); }
      catch (err) { t.disabled = false; t.textContent = "Mark paid"; }
    }
    if (action === "pay") {
      e.preventDefault();
      var shopId = t.getAttribute("data-shop");
      t.disabled = true; t.textContent = "Starting checkout…";
      try {
        var order = await api("POST", "/shops/" + shopId + "/create-order");
        if (typeof Razorpay === "undefined") {
          showMsg("Payment checkout script didn't load — check your connection and try again.", "err", "pay-msg");
          t.disabled = false; t.textContent = "Pay again";
          return;
        }
        var rzp = new Razorpay({
          key: order.keyId,
          amount: order.amount,
          currency: order.currency,
          order_id: order.orderId,
          name: "ScanStars Partners",
          description: "Shop setup fee",
          theme: { color: "#4285F4" },
          handler: async function (response) {
            try {
              await api("POST", "/payments/verify", response);
              go("/app/success/" + shopId);
            } catch (err) {
              showMsg("Payment succeeded but couldn't be confirmed automatically — it will finish shortly, or contact support.", "err", "pay-msg");
            }
          },
          modal: { ondismiss: function () { t.disabled = false; t.textContent = "Pay again"; } }
        });
        rzp.on("payment.failed", function () {
          showMsg("Payment failed — please try again.", "err", "pay-msg");
          t.disabled = false; t.textContent = "Pay again";
        });
        rzp.open();
      } catch (err) {
        showMsg(err.message, "err", "pay-msg");
        t.disabled = false; t.textContent = "Pay again";
      }
    }
  });

  window.addEventListener("hashchange", render);

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  (async function boot() {
    try {
      var res = await api("GET", "/auth/me");
      session = res.user;
    } catch (e) { session = null; }
    render();
  })();
})();
