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
import type { PresetId } from '@shared/types';

export type ShotState = 'working' | 'uploaded' | 'committing' | 'saved' | 'cancelled' | 'failed';

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
  groupId: string;
  rollId: string;
  preset: PresetId;
  dateStamp: boolean;
  seed: number;
  capturedAt: number;
  source: ImageBitmap;
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
    if (!this.processed) {
      this.processed = await processPhoto(this.o.source, { preset: this.o.preset, seed: this.o.seed, dateStamp: this.o.dateStamp, capturedAt: this.o.capturedAt });
      this.o.source.close(); // the original pixels are no longer needed; nobody sees the shot until it develops
    }
    if (this.isCancelled()) return;
    this.reservation ??= await api.reserveExposure({ groupId: this.o.groupId, rollId: this.o.rollId, requestId: this.requestId });
    if (this.isCancelled()) return this.release();
    const parts = [['original', this.processed.original.blob], ['display', this.processed.display.blob], ['thumb', this.processed.thumb.blob]] as const;
    const total = parts.reduce((s, [, b]) => s + b.size, 0);
    const sent: Record<string, number> = {};
    for (const [name, blob] of parts) {
      for (let tries = 0; ; tries++) {
        try {
          const task = uploadBytesResumable(ref(storage, this.reservation.uploadPrefix + name), blob, { contentType: 'image/jpeg', cacheControl: 'private, no-store' });
          this.tasks.push(task);
          task.on('state_changed', (s) => {
            sent[name] = s.bytesTransferred;
            this.set({ progress: Object.values(sent).reduce((a, b) => a + b, 0) / total });
          });
          await task;
          break;
        } catch (e) {
          if (this.isCancelled()) return;
          if (tries >= 2 || errorCode(e) === 'storage/unauthorized') throw e;
          await new Promise((r) => setTimeout(r, 1000 * (tries + 1)));
        }
      }
    }
    if (!this.isCancelled()) this.set({ state: 'uploaded', progress: 1 });
  }

  private isCancelled() {
    return this.snap.state === 'cancelled';
  }

  private fail(e: unknown) {
    if (this.isCancelled()) return;
    const code = errorCode(e);
    const msg = errorMessage(e);
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
      this.set({ state: 'committing' });
      const p = this.processed!;
      const size = (k: keyof ProcessedPhoto) => ({ width: p[k].width, height: p[k].height });
      try {
        const out = await api.finalizeExposure({
          groupId: this.o.groupId, rollId: this.o.rollId, reservationId: this.reservation!.reservationId,
          caption: this.note.caption, location: this.note.location, capturedAt: this.o.capturedAt, clientNow: Date.now(), preset: this.o.preset,
          sizes: { original: size('original'), display: size('display'), thumb: size('thumb') },
        });
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

  /** Retry after a failure (keeps the processed photo and any live reservation). */
  retry() {
    if (this.snap.state !== 'failed' || this.snap.lost) return;
    this.start();
  }
}
