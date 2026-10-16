/* ==========================================================================
   CUBICLE :: game/game.js
   Orchestrator: boots assets, owns the loop, renders the world, drives UI.

   Scene states:
       boot -> title -> playing <-> paused
                          |
                          +-> summary (end of day) -> playing
   ========================================================================== */
(function (root) {
  "use strict";
  var C = (root.CUBICLE = root.CUBICLE || {});
  var util = C.util;
  var CFG = C.CFG;

  var HW = CFG.TILE_W / 2;
  var HH = CFG.TILE_H / 2;

  function Game() {
    this.canvas = null;
    this.view = null;
    this.input = null;
    this.loop = null;
    this.sim = null;
    this.ui = null;

    this.scene = "boot";
    this.options = C.Save.readOptions();
    this.autosaveTimer = 0;
    this.perimeter = [];
    this.deptAt = null;      // Int8Array of dept index per tile
    this.hoverTile = null;
    this.showGrid = false;
    this._lastToastKey = "";
    this._lastToastAt = 0;
  }

  /* ======================================================================
     Boot
     ====================================================================== */

  Game.prototype.boot = function () {
    var self = this;
    this.canvas = root.document.getElementById("stage");

    C.Assets.init("assets/sprites/");

    var bootMsg = root.document.getElementById("boot-status");
    if (bootMsg) bootMsg.textContent = "Loading sprite atlas...";

    return C.Assets.load(function (done, total, name) {
      if (bootMsg) bootMsg.textContent = "Loading " + name + " (" + done + "/" + total + ")";
    }).then(function () {
      self.setup();
    });
  };

  Game.prototype.setup = function () {
    var self = this;

    this.view = new C.View(this.canvas, C.Assets.atlas);
    var sheets = Object.keys(C.Assets.images);
    for (var i = 0; i < sheets.length; i++) {
      this.view.setImage(sheets[i], C.Assets.images[sheets[i]]);
    }

    this.sim = new C.Sim();
    this.sim.buildWorld();

    var b = this.sim.worldBounds();
    this.view.setWorldBounds(b.minX, b.minY, b.maxX, b.maxY);
    this.resize();

    this._indexDepartments();
    this._buildPerimeter();

    this.input = new C.Input(this.canvas);
    this._bindInput();

    this.loop = new C.Loop({
      fixedStep: CFG.tick,
      onFixed: function (dt) { self.fixedUpdate(dt); },
      onRender: function (dt, scaled) { self.render(dt, scaled); }
    });

    this.ui = new C.UI(this);
    this.ui.build();
    this.resize();   // apply the UI's reserved padding to the camera

    C.Audio.setOptions(this.options);

    var save = C.Save.read();
    if (save) {
      this.sim.deserialize(save);
      this.ui.toast("Save loaded", "Day " + this.sim.day + " restored.", "info");
      this.showScene("playing");
    } else {
      this.showScene("title");
    }

    this.loop.start();

    root.addEventListener("resize", function () { self.resize(); });
    root.document.addEventListener("visibilitychange", function () {
      if (root.document.hidden) self.save();
    });
    root.addEventListener("beforeunload", function () { self.save(); });

    // Re-render the HUD even while paused so timers stay honest.
    root.setInterval(function () { if (self.ui) self.ui.syncHud(); }, 200);
  };

  Game.prototype.resize = function () {
    this.view.resize();
    var u = this.ui ? this.ui.padding() : { left: 0, right: 0, top: 0, bottom: 0 };
    this.view.setPadding(u);

    // A 1536x768 isometric world cannot be shown legibly in an 844x390
    // landscape phone viewport. On narrow screens we deliberately over-fill so
    // the office stays readable and the player pans, rather than shrinking the
    // whole floor to an unreadable speck.
    this.view.fitFill = root.innerWidth < 900 ? 1.8 : 1.08;
    this.view.fitZoom = this.view.computeFitZoom();
    this.view.minZoom = Math.min(this.view.minZoom, this.view.fitZoom * 0.55);

    // Re-fit whenever the usable area changes and the player has not taken
    // manual control of the zoom, otherwise the UI panels silently crop the
    // office after the first layout pass.
    if (this.view.autoFit) this.view.fit();
    else this.view.clamp();
  };

  /** Precomputes dept membership and the floor's outer ring. */
  Game.prototype._indexDepartments = function () {
    var depts = CFG.DEPARTMENTS;
    this.deptAt = new Int8Array(CFG.COLS * CFG.ROWS);
    this.deptAt.fill(-1);
    for (var d = 0; d < depts.length; d++) {
      var R = depts[d].rect;
      for (var r = R.r0; r <= R.r1; r++) {
        for (var c = R.c0; c <= R.c1; c++) {
          this.deptAt[r * CFG.COLS + c] = d;
        }
      }
    }
  };

  Game.prototype._buildPerimeter = function () {
    var F = CFG.FLOOR;
    this.perimeter.length = 0;
    for (var r = F.r0; r <= F.r1; r++) {
      for (var c = F.c0; c <= F.c1; c++) {
        var edge =
          r === F.r0 || r === F.r1 || c === F.c0 || c === F.c1;
        if (edge) this.perimeter.push({ r: r, c: c });
      }
    }
  };

  Game.prototype.deptIndexAt = function (r, c) {
    if (r < 0 || c < 0 || r >= CFG.ROWS || c >= CFG.COLS) return -1;
    return this.deptAt[r * CFG.COLS + c];
  };

  /* ======================================================================
     Input
     ====================================================================== */

  Game.prototype._bindInput = function () {
    var self = this;
    var input = this.input;

    input.on("tap", function (p) {
      C.Audio.unlock();
      if (self.scene !== "playing") return;
      var res = self.sim.act(self.view, p.x, p.y);
      self._reactToAction(res);
    });

    input.on("drag", function (p) {
      if (self.scene === "playing") self.view.panByScreen(p.dx, p.dy);
    });

    input.on("hover", function (p) {
      if (self.scene !== "playing") return;
      var g = self.view.screenToGrid(p.x, p.y);
      self.hoverTile = { r: Math.round(g.row), c: Math.round(g.col) };
    });

    input.on("wheel", function (p) {
      self.view.zoomBy(p.delta > 0 ? 0.9 : 1.1, p.x, p.y);
    });

    input.on("pinch", function (p) {
      self.view.zoomBy(p.scale, p.cx, p.cy);
    });

    input.on("key", function (p) {
      self._onKey(p.key, p.event);
    });
  };

  Game.prototype._reactToAction = function (res) {
    if (!res) return;
    var hit = res.hit;
    var kind = hit && hit.kind;

    if (res.ok) {
      if (kind === "fixture") {
        var k = hit.fixture.kind;
        if (k === "coffee") C.Audio.play("brew");
        else if (k === "printer") C.Audio.play("repair");
        else C.Audio.play("ticket");
      } else if (kind === "desk") {
        C.Audio.play("cash");
        this.view.addShake(1.6);
      } else if (kind === "employee") {
        C.Audio.play("motivate");
      }
      return;
    }

    // Feedback for taps that did nothing useful.
    if (kind === "fixture") {
      if (res.reason) this.ui.toast("Nothing to do", res.reason, "warn", 1400);
      C.Audio.play("click");
    } else if (kind === "desk") {
      C.Audio.play("click");
    } else if (kind === "employee") {
      this.ui.toast("Already motivated", "Give them a moment.", "warn", 1400);
    } else {
      C.Audio.play("tap");
    }
  };

  Game.prototype._onKey = function (key, ev) {
    var ui = this.ui;
    if (key === " " || key === "p") {
      if (ev) ev.preventDefault();
      this.togglePause();
    } else if (key === "escape") {
      if (ui) ui.closeAll();
    } else if (key === "f") {
      this.toggleFullscreen();
    } else if (key === "r") {
      this.view.fit();
      if (ui) ui.toast("View reset", "Camera re-fitted to the office.", "info", 1400);
    } else if (key === "m") {
      this.options.muted = !this.options.muted;
      C.Audio.setOptions(this.options);
      C.Save.writeOptions(this.options);
      if (ui) ui.syncSettings();
    } else if (key === "b") {
      if (ui) ui.toggleShop();
    } else if (key === "c") {
      this.doCollectAll();
    } else if (key === "1" || key === "2" || key === "3") {
      this.loop.setSpeed(parseInt(key, 10));
      if (ui) ui.syncSpeed();
    } else if (key === "0") {
      this.loop.setSpeed(0);
      if (ui) ui.syncSpeed();
    }
  };

  /* ======================================================================
     Scene control
     ====================================================================== */

  /**
   * Single entry point for scene changes.
   * UI code must call THIS, never UI.showScene directly - otherwise Game.scene
   * drifts from the DOM and the simulation silently stops ticking.
   */
  Game.prototype.showScene = function (name) {
    if (this.scene === "playing" && name !== "playing") {
      this._resumeSpeed = this.loop.speed || 1;
    }
    this.scene = name;
    if (this.ui) this.ui.showScene(name);
    this.loop.setSpeed(name === "playing" ? (this._resumeSpeed || 1) : 0);
  };

  Game.prototype.togglePause = function () {
    if (this.scene === "playing") {
      this.showScene("paused");
    } else if (this.scene === "paused") {
      this.showScene("playing");
    }
  };

  Game.prototype.toggleFullscreen = function () {
    var el = root.document.documentElement;
    if (!root.document.fullscreenElement) {
      if (el.requestFullscreen) el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } else {
      if (root.document.exitFullscreen) root.document.exitFullscreen();
    }
  };

  Game.prototype.newGame = function () {
    this.sim = new C.Sim();
    this.sim.buildWorld();
    var b = this.sim.worldBounds();
    this.view.setWorldBounds(b.minX, b.minY, b.maxX, b.maxY);
    this.view.fit();
    C.Save.clear();
    this.ui.rebuild();
    this.ui.toast("New office", "Day 1. Tap the coffee machine when it runs dry.", "good");
    this.showScene("playing");
    C.Audio.play("unlock");
  };

  Game.prototype.save = function () {
    if (!this.sim || this.scene === "title") return;
    var ok = C.Save.write(this.sim.serialize());
    if (this.ui && this.ui.autosaveIndicator) {
      this.ui.autosaveIndicator(ok);
    }
  };

  Game.prototype.doCollectAll = function () {
    var res = this.sim.collectAll();
    if (res.total <= 0) {
      this.ui.toast("Nothing banked", "Desks are still producing.", "warn", 1400);
      return;
    }
    C.Audio.play("cash");
    this.ui.toast("Collected", util.money(res.total) + " from " +
      util.plural(res.desks, "desk"), "good", 1800);
  };

  /* ======================================================================
     Simulation tick
     ====================================================================== */

  Game.prototype.fixedUpdate = function (dt) {
    if (this.scene !== "playing") return;
    this.sim.update(dt);

    // Drain banners produced by the sim into UI notifications.
    while (this.sim.bannerQueue.length) {
      var b = this.sim.bannerQueue.shift();
      this._handleBanner(b);
    }

    this.autosaveTimer += dt;
    if (this.autosaveTimer > 8) {
      this.autosaveTimer = 0;
      this.save();
    }
  };

  Game.prototype._handleBanner = function (b) {
    if (b.type === "star") {
      C.Audio.play("star");
      this.ui.toast("Rating up", b.stars + " star office", "good", 3200);
      this.view.addShake(4);
    } else if (b.type === "dayEnd") {
      C.Audio.play("levelup");
      this.ui.showDaySummary(b);
    }
  };

  /* ======================================================================
     Render
     ====================================================================== */

  Game.prototype.render = function (dt, scaled) {
    if (this.scene === "boot") return;

    var view = this.view;
    var sim = this.sim;

    view.update(dt);
    if (this.scene === "playing") C.Audio.update(dt);

    // Keyboard camera panning.
    if (this.scene === "playing") {
      var mv = this.input.moveVector();
      if (mv.x || mv.y) view.panByKeys(mv.x, mv.y, dt);
    }

    view.beginFrame("#d9cfbe");
    this._drawFloor(view, sim);
    this._drawHover(view);
    this._drawSorted(view, sim);
    view.flush();
    sim.effects.draw(view);
    this._drawOverlayHints(view, sim);
  };

  Game.prototype._tileFrame = function (r, c) {
    var di = this.deptIndexAt(r, c);
    if (di >= 0) {
      var dept = CFG.DEPARTMENTS[di];
      return this.sim.isUnlocked(dept.key) ? dept.carpet : "floor_locked";
    }
    var lastCorridor = CFG.CORRIDOR_ROWS[CFG.CORRIDOR_ROWS.length - 1];
    return r > lastCorridor ? "floor_check" : "floor_mid";
  };

  Game.prototype._drawFloor = function (view, sim) {
    // The floor only changes when a department unlocks, so it is baked once
    // into an offscreen layer. Drawing ~730 tiles per frame was the single
    // biggest cost in the render pass.
    var key = Object.keys(sim.unlocked).join(",");
    if (!this._floorCanvas || key !== this._floorKey) this._bakeFloor();

    var origin = this._floorOrigin;
    var s = view.worldToScreen(origin.x, origin.y);
    var cv = this._floorCanvas;
    view.ctx.drawImage(
      cv, s.x, s.y,
      cv.width * view.zoom, cv.height * view.zoom
    );
  };

  Game.prototype._bakeFloor = function () {
    var b = this.sim.worldBounds();
    var pad = 72;
    var w = Math.ceil(b.maxX - b.minX + pad * 2);
    var h = Math.ceil(b.maxY - b.minY + pad * 2);

    if (!this._floorCanvas) {
      this._floorCanvas = root.document.createElement("canvas");
    }
    var cv = this._floorCanvas;
    cv.width = w;
    cv.height = h;

    var g = cv.getContext("2d");
    g.clearRect(0, 0, w, h);

    var origin = { x: b.minX - pad, y: b.minY - pad };
    this._floorOrigin = origin;

    var self = this;
    var hw = CFG.TILE_W / 2;
    var hh = CFG.TILE_H / 2;

    function blit(key2, wx, wy) {
      var sheet = C.Assets.atlas.sheets.tiles;
      var fr = sheet.frames[key2];
      var img = C.Assets.images.tiles;
      if (!fr || !img) return;
      g.drawImage(
        img, fr.x, fr.y, fr.w, fr.h,
        Math.round(wx - origin.x - sheet.anchor[0]),
        Math.round(wy - origin.y - sheet.anchor[1]),
        fr.w, fr.h
      );
    }

    var i, r, c, wx, wy;

    // Raised platform edge.
    for (i = 0; i < this.perimeter.length; i++) {
      r = this.perimeter[i].r;
      c = this.perimeter[i].c;
      blit("floor_edge", (c - r) * hw, (c + r) * hh + 14);
    }

    var F = CFG.FLOOR;
    for (r = F.r0; r <= F.r1; r++) {
      for (c = F.c0; c <= F.c1; c++) {
        blit(this._tileFrame(r, c), (c - r) * hw, (c + r) * hh);
      }
    }

    this._floorKey = Object.keys(this.sim.unlocked).join(",");
  };

  Game.prototype._drawHover = function (view) {
    if (this.scene !== "playing" || !this.hoverTile) return;
    var t = this.hoverTile;
    if (t.r < CFG.FLOOR.r0 || t.r > CFG.FLOOR.r1) return;
    if (t.c < CFG.FLOOR.c0 || t.c > CFG.FLOOR.c1) return;
    view.tileOutline(t.r, t.c, "rgba(38,34,28,0.16)", 1.5);
  };

  Game.prototype._drawSorted = function (view, sim) {
    var i;

    for (i = 0; i < sim.decorSprites.length; i++) {
      var d = sim.decorSprites[i];
      var w = view.gridToWorld(d.r, d.c);
      view.push("objects", d.sprite, w.x, w.y, d.r + d.c);
    }

    for (i = 0; i < sim.desks.length; i++) sim.desks[i].draw(view);

    var keys = Object.keys(sim.fixtures);
    for (i = 0; i < keys.length; i++) sim.fixtures[keys[i]].draw(view, sim);

    for (i = 0; i < sim.employees.length; i++) sim.employees[i].draw(view, sim);
  };

  /** Labels the player can act on, drawn after the depth pass. */
  Game.prototype._drawOverlayHints = function (view, sim) {
    if (this.scene !== "playing") return;

    var coffee = sim.fixtures.coffee;
    if (coffee && coffee.level <= 0.01) {
      var w = view.gridToWorld(coffee.r, coffee.c);
      var s = view.worldToScreen(w.x, w.y);
      var pulse = 0.5 + 0.5 * Math.sin(sim.time * 6);
      view.text("TAP TO BREW", w.x, w.y - 84, {
        color: CFG.COLORS.bad, size: 15, alpha: 0.6 + pulse * 0.4
      });
    }

    var printer = sim.fixtures.printer;
    if (printer && printer.jammed) {
      var w2 = view.gridToWorld(printer.r, printer.c);
      view.text("TAP TO FIX", w2.x, w2.y - 84, {
        color: CFG.COLORS.bad, size: 15,
        alpha: 0.6 + 0.4 * Math.sin(sim.time * 6)
      });
    }

    var help = sim.fixtures.helpdesk;
    if (help && help.tickets >= 1) {
      var w3 = view.gridToWorld(help.r, help.c);
      view.text(Math.floor(help.tickets) + " TICKETS", w3.x, w3.y - 96, {
        color: CFG.COLORS.info, size: 14, alpha: 0.95
      });
    }

    // Floating "tap me" hint on the first desk with banked cash, only while
    // the player is still learning.
    if (sim.stats.taps < 12) {
      for (var i = 0; i < sim.desks.length; i++) {
        if (sim.desks[i].pending > 3) {
          var wd = view.gridToWorld(sim.desks[i].r, sim.desks[i].c);
          view.text("TAP", wd.x, wd.y - 72, {
            color: CFG.COLORS.ink, size: 14,
            alpha: 0.55 + 0.45 * Math.sin(sim.time * 5)
          });
          break;
        }
      }
    }
  };

  /* ======================================================================
     Entry point
     ====================================================================== */

  var game = new Game();
  C.game = game;

  root.addEventListener("DOMContentLoaded", function () {
    game.boot().catch(function (err) {
      var el = root.document.getElementById("boot-status");
      if (el) {
        el.innerHTML = "<strong>Could not start.</strong><br>" +
          String(err && err.message ? err.message : err);
      }
      // eslint-disable-next-line no-console
      console.error(err);
    });
  });

  C.Game = Game;
})(window);
