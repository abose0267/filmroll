import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import type { DevelopMode, GroupSettings, GroupTheme, MemberRole, PresetId } from '@shared/types';

function fn<Req, Res>(name: string) {
  const c = httpsCallable<Req, Res>(functions, name, { timeout: 60_000 });
  return async (data: Req): Promise<Res> => (await c(data)).data;
}

export interface Size { width: number; height: number }

export const api = {
  createGroup: fn<{ name: string; theme: GroupTheme }, { groupId: string; inviteCode: string }>('createGroup'),
  previewInvite: fn<{ code: string }, { groupId: string; name: string; theme: GroupTheme; memberCount: number; alreadyMember: boolean; memberNames: string[] }>('previewInvite'),
  joinGroup: fn<{ code: string }, { groupId: string; joined: boolean; name: string }>('joinGroup'),
  leaveGroup: fn<{ groupId: string }, { outcome: string }>('leaveGroup'),
  removeMember: fn<{ groupId: string; uid: string }, { ok: true }>('removeMember'),
  setMemberRole: fn<{ groupId: string; uid: string; role: Exclude<MemberRole, 'owner'> }, { ok: true }>('setMemberRole'),
  updateGroup: fn<{ groupId: string; name?: string; theme?: GroupTheme; settings?: Partial<GroupSettings> }, { ok: true }>('updateGroup'),
  getInvite: fn<{ groupId: string }, { code: string }>('getInvite'),
  rotateInvite: fn<{ groupId: string }, { code: string }>('rotateInvite'),
  setGroupMute: fn<{ groupId: string; muted: boolean }, { ok: true }>('setGroupMute'),
  startRoll: fn<{ groupId: string; name: string; capacity: number; developMode: DevelopMode; developAt: number | null; preset: PresetId; dateStamp: boolean }, { rollId: string }>('startRoll'),
  updateRoll: fn<{ groupId: string; rollId: string; name?: string; developAt?: number }, { ok: true }>('updateRoll'),
  cancelRoll: fn<{ groupId: string; rollId: string }, { ok: true }>('cancelRoll'),
  reserveExposure: fn<{ groupId: string; rollId: string; requestId: string }, { reservationId: string; expiresAt: number; uploadPrefix: string }>('reserveExposure'),
  releaseExposure: fn<{ groupId: string; rollId: string; reservationId: string }, { released: boolean }>('releaseExposure'),
  finalizeExposure: fn<
    { groupId: string; rollId: string; reservationId: string; caption: string; location: string; capturedAt: number; clientNow: number; preset: PresetId; sizes: { original: Size; display: Size; thumb: Size } },
    { photoId: string; duplicate: boolean; remaining: number; status: string }
  >('finalizeExposure'),
  setPhotoNote: fn<{ groupId: string; rollId: string; photoId: string; caption: string; location: string }, { ok: true }>('setPhotoNote'),
  deleteAccount: fn<{ confirm: 'DELETE' }, { photos: number; groups: number }>('deleteAccount'),
};

const FRIENDLY: Record<string, string> = {
  'auth/invalid-credential': 'That email and password don’t match.',
  'auth/wrong-password': 'That email and password don’t match.',
  'auth/user-not-found': 'No account with that email yet.',
  'auth/email-already-in-use': 'There’s already an account with that email. Try signing in.',
  'auth/weak-password': 'Use at least 6 characters for your password.',
  'auth/invalid-email': 'That email address doesn’t look right.',
  'auth/too-many-requests': 'Too many attempts. Wait a moment and try again.',
  'auth/network-request-failed': 'You seem to be offline.',
  'auth/unauthorized-domain': 'This site isn’t authorised for sign-in yet (add it in Firebase Auth → Settings → Authorized domains).',
  'storage/unauthorized': 'Upload not allowed. Try again.',
  'storage/retry-limit-exceeded': 'The upload kept failing. Check your connection and try again.',
  'functions/unavailable': 'Can’t reach FilmRoll right now. Check your connection.',
  'functions/internal': 'Something went wrong on our side. Try again.',
  unavailable: 'You seem to be offline.',
};

export function errorMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  if (FRIENDLY[code]) return FRIENDLY[code];
  const msg = (e as { message?: string })?.message ?? '';
  if (code.startsWith('functions/') && msg && msg !== 'INTERNAL') return msg;
  if (!navigator.onLine) return 'You seem to be offline.';
  return msg && msg.length < 140 && !msg.includes('Firebase') ? msg : 'Something went wrong. Please try again.';
}

export function errorCode(e: unknown): string {
  return (e as { code?: string })?.code ?? '';
}
