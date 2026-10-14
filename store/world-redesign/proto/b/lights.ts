import { Container, Graphics, RenderTexture, Sprite, Texture, type Renderer } from 'pixi.js';
import { T } from './tokens';
import { TW, sx, sy, zf } from './iso';
import { fogged, idx, lights, type Light } from './map';

/** Soft radial falloff texture, (1 - r^2)^2 with a hot core. */
export function radialTexture(size = 128, core = 0.0): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + 0.5) / size * 2 - 1, dy = (y + 0.5) / size * 2 - 1;
    const r2 = dx * dx + dy * dy;
    let a = r2 >= 1 ? 0 : (1 - r2) * (1 - r2);
    if (core > 0) a = Math.min(1, a + core * Math.exp(-r2 * 40));
    const o = (y * size + x) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
    img.data[o + 3] = Math.round(a * 255);
  }
  ctx.putImageData(img, 0, 0);
  return Texture.from(c);
}

/** Light shaft: soft horizontally, fading toward the bottom. */
function shaftTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(64, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 64; x++) {
    const u = (x + 0.5) / 64 * 2 - 1, v = y / 255;
    const h = Math.max(0, 1 - u * u) ** 1.6;
    const vv = Math.min(1, v * 6) * (1 - v * 0.7);
    const o = (y * 64 + x) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
    img.data[o + 3] = Math.round(h * vv * 255);
  }
  ctx.putImageData(img, 0, 0);
  return Texture.from(c);
}

interface LiveLight {
  def: Light;
  pool: Sprite; // floor ellipse in the lightmap
  vol: Sprite | null; // round volume in the lightmap
  glow: Sprite | null; // additive bulb glow on top
  haze: Sprite | null;
  seed: number;
  level: number;
  /** Extra position offset (for swaying lamps / headlamps). */
  ox: number; oy: number;
}

export class Lighting {
  rt: RenderTexture;
  darkness: Sprite;
  lightRoot = new Container();
  lightCam = new Container();
  glowLayer = new Container();
  live: LiveLight[] = [];
  private pool = radialTexture(128);
  readonly dot = radialTexture(32, 0.6);
  private shaftTex = shaftTexture();
  shafts: Sprite[] = [];
  slice = 0;
  private bg: Graphics;

  constructor(private renderer: Renderer, w: number, h: number) {
    this.rt = RenderTexture.create({ width: Math.max(2, Math.ceil(w * T.light.mapScale)), height: Math.max(2, Math.ceil(h * T.light.mapScale)), resolution: 1 });
    this.darkness = new Sprite(this.rt);
    this.darkness.blendMode = 'multiply';
    this.darkness.width = w; this.darkness.height = h;
    this.lightRoot.addChild(this.lightCam);
    // background light for the sky region so the sky gradient is not crushed to black
    this.bg = new Graphics();
    this.lightCam.addChild(this.bg);
    for (const d of lights) this.addLight(d);
    // moonlight shafts through the crater into the atrium
    const top = [9, 11, 0.4], bottom = [8.6, 14, zf(3)];
    for (let k = 0; k < 3; k++) {
      const s = new Sprite(this.shaftTex);
      s.anchor.set(0.5, 0);
      s.blendMode = 'add';
      s.tint = T.light.sky;
      const x0 = sx(top[0] - 1.5 + k * 1.6, top[1]), y0 = sy(top[0], top[1], top[2]) - 40;
      const x1 = sx(bottom[0] - 1 + k * 1.2, bottom[1]), y1 = sy(bottom[0], bottom[1], bottom[2]);
      s.position.set(x0, y0);
      s.height = Math.hypot(x1 - x0, y1 - y0) * 1.05;
      s.width = TW * (2.2 + k * 0.7);
      s.rotation = -Math.atan2(x1 - x0, y1 - y0);
      s.alpha = 0.09 + k * 0.03;
      this.shafts.push(s);
      this.glowLayer.addChild(s);
    }
  }

  addLight(def: Light, level = def.l): LiveLight {
    const pool = new Sprite(this.pool);
    pool.anchor.set(0.5);
    pool.blendMode = 'add';
    pool.tint = def.color;
    this.lightCam.addChild(pool);
    let vol: Sprite | null = null;
    if (def.vol) {
      vol = new Sprite(this.pool);
      vol.anchor.set(0.5);
      vol.blendMode = 'add';
      vol.tint = def.color;
      this.lightCam.addChild(vol);
    }
    let glow: Sprite | null = null, haze: Sprite | null = null;
    if (def.glow) {
      glow = new Sprite(this.dot);
      glow.anchor.set(0.5);
      glow.blendMode = 'add';
      glow.tint = def.color;
      haze = new Sprite(this.pool);
      haze.anchor.set(0.5);
      haze.blendMode = 'add';
      haze.tint = def.color;
      this.glowLayer.addChild(haze, glow);
    }
    const L: LiveLight = { def, pool, vol, glow, haze, seed: Math.random() * 100, level, ox: 0, oy: 0 };
    this.live.push(L);
    this.place(L);
    return L;
  }

