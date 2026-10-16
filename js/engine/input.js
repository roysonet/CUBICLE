/* ==========================================================================
   CUBICLE :: engine/input.js
   Unified pointer (mouse + touch) + keyboard input.

   Emits semantic events rather than raw DOM ones, so the game layer never
   has to care whether the player used a finger, a mouse, or a trackpad.
   ========================================================================== */
(function (root) {
  "use strict";
  var C = (root.CUBICLE = root.CUBICLE || {});

  function Input(canvas) {
    this.canvas = canvas;
    this.pointers = {};       // id -> {x, y, x0, y0, t0, moved}
    this.primary = null;
    this.keys = {};
    this.handlers = {};
    this.dragging = false;
    this.pinchDist = 0;
    this._bound = [];
    this._attach();
  }

  Input.prototype.on = function (name, fn) {
    (this.handlers[name] = this.handlers[name] || []).push(fn);
    return this;
  };

  Input.prototype.emit = function (name, payload) {
    var list = this.handlers[name];
    if (!list) return;
    for (var i = 0; i < list.length; i++) list[i](payload);
  };

  Input.prototype._bind = function (target, type, fn, opts) {
    target.addEventListener(type, fn, opts || false);
    this._bound.push([target, type, fn]);
  };

  Input.prototype._local = function (e) {
    var r = this.canvas.getBoundingClientRect();
    var cx = e.clientX === undefined ? (e.touches && e.touches[0] ? e.touches[0].clientX : 0) : e.clientX;
    var cy = e.clientY === undefined ? (e.touches && e.touches[0] ? e.touches[0].clientY : 0) : e.clientY;
    return { x: cx - r.left, y: cy - r.top };
  };

  Input.prototype._attach = function () {
    var self = this;
    var cv = this.canvas;

    function down(e) {
      var p = self._local(e);
      var id = e.pointerId === undefined ? "m" : e.pointerId;
      self.pointers[id] = {
        x: p.x, y: p.y, x0: p.x, y0: p.y,
        t0: performance.now(), moved: false, button: e.button || 0
      };
      self.primary = self.pointers[id];
      self._updatePinch();
      if (e.pointerType !== "touch") e.preventDefault();
    }

    function move(e) {
      var p = self._local(e);
      var id = e.pointerId === undefined ? "m" : e.pointerId;
      var rec = self.pointers[id];
      if (!rec) {
        self.emit("hover", p);
        return;
      }
      var dx = p.x - rec.x, dy = p.y - rec.y;
      rec.x = p.x; rec.y = p.y;
      if (!rec.moved && C.util.dist(rec.x0, rec.y0, p.x, p.y) > 6) {
        rec.moved = true;
        self.dragging = true;
      }
      if (rec.moved) self.emit("drag", { dx: dx, dy: dy, x: p.x, y: p.y, id: id });
      self._updatePinch();
    }

    function up(e) {
      var p = self._local(e);
      var id = e.pointerId === undefined ? "m" : e.pointerId;
      var rec = self.pointers[id];
      delete self.pointers[id];
      if (Object.keys(self.pointers).length === 0) self.dragging = false;
      self._updatePinch();
      if (!rec) return;
      var dt = performance.now() - rec.t0;
      if (!rec.moved && dt < 700) {
        self.emit("tap", { x: p.x, y: p.y, button: rec.button, duration: dt });
      } else if (rec.moved) {
        self.emit("dragend", { x: p.x, y: p.y, dx: p.x - rec.x0, dy: p.y - rec.y0 });
      }
    }

    this._bind(cv, "pointerdown", down);
    this._bind(root, "pointermove", move);
    this._bind(root, "pointerup", up);
    this._bind(root, "pointercancel", up);

    // Block native gestures that would fight the game.
    this._bind(cv, "touchstart", function (e) {
      if (e.touches.length > 1) e.preventDefault();
    }, { passive: false });
    this._bind(cv, "contextmenu", function (e) { e.preventDefault(); });

    this._bind(cv, "wheel", function (e) {
      e.preventDefault();
      self.emit("wheel", { delta: e.deltaY, x: e.clientX, y: e.clientY });
    }, { passive: false });

    this._bind(root, "keydown", function (e) {
      if (e.repeat) return;
      self.keys[e.key.toLowerCase()] = true;
      self.emit("key", { key: e.key.toLowerCase(), code: e.code, event: e });
    });
    this._bind(root, "keyup", function (e) {
      self.keys[e.key.toLowerCase()] = false;
    });
    this._bind(root, "blur", function () {
      self.keys = {};
      self.pointers = {};
      self.dragging = false;
    });
  };

  Input.prototype._updatePinch = function () {
    var ids = Object.keys(this.pointers);
    if (ids.length < 2) { this.pinchDist = 0; return; }
    var a = this.pointers[ids[0]], b = this.pointers[ids[1]];
    var d = C.util.dist(a.x, a.y, b.x, b.y);
    if (this.pinchDist > 0) {
      this.emit("pinch", {
        scale: d / this.pinchDist,
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2
      });
    }
    this.pinchDist = d;
  };

  Input.prototype.isDown = function (key) {
    return !!this.keys[key];
  };

  /** Normalised movement vector from WASD / arrows. */
  Input.prototype.moveVector = function () {
    var x = 0, y = 0;
    if (this.keys["a"] || this.keys["arrowleft"]) x -= 1;
    if (this.keys["d"] || this.keys["arrowright"]) x += 1;
    if (this.keys["w"] || this.keys["arrowup"]) y -= 1;
    if (this.keys["s"] || this.keys["arrowdown"]) y += 1;
    return { x: x, y: y };
  };

  Input.prototype.destroy = function () {
    for (var i = 0; i < this._bound.length; i++) {
      var b = this._bound[i];
      b[0].removeEventListener(b[1], b[2]);
    }
    this._bound.length = 0;
  };

  C.Input = Input;
})(window);
