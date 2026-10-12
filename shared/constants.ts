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
export const MAX_PENDING_PER_USER = 2;
/**
 * After a scheduled roll's date passes it enters `developing` and waits for
 * in-flight uploads (at most one reservation TTL) before revealing.
 */
export const DEVELOPING_GRACE_MS = RESERVATION_TTL_MS;
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

export const ORIGINAL_MAX_DIMENSION = 4096;
export const DISPLAY_MAX_DIMENSION = 2048;
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
