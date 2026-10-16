/* ==========================================================================
   CUBICLE :: game/config.js
   Single source of truth for tuning AND floor plan.

   Every number a designer would want to touch lives here. The REA found the
   original exposes exactly this kind of surface (money, moving speed,
   appearance timer, rating multiply); this is the same idea, organised.
   ========================================================================== */
(function (root) {
  "use strict";
  var C = (root.CUBICLE = root.CUBICLE || {});

  var CFG = {};

  /* ---- world ----------------------------------------------------------- */

  CFG.COLS = 26;
  CFG.ROWS = 22;
  CFG.TILE_W = 64;
  CFG.TILE_H = 32;

  /* ---- simulation tuning (the REA's "game settings") ------------------- */

  CFG.tick = 1 / 30;              // fixed sim step, seconds

  CFG.startCash = 250;
  CFG.employeeSpeed = 2.6;        // tiles per second  (REA: "Moving Speed")
  CFG.applicantTimer = 26;        // seconds between walk-in applicants
  CFG.applicantTimerMin = 9;
  CFG.ratingMultiplierStep = 0.45;// global revenue scalar per star
  CFG.payrollPerEmployee = 34;    // charged at end of day
  CFG.dayLength = 180;            // seconds of real time per work day

  /* ---- economy --------------------------------------------------------- */

  CFG.baseOutput = 0.95;          // $/s per employee at level 1, morale 100
  CFG.deskLevelStep = 0.55;       // +55% output per desk level
  CFG.pendingDrain = 0.18;        // fraction of pending auto-collected per second
  CFG.pendingCap = 300;           // pending stops growing past this
  CFG.tapCollectBonus = 0.40;     // extra fraction granted for an active tap
  CFG.ticketValue = 18;           // $ per resolved ticket

  /* ---- morale ---------------------------------------------------------- */

  CFG.moraleMax = 100;
  CFG.moraleStart = 72;
  CFG.moraleRegen = 2.4;          // per second when nothing is wrong
  CFG.moralePenaltyDry = 7.5;     // per second, coffee machine empty
  CFG.moralePenaltyJam = 3.4;     // per second, printer jammed
  CFG.moralePenaltyTickets = 0.16;// per second per backlogged ticket
  CFG.moraleFloorMult = 0.35;     // revenue multiplier at zero morale
  CFG.breakInterval = 34;         // seconds between coffee breaks per employee
  CFG.breakIntervalJitter = 16;
  CFG.breakDrinkTime = 2.4;
  CFG.breakDryTime = 6.5;         // waiting around when there is no coffee

  /* ---- coffee machine -------------------------------------------------- */

  CFG.coffeeCapacity = 100;
  CFG.coffeeDrainPerBreak = 3.6;  // units consumed per coffee break
  CFG.coffeeBrewCooldown = 1.1;
  CFG.coffeeTipCash = 6;

  /* ---- printer --------------------------------------------------------- */

  CFG.printerJamMin = 42;         // seconds
  CFG.printerJamMax = 88;
  CFG.printerJamRadius = 8;       // tiles affected
  CFG.printerJamOutputMult = 0.25;
  CFG.printerFixCash = 42;

  /* ---- helpdesk -------------------------------------------------------- */

  CFG.ticketRatePerEmployee = 0.055;  // tickets/second/employee
  CFG.ticketCap = 999;
  CFG.ticketMoraleBonus = 1.4;        // morale per ticket resolved (capped)

  /* ---- motivation (tap an employee) ------------------------------------ */

  CFG.motivateDuration = 7;
  CFG.motivateMultiplier = 2.1;
  CFG.motivateCooldown = 5;

  /* ---- progression ----------------------------------------------------- */

  CFG.starThresholds = [0, 55, 140, 300, 560];   // prestige -> 1..5 stars
  CFG.prestigePerDesk = 4;
  CFG.prestigePerDept = 26;
  CFG.prestigePerDecor = 9;
  CFG.prestigeMoraleWeight = 0.24;

  CFG.deskLevelCost = function (level) {
    return Math.round(900 * Math.pow(2.35, level - 1));
  };
  CFG.deskCost = function (owned) {
    return Math.round(680 * Math.pow(1.19, owned));
  };
  CFG.hireCost = function (owned) {
    return Math.round(420 * Math.pow(1.16, owned));
  };

  /* ---- floor plan ------------------------------------------------------ */

  // Walkable region (inclusive). Everything outside is wall / void.
  CFG.FLOOR = { r0: 1, r1: 20, c0: 1, c1: 24 };

  // Corridors are kept deliberately clear of furniture so the path graph
  // always stays connected. See docs/DESIGN.md.
  CFG.CORRIDOR_ROWS = [8, 16];
  CFG.CORRIDOR_COLS = [8, 16, 24];

  CFG.DEPARTMENTS = [
    {
      key: "eng", label: "Engineering", archetype: "eng",
      rect: { r0: 1, r1: 7, c0: 1, c1: 7 },
      carpet: "carpet_cool", accent: "#6a9bcc", cost: 0
    },
    {
      key: "sal", label: "Sales", archetype: "sal",
      rect: { r0: 1, r1: 7, c0: 9, c1: 15 },
      carpet: "carpet_warm", accent: "#d97757", cost: 9000
    },
    {
      key: "dsg", label: "Design", archetype: "dsg",
      rect: { r0: 1, r1: 7, c0: 17, c1: 23 },
      carpet: "carpet_warm", accent: "#c98b6b", cost: 42000
    },
    {
      key: "hr", label: "People", archetype: "hr",
      rect: { r0: 9, r1: 15, c0: 1, c1: 7 },
      carpet: "carpet_green", accent: "#788c5d", cost: 165000
    },
    {
      key: "fin", label: "Finance", archetype: "anl",
      rect: { r0: 9, r1: 15, c0: 9, c1: 15 },
      carpet: "carpet_cool", accent: "#5f8ea8", cost: 560000
    },
    {
      key: "exe", label: "Executive", archetype: "exe",
      rect: { r0: 9, r1: 15, c0: 17, c1: 23 },
      carpet: "carpet_green", accent: "#a8892f", cost: 1900000
    }
  ];

  /** Desk slots for a department: a 3x2 grid inset one tile from the rect. */
  CFG.deskSlots = function (dept) {
    var R = dept.rect, out = [];
    var rows = [R.r0 + 1, R.r0 + 4];
    var cols = [R.c0 + 1, R.c0 + 3, R.c0 + 5];
    for (var i = 0; i < rows.length; i++) {
      for (var j = 0; j < cols.length; j++) {
        out.push({ r: rows[i], c: cols[j] });
      }
    }
    return out;
  };

  /* ---- lobby fixtures -------------------------------------------------- */

  // `use` marks the tile an employee stands on to interact with the fixture.
  // It is validated at boot; if it is blocked the nearest free neighbour wins.
  CFG.FIXTURES = [
    { id: "elevator", kind: "elevator", sprite: "elevator", r: 20, c: 2, spawn: true },
    { id: "helpdesk", kind: "helpdesk", sprite: "helpdesk", r: 19, c: 7, interactive: true },
    { id: "coffee", kind: "coffee", sprite: "coffee_full", r: 18, c: 12, interactive: true },
    { id: "printer", kind: "printer", sprite: "printer_ok", r: 18, c: 17, interactive: true },
    { id: "water", kind: "decor", sprite: "water", r: 20, c: 21 },
    { id: "couch", kind: "decor", sprite: "couch", r: 20, c: 15 },
    { id: "cabinet", kind: "decor", sprite: "cabinet", r: 17, c: 22 },
    { id: "plant_a", kind: "decor", sprite: "plant", r: 17, c: 3 },
    { id: "plant_b", kind: "decor", sprite: "plant", r: 17, c: 19 }
  ];

  /* ---- decoration catalogue (morale / prestige) ------------------------ */

  CFG.DECOR = [
    { key: "plant", sprite: "plant", label: "Potted Plant", cost: 260,
      morale: 0.35, prestige: 1, max: 8 },
    { key: "water", sprite: "water", label: "Water Cooler", cost: 900,
      morale: 0.8, prestige: 2, max: 4 },
    { key: "couch", sprite: "couch", label: "Breakout Sofa", cost: 2400,
      morale: 1.6, prestige: 3, max: 3 },
    { key: "cabinet", sprite: "cabinet", label: "Filing Cabinet", cost: 1500,
      morale: 0.4, prestige: 3, max: 4 },
    { key: "whiteboard", sprite: "whiteboard", label: "Whiteboard", cost: 3200,
      morale: 0.6, prestige: 4, max: 4 },
    { key: "server", sprite: "server", label: "Server Rack", cost: 11000,
      morale: 0.2, prestige: 8, max: 3 },
    { key: "rug_warm", sprite: "rug_warm", label: "Warm Rug", cost: 1800,
      morale: 1.1, prestige: 3, max: 4 },
    { key: "rug_cool", sprite: "rug_cool", label: "Cool Rug", cost: 1800,
      morale: 1.1, prestige: 3, max: 4 }
  ];

  /* ---- upgrade catalogue ----------------------------------------------- */

  CFG.UPGRADES = [
    {
      key: "coffeeCap", label: "Premium Beans", max: 6,
      desc: "Coffee machine holds more and refills pay better.",
      cost: function (l) { return Math.round(1400 * Math.pow(2.1, l)); }
    },
    {
      key: "printerRel", label: "Maintenance Contract", max: 5,
      desc: "Printers jam far less often.",
      cost: function (l) { return Math.round(2600 * Math.pow(2.3, l)); }
    },
    {
      key: "hrTraining", label: "Onboarding Program", max: 5,
      desc: "New hires arrive sooner and start at a higher level.",
      cost: function (l) { return Math.round(3800 * Math.pow(2.2, l)); }
    },
    {
      key: "hvac", label: "Climate Control", max: 5,
      desc: "Morale recovers faster and drains slower.",
      cost: function (l) { return Math.round(5200 * Math.pow(2.25, l)); }
    },
    {
      key: "itSupport", label: "IT Support Desk", max: 5,
      desc: "Tickets accumulate slower and are worth more.",
      cost: function (l) { return Math.round(6400 * Math.pow(2.3, l)); }
    },
    {
      key: "ergonomics", label: "Ergonomic Chairs", max: 6,
      desc: "Every desk produces more output.",
      cost: function (l) { return Math.round(8800 * Math.pow(2.2, l)); }
    }
  ];

  /* ---- palette (mirrors css/tokens.css) -------------------------------- */

  CFG.COLORS = {
    bg: "#efe9dd",
    accent: "#d97757",
    good: "#788c5d",
    info: "#6a9bcc",
    warn: "#d6b058",
    bad: "#c25b4a",
    ink: "#26221c"
  };

  CFG.ARCHETYPE_KEYS = [
    "eng", "mgr", "dsg", "int", "sal", "anl", "bar", "it", "hr", "exe", "tmp", "jan"
  ];

  C.CFG = CFG;
})(window);
