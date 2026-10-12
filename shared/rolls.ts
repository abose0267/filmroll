/**
 * Pure roll logic: the state machine, exposure accounting and development
 * conditions. Cloud Functions call these inside transactions; the UI uses the
 * same helpers for display so both always agree.
 */
import { DEVELOPING_GRACE_MS, MAX_DEVELOP_DELAY_MS, MIN_DEVELOP_DELAY_MS, CAPACITIES } from './constants';
import type { DevelopMode, RollDoc, RollStatus } from './types';

/** Allowed transitions. Only trusted backend code applies them. */
export const TRANSITIONS: Record<RollStatus, RollStatus[]> = {
  active: ['developing', 'developed', 'cancelled'],
  developing: ['developed'],
  developed: [],
  cancelled: [],
};

export function canTransition(from: RollStatus, to: RollStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: RollStatus, to: RollStatus): void {
  if (!canTransition(from, to)) throw new Error(`Invalid roll transition ${from} → ${to}`);
}

type Counts = Pick<RollDoc, 'capacity' | 'exposuresUsed' | 'exposuresReserved'>;

/** Exposures nobody has finalized or reserved yet. */
export function exposuresAvailable(r: Counts): number {
  return Math.max(0, r.capacity - r.exposuresUsed - r.exposuresReserved);
}

/** Shots left from the group's point of view (reservations still count as available until used). */
export function shotsRemaining(r: Pick<RollDoc, 'capacity' | 'exposuresUsed'>): number {
  return Math.max(0, r.capacity - r.exposuresUsed);
}

export type ReserveDenial = 'not_active' | 'full' | 'too_many_pending';

/** Whether a new reservation can be taken. `pendingForUser` counts the caller's live reservations. */
export function reserveDenial(r: Pick<RollDoc, 'status'> & Counts, pendingForUser: number, maxPendingPerUser: number): ReserveDenial | null {
  if (r.status !== 'active') return 'not_active';
  if (exposuresAvailable(r) <= 0) return 'full';
  if (pendingForUser >= maxPendingPerUser) return 'too_many_pending';
  return null;
}

export function developsWhenFull(mode: DevelopMode): boolean {
  return mode === 'full' || mode === 'either';
}

export function developsOnDate(mode: DevelopMode): boolean {
  return mode === 'date' || mode === 'either';
}

/**
 * What the backend should do with a roll at `now`.
 * - active + full + full-mode → develop immediately (no uploads can be pending).
 * - active + date passed       → enter developing (wait for in-flight uploads).
 * - developing + nothing pending (or grace over) → developed.
 */
export function nextStatus(
  r: Pick<RollDoc, 'status' | 'developMode' | 'developAt' | 'capacity' | 'exposuresUsed' | 'exposuresReserved' | 'developingSince'>,
  now: number,
): RollStatus | null {
  if (r.status === 'active') {
    const full = r.exposuresUsed >= r.capacity;
    if (full && developsWhenFull(r.developMode)) return 'developed';
    if (developsOnDate(r.developMode) && r.developAt != null && now >= r.developAt) {
      return r.exposuresReserved > 0 ? 'developing' : 'developed';
    }
    return null;
  }
  if (r.status === 'developing') {
    if (r.exposuresReserved <= 0) return 'developed';
    if (r.developingSince != null && now - r.developingSince >= DEVELOPING_GRACE_MS) return 'developed';
    return null;
  }
  return null;
}

/** Can a pending upload still be finalized into this roll? */
export function acceptsFinalization(r: Pick<RollDoc, 'status' | 'capacity' | 'exposuresUsed'>): boolean {
  return (r.status === 'active' || r.status === 'developing') && r.exposuresUsed < r.capacity;
}

/** Milestone notifications to send after a finalization (each sent once). */
export function newMilestones(r: Pick<RollDoc, 'capacity' | 'exposuresUsed' | 'milestones'>): ('half' | 'three')[] {
  const out: ('half' | 'three')[] = [];
  const left = r.capacity - r.exposuresUsed;
  if (r.exposuresUsed >= r.capacity / 2 && left > 3 && !r.milestones.includes('half')) out.push('half');
  if (left === 3 && !r.milestones.includes('three')) out.push('three');
  return out;
}

export interface RollConfigInput {
  name: string;
  capacity: number;
  developMode: DevelopMode;
  developAt: number | null;
}

/** Validates a new roll's configuration; returns an error message or null. */
export function rollConfigError(c: RollConfigInput, now: number, maxName: number): string | null {
  const name = c.name.trim();
  if (!name) return 'Give your roll a name.';
  if (name.length > maxName) return `Roll names can be up to ${maxName} characters.`;
  if (!(CAPACITIES as readonly number[]).includes(c.capacity)) return 'Choose 12, 24 or 36 exposures.';
  if (!['full', 'date', 'either'].includes(c.developMode)) return 'Choose when the roll develops.';
  if (developsOnDate(c.developMode)) {
    if (c.developAt == null || !Number.isFinite(c.developAt)) return 'Pick a development date.';
    if (c.developAt < now + MIN_DEVELOP_DELAY_MS) return 'The development date needs to be at least an hour away.';
    if (c.developAt > now + MAX_DEVELOP_DELAY_MS) return 'Pick a development date within a year.';
  } else if (c.developAt != null) return 'Develop-when-full rolls have no date.';
  return null;
}

/** "Developing Oct 31" style label in the viewer's time zone. */
export function developLabel(r: Pick<RollDoc, 'developMode' | 'developAt' | 'capacity' | 'exposuresUsed'>, locale?: string, timeZone?: string): string {
  const left = shotsRemaining(r);
  const date = r.developAt != null ? new Date(r.developAt).toLocaleDateString(locale, { month: 'short', day: 'numeric', timeZone }) : null;
  if (r.developMode === 'full') return `Develops when all ${r.capacity} shots are used`;
  if (r.developMode === 'date') return `Developing ${date}`;
  return `Developing ${date}, or when the last ${left === 1 ? 'shot is' : `${left} shots are`} used`;
}
