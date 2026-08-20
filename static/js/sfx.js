// Tiny WebAudio synth for HUD feedback sounds. No samples, all procedural.
let ctx = null;

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function blip(freq, { dur = 0.08, type = "sine", gain = 0.08, slide = 0 } = {}) {
  try {
    const c = ac();
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  } catch { /* audio is decorative */ }
}

export const sfx = {
  unlock() { ac(); },
  click() { blip(1150, { dur: 0.06, gain: 0.06 }); },
  hover() { blip(1900, { dur: 0.025, gain: 0.02 }); },
  open() { blip(420, { dur: 0.22, slide: 640, gain: 0.07 }); blip(1260, { dur: 0.1, gain: 0.03 }); },
  close() { blip(880, { dur: 0.18, slide: -560, gain: 0.06 }); },
  clap() { blip(220, { dur: 0.4, slide: -140, type: "sawtooth", gain: 0.05 }); blip(2400, { dur: 0.12, gain: 0.04 }); },
  micOn() { blip(660, { dur: 0.1, gain: 0.07 }); setTimeout(() => blip(990, { dur: 0.12, gain: 0.07 }), 90); },
  micOff() { blip(990, { dur: 0.1, gain: 0.07 }); setTimeout(() => blip(660, { dur: 0.12, gain: 0.07 }), 90); },
  error() { blip(180, { dur: 0.25, type: "square", gain: 0.05 }); },
};
