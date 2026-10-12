/**
 * Film presets as pure pixel operations on RGBA buffers, so they run in the
 * browser (Canvas ImageData) and in tests. No AI or external services.
 */
import type { PresetId } from './types';

export interface FilmParams {
  /** Stops of exposure (-1..1). */
  exposure: number;
  /** -1..1, applied as an S-curve around mid grey. */
  contrast: number;
  /** -1 (mono) .. 1. */
  saturation: number;
  /** Blue↔amber white balance shift (-1..1). */
  warmth: number;
  /** Green↔magenta shift (-1..1). */
  tint: number;
  /** Lifted blacks (0..0.3). */
  fade: number;
  /** Highlight roll-off (0..1) — film shoulder. */
  shoulder: number;
  /** Shadow / highlight split toning colours (RGB 0..1) and strength. */
  shadowTone: [number, number, number];
  highlightTone: [number, number, number];
  splitStrength: number;
  /** Grain amplitude (0..0.2) and size relative to a 1000px image. */
  grain: number;
  grainSize: number;
  /** Corner darkening (0..1). */
  vignette: number;
  /** Warm light leak from one edge (0..1). */
  leak: number;
  /** On-camera flash: centre hotspot and fall-off (0..1). */
  flash: number;
  mono: boolean;
}

export interface FilmPreset {
  id: PresetId;
  name: string;
  description: string;
  /** Short code printed on the film edge / canister. */
  code: string;
  /** Canister colours for the UI. */
  canister: { body: string; band: string; text: string };
  params: FilmParams;
}

const base: FilmParams = {
  exposure: 0, contrast: 0, saturation: 0, warmth: 0, tint: 0, fade: 0, shoulder: 0.3,
  shadowTone: [0.5, 0.5, 0.5], highlightTone: [0.5, 0.5, 0.5], splitStrength: 0,
  grain: 0.04, grainSize: 1, vignette: 0.2, leak: 0, flash: 0, mono: false,
};

export const PRESETS: Record<PresetId, FilmPreset> = {
  classic35: {
    id: 'classic35', name: 'Classic 35mm', code: 'C-400', description: 'Balanced colour negative with gentle grain.',
    canister: { body: '#E7B53C', band: '#2B2622', text: '#2B2622' },
    params: { ...base, contrast: 0.12, saturation: 0.05, warmth: 0.08, fade: 0.03, shoulder: 0.45, shadowTone: [0.42, 0.5, 0.56], highlightTone: [0.58, 0.52, 0.44], splitStrength: 0.12, grain: 0.045, vignette: 0.22 },
  },
  warmVintage: {
    id: 'warmVintage', name: 'Warm Vintage', code: 'V-200', description: 'Golden, faded and nostalgic with a soft light leak.',
    canister: { body: '#D9714E', band: '#F4EBDD', text: '#FFF8EF' },
    params: { ...base, exposure: 0.05, contrast: -0.02, saturation: -0.08, warmth: 0.32, tint: 0.04, fade: 0.1, shoulder: 0.6, shadowTone: [0.48, 0.42, 0.5], highlightTone: [0.64, 0.54, 0.38], splitStrength: 0.22, grain: 0.06, vignette: 0.32, leak: 0.35 },
  },
  blackWhite: {
    id: 'blackWhite', name: 'Black & White', code: 'BW-400', description: 'Rich monochrome with deep blacks and real grain.',
    canister: { body: '#2E2B29', band: '#F4EBDD', text: '#F4EBDD' },
    params: { ...base, contrast: 0.25, saturation: -1, fade: 0.02, shoulder: 0.4, grain: 0.07, grainSize: 1.2, vignette: 0.3, mono: true },
  },
  disposableFlash: {
    id: 'disposableFlash', name: 'Disposable Flash', code: 'F-800', description: 'Punchy colour, hard flash and a dark vignette.',
    canister: { body: '#3F7FBF', band: '#F2D24B', text: '#FFFFFF' },
    params: { ...base, exposure: 0.08, contrast: 0.28, saturation: 0.18, warmth: 0.05, tint: -0.03, fade: 0.0, shoulder: 0.25, shadowTone: [0.4, 0.52, 0.5], highlightTone: [0.56, 0.54, 0.46], splitStrength: 0.1, grain: 0.07, grainSize: 1.15, vignette: 0.55, flash: 0.45 },
  },
  softPastel: {
    id: 'softPastel', name: 'Soft Pastel', code: 'P-160', description: 'Airy, low-contrast and gently washed colours.',
    canister: { body: '#E9B8C4', band: '#FFF8EF', text: '#5E4650' },
    params: { ...base, exposure: 0.15, contrast: -0.18, saturation: -0.22, warmth: 0.06, tint: 0.06, fade: 0.14, shoulder: 0.7, shadowTone: [0.52, 0.48, 0.58], highlightTone: [0.6, 0.55, 0.52], splitStrength: 0.18, grain: 0.03, vignette: 0.12 },
  },
};

export const PRESET_IDS = Object.keys(PRESETS) as PresetId[];

export function isPresetId(v: unknown): v is PresetId {
  return typeof v === 'string' && v in PRESETS;
}

