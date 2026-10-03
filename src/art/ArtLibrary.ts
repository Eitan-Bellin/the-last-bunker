import { Assets, Texture } from 'pixi.js';
import { artEntry, type ArtEntry, type LightSpot } from './registry';

interface ArtMeta {
  lights: LightSpot[];
}

/**
 * Loads painted textures on demand (only what is on screen gets decoded) and tells the
 * renderer when a texture arrives so placeholder visuals can be swapped for the painting.
 */
class ArtLibraryImpl {
  private textures = new Map<string, Texture>();
  private pending = new Set<string>();
  private failed = new Set<string>();
  private listeners = new Set<(key: string) => void>();
  private meta: Record<string, ArtMeta> = {};

  /** Lamp positions detected by the art pipeline (tools/art.html), used when an entry has none by hand. */
  async loadMeta(): Promise<void> {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}art/meta.json`);
      if (res.ok) this.meta = await res.json();
    } catch {
      this.meta = {};
    }
  }

  private balance: Record<string, { lum: number; rgb: [number, number, number] }> = {};

  /** Exposure and white-balance measurements of the paintings (tools/lum.html). */
  async loadBalance(): Promise<void> {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}art/balance.json`);
      if (res.ok) this.balance = await res.json();
    } catch {
      this.balance = {};
    }
  }

  /**
   * Graphics overhaul G5: per-channel gains (0..1) that pull a room painting toward one shared look.
   * Upgraded rooms stay brighter than wrecked ones, but the top tier no longer glares white and cold:
   * exposure is capped per tier and cold casts are warmed halfway toward the bunker's lamp-lit neutral.
   */
  balanceFor(key: string): [number, number, number] {
    const m = this.balance[key];
    if (!m) return [1, 1, 1];
    const tier = key.startsWith('rooms/') ? Number(key.slice(-1)) : -1;
    const cap = tier === 2 ? 0.4 : tier === 1 ? 0.33 : 1;
    const gain = Math.min(1, cap / Math.max(0.01, m.lum));
    const [r, g, b] = m.rgb;
    const mean = (r + g + b) / 3 || 1;
    // Warm neutral of the lamp-lit rooms: red a bit above the mean, blue below.
    const want = [1.12, 1.0, 0.82];
    const cast = [r, g, b].map((v, i) => 1 + 0.5 * ((want[i] * mean) / Math.max(1, v) - 1));
    const top = Math.max(...cast);
    return cast.map(c => (c / top) * gain) as [number, number, number];
  }

  /** gfx-p0 rooms: measured brightness of a painting (0..1), or null when unmeasured; bright paintings have their light baked in. */
  lumOf(key: string): number | null {
    return this.balance[key]?.lum ?? null;
  }

  lightsFor(entry: ArtEntry): LightSpot[] {
    return entry.lights ?? this.meta[entry.key]?.lights ?? [];
  }

  url(key: string): string {
    return `${import.meta.env.BASE_URL}art/${key}.webp`;
  }

  /** Returns the texture if ready, otherwise starts loading it and returns null. */
  get(key: string): Texture | null {
    const tex = this.textures.get(key);
    if (tex) return tex;
    if (!this.pending.has(key) && !this.failed.has(key) && artEntry(key)) void this.load(key);
    return null;
  }

  has(key: string): boolean {
    return this.textures.has(key);
  }

  onLoaded(fn: (key: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async preload(keys: string[]): Promise<void> {
    await Promise.all(keys.map(k => (this.textures.has(k) ? null : this.load(k))));
  }

  private async load(key: string): Promise<void> {
    this.pending.add(key);
    try {
      const tex = await Assets.load<Texture>({
        src: this.url(key),
        data: { autoGenerateMipmaps: true, scaleMode: 'linear' },
      });
      this.textures.set(key, tex);
      for (const fn of this.listeners) fn(key);
    } catch {
      this.failed.add(key);
    } finally {
      this.pending.delete(key);
    }
  }
}

export const ArtLibrary = new ArtLibraryImpl();

let glow: Texture | null = null;

/** Shared soft radial light texture (white, tinted per use). */
export function glowTexture(): Texture {
  if (glow) return glow;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.62)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.2)');
  g.addColorStop(0.75, 'rgba(255,255,255,0.05)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glow = Texture.from(c);
  return glow;
}

let cone: Texture | null = null;

/** Downward light cone from a ceiling lamp (white, tinted per use). */
export function coneTexture(): Texture {
  if (cone) return cone;
  const w = 128, h = 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(w * 0.44, 0);
  ctx.lineTo(w * 0.56, 0);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();
  // Feather the cone's edges.
  ctx.globalCompositeOperation = 'destination-in';
  const side = ctx.createLinearGradient(0, 0, w, 0);
  side.addColorStop(0, 'rgba(0,0,0,0)');
  side.addColorStop(0.3, 'rgba(0,0,0,1)');
  side.addColorStop(0.7, 'rgba(0,0,0,1)');
  side.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = side;
  ctx.fillRect(0, 0, w, h);
  cone = Texture.from(c);
  return cone;
}

let mote: Texture | null = null;

/** Tiny soft dot for dust motes, drips and sparks. */
export function moteTexture(): Texture {
  if (mote) return mote;
  const s = 16;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  mote = Texture.from(c);
  return mote;
}
