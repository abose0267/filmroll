import type { GroupTheme, NotificationPrefs, ReactionEmoji } from './types';

export const APP_NAME = 'FilmRoll';
export const TAGLINE = 'Different lives. One roll of film.';

export const CAPACITIES = [12, 24, 36] as const;
export const DEFAULT_CAPACITY = 24;

export const MAX_GROUP_MEMBERS = 20;
export const MAX_GROUPS_PER_USER = 12;
export const MEMBER_PREVIEW_SIZE = 8;

/** How long a reserved exposure waits for its upload to be finalized. */
export const RESERVATION_TTL_MS = 15 * 60 * 1000;
/** A user may hold at most this many pending reservations per roll. */
export const MAX_PENDING_PER_USER = 4; // shots can keep saving in the background while you carry on
/**
 * After a scheduled roll's date passes it enters `developing` and waits for
 * in-flight uploads (at most one reservation TTL) before revealing.
 */
export const DEVELOPING_GRACE_MS = RESERVATION_TTL_MS;
/**
 * Only fresh shots go on a roll: a photo must be submitted within this long of
 * being taken (time spent on the caption screen included). Old camera-roll
 * photos can't be added.
 */
export const CAPTURE_MAX_AGE_MS = 30 * 60 * 1000;
/** Shots taken offline wait on the phone; they may be this old when they finally upload. */
export const QUEUED_MAX_AGE_MS = 72 * 60 * 60 * 1000;
/** The phone-camera fallback must hand back a file this new. */
export const FALLBACK_FILE_MAX_AGE_MS = 5 * 60 * 1000;
/** Earliest/latest allowed scheduled development, relative to roll start. */
export const MIN_DEVELOP_DELAY_MS = 60 * 60 * 1000;
export const MAX_DEVELOP_DELAY_MS = 366 * 24 * 60 * 60 * 1000;

export const LIMITS = {
  displayName: 40,
  city: 60,
  bio: 160,
  groupName: 40,
  rollName: 48,
  caption: 200,
  location: 60,
  comment: 400,
  /** Original stored image (client keeps the camera file when it fits). */
  originalBytes: 15 * 1024 * 1024,
  displayBytes: 4 * 1024 * 1024,
  thumbBytes: 400 * 1024,
  avatarBytes: 2 * 1024 * 1024,
  /** Raw file accepted from the picker before processing. */
  inputBytes: 40 * 1024 * 1024,
} as const;

/** Plenty for phone screens and 6×4" prints, and ~half the upload of 4096px @95%. */
export const ORIGINAL_MAX_DIMENSION = 3072;
export const DISPLAY_MAX_DIMENSION = 1600;
export const THUMB_MAX_DIMENSION = 480;

export const REACTIONS: ReactionEmoji[] = ['❤️', '😂', '🥹', '📸'];

export const GROUP_THEMES: { id: GroupTheme; label: string; bg: string; fg: string; accent: string }[] = [
  { id: 'cream', label: 'Cream', bg: '#F4EBDD', fg: '#2B2622', accent: '#D9714E' },
  { id: 'coral', label: 'Coral', bg: '#E9826A', fg: '#FFF8EF', accent: '#FFE2B8' },
  { id: 'amber', label: 'Amber', bg: '#E2A548', fg: '#2B2622', accent: '#7A3E1D' },
  { id: 'sage', label: 'Sage', bg: '#A9B79A', fg: '#22281F', accent: '#F4EBDD' },
  { id: 'dusk', label: 'Dusk', bg: '#5E5873', fg: '#F7EFE6', accent: '#F2B48C' },
  { id: 'charcoal', label: 'Charcoal', bg: '#2E2B29', fg: '#F4EBDD', accent: '#E2A548' },
];

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  rollStarted: true,
  milestones: true,
  developed: true,
  comments: true,
  memories: true,
};

export const ROLL_NAME_SUGGESTIONS = ['October Memories', 'Our First Summer Apart', 'College Crew', 'Holiday Season', 'Random Adventures'];
