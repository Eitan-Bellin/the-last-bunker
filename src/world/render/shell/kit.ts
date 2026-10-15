/**
 * [world:C1] Shared helpers for the shell pieces: the stratum palette, the "one hand" fill rules (UNIFY: vertical gradient, grain,
 * outline), world-kit sprites placed in world units, lamp spots to light definitions, and a few procedural textures.
 */
import { Container, FillGradient, Graphics, Sprite, Texture, TilingSprite } from 'pixi.js';
import { makeWorldSprite, makeWorldTiling, worldLamps, type WorldAssetId } from '../../../art/worldKit';
import { DETAIL, STRATA, UNIFY, type Hex, type StratumId } from '../../tokens';
import { baseTier, type RenderTier } from '../../tokensRender';
import type { LightDef } from './types';
import { hash2 } from '../../model/outline';

export { hash2 };

export function palette(s: StratumId): (typeof STRATA)[number]['palette'] {
  return STRATA[Math.max(0, Math.min(6, s))].palette;
}

export function density(q: RenderTier): number {
  return DETAIL[baseTier(q)].density;
}

/** Multiplies a colour's channels by k (clamped). */
export function shade(c: Hex, k: number): Hex {
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return (f((c >> 16) & 255) << 16) | (f((c >> 8) & 255) << 8) | f(c & 255);
}

export function mix(a: Hex, b: Hex, t: number): Hex {
  const f = (s: number) => Math.round(((a >> s) & 255) + ((((b >> s) & 255) - ((a >> s) & 255)) * t));
  return (f(16) << 16) | (f(8) << 8) | f(0);
}

/** A vertical gradient fill (UNIFY.fill: top x1.08, bottom x0.9) for a flat procedural surface spanning y0..y1. */
export function vfill(c: Hex, y0: number, y1: number, top: number = UNIFY.fill.gradientTop, bottom: number = UNIFY.fill.gradientBottom): FillGradient {
  const g = new FillGradient({ type: 'linear', start: { x: 0, y: y0 }, end: { x: 0, y: y1 }, textureSpace: 'global' });
  g.addColorStop(0, shade(c, top));
  g.addColorStop(1, shade(c, bottom));
  return g;
}

/** The shared outline (UNIFY.outline) as a stroke style. */
export const OUTLINE = { width: UNIFY.outline.width, color: UNIFY.outline.color, alpha: UNIFY.outline.alpha } as const;

let grainTex: Texture | null = null;
/** The shared grain (multiply at UNIFY.fill.grainAlpha) as a 128 px repeating texture. */
export function grainTexture(): Texture {
  if (grainTex) return grainTex;
  const n = 128;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = 150 + Math.round(105 * (0.55 * hash2(x, y) + 0.45 * hash2(x >> 2, (y >> 2) + 911)));
      const i = (y * n + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.min(255, v);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  grainTex = Texture.from(c);
  grainTex.source.style.addressMode = 'repeat';
  return grainTex;
}

/** A grain overlay over a rect (multiply, UNIFY.fill.grainAlpha). */
export function grain(x: number, y: number, w: number, h: number, alpha: number = UNIFY.fill.grainAlpha): TilingSprite {
  const t = new TilingSprite({ texture: grainTexture(), width: w, height: h });
  t.position.set(x, y);
  t.tilePosition.set(-x / UNIFY.fill.grainScale, -y / UNIFY.fill.grainScale);
  t.tileScale.set(UNIFY.fill.grainScale);
  t.blendMode = 'multiply';
  t.alpha = alpha;
  return t;
}

/** A world-kit tiling strip at (x, y) with its pattern locked to the world (neighbours line up). */
export function tile(id: WorldAssetId, x: number, y: number, w: number, h: number, opts: { stratum?: StratumId; ox?: number; oy?: number; tint?: Hex; alpha?: number } = {}): TilingSprite {
  const t = makeWorldTiling(id, Math.max(1, w), Math.max(1, h), opts.stratum !== undefined ? { stratum: opts.stratum } : {});
  t.position.set(x, y);
  t.tilePosition.set(-(x - (opts.ox ?? 0)), -(y - (opts.oy ?? 0)));
  if (opts.tint !== undefined) t.tint = opts.tint;
  if (opts.alpha !== undefined) t.alpha = opts.alpha;
  return t;
}

/** A world-kit sprite with its anchor at (x, y). */
export function sprite(id: WorldAssetId, x: number, y: number, opts: { stratum?: StratumId; flip?: boolean; emissive?: boolean; tint?: Hex; scale?: number; rotation?: number; alpha?: number } = {}): Sprite {
  const s = makeWorldSprite(id, { stratum: opts.stratum, flip: opts.flip, emissive: opts.emissive });
  s.position.set(x, y);
  if (opts.scale) s.scale.set(s.scale.x * opts.scale, s.scale.y * opts.scale);
  if (opts.rotation) s.rotation = opts.rotation;
  if (opts.tint !== undefined) s.tint = opts.tint;
  if (opts.alpha !== undefined) s.alpha = opts.alpha;
  return s;
}

/** A lamp sprite with its emissive twin on top, plus its light definitions (the row's lamp spots). */
export function lamp(
  into: Container, glow: Container | null, id: WorldAssetId, x: number, y: number,
  light: Partial<LightDef> = {}, opts: { flip?: boolean; scale?: number } = {},
): LightDef[] {
  into.addChild(sprite(id, x, y, { flip: opts.flip, scale: opts.scale }));
  (glow ?? into).addChild(sprite(id, x, y, { flip: opts.flip, emissive: true, scale: opts.scale }));
  return worldLamps(id, x, y, opts.flip).map(l => ({ x: l.x, y: l.y, preset: l.preset, kind: 'shell' as const, ...light }));
}

/** A thin vector rod (railing post, bracket) with the shared outline: two values and the line (UNIFY vector rule). */
export function rod(g: Graphics, x0: number, y0: number, x1: number, y1: number, w: number, color: Hex): void {
  g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: w + OUTLINE.width * 2, color: OUTLINE.color, alpha: OUTLINE.alpha, cap: 'round' });
  g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: w, color, cap: 'round' });
}

/** A soft contact shadow (UNIFY.contactShadow) under something standing on a floor. */
export function contactShadow(g: Graphics, cx: number, y: number, w: number): void {
  const C = UNIFY.contactShadow;
  for (let i = 0; i < 3; i++) {
    const k = 1 + i * 0.35;
    g.ellipse(cx, y, (w * C.widthMul * k) / 2, (C.height * k) / 2).fill({ color: C.color, alpha: C.alpha / 3 });
  }
}

/** A deterministic random generator. */
export function rng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
