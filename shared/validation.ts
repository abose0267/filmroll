import { LIMITS } from './constants';
import type { ReactionEmoji } from './types';
import { REACTIONS } from './constants';

/** Collapses whitespace runs and strips control characters. */
export function cleanText(v: unknown, max: number, { multiline = false } = {}): string {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  let s = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  s = multiline ? s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n') : s.replace(/\s+/g, ' ');
  return s.trim().slice(0, max);
}

export function displayNameError(v: string): string | null {
  const s = v.trim();
  if (!s) return 'Add your name so friends recognise you.';
  if (s.length > LIMITS.displayName) return `Names can be up to ${LIMITS.displayName} characters.`;
  return null;
}

export function groupNameError(v: string): string | null {
  const s = v.trim();
  if (!s) return 'Give your group a name.';
  if (s.length > LIMITS.groupName) return `Group names can be up to ${LIMITS.groupName} characters.`;
  return null;
}

/** Unambiguous alphabet (no 0/O, 1/I/L) for codes people may type. */
export const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const INVITE_CODE_LENGTH = 8;

/** Builds an invite code from cryptographically random bytes. */
export function inviteCodeFromBytes(bytes: Uint8Array): string {
  if (bytes.length < INVITE_CODE_LENGTH) throw new Error('Need more random bytes');
  let out = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) out += INVITE_ALPHABET[bytes[i] % INVITE_ALPHABET.length];
  return out;
}

/** Accepts "abcd-efgh", full invite links, spaces; returns the canonical code or null. */
export function normalizeInviteCode(input: string): string | null {
  const m = input.trim().match(/(?:\/join\/)?([A-Za-z0-9-\s]{8,12})\/?$/);
  if (!m) return null;
  const code = m[1].replace(/[-\s]/g, '').toUpperCase();
  if (code.length !== INVITE_CODE_LENGTH) return null;
  for (const ch of code) if (!INVITE_ALPHABET.includes(ch)) return null;
  return code;
}

export function formatInviteCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export type ImageKind = 'image/jpeg' | 'image/png' | 'image/webp';

/** Detects an image type from its first bytes (file signature). */
export function sniffImage(head: Uint8Array): ImageKind | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.length >= 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47 && head[4] === 0x0d && head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a) return 'image/png';
  if (
    head.length >= 12 &&
    head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
    head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
  ) return 'image/webp';
  return null;
}

export function isReaction(v: unknown): v is ReactionEmoji {
  return typeof v === 'string' && (REACTIONS as string[]).includes(v);
}

/** Random URL-safe id (not derived from time or user ids). */
export function randomId(bytes: Uint8Array): string {
  const abc = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (const b of bytes) s += abc[b % abc.length];
  return s;
}
