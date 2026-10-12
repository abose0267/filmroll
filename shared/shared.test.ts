import { describe, expect, it } from 'vitest';
import { acceptsFinalization, canTransition, developLabel, exposuresAvailable, newMilestones, nextStatus, reserveDenial, rollConfigError } from './rolls';
import { DEVELOPING_GRACE_MS, LIMITS } from './constants';
import { PRESETS, PRESET_IDS, applyFilm, dateStampText, seedFrom, toneCurve } from './presets';
import { INVITE_ALPHABET, cleanText, formatInviteCode, inviteCodeFromBytes, normalizeInviteCode, sniffImage } from './validation';
import { resurface } from './memories';
import type { RollDoc } from './types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 10, 12);

function roll(over: Partial<RollDoc> = {}): RollDoc {
  return {
    id: 'r1', groupId: 'g1', name: 'October', capacity: 24, preset: 'classic35', dateStamp: true, developMode: 'either',
    developAt: NOW + 10 * DAY, status: 'active', createdBy: 'u1', createdAt: NOW - DAY, exposuresUsed: 0, exposuresReserved: 0,
    contributors: {}, developingSince: null, developedAt: null, coverPhotoIds: [], firstShotAt: null, lastShotAt: null, milestones: [],
    ...over,
  };
}

describe('roll state machine', () => {
  it('only allows forward transitions', () => {
    expect(canTransition('active', 'developing')).toBe(true);
    expect(canTransition('developing', 'developed')).toBe(true);
    expect(canTransition('developed', 'active')).toBe(false);
    expect(canTransition('developing', 'active')).toBe(false);
    expect(canTransition('cancelled', 'active')).toBe(false);
  });

  it('develops immediately when full in full/either mode', () => {
    expect(nextStatus(roll({ exposuresUsed: 24, developMode: 'full', developAt: null }), NOW)).toBe('developed');
    expect(nextStatus(roll({ exposuresUsed: 24, developMode: 'either' }), NOW)).toBe('developed');
    // date-only rolls wait for their date even when full
    expect(nextStatus(roll({ exposuresUsed: 24, developMode: 'date' }), NOW)).toBeNull();
  });

  it('waits for in-flight uploads when the date passes', () => {
    const due = roll({ developMode: 'date', developAt: NOW - 1, exposuresUsed: 5, exposuresReserved: 1 });
    expect(nextStatus(due, NOW)).toBe('developing');
    expect(nextStatus({ ...due, exposuresReserved: 0 }, NOW)).toBe('developed');
    const developing = { ...due, status: 'developing' as const, developingSince: NOW };
    expect(nextStatus(developing, NOW + 1000)).toBeNull();
    expect(nextStatus(developing, NOW + DEVELOPING_GRACE_MS)).toBe('developed');
  });

  it('develops empty rolls on their date (nobody contributed)', () => {
    expect(nextStatus(roll({ developMode: 'date', developAt: NOW - 1 }), NOW)).toBe('developed');
  });

  it('does nothing before the date', () => {
    expect(nextStatus(roll(), NOW)).toBeNull();
    expect(nextStatus(roll({ status: 'developed' }), NOW)).toBeNull();
  });
});

describe('exposure accounting', () => {
  it('counts reservations against capacity', () => {
    expect(exposuresAvailable(roll({ exposuresUsed: 20, exposuresReserved: 3 }))).toBe(1);
    expect(exposuresAvailable(roll({ exposuresUsed: 20, exposuresReserved: 6 }))).toBe(0);
  });

  it('denies reservations when full, inactive or the user has too many pending', () => {
    expect(reserveDenial(roll({ exposuresUsed: 23, exposuresReserved: 1 }), 0, 2)).toBe('full');
    expect(reserveDenial(roll({ status: 'developing' }), 0, 2)).toBe('not_active');
    expect(reserveDenial(roll(), 2, 2)).toBe('too_many_pending');
    expect(reserveDenial(roll(), 1, 2)).toBeNull();
  });

  it('accepts finalization while developing but never past capacity', () => {
    expect(acceptsFinalization(roll({ status: 'developing', exposuresUsed: 5 }))).toBe(true);
    expect(acceptsFinalization(roll({ exposuresUsed: 24 }))).toBe(false);
    expect(acceptsFinalization(roll({ status: 'developed' }))).toBe(false);
  });

  it('emits each milestone once', () => {
    expect(newMilestones(roll({ exposuresUsed: 12 }))).toEqual(['half']);
    expect(newMilestones(roll({ exposuresUsed: 12, milestones: ['half'] }))).toEqual([]);
    expect(newMilestones(roll({ exposuresUsed: 21, milestones: ['half'] }))).toEqual(['three']);
    // small rolls: halfway and 3-left can coincide; only "three" fires
    expect(newMilestones(roll({ capacity: 12, exposuresUsed: 9 }))).toEqual(['three']);
  });
});

