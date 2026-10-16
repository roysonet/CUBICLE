/* ==========================================================================
   CUBICLE :: engine/util.js
   Small, dependency-free helpers. Attaches to window.CUBICLE.util
   ========================================================================== */
(function (root) {
  "use strict";
  var C = (root.CUBICLE = root.CUBICLE || {});

  var util = {};

  /* ---- math ------------------------------------------------------------ */

  util.clamp = function (v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  };

  util.lerp = function (a, b, t) {
    return a + (b - a) * t;
  };

  /**
   * Frame-rate independent exponential smoothing.
   * `rate` is the fraction of the remaining gap closed per second.
   */
  util.damp = function (a, b, rate, dt) {
    return util.lerp(a, b, 1 - Math.pow(1 - util.clamp(rate, 0, 1), dt * 60));
  };

  util.dist = function (ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    return Math.sqrt(dx * dx + dy * dy);
  };

  util.manhattan = function (ax, ay, bx, by) {
    return Math.abs(bx - ax) + Math.abs(by - ay);
  };

  /* ---- easing ---------------------------------------------------------- */

  var ease = {
    linear: function (t) { return t; },
    quadOut: function (t) { return 1 - (1 - t) * (1 - t); },
    quadIn: function (t) { return t * t; },
    cubicOut: function (t) { return 1 - Math.pow(1 - t, 3); },
    cubicInOut: function (t) {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    },
    elasticOut: function (t) {
      if (t === 0 || t === 1) return t;
      var c4 = (2 * Math.PI) / 3;
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    },
    backOut: function (t) {
      var c1 = 1.70158, c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }
  };
  util.ease = ease;

  /* ---- deterministic RNG (mulberry32) ---------------------------------- */

  util.rng = function (seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  util.pick = function (arr, rnd) {
    return arr[Math.floor((rnd || Math.random)() * arr.length) % arr.length];
  };

  /* ---- formatting ------------------------------------------------------ */

  var SUFFIX = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx"];

  /** Compact money/quantity formatting: 1240 -> "1.24K". */
  util.compact = function (n) {
    if (!isFinite(n)) return "0";
    var neg = n < 0;
    n = Math.abs(n);
    if (n < 1000) {
      // Small values keep enough precision to be useful, but never show a
      // pointless trailing zero ("$0.0" reads as broken).
      var s;
      if (n < 0.005) s = "0";
      else if (n < 10) s = n.toFixed(2).replace(/\.?0+$/, "");
      else s = String(Math.floor(n));
      return (neg ? "-" : "") + s;
    }
    var tier = Math.min(SUFFIX.length - 1, Math.floor(Math.log10(n) / 3));
    var scaled = n / Math.pow(1000, tier);
    var digits = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
    return (neg ? "-" : "") + scaled.toFixed(digits) + SUFFIX[tier];
  };

  /** Currency with symbol. */
  util.money = function (n) {
    return "$" + util.compact(n);
  };

  util.plural = function (n, one, many) {
    return n + " " + (n === 1 ? one : many || one + "s");
  };

  util.pad2 = function (n) {
    return (n < 10 ? "0" : "") + n;
  };

  /* ---- collections ----------------------------------------------------- */

  util.remove = function (arr, item) {
    var i = arr.indexOf(item);
    if (i >= 0) arr.splice(i, 1);
    return i >= 0;
  };

  /** In-place swap-remove; order is not preserved. O(1). */
  util.swapRemove = function (arr, i) {
    var last = arr.length - 1;
    if (i !== last) arr[i] = arr[last];
    arr.pop();
  };

  util.shuffle = function (arr, rnd) {
    rnd = rnd || Math.random;
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };

  /* ---- colour ---------------------------------------------------------- */

  util.rgba = function (r, g, b, a) {
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
  };

  util.hexToRgb = function (hex) {
    var h = hex.replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var v = parseInt(h, 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  };

  C.util = util;
})(window);
