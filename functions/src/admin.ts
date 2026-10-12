import { initializeApp, getApps } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getAuth } from 'firebase-admin/auth';
import { getMessaging } from 'firebase-admin/messaging';

if (!getApps().length) initializeApp();

export const db = getFirestore();
export const bucket = () => getStorage().bucket();
export const adminAuth = () => getAuth();
export const messaging = () => getMessaging();
export { FieldValue };

export const userRef = (uid: string) => db.doc(`users/${uid}`);
export const groupRef = (gid: string) => db.doc(`groups/${gid}`);
export const memberRef = (gid: string, uid: string) => db.doc(`groups/${gid}/members/${uid}`);
export const membersCol = (gid: string) => db.collection(`groups/${gid}/members`);
export const rollRef = (gid: string, rid: string) => db.doc(`groups/${gid}/rolls/${rid}`);
export const rollsCol = (gid: string) => db.collection(`groups/${gid}/rolls`);
export const photosCol = (gid: string, rid: string) => db.collection(`groups/${gid}/rolls/${rid}/photos`);
export const reservationsCol = (gid: string, rid: string) => db.collection(`groups/${gid}/rolls/${rid}/reservations`);
/** Invite codes live outside groups so a code lookup reveals nothing else. */
export const inviteRef = (code: string) => db.doc(`invites/${code}`);
export const notificationsCol = (uid: string) => db.collection(`users/${uid}/notifications`);
/** Web-push tokens for a user's devices (doc id = token). */
export const pushTokensCol = (uid: string) => db.collection(`users/${uid}/pushTokens`);
