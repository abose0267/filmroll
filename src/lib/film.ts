/** Runs film processing in a worker so the UI stays smooth; falls back to the main thread. */
import { PRESETS, applyFilm } from '@shared/presets';
import type { PresetId } from '@shared/types';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (b: ArrayBuffer) => void>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./film.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; buffer: ArrayBuffer }>) => {
      pending.get(e.data.id)?.(e.data.buffer);
      pending.delete(e.data.id);
    };
    worker.onerror = () => {
      worker = null;
    };
    return worker;
  } catch {
    return null;
  }
}

export async function filmPixels(img: ImageData, preset: PresetId, seed: number): Promise<ImageData> {
  const w = getWorker();
  if (!w) {
    applyFilm(img.data, img.width, img.height, PRESETS[preset], { seed });
    return img;
  }
  const id = nextId++;
  const buffer = img.data.buffer.slice(0);
  const out = await new Promise<ArrayBuffer>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Film processing timed out')), 30_000);
    pending.set(id, (b) => {
      clearTimeout(t);
      resolve(b);
    });
    w.postMessage({ id, buffer, width: img.width, height: img.height, preset, seed }, [buffer]);
  }).catch(() => {
    applyFilm(img.data, img.width, img.height, PRESETS[preset], { seed });
    return img.data.buffer as ArrayBuffer;
  });
  return new ImageData(new Uint8ClampedArray(out), img.width, img.height);
}
