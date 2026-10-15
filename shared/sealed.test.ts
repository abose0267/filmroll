import { describe, expect, it } from 'vitest';
import { fromBase64, isSealed, parseSealed, sealedHeader, toBase64 } from './sealed';

describe('sealed file header', () => {
  it('round-trips the key id and IV', () => {
    const iv = Uint8Array.from({ length: 12 }, (_, i) => i + 1);
    const h = sealedHeader('k_AbCdEf1234567890', iv);
    const bytes = new Uint8Array([...h, 9, 9, 9]);
    const p = parseSealed(bytes)!;
    expect(p.keyId).toBe('k_AbCdEf1234567890');
    expect(Array.from(p.iv)).toEqual(Array.from(iv));
    expect(p.bodyStart).toBe(h.length);
  });

  it('rejects anything that is not sealed (like a plain JPEG)', () => {
    expect(isSealed(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]))).toBe(false);
    expect(isSealed(Uint8Array.from([0x46, 0x52, 0x45, 0x31, 3, 65, 65, 65]))).toBe(false); // id too short
    expect(isSealed(new Uint8Array())).toBe(false);
  });

  it('base64 helpers round-trip binary', () => {
    const b = Uint8Array.from({ length: 70000 }, (_, i) => (i * 31) & 255);
    expect(Array.from(fromBase64(toBase64(b)))).toEqual(Array.from(b));
  });
});
