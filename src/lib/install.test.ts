import { describe, expect, it } from 'vitest';
import { platform } from './install';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

describe('install platform', () => {
  it('tells iPhone Safari, other iPhone browsers, Android, in-app browsers and desktops apart', () => {
    expect(platform(IPHONE, false)).toBe('ios');
    expect(platform(IPHONE.replace('Version/18.0', 'CriOS/130.0'), false)).toBe('ios-other');
    expect(platform(`${IPHONE} Instagram 350.0`, false)).toBe('in-app');
    expect(platform('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36', false)).toBe('android');
    expect(platform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', false)).toBe('desktop');
    // iPadOS reports itself as a Mac but has touch
    expect(platform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', true)).toBe('ios');
  });
});
