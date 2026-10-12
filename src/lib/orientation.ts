/**
 * Camera orientation helpers. Pure functions (unit-tested) plus a hook that
 * reads the tilt sensor, so turning the phone sideways produces an upright
 * landscape photo even when the UI itself stays portrait (installed PWA,
 * rotation lock).
 */
import { useEffect, useRef, useState } from 'react';

/** How the phone is held relative to the (portrait) UI. */
export type Tilt = 'portrait' | 'left' | 'right';

/**
 * Classifies device tilt from DeviceOrientation beta/gamma with hysteresis.
 * gamma < 0: phone turned counter-clockwise (top of phone pointing left).
 */
export function tiltFromAngles(beta: number | null, gamma: number | null, prev: Tilt): Tilt {
  if (beta == null || gamma == null) return prev;
  const flat = Math.abs(beta) < 25 && Math.abs(gamma) < 25;
  if (flat) return prev; // lying on a table: keep whatever we had
  if (prev === 'portrait') {
    if (Math.abs(gamma) > 55 && Math.abs(beta) < 40) return gamma < 0 ? 'left' : 'right';
    return 'portrait';
  }
  if (Math.abs(gamma) < 35) return 'portrait';
  return gamma < 0 ? 'left' : 'right';
}

/** Degrees to rotate a portrait-UI frame so the scene is upright. */
export function rotationFor(tilt: Tilt): 0 | 90 | -90 {
  return tilt === 'left' ? -90 : tilt === 'right' ? 90 : 0;
}

/** Centered crop of a w×h frame to the given aspect (width / height). */
export function cropToAspect(w: number, h: number, aspect: number): { sx: number; sy: number; sw: number; sh: number } {
  if (w / h > aspect) {
    const sw = Math.round(h * aspect);
    return { sx: Math.round((w - sw) / 2), sy: 0, sw, sh: h };
  }
  const sh = Math.round(w / aspect);
  return { sx: 0, sy: Math.round((h - sh) / 2), sw: w, sh };
}

/** Size of a frame after rotating by ±90° (or not). */
export function rotatedSize(w: number, h: number, deg: number): { width: number; height: number } {
  return Math.abs(deg) === 90 ? { width: h, height: w } : { width: w, height: h };
}

/** True when the browser has rotated the whole UI into landscape. */
export function useViewportLandscape(): boolean {
  const q = '(orientation: landscape)';
  const [land, setLand] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const on = () => setLand(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return land;
}

type PermissionFn = () => Promise<'granted' | 'denied'>;

/**
 * Tracks how the phone is held. We always listen (most Android browsers send
 * tilt events without asking); iOS only sends them after a permission prompt
 * that must come from a tap, so call `enable()` from a pointer/click handler.
 */
export function useDeviceTilt(active: boolean): { tilt: Tilt; enable: () => void } {
  const [tilt, setTilt] = useState<Tilt>('portrait');
  const prev = useRef<Tilt>('portrait');
  const asked = useRef(false);

  useEffect(() => {
    if (!active || typeof window === 'undefined') return;
    const on = (e: DeviceOrientationEvent) => {
      const next = tiltFromAngles(e.beta, e.gamma, prev.current);
      if (next !== prev.current) {
        prev.current = next;
        setTilt(next);
      }
    };
    addEventListener('deviceorientation', on);
    return () => removeEventListener('deviceorientation', on);
  }, [active]);

  useEffect(() => {
    if (!active && prev.current !== 'portrait') {
      prev.current = 'portrait';
      setTilt('portrait');
    }
  }, [active]);

  const enable = () => {
    if (asked.current || typeof DeviceOrientationEvent === 'undefined') return;
    asked.current = true;
    const req = (DeviceOrientationEvent as unknown as { requestPermission?: PermissionFn }).requestPermission;
    req?.call(DeviceOrientationEvent).catch(() => undefined);
  };
  return { tilt, enable };
}
