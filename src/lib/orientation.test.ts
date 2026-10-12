import { describe, expect, it } from 'vitest';
import { cropToAspect, rotatedSize, rotationFor, tiltFromAngles } from './orientation';

describe('camera orientation', () => {
  it('detects sideways phones with hysteresis', () => {
    expect(tiltFromAngles(80, 2, 'portrait')).toBe('portrait'); // upright
    expect(tiltFromAngles(5, -80, 'portrait')).toBe('left');
    expect(tiltFromAngles(5, 80, 'portrait')).toBe('right');
    // in between: stays where it was
    expect(tiltFromAngles(20, 45, 'portrait')).toBe('portrait');
    expect(tiltFromAngles(20, 45, 'right')).toBe('right');
    expect(tiltFromAngles(70, 20, 'right')).toBe('portrait');
    // flat on a table keeps the last tilt; missing sensor keeps it too
    expect(tiltFromAngles(3, 4, 'left')).toBe('left');
    expect(tiltFromAngles(null, null, 'right')).toBe('right');
  });

  it('rotates sideways shots upright', () => {
    expect(rotationFor('portrait')).toBe(0);
    expect(rotationFor('left')).toBe(-90);
    expect(rotationFor('right')).toBe(90);
    expect(rotatedSize(1440, 1920, 90)).toEqual({ width: 1920, height: 1440 });
    expect(rotatedSize(1440, 1920, 0)).toEqual({ width: 1440, height: 1920 });
  });

  it('crops the frame to exactly what the viewfinder shows', () => {
    // 16:9 portrait stream → 3:4 viewfinder
    expect(cropToAspect(1080, 1920, 3 / 4)).toEqual({ sx: 0, sy: 240, sw: 1080, sh: 1440 });
    // 16:9 landscape stream → 4:3
    expect(cropToAspect(1920, 1080, 4 / 3)).toEqual({ sx: 240, sy: 0, sw: 1440, sh: 1080 });
    // already 3:4 → untouched
    expect(cropToAspect(1440, 1920, 3 / 4)).toEqual({ sx: 0, sy: 0, sw: 1440, sh: 1920 });
  });
});

import { initials } from './format';
describe('initials', () => {
  it('uses letters only', () => {
    expect(initials('Arka (admin)')).toBe('AA');
    expect(initials('alice')).toBe('A');
    expect(initials('  ')).toBe('?');
    expect(initials('🎉 Party Crew')).toBe('PC');
  });
});
