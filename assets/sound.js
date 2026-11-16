// Tiny sound helper – shared across all games
(function () {
  let ac = null,
      muted = false;

  function audio() {
    if (!ac) {
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
      } catch (_) { ac = null; }
    }
    if (ac && ac.state === "suspended") ac.resume().catch(() => {});
    return ac;
  }

  function tone(f, dur, type = "square", vol = 0.12, f2 = null, delay = 0) {
    if (muted || !ac) return;
    const t = ac.currentTime + delay,
          o = ac.createOscillator(),
          g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(ac.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function noise(dur, vol = 0.25, freq = 1200) {
    if (muted || !ac) return;
    if (!window.__noiseBuf) {
      const buf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      window.__noiseBuf = buf;
    }
    const t = ac.currentTime,
          src = ac.createBufferSource(),
          g = ac.createGain(),
          fl = ac.createBiquadFilter();
    src.buffer = window.__noiseBuf;
    fl.type = "lowpass";
    fl.frequency.setValueAtTime(freq, t);
    fl.frequency.exponentialRampToValueAtTime(80, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(fl).connect(g).connect(ac.destination);
    src.start(t);
    src.stop(t + dur);
  }

  // Export a minimal sfx collection – games can extend it later
  window.sfx = {
    click: () => tone(800, 0.03, "square", 0.05),
    boom:  () => noise(0.45, 0.35, 2500)
  };

  // Global mute toggle (wired to the header button)
  window.toggleMute = (state) => { muted = !!state; };
})();