/** Deterministic hash noise in [-1, 1] for grain (stable across runs for a seed). */
function noise(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h & 0xffff) / 0x7fff) - 1;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const srgbToLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** Builds a 256-entry tone curve: exposure, contrast S-curve, shoulder and fade. */
export function toneCurve(p: FilmParams): Float32Array {
  const lut = new Float32Array(256);
  const gain = 2 ** p.exposure;
  const k = 1 + p.contrast * 1.6;
  for (let i = 0; i < 256; i++) {
    let v = (i / 255) * gain;
    // highlight shoulder: compress values above 0.75
    if (v > 0.75 && p.shoulder > 0) {
      const over = v - 0.75;
      v = 0.75 + over / (1 + over * p.shoulder * 4);
    }
    v = clamp01(v);
    // contrast as a smooth S around 0.5
    const s = v - 0.5;
    v = clamp01(0.5 + Math.tanh(s * 2 * k) / (2 * Math.tanh(k)));
    // faded blacks
    v = p.fade + v * (1 - p.fade);
    lut[i] = v;
  }
  return lut;
}

export interface ApplyOptions {
  /** Seed for grain/leak placement (e.g. derived from the photo id). */
  seed?: number;
}

/**
 * Applies a preset in place to an RGBA buffer.
 * Grain and vignette scale with image size so thumbnails and full images match.
 */
export function applyFilm(data: Uint8ClampedArray, width: number, height: number, preset: FilmPreset | FilmParams, opts: ApplyOptions = {}): void {
  const p = 'params' in preset ? preset.params : preset;
  const seed = opts.seed ?? 7;
  const lut = toneCurve(p);
  const wb = [1 + p.warmth * 0.12 - p.tint * 0.02, 1 - p.tint * 0.06, 1 - p.warmth * 0.14 - p.tint * 0.02];
  const sat = 1 + p.saturation;
  const cx = width / 2;
  const cy = height / 2;
  const maxR = Math.hypot(cx, cy);
  const grainScale = Math.max(1, (Math.max(width, height) / 1000) * p.grainSize);
  const leakSide = seed % 2 === 0 ? 1 : -1;
  const leakY = 0.25 + ((seed >>> 3) % 50) / 100;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let r = data[i] / 255;
      let g = data[i + 1] / 255;
      let b = data[i + 2] / 255;

      // white balance
      r *= wb[0];
      g *= wb[1];
      b *= wb[2];

      // flash: brighten centre, fall off to edges
      const dx = (x - cx) / maxR;
      const dy = (y - cy) / maxR;
      const d2 = dx * dx + dy * dy;
      if (p.flash > 0) {
        const f = 1 + p.flash * (0.5 * Math.exp(-d2 * 6) - 0.35 * d2);
        r *= f;
        g *= f;
        b *= f;
      }

      // saturation around perceived luminance
      const lum = 0.2126 * srgbToLin(clamp01(r)) + 0.7152 * srgbToLin(clamp01(g)) + 0.0722 * srgbToLin(clamp01(b));
      const lumS = lum <= 0.0031308 ? lum * 12.92 : 1.055 * lum ** (1 / 2.4) - 0.055;
      if (p.mono) {
        // slight red filter look for B&W
        const m = clamp01(0.3 * r + 0.62 * g + 0.08 * b);
        r = g = b = m;
      } else {
        r = lumS + (r - lumS) * sat;
        g = lumS + (g - lumS) * sat;
        b = lumS + (b - lumS) * sat;
      }

      // tone curve
      r = lut[Math.round(clamp01(r) * 255)];
      g = lut[Math.round(clamp01(g) * 255)];
      b = lut[Math.round(clamp01(b) * 255)];

      // split toning: shadows toward shadowTone, highlights toward highlightTone
      if (p.splitStrength > 0 && !p.mono) {
        const l = (r + g + b) / 3;
        const ws = (1 - l) * p.splitStrength;
        const wh = l * p.splitStrength;
        r += (p.shadowTone[0] - 0.5) * ws + (p.highlightTone[0] - 0.5) * wh;
        g += (p.shadowTone[1] - 0.5) * ws + (p.highlightTone[1] - 0.5) * wh;
        b += (p.shadowTone[2] - 0.5) * ws + (p.highlightTone[2] - 0.5) * wh;
      }

      // light leak: warm glow bleeding in from one edge
      if (p.leak > 0) {
        const ex = leakSide > 0 ? x / width : 1 - x / width;
        const ey = y / height - leakY;
        const glow = p.leak * Math.exp(-((1 - ex) * (1 - ex)) * 18 - ey * ey * 6);
        r += glow * 0.9;
        g += glow * 0.42;
        b += glow * 0.12;
      }

      // vignette
      if (p.vignette > 0) {
        const v = 1 - p.vignette * Math.min(1, d2 * 1.15) ** 1.4;
        r *= v;
        g *= v;
        b *= v;
      }

      // grain: luminance-weighted (strongest in mid-tones), monochrome
      if (p.grain > 0) {
        const n = noise(Math.floor(x / grainScale), Math.floor(y / grainScale), seed);
        const l = (r + g + b) / 3;
        const amt = p.grain * n * (0.35 + 1.3 * l * (1 - l));
        r += amt;
        g += amt;
        b += amt;
      }

      data[i] = clamp01(r) * 255 + 0.5;
      data[i + 1] = clamp01(g) * 255 + 0.5;
      data[i + 2] = clamp01(b) * 255 + 0.5;
      // alpha untouched
    }
  }
}

/** Seed derived from an id string so the same photo always renders the same grain. */
export function seedFrom(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Orange "date stamp" text in the classic '24 10 31 format. */
export function dateStampText(ms: number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { year: '2-digit', month: '2-digit', day: '2-digit', timeZone }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `'${get('year')} ${get('month')} ${get('day')}`;
}