  place(L: LiveLight): void {
    const d = L.def;
    const x = d.x + L.ox, y = d.y + L.oy;
    // floor pool: projected ellipse on the floor under the light
    const floorZ = d.floorZ ?? (d.z > zf(3) - 0.01 && d.l <= 3 ? floorUnder(d) : d.z);
    const px = sx(x, y), py = sy(x, y, floorZ);
    L.pool.position.set(px, py);
    const ex = d.r * TW * Math.SQRT2 * 0.5 * 2, ey = ex / 2;
    L.pool.width = ex; L.pool.height = ey;
    if (L.vol) {
      L.vol.position.set(px, sy(x, y, d.z));
      L.vol.width = L.vol.height = ex * T.light.volScale;
    }
    if (L.glow && L.haze) {
      const gx = px, gy = sy(x, y, d.z);
      L.glow.position.set(gx, gy);
      L.glow.width = L.glow.height = (d.glow ?? 0.3) * TW * 1.6;
      L.haze.position.set(gx, gy);
      L.haze.width = L.haze.height = (d.glow ?? 0.3) * TW * 9;
    }
  }

  setSlice(slice: number): void {
    this.slice = slice;
    for (const L of this.live) {
      const vis = L.level >= slice;
      L.pool.visible = vis;
      if (L.vol) L.vol.visible = vis;
      if (L.glow) L.glow.visible = vis;
      if (L.haze) L.haze.visible = vis;
    }
    for (const s of this.shafts) s.visible = slice === 0;
  }

  resize(w: number, h: number): void {
    this.rt.resize(Math.max(2, Math.ceil(w * T.light.mapScale)), Math.max(2, Math.ceil(h * T.light.mapScale)));
    this.darkness.width = w; this.darkness.height = h;
  }

  update(t: number, camX: number, camY: number, zoom: number, w: number, h: number): void {
    const fl = T.light.flicker;
    for (const L of this.live) {
      const d = L.def;
      let k = 1;
      const s = L.seed;
      switch (d.type) {
        case 'fire': k = 0.82 + 0.1 * Math.sin(t * 9.1 + s) + 0.07 * Math.sin(t * 23.7 + s * 2) + 0.05 * Math.sin(t * 3.3 + s); break;
        case 'fail': { const p = (t * 0.7 + s) % 7; k = p > 6.2 ? (Math.sin(t * 60) > 0 ? 1 : 0.15) : p > 6.0 ? 0.3 : 0.97 + 0.03 * Math.sin(t * 50); break; }
        case 'pulse': k = 0.8 + 0.2 * Math.sin(t * 1.1 + s); break;
        case 'tv': k = 0.6 + 0.4 * Math.abs(Math.sin(Math.floor(t * 6 + s) * 12.9898) % 1); break;
        case 'weld': { const p = (t + s) % 5; k = p < 2.2 ? (Math.sin(t * 47 + s) > -0.2 ? 0.6 + Math.random() * 0.6 : 0.05) : 0.0; break; }
        case 'blink': k = (t + s) % 1.6 < 0.25 ? 1 : 0.05; break;
        case 'sway': k = 1; L.ox = Math.sin(t * 0.9 + s) * 0.12; L.oy = Math.cos(t * 0.7 + s) * 0.06; this.place(L); break;
        default: k = 1;
      }
      k = 1 + (k - 1) * fl;
      const hidden = fogged[idx(Math.floor(d.x), Math.floor(d.y))] === 1 && !d.tease;
      const i = hidden ? 0 : d.i * k;
      L.pool.alpha = Math.min(1, i * T.light.poolGain);
      if (L.vol) L.vol.alpha = Math.min(1, i * T.light.volGain);
      if (L.glow) L.glow.alpha = Math.min(1, (hidden ? 0 : 0.95 * k) * T.light.glowGain);
      if (L.haze) L.haze.alpha = Math.min(1, (hidden ? 0 : 0.22 * k) * T.light.hazeGain * 3);
    }
    for (let i = 0; i < this.shafts.length; i++) this.shafts[i].alpha = (0.08 + i * 0.03) * (0.85 + 0.15 * Math.sin(t * 0.4 + i * 1.7));
    const ms = T.light.mapScale;
    this.lightCam.scale.set(zoom * ms);
    this.lightCam.position.set((w / 2 - camX * zoom) * ms, (h / 2 - camY * zoom) * ms);
    this.bg.clear();
    this.renderer.render({ container: this.lightRoot, target: this.rt, clear: true, clearColor: hexToRgba(T.light.ambient) });
  }
}

function floorUnder(d: Light): number {
  // lights hang above the floor of their level; the pool lands on that floor
  if (d.l === 4) return d.z;
  return zf(d.l);
}

function hexToRgba(c: number): [number, number, number, number] {
  return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255, 1];
}
