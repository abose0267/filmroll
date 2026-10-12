/**
 * Client-side photo processing: decode with EXIF orientation, produce
 * - original: full-resolution (≤4096px) high-quality JPEG; re-encoding strips
 *   EXIF metadata such as precise GPS before anything leaves the phone,
 * - display: film-processed ≤2048px JPEG,
 * - thumb: film-processed ≤480px JPEG for contact sheets.
 */
import { DISPLAY_MAX_DIMENSION, LIMITS, ORIGINAL_MAX_DIMENSION, THUMB_MAX_DIMENSION } from '@shared/constants';
import { PRESETS, dateStampText } from '@shared/presets';
import type { PresetId } from '@shared/types';
import { filmPixels } from './film';

export interface Variant { blob: Blob; width: number; height: number }
export interface ProcessedPhoto { original: Variant; display: Variant; thumb: Variant }

export async function decode(src: Blob): Promise<ImageBitmap> {
  if (src.size > LIMITS.inputBytes) throw new Error('That photo is too large (max 40 MB).');
  try {
    return await createImageBitmap(src, { imageOrientation: 'from-image' });
  } catch {
    // Some browsers can't decode HEIC/odd formats via createImageBitmap; try <img>.
    const url = URL.createObjectURL(src);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return await createImageBitmap(img);
    } catch {
      throw new Error('This image format isn’t supported. Try a JPEG or PNG.');
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function fit(w: number, h: number, max: number) {
  const s = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toBlob(c: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), 'image/jpeg', quality));
}

/** Draws the source scaled into a new canvas with high-quality smoothing. */
export function drawScaled(src: CanvasImageSource & { width: number; height: number }, max: number): HTMLCanvasElement {
  const { width, height } = fit(src.width, src.height, max);
  const c = canvas(width, height);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, width, height);
  return c;
}

/** Orange LED-style date stamp in the lower right, like a point-and-shoot. */
export function drawDateStamp(c: HTMLCanvasElement, ms: number) {
  const ctx = c.getContext('2d')!;
  const size = Math.max(10, Math.round(Math.min(c.width, c.height) * 0.045));
  ctx.save();
  ctx.font = `500 ${size}px 'DM Mono', ui-monospace, monospace`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#FF8A3D';
  ctx.shadowColor = 'rgba(255,110,40,0.85)';
  ctx.shadowBlur = size * 0.35;
  ctx.globalCompositeOperation = 'screen';
  ctx.fillText(dateStampText(ms), c.width - size * 1.1, c.height - size * 1.0);
  ctx.restore();
}

export async function filmCanvas(src: HTMLCanvasElement, preset: PresetId, seed: number): Promise<HTMLCanvasElement> {
  const ctx = src.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, src.width, src.height);
  const out = await filmPixels(img, preset, seed);
  ctx.putImageData(out, 0, 0);
  return src;
}

export interface ProcessOptions { preset: PresetId; seed: number; dateStamp: boolean; capturedAt: number }

export async function processPhoto(bitmap: ImageBitmap, o: ProcessOptions): Promise<ProcessedPhoto> {
  const orig = drawScaled(bitmap, ORIGINAL_MAX_DIMENSION);
  let q = 0.95;
  let originalBlob = await toBlob(orig, q);
  while (originalBlob.size > LIMITS.originalBytes && q > 0.7) originalBlob = await toBlob(orig, (q -= 0.08));

  const disp = await filmCanvas(drawScaled(bitmap, DISPLAY_MAX_DIMENSION), o.preset, o.seed);
  if (o.dateStamp) drawDateStamp(disp, o.capturedAt);
  const displayBlob = await toBlob(disp, 0.9);

  // Thumb from the processed display version so grain/stamp match.
  const th = drawScaled(disp, THUMB_MAX_DIMENSION);
  let tq = 0.82;
  let thumbBlob = await toBlob(th, tq);
  while (thumbBlob.size > LIMITS.thumbBytes && tq > 0.5) thumbBlob = await toBlob(th, (tq -= 0.1));

  return {
    original: { blob: originalBlob, width: orig.width, height: orig.height },
    display: { blob: displayBlob, width: disp.width, height: disp.height },
    thumb: { blob: thumbBlob, width: th.width, height: th.height },
  };
}

/** Quick film preview for the confirmation screen. */
export async function previewUrl(bitmap: ImageBitmap, o: ProcessOptions, max = 1080): Promise<string> {
  const c = await filmCanvas(drawScaled(bitmap, max), o.preset, o.seed);
  if (o.dateStamp) drawDateStamp(c, o.capturedAt);
  return URL.createObjectURL(await toBlob(c, 0.85));
}

export { PRESETS };
