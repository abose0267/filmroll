/**
 * Firestore document shapes shared by the web app and Cloud Functions.
 * Timestamps are stored as epoch milliseconds (UTC) so both sides agree and
 * rules can compare them with request.time.toMillis().
 */

export type PresetId = 'classic35' | 'warmVintage' | 'blackWhite' | 'disposableFlash' | 'softPastel';
export type DevelopMode = 'full' | 'date' | 'either';
export type RollStatus = 'active' | 'developing' | 'developed' | 'cancelled';
export type MemberRole = 'owner' | 'admin' | 'member';
export type GroupTheme = 'cream' | 'coral' | 'amber' | 'sage' | 'dusk' | 'charcoal';

export interface NotificationPrefs {
  rollStarted: boolean;
  milestones: boolean;
  developed: boolean;
  comments: boolean;
  memories: boolean;
}

export interface UserDoc {
  uid: string;
  displayName: string;
  photoURL: string | null;
  city: string;
  bio: string;
  createdAt: number;
  onboarded: boolean;
  groupIds: string[];
  notificationPrefs: NotificationPrefs;
  /** Show "one year ago" resurfaced memories in the archive. */
  showMemories: boolean;
  /** Require winding the film-advance wheel before each shot (default on). */
  windToShoot?: boolean;
  /** Finished (or skipped) the first-login tutorial. */
  tutorialDone?: boolean;
}

export interface AutoRollSettings {
  enabled: boolean;
  capacity: 12 | 24 | 36;
  preset: PresetId;
  /** The group's home time zone: rolls load on the 1st and develop on the last evening of the month here. */
  timeZone: string;
}

export interface GroupSettings {
  /** Who may start a new roll. */
  rollCreators: 'everyone' | 'admins';
  /** New members can see rolls developed before they joined. */
  shareHistory: boolean;
  /** Load a new roll automatically every month. */
  autoRoll?: AutoRollSettings;
  /** Opt-in end-to-end encryption: new photos and notes are sealed on members' phones. */
  e2ee?: boolean;
}

export interface GroupDoc {
  id: string;
  name: string;
  theme: GroupTheme;
  ownerId: string;
  createdAt: number;
  memberCount: number;
  /** Small public-to-members summary for avatars; capped. */
  memberPreview: { uid: string; name: string; photoURL: string | null }[];
  activeRollId: string | null;
  /** "YYYY-MM" of the last month the monthly roll was handled (server-only bookkeeping). */
  autoRollMonth?: string;
  rollCount: number;
  developedCount: number;
  settings: GroupSettings;
}

/** Visible only to owner/admins (members/{uid} docs carry roles). */
export interface GroupInviteDoc {
  code: string;
  groupId: string;
  createdBy: string;
  createdAt: number;
  revoked: boolean;
}

export interface MemberDoc {
  uid: string;
  role: MemberRole;
  joinedAt: number;
  displayName: string;
  photoURL: string | null;
  /** Mute in-app notifications for this group. */
  muted: boolean;
}

/** Public-to-members roll metadata. Never contains photo content. */
export interface RollDoc {
  id: string;
  groupId: string;
  name: string;
  capacity: 12 | 24 | 36;
  preset: PresetId;
  dateStamp: boolean;
  developMode: DevelopMode;
  /** UTC epoch ms; null for develop-when-full rolls. */
  developAt: number | null;
  status: RollStatus;
  createdBy: string;
  createdAt: number;
  /** Finalized photos. */
  exposuresUsed: number;
  /** Live (unexpired) reservations awaiting upload/finalization. */
  exposuresReserved: number;
  /** uid → number of finalized exposures. Participation only, no content. */
  contributors: Record<string, number>;
  developingSince: number | null;
  developedAt: number | null;
  /** Up to 4 photo ids for the album cover; set at development. */
  coverPhotoIds: string[];
  /** Earliest/latest capture time, set at development. */
  firstShotAt: number | null;
  lastShotAt: number | null;
  /** Milestone notifications already sent (e.g. 'half', 'three'). */
  milestones: string[];
}

/** Server-only. Holds one in-flight exposure for a user. */
export interface ReservationDoc {
  id: string;
  groupId: string;
  rollId: string;
  uid: string;
  status: 'pending' | 'finalized' | 'expired';
  createdAt: number;
  expiresAt: number;
  photoId: string | null;
}

export interface PhotoVariantInfo {
  path: string;
  width: number;
  height: number;
  bytes: number;
  contentType: string;
}

/** Private until the roll develops (enforced by rules). */
export interface PhotoDoc {
  id: string;
  groupId: string;
  rollId: string;
  uid: string;
  /** Sequential frame number in the roll (1-based). */
  frame: number;
  caption: string;
  location: string;
  capturedAt: number;
  createdAt: number;
  preset: PresetId;
  original: PhotoVariantInfo;
  display: PhotoVariantInfo;
  thumb: PhotoVariantInfo;
  /** End-to-end encrypted: the files are sealed with this device key (see shared/sealed.ts). */
  e2ee?: { keyId: string };
  /** Sealed caption + location (caption/location are then empty on the server). */
  noteEnc?: string;
}

export interface CommentDoc {
  id: string;
  photoId: string;
  uid: string;
  displayName: string;
  photoURL: string | null;
  text: string;
  createdAt: number;
}

export type ReactionEmoji = '❤️' | '😂' | '🥹' | '📸';

/** Doc id: `${photoId}_${uid}` — one reaction per person per photo. */
export interface ReactionDoc {
  photoId: string;
  uid: string;
  emoji: ReactionEmoji;
  createdAt: number;
}

export type NotificationKind = 'joined' | 'rollStarted' | 'halfway' | 'fewLeft' | 'developed' | 'comment';

export interface NotificationDoc {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  groupId: string;
  rollId: string | null;
  link: string;
  createdAt: number;
  read: boolean;
}

export interface FavoriteDoc {
  groupId: string;
  rollId: string;
  photoId: string;
  createdAt: number;
}
