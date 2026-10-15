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

/** A single soft click for each notch of the film-advance wheel. */
export function playTick() {
  const c = ac();
  if (!c) return;
  burst(c, c.currentTime, 0.012, 2800, 0.22);
}

const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
const isIOS = typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)));
let iosSwitch: HTMLLabelElement | null = null;

/**
 * iPhones don't support navigator.vibrate. Since iOS 18, toggling a native
 * <input type="checkbox" switch> plays the system's haptic tick, so we flip a
 * hidden one. Works best inside a touch/tap; elsewhere it's silently skipped.
 */
function iosTick() {
  if (!iosSwitch) {
    const label = document.createElement('label');
    label.setAttribute('aria-hidden', 'true');
    label.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    label.appendChild(input);
    document.body.appendChild(label);
    iosSwitch = label;
  }
  iosSwitch.click();
}

/** Haptic feedback: vibration on Android, the system tick on iPhone (iOS 18+). */
export function vibrate(ms: number | number[]) {
  try {
    if (canVibrate) navigator.vibrate(ms);
    else if (isIOS) {
      // one tick per pulse in a pattern ([on, off, on, …])
      const pulses = Array.isArray(ms) ? ms : [ms];
      let at = 0;
      pulses.forEach((d, i) => {
        if (i % 2 === 0) {
          if (at === 0) iosTick();
          else setTimeout(iosTick, at);
        }
        at += d;
      });
    }
  } catch {
    /* unsupported */
  }
}
