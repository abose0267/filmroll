/**
 * Submits one exposure: reserve → upload (resumable, retried) → finalize.
 * Every step is idempotent so a flaky connection can retry safely without
 * consuming extra exposures.
 */
import { ref, uploadBytesResumable } from 'firebase/storage';
import { storage } from './firebase';
import { api, errorCode } from './api';
import type { ProcessedPhoto } from './image';
import type { PresetId } from '@shared/types';

export type SubmitStage = 'reserving' | 'uploading' | 'finalizing' | 'done';

export interface SubmitInput {
  groupId: string;
  rollId: string;
  requestId: string;
  photo: ProcessedPhoto;
  caption: string;
  location: string;
  capturedAt: number;
  preset: PresetId;
}

export interface SubmitProgress { stage: SubmitStage; progress: number }

async function uploadOne(path: string, blob: Blob, onBytes: (n: number) => void) {
  const task = uploadBytesResumable(ref(storage, path), blob, { contentType: blob.type || 'image/jpeg', cacheControl: 'private, no-store' });
  task.on('state_changed', (s) => onBytes(s.bytesTransferred));
  await task;
}

export async function submitExposure(input: SubmitInput, onProgress: (p: SubmitProgress) => void, reservation?: { reservationId: string; uploadPrefix: string }) {
  onProgress({ stage: 'reserving', progress: 0 });
  const res = reservation ?? (await api.reserveExposure({ groupId: input.groupId, rollId: input.rollId, requestId: input.requestId }));
  const parts = [
    ['original', input.photo.original.blob],
    ['display', input.photo.display.blob],
    ['thumb', input.photo.thumb.blob],
  ] as const;
  const total = parts.reduce((s, [, b]) => s + b.size, 0);
  const sent: Record<string, number> = {};
  onProgress({ stage: 'uploading', progress: 0 });
  for (const [name, blob] of parts) {
    let tries = 0;
    for (;;) {
      try {
        await uploadOne(res.uploadPrefix + name, blob, (n) => {
          sent[name] = n;
          onProgress({ stage: 'uploading', progress: Object.values(sent).reduce((a, b) => a + b, 0) / total });
        });
        break;
      } catch (e) {
        if (++tries >= 3 || errorCode(e) === 'storage/unauthorized') throw Object.assign(e as Error, { reservation: res });
        await new Promise((r) => setTimeout(r, 1000 * tries));
      }
    }
  }
  onProgress({ stage: 'finalizing', progress: 1 });
  const s = (k: keyof ProcessedPhoto) => ({ width: input.photo[k].width, height: input.photo[k].height });
  try {
    const out = await api.finalizeExposure({
      groupId: input.groupId, rollId: input.rollId, reservationId: res.reservationId,
      caption: input.caption, location: input.location, capturedAt: input.capturedAt, preset: input.preset,
      sizes: { original: s('original'), display: s('display'), thumb: s('thumb') },
    });
    onProgress({ stage: 'done', progress: 1 });
    return out;
  } catch (e) {
    throw Object.assign(e as Error, { reservation: res });
  }
}
