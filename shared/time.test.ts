import { describe, expect, it } from 'vitest';
import { endOfMonthEvening, isValidTimeZone, monthKey, monthName, zonedParts, zonedTimeToUtc } from './time';

describe('time zones', () => {
  it('converts wall-clock time to UTC across DST', () => {
    // Chicago is UTC-5 in summer (CDT) and UTC-6 in winter (CST)
    expect(zonedTimeToUtc(2026, 7, 1, 9, 0, 'America/Chicago')).toBe(Date.UTC(2026, 6, 1, 14, 0));
    expect(zonedTimeToUtc(2026, 12, 1, 9, 0, 'America/Chicago')).toBe(Date.UTC(2026, 11, 1, 15, 0));
    expect(zonedTimeToUtc(2026, 3, 15, 20, 0, 'Asia/Kolkata')).toBe(Date.UTC(2026, 2, 15, 14, 30));
  });

  it('finds the last evening of the month locally', () => {
    const nov10 = Date.UTC(2026, 10, 10, 12);
    const end = endOfMonthEvening(nov10, 'America/Chicago');
    expect(zonedParts(end, 'America/Chicago')).toMatchObject({ y: 2026, m: 11, d: 30, h: 20, min: 0 });
    expect(endOfMonthEvening(Date.UTC(2028, 1, 3), 'UTC')).toBe(Date.UTC(2028, 1, 29, 20)); // leap year
  });

  it('labels months in the group’s zone', () => {
    // 1 Dec 03:00 UTC is still November in Chicago
    const t = Date.UTC(2026, 11, 1, 3);
    expect(monthKey(t, 'America/Chicago')).toBe('2026-11');
    expect(monthKey(t, 'Europe/London')).toBe('2026-12');
    expect(monthName(t, 'America/Chicago')).toBe('November 2026');
  });

  it('validates zones', () => {
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone(5)).toBe(false);
  });
});
