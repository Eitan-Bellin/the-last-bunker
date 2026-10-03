import { FillGradient, type Graphics } from 'pixi.js';

export function shade(color: number, factor: number): number {
  const r = Math.min(255, Math.max(0, Math.round(((color >> 16) & 0xff) * factor)));
  const g = Math.min(255, Math.max(0, Math.round(((color >> 8) & 0xff) * factor)));
  const b = Math.min(255, Math.max(0, Math.round((color & 0xff) * factor)));
  return (r << 16) | (g << 8) | b;
}

export function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 0xff) * (1 - t) + ((b >> s) & 0xff) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export function rgba(color: number, a: number): string {
  return `rgba(${(color >> 16) & 0xff},${(color >> 8) & 0xff},${color & 0xff},${a})`;
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic pseudo-random sequence so a room always decorates the same way. */
export function seeded(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function vGradient(stops: [number, number, number?][]): FillGradient {
  return new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    colorStops: stops.map(([offset, color, alpha]) => ({ offset, color: rgba(color, alpha ?? 1) })),
    textureSpace: 'local',
  });
}

export function hGradient(stops: [number, number, number?][]): FillGradient {
  return new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: { x: 1, y: 0 },
    colorStops: stops.map(([offset, color, alpha]) => ({ offset, color: rgba(color, alpha ?? 1) })),
    textureSpace: 'local',
  });
}

/** Elliptical soft light; draw on an additive layer. */
export function softGlow(g: Graphics, x: number, y: number, rx: number, ry: number, color: number, alpha: number): void {
  const fill = new FillGradient({
    type: 'radial',
    center: { x: 0.5, y: 0.5 },
    innerRadius: 0,
    outerCenter: { x: 0.5, y: 0.5 },
    outerRadius: 0.5,
    colorStops: [
      { offset: 0, color: rgba(color, alpha) },
      { offset: 0.5, color: rgba(color, alpha * 0.35) },
      { offset: 1, color: rgba(color, 0) },
    ],
    textureSpace: 'local',
  });
  g.ellipse(x, y, rx, ry).fill(fill);
}

/**
 * Front-facing solid with a visible top face receding toward the back wall.
 * (x, bottom) is the front-bottom-left corner; d is the receding depth in px.
 */
export function block(g: Graphics, x: number, bottom: number, w: number, h: number, color: number, d = 6, opts: { top?: number; side?: number; shadow?: boolean } = {}): void {
  const top = bottom - h;
  if (opts.shadow !== false) g.ellipse(x + w / 2, bottom + 1, w * 0.55, 3).fill({ color: 0x000000, alpha: 0.3 });
  g.poly([x, top, x + w, top, x + w + d * 0.6, top - d, x + d * 0.6, top - d]).fill(opts.top ?? shade(color, 1.18));
  g.poly([x + w, top, x + w + d * 0.6, top - d, x + w + d * 0.6, bottom - d, x + w, bottom]).fill(opts.side ?? shade(color, 0.7));
  g.rect(x, top, w, h).fill(color);
}

/** Upright cylinder seen from the front (tank, core, barrel). */
export function cylinder(g: Graphics, cx: number, bottom: number, r: number, h: number, color: number, topColor?: number): void {
  const ry = r * 0.32;
  g.ellipse(cx, bottom + 1, r * 1.1, ry * 1.2).fill({ color: 0x000000, alpha: 0.3 });
  g.ellipse(cx, bottom, r, ry).fill(shade(color, 0.7));
  g.rect(cx - r, bottom - h, 2 * r, h).fill(color);
  g.rect(cx - r, bottom - h, r * 0.5, h).fill({ color: 0x000000, alpha: 0.18 });
  g.rect(cx + r * 0.25, bottom - h, r * 0.18, h).fill({ color: 0xffffff, alpha: 0.18 });
  g.ellipse(cx, bottom - h, r, ry).fill(topColor ?? shade(color, 1.2));
}

export function plant(g: Graphics, x: number, y: number, s: number, color: number): void {
  g.moveTo(x, y).lineTo(x, y - 9 * s).stroke({ color: shade(color, 0.6), width: 1.2 });
  g.ellipse(x - 3.5 * s, y - 5 * s, 3.8 * s, 2 * s).fill(shade(color, 0.85));
  g.ellipse(x + 3.5 * s, y - 7 * s, 3.8 * s, 2 * s).fill(color);
  g.ellipse(x, y - 10.5 * s, 3 * s, 2.6 * s).fill(shade(color, 1.2));
}
