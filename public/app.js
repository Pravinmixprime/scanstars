(function () {
  "use strict";

  var STAR_PATH = "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z";
  var session = null; // { id, name, phone, role, referralCode, referredById } — null until /api/auth/me resolves

  // Thought-starter prompts shown on the public review page (scanned via
  // QR). These are just conversation starters to help the customer think —
  // whichever one they tap, they land on the SAME real Google review link
  // and type their own words there. Nothing here is ever pre-filled or
  // auto-submitted; that would be fake-review content, which Google's
  // policies prohibit and can get a Business Profile suspended.
  // Each prompt has a "hint" — a nudge toward what to mention, never a
  // sentence to reuse. Shown only after the customer picks a prompt, so it
  // reads as encouragement to write more, not text to copy.
  var REVIEW_PROMPTS = {
    restaurant: [
      { q: "How was the food?", hint: "Mention a specific dish or drink you tried." },
      { q: "How was the service?", hint: "Was the staff quick, friendly, attentive?" },
      { q: "How was the ambience?", hint: "Think about the seating, music, or cleanliness." },
      { q: "What stood out the most?", hint: "A dish, a staff member, or a moment from your visit." },
      { q: "Would you recommend us to a friend?", hint: "Say who you'd recommend it for — family, dates, quick bites." }
    ],
    salon: [
      { q: "How was your service today?", hint: "Mention which service you got and how it turned out." },
      { q: "How friendly was our staff?", hint: "Anyone in particular who made your visit better?" },
      { q: "How was the hygiene & ambience?", hint: "Cleanliness, comfort, or the wait time." },
      { q: "Would you book with us again?", hint: "What would bring you back?" }
    ],
    retail: [
      { q: "Did you find what you were looking for?", hint: "Mention the product or section." },
      { q: "How helpful was our staff?", hint: "Anyone who helped you out?" },
      { q: "How was your shopping experience?", hint: "Store layout, checkout, variety." },
      { q: "Would you shop here again?", hint: "What would bring you back?" }
    ],
    services: [
      { q: "How was the quality of the work?", hint: "Mention the specific job or repair." },
      { q: "Were we on time and professional?", hint: "Punctuality, communication, or clean-up." },
      { q: "Would you use us again?", hint: "For what kind of job?" },
      { q: "How was your overall experience?", hint: "Anything that stood out, good or bad." }
    ],
    other: [
      { q: "How was your overall experience?", hint: "Be specific — what happened during your visit?" },
      { q: "What did you like most?", hint: "A product, a person, or a moment." },
      { q: "How was our service?", hint: "Speed, friendliness, or attention to detail." },
      { q: "Would you recommend us to others?", hint: "Who would you recommend us to?" }
    ]
  };

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
  function debounce(fn, ms) {
    var timer = null;
    return function () {
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(null, args); }, ms);
    };
  }

  // ---------------------------------------------------------------------
  // "Find it on Google" — live-as-you-type suggestions on the Add Shop form
  // ---------------------------------------------------------------------
  var placeSessionToken = null; // one random token per search "session" — keeps Google's billing to one unit per search instead of per keystroke
  function getPlaceSessionToken() {
    if (!placeSessionToken) {
      placeSessionToken = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random();
    }
    return placeSessionToken;
  }
  function renderPlaceResults(resultsBox, results, emptyMsg) {
    if (!results.length) {
      resultsBox.innerHTML = '<div class="muted" style="font-size:12.5px;margin-top:8px">' + esc(emptyMsg) + '</div>';
      return;
    }
    resultsBox.innerHTML = '<div class="place-result-list">' + results.map(function (r) {
      return '<button type="button" class="place-result-item" data-action="pick-place" data-placeid="' + esc(r.placeId) + '" data-name="' + esc(r.name) + '">' +
        '<div class="name">' + esc(r.name) + '</div>' +
        '<div class="addr">' + esc(r.address) + '</div>' +
      '</button>';
    }).join("") + '</div>';
  }
  var runLiveAutocomplete = debounce(async function (q, resultsBox) {
    if (q.length < 3) { resultsBox.innerHTML = ''; return; }
    try {
      var data = await api("GET", "/shops/place-autocomplete?q=" + encodeURIComponent(q) + "&sessiontoken=" + encodeURIComponent(getPlaceSessionToken()));
      // The box may have moved on (user navigated away, or cleared the
      // field) by the time this resolves — only render if it's still there.
      if (!document.getElementById("place-results")) return;
      renderPlaceResults(resultsBox, data.results || [], "No matches yet — keep typing, or use the exact link below.");
    } catch (err) {
      // Quietly do nothing on a live-typing error (e.g. not configured) —
      // the explicit Search button below still gives a clear message.
    }
  }, 350);

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
      { key: "network", path: "#/app/network", label: "My network" },
      { key: "account", path: "#/app/account", label: "My account" }
    ];
    var adminItems = [
      { key: "a-users", path: "#/admin/users", label: "Partners" },
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

  function viewAccount() {
    var html = '<div class="stack gap-24" style="max-width:480px">';

    html += '<div class="card" style="padding:26px">' +
      '<div style="font-weight:600;margin-bottom:16px">Profile</div>' +
      '<div id="profile-msg"></div>' +
      '<form data-form="account-profile">' +
        '<div class="field"><label>Full name</label><input name="name" value="' + esc(session.name) + '" required></div>' +
        '<div class="field"><label>Email (optional)</label><input name="email" type="email" value="' + esc(session.email || "") + '"></div>' +
        '<button class="btn btn-primary" type="submit">Save profile</button>' +
      '</form></div>';

    html += '<div class="card" style="padding:26px">' +
      '<div style="font-weight:600;margin-bottom:4px">Phone number</div>' +
      '<div class="muted" style="font-size:12.5px;margin-bottom:16px">Current: <span class="mono">' + esc(session.phone) + '</span> — this is what you log in with.</div>' +
      '<div id="phone-msg"></div>' +
      '<form data-form="account-phone">' +
        '<div class="field"><label>New phone number</label><input name="newPhone" inputmode="numeric" required></div>' +
        '<div class="field"><label>Current password (to confirm it’s you)</label><input name="currentPassword" type="password" required></div>' +
        '<button class="btn btn-primary" type="submit">Update phone number</button>' +
      '</form></div>';

    html += '<div class="card" style="padding:26px">' +
      '<div style="font-weight:600;margin-bottom:16px">Password</div>' +
      '<div id="password-msg"></div>' +
      '<form data-form="account-password">' +
        '<div class="field"><label>Current password</label><input name="currentPassword" type="password" required></div>' +
        '<div class="field"><label>New password</label><input name="newPassword" type="password" minlength="6" required></div>' +
        '<div class="field"><label>Confirm new password</label><input name="confirmPassword" type="password" minlength="6" required></div>' +
        '<button class="btn btn-primary" type="submit">Change password</button>' +
      '</form></div>';

    html += '</div>';
    return appShell("account", "My account", html);
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
        '<div class="field"><label>Business type</label><select name="category">' +
          '<option value="restaurant">Restaurant / Café</option>' +
          '<option value="salon">Salon / Spa / Wellness</option>' +
          '<option value="retail">Retail / Shop</option>' +
          '<option value="services">Services (repair, professional, etc.)</option>' +
          '<option value="other" selected>Other</option>' +
        '</select>' +
          '<div class="muted" style="font-size:12px;margin-top:6px">Used to show the customer relevant prompts before they write their Google review.</div></div>' +
        '<div class="field">' +
          '<label>Find it on Google</label>' +
          '<div class="row gap-8">' +
            '<input id="place-query" placeholder="Shop name, city" style="flex:1">' +
            '<button type="button" class="btn btn-ghost" data-action="search-place" style="flex-shrink:0">Search</button>' +
          '</div>' +
          '<div id="place-results"></div>' +
          '<div class="muted" style="font-size:12px;margin-top:6px">Finds the shop’s Google listing and fills in the review link below — no need to hunt for it yourself.</div>' +
        '</div>' +
        '<div class="field"><label>Google review link</label><input name="reviewLink" id="review-link-input" placeholder="https://g.page/r/.../review" required>' +
          '<div id="review-link-selected" class="muted" style="font-size:12px;margin-top:6px">The exact link that opens this shop’s Google review composer — search above, or paste it in yourself.</div></div>' +
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
        '<div><div class="muted" style="font-size:12.5px;text-transform:uppercase;font-weight:600">What the QR opens</div><div class="mono" style="word-break:break-all;margin-top:4px">' + esc(location.origin) + '/r/' + esc(shop.id) + '</div>' +
          '<div class="muted" style="font-size:12.5px;margin-top:6px">A short page with a few prompts, which then sends the customer to the Google review link below to write &amp; submit their own review.</div></div>' +
        '<div><div class="muted" style="font-size:12.5px;text-transform:uppercase;font-weight:600">Google review link</div><div class="mono" style="word-break:break-all;margin-top:4px">' + esc(shop.reviewLink) + '</div></div>' +
        '<a class="btn btn-primary" href="' + qrUrl + '" download="' + esc(shop.shopName.replace(/[^\w\-]+/g, "_")) + '_qr.png">Download QR (PNG)</a>' +
        '<a href="#/app/shops" class="btn btn-ghost">Back to my shops</a>' +
      '</div></div>';
    return appShell("shops", "Shop live", html);
  }

  // ---------------------------------------------------------------------
  // Public review-prompt page (reached by scanning a shop's QR code —
  // no login, not part of the hash router since it's a real path the QR
  // encodes: /r/:shopId).
  // ---------------------------------------------------------------------
  function reviewPageShell(inner) {
    return (
      '<div class="review-page">' +
        '<div class="review-page-inner">' + inner + '</div>' +
      '</div>'
    );
  }

  async function renderReviewPage(shopId) {
    var app = document.getElementById("app");
    var shop;
    try {
      var data = await api("GET", "/shops/" + shopId + "/public");
      shop = data.shop;
    } catch (e) {
      app.innerHTML = reviewPageShell(
        '<div class="card" style="padding:32px;text-align:center"><div class="muted">This review page couldn’t be found.</div></div>'
      );
      return;
    }

    var prompts = REVIEW_PROMPTS[shop.category] || REVIEW_PROMPTS.other;
    var chips = prompts.map(function (p, i) {
      return '<button type="button" class="prompt-chip" data-action="pick-prompt" data-idx="' + i + '" data-hint="' + esc(p.hint) + '">' + esc(p.q) + '</button>';
    }).join("");

    var html =
      '<div class="review-hero">' +
        '<div class="brand-mark" style="margin:0 auto 14px">' + starIcon(20, "#fff") + '</div>' +
        starsRow(26) +
        '<h1 style="margin-top:16px">Thanks for visiting<br>' + esc(shop.shopName) + '</h1>' +
        '<p class="muted" style="margin-top:10px">Tap whichever sounds most like your visit — then tell Google about it in your own words.</p>' +
      '</div>' +
      '<div class="card review-card">' +
        '<div class="prompt-list">' + chips + '</div>' +
        '<div id="review-cta" class="review-cta hidden">' +
          '<div id="review-hint" class="review-hint"></div>' +
          '<div class="muted" style="font-size:13.5px;margin-bottom:12px">Now share that on Google, in your own words — you&#39;ll write and post it yourself, on Google’s own page.</div>' +
          '<a class="btn btn-primary btn-block" href="' + esc(shop.reviewLink) + '" target="_blank" rel="noopener">Continue to Google Reviews</a>' +
        '</div>' +
      '</div>' +
      '<div class="review-foot muted">Powered by ScanStars</div>';

    app.innerHTML = reviewPageShell(html);
  }

  // ---------------------------------------------------------------------
  // Views: admin
  // ---------------------------------------------------------------------
  async function viewAdminUsers() {
    var data = await api("GET", "/admin/users");
    var users = data.users;
    var partners = users.filter(function (u) { return u.role !== "admin"; });
    var withCredits = partners.filter(function (u) { return u.bulkCredits > 0; });

    var html = '<div class="tiles tiles-3">' +
      tile("Registered partners", partners.length) +
      tile("With shops paid & live", partners.filter(function (u) { return u.shopsPaid > 0; }).length) +
      tile("Holding bulk credits", withCredits.length) + '</div>';

    if (!partners.length) {
      html += '<div class="card muted" style="padding:32px;text-align:center">No one has signed up yet.</div>';
    } else {
      var rows = partners.map(function (u) {
        var referredBy = u.referredByName ? esc(u.referredByName) + ' <span class="muted mono" style="font-size:12px">(' + esc(u.referredByPhone) + ')</span>' : '<span class="muted">—</span>';
        var credits = u.bulkCredits > 0 ? '<span class="pill pill-success">' + u.bulkCredits + '</span>' : '<span class="muted">0</span>';
        return '<tr><td>' + esc(u.name) + '</td><td class="mono">' + esc(u.phone) + '</td><td>' + esc(u.email || "—") + '</td><td>' + referredBy + '</td><td class="mono">' + u.shopsPaid + ' / ' + u.shopsTotal + '</td><td>' + credits + '</td><td class="mono">' + fmtDate(u.createdAt) + '</td></tr>';
      }).join("");
      html += '<div class="card table-wrap"><table><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Referred by</th><th>Shops paid/total</th><th>Bulk credits</th><th>Joined</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }
    return appShell("a-users", "Partners", html);
  }

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
      else if (path === "/app/account") html = viewAccount();
      else if (path === "/app/add-shop") html = viewAddShop();
      else if (path.indexOf("/app/pay/") === 0) html = await viewPay(path.slice(9));
      else if (path.indexOf("/app/success/") === 0) html = await viewSuccess(path.slice(13));
      else if (path === "/admin" || path === "/admin/users") html = await viewAdminUsers();
      else if (path === "/admin/transactions") html = await viewAdminTransactions();
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
    var msgTargets = { "account-profile": "profile-msg", "account-phone": "phone-msg", "account-password": "password-msg" };
    var msgTarget = msgTargets[kind];
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
          shopName: fd.get("shopName"), ownerPhone: fd.get("ownerPhone"), reviewLink: fd.get("reviewLink"), category: fd.get("category")
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
      } else if (kind === "account-profile") {
        var rp = await api("PUT", "/auth/profile", { name: fd.get("name"), email: fd.get("email") });
        session = rp.user;
        showMsg("Profile updated.", "ok", msgTarget);
      } else if (kind === "account-phone") {
        var rph = await api("PUT", "/auth/phone", { newPhone: fd.get("newPhone"), currentPassword: fd.get("currentPassword") });
        session = rph.user;
        form.reset();
        showMsg("Phone number updated — use your new number next time you log in.", "ok", msgTarget);
      } else if (kind === "account-password") {
        var newPw = fd.get("newPassword");
        var confirmPw = fd.get("confirmPassword");
        if (newPw !== confirmPw) throw new Error("New passwords don't match.");
        await api("PUT", "/auth/password", { currentPassword: fd.get("currentPassword"), newPassword: newPw });
        form.reset();
        showMsg("Password changed.", "ok", msgTarget);
      }
    } catch (err) {
      showMsg(err.message, "err", msgTarget);
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
    if (action === "pick-prompt") {
      e.preventDefault();
      var chips = document.querySelectorAll(".prompt-chip");
      for (var ci = 0; ci < chips.length; ci++) chips[ci].classList.remove("selected");
      t.classList.add("selected");
      var cta = document.getElementById("review-cta");
      if (cta) cta.classList.remove("hidden");
      var hintEl = document.getElementById("review-hint");
      var hintText = t.getAttribute("data-hint");
      if (hintEl) hintEl.innerHTML = hintText ? '<div class="review-hint-tip">Tip: ' + esc(hintText) + '</div>' : "";
    }
    if (action === "search-place") {
      e.preventDefault();
      var pqInput = document.getElementById("place-query");
      var resultsBox = document.getElementById("place-results");
      var q = ((pqInput && pqInput.value) || "").trim();
      if (!resultsBox) return;
      if (q.length < 3) {
        resultsBox.innerHTML = '<div class="muted" style="font-size:12.5px;margin-top:8px">Type at least a few characters.</div>';
        return;
      }
      var origText = t.textContent;
      t.disabled = true; t.textContent = "Searching…";
      resultsBox.innerHTML = '';
      try {
        var placeData = await api("GET", "/shops/place-search?q=" + encodeURIComponent(q));
        renderPlaceResults(resultsBox, placeData.results || [], "No matches — try a more specific search, or paste the link in yourself below.");
      } catch (err) {
        resultsBox.innerHTML = '<div class="form-err" style="margin-top:8px">' + esc(err.message) + '</div>';
      } finally {
        t.disabled = false; t.textContent = origText;
      }
    }
    if (action === "pick-place") {
      e.preventDefault();
      var placeId = t.getAttribute("data-placeid");
      var placeName = t.getAttribute("data-name");
      var linkInput = document.getElementById("review-link-input");
      if (linkInput) linkInput.value = "https://search.google.com/local/writereview?placeid=" + encodeURIComponent(placeId);
      var noteEl = document.getElementById("review-link-selected");
      if (noteEl) noteEl.innerHTML = 'Selected: <strong style="color:var(--text)">' + esc(placeName) + '</strong> — link filled in below. You can still edit it if needed.';
      var resultsBox2 = document.getElementById("place-results");
      if (resultsBox2) resultsBox2.innerHTML = '';
      placeSessionToken = null; // this search is done — next one starts (and bills) as a fresh session
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

  // Pressing Enter in the Google place search box should trigger a search,
  // not submit the whole "Add shop" form it lives inside.
  document.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target && e.target.id === "place-query") {
      e.preventDefault();
      var btn = document.querySelector('[data-action="search-place"]');
      if (btn) btn.click();
    }
  });

  // Live-as-you-type suggestions — as soon as the agent types a few
  // characters, show matches automatically, the way Google's own search
  // boxes behave. The explicit "Search" button still works too, for anyone
  // who prefers to type the whole thing and press it.
  document.addEventListener("input", function (e) {
    if (!e.target || e.target.id !== "place-query") return;
    var resultsBox = document.getElementById("place-results");
    if (!resultsBox) return;
    var q = e.target.value.trim();
    if (!q) { resultsBox.innerHTML = ''; placeSessionToken = null; return; }
    runLiveAutocomplete(q, resultsBox);
  });

  window.addEventListener("hashchange", render);

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  (async function boot() {
    // The QR code points at a real path (/r/:shopId), not a #hash route,
    // so it works the instant it's scanned without depending on any
    // client-side routing state — and it needs no login at all.
    var reviewMatch = location.pathname.match(/^\/r\/([^\/]+)\/?$/);
    if (reviewMatch) { renderReviewPage(reviewMatch[1]); return; }

    try {
      var res = await api("GET", "/auth/me");
      session = res.user;
    } catch (e) { session = null; }
    render();
  })();
})();
