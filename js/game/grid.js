/* ==========================================================================
   CUBICLE :: game/grid.js
   Occupancy + pathfinding.

   Agents navigate by descending a BFS distance field rather than running
   their own A*. Fields are cached per destination and only rebuilt when the
   occupancy version changes, so 40 employees walking to 40 desks cost 40
   cheap array lookups per step instead of 40 searches.
   ========================================================================== */
(function (root) {
  "use strict";
  var C = (root.CUBICLE = root.CUBICLE || {});

  var WALK = 0;
  var SOLID = 1;

  function Grid(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.cells = new Uint8Array(cols * rows);
    this.version = 0;
    this._fields = {};
    this._fieldKeys = 0;
  }

  Grid.prototype.idx = function (r, c) { return r * this.cols + c; };

  Grid.prototype.inBounds = function (r, c) {
    return r >= 0 && c >= 0 && r < this.rows && c < this.cols;
  };

  Grid.prototype.isSolid = function (r, c) {
    if (!this.inBounds(r, c)) return true;
    return this.cells[r * this.cols + c] === SOLID;
  };

  Grid.prototype.isWalkable = function (r, c) {
    return !this.isSolid(r, c);
  };

  /** Block/unblock a tile. Any change invalidates every cached field. */
  Grid.prototype.setSolid = function (r, c, solid) {
    if (!this.inBounds(r, c)) return;
    var i = r * this.cols + c;
    var v = solid ? SOLID : WALK;
    if (this.cells[i] === v) return;
    this.cells[i] = v;
    this.version++;
    this._fields = {};
    this._fieldKeys = 0;
  };

  Grid.prototype.setRegionSolid = function (r0, c0, r1, c1, solid) {
    for (var r = r0; r <= r1; r++) {
      for (var c = c0; c <= c1; c++) {
        if (this.inBounds(r, c)) this.cells[r * this.cols + c] = solid ? SOLID : WALK;
      }
    }
    this.version++;
    this._fields = {};
    this._fieldKeys = 0;
  };

  /* ---- distance fields ------------------------------------------------- */

  /**
   * BFS distances from (tr, tc) across walkable tiles.
   * Returns an Int16Array; -1 means unreachable.
   */
  Grid.prototype.field = function (tr, tc) {
    if (!this.inBounds(tr, tc) || this.isSolid(tr, tc)) return null;
    var key = tr + "," + tc;
    var cached = this._fields[key];
    if (cached && cached.version === this.version) return cached.dist;

    var n = this.cols * this.rows;
    var dist = new Int16Array(n);
    dist.fill(-1);
    var queue = new Int32Array(n);
    var head = 0, tail = 0;

    var start = tr * this.cols + tc;
    dist[start] = 0;
    queue[tail++] = start;

    while (head < tail) {
      var cur = queue[head++];
      var cr = (cur / this.cols) | 0;
      var cc = cur - cr * this.cols;
      var d = dist[cur] + 1;

      for (var k = 0; k < 4; k++) {
        var nr = cr + (k === 0 ? -1 : k === 1 ? 1 : 0);
        var nc = cc + (k === 2 ? -1 : k === 3 ? 1 : 0);
        if (nr < 0 || nc < 0 || nr >= this.rows || nc >= this.cols) continue;
        var ni = nr * this.cols + nc;
        if (this.cells[ni] === SOLID || dist[ni] !== -1) continue;
        dist[ni] = d;
        queue[tail++] = ni;
      }
    }

    if (this._fieldKeys > 64) { this._fields = {}; this._fieldKeys = 0; }
    this._fields[key] = { version: this.version, dist: dist };
    this._fieldKeys++;
    return dist;
  };

  /** Distance from (r, c) to (tr, tc), or -1. */
  Grid.prototype.distance = function (r, c, tr, tc) {
    var f = this.field(tr, tc);
    if (!f) return -1;
    return f[r * this.cols + c];
  };

  /**
   * Next tile toward the destination, or null when already there / stuck.
   * `bias` is a per-agent phase offset that breaks ties differently for each
   * employee, which stops crowds from collapsing into a single-file line.
   */
  Grid.prototype.nextStep = function (r, c, tr, tc, bias) {
    var f = this.field(tr, tc);
    if (!f) return null;
    var here = f[r * this.cols + c];
    if (here === 0) return null;
    if (here < 0) return null;

    var best = null, bestD = here;
    var b = bias || 0;
    var start = b % 4;
    for (var k = 0; k < 4; k++) {
      var dir = (k + start) % 4;
      var nr = r + (dir === 0 ? -1 : dir === 1 ? 1 : 0);
      var nc = c + (dir === 2 ? -1 : dir === 3 ? 1 : 0);
      if (nr < 0 || nc < 0 || nr >= this.rows || nc >= this.cols) continue;
      var d = f[nr * this.cols + nc];
      if (d >= 0 && d < bestD) { bestD = d; best = { r: nr, c: nc }; }
    }
    return best;
  };

  /** Full path as an array of tiles, inclusive of the destination. */
  Grid.prototype.path = function (r, c, tr, tc, bias) {
    if (r === tr && c === tc) return [];
    var out = [];
    var guard = 0;
    var cr = r, cc = c;
    while ((cr !== tr || cc !== tc) && guard++ < 4096) {
      var step = this.nextStep(cr, cc, tr, tc, bias);
      if (!step) return null;
      out.push(step);
      cr = step.r; cc = step.c;
    }
    return out.length ? out : null;
  };

  /** Nearest walkable tile to (r, c) via expanding ring search. */
  Grid.prototype.nearestWalkable = function (r, c, maxRadius) {
    if (this.isWalkable(r, c)) return { r: r, c: c };
    var max = maxRadius || 8;
    for (var radius = 1; radius <= max; radius++) {
      for (var dr = -radius; dr <= radius; dr++) {
        for (var dc = -radius; dc <= radius; dc++) {
          if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue;
          var nr = r + dr, nc = c + dc;
          if (this.isWalkable(nr, nc)) return { r: nr, c: nc };
        }
      }
    }
    return null;
  };

  /** All walkable 4-neighbours of a tile. */
  Grid.prototype.freeNeighbours = function (r, c) {
    var out = [];
    var dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (var i = 0; i < 4; i++) {
      var nr = r + dirs[i][0], nc = c + dirs[i][1];
      if (this.isWalkable(nr, nc)) out.push({ r: nr, c: nc });
    }
    return out;
  };

  C.Grid = Grid;
})(window);
