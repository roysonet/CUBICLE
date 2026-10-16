/* ==========================================================================
   CUBICLE :: ui/ui.js
   All DOM UI. The canvas renders the world; the UI is a DOM overlay, which
   keeps text crisp at any DPR and makes accessibility (focus rings, real
   buttons, aria-live) free.
   ========================================================================== */
(function (root) {
  "use strict";
  var C = (root.CUBICLE = root.CUBICLE || {});
  var util = C.util;
  var CFG = C.CFG;

  function el(tag, cls, html) {
    var n = root.document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }

  function UI(game) {
    this.game = game;
    this.shopOpen = false;
    this.shopTab = "staff";
    this.nodes = {};
    this._toastTimer = 0;
  }

  /* ======================================================================
     Construction
     ====================================================================== */

  UI.prototype.build = function () {
    var self = this;
    var doc = root.document;
    var app = doc.getElementById("app");

    /* ---- HUD ----------------------------------------------------------- */
    var hud = el("header", "hud");
    hud.innerHTML =
      '<div class="hud-left">' +
        '<div class="logo">CUBICLE<em>office simulator</em></div>' +
      '</div>' +
      '<div class="hud-center">' +
        '<div class="cash">' +
          '<span class="cash-value" id="hud-cash">$0</span>' +
          '<span class="cash-rate" id="hud-rate">+$0.00 /s</span>' +
        '</div>' +
      '</div>' +
      '<div class="hud-right">' +
        '<div class="pill pill-clock" id="hud-clock" title="Work day progress">' +
          '<span class="pill-k">Day</span><span class="pill-v" id="hud-day">1</span>' +
          '<span class="pill-sub" id="hud-time">09:00</span>' +
        '</div>' +
        '<div class="pill stars" id="hud-stars" title="Office rating"></div>' +
        '<div class="pill morale-pill" title="Office morale">' +
          '<span class="pill-k">Morale</span>' +
          '<div class="morale-bar"><i id="hud-morale-fill"></i></div>' +
          '<span class="pill-v" id="hud-morale">72%</span>' +
        '</div>' +
        '<div class="pill pill-staff" title="Headcount / desks">' +
          '<span class="pill-k">Staff</span>' +
          '<span class="pill-v" id="hud-staff">0</span>' +
          '<span class="pill-sub" id="hud-desks">/ 0 desks</span>' +
        '</div>' +
        '<div class="hud-actions">' +
          '<button class="btn btn-ghost" data-act="build" title="Build (B)">Build</button>' +
          '<button class="btn btn-ghost" data-act="speed" id="btn-speed" title="Sim speed (1/2/3/0)">1x</button>' +
          '<button class="btn btn-ghost" data-act="pause" id="btn-pause" title="Pause (Space)">Pause</button>' +
          '<button class="btn btn-ghost" data-act="settings" title="Settings">Settings</button>' +
        '</div>' +
      '</div>';
    app.appendChild(hud);
    this.nodes.hud = hud;

    /* ---- Left: departments --------------------------------------------- */
    var depts = el("aside", "panel depts");
    depts.innerHTML =
      '<div class="panel-head">' +
        '<h2>Departments</h2>' +
        '<button class="icon-btn" data-act="collapse-depts" title="Collapse">&#8211;</button>' +
      '</div>' +
      '<div class="panel-body" id="dept-list"></div>';
    // On a phone the department list would cover the office, so it starts as a
    // collapsed bottom sheet.
    if (root.innerWidth < 900) {
      depts.classList.add("collapsed");
      var cb = depts.querySelector('[data-act="collapse-depts"]');
      if (cb) {
        cb.innerHTML = "&#43;";
        cb.setAttribute("aria-expanded", "false");
        cb.setAttribute("aria-label", "Expand departments");
      }
    }
    app.appendChild(depts);
    this.nodes.depts = depts;

    /* ---- Right: shop ---------------------------------------------------- */
    var shop = el("aside", "panel shop");
    shop.innerHTML =
      '<div class="panel-head">' +
        '<h2>Build &amp; Upgrade</h2>' +
        '<button class="icon-btn" data-act="close-shop" title="Close">&#215;</button>' +
      '</div>' +
      '<div class="tabs">' +
        '<button class="tab" data-tab="staff">Staff</button>' +
        '<button class="tab" data-tab="furniture">Furniture</button>' +
        '<button class="tab" data-tab="upgrades">Upgrades</button>' +
      '</div>' +
      '<div class="panel-body" id="shop-list"></div>';
    app.appendChild(shop);
    this.nodes.shop = shop;

    /* ---- Bottom dock ---------------------------------------------------- */
    var dock = el("footer", "dock");
    dock.innerHTML =
      '<button class="btn btn-primary" data-act="hire">' +
        '<span class="btn-label">Hire Now</span>' +
        '<span class="btn-cost" id="hire-cost">$0</span>' +
      '</button>' +
      '<button class="btn btn-primary" data-act="adddesk">' +
        '<span class="btn-label">Add Desk</span>' +
        '<span class="btn-cost" id="desk-cost">$0</span>' +
      '</button>' +
      '<button class="btn btn-accent" data-act="collect">' +
        '<span class="btn-label">Collect All</span>' +
        '<span class="btn-cost" id="pending-total">$0</span>' +
      '</button>' +
      '<div class="dock-spacer"></div>' +
      '<div class="autosave" id="autosave">autosave ready</div>' +
      '<div class="toasts" id="toasts" aria-live="polite"></div>';
    app.appendChild(dock);
    this.nodes.dock = dock;

    /* ---- Screens -------------------------------------------------------- */
    app.appendChild(this._buildTitle());
    app.appendChild(this._buildSummary());
    app.appendChild(this._buildSettings());
    app.appendChild(this._buildPaused());

    /* ---- Wiring --------------------------------------------------------- */
    app.addEventListener("click", function (e) {
      var t = e.target.closest("[data-act],[data-tab],[data-dept],[data-buy],[data-up]");
      if (!t) return;
      C.Audio.unlock();
      if (t.dataset.act) self._onAct(t.dataset.act, t);
      else if (t.dataset.tab) self._onTab(t.dataset.tab, t);
      else if (t.dataset.dept) self._onDept(t.dataset.dept, t);
      else if (t.dataset.buy) self._onBuy(t.dataset.buy, t);
      else if (t.dataset.up) self._onUpgrade(t.dataset.up, t);
    });

    this.rebuild();
    this.syncSettings();
    this.syncSpeed();
  };

  UI.prototype._buildTitle = function () {
    var s = el("div", "screen", "");
    s.id = "screen-title";
    s.innerHTML =
      '<div class="screen-card title-card">' +
        '<div class="title-mark">CUBICLE</div>' +
        '<p class="title-sub">Run the worst-run office in the city. ' +
          'Keep the coffee hot, the printer alive, and the tickets short. ' +
          'Reach a five-star workplace before payroll eats you alive.</p>' +
        '<div class="title-actions">' +
          '<button class="btn btn-primary btn-lg" data-act="start">Open the office</button>' +
          '<button class="btn btn-ghost btn-lg" data-act="howto">How to play</button>' +
        '</div>' +
        '<div class="title-foot">' +
          '<span>Tap to work</span><span>Drag to pan</span>' +
          '<span>Scroll to zoom</span><span>Space to pause</span>' +
        '</div>' +
      '</div>' +
      '<div class="screen-card howto-card" id="howto-card">' +
        '<h3>How to play</h3>' +
        '<ol>' +
          '<li><strong>Tap desks</strong> with banked cash to collect it instantly, with a bonus.</li>' +
          '<li><strong>Tap the coffee machine</strong> the moment it runs dry &mdash; a dry machine bleeds morale, and morale is your revenue multiplier.</li>' +
          '<li><strong>Tap a jammed printer</strong> to clear it. Jams starve every desk nearby.</li>' +
          '<li><strong>Tap the helpdesk</strong> to clear the ticket queue for cash and a morale boost.</li>' +
          '<li><strong>Tap an employee</strong> to motivate them: double output for a few seconds.</li>' +
          '<li><strong>Build</strong> desks and unlock departments to raise your star rating. Stars multiply everything.</li>' +
        '</ol>' +
        '<button class="btn btn-ghost" data-act="close-howto">Got it</button>' +
      '</div>';
    return s;
  };

  UI.prototype._buildSummary = function () {
    var s = el("div", "screen", "");
    s.id = "screen-summary";
    s.innerHTML =
      '<div class="screen-card summary-card">' +
        '<h3 id="sum-title">End of day</h3>' +
        '<div class="summary-grid" id="sum-grid"></div>' +
        '<div class="summary-actions">' +
          '<button class="btn btn-primary" data-act="close-summary">Start next day</button>' +
        '</div>' +
      '</div>';
    return s;
  };

  UI.prototype._buildSettings = function () {
    var s = el("div", "screen", "");
    s.id = "screen-settings";
    s.innerHTML =
      '<div class="screen-card settings-card">' +
        '<h3>Settings</h3>' +
        '<div class="settings-rows">' +
          '<label class="row"><span>Sound effects</span>' +
            '<input type="checkbox" data-set="sfx"></label>' +
          '<label class="row"><span>Music</span>' +
            '<input type="checkbox" data-set="music"></label>' +
          '<label class="row"><span>Mute everything</span>' +
            '<input type="checkbox" data-set="muted"></label>' +
          '<label class="row"><span>Reduce motion</span>' +
            '<input type="checkbox" data-set="reducedMotion"></label>' +
          '<label class="row"><span>Show break pips</span>' +
            '<input type="checkbox" data-set="showPips"></label>' +
        '</div>' +
        '<div class="settings-actions">' +
          '<button class="btn btn-ghost" data-act="fullscreen">Fullscreen (F)</button>' +
          '<button class="btn btn-ghost" data-act="save-now">Save now</button>' +
          '<button class="btn btn-danger" data-act="wipe">Erase save</button>' +
          '<button class="btn btn-primary" data-act="close-settings">Done</button>' +
        '</div>' +
        '<div class="settings-meta" id="settings-meta"></div>' +
      '</div>';
    return s;
  };

  UI.prototype._buildPaused = function () {
    var s = el("div", "screen", "");
    s.id = "screen-paused";
    s.innerHTML =
      '<div class="screen-card paused-card">' +
        '<h3>Paused</h3>' +
        '<div class="summary-grid" id="pause-grid"></div>' +
        '<div class="summary-actions">' +
          '<button class="btn btn-primary" data-act="resume">Resume</button>' +
          '<button class="btn btn-ghost" data-act="settings">Settings</button>' +
        '</div>' +
      '</div>';
    return s;
  };

  /* ======================================================================
     Layout / padding
     ====================================================================== */

  UI.prototype.padding = function () {
    var compact = root.innerWidth < 900;
    return {
      left: compact ? 0 : 232,
      right: this.shopOpen ? (compact ? 0 : 328) : 0,
      top: compact ? 88 : 84,
      bottom: compact ? 74 : 96
    };
  };

  /* ======================================================================
     Actions
     ====================================================================== */

  UI.prototype._onAct = function (act, node) {
    var g = this.game;
    switch (act) {
      case "start":
        g.showScene("playing");
        C.Audio.play("unlock");
        this.toast("Office open", "Tap desks to collect. Watch the coffee.", "good", 3200);
        break;
      case "howto":
        root.document.getElementById("howto-card").classList.add("show");
        break;
      case "close-howto":
        root.document.getElementById("howto-card").classList.remove("show");
        break;
      case "build":
        this.toggleShop();
        break;
      case "close-shop":
        this.toggleShop(false);
        break;
      case "collapse-depts":
        var collapsed = this.nodes.depts.classList.toggle("collapsed");
        node.innerHTML = collapsed ? "&#43;" : "&#8211;";
        node.setAttribute("aria-expanded", String(!collapsed));
        break;
      case "pause":
        g.togglePause();
        break;
      case "resume":
        g.showScene("playing");
        break;
      case "settings":
        g.showScene("settings");
        break;
      case "close-settings":
        g.showScene(g.sim ? "playing" : "title");
        break;
      case "close-summary":
        g.showScene("playing");
        break;
      case "speed":
        this._cycleSpeed();
        break;
      case "hire":
        this._doHire();
        break;
      case "adddesk":
        this._doAddDesk();
        break;
      case "collect":
        g.doCollectAll();
        break;
      case "fullscreen":
        g.toggleFullscreen();
        break;
      case "save-now":
        g.save();
        this.toast("Saved", "Progress written to this browser.", "good", 1600);
        break;
      case "wipe":
        if (root.confirm("Erase your saved office and start over?")) {
          C.Save.clear();
          g.newGame();
          this.showScene("playing");
        }
        break;
    }
  };

  UI.prototype._cycleSpeed = function () {
    var speeds = [1, 2, 3, 0];
    var i = speeds.indexOf(this.game.loop.speed);
    this.game.loop.setSpeed(speeds[(i + 1) % speeds.length]);
    this.syncSpeed();
    C.Audio.play("click");
  };

  UI.prototype._onTab = function (tab, node) {
    this.shopTab = tab;
    var tabs = this.nodes.shop.querySelectorAll(".tab");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle("active", tabs[i].dataset.tab === tab);
    }
    this.renderShop();
    C.Audio.play("click");
  };

  UI.prototype._onDept = function (key, node) {
    var g = this.game;
    if (g.sim.isUnlocked(key)) {
      this.shopOpen = true;
      this.nodes.shop.classList.add("open");
      this.renderShop();
      this.renderDepts();
      this.game.resize();
      return;
    }
    var res = g.sim.unlockDept(key);
    if (res.ok) {
      C.Audio.play("unlock");
      this.toast("Department opened",
        g.sim.deptByKey(key).label + " is now yours.", "good", 2600);
      this.renderDepts();
      this.renderShop();
    } else {
      C.Audio.play("error");
      this.toast("Cannot unlock", res.reason, "warn", 1800);
    }
  };

  UI.prototype._onBuy = function (key, node) {
    var g = this.game;
    var res = g.sim.buyDecor(key);
    if (res.ok) {
      C.Audio.play("place");
      this.toast("Placed", key.replace(/_/g, " ") + " added.", "good", 1500);
      this.renderShop();
    } else {
      C.Audio.play("error");
      this.toast("Cannot build", res.reason, "warn", 1800);
    }
  };

  UI.prototype._onUpgrade = function (key, node) {
    var g = this.game;
    var res = g.sim.buyUpgrade(key);
    if (res.ok) {
      C.Audio.play("levelup");
      this.toast("Upgraded", "Level " + res.level + " reached.", "good", 1800);
      this.renderShop();
    } else {
      C.Audio.play("error");
      this.toast("Cannot upgrade", res.reason, "warn", 1800);
    }
  };

  UI.prototype._doHire = function () {
    var g = this.game;
    var free = g.sim.countFreeDesks();
    if (free <= 0) {
      this.toast("No free desk", "Add a desk before hiring.", "warn", 1800);
      C.Audio.play("error");
      return;
    }
    var res = g.sim.hireEmployee(false);
    if (res.ok) {
      C.Audio.play("levelup");
      this.toast("Hired", "New starter walking to a desk.", "good", 1600);
    } else {
      C.Audio.play("error");
      this.toast("Cannot hire", res.reason, "warn", 1800);
    }
  };

  UI.prototype._doAddDesk = function () {
    var g = this.game;
    // Prefer a department the player already has open, then any unlocked one.
    var order = Object.keys(g.sim.unlocked);
    var target = null;
    for (var i = 0; i < order.length; i++) {
      if (g.sim.freeSlots(order[i]).length) { target = order[i]; break; }
    }
    if (!target) {
      this.toast("No space", "Unlock a department to build more desks.", "warn", 2000);
      C.Audio.play("error");
      return;
    }
    var res = g.sim.buyDesk(target);
    if (res.ok) {
      C.Audio.play("place");
      this.toast("Desk built", g.sim.deptByKey(target).label, "good", 1500);
      this.renderDepts();
    } else {
      C.Audio.play("error");
      this.toast("Cannot build", res.reason, "warn", 1800);
    }
  };

  /* ======================================================================
     Rendering panels
     ====================================================================== */

  UI.prototype.rebuild = function () {
    this.renderDepts();
    this.renderShop();
    this.syncHud();
  };

  UI.prototype.renderDepts = function () {
    var sim = this.game.sim;
    var host = root.document.getElementById("dept-list");
    if (!host) return;
    var html = "";
    for (var i = 0; i < CFG.DEPARTMENTS.length; i++) {
      var d = CFG.DEPARTMENTS[i];
      var open = sim.isUnlocked(d.key);
      var desks = sim.deptDesks(d.key).length;
      var slots = CFG.deskSlots(d).length;
      var staffed = 0;
      var ds = sim.deptDesks(d.key);
      for (var j = 0; j < ds.length; j++) if (ds[j].occupiedBy) staffed++;

      var cls = "dept" + (open ? " open" : " locked");
      html += '<button class="' + cls + '" data-dept="' + d.key + '"' +
        (open ? "" : " disabled") + ">";
      html += '<span class="dept-dot" style="background:' + d.accent + '"></span>';
      html += '<span class="dept-main">';
      html += '<span class="dept-name">' + d.label + "</span>";
      html += '<span class="dept-sub">' +
        (open
          ? util.plural(staffed, "desk") + " staffed of " + desks +
            " built (" + slots + " slots)"
          : "Locked") +
        "</span>";
      html += "</span>";
      html += '<span class="dept-cost">' +
        (open ? (desks + "/" + slots) : util.money(d.cost)) + "</span>";
      html += "</button>";
    }
    host.innerHTML = html;
  };

  UI.prototype.renderShop = function () {
    var sim = this.game.sim;
    var host = root.document.getElementById("shop-list");
    if (!host) return;
    var html = "";

    if (this.shopTab === "staff") {
      html += '<div class="shop-note">Applicants walk in on their own when a ' +
        'desk is free. Pay to skip the queue.</div>';
      var hireCost = CFG.hireCost(sim.employeeCount);
      html += this._shopRow("person", "Hire Now", "Instant starter",
        hireCost, sim.cash >= hireCost, 'data-act="hire"');
      html += '<div class="shop-sep"></div>';
      html += '<div class="shop-note">Desks are the real constraint. Each desk ' +
        'seats one employee.</div>';
      for (var i = 0; i < CFG.DEPARTMENTS.length; i++) {
        var d = CFG.DEPARTMENTS[i];
        if (!sim.isUnlocked(d.key)) continue;
        var free = sim.freeSlots(d.key).length;
        var cost = CFG.deskCost(sim.desks.length);
        html += this._shopRow("doc", "Desk in " + d.label,
          free + " slots free", cost, free > 0 && sim.cash >= cost,
          'data-act="adddesk"');
      }
    } else if (this.shopTab === "furniture") {
      html += '<div class="shop-note">Furniture raises morale and prestige. ' +
        'Morale is a direct revenue multiplier.</div>';
      for (var k = 0; k < CFG.DECOR.length; k++) {
        var item = CFG.DECOR[k];
        var owned = sim.decor[item.key] || 0;
        var maxed = owned >= item.max;
        html += this._shopRow("gear", item.label,
          owned + "/" + item.max + " placed \u00b7 +" + item.morale.toFixed(1) +
          " morale \u00b7 +" + item.prestige + " prestige",
          item.cost, !maxed && sim.cash >= item.cost,
          'data-buy="' + item.key + '"', maxed);
      }
    } else {
      html += '<div class="shop-note">Permanent office-wide improvements.</div>';
      for (var u = 0; u < CFG.UPGRADES.length; u++) {
        var up = CFG.UPGRADES[u];
        var lvl = sim.upgrades[up.key] || 0;
        var top = lvl >= up.max;
        var c = up.cost(lvl);
        html += this._shopRow("chart", up.label,
          up.desc + " \u00b7 Lv " + lvl + "/" + up.max,
          c, !top && sim.cash >= c, 'data-up="' + up.key + '"', top);
      }
    }

    host.innerHTML = html;
    this._paintIcons(host);
  };

  UI.prototype._shopRow = function (icon, title, sub, cost, affordable, attr, maxed) {
    var cls = "shop-row" + (affordable ? "" : " disabled") + (maxed ? " maxed" : "");
    var s = '<button class="' + cls + '" ' + (attr || "") + '>';
    s += '<span class="shop-icon" data-icon="' + icon + '"></span>';
    s += '<span class="shop-main">';
    s += '<span class="shop-title">' + title + "</span>";
    s += '<span class="shop-sub">' + sub + "</span>";
    s += "</span>";
    s += '<span class="shop-cost">' + (maxed ? "MAX" : util.money(cost)) + "</span>";
    s += "</button>";
    return s;
  };

  /* ======================================================================
     HUD sync
     ====================================================================== */

  UI.prototype.syncHud = function () {
    var sim = this.game.sim;
    if (!sim) return;
    var n = this.nodes;

    var cashEl = root.document.getElementById("hud-cash");
    if (cashEl) {
      var v = util.money(sim.cash);
      if (cashEl.textContent !== v) cashEl.textContent = v;
    }

    var rateEl = root.document.getElementById("hud-rate");
    if (rateEl) {
      var r = "+" + util.money(sim.incomePerSecond()) + " /s";
      if (rateEl.textContent !== r) rateEl.textContent = r;
    }

    var dayEl = root.document.getElementById("hud-day");
    if (dayEl && dayEl.textContent !== String(sim.day)) {
      dayEl.textContent = String(sim.day);
    }

    var tEl = root.document.getElementById("hud-time");
    if (tEl) {
      var frac = util.clamp(sim.dayTime / CFG.dayLength, 0, 1);
      var mins = Math.floor(frac * 9 * 60);   // 09:00 -> 18:00
      var t = util.pad2(9 + Math.floor(mins / 60)) + ":" + util.pad2(mins % 60);
      if (tEl.textContent !== t) tEl.textContent = t;
    }

    var starEl = root.document.getElementById("hud-stars");
    if (starEl) {
      var key = sim.stars + "|" + Math.round(sim.prestige);
      if (starEl.dataset.k !== key) {
        starEl.dataset.k = key;
        var out = '<span class="pill-k">Rating</span><span class="star-row">';
        for (var i = 1; i <= 5; i++) {
          out += '<i class="star' + (i <= sim.stars ? " on" : "") + '"></i>';
        }
        out += "</span>";
        var next = CFG.starThresholds[sim.stars];
        out += '<span class="pill-sub">' +
          (next ? Math.round(sim.prestige) + "/" + next : "max") + "</span>";
        starEl.innerHTML = out;
      }
    }

    var mEl = root.document.getElementById("hud-morale");
    var mFill = root.document.getElementById("hud-morale-fill");
    if (mEl) {
      var mp = Math.round(sim.morale);
      if (mEl.textContent !== mp + "%") mEl.textContent = mp + "%";
      if (mFill) {
        mFill.style.width = mp + "%";
        mFill.className = mp > 66 ? "good" : mp > 33 ? "warn" : "bad";
      }
    }

    var sEl = root.document.getElementById("hud-staff");
    if (sEl) {
      var sv = String(sim.employees.length);
      if (sEl.textContent !== sv) sEl.textContent = sv;
    }
    var dEl = root.document.getElementById("hud-desks");
    if (dEl) {
      var dv = "/ " + sim.desks.length + " desks";
      if (dEl.textContent !== dv) dEl.textContent = dv;
    }

    // Dock costs
    var hc = root.document.getElementById("hire-cost");
    if (hc) hc.textContent = util.money(CFG.hireCost(sim.employeeCount));
    var dc = root.document.getElementById("desk-cost");
    if (dc) dc.textContent = util.money(CFG.deskCost(sim.desks.length));
    var pt = root.document.getElementById("pending-total");
    if (pt) pt.textContent = util.money(sim.totalPending());

    // Affordability hints on the dock buttons
    this._afford('[data-act="hire"]', sim.cash >= CFG.hireCost(sim.employeeCount));
    this._afford('[data-act="adddesk"]', sim.cash >= CFG.deskCost(sim.desks.length));

    // Refresh shop affordability without rebuilding DOM every frame.
    if (this.shopOpen) {
      this._shopRefreshTimer = (this._shopRefreshTimer || 0) + 1;
      if (this._shopRefreshTimer % 20 === 0) this.renderShop();
    }
  };

  UI.prototype._afford = function (sel, ok) {
    var node = this.nodes.dock.querySelector(sel);
    if (node) node.classList.toggle("unaffordable", !ok);
  };

  UI.prototype.syncSpeed = function () {
    var b = root.document.getElementById("btn-speed");
    if (!b) return;
    var s = this.game.loop.speed;
    b.textContent = s === 0 ? "Paused" : s + "x";
    b.classList.toggle("active", s !== 1);
  };

  UI.prototype.syncSettings = function () {
    var self = this;
    var o = this.game.options;
    var map = {
      sfx: o.sfx, music: o.music, muted: o.muted,
      reducedMotion: o.reducedMotion, showPips: this.game.sim.settings.showPips
    };
    var inputs = root.document.querySelectorAll("[data-set]");
    for (var i = 0; i < inputs.length; i++) {
      var node = inputs[i];
      var key = node.dataset.set;
      node.checked = !!map[key];
      node.onchange = function () {
        var k = this.dataset.set;
        if (k === "showPips") {
          self.game.sim.settings.showPips = this.checked;
        } else {
          self.game.options[k] = this.checked;
          C.Audio.setOptions(self.game.options);
          C.Save.writeOptions(self.game.options);
          root.document.documentElement.classList.toggle(
            "reduce-motion", !!self.game.options.reducedMotion);
        }
      };
    }
    var meta = root.document.getElementById("settings-meta");
    if (meta) {
      meta.textContent =
        "Save slot: " + (C.Save.available ? "localStorage OK" : "unavailable") +
        " \u00b7 sprites: " + Object.keys(C.Assets.images).length + " sheets" +
        " \u00b7 fps " + (this.game.loop ? this.game.loop.fps : 0) +
        (C.Assets.failed.length ? " \u00b7 FAILED: " + C.Assets.failed.join(", ") : "");
    }
  };

  /**
   * Paints shop-row icons from the generated icons.png sheet using
   * background-position, so we never need one image file per icon.
   */
  UI.prototype._paintIcons = function (host) {
    var sheet = C.Assets.atlas && C.Assets.atlas.sheets.icons;
    if (!sheet) return;
    var url = "assets/sprites/" + sheet.file;
    var nodes = host.querySelectorAll(".shop-icon[data-icon]");
    var size = 24;
    var scale = size / sheet.cell[0];
    var sheetW = sheet.cell[0] * Object.keys(sheet.frames).length;
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].dataset.icon;
      var fr = sheet.frames[key];
      if (!fr) continue;
      nodes[i].style.backgroundImage = "url(" + url + ")";
      nodes[i].style.backgroundSize =
        (sheetW * scale) + "px " + (sheet.cell[1] * scale) + "px";
      nodes[i].style.backgroundPosition =
        (-fr.x * scale) + "px " + (-fr.y * scale) + "px";
    }
  };

  /* ======================================================================
     Scenes
     ====================================================================== */

  UI.prototype.showScene = function (name) {
    var ids = ["screen-title", "screen-summary", "screen-settings", "screen-paused"];
    for (var i = 0; i < ids.length; i++) {
      var n = root.document.getElementById(ids[i]);
      if (n) n.classList.remove("show");
    }
    var map = {
      title: "screen-title",
      settings: "screen-settings",
      paused: "screen-paused",
      summary: "screen-summary"
    };
    var target = map[name];
    if (target) {
      var t = root.document.getElementById(target);
      if (t) t.classList.add("show");
    }
    var app = root.document.getElementById("app");
    if (app) app.dataset.scene = name;

    var pauseBtn = root.document.getElementById("btn-pause");
    if (pauseBtn) pauseBtn.textContent = name === "paused" ? "Resume" : "Pause";
  };

  UI.prototype.showDaySummary = function (b) {
    var sim = this.game.sim;
    var grid = root.document.getElementById("sum-grid");
    var title = root.document.getElementById("sum-title");
    if (!grid) return;
    if (title) title.textContent = "Day " + b.day + " complete";

    var rows = [
      ["Revenue", util.money(b.earned), "good"],
      ["Payroll", "-" + util.money(b.payroll), b.shortfall ? "bad" : "warn"],
      ["Net", util.money(b.earned - b.payroll), b.earned - b.payroll >= 0 ? "good" : "bad"],
      ["Headcount", String(b.staff), ""],
      ["Rating", b.stars + " of 5", ""],
      ["Morale", Math.round(sim.morale) + "%", ""],
      ["Tickets cleared", String(sim.stats.ticketsResolved), ""],
      ["Jams fixed", String(sim.stats.jamsFixed), ""]
    ];
    var html = "";
    for (var i = 0; i < rows.length; i++) {
      html += '<div class="sum-row ' + rows[i][2] + '">' +
        '<span>' + rows[i][0] + "</span><strong>" + rows[i][1] + "</strong></div>";
    }
    grid.innerHTML = html;
    this.game.showScene("summary");
  };

  /* ======================================================================
     Toasts
     ====================================================================== */

  UI.prototype.toast = function (title, body, tone, ms) {
    var host = root.document.getElementById("toasts");
    if (!host) return;
    var key = title + "|" + body;
    var now = performance.now();
    if (key === this._lastToastKey && now - this._lastToastAt < 900) return;
    this._lastToastKey = key;
    this._lastToastAt = now;

    var t = el("div", "toast " + (tone || ""));
    t.innerHTML = "<strong>" + title + "</strong>" + (body ? "<span>" + body + "</span>" : "");
    host.appendChild(t);
    root.requestAnimationFrame(function () { t.classList.add("in"); });
    var life = ms || 2400;
    root.setTimeout(function () {
      t.classList.remove("in");
      root.setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 320);
    }, life);
    while (host.children.length > 4) host.removeChild(host.firstChild);
  };

  UI.prototype.autosaveIndicator = function (ok) {
    var n = root.document.getElementById("autosave");
    if (!n) return;
    n.textContent = ok ? "saved" : "save unavailable";
    n.classList.toggle("bad", !ok);
    n.classList.add("flash");
    root.setTimeout(function () { n.classList.remove("flash"); }, 900);
  };

  /* ======================================================================
     Misc
     ====================================================================== */

  UI.prototype.toggleShop = function (force) {
    this.shopOpen = force === undefined ? !this.shopOpen : force;
    this.nodes.shop.classList.toggle("open", this.shopOpen);
    this.game.resize();
    if (this.shopOpen) {
      this.renderShop();
      C.Audio.play("click");
    }
  };

  UI.prototype.closeAll = function () {
    var ids = ["screen-settings", "screen-summary", "screen-paused"];
    for (var i = 0; i < ids.length; i++) {
      var n = root.document.getElementById(ids[i]);
      if (n) n.classList.remove("show");
    }
    var h = root.document.getElementById("howto-card");
    if (h) h.classList.remove("show");
    if (this.shopOpen) this.toggleShop(false);
    if (this.game.scene !== "playing") this.game.showScene("playing");
  };

  C.UI = UI;
})(window);