describe('roll config validation', () => {
  const ok = { name: 'October', capacity: 24, developMode: 'date' as const, developAt: NOW + 3 * DAY };
  it('accepts a valid config', () => expect(rollConfigError(ok, NOW, LIMITS.rollName)).toBeNull());
  it('rejects bad capacity, missing/near dates and long names', () => {
    expect(rollConfigError({ ...ok, capacity: 30 }, NOW, 48)).toMatch(/12, 24 or 36/);
    expect(rollConfigError({ ...ok, developAt: null }, NOW, 48)).toMatch(/date/);
    expect(rollConfigError({ ...ok, developAt: NOW + 10 * 60_000 }, NOW, 48)).toMatch(/an hour/);
    expect(rollConfigError({ ...ok, name: '   ' }, NOW, 48)).toMatch(/name/);
    expect(rollConfigError({ ...ok, developMode: 'full', developAt: null }, NOW, 48)).toBeNull();
  });
  it('labels development', () => {
    expect(developLabel(roll({ developMode: 'full', developAt: null }))).toMatch(/all 24/);
    expect(developLabel(roll({ developMode: 'date' }), 'en-US', 'UTC')).toBe('Developing Oct 20');
  });
});

describe('film presets', () => {
  function img(w: number, h: number, rgb: [number, number, number]) {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) d.set([...rgb, 200], i * 4);
    return d;
  }

  it('every preset processes without changing alpha', () => {
    for (const id of PRESET_IDS) {
      const d = img(16, 12, [180, 120, 60]);
      applyFilm(d, 16, 12, PRESETS[id], { seed: 3 });
      for (let i = 3; i < d.length; i += 4) expect(d[i]).toBe(200);
    }
  });

  it('black & white is monochrome', () => {
    const d = img(8, 8, [200, 60, 30]);
    applyFilm(d, 8, 8, PRESETS.blackWhite, { seed: 1 });
    for (let i = 0; i < d.length; i += 4) {
      expect(d[i]).toBe(d[i + 1]);
      expect(d[i + 1]).toBe(d[i + 2]);
    }
  });

  it('is deterministic for a seed', () => {
    const a = img(10, 10, [90, 140, 200]);
    const b = img(10, 10, [90, 140, 200]);
    applyFilm(a, 10, 10, PRESETS.warmVintage, { seed: seedFrom('photo-1') });
    applyFilm(b, 10, 10, PRESETS.warmVintage, { seed: seedFrom('photo-1') });
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('warm vintage warms and vignette darkens corners', () => {
    const d = img(40, 40, [128, 128, 128]);
    applyFilm(d, 40, 40, { ...PRESETS.warmVintage.params, grain: 0, leak: 0 });
    const centre = (20 * 40 + 20) * 4;
    expect(d[centre]).toBeGreaterThan(d[centre + 2]);
    expect(d[0]).toBeLessThan(d[centre]);
  });

  it('tone curve is monotonic and lifts blacks with fade', () => {
    const lut = toneCurve(PRESETS.softPastel.params);
    for (let i = 1; i < 256; i++) expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1]);
    expect(lut[0]).toBeCloseTo(PRESETS.softPastel.params.fade, 5);
  });

  it('formats the date stamp', () => {
    expect(dateStampText(Date.UTC(2026, 9, 31, 12), 'UTC')).toBe("'26 10 31");
  });
});

describe('validation', () => {
  it('generates and normalizes invite codes', () => {
    const code = inviteCodeFromBytes(new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253]));
    expect(code).toHaveLength(8);
    for (const ch of code) expect(INVITE_ALPHABET).toContain(ch);
    expect(normalizeInviteCode(formatInviteCode(code).toLowerCase())).toBe(code);
    expect(normalizeInviteCode(`https://filmroll.app/join/${code}`)).toBe(code);
    expect(normalizeInviteCode('O0O0-1111')).toBeNull();
    expect(normalizeInviteCode('short')).toBeNull();
  });

  it('sniffs image signatures', () => {
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniffImage(new TextEncoder().encode('RIFF____WEBPVP8 '))).toBe('image/webp');
    expect(sniffImage(new TextEncoder().encode('<svg xmlns='))).toBeNull();
  });

  it('cleans text', () => {
    expect(cleanText('  hello\u0000   world  ', 50)).toBe('hello world');
    expect(cleanText('a'.repeat(300), 200)).toHaveLength(200);
    expect(cleanText(42, 10)).toBe('');
  });
});

describe('memory resurfacing', () => {
  const base = { groupId: 'g1', name: 'x', status: 'developed' as const, firstShotAt: null, lastShotAt: null };
  it('finds anniversaries and first rolls', () => {
    const rolls = [
      { ...base, id: 'old', developedAt: Date.UTC(2025, 9, 11, 9) },
      { ...base, id: 'first', developedAt: Date.UTC(2024, 2, 1) },
      { ...base, id: 'recent', developedAt: Date.UTC(2026, 8, 1) },
    ];
    const out = resurface(rolls, NOW, { timeZone: 'UTC' });
    expect(out.find((m) => m.kind === 'anniversary')).toMatchObject({ rollId: 'old', years: 1 });
    expect(out.find((m) => m.kind === 'first')).toMatchObject({ rollId: 'first' });
    expect(out.some((m) => m.rollId === 'recent')).toBe(false);
  });

  it('ignores undeveloped rolls', () => {
    expect(resurface([{ ...base, id: 'a', status: 'active', developedAt: null }], NOW)).toEqual([]);
  });
});
