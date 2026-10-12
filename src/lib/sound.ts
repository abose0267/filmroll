/** Synthesised mechanical shutter + film-advance click (no audio files). */
let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function burst(c: AudioContext, at: number, dur: number, freq: number, gain: number) {
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 1.4;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(bp).connect(g).connect(c.destination);
  src.start(at);
}

export function playShutter() {
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  burst(c, t, 0.035, 3200, 0.9);
  burst(c, t + 0.07, 0.05, 1800, 0.6);
}

export function playAdvance() {
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  for (let i = 0; i < 5; i++) burst(c, t + i * 0.045, 0.02, 2400 + i * 120, 0.25);
}

export function vibrate(ms: number | number[]) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* unsupported */
  }
}
