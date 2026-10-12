import { randomBytes } from 'node:crypto';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { db, memberRef } from './admin';
import { randomId } from '@shared/validation';
import type { MemberDoc } from '@shared/types';

export const DAY = 86_400_000;
export const HOUR = 3_600_000;

export function requireAuth(req: CallableRequest): string {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  return uid;
}

export function docId(v: unknown, field: string): string {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(v)) throw new HttpsError('invalid-argument', `Invalid ${field}.`);
  return v;
}

export async function requireMember(gid: unknown, uid: string): Promise<{ gid: string; member: MemberDoc }> {
  const id = docId(gid, 'group');
  const snap = await memberRef(id, uid).get();
  if (!snap.exists) throw new HttpsError('permission-denied', 'You are not a member of this group.');
  return { gid: id, member: snap.data() as MemberDoc };
}

export function isAdmin(m: MemberDoc): boolean {
  return m.role === 'owner' || m.role === 'admin';
}

export function requireAdmin(m: MemberDoc): void {
  if (!isAdmin(m)) throw new HttpsError('permission-denied', 'Only group admins can do that.');
}

/** Unpredictable 20-character id. */
export function newId(len = 20): string {
  return randomId(randomBytes(len));
}

/**
 * Fixed-window rate limit stored in `rateLimits/{key}` (server-only).
 * DISABLE_RATE_LIMITS=true in the functions env turns limits off for testing.
 */
export async function rateLimit(key: string, limit: number, windowMs: number, message: string): Promise<void> {
  if (process.env.DISABLE_RATE_LIMITS === 'true') return;
  const ref = db.doc(`rateLimits/${key.replace(/\//g, '_')}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const data = snap.data() as { windowStart: number; count: number } | undefined;
    if (!data || now - data.windowStart >= windowMs) {
      tx.set(ref, { windowStart: now, count: 1, expiresAt: new Date(now + windowMs) });
      return;
    }
    if (data.count >= limit) throw new HttpsError('resource-exhausted', message);
    tx.update(ref, { count: data.count + 1 });
  });
}
