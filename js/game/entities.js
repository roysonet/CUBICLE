/* ==========================================================================
   CUBICLE :: game/entities.js
   Employee / Desk / Fixture / Effects.

   Employee is a finite state machine, mirroring the FSM the REA reconstructed
   from the original's "How To Play". The interrupt points are where the
   player's taps land:

       work --(coffee timer fires)--> walk to machine --> drink --> work
       work --(desk gone)---------> leave

   A dry coffee machine does not block the walk; it makes the break take
   longer and drains global morale, which is what turns "tap the machine"
   from a chore into a decision.
   ========================================================================== */
(function (root) {
  "use strict";
  var C = (root.CUBICLE = root.CUBICLE || {});
  var util = C.util;

  /* ======================================================================
     Employee
     ====================================================================== */

  var nextId = 1;

  function Employee(archetype, spawn) {
    this.id = nextId++;
    this.archetype = archetype;
    this.r = spawn.r;
    this.c = spawn.c;
    this.dest = null;
    this.destKind = null;
    this.next = null;
    this.state = "spawn";
    this.timer = 0.5;
    this.dir = "down";
    this.animTime = 0;
    this.frame = 4;
    this.speed = C.CFG.employeeSpeed;
    this.desk = null;
    this.coffeeTimer = 0;
    this.level = 1;
    this.bias = (this.id * 7) % 4;
    this.boost = 0;
    this.morale = 70;
    this.sinceHire = 0;
    this.salary = C.CFG.payrollPerEmployee;
    this.bobPhase = Math.random() * Math.PI * 2;
    this.blockedTime = 0;
  }

  Employee.prototype.setDest = function (r, c, kind) {
    this.dest = { r: r, c: c };
    this.destKind = kind;
    this.next = null;
    this.state = "walk";
  };

  Employee.prototype.atDest = function () {
    return this.dest && this.r === this.dest.r && this.c === this.dest.c;
  };

  Employee.prototype.goToCoffee = function (sim) {
    var fx = sim.fixtures.coffee;
    if (!fx || !fx.useTile) return false;
    this.setDest(fx.useTile.r, fx.useTile.c, "coffee");
    return true;
  };

  Employee.prototype.returnToDesk = function () {
    if (!this.desk) return false;
    this.setDest(this.desk.workR, this.desk.workC, "desk");
    return true;
  };

  Employee.prototype.leave = function (sim) {
    this.desk = null;
    var fx = sim.fixtures.elevator;
    var t = fx && fx.useTile ? fx.useTile : sim.spawnTile;
    this.setDest(t.r, t.c, "exit");
  };

  /** Chooses the walk direction from the *screen-space* delta, not the grid. */
  Employee.prototype.faceFromDelta = function (dr, dc) {
    var dx = (dc - dr) * (C.CFG.TILE_W / 2);
    var dy = (dc + dr) * (C.CFG.TILE_H / 2);
    if (Math.abs(dx) > Math.abs(dy)) this.dir = dx > 0 ? "right" : "left";
    else this.dir = dy > 0 ? "down" : "up";
  };

  Employee.prototype.move = function (dt, grid) {
    if (!this.next) {
      var rr = Math.round(this.r), rc = Math.round(this.c);
      var step = grid.nextStep(rr, rc, this.dest.r, this.dest.c, this.bias);
      if (!step) {
        // Unreachable: retry from the nearest walkable tile, then give up.
        this.blockedTime += dt;
        if (this.blockedTime > 2.5) {
          var near = grid.nearestWalkable(rr, rc);
          if (near && (near.r !== rr || near.c !== rc)) {
            this.r = near.r; this.c = near.c; this.blockedTime = 0;
          } else {
            this.dest = null; this.blockedTime = 0;
            this.onStuck && this.onStuck();
          }
        }
        return;
      }
      this.blockedTime = 0;
      this.next = step;
    }

    var speed = this.speed * (this.boost > 0 ? 1.35 : 1);
    var stepLen = speed * dt;
    var dr = this.next.r - this.r;
    var dc = this.next.c - this.c;
    var len = Math.abs(dr) + Math.abs(dc);   // 4-neighbour: always 1

    if (len <= 1e-6) { this.next = null; return; }
    this.faceFromDelta(Math.sign(dr), Math.sign(dc));

    if (stepLen >= len) {
      this.r = this.next.r;
      this.c = this.next.c;
      this.next = null;
    } else {
      this.r += (dr / len) * stepLen;
      this.c += (dc / len) * stepLen;
    }
  };

  Employee.prototype.update = function (dt, sim) {
    this.sinceHire += dt;
    if (this.boost > 0) this.boost -= dt;

    switch (this.state) {
      case "spawn":
        this.timer -= dt;
        this.frame = 4;
        if (this.timer <= 0) {
          if (!sim.assignDesk(this)) this.leave(sim);
        }
        break;

      case "walk":
        if (this.dest) {
          if (this.atDest()) {
            this.onArrive(sim);
          } else {
            this.move(dt, sim.grid);
            this.animTime += dt * 7.2;
            this.frame = Math.floor(this.animTime) % 4;
          }
        } else {
          if (!sim.assignDesk(this)) this.leave(sim);
        }
        break;

      case "work":
        this.frame = 4;
        if (!this.desk || !sim.isDeskActive(this.desk)) {
          if (!sim.assignDesk(this)) this.leave(sim);
          break;
        }
        this.coffeeTimer -= dt;
        if (this.coffeeTimer <= 0) {
          this.coffeeTimer = C.CFG.breakInterval +
            Math.random() * C.CFG.breakIntervalJitter;
          if (!this.goToCoffee(sim)) {
            // No machine at all: just take a short in-place breather.
            this.timer = 2;
          }
        }
        break;

      case "coffee":
        this.frame = 4;
        this.timer -= dt;
        if (this.timer <= 0) {
          if (!this.desk) this.leave(sim);
          else this.returnToDesk();
        }
        break;

      case "leave":
        if (this.dest && !this.atDest()) {
          this.move(dt, sim.grid);
          this.animTime += dt * 7.2;
          this.frame = Math.floor(this.animTime) % 4;
        } else {
          this.dead = true;
        }
        break;
    }
  };

  Employee.prototype.onArrive = function (sim) {
    if (this.destKind === "desk") {
      this.state = "work";
      if (this.desk) {
        this.desk.occupiedBy = this;
        this.desk.reservedBy = null;
      }
    } else if (this.destKind === "coffee") {
      this.state = "coffee";
      var fx = sim.fixtures.coffee;
      var ok = fx && fx.level > 0;
      this.timer = ok ? C.CFG.breakDrinkTime : C.CFG.breakDryTime;
      if (ok) sim.consumeCoffee(this);
      else sim.registerDryMachine();
    } else if (this.destKind === "exit") {
      this.dead = true;
    }
    this.dest = null;
    this.destKind = null;
  };

  Employee.prototype.sprite = function () {
    return C.Assets.characterFrame(this.archetype, this.dir, this.frame);
  };

  Employee.prototype.draw = function (view, sim) {
    var w = view.gridToWorld(this.r, this.c);
    var bob = this.state === "walk"
      ? Math.sin(this.bobPhase + this.animTime * 1.9) * 1.1 : 0;
    view.shadow(w.x, w.y, 11, 0.15);

    if (this.boost > 0) {
      view.filledRing(w.x, w.y, 15, C.CFG.COLORS.accent, 0.22);
    }

    view.push("chars", this.sprite(), w.x, w.y - bob, this.r + this.c);

    // Coffee-break employees get a small cup pip so the player can see who is
    // away from their desk without opening a panel.
    if (this.state === "coffee" && sim.settings.showPips) {
      var s = view.worldToScreen(w.x, w.y);
      var ctx = view.ctx;
      var size = 16 * util.clamp(view.zoom, 0.8, 1.4);
      var img = C.Assets.images.icons;
      var fr = view.frame("icons", "coffee");
      if (img && fr) {
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.drawImage(img, fr.x, fr.y, fr.w, fr.h,
          s.x - size / 2, s.y - 60 * view.zoom, size, size);
        ctx.restore();
      }
    }
  };

  /* ======================================================================
     Desk
     ====================================================================== */

  function Desk(deptKey, r, c, spriteKey) {
    this.id = "desk_" + r + "_" + c;
    this.deptKey = deptKey;
    this.r = r;
    this.c = c;
    this.workR = r + 1;
    this.workC = c + 1;
    this.level = 1;
    this.pending = 0;
    this.occupiedBy = null;
    this.spriteKey = spriteKey || "desk_a";
    this.pulse = 0;
  }

  /** Effective $/s for this desk right now. */
  Desk.prototype.rate = function (sim) {
    var emp = this.occupiedBy;
    if (!emp || emp.state !== "work") return 0;
    var cfg = C.CFG;
    var lvl = 1 + (this.level - 1) * cfg.deskLevelStep;
    var ergo = 1 + sim.upgrades.ergonomics * 0.14;
    var boost = emp.boost > 0 ? cfg.motivateMultiplier : 1;
    var jam = sim.isPrinterJammedNear(this.r, this.c)
      ? cfg.printerJamOutputMult : 1;
    return cfg.baseOutput * lvl * ergo * boost * jam * sim.revenueMultiplier();
  };

  Desk.prototype.update = function (dt, sim) {
    var earn = this.rate(sim) * dt;
    if (earn > 0) {
      this.pending = Math.min(C.CFG.pendingCap, this.pending + earn);
      sim.earned += earn;
    }
    if (this.pending > 0) {
      var auto = this.pending * C.CFG.pendingDrain * dt;
      this.pending -= auto;
      sim.cash += auto;
      sim.autoCollected += auto;
    }
    if (this.pulse > 0) this.pulse -= dt;
  };

  /** Player tapped the desk: collect everything plus a bonus. */
  Desk.prototype.collect = function (sim) {
    if (this.pending <= 0.01) return 0;
    var got = this.pending * (1 + C.CFG.tapCollectBonus);
    this.pending = 0;
    this.pulse = 0.45;
    sim.cash += got;
    sim.tapCollected += got;
    return got;
  };

  Desk.prototype.draw = function (view) {
    var w = view.gridToWorld(this.r, this.c);
    if (this.pulse > 0) {
      view.filledRing(w.x, w.y, 20, C.CFG.COLORS.good, this.pulse * 0.5);
    }
    if (this.pending > 0.5) {
      view.filledRing(w.x, w.y, 16 + Math.min(10, this.pending / 22),
        C.CFG.COLORS.warn, 0.16);
    }
    view.push("objects", this.spriteKey, w.x, w.y, this.r + this.c);
  };

  /* ======================================================================
     Fixture
     ====================================================================== */

  function Fixture(def) {
    this.id = def.id;
    this.kind = def.kind;
    this.spriteKey = def.sprite;
    this.r = def.r;
    this.c = def.c;
    this.useTile = null;
    this.interactive = !!def.interactive;
    this.spawn = !!def.spawn;

    // coffee
    this.level = C.CFG.coffeeCapacity;
    this.capacity = C.CFG.coffeeCapacity;
    this.brewCooldown = 0;
    this.brewAnim = 0;

    // printer
    this.jammed = false;
    this.jamTimer = 30 + Math.random() * 40;

    // helpdesk
    this.tickets = 0;
    this.flash = 0;

    this.bobPhase = Math.random() * Math.PI * 2;
  }

  Fixture.prototype.sprite = function () {
    if (this.kind === "coffee") {
      var f = this.level / this.capacity;
      if (f > 0.6) return "coffee_full";
      if (f > 0.18) return "coffee_half";
      return "coffee_empty";
    }
    if (this.kind === "printer") {
      return this.jammed ? "printer_jam" : "printer_ok";
    }
    return this.spriteKey;
  };

  Fixture.prototype.isActionable = function () {
    if (this.kind === "coffee") return this.level < this.capacity * 0.985 &&
      this.brewCooldown <= 0;
    if (this.kind === "printer") return this.jammed;
    if (this.kind === "helpdesk") return this.tickets >= 1;
    return false;
  };

  Fixture.prototype.update = function (dt, sim) {
    if (this.brewCooldown > 0) this.brewCooldown -= dt;
    if (this.brewAnim > 0) this.brewAnim -= dt;
    if (this.flash > 0) this.flash -= dt;

    if (this.kind === "printer") {
      if (this.jammed) {
        // A jam clears itself eventually, but slowly - tapping is far better.
        this.jamTimer -= dt;
        if (this.jamTimer <= 0) this.clearJam(sim, false);
      } else {
        this.jamTimer -= dt;
        if (this.jamTimer <= 0) {
          this.jammed = true;
          this.jamTimer = 22 + Math.random() * 26;
          sim.onPrinterJam();
        }
      }
    }
  };

  Fixture.prototype.clearJam = function (sim, byPlayer) {
    this.jammed = false;
    var relief = 1 - sim.upgrades.printerRel * 0.13;
    this.jamTimer = (C.CFG.printerJamMin +
      Math.random() * (C.CFG.printerJamMax - C.CFG.printerJamMin)) * relief;
    if (byPlayer) {
      this.flash = 0.6;
      sim.cash += C.CFG.printerFixCash * (1 + sim.stars * 0.35);
      sim.addMorale(2.2);
    }
  };

  Fixture.prototype.draw = function (view, sim) {
    var w = view.gridToWorld(this.r, this.c);
    var bob = 0;
    if (this.kind === "coffee" && this.brewAnim > 0) {
      bob = Math.sin(this.brewAnim * 22) * 1.6;
    }
    if (this.kind === "printer" && this.jammed) {
      bob = Math.sin(sim.time * 12) * 1.2;
    }
    view.push("objects", this.sprite(), w.x, w.y + bob, this.r + this.c);

    // Action affordance: a pulsing ring on the floor plus a floating icon.
    if (this.isActionable()) {
      var t = (sim.time * 1.6) % 1;
      var pulse = 0.55 + 0.45 * Math.sin(sim.time * 5);
      view.ring(w.x, w.y, 22 + t * 14, C.CFG.COLORS.accent, (1 - t) * 0.5 * pulse, 2.4);

      var icon = this.kind === "coffee" ? "coffee"
        : this.kind === "printer" ? "printer" : "ticket";
      var s = view.worldToScreen(w.x, w.y);
      var img = C.Assets.images.icons;
      var fr = view.frame("icons", icon);
      if (img && fr) {
        var ctx = view.ctx;
        var size = 30 * util.clamp(view.zoom, 0.8, 1.5);
        var yy = s.y - 64 * view.zoom + Math.sin(sim.time * 4) * 3;
        ctx.save();
        ctx.globalAlpha = pulse;
        ctx.drawImage(img, fr.x, fr.y, fr.w, fr.h,
          s.x - size / 2, yy - size / 2, size, size);
        ctx.restore();
      }
    }
  };

  /* ======================================================================
     Effects: floating text + particle bursts
     ====================================================================== */

  function Effects() {
    this.texts = [];
    this.parts = [];
  }

  Effects.prototype.text = function (str, wx, wy, color, size) {
    if (this.texts.length > 90) this.texts.shift();
    this.texts.push({
      str: str, x: wx, y: wy, vy: -34,
      life: 1.15, max: 1.15, color: color || C.CFG.COLORS.ink,
      size: size || 15, drift: (Math.random() - 0.5) * 26
    });
  };

  Effects.prototype.burst = function (wx, wy, color, count, spread) {
    count = count || 8;
    spread = spread || 44;
    if (this.parts.length > 420) return;
    for (var i = 0; i < count; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = 16 + Math.random() * spread;
      this.parts.push({
        x: wx, y: wy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * 0.5 - 26,
        life: 0.5 + Math.random() * 0.5,
        max: 1,
        color: color,
        size: 2 + Math.random() * 2.5
      });
    }
  };

  Effects.prototype.update = function (dt) {
    var i;
    for (i = this.texts.length - 1; i >= 0; i--) {
      var t = this.texts[i];
      t.life -= dt;
      t.y += t.vy * dt;
      t.x += t.drift * dt;
      t.vy += 42 * dt;
      if (t.life <= 0) util.swapRemove(this.texts, i);
    }
    for (i = this.parts.length - 1; i >= 0; i--) {
      var p = this.parts[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 190 * dt;
      if (p.life <= 0) util.swapRemove(this.parts, i);
    }
  };

  Effects.prototype.draw = function (view) {
    var i, s;
    var ctx = view.ctx;
    for (i = 0; i < this.parts.length; i++) {
      var p = this.parts[i];
      s = view.worldToScreen(p.x, p.y);
      ctx.save();
      ctx.globalAlpha = util.clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(s.x), Math.round(s.y),
        p.size * view.zoom, p.size * view.zoom);
      ctx.restore();
    }
    for (i = 0; i < this.texts.length; i++) {
      var t = this.texts[i];
      var k = util.clamp(t.life / t.max, 0, 1);
      var scale = 1 + (1 - k) * 0.12;
      view.text(t.str, t.x, t.y, {
        color: t.color,
        size: t.size * scale,
        alpha: k > 0.35 ? 1 : k / 0.35
      });
    }
  };

  Effects.prototype.clear = function () {
    this.texts.length = 0;
    this.parts.length = 0;
  };

  C.Employee = Employee;
  C.Desk = Desk;
  C.Fixture = Fixture;
  C.Effects = Effects;
})(window);
