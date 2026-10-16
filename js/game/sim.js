/* ==========================================================================
   CUBICLE :: game/sim.js
   The whole simulation: world construction, economy, morale, tasks, taps.

   Mirrors the parameter surface the REA reconstructed from the original
   (money / moving speed / appearance timer / rating multiply) but splits
   friction into two tempos:
     - SCARCITY (coffee runs out)  -> slow morale bleed
     - BLOCKAGE  (printer jams)    -> instant throughput loss
   ========================================================================== */
(function (root) {
  "use strict";
  var C = (root.CUBICLE = root.CUBICLE || {});
  var util = C.util;
  var CFG = C.CFG;

  var HW = CFG.TILE_W / 2;
  var HH = CFG.TILE_H / 2;

  function Sim() {
    this.grid = new C.Grid(CFG.COLS, CFG.ROWS);
    this.desks = [];
    this.employees = [];
    this.fixtures = {};
    this.effects = new C.Effects();

    this.cash = CFG.startCash;
    this.earned = 0;
    this.earnedToday = 0;
    this.autoCollected = 0;
    this.tapCollected = 0;
    this.spent = 0;

    this.morale = CFG.moraleStart;
    this.stars = 1;
    this.prestige = 0;

    this.time = 0;
    this.day = 1;
    this.dayTime = 0;

    this.upgrades = {};
    for (var i = 0; i < CFG.UPGRADES.length; i++) {
      this.upgrades[CFG.UPGRADES[i].key] = 0;
    }

    this.unlocked = { eng: true };
    this.decor = {};          // key -> count
    this.decorSprites = [];   // placed decoration instances
    for (var d = 0; d < CFG.DECOR.length; d++) this.decor[CFG.DECOR[d].key] = 0;

    this.stats = {
      taps: 0, hires: 0, jamsFixed: 0, ticketsResolved: 0,
      coffeesBrewed: 0, desksBuilt: 0, deptsUnlocked: 1, motiv: 0
    };

    this.employeeCount = 0;
    this.applicantTimer = CFG.applicantTimer;
    this.spawnTile = { r: 19, c: 2 };
    this.bannerQueue = [];
    this.settings = { showPips: true };
    this._lastDryToast = -99;
    this.rng = util.rng(1337);
  }

  /* ======================================================================
     World construction
     ====================================================================== */

  /** Grid + fixtures only. Safe to call repeatedly; no progression content. */
  Sim.prototype._initWorld = function () {
    var F = CFG.FLOOR;
    this.grid.setRegionSolid(0, 0, CFG.ROWS - 1, CFG.COLS - 1, true);
    this.grid.setRegionSolid(F.r0, F.c0, F.r1, F.c1, false);

    for (var i = 0; i < CFG.FIXTURES.length; i++) {
      var def = CFG.FIXTURES[i];
      var fx = this.fixtures[def.id] || new C.Fixture(def);
      fx.r = def.r;
      fx.c = def.c;
      fx.spriteKey = def.sprite;
      fx.jammed = false;
      fx.level = fx.capacity;
      fx.brewCooldown = 0;
      fx.jamTimer = 30 + Math.random() * 40;
      this.fixtures[def.id] = fx;
      this.grid.setSolid(fx.r, fx.c, true);
    }

    var keys = Object.keys(this.fixtures);
    for (var k = 0; k < keys.length; k++) {
      var f = this.fixtures[keys[k]];
      f.useTile = this._pickUseTile(f.r, f.c);
      if (f.spawn) this.spawnTile = f.useTile;
    }
  };

  /** Full new-game world: fixtures plus the starting desk and employee. */
  Sim.prototype.buildWorld = function () {
    this._initWorld();
    this.decorSprites.length = 0;
    this.desks.length = 0;
    this.employees.length = 0;
    this.placeDesk("eng", 2, 2, true);
    this.hireEmployee(true);
    this.recomputeRating();
  };

  /** Nearest free tile to a fixture, preferring one in front (lower row). */
  Sim.prototype._pickUseTile = function (r, c) {
    var candidates = [
      { r: r + 1, c: c }, { r: r, c: c + 1 }, { r: r + 1, c: c + 1 },
      { r: r - 1, c: c }, { r: r, c: c - 1 }
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (this.grid.isWalkable(candidates[i].r, candidates[i].c)) {
        return candidates[i];
      }
    }
    return this.grid.nearestWalkable(r, c, 6);
  };

  Sim.prototype.worldBounds = function () {
    return {
      minX: -(CFG.ROWS - 1) * HW - HW,
      maxX: (CFG.COLS - 1) * HW + HW,
      minY: -HH,
      maxY: (CFG.COLS + CFG.ROWS - 2) * HH + HH
    };
  };

  Sim.prototype.deptByKey = function (key) {
    for (var i = 0; i < CFG.DEPARTMENTS.length; i++) {
      if (CFG.DEPARTMENTS[i].key === key) return CFG.DEPARTMENTS[i];
    }
    return null;
  };

  Sim.prototype.isUnlocked = function (key) { return !!this.unlocked[key]; };

  Sim.prototype.deptDesks = function (key) {
    var out = [];
    for (var i = 0; i < this.desks.length; i++) {
      if (this.desks[i].deptKey === key) out.push(this.desks[i]);
    }
    return out;
  };

  /** Desk slots in a department that are still empty. */
  Sim.prototype.freeSlots = function (key) {
    var slots = CFG.deskSlots(this.deptByKey(key));
    var taken = {};
    var ds = this.deptDesks(key);
    for (var i = 0; i < ds.length; i++) taken[ds[i].r + "," + ds[i].c] = true;
    var out = [];
    for (var j = 0; j < slots.length; j++) {
      if (!taken[slots[j].r + "," + slots[j].c]) out.push(slots[j]);
    }
    return out;
  };

  /* ======================================================================
     Build / buy actions
     ====================================================================== */

  Sim.prototype.placeDesk = function (deptKey, r, c, free) {
    if (!this.isUnlocked(deptKey)) return null;
    if (this.grid.isSolid(r, c)) return null;
    var desk = new C.Desk(deptKey, r, c, this._deskSprite());
    desk.level = 1;
    this.desks.push(desk);
    this.grid.setSolid(r, c, true);
    // Desks that would seal off their own work tile are rejected up front.
    if (this.grid.isSolid(desk.workR, desk.workC)) {
      this.grid.setSolid(r, c, false);
      util.remove(this.desks, desk);
      return null;
    }
    this.stats.desksBuilt++;
    if (!free) this.effects.burst(this.gridToWorldX(r, c), this.gridToWorldY(r, c),
      CFG.COLORS.accent, 10, 40);
    this.recomputeRating();
    return desk;
  };

  Sim.prototype._deskSprite = function () {
    var variants = ["desk_a", "desk_b", "desk_c"];
    return variants[this.desks.length % variants.length];
  };

  Sim.prototype.buyDesk = function (deptKey) {
    var slots = this.freeSlots(deptKey);
    if (!slots.length) return { ok: false, reason: "No free desk slots." };
    var cost = CFG.deskCost(this.desks.length);
    if (this.cash < cost) return { ok: false, reason: "Not enough budget.", cost: cost };
    this.cash -= cost;
    this.spent += cost;
    var slot = slots[0];
    var desk = this.placeDesk(deptKey, slot.r, slot.c, false);
    if (!desk) return { ok: false, reason: "That slot is blocked." };
    return { ok: true, cost: cost, desk: desk };
  };

  Sim.prototype.upgradeDesk = function (desk) {
    var cost = CFG.deskLevelCost(desk.level);
    if (this.cash < cost) return { ok: false, reason: "Not enough budget.", cost: cost };
    if (desk.level >= 8) return { ok: false, reason: "Desk is maxed out." };
    this.cash -= cost;
    this.spent += cost;
    desk.level++;
    return { ok: true, cost: cost, level: desk.level };
  };

  Sim.prototype.hireEmployee = function (free) {
    var cost = free ? 0 : CFG.hireCost(this.employeeCount);
    if (!free) {
      if (this.cash < cost) return { ok: false, reason: "Not enough budget.", cost: cost };
      this.cash -= cost;
      this.spent += cost;
    }
    var key = CFG.ARCHETYPE_KEYS[
      Math.floor(this.rng() * CFG.ARCHETYPE_KEYS.length)
    ];
    var emp = new C.Employee(key, this.spawnTile);
    emp.coffeeTimer = CFG.breakInterval * (0.4 + this.rng() * 0.6);
    emp.level = 1 + Math.floor(this.upgrades.hrTraining * 0.5);
    this.employees.push(emp);
    this.employeeCount++;
    this.stats.hires++;
    if (!free) {
      var w = this.gridToWorldX(this.spawnTile.r, this.spawnTile.c);
      var h = this.gridToWorldY(this.spawnTile.r, this.spawnTile.c);
      this.effects.burst(w, h, CFG.COLORS.info, 10, 36);
      this.effects.text("NEW HIRE", w, h - 40, CFG.COLORS.info, 14);
    }
    return { ok: true, cost: cost, employee: emp };
  };

  Sim.prototype.buyDecor = function (key) {
    var def = null;
    for (var i = 0; i < CFG.DECOR.length; i++) {
      if (CFG.DECOR[i].key === key) def = CFG.DECOR[i];
    }
    if (!def) return { ok: false, reason: "Unknown item." };
    if (this.decor[key] >= def.max) return { ok: false, reason: "Already maxed." };
    if (this.cash < def.cost) return { ok: false, reason: "Not enough budget.", cost: def.cost };

    var spot = this._findDecorSpot();
    if (!spot) return { ok: false, reason: "No room left on the floor." };

    this.cash -= def.cost;
    this.spent += def.cost;
    this.decor[key] = (this.decor[key] || 0) + 1;
    var inst = {
      key: key, sprite: def.sprite, r: spot.r, c: spot.c,
      morale: def.morale, prestige: def.prestige
    };
    this.decorSprites.push(inst);
    if (def.sprite !== "rug_warm" && def.sprite !== "rug_cool") {
      this.grid.setSolid(spot.r, spot.c, true);
    }
    this.recomputeRating();
    var w = this.gridToWorldX(spot.r, spot.c);
    var h = this.gridToWorldY(spot.r, spot.c);
    this.effects.burst(w, h, CFG.COLORS.good, 10, 40);
    return { ok: true, cost: def.cost, instance: inst };
  };

  /**
   * Finds a floor tile for decoration. Prefers the lobby and corridor edges so
   * decorations never block a department's walking lanes.
   */
  Sim.prototype._findDecorSpot = function () {
    var occupied = {};
    for (var i = 0; i < this.decorSprites.length; i++) {
      occupied[this.decorSprites[i].r + "," + this.decorSprites[i].c] = true;
    }
    var F = CFG.FLOOR;
    var preferred = [];

    // Lobby strip (below the last corridor row).
    var lastCorridor = CFG.CORRIDOR_ROWS[CFG.CORRIDOR_ROWS.length - 1];
    for (var r = lastCorridor + 1; r <= F.r1; r++) {
      for (var c = F.c0; c <= F.c1; c++) preferred.push({ r: r, c: c });
    }
    // Corridor tiles that have a solid neighbour (so they don't sever a lane).
    for (var i2 = 0; i2 < CFG.CORRIDOR_ROWS.length; i2++) {
      var rr = CFG.CORRIDOR_ROWS[i2];
      for (var cc = F.c0; cc <= F.c1; cc++) {
        if (this._isLaneCritical(rr, cc)) continue;
        preferred.push({ r: rr, c: cc });
      }
    }
    for (var i3 = 0; i3 < CFG.CORRIDOR_COLS.length; i3++) {
      var cx = CFG.CORRIDOR_COLS[i3];
      for (var ry = F.r0; ry <= F.r1; ry++) {
        if (this._isLaneCritical(ry, cx)) continue;
        preferred.push({ r: ry, c: cx });
      }
    }

    util.shuffle(preferred, this.rng);
    for (var p = 0; p < preferred.length; p++) {
      var t = preferred[p];
      if (occupied[t.r + "," + t.c]) continue;
      if (!this.grid.isWalkable(t.r, t.c)) continue;
      if (this._blocksLane(t.r, t.c)) continue;
      return t;
    }
    return null;
  };

  /**
   * Would blocking this tile disconnect the walkable floor?
   *
   * This must be a real connectivity test. An earlier version compared
   * walkable-tile counts before and after, which is trivially always true for
   * a block and rejected every placement.
   */
  Sim.prototype._blocksLane = function (r, c) {
    if (!this.grid.isWalkable(r, c)) return true;
    this.grid.setSolid(r, c, true);
    var connected = this._isFloorConnected();
    this.grid.setSolid(r, c, false);
    return !connected;
  };

  /** True when every walkable floor tile is reachable from any other. */
  Sim.prototype._isFloorConnected = function () {
    var F = CFG.FLOOR;
    var total = 0, start = null, r, c;
    for (r = F.r0; r <= F.r1; r++) {
      for (c = F.c0; c <= F.c1; c++) {
        if (!this.grid.isWalkable(r, c)) continue;
        total++;
        if (!start) start = { r: r, c: c };
      }
    }
    if (!start) return false;

    var dist = this.grid.field(start.r, start.c);
    if (!dist) return false;

    var reached = 0;
    for (r = F.r0; r <= F.r1; r++) {
      for (c = F.c0; c <= F.c1; c++) {
        if (!this.grid.isWalkable(r, c)) continue;
        if (dist[r * this.grid.cols + c] >= 0) reached++;
      }
    }
    return reached === total;
  };

  Sim.prototype._isLaneCritical = function (r, c) {
    return !this.grid.isWalkable(r, c);
  };

  Sim.prototype.unlockDept = function (key) {
    var dept = this.deptByKey(key);
    if (!dept) return { ok: false, reason: "Unknown department." };
    if (this.isUnlocked(key)) return { ok: false, reason: "Already unlocked." };
    if (this.cash < dept.cost) {
      return { ok: false, reason: "Not enough budget.", cost: dept.cost };
    }
    this.cash -= dept.cost;
    this.spent += dept.cost;
    this.unlocked[key] = true;
    this.stats.deptsUnlocked++;
    this.recomputeRating();

    var R = dept.rect;
    var w = this.gridToWorldX((R.r0 + R.r1) / 2, (R.c0 + R.c1) / 2);
    var h = this.gridToWorldY((R.r0 + R.r1) / 2, (R.c0 + R.c1) / 2);
    this.effects.burst(w, h, CFG.COLORS.accent, 26, 90);
    this.effects.text(dept.label.toUpperCase(), w, h - 46, CFG.COLORS.accent, 20);
    return { ok: true, cost: dept.cost, dept: dept };
  };

  Sim.prototype.buyUpgrade = function (key) {
    var def = null;
    for (var i = 0; i < CFG.UPGRADES.length; i++) {
      if (CFG.UPGRADES[i].key === key) def = CFG.UPGRADES[i];
    }
    if (!def) return { ok: false, reason: "Unknown upgrade." };
    var level = this.upgrades[key] || 0;
    if (level >= def.max) return { ok: false, reason: "Fully upgraded." };
    var cost = def.cost(level);
    if (this.cash < cost) return { ok: false, reason: "Not enough budget.", cost: cost };
    this.cash -= cost;
    this.spent += cost;
    this.upgrades[key] = level + 1;

    if (key === "coffeeCap") {
      var fx = this.fixtures.coffee;
      var oldCap = fx.capacity;
      fx.capacity = CFG.coffeeCapacity * (1 + 0.35 * this.upgrades.coffeeCap);
      fx.level = Math.min(fx.capacity, fx.level + (fx.capacity - oldCap));
    }
    this.recomputeRating();
    return { ok: true, cost: cost, level: this.upgrades[key] };
  };

  /* ======================================================================
     Per-tick simulation
     ====================================================================== */

  Sim.prototype.update = function (dt) {
    this.time += dt;
    this.dayTime += dt;

    var i;

    for (i = 0; i < this.desks.length; i++) this.desks[i].update(dt, this);

    var keys = Object.keys(this.fixtures);
    for (i = 0; i < keys.length; i++) this.fixtures[keys[i]].update(dt, this);

    for (i = this.employees.length - 1; i >= 0; i--) {
      var emp = this.employees[i];
      emp.update(dt, this);
      if (emp.dead) {
        if (emp.desk) {
          if (emp.desk.occupiedBy === emp) emp.desk.occupiedBy = null;
          if (emp.desk.reservedBy === emp) emp.desk.reservedBy = null;
        }
        util.swapRemove(this.employees, i);
        this.employeeCount = Math.max(0, this.employeeCount - 1);
      }
    }

    this.updateMorale(dt);
    this.updateTasks(dt);
    this.updateArrivals(dt);
    this.effects.update(dt);

    // Day rollover.
    if (this.dayTime >= CFG.dayLength) {
      this.endDay();
    }

    this.recomputeRating();
  };

  Sim.prototype.updateMorale = function (dt) {
    var hvac = this.upgrades.hvac || 0;
    var relief = 1 - hvac * 0.09;

    var penalty = 0;
    var coffee = this.fixtures.coffee;
    if (coffee && coffee.level <= 0.01) penalty += CFG.moralePenaltyDry * relief;
    var printer = this.fixtures.printer;
    if (printer && printer.jammed) penalty += CFG.moralePenaltyJam * relief;
    var help = this.fixtures.helpdesk;
    if (help) {
      penalty += Math.min(help.tickets, 70) * CFG.moralePenaltyTickets * relief;
    }

    var decorBonus = 0;
    for (var i = 0; i < this.decorSprites.length; i++) {
      decorBonus += this.decorSprites[i].morale;
    }

    var regen = (CFG.moraleRegen + decorBonus) * (1 + hvac * 0.12);
    var net = regen - penalty;
    this.morale = util.clamp(this.morale + net * dt, 0, CFG.moraleMax);
  };

  Sim.prototype.updateTasks = function (dt) {
    var help = this.fixtures.helpdesk;
    if (!help) return;
    var rate = this.employees.length * CFG.ticketRatePerEmployee *
      (1 - (this.upgrades.itSupport || 0) * 0.12);
    help.tickets = Math.min(CFG.ticketCap, help.tickets + rate * dt);
  };

  Sim.prototype.updateArrivals = function (dt) {
    var freeDesks = this.countFreeDesks();
    if (freeDesks <= 0) return;
    this.applicantTimer -= dt;
    if (this.applicantTimer > 0) return;
    var speedUp = 1 - (this.upgrades.hrTraining || 0) * 0.09;
    this.applicantTimer = Math.max(
      CFG.applicantTimerMin,
      CFG.applicantTimer * speedUp
    ) * (0.75 + this.rng() * 0.5);
    this.hireEmployee(true);
  };

  Sim.prototype.countFreeDesks = function () {
    var n = 0;
    for (var i = 0; i < this.desks.length; i++) {
      var d = this.desks[i];
      if (!d.occupiedBy && !d.reservedBy) n++;
    }
    return n;
  };

  Sim.prototype.endDay = function () {
    var deptCount = Object.keys(this.unlocked).length;
    var payroll = Math.round(
      this.employees.length * CFG.payrollPerEmployee * (1 + deptCount * 0.08)
    );
    this.cash -= payroll;
    var shortfall = false;
    if (this.cash < 0) {
      this.cash = 0;
      shortfall = true;
      this.addMorale(-14);
    }
    this.bannerQueue.push({
      type: "dayEnd",
      day: this.day,
      earned: this.earnedToday,
      payroll: payroll,
      shortfall: shortfall,
      staff: this.employees.length,
      stars: this.stars
    });
    this.day++;
    this.dayTime = 0;
    this.earnedToday = 0;
  };

  Sim.prototype.addMorale = function (n) {
    this.morale = util.clamp(this.morale + n, 0, CFG.moraleMax);
  };

  /* ======================================================================
     Derived values
     ====================================================================== */

  Sim.prototype.revenueMultiplier = function () {
    var moraleMult = CFG.moraleFloorMult +
      (1 - CFG.moraleFloorMult) * (this.morale / CFG.moraleMax);
    var ratingMult = 1 + (this.stars - 1) * CFG.ratingMultiplierStep;
    return moraleMult * ratingMult;
  };

  Sim.prototype.incomePerSecond = function () {
    var sum = 0;
    for (var i = 0; i < this.desks.length; i++) sum += this.desks[i].rate(this);
    return sum;
  };

  Sim.prototype.totalPending = function () {
    var sum = 0;
    for (var i = 0; i < this.desks.length; i++) sum += this.desks[i].pending;
    return sum;
  };

  Sim.prototype.decorCount = function () {
    return this.decorSprites.length;
  };

  Sim.prototype.recomputeRating = function () {
    var deptCount = Object.keys(this.unlocked).length;
    this.prestige =
      this.desks.length * CFG.prestigePerDesk +
      deptCount * CFG.prestigePerDept +
      this.decorSprites.length * CFG.prestigePerDecor +
      this.morale * CFG.prestigeMoraleWeight;

    var stars = 1;
    for (var i = 1; i < CFG.starThresholds.length; i++) {
      if (this.prestige >= CFG.starThresholds[i]) stars = i + 1;
    }
    if (stars > this.stars) {
      this.stars = stars;
      this.bannerQueue.push({ type: "star", stars: stars });
    } else if (stars < this.stars) {
      this.stars = stars;   // can regress if morale collapses
    }
    return this.stars;
  };

  Sim.prototype.isDeskActive = function (desk) {
    return this.isUnlocked(desk.deptKey);
  };

  Sim.prototype.isPrinterJammedNear = function (r, c) {
    var p = this.fixtures.printer;
    if (!p || !p.jammed) return false;
    return util.manhattan(r, c, p.r, p.c) <= CFG.printerJamRadius;
  };

  Sim.prototype.assignDesk = function (emp) {
    if (emp.desk && (emp.desk.occupiedBy === emp || emp.desk.reservedBy === emp)) {
      return true;
    }
    var best = null;
    for (var i = 0; i < this.desks.length; i++) {
      var d = this.desks[i];
      if (!this.isDeskActive(d)) continue;
      if (d.occupiedBy || d.reservedBy) continue;
      best = d;
      break;
    }
    if (!best) return false;
    best.reservedBy = emp;
    emp.desk = best;
    emp.setDest(best.workR, best.workC, "desk");
    return true;
  };

  Sim.prototype.consumeCoffee = function (emp) {
    var fx = this.fixtures.coffee;
    if (!fx) return;
    var per = CFG.coffeeDrainPerBreak;
    fx.level = Math.max(0, fx.level - per);
    this.addMorale(0.5);
    var w = this.gridToWorldX(fx.r, fx.c);
    var h = this.gridToWorldY(fx.r, fx.c);
    this.effects.text("+", w, h - 34, CFG.COLORS.good, 13);
  };

  Sim.prototype.registerDryMachine = function () {
    if (this.time - this._lastDryToast < 12) return;
    this._lastDryToast = this.time;
    var fx = this.fixtures.coffee;
    if (!fx) return;
    var w = this.gridToWorldX(fx.r, fx.c);
    var h = this.gridToWorldY(fx.r, fx.c);
    this.effects.text("OUT OF COFFEE", w, h - 52, CFG.COLORS.bad, 15);
  };

  Sim.prototype.onPrinterJam = function () {
    var p = this.fixtures.printer;
    if (!p) return;
    var w = this.gridToWorldX(p.r, p.c);
    var h = this.gridToWorldY(p.r, p.c);
    this.effects.text("PAPER JAM", w, h - 56, CFG.COLORS.bad, 15);
    this.effects.burst(w, h, CFG.COLORS.bad, 8, 34);
  };

  /* ======================================================================
     Player interactions
     ====================================================================== */

  Sim.prototype.gridToWorldX = function (r, c) {
    return (c - r) * HW;
  };
  Sim.prototype.gridToWorldY = function (r, c) {
    return (c + r) * HH;
  };

  Sim.prototype.brew = function () {
    var fx = this.fixtures.coffee;
    if (!fx || fx.brewCooldown > 0) return { ok: false, reason: "Still brewing." };
    if (fx.level >= fx.capacity * 0.985) {
      return { ok: false, reason: "Machine is already full." };
    }
    var fill = fx.capacity * (1 + this.upgrades.coffeeCap * 0.05);
    fx.level = Math.min(fx.capacity, fx.level + fill);
    fx.brewCooldown = CFG.coffeeBrewCooldown;
    fx.brewAnim = 0.5;
    this.stats.coffeesBrewed++;
    this.cash += CFG.coffeeTipCash * (1 + this.stars * 0.4);
    this.addMorale(1.4);
    var w = this.gridToWorldX(fx.r, fx.c);
    var h = this.gridToWorldY(fx.r, fx.c);
    this.effects.text("BREWED", w, h - 56, CFG.COLORS.good, 16);
    this.effects.burst(w, h, "#8a5a34", 14, 46);
    return { ok: true };
  };

  Sim.prototype.fixPrinter = function () {
    var p = this.fixtures.printer;
    if (!p || !p.jammed) return { ok: false, reason: "Nothing to fix." };
    p.clearJam(this, true);
    this.stats.jamsFixed++;
    var w = this.gridToWorldX(p.r, p.c);
    var h = this.gridToWorldY(p.r, p.c);
    this.effects.text("FIXED", w, h - 58, CFG.COLORS.info, 16);
    this.effects.burst(w, h, CFG.COLORS.info, 12, 40);
    return { ok: true };
  };

  Sim.prototype.resolveTickets = function () {
    var h = this.fixtures.helpdesk;
    if (!h || h.tickets < 1) return { ok: false, reason: "No tickets waiting." };
    var n = Math.floor(h.tickets);
    h.tickets -= n;
    h.flash = 0.6;
    var value = CFG.ticketValue * (1 + (this.upgrades.itSupport || 0) * 0.28) *
      (1 + this.stars * 0.3);
    var cash = n * value;
    this.cash += cash;
    this.addMorale(Math.min(18, n * CFG.ticketMoraleBonus));
    this.stats.ticketsResolved += n;
    var w = this.gridToWorldX(h.r, h.c);
    var hh = this.gridToWorldY(h.r, h.c);
    this.effects.text("+" + util.money(cash), w, hh - 56, CFG.COLORS.good, 17);
    this.effects.burst(w, hh, CFG.COLORS.good, 14, 48);
    return { ok: true, resolved: n, cash: cash };
  };

  Sim.prototype.motivate = function (emp) {
    if (emp.boost > 0) return { ok: false, reason: "Already motivated." };
    emp.boost = CFG.motivateDuration;
    this.stats.motiv++;
    var w = this.gridToWorldX(emp.r, emp.c);
    var h = this.gridToWorldY(emp.r, emp.c);
    this.effects.text("MOTIVATED", w, h - 52, CFG.COLORS.accent, 14);
    this.effects.burst(w, h, CFG.COLORS.accent, 10, 38);
    return { ok: true };
  };

  Sim.prototype.collectDesk = function (desk) {
    var got = desk.collect(this);
    if (got <= 0) return { ok: false, reason: "Nothing banked yet." };
    var w = this.gridToWorldX(desk.r, desk.c);
    var h = this.gridToWorldY(desk.r, desk.c);
    this.effects.text("+" + util.money(got), w, h - 44, CFG.COLORS.good, 16);
    this.effects.burst(w, h, CFG.COLORS.warn, 8, 32);
    return { ok: true, cash: got };
  };

  /** Sweeps every desk - used by the "Collect All" button. */
  Sim.prototype.collectAll = function () {
    var total = 0, n = 0;
    for (var i = 0; i < this.desks.length; i++) {
      var got = this.desks[i].collect(this);
      if (got > 0) { total += got; n++; }
    }
    return { total: total, desks: n };
  };

  /* ---- hit testing ----------------------------------------------------- */

  Sim.prototype.screenRect = function (view, sheet, frameKey, wx, wy) {
    var fr = view.frame(sheet, frameKey);
    if (!fr) return null;
    var meta = view.sheet(sheet);
    var s = view.worldToScreen(wx, wy);
    var z = view.zoom;
    return {
      x: s.x - meta.anchor[0] * z,
      y: s.y - meta.anchor[1] * z,
      w: fr.w * z,
      h: fr.h * z
    };
  };

  function inRect(rect, x, y, pad) {
    pad = pad || 0;
    return x >= rect.x - pad && x <= rect.x + rect.w + pad &&
      y >= rect.y - pad && y <= rect.y + rect.h + pad;
  }

  /**
   * Resolves a screen tap to a game action.
   * Priority: actionable fixture > desk with banked cash > employee > fixture.
   * Fixtures win because they are the time-critical decisions.
   */
  Sim.prototype.pick = function (view, sx, sy) {
    var i, wx, wy, rect;

    // 1. actionable fixtures
    var keys = Object.keys(this.fixtures);
    for (i = 0; i < keys.length; i++) {
      var f = this.fixtures[keys[i]];
      if (!f.isActionable()) continue;
      wx = this.gridToWorldX(f.r, f.c);
      wy = this.gridToWorldY(f.r, f.c);
      rect = this.screenRect(view, "objects", f.sprite(), wx, wy);
      if (rect && inRect(rect, sx, sy, 6)) {
        return { kind: "fixture", fixture: f };
      }
    }

    // 2. desks holding money
    for (i = 0; i < this.desks.length; i++) {
      var d = this.desks[i];
      if (d.pending < 0.6) continue;
      wx = this.gridToWorldX(d.r, d.c);
      wy = this.gridToWorldY(d.r, d.c);
      rect = this.screenRect(view, "objects", d.spriteKey, wx, wy);
      if (rect && inRect(rect, sx, sy, 4)) {
        return { kind: "desk", desk: d };
      }
    }

    // 3. employees
    for (i = 0; i < this.employees.length; i++) {
      var e = this.employees[i];
      wx = this.gridToWorldX(e.r, e.c);
      wy = this.gridToWorldY(e.r, e.c);
      rect = this.screenRect(view, "chars", e.sprite(), wx, wy);
      if (rect && inRect(rect, sx, sy, 2)) {
        return { kind: "employee", employee: e };
      }
    }

    // 4. any fixture at all (for feedback on non-actionable taps)
    for (i = 0; i < keys.length; i++) {
      var f2 = this.fixtures[keys[i]];
      wx = this.gridToWorldX(f2.r, f2.c);
      wy = this.gridToWorldY(f2.r, f2.c);
      rect = this.screenRect(view, "objects", f2.sprite(), wx, wy);
      if (rect && inRect(rect, sx, sy, 4)) {
        return { kind: "fixture", fixture: f2 };
      }
    }

    // 5. tile under the pointer (used by build mode)
    var g = view.screenToGrid(sx, sy);
    return {
      kind: "tile",
      r: Math.round(g.row),
      c: Math.round(g.col),
      fr: g.row,
      fc: g.col
    };
  };

  Sim.prototype.act = function (view, sx, sy) {
    var hit = this.pick(view, sx, sy);
    this.stats.taps++;
    if (!hit) return { ok: false, hit: null };

    var res = { ok: false, hit: hit };
    switch (hit.kind) {
      case "fixture":
        if (hit.fixture.kind === "coffee") res = this.brew();
        else if (hit.fixture.kind === "printer") res = this.fixPrinter();
        else if (hit.fixture.kind === "helpdesk") res = this.resolveTickets();
        else res = { ok: false, reason: "Nothing to do here." };
        break;
      case "desk":
        res = this.collectDesk(hit.desk);
        break;
      case "employee":
        res = this.motivate(hit.employee);
        break;
      case "tile":
        res = { ok: false, reason: "empty", tile: hit };
        break;
    }
    res.hit = hit;
    return res;
  };

  /* ======================================================================
     Persistence
     ====================================================================== */

  Sim.prototype.serialize = function () {
    var self = this;
    return {
      v: 1,
      ts: Date.now(),
      cash: this.cash,
      earned: this.earned,
      earnedToday: this.earnedToday,
      autoCollected: this.autoCollected,
      tapCollected: this.tapCollected,
      spent: this.spent,
      morale: this.morale,
      stars: this.stars,
      day: this.day,
      dayTime: this.dayTime,
      upgrades: this.upgrades,
      unlocked: this.unlocked,
      decor: this.decor,
      decorSprites: this.decorSprites,
      stats: this.stats,
      employeeCount: this.employeeCount,
      applicantTimer: this.applicantTimer,
      desks: this.desks.map(function (d) {
        return {
          deptKey: d.deptKey, r: d.r, c: d.c, level: d.level,
          pending: d.pending, spriteKey: d.spriteKey
        };
      }),
      employees: this.employees.map(function (e) {
        return { archetype: e.archetype, level: e.level, morale: e.morale };
      }),
      coffee: this.fixtures.coffee ? this.fixtures.coffee.level : 0,
      printerJam: this.fixtures.printer ? this.fixtures.printer.jammed : false,
      tickets: this.fixtures.helpdesk ? this.fixtures.helpdesk.tickets : 0
    };
  };

  Sim.prototype.deserialize = function (data) {
    if (!data || data.v !== 1) return false;
    this._initWorld();

    this.desks.length = 0;
    this.employees.length = 0;
    this.decorSprites.length = 0;

    this.cash = data.cash;
    this.earned = data.earned || 0;
    this.earnedToday = data.earnedToday || 0;
    this.autoCollected = data.autoCollected || 0;
    this.tapCollected = data.tapCollected || 0;
    this.spent = data.spent || 0;
    this.morale = data.morale;
    this.stars = data.stars || 1;
    this.day = data.day || 1;
    this.dayTime = data.dayTime || 0;
    this.employeeCount = data.employeeCount || 0;
    this.applicantTimer = data.applicantTimer || CFG.applicantTimer;

    for (var k in data.upgrades) {
      if (k in this.upgrades) this.upgrades[k] = data.upgrades[k];
    }
    for (var s in data.stats) {
      if (s in this.stats) this.stats[s] = data.stats[s];
    }

    this.unlocked = { eng: true };
    for (var u in data.unlocked) if (data.unlocked[u]) this.unlocked[u] = true;

    for (var dk in this.decor) this.decor[dk] = 0;
    for (var dk2 in data.decor) {
      if (dk2 in this.decor) this.decor[dk2] = data.decor[dk2];
    }

    var desks = data.desks || [];
    for (var d = 0; d < desks.length; d++) {
      var dd = desks[d];
      if (this.grid.isSolid(dd.r, dd.c)) continue;
      var desk = new C.Desk(dd.deptKey, dd.r, dd.c, dd.spriteKey);
      desk.level = dd.level || 1;
      desk.pending = dd.pending || 0;
      this.desks.push(desk);
      this.grid.setSolid(dd.r, dd.c, true);
    }

    var decs = data.decorSprites || [];
    for (var n = 0; n < decs.length; n++) {
      var inst = decs[n];
      this.decorSprites.push({
        key: inst.key, sprite: inst.sprite, r: inst.r, c: inst.c,
        morale: inst.morale, prestige: inst.prestige
      });
      if (inst.sprite !== "rug_warm" && inst.sprite !== "rug_cool") {
        this.grid.setSolid(inst.r, inst.c, true);
      }
    }

    var emps = data.employees || [];
    for (var e2 = 0; e2 < emps.length; e2++) {
      var emp = new C.Employee(emps[e2].archetype, this.spawnTile);
      emp.level = emps[e2].level || 1;
      emp.coffeeTimer = CFG.breakInterval * (0.3 + this.rng() * 0.7);
      this.employees.push(emp);
    }
    this.employeeCount = this.employees.length;

    if (this.fixtures.coffee) {
      var cap = this.fixtures.coffee.capacity;
      this.fixtures.coffee.level = util.clamp(
        data.coffee === undefined ? cap : data.coffee, 0, cap
      );
    }
    if (this.fixtures.printer) this.fixtures.printer.jammed = !!data.printerJam;
    if (this.fixtures.helpdesk) this.fixtures.helpdesk.tickets = data.tickets || 0;

    this.recomputeRating();
    return true;
  };

  Sim.prototype.score = function () {
    return Math.round(this.earned);
  };

  C.Sim = Sim;
})(window);
