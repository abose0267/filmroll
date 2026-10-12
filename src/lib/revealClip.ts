/**
 * Shareable "reveal" clip for Stories: a 9:16 video of the developing
 * animation and contact sheet, rendered on a canvas and recorded with
 * MediaRecorder entirely on the device. Only made when the user asks.
 */
import { loadPhoto } from './photos';
import { PRESETS } from '@shared/presets';
import type { PhotoDoc, RollDoc } from '@shared/types';

const W = 1080;
const H = 1920;
const FPS = 30;
const DURATION = 8.5; // seconds

function pickMime(): { mime: string; ext: string } | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const [mime, ext] of [
    ['video/mp4;codecs=avc1', 'mp4'],
    ['video/mp4', 'mp4'],
    ['video/webm;codecs=vp9', 'webm'],
    ['video/webm;codecs=vp8', 'webm'],
    ['video/webm', 'webm'],
  ] as const) {
    if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  }
  return null;
}

export function canMakeRevealClip(): boolean {
  return !!pickMime() && typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype;
}

async function loadImages(photos: PhotoDoc[]): Promise<HTMLImageElement[]> {
  return Promise.all(
    photos.map(async (p) => {
      const url = await loadPhoto(p.groupId, p.rollId, p.id, 'thumb');
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    }),
  );
}

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const seg = (t: number, a: number, b: number) => ease((t - a) / (b - a));

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawCanister(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, body: string, band: string, label: string) {
  const metal = ctx.createLinearGradient(cx - 100 * s, 0, cx + 100 * s, 0);
  metal.addColorStop(0, '#55504a');
  metal.addColorStop(0.4, '#d8d2c8');
  metal.addColorStop(1, '#4a4540');
  ctx.fillStyle = '#3a2a1d';
  rounded(ctx, cx + 80 * s, cy - 60 * s, 150 * s, 120 * s, 10 * s);
  ctx.fill();
  ctx.fillStyle = metal;
  rounded(ctx, cx - 24 * s, cy - 205 * s, 48 * s, 30 * s, 6 * s);
  ctx.fill();
  rounded(ctx, cx - 100 * s, cy - 180 * s, 200 * s, 40 * s, 14 * s);
  ctx.fill();
  rounded(ctx, cx - 100 * s, cy + 140 * s, 200 * s, 40 * s, 14 * s);
  ctx.fill();
  ctx.fillStyle = body;
  ctx.fillRect(cx - 90 * s, cy - 145 * s, 180 * s, 290 * s);
  ctx.fillStyle = band;
  ctx.fillRect(cx - 90 * s, cy + 70 * s, 180 * s, 36 * s);
  ctx.fillStyle = '#FFF8EF';
  ctx.font = `700 ${34 * s}px Fraunces, Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.fillText('FILM', cx, cy - 30 * s);
  ctx.fillText('ROLL', cx, cy + 12 * s);
  ctx.font = `500 ${20 * s}px "DM Mono", monospace`;
  ctx.fillText(label, cx, cy + 50 * s);
}

function wrapTitle(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines.slice(0, 2);
}

export async function makeRevealClip(roll: RollDoc, groupName: string, photos: PhotoDoc[], onProgress?: (p: number) => void): Promise<File> {
  const fmt = pickMime();
  if (!fmt) throw new Error('Video recording isn’t supported in this browser.');
  const frames = photos.slice(0, 12);
  const imgs = await loadImages(frames);
  const preset = PRESETS[roll.preset];

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const stream = canvas.captureStream(FPS);
  const rec = new MediaRecorder(stream, { mimeType: fmt.mime, videoBitsPerSecond: 6_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()));

  const cols = 3;
  const rows = Math.max(1, Math.ceil(frames.length / cols));
  const gap = 18;
  // leave room under the sheet for its caption and the end card
  const cell = Math.min(300, Math.floor((H - 560 - 300 - (rows - 1) * gap) / rows));
  const sheetW = cols * cell + (cols - 1) * gap;
  const sheetH = rows * cell + (rows - 1) * gap;
  const sx = (W - sheetW) / 2;
  const sy = 560;

  const draw = (t: number) => {
    // background: dark, with a red safelight while developing
    const red = seg(t, 1.2, 1.8) * (1 - seg(t, 3.2, 3.8));
    const bg = ctx.createRadialGradient(W / 2, H * 0.4, 50, W / 2, H * 0.45, H * 0.8);
    bg.addColorStop(0, `rgb(${60 + 110 * red}, ${50 - 20 * red}, ${40 - 20 * red})`);
    bg.addColorStop(1, '#1d1a18');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // header
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(244,235,221,0.6)';
    ctx.font = '500 34px "DM Mono", monospace';
    ctx.fillText(groupName.toUpperCase().slice(0, 32), W / 2, 220);
    ctx.fillStyle = '#F4EBDD';
    ctx.font = '600 92px Fraunces, Georgia, serif';
    wrapTitle(ctx, roll.name, W - 160).forEach((l, i) => ctx.fillText(l, W / 2, 330 + i * 100));

    // 1) canister
    const canAlpha = 1 - seg(t, 1.0, 1.6);
    if (canAlpha > 0) {
      ctx.globalAlpha = canAlpha;
      drawCanister(ctx, W / 2 - 40, H * 0.55, 1.6, preset.canister.body, preset.canister.band, preset.code);
      ctx.globalAlpha = 1;
    }

    // 2) developing
    const devAlpha = seg(t, 1.4, 1.9) * (1 - seg(t, 3.1, 3.5));
    if (devAlpha > 0) {
      ctx.globalAlpha = devAlpha;
      ctx.fillStyle = '#F4EBDD';
      ctx.font = '600 76px Fraunces, Georgia, serif';
      ctx.fillText('Developing…', W / 2, H * 0.55);
      ctx.font = '500 32px "DM Mono", monospace';
      ctx.fillStyle = 'rgba(244,235,221,0.7)';
      ctx.fillText(`${preset.code} · ${roll.exposuresUsed} exposures`, W / 2, H * 0.55 + 70);
      ctx.globalAlpha = 1;
    }

    // 3) contact sheet, frames developing one by one
    const sheetIn = seg(t, 3.2, 3.8);
    if (sheetIn > 0) {
      ctx.globalAlpha = sheetIn;
      ctx.fillStyle = '#f2ece2';
      rounded(ctx, sx - 40, sy - 40, sheetW + 80, sheetH + 120, 10);
      ctx.fill();
      ctx.fillStyle = '#1c1916';
      ctx.fillRect(sx - 14, sy - 14, sheetW + 28, sheetH + 28);
      imgs.forEach((img, i) => {
        const x = sx + (i % cols) * (cell + gap);
        const y = sy + Math.floor(i / cols) * (cell + gap);
        const dev = seg(t, 3.6 + i * 0.22, 4.6 + i * 0.22);
        ctx.fillStyle = '#141210';
        ctx.fillRect(x, y, cell, cell);
        // contain the photo in its square cell (keeps portrait/landscape shape)
        const r = Math.min(cell / img.naturalWidth, cell / img.naturalHeight);
        const w = img.naturalWidth * r;
        const h = img.naturalHeight * r;
        ctx.globalAlpha = sheetIn * dev;
        ctx.filter = `sepia(${1 - dev}) brightness(${1 + 1.5 * (1 - dev)})`;
        ctx.drawImage(img, x + (cell - w) / 2, y + (cell - h) / 2, w, h);
        ctx.filter = 'none';
        ctx.globalAlpha = sheetIn;
        ctx.fillStyle = 'rgba(226,165,72,0.75)';
        ctx.font = '500 20px "DM Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(String(frames[i].frame), x + 8, y + cell - 10);
        ctx.textAlign = 'center';
      });
      ctx.fillStyle = '#6b5f55';
      ctx.font = '500 24px "DM Mono", monospace';
      ctx.fillText(`${roll.name.toUpperCase().slice(0, 30)} · CONTACT SHEET`, W / 2, sy + sheetH + 60);
      ctx.globalAlpha = 1;
    }

    // 4) end card
    const end = seg(t, 7.0, 7.6);
    if (end > 0) {
      ctx.globalAlpha = end;
      ctx.fillStyle = '#F4EBDD';
      ctx.font = '700 64px Fraunces, Georgia, serif';
      ctx.fillText('FilmRoll', W / 2, H - 150);
      ctx.font = '500 34px "DM Sans", sans-serif';
      ctx.fillStyle = 'rgba(244,235,221,0.75)';
      ctx.fillText('Different lives. One roll of film.', W / 2, H - 92);
      ctx.globalAlpha = 1;
    }
  };

  draw(0);
  rec.start(250);
  const start = performance.now();
  await new Promise<void>((resolve) => {
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      draw(Math.min(t, DURATION));
      onProgress?.(Math.min(1, t / DURATION));
      if (t >= DURATION) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  rec.stop();
  await stopped;
  stream.getTracks().forEach((tr) => tr.stop());
  const blob = new Blob(chunks, { type: fmt.mime.split(';')[0] });
  const safe = roll.name.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'roll';
  return new File([blob], `filmroll-${safe}.${fmt.ext}`, { type: blob.type });
}

/** Share sheet on phones; download elsewhere. */
export async function shareOrDownload(file: File): Promise<'shared' | 'downloaded'> {
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: 'Our roll just developed 📸 — shot on FilmRoll' });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'shared';
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
