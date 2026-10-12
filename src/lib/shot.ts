/**
 * One exposure, from shutter to saved. The shutter is final: processing,
 * reservation and upload start immediately in the background, the user gets a
 * short undo window, and the shot is committed when the window closes (or they
 * tap Done). The note (caption/location) can be added after committing.
 */
import { ref, uploadBytesResumable, type UploadTask } from 'firebase/storage';
import { storage } from './firebase';
import { api, errorCode, errorMessage } from './api';
import { processPhoto, type ProcessedPhoto } from './image';
import { randomRequestId } from './format';
import { enqueue, isNetworkError } from './queue';
import type { PresetId } from '@shared/types';

export type ShotState = 'working' | 'uploaded' | 'committing' | 'saved' | 'queued' | 'cancelled' | 'failed';

export interface ShotSnapshot {
  state: ShotState;
  progress: number;
  error: string | null;
  /** The roll filled up or developed before this shot could be added. */
  lost: boolean;
  photoId: string | null;
  remaining: number | null;
  rollStatus: string | null;
}

interface Options {
  uid: string;
  groupId: string;
  rollId: string;
  preset: PresetId;
  dateStamp: boolean;
  seed?: number;
  capturedAt: number;
  /** Raw capture (processed in the pipeline)… */
  source?: ImageBitmap;
  /** …or an already-processed shot (from the offline queue). */
  processed?: ProcessedPhoto;
  /** Reuse a request id so retries keep the same exposure reservation. */
  requestId?: string;
  /** No connection: process now, keep on the device at commit. */
  offline?: boolean;
  /** Uploading a shot that waited in the offline queue (server allows an older capture time). */
  queued?: boolean;
  onChange: (s: ShotSnapshot) => void;
}

export class Shot {
  private o: Options;
  private snap: ShotSnapshot = { state: 'working', progress: 0, error: null, lost: false, photoId: null, remaining: null, rollStatus: null };
  private requestId = randomRequestId();
  private reservation: { reservationId: string; uploadPrefix: string } | null = null;
  private processed: ProcessedPhoto | null = null;
  private tasks: UploadTask[] = [];
  private pipeline: Promise<void> | null = null;
  private commitP: Promise<void> | null = null;
  private note = { caption: '', location: '' };
  private savedNote = { caption: '', location: '' };

  constructor(o: Options) {
    this.o = o;
    if (o.processed) this.processed = o.processed;
    if (o.requestId) this.requestId = o.requestId;
  }

  get snapshot() {
    return this.snap;
  }

  private set(p: Partial<ShotSnapshot>) {
    this.snap = { ...this.snap, ...p };
    this.o.onChange(this.snap);
  }

  /** Process → reserve → upload. Safe to call again after a failure (resumes). */
  start(): Promise<void> {
    this.pipeline = this.run().catch((e) => this.fail(e));
    return this.pipeline;
  }

  private async run() {
    this.set({ state: 'working', error: null });
    const t0 = performance.now();
    // Reserve the exposure while the photo is still being processed (not possible offline).
    const reserving = this.o.offline ? null : this.reservation ? Promise.resolve(this.reservation) : api.reserveExposure({ groupId: this.o.groupId, rollId: this.o.rollId, requestId: this.requestId });
    reserving?.catch(() => undefined); // surfaced below
    if (!this.processed && this.o.source) {
      this.processed = await processPhoto(this.o.source, { preset: this.o.preset, seed: this.o.seed ?? 7, dateStamp: this.o.dateStamp, capturedAt: this.o.capturedAt });
      this.o.source.close(); // the original pixels are no longer needed; nobody sees the shot until it develops
    }
    if (!reserving) {
      // offline: the shot is ready to be kept on the device when committed
      if (!this.isCancelled()) this.set({ state: 'uploaded', progress: 1 });
      return;
    }
    const t1 = performance.now();
    this.reservation = await reserving;
    const t2 = performance.now();
    if (this.isCancelled()) return this.release();
    const prefix = this.reservation.uploadPrefix;
    const ph = this.processed;
    if (!ph) throw new Error('Nothing to upload.');
    const parts = [['thumb', ph.thumb.blob], ['display', ph.display.blob], ['original', ph.original.blob]] as const;
    const total = parts.reduce((s, [, b]) => s + b.size, 0);
    const sent: Record<string, number> = {};
    // All three files upload in parallel, each with its own retries.
    await Promise.all(parts.map(async ([name, blob]) => {
      for (let tries = 0; ; tries++) {
        try {
          const task = uploadBytesResumable(ref(storage, prefix + name), blob, { contentType: 'image/jpeg', cacheControl: 'private, no-store' });
          this.tasks.push(task);
          task.on('state_changed', (s) => {
            sent[name] = s.bytesTransferred;
            this.set({ progress: Object.values(sent).reduce((a, b) => a + b, 0) / total });
          });
          await task;
          return;
        } catch (e) {
          if (this.isCancelled()) return;
          if (tries >= 2 || errorCode(e) === 'storage/unauthorized') throw e;
          await new Promise((r) => setTimeout(r, 1000 * (tries + 1)));
        }
      }
    }));
    if (this.isCancelled()) return;
    this.set({ state: 'uploaded', progress: 1 });
    this.timings = { process: t1 - t0, reserveWait: t2 - t1, upload: performance.now() - t2, bytes: total };
    if (import.meta.env.DEV) console.debug('[shot] pipeline', this.timings);
  }

