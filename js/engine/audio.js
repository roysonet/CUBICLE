/* ==========================================================================
   CUBICLE :: engine/audio.js
   Fully procedural audio. No sound files are shipped or fetched.

   WebAudio is created lazily on the first user gesture, which is what every
   modern browser's autoplay policy requires. Until then every call is a no-op.
   ========================================================================== */
(function (root) {
  "use strict";
  var C = (root.CUBICLE = root.CUBICLE || {});

  var ctx = null;
  var master = null;
  var musicBus = null;
  var sfxBus = null;
  var started = false;
  var musicTimer = 0;
  var musicStep = 0;

  var options = { muted: false, music: true, sfx: true };

  function ensure() {
    if (ctx) return ctx;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch (e) {
      return null;
    }
    master = ctx.createGain();
    master.gain.value = options.muted ? 0 : 0.9;
    master.connect(ctx.destination);

    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.5;
    sfxBus.connect(master);

    musicBus = ctx.createGain();
    musicBus.gain.value = options.music ? 0.16 : 0;
    musicBus.connect(master);

    return ctx;
  }

  /** One shaped oscillator voice. */
  function voice(opts) {
    if (!ctx || !options.sfx || options.muted) return;
    var t0 = ctx.currentTime + (opts.delay || 0);
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    var filter = ctx.createBiquadFilter();

    osc.type = opts.type || "square";
    osc.frequency.setValueAtTime(opts.f0, t0);
    if (opts.f1 && opts.f1 !== opts.f0) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.f1), t0 + opts.dur);
    }

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(opts.cutoff || 5200, t0);
    filter.Q.value = 0.8;

    var peak = (opts.gain === undefined ? 0.35 : opts.gain);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(opts.bus || sfxBus);
    osc.start(t0);
    osc.stop(t0 + opts.dur + 0.02);
  }

  /** Filtered noise burst - paper, clicks, crowd. */
  function noise(opts) {
    if (!ctx || !options.sfx || options.muted) return;
    var dur = opts.dur || 0.12;
    var frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < frames; i++) {
      // exponential decay envelope baked into the buffer
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, opts.decay || 2);
    }
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var filter = ctx.createBiquadFilter();
    filter.type = opts.filter || "bandpass";
    filter.frequency.value = opts.freq || 1800;
    filter.Q.value = opts.q || 1.2;
    var gain = ctx.createGain();
    gain.gain.value = opts.gain === undefined ? 0.28 : opts.gain;

    src.connect(filter);
    filter.connect(gain);
    gain.connect(sfxBus);
    src.start(ctx.currentTime + (opts.delay || 0));
  }

  /* ---- named SFX ------------------------------------------------------- */

  var sfx = {
    tap: function () {
      voice({ type: "triangle", f0: 880, f1: 1320, dur: 0.06, gain: 0.18, cutoff: 4000 });
    },
    click: function () {
      voice({ type: "square", f0: 620, f1: 420, dur: 0.05, gain: 0.14, cutoff: 2600 });
    },
    coin: function () {
      voice({ type: "triangle", f0: 1180, f1: 1180, dur: 0.07, gain: 0.2, cutoff: 6000 });
      voice({ type: "triangle", f0: 1560, f1: 1560, dur: 0.1, gain: 0.16, cutoff: 6000, delay: 0.055 });
    },
    cash: function () {
      voice({ type: "triangle", f0: 900, dur: 0.06, gain: 0.2, cutoff: 6000 });
      voice({ type: "triangle", f0: 1350, dur: 0.07, gain: 0.18, cutoff: 6000, delay: 0.05 });
      voice({ type: "triangle", f0: 1800, dur: 0.11, gain: 0.15, cutoff: 6000, delay: 0.1 });
    },
    brew: function () {
      noise({ dur: 0.45, freq: 900, q: 0.7, gain: 0.16, decay: 1.2 });
      voice({ type: "sine", f0: 240, f1: 420, dur: 0.4, gain: 0.12, cutoff: 1400, delay: 0.05 });
    },
    repair: function () {
      noise({ dur: 0.09, freq: 2400, q: 2, gain: 0.3, decay: 3 });
      noise({ dur: 0.09, freq: 1700, q: 2, gain: 0.26, decay: 3, delay: 0.11 });
      voice({ type: "square", f0: 300, f1: 520, dur: 0.14, gain: 0.14, delay: 0.06 });
    },
    ticket: function () {
      noise({ dur: 0.16, freq: 3000, q: 0.9, gain: 0.2, decay: 1.6 });
      voice({ type: "triangle", f0: 1400, f1: 1900, dur: 0.1, gain: 0.14, delay: 0.04 });
    },
    motivate: function () {
      voice({ type: "sawtooth", f0: 420, f1: 900, dur: 0.18, gain: 0.16, cutoff: 3200 });
    },
    levelup: function () {
      var notes = [523, 659, 784, 1047];
      for (var i = 0; i < notes.length; i++) {
        voice({ type: "triangle", f0: notes[i], dur: 0.28, gain: 0.2, cutoff: 6000, delay: i * 0.09 });
      }
    },
    error: function () {
      voice({ type: "square", f0: 260, f1: 150, dur: 0.18, gain: 0.2, cutoff: 1400 });
    },
    place: function () {
      noise({ dur: 0.14, freq: 700, q: 0.8, gain: 0.26, decay: 2.4 });
      voice({ type: "sine", f0: 180, f1: 90, dur: 0.16, gain: 0.16, delay: 0.02 });
    },
    door: function () {
      voice({ type: "sine", f0: 300, f1: 520, dur: 0.22, gain: 0.1, cutoff: 1200 });
      noise({ dur: 0.2, freq: 500, q: 0.6, gain: 0.1, decay: 1.5, delay: 0.16 });
    },
    star: function () {
      var notes = [784, 988, 1319, 1568, 2093];
      for (var i = 0; i < notes.length; i++) {
        voice({ type: "sine", f0: notes[i], dur: 0.5, gain: 0.2, cutoff: 8000, delay: i * 0.08 });
      }
    },
    unlock: function () {
      var notes = [392, 523, 659, 784, 1047, 1319];
      for (var i = 0; i < notes.length; i++) {
        voice({ type: "triangle", f0: notes[i], dur: 0.34, gain: 0.17, cutoff: 7000, delay: i * 0.07 });
      }
    }
  };

  /* ---- ambient music --------------------------------------------------- */

  // A slow, unobtrusive pentatonic bed. Deliberately sparse: it should sit
  // under the SFX, never compete with them.
  var SCALE = [220.0, 261.6, 293.7, 329.6, 392.0, 440.0, 523.3, 587.3];
  var BASS = [110.0, 130.8, 146.8, 98.0];

  function musicNote(freq, dur, gain, delay) {
    if (!ctx || !options.music || options.muted) return;
    var t0 = ctx.currentTime + (delay || 0);
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    var f = ctx.createBiquadFilter();
    osc.type = "triangle";
    osc.frequency.value = freq;
    f.type = "lowpass";
    f.frequency.value = 1600;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(f); f.connect(g); g.connect(musicBus);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }

  function musicTick(dt) {
    if (!ctx || !options.music || options.muted || !started) return;
    musicTimer -= dt;
    if (musicTimer > 0) return;
    musicTimer = 1.1;

    var step = musicStep++;
    // bass every 4 steps
    if (step % 4 === 0) {
      musicNote(BASS[(step / 4) % BASS.length], 2.6, 0.22, 0);
    }
    // two sparse melody notes per bar, seeded by step so it drifts
    var a = SCALE[(step * 3) % SCALE.length];
    var b = SCALE[(step * 5 + 2) % SCALE.length];
    musicNote(a, 1.6, 0.11, 0);
    musicNote(b, 1.4, 0.08, 0.55);
  }

  /* ---- public API ------------------------------------------------------ */

  var Audio = {
    get enabled() { return !!ctx; },

    /** Must be called from a user-gesture handler. */
    unlock: function () {
      var c = ensure();
      if (!c) return false;
      if (c.state === "suspended") c.resume();
      started = true;
      return true;
    },

    setOptions: function (o) {
      for (var k in o) if (k in options) options[k] = o[k];
      if (master) master.gain.value = options.muted ? 0 : 0.9;
      if (musicBus) musicBus.gain.value = options.music && !options.muted ? 0.16 : 0;
    },

    getOptions: function () { return options; },

    play: function (name) {
      var fn = sfx[name];
      if (fn) fn();
    },

    update: function (dt) { musicTick(dt); }
  };

  C.Audio = Audio;
})(window);
