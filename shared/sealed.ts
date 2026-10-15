/**
 * End-to-end encrypted ("sealed") file format, shared by the app and the server.
 *
 *   "FRE1" | keyId length (1 byte) | keyId (ASCII) | IV (12 bytes) | AES-256-GCM ciphertext
 *
 * The server only ever sees this. It can check the header (so it knows which
 * key a photo needs) but holds no keys, so it can't open the ciphertext.
 */
export const SEALED_MAGIC = [0x46, 0x52, 0x45, 0x31] as const; // "FRE1"
export const SEALED_IV_BYTES = 12;
export const SEALED_CONTENT_TYPE = 'application/octet-stream';
/** Key ids are random URL-safe strings. */
export const KEY_ID = /^[A-Za-z0-9_-]{8,40}$/;
/** Upper bound for a sealed note (caption + location), base64. */
export const SEALED_NOTE_MAX = 4000;

export function sealedHeader(keyId: string, iv: Uint8Array): Uint8Array {
  if (!KEY_ID.test(keyId)) throw new Error('bad key id');
  if (iv.length !== SEALED_IV_BYTES) throw new Error('bad iv');
  const id = Array.from(keyId, (c) => c.charCodeAt(0));
  return Uint8Array.from([...SEALED_MAGIC, id.length, ...id, ...iv]);
}

export interface SealedParts {
  keyId: string;
  iv: Uint8Array<ArrayBuffer>;
  /** Offset of the ciphertext. */
  bodyStart: number;
}

/** Reads a sealed header; null if the bytes aren't a sealed file. Needs at most 57 bytes. */
export function parseSealed(bytes: Uint8Array): SealedParts | null {
  if (bytes.length < 5 || SEALED_MAGIC.some((b, i) => bytes[i] !== b)) return null;
  const n = bytes[4];
  const ivStart = 5 + n;
  if (n < 8 || n > 40 || bytes.length < ivStart + SEALED_IV_BYTES) return null;
  const keyId = String.fromCharCode(...bytes.subarray(5, ivStart));
  if (!KEY_ID.test(keyId)) return null;
  return { keyId, iv: bytes.slice(ivStart, ivStart + SEALED_IV_BYTES), bodyStart: ivStart + SEALED_IV_BYTES };
}

export function isSealed(bytes: Uint8Array): boolean {
  return parseSealed(bytes) !== null;
}

/** Associated data binds a sealed file to its group, roll and purpose, so it can't be swapped elsewhere. */
export function sealedAad(groupId: string, rollId: string, purpose: 'original' | 'display' | 'thumb' | 'note'): string {
  return `filmroll:v1:${groupId}:${rollId}:${purpose}`;
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