  /** Step durations (ms) for diagnosing slow saves. */
  timings: Record<string, number> = {};

  private isCancelled() {
    return this.snap.state === 'cancelled';
  }

  private fail(e: unknown) {
    if (this.isCancelled()) return;
    const code = errorCode(e);
    const msg = errorMessage(e);
    this.lastErr = { code, message: (e as Error)?.message ?? msg };
    if (code === 'functions/deadline-exceeded') this.reset(); // reservation expired: start over with a fresh exposure
    const lost = (code === 'functions/resource-exhausted' && /No exposures left/.test(msg)) || (code === 'functions/failed-precondition' && /developed|isn.t taking/i.test(msg));
    this.set({ state: 'failed', error: lost ? 'Someone just took the last shot, so this one didn’t make it onto the roll.' : msg, lost });
  }

  private reset() {
    this.reservation = null;
    this.requestId = randomRequestId();
  }

  /** Undo inside the window: stop uploads and give the exposure back. */
  async cancel() {
    if (this.snap.state === 'saved' || this.snap.state === 'committing') return false;
    this.set({ state: 'cancelled' });
    this.tasks.forEach((t) => t.cancel());
    await this.release();
    return true;
  }

  private async release() {
    if (!this.reservation) return;
    const r = this.reservation;
    this.reservation = null;
    await api.releaseExposure({ groupId: this.o.groupId, rollId: this.o.rollId, reservationId: r.reservationId }).catch(() => undefined);
  }

  setNote(caption: string, location: string) {
    this.note = { caption, location };
  }

  /** Finalize the exposure (waits for the upload). Idempotent. */
  commit(): Promise<void> {
    if (this.isCancelled()) return Promise.resolve();
    this.commitP ??= (async () => {
      await this.pipeline;
      if (this.snap.state === 'failed' || this.isCancelled()) {
        this.commitP = null;
        return;
      }
      if (this.o.offline) return this.toQueue();
      this.set({ state: 'committing' });
      const p = this.processed!;
      const size = (k: keyof ProcessedPhoto) => ({ width: p[k].width, height: p[k].height });
      try {
        const tf = performance.now();
        const out = await api.finalizeExposure({
          groupId: this.o.groupId, rollId: this.o.rollId, reservationId: this.reservation!.reservationId,
          caption: this.note.caption, location: this.note.location, capturedAt: this.o.capturedAt, clientNow: Date.now(), preset: this.o.preset, queued: !!this.o.queued,
          sizes: { original: size('original'), display: size('display'), thumb: size('thumb') },
        });
        this.timings.finalize = performance.now() - tf;
        if (import.meta.env.DEV) console.debug('[shot] saved', this.timings);
        this.savedNote = { ...this.note };
        this.processed = null; // drop every local copy of the hidden photo
        this.set({ state: 'saved', photoId: out.photoId, remaining: out.remaining, rollStatus: out.status });
      } catch (e) {
        this.commitP = null;
        this.fail(e);
      }
    })();
    return this.commitP;
  }

  /** After saving: push a changed note to the server. */
  async saveNote() {
    if (this.snap.state !== 'saved' || !this.snap.photoId) return;
    if (this.note.caption === this.savedNote.caption && this.note.location === this.savedNote.location) return;
    await api.setPhotoNote({ groupId: this.o.groupId, rollId: this.o.rollId, photoId: this.snap.photoId, ...this.note });
    this.savedNote = { ...this.note };
  }

  /** True when the last failure was a lost connection (worth keeping on the device). */
  get networkFailure() {
    return this.snap.state === 'failed' && !this.snap.lost && this.lastErr != null && isNetworkError(this.lastErr.code, this.lastErr.message);
  }
  private lastErr: { code: string; message: string } | null = null;

  /** Keep the processed shot on this device; it uploads when the connection is back. */
  async toQueue(): Promise<void> {
    if (!this.processed || this.snap.state === 'saved' || this.snap.state === 'queued') return;
    this.tasks.forEach((t) => t.cancel());
    await enqueue({
      id: this.requestId, uid: this.o.uid, groupId: this.o.groupId, rollId: this.o.rollId, preset: this.o.preset, capturedAt: this.o.capturedAt,
      caption: this.note.caption, location: this.note.location, requestId: this.requestId, photo: this.processed, queuedAt: Date.now(), attempts: 0,
    });
    this.processed = null;
    this.set({ state: 'queued', error: null });
  }

  /** Retry after a failure (keeps the processed photo and any live reservation). */
  retry() {
    if (this.snap.state !== 'failed' || this.snap.lost) return;
    this.start();
  }
}
