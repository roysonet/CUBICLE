/* ==========================================================================
   CUBICLE :: engine/loop.js
   Two-clock scheduler.

   The REA found the original runs a rAF render clock alongside a slower
   simulation clock. That split is preserved here on purpose: rendering must
   be smooth and variable-step, while the economy must be deterministic and
   fixed-step, otherwise income depends on the player's frame rate.
   ========================================================================== */
(function (root) {
  "use strict";
  var C = (root.CUBICLE = root.CUBICLE || {});

  var MAX_FRAME = 0.25;   // seconds; guards against tab-switch time spikes

  function Loop(opts) {
    opts = opts || {};
    this.fixedStep = opts.fixedStep || 1 / 30;   // simulation tick
    this.maxSubSteps = opts.maxSubSteps || 8;
    this.onFixed = opts.onFixed || function () {};
    this.onRender = opts.onRender || function () {};

    this.running = false;
    this.speed = 1;              // 0 = paused, 1 = normal, 2/4 = fast-forward
    this._raf = 0;
    this._last = 0;
    this._acc = 0;

    this.elapsed = 0;            // total simulated seconds
    this.frame = 0;              // render frames
    this.ticks = 0;              // sim ticks
    this.fps = 60;
    this._fpsAcc = 0;
    this._fpsCount = 0;

    var self = this;
    this._tick = function (now) {
      if (!self.running) return;
      self._raf = root.requestAnimationFrame(self._tick);

      var t = now / 1000;
      var dt = self._last ? t - self._last : 0;
      self._last = t;
      if (dt > MAX_FRAME) dt = MAX_FRAME;

      self._fpsAcc += dt;
      self._fpsCount++;
      if (self._fpsAcc >= 0.5) {
        self.fps = Math.round(self._fpsCount / self._fpsAcc);
        self._fpsAcc = 0;
        self._fpsCount = 0;
      }

      var scaled = dt * self.speed;
      if (self.speed > 0) {
        self._acc += scaled;
        var steps = 0;
        while (self._acc >= self.fixedStep && steps < self.maxSubSteps) {
          self.onFixed(self.fixedStep);
          self._acc -= self.fixedStep;
          self.ticks++;
          self.elapsed += self.fixedStep;
          steps++;
        }
        // If we blew the substep budget, drop the backlog rather than spiral.
        if (steps >= self.maxSubSteps) self._acc = 0;
      }

      self.onRender(dt, scaled);
      self.frame++;
    };
  }

  Loop.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    this._last = 0;
    this._acc = 0;
    this._raf = root.requestAnimationFrame(this._tick);
  };

  Loop.prototype.stop = function () {
    this.running = false;
    if (this._raf) root.cancelAnimationFrame(this._raf);
    this._raf = 0;
  };

  Loop.prototype.setSpeed = function (s) {
    this.speed = s;
  };

  Loop.prototype.togglePause = function () {
    this.speed = this.speed === 0 ? 1 : 0;
    return this.speed === 0;
  };

  /** Advance the simulation by `seconds` without rendering (offline catch-up). */
  Loop.prototype.simulateOffline = function (seconds, capSeconds) {
    var cap = capSeconds === undefined ? 8 * 3600 : capSeconds;
    var t = Math.min(seconds, cap);
    var steps = Math.min(Math.floor(t / this.fixedStep), 200000);
    for (var i = 0; i < steps; i++) {
      this.onFixed(this.fixedStep);
      this.ticks++;
      this.elapsed += this.fixedStep;
    }
    return steps * this.fixedStep;
  };

  C.Loop = Loop;
})(window);
