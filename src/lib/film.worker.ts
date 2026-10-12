/// <reference lib="webworker" />
import { PRESETS, applyFilm } from '@shared/presets';
import type { PresetId } from '@shared/types';

self.onmessage = (e: MessageEvent<{ id: number; buffer: ArrayBuffer; width: number; height: number; preset: PresetId; seed: number }>) => {
  const { id, buffer, width, height, preset, seed } = e.data;
  const data = new Uint8ClampedArray(buffer);
  applyFilm(data, width, height, PRESETS[preset], { seed });
  (self as unknown as Worker).postMessage({ id, buffer: data.buffer }, [data.buffer]);
};
