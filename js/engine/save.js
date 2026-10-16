/* ==========================================================================
   CUBICLE :: engine/save.js
   localStorage persistence + local leaderboard.
   ========================================================================== */
(function (root) {
  "use strict";
  var C = (root.CUBICLE = root.CUBICLE || {});

  var KEY = "cubicle.save.v1";
  var SCORE_KEY = "cubicle.scores.v1";
  var OPT_KEY = "cubicle.options.v1";

  function safeGet(key) {
    try { return root.localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSet(key, val) {
    try { root.localStorage.setItem(key, val); return true; } catch (e) { return false; }
  }

  var Save = {
    available: (function () {
      try {
        root.localStorage.setItem("__cubicle_probe", "1");
        root.localStorage.removeItem("__cubicle_probe");
        return true;
      } catch (e) { return false; }
    })(),

    write: function (state) {
      return safeSet(KEY, JSON.stringify(state));
    },

    read: function () {
      var raw = safeGet(KEY);
      if (!raw) return null;
      try {
        var data = JSON.parse(raw);
        return data && typeof data === "object" ? data : null;
      } catch (e) {
        return null;
      }
    },

    clear: function () {
      try { root.localStorage.removeItem(KEY); } catch (e) {}
    },

    /* ---- options ------------------------------------------------------- */

    readOptions: function () {
      var raw = safeGet(OPT_KEY);
      var defaults = { muted: false, music: true, sfx: true, reducedMotion: false };
      if (!raw) return defaults;
      try {
        var o = JSON.parse(raw);
        for (var k in defaults) if (!(k in o)) o[k] = defaults[k];
        return o;
      } catch (e) { return defaults; }
    },

    writeOptions: function (o) {
      return safeSet(OPT_KEY, JSON.stringify(o));
    },

    /* ---- local leaderboard --------------------------------------------- */

    scores: function () {
      var raw = safeGet(SCORE_KEY);
      if (!raw) return [];
      try {
        var s = JSON.parse(raw);
        return Array.isArray(s) ? s : [];
      } catch (e) { return []; }
    },

    /** Records a run; returns the 1-based rank (0 if it did not place). */
    submitScore: function (entry) {
      var list = Save.scores();
      list.push(entry);
      list.sort(function (a, b) { return b.score - a.score; });
      list = list.slice(0, 10);
      safeSet(SCORE_KEY, JSON.stringify(list));
      for (var i = 0; i < list.length; i++) {
        if (list[i].ts === entry.ts && list[i].score === entry.score) return i + 1;
      }
      return 0;
    }
  };

  C.Save = Save;
})(window);
