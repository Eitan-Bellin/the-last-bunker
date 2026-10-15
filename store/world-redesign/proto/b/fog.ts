import { Container, Sprite, Texture } from 'pixi.js';
import { T } from './tokens';
import { TW, hash2, sx, sy } from './iso';
import { NX, NY, fogged, idx } from './map';

/** Smoky blob texture: many soft circles with a little noise, so overlapping blobs read as drifting murk, not discs. */
function blobTexture(seed: number): Texture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  let s = seed;
  const r = (): number => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  for (let i = 0; i < 34; i++) {
    const a = r() * Math.PI * 2, d = r() * 0.22 * size;
    const x = size / 2 + Math.cos(a) * d, y = size / 2 + Math.sin(a) * d * 0.8;
    const rad = size * (0.14 + r() * 0.16);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(255,255,255,0.22)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return Texture.from(c);
}

interface Blob { s: Sprite; x: number; y: number; z: number; ph: number; fade: number; cellI: number }

export class Fog {
  layer = new Container();
  blobs: Blob[] = [];
  private byCell = new Map<number, Blob>();
  private tex = [blobTexture(11), blobTexture(23), blobTexture(37)];

  constructor(private topAt: (i: number) => number) {
    for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
      const i = idx(x, y);
      if (!fogged[i]) continue;
      const s = new Sprite(this.tex[(x * 7 + y * 3) % 3]);
      s.anchor.set(0.5);
      s.tint = T.fog.color;
      const b: Blob = { s, x: x + 0.5, y: y + 0.5, z: 0, ph: hash2(x, y, 1) * 10, fade: 1, cellI: i };
      this.blobs.push(b);
      this.byCell.set(i, b);
      this.layer.addChild(s);
    }
    this.restack();
  }

  /** Heights follow the current column tops (call after a slice change). */
  restack(): void {
    for (const b of this.blobs) b.z = this.topAt(b.cellI) + 0.4;
    // draw back-to-front so nearer murk overlaps farther
    this.blobs.sort((a, c) => a.x + a.y - (c.x + c.y));
    this.blobs.forEach((b, i) => { b.s.zIndex = i; });
    this.layer.sortableChildren = true;
  }

  /** Screen-space tap (in world px, before camera) -> reveal. Returns number of cells revealed. */
  tap(wx: number, wy: number, zoom: number): number {
    const rad = T.fog.tapRadiusPx / zoom;
    const hits: Blob[] = [];
    for (const b of this.blobs) {
      if (b.fade < 1) continue;
      const dx = sx(b.x, b.y) - wx, dy = sy(b.x, b.y, b.z) - wy;
      if (dx * dx + dy * dy < rad * rad) hits.push(b);
    }
    if (!hits.length) return 0;
    let n = 0;
    const R = T.fog.revealCells;
    for (const h of hits) for (const b of this.blobs) {
      if (b.fade < 1) continue;
      if ((b.x - h.x) ** 2 + (b.y - h.y) ** 2 <= R * R) { b.fade = 0.999; fogged[b.cellI] = 0; n++; }
    }
    return n;
  }

  update(t: number, dt: number): void {
    const dr = T.fog.drift, sp = T.fog.driftSpeed;
    const size = T.fog.blobCells * TW;
    for (let i = this.blobs.length - 1; i >= 0; i--) {
      const b = this.blobs[i];
      const ox = Math.sin(t * sp + b.ph) * dr, oy = Math.cos(t * sp * 0.8 + b.ph * 1.3) * dr;
      b.s.position.set(sx(b.x + ox, b.y + oy), sy(b.x + ox, b.y + oy, b.z));
      let a = T.fog.alpha * (0.9 + 0.1 * Math.sin(t * 0.6 + b.ph));
      let sc = 1;
      if (b.fade < 1) {
        b.fade -= dt / T.fog.fadeSeconds;
        if (b.fade <= 0) { b.s.destroy(); this.blobs.splice(i, 1); this.byCell.delete(b.cellI); continue; }
        a *= b.fade;
        sc = 1 + (1 - b.fade) * 0.6;
      }
      b.s.alpha = a;
      b.s.width = size * sc;
      b.s.height = size * 0.62 * sc;
    }
  }
}
