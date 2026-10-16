/* ==========================================================================
   CUBICLE :: game/assets.js
   Image loading.

   The atlas metadata arrives as a plain JS object (assets/sprites/atlas.js),
   NOT as JSON fetched at runtime. That is deliberate: fetch()/XHR is blocked
   for file:// pages, and this game must run from a double-click with no
   server. Only <img> loading is used, which file:// permits.

   If an image fails to load the game does not die - it synthesises a
   labelled placeholder sheet so the failure is visible and debuggable
   instead of showing an empty office.
   ========================================================================== */
(function (root) {
  "use strict";
  var C = (root.CUBICLE = root.CUBICLE || {});

  var Assets = {
    atlas: null,
    images: {},
    ready: false,
    failed: [],

    init: function (basePath) {
      this.atlas = root.CUBICLE_ATLAS || null;
      if (!this.atlas) {
        throw new Error(
          "assets/sprites/atlas.js did not load. Run tools/generate_sprites.py."
        );
      }
      this.base = basePath || "assets/sprites/";
      return this;
    },

    /** Loads every sheet. Resolves even if some sheets fail. */
    load: function (onProgress) {
      var self = this;
      var names = Object.keys(this.atlas.sheets);
      var done = 0;

      return new Promise(function (resolve) {
        if (!names.length) return resolve(self);

        names.forEach(function (name) {
          var meta = self.atlas.sheets[name];
          var img = new Image();
          var settled = false;

          function finish(ok) {
            if (settled) return;
            settled = true;
            if (!ok) {
              self.failed.push(name);
              img = self._placeholder(name, meta);
              self.images[name] = img;
            }
            done++;
            if (onProgress) onProgress(done, names.length, name);
            if (done === names.length) {
              self.ready = true;
              resolve(self);
            }
          }

          img.onload = function () { self.images[name] = img; finish(true); };
          img.onerror = function () { finish(false); };
          img.src = self.base + meta.file;

          // Guard against a hung request stalling the whole boot.
          setTimeout(function () { if (!settled) finish(false); }, 6000);
        });
      });
    },

    /** Draws a loud magenta placeholder so a missing sheet is unmissable. */
    _placeholder: function (name, meta) {
      var cv = root.document.createElement("canvas");
      cv.width = Math.max(64, meta.cell[0] * 4);
      cv.height = Math.max(64, meta.cell[1] * 4);
      var g = cv.getContext("2d");
      g.fillStyle = "#c25b4a";
      g.fillRect(0, 0, cv.width, cv.height);
      g.strokeStyle = "#26221c";
      g.lineWidth = 6;
      g.strokeRect(3, 3, cv.width - 6, cv.height - 6);
      g.fillStyle = "#faf9f5";
      g.font = "bold 22px monospace";
      g.textAlign = "center";
      g.fillText("MISSING", cv.width / 2, cv.height / 2 - 8);
      g.font = "bold 16px monospace";
      g.fillText(name, cv.width / 2, cv.height / 2 + 18);
      return cv;
    },

    /* ---- frame helpers ------------------------------------------------- */

    frame: function (sheet, key) {
      var s = this.atlas.sheets[sheet];
      return s ? s.frames[key] : null;
    },

    has: function (sheet, key) {
      return !!this.frame(sheet, key);
    },

    /** Character frame name, e.g. characterFrame('eng','left',2). */
    characterFrame: function (archetype, dir, frame) {
      return archetype + "_" + dir + "_" + frame;
    },

    labels: function () {
      return (this.atlas.sheets.chars && this.atlas.sheets.chars.labels) || {};
    }
  };

  C.Assets = Assets;
})(window);
