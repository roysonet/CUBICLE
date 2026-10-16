/* ==========================================================================
   CUBICLE :: engine/view.js
   Isometric camera + renderer.

   REA note: the original renders a 42x30 isometric world into a fixed
   1280x768 stage and must therefore scroll. This implementation keeps the
   same dimetric projection but sizes the world so it fits on screen by
   default, then offers free pan/zoom on top. Same maths, better first read.

   Projection (2:1 dimetric):
       wx = (col - row) * TILE_W/2
       wy = (col + row) * TILE_H/2
   Inverse:
       col = ( wx / (TILE_W/2) + wy / (TILE_H/2) ) / 2
       row = (-wx / (TILE_W/2) + wy / (TILE_H/2) ) / 2
   ========================================================================== */
(function (root) {
  "use strict";
  var C = (root.CUBICLE = root.CUBICLE || {});
  var util = C.util;

  var HW = 32;   // TILE_W / 2
  var HH = 16;   // TILE_H / 2

  function View(canvas, atlas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.atlas = atlas;
    this.images = {};

    this.vw = 0; this.vh = 0; this.dpr = 1;
    this.zoom = 1;
    this.minZoom = 0.45;
    this.maxZoom = 2.4;
    this.fitZoom = 1;
    this.fitFill = 1.08;
    this.autoFit = true;   // cleared as soon as the player zooms manually

    this.cam = { x: 0, y: 0, tx: 0, ty: 0 };
    this.bounds = { minX: -400, minY: -400, maxX: 400, maxY: 400 };
    this.padding = { left: 0, right: 0, top: 0, bottom: 0 };

    this._items = [];
    this._count = 0;
    this._pool = [];
    this._visible = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    this.shake = { x: 0, y: 0, mag: 0 };
  }

  /* ---- assets ---------------------------------------------------------- */

  View.prototype.setImage = function (name, img) {
    this.images[name] = img;
  };

  View.prototype.frame = function (sheet, key) {
    var s = this.atlas.sheets[sheet];
    return s ? s.frames[key] : null;
  };

  View.prototype.sheet = function (name) {
    return this.atlas.sheets[name];
  };

  /* ---- sizing ---------------------------------------------------------- */

  View.prototype.resize = function () {
    var cv = this.canvas;
    var w = cv.clientWidth || root.innerWidth;
    var h = cv.clientHeight || root.innerHeight;
    this.dpr = Math.min(root.devicePixelRatio || 1, 2);
    this.vw = w;
    this.vh = h;
    cv.width = Math.round(w * this.dpr);
    cv.height = Math.round(h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.fitZoom = this.computeFitZoom();
    return this;
  };

  View.prototype.setPadding = function (p) {
    this.padding.left = p.left || 0;
    this.padding.right = p.right || 0;
    this.padding.top = p.top || 0;
    this.padding.bottom = p.bottom || 0;
    this.fitZoom = this.computeFitZoom();
  };

  /** Usable viewport (viewport minus UI chrome). */
  View.prototype.usable = function () {
    return {
      x: this.padding.left,
      y: this.padding.top,
      w: Math.max(80, this.vw - this.padding.left - this.padding.right),
      h: Math.max(80, this.vh - this.padding.top - this.padding.bottom)
    };
  };

  View.prototype.computeFitZoom = function () {
    var u = this.usable();
    var bw = this.bounds.maxX - this.bounds.minX;
    var bh = this.bounds.maxY - this.bounds.minY;
    if (bw <= 0 || bh <= 0) return 1;
    // The isometric world's bounding box has large empty corners, so fitting it
    // exactly wastes a lot of screen. Over-filling slightly clips only those
    // empty corners and makes the office noticeably more readable.
    return Math.min(u.w / bw, u.h / bh) * (this.fitFill || 1);
  };

  View.prototype.setWorldBounds = function (minX, minY, maxX, maxY) {
    this.bounds.minX = minX;
    this.bounds.minY = minY;
    this.bounds.maxX = maxX;
    this.bounds.maxY = maxY;
    this.fitZoom = this.computeFitZoom();
    this.minZoom = this.fitZoom * 0.75;
    this.maxZoom = Math.max(2.4, this.fitZoom * 3);
  };

  View.prototype.fit = function () {
    this.zoom = this.fitZoom;
    this.autoFit = true;
    this.cam.x = this.cam.tx = (this.bounds.minX + this.bounds.maxX) / 2;
    this.cam.y = this.cam.ty = (this.bounds.minY + this.bounds.maxY) / 2;
    this.clamp();
    return this;
  };

  /* ---- projection ------------------------------------------------------ */

  View.prototype.gridToWorld = function (r, c) {
    return { x: (c - r) * HW, y: (c + r) * HH };
  };

  View.prototype.worldToScreen = function (wx, wy) {
    var u = this.usable();
    return {
      x: (wx - this.cam.x) * this.zoom + u.x + u.w / 2 + this.shake.x,
      y: (wy - this.cam.y) * this.zoom + u.y + u.h / 2 + this.shake.y
    };
  };

  View.prototype.screenToWorld = function (sx, sy) {
    var u = this.usable();
    return {
      x: (sx - u.x - u.w / 2 - this.shake.x) / this.zoom + this.cam.x,
      y: (sy - u.y - u.h / 2 - this.shake.y) / this.zoom + this.cam.y
    };
  };

  /** Screen point -> fractional grid coordinates. */
  View.prototype.screenToGrid = function (sx, sy) {
    var w = this.screenToWorld(sx, sy);
    return {
      col: (w.x / HW + w.y / HH) / 2,
      row: (-w.x / HW + w.y / HH) / 2
    };
  };

  /* ---- camera ---------------------------------------------------------- */

  View.prototype.panByScreen = function (dx, dy) {
    this.cam.tx -= dx / this.zoom;
    this.cam.ty -= dy / this.zoom;
    this.cam.x = this.cam.tx;
    this.cam.y = this.cam.ty;
    this.clamp();
  };

  View.prototype.setZoom = function (z, pivotSx, pivotSy) {
    var old = this.zoom;
    var nz = util.clamp(z, this.minZoom, this.maxZoom);
    if (Math.abs(nz - old) < 1e-4) return;
    this.autoFit = false;
    if (pivotSx !== undefined) {
      var before = this.screenToWorld(pivotSx, pivotSy);
      this.zoom = nz;
      var after = this.screenToWorld(pivotSx, pivotSy);
      this.cam.tx += before.x - after.x;
      this.cam.ty += before.y - after.y;
      this.cam.x = this.cam.tx;
      this.cam.y = this.cam.ty;
    } else {
      this.zoom = nz;
    }
    this.clamp();
  };

  View.prototype.zoomBy = function (factor, pivotSx, pivotSy) {
    this.setZoom(this.zoom * factor, pivotSx, pivotSy);
  };

  View.prototype.clamp = function () {
    var u = this.usable();
    var bw = (this.bounds.maxX - this.bounds.minX) * this.zoom;
    var bh = (this.bounds.maxY - this.bounds.minY) * this.zoom;
    var halfW = u.w / 2 / this.zoom;
    var halfH = u.h / 2 / this.zoom;

    if (bw <= u.w) {
      this.cam.tx = (this.bounds.minX + this.bounds.maxX) / 2;
    } else {
      this.cam.tx = util.clamp(
        this.cam.tx,
        this.bounds.minX + halfW,
        this.bounds.maxX - halfW
      );
    }
    if (bh <= u.h) {
      this.cam.ty = (this.bounds.minY + this.bounds.maxY) / 2;
    } else {
      this.cam.ty = util.clamp(
        this.cam.ty,
        this.bounds.minY + halfH,
        this.bounds.maxY - halfH
      );
    }
    this.cam.x = this.cam.tx;
    this.cam.y = this.cam.ty;
  };

  /** Keyboard panning. */
  View.prototype.panByKeys = function (mx, my, dt) {
    if (!mx && !my) return;
    var speed = 620 / this.zoom;
    this.cam.tx += mx * speed * dt;
    this.cam.ty += my * speed * dt;
    this.clamp();
  };

  View.prototype.addShake = function (mag) {
    this.shake.mag = Math.min(14, this.shake.mag + mag);
  };

  View.prototype.update = function (dt) {
    if (this.shake.mag > 0.01) {
      this.shake.x = (Math.random() * 2 - 1) * this.shake.mag;
      this.shake.y = (Math.random() * 2 - 1) * this.shake.mag;
      this.shake.mag *= Math.pow(0.001, dt);
    } else {
      this.shake.x = this.shake.y = 0;
      this.shake.mag = 0;
    }
  };

  /* ---- frame ----------------------------------------------------------- */

  View.prototype.beginFrame = function (bgColor) {
    var ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = bgColor || "#f2ede3";
    ctx.fillRect(0, 0, this.vw, this.vh);

    // Cache the visible world rect so callers can cull cheaply.
    var a = this.screenToWorld(-80, -80);
    var b = this.screenToWorld(this.vw + 80, this.vh + 80);
    this._visible.minX = a.x;
    this._visible.minY = a.y;
    this._visible.maxX = b.x;
    this._visible.maxY = b.y;

    this._count = 0;
    return this;
  };

  View.prototype.visible = function () {
    return this._visible;
  };

  /** Blit a sprite immediately (no depth sorting). */
  View.prototype.blit = function (sheetName, frameName, wx, wy, opts) {
    opts = opts || {};
    var fr = this.frame(sheetName, frameName);
    if (!fr) return false;
    var img = this.images[sheetName];
    if (!img) return false;

    var meta = this.atlas.sheets[sheetName];
    var ax = opts.ax !== undefined ? opts.ax : meta.anchor[0];
    var ay = opts.ay !== undefined ? opts.ay : meta.anchor[1];

    var s = this.worldToScreen(wx, wy);
    var z = this.zoom * (opts.scale || 1);
    var w = fr.w * z, h = fr.h * z;

    var dx = Math.round(s.x - ax * z);
    var dy = Math.round(s.y - ay * z);

    if (opts.cull !== false) {
      if (dx + w < -40 || dx > this.vw + 40) return false;
      if (dy + h < -40 || dy > this.vh + 40) return false;
    }

    var ctx = this.ctx;
    var prevA = ctx.globalAlpha;
    if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;

    if (opts.flipX) {
      ctx.save();
      ctx.translate(dx + w, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(img, fr.x, fr.y, fr.w, fr.h, 0, 0, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(img, fr.x, fr.y, fr.w, fr.h, dx, dy, w, h);
    }

    ctx.globalAlpha = prevA;
    return true;
  };

  /**
   * Queue a sprite for depth-sorted drawing.
   * `depth` defaults to world-space (row + col); pass `opts.depth` to override.
   */
  View.prototype.push = function (sheetName, frameName, wx, wy, depth, opts) {
    var item = this._pool[this._count] || (this._pool[this._count] = {});
    item.sheet = sheetName;
    item.frame = frameName;
    item.wx = wx;
    item.wy = wy;
    item.depth = depth;
    item.opts = opts || null;
    this._count++;
  };

  View.prototype.flush = function () {
    var n = this._count;
    if (n === 0) return;
    var items = this._pool.slice(0, n);
    items.sort(function (a, b) { return a.depth - b.depth; });
    for (var i = 0; i < n; i++) {
      var it = items[i];
      this.blit(it.sheet, it.frame, it.wx, it.wy, it.opts || undefined);
    }
    this._count = 0;
  };

  /* ---- primitives ------------------------------------------------------ */

  /** Soft elliptical ground shadow. */
  View.prototype.shadow = function (wx, wy, radius, alpha) {
    var s = this.worldToScreen(wx, wy);
    var rx = radius * this.zoom;
    var ry = rx * 0.5;
    var ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 0.16 : alpha;
    ctx.fillStyle = "#2a2620";
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  /** Pulsing highlight ring drawn flat on the floor. */
  View.prototype.ring = function (wx, wy, radius, color, alpha, lineWidth) {
    var s = this.worldToScreen(wx, wy);
    var rx = radius * this.zoom;
    var ry = rx * 0.5;
    var ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 0.9 : alpha;
    ctx.strokeStyle = color || "#d97757";
    ctx.lineWidth = (lineWidth || 2) * Math.max(0.6, this.zoom);
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  };

  View.prototype.filledRing = function (wx, wy, radius, color, alpha) {
    var s = this.worldToScreen(wx, wy);
    var rx = radius * this.zoom;
    var ry = rx * 0.5;
    var ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 0.2 : alpha;
    ctx.fillStyle = color || "#d97757";
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  /** Filled iso diamond highlight on a tile. */
  View.prototype.tileHighlight = function (r, c, color, alpha) {
    var w = this.gridToWorld(r, c);
    var s = this.worldToScreen(w.x, w.y);
    var hw = HW * this.zoom, hh = HH * this.zoom;
    var ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 0.28 : alpha;
    ctx.fillStyle = color || "#d97757";
    ctx.beginPath();
    ctx.moveTo(s.x, s.y - hh);
    ctx.lineTo(s.x + hw, s.y);
    ctx.lineTo(s.x, s.y + hh);
    ctx.lineTo(s.x - hw, s.y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  /** Simple iso box drawn directly in screen space (for ghost previews). */
  View.prototype.tileOutline = function (r, c, color, lineWidth) {
    var w = this.gridToWorld(r, c);
    var s = this.worldToScreen(w.x, w.y);
    var hw = HW * this.zoom, hh = HH * this.zoom;
    var ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = color || "#d97757";
    ctx.lineWidth = lineWidth || 2;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y - hh);
    ctx.lineTo(s.x + hw, s.y);
    ctx.lineTo(s.x, s.y + hh);
    ctx.lineTo(s.x - hw, s.y);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  };

  View.prototype.text = function (str, wx, wy, opts) {
    opts = opts || {};
    var s = this.worldToScreen(wx, wy);
    var ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = opts.alpha === undefined ? 1 : opts.alpha;
    ctx.font = (opts.weight || "700") + " " +
      Math.round((opts.size || 15) * util.clamp(this.zoom, 0.75, 1.35)) + "px " +
      (opts.font || "'Geist Mono', ui-monospace, monospace");
    ctx.textAlign = opts.align || "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = opts.stroke === undefined ? 3 : opts.stroke;
    if (ctx.lineWidth > 0) {
      ctx.strokeStyle = opts.strokeColor || "rgba(250,249,245,0.92)";
      ctx.lineJoin = "round";
      ctx.strokeText(str, s.x, s.y);
    }
    ctx.fillStyle = opts.color || "#26221c";
    ctx.fillText(str, s.x, s.y);
    ctx.restore();
  };

  /** World-space progress arc used for restock / repair timers. */
  View.prototype.arc = function (wx, wy, radius, t, color, bg) {
    var s = this.worldToScreen(wx, wy);
    var rr = radius * this.zoom;
    var ctx = this.ctx;
    ctx.save();
    ctx.lineWidth = Math.max(2, 3.4 * this.zoom);
    ctx.lineCap = "round";
    if (bg) {
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = bg;
      ctx.beginPath();
      ctx.arc(s.x, s.y, rr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = color || "#d97757";
    ctx.beginPath();
    ctx.arc(s.x, s.y, rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * util.clamp(t, 0, 1));
    ctx.stroke();
    ctx.restore();
  };

  View.prototype.rect = function (x, y, w, h, color, alpha) {
    var ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  };

  C.View = View;
})(window);
