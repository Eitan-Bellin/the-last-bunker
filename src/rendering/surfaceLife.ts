import { CanvasSource, Container, Rectangle, Sprite, Texture } from 'pixi.js';
import { moteTexture } from '../art/ArtLibrary';

/**
 * Graphics phase 0 (surface): the procedural pieces that turn the surface painting into a place —
 * noise textures (clouds, fog, smoke puffs, rain), bird flap frames, a sky/landscape split of the
 * panorama (so clouds, stars and the moon pass behind the painted skyline), the rolling ground line,
 * and the pooled systems that move: smoke, birds and weather. Everything is generated once and cached.
 */
export type SurfaceQuality = 'high' | 'medium' | 'low';

// ---------- Noise ----------

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const ease = (t: number) => t * t * (3 - 2 * t);

/** Value noise that repeats every `period` lattice cells sideways, so the textures tile. */
function vnoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const u = ease(x - xi), v = ease(y - yi);
  const x0 = ((xi % period) + period) % period, x1 = (x0 + 1) % period;
  const a = hash(x0, yi, seed), b = hash(x1, yi, seed), c = hash(x0, yi + 1, seed), d = hash(x1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, period: number, octaves: number, seed: number): number {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise(x * f, y * f, period * f, seed + o * 17);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

// ---------- Textures ----------

const cache = new Map<string, Texture>();

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

export function canvasTexture(c: HTMLCanvasElement, repeat = false, mipmaps = true): Texture {
  return new Texture({
    source: new CanvasSource({ resource: c, addressMode: repeat ? 'repeat' : 'clamp-to-edge', autoGenerateMipmaps: mipmaps, scaleMode: 'linear' }),
  });
}

function cached(key: string, make: () => Texture): Texture {
  let t = cache.get(key);
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
}

/** Fills a canvas pixel by pixel: `px(x, y)` returns [r, g, b, a] in 0..1. */
function paint(w: number, h: number, px: (x: number, y: number) => [number, number, number, number]): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(w, h);
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = px(x, y);
      const i = (y * w + x) * 4;
      d[i] = r * 255;
      d[i + 1] = g * 255;
      d[i + 2] = b * 255;
      d[i + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * A sideways-tiling band of cloud: layer 0 thin high wisps, layer 1 lower, fuller banks. White with
 * lit tops and greyer bellies, so a tint gives the era's sky colour.
 */
export function cloudTexture(layer: 0 | 1): Texture {
  return cached(`cloud${layer}`, () => {
    const W = 512, H = layer ? 120 : 96, P = layer ? 6 : 5;
    const stretch = layer ? 2.2 : 3.4;
    return canvasTexture(paint(W, H, (x, y) => {
      const yy = y / H;
      const n = fbm((x / W) * P, (y / H) * P * (H / W) * stretch + layer * 9, P, 5, layer ? 31 : 7);
      const env = Math.pow(Math.sin(Math.PI * yy), layer ? 1.1 : 1.7);
      const a = smoothstep(layer ? 0.44 : 0.5, layer ? 0.74 : 0.8, n * (0.55 + 0.55 * env)) * env;
      const l = clamp01(0.72 + 0.34 * (1 - yy) + 0.3 * (n - 0.5));
      return [l, l * 0.97, l * 0.94, a * 0.95];
    }), true);
  });
}

/** A long, soft, sideways-tiling band of ground fog / haze. */
export function fogTexture(): Texture {
  return cached('fog', () => {
    const W = 512, H = 64;
    return canvasTexture(paint(W, H, (x, y) => {
      const yy = y / H;
      const n = fbm((x / W) * 4, yy * 1.3, 4, 4, 51);
      const env = Math.exp(-Math.pow((yy - 0.56) / 0.24, 2));
      const a = env * (0.22 + 0.78 * smoothstep(0.3, 0.72, n));
      return [1, 1, 1, a];
    }), true);
  });
}

/** A soft, ragged smoke puff. */
export function puffTexture(): Texture {
  return cached('puff', () => {
    const S = 64;
    return canvasTexture(paint(S, S, (x, y) => {
      const dx = (x - S / 2 + 0.5) / (S / 2), dy = (y - S / 2 + 0.5) / (S / 2);
      const r = Math.sqrt(dx * dx + dy * dy);
      const n = fbm((x / S) * 4, (y / S) * 4, 4, 3, 91);
      const a = clamp01((1 - smoothstep(0.25, 1, r)) * (0.45 + 1.1 * (n - 0.3)));
      const l = clamp01(0.86 + 0.14 * -dy);
      return [l, l, l, a];
    }));
  });
}

/** A rain streak: a thin line fading in and out along its length. */
export function rainTexture(): Texture {
  return cached('rain', () => canvasTexture(paint(4, 48, (x, y) => {
    const a = Math.sin((Math.PI * y) / 47) * (1 - Math.abs(x - 1.5) / 2);
    return [1, 1, 1, clamp01(a)];
  }), false, false));
}

/** A splash ring seen from the side. */
export function splashTexture(): Texture {
  return cached('splash', () => canvasTexture(paint(24, 10, (x, y) => {
    const dx = (x - 11.5) / 11, dy = (y - 6) / 3.5;
    const r = Math.sqrt(dx * dx + dy * dy);
    const a = Math.max(0, 1 - Math.abs(r - 0.8) / 0.22) * (y < 7 ? 1 : 0.4);
    return [1, 1, 1, clamp01(a)];
  }), false, false));
}

/** A pale moon with soft maria and a slightly darker limb. */
export function moonTexture(): Texture {
  return cached('moon', () => {
    const S = 96, R = 44;
    return canvasTexture(paint(S, S, (x, y) => {
      const dx = (x - S / 2 + 0.5) / R, dy = (y - S / 2 + 0.5) / R;
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r > 1.04) return [0, 0, 0, 0];
      const edge = 1 - smoothstep(0.96, 1.04, r);
      const maria = fbm(x / 22, y / 22, 64, 4, 303);
      const l = clamp01(0.98 - 0.22 * smoothstep(0.45, 0.62, maria) - 0.18 * r * r);
      return [l, l * 0.98, l * 0.92, edge];
    }));
  });
}

/** Eight flap frames of a distant bird (white, tinted per species and light). */
export function birdFrames(): Texture[] {
  const base = cached('birds', () => {
    const FW = 40, FH = 20;
    const [c, ctx] = makeCanvas(FW * 8, FH);
    ctx.fillStyle = '#fff';
    for (let f = 0; f < 8; f++) {
      const wing = Math.sin((f / 8) * Math.PI * 2);
      ctx.save();
      ctx.translate(f * FW + FW / 2, FH / 2 + 1);
      ctx.beginPath();
      ctx.ellipse(0, 0, 4.2, 1.8, 0, 0, Math.PI * 2);
      ctx.fill();
      for (const s of [-1, 1]) {
        const tipY = -wing * 7.5 + 1;
        ctx.beginPath();
        ctx.moveTo(s * 1.5, -1.2);
        ctx.quadraticCurveTo(s * 8, -wing * 4.5 - 2.2, s * 17, tipY);
        ctx.quadraticCurveTo(s * 9, -wing * 3 + 0.6, s * 2.5, 1.2);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
    return canvasTexture(c);
  });
  const frames: Texture[] = [];
  for (let f = 0; f < 8; f++) frames.push(new Texture({ source: base.source, frame: new Rectangle(f * 40, 0, 40, 20) }));
  return frames;
}

/** The silhouette of a texture filled white (for a sun-side rim light). */
export function silhouetteTexture(key: string, tex: Texture): Texture | null {
  const hit = cache.get(`sil:${key}`);
  if (hit) return hit;
  const res = tex.source?.resource as CanvasImageSource | undefined;
  if (!res) return null;
  const [c, ctx] = makeCanvas(tex.source.width, tex.source.height);
  ctx.drawImage(res, 0, 0, c.width, c.height);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  const out = canvasTexture(c);
  cache.set(`sil:${key}`, out);
  return out;
}

// ---------- Sky / landscape split of the panorama ----------

export interface SkyInfo {
  /** The painting with its sky cut away: drawn over clouds, stars and the moon. */
  land: Texture;
  /** Average colour of the painting's top rows (the sky extends upward from it). */
  top: number;
  /** Average colour of the lit landscape: the light the portal and props are graded to. */
  light: number;
  /**
   * Plan 2026-10 Q7: the painting with its landscape removed and the sky run down past the horizon, so the sky can drift
   * on its own parallax layer under the landscape cut-out. Built on the first call (one more painting-sized texture).
   */
  skyOnly: () => Texture | null;
}

const skies = new Map<number, SkyInfo>();

const rgb = (r: number, g: number, b: number) => (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);

/**
 * Splits the panorama into sky and landscape. Each row's sky colour is its median (rows in the upper
 * half are mostly sky); a pixel is sky-like when it is near that colour or brighter. The landscape is
 * everything not sky-like that connects to the bottom edge, and the sky is what connects to the top
 * through the rest — so lit windows inside buildings stay landscape and painted clouds stay put.
 */
export function analyseSky(tex: Texture, era: number): SkyInfo | null {
  const hit = skies.get(tex.uid);
  if (hit) return hit;
  const res = tex.source?.resource as CanvasImageSource | undefined;
  if (!res) return null;
  const TW = tex.source.width, TH = tex.source.height;
  const W = 350, H = Math.round((350 * TH) / TW);
  const [sc, sctx] = makeCanvas(W, H);
  sctx.drawImage(res, 0, 0, W, H);
  const d = sctx.getImageData(0, 0, W, H).data;
  const ref = new Float32Array(H * 3);
  const vals: number[][] = [[], [], []];
  for (let y = 0; y < H; y++) {
    if (y < H * 0.55) {
      for (let ch = 0; ch < 3; ch++) {
        const v = vals[ch];
        v.length = 0;
        for (let x = 0; x < W; x++) v.push(d[(y * W + x) * 4 + ch]);
        v.sort((a, b) => a - b);
        ref[y * 3 + ch] = v[W >> 1] / 255;
      }
    } else for (let ch = 0; ch < 3; ch++) ref[y * 3 + ch] = ref[(y - 1) * 3 + ch];
  }
  const skyish = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const rr = ref[y * 3], rg = ref[y * 3 + 1], rb = ref[y * 3 + 2];
    const rl = 0.3 * rr + 0.59 * rg + 0.11 * rb;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      const dist = Math.sqrt((r - rr) ** 2 + (g - rg) ** 2 + (b - rb) ** 2);
      const l = 0.3 * r + 0.59 * g + 0.11 * b;
      let s = dist < 0.14 || l > rl + 0.02;
      // Foliage reads as land even where it is as bright as the sky.
      if (s && era >= 1 && g > r * 0.93 && g > b * 1.08) s = false;
      skyish[y * W + x] = s ? 1 : 0;
    }
  }
  const flood = (pass: (i: number) => boolean, seedRow: number): Uint8Array => {
    const out = new Uint8Array(W * H);
    const q = new Int32Array(W * H);
    let head = 0, tail = 0;
    for (let x = 0; x < W; x++) {
      const i = seedRow * W + x;
      if (pass(i)) { out[i] = 1; q[tail++] = i; }
    }
    const visit = (j: number) => {
      if (j < 0 || j >= W * H || out[j] || !pass(j)) return;
      out[j] = 1;
      q[tail++] = j;
    };
    while (head < tail) {
      const i = q[head++];
      const x = i % W;
      if (x > 0) visit(i - 1);
      if (x < W - 1) visit(i + 1);
      visit(i - W);
      visit(i + W);
    }
    return out;
  };
  const land = flood(i => !skyish[i], H - 1);
  const sky = flood(i => !land[i], 0);
  // Mask: white where sky, upscaled smoothly onto the full painting, then cut out of it.
  const [mc, mctx] = makeCanvas(W, H);
  const mimg = mctx.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    mimg.data[i * 4] = mimg.data[i * 4 + 1] = mimg.data[i * 4 + 2] = 255;
    mimg.data[i * 4 + 3] = sky[i] ? 255 : 0;
  }
  mctx.putImageData(mimg, 0, 0);
  const [lc, lctx] = makeCanvas(TW, TH);
  lctx.drawImage(res, 0, 0, TW, TH);
  lctx.globalCompositeOperation = 'destination-out';
  lctx.imageSmoothingEnabled = true;
  lctx.filter = `blur(${Math.max(2, TW / W)}px)`;
  lctx.drawImage(mc, 0, 0, TW, TH);
  lctx.filter = 'none';
  // Colours: the top rows (the sky continues upward from them) and the lit land.
  let tr = 0, tg = 0, tb = 0, tn = 0, lr = 0, lg = 0, lb = 0, ln = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (y < 4) { tr += d[i]; tg += d[i + 1]; tb += d[i + 2]; tn++; }
      if (y > H * 0.5 && y < H * 0.8 && land[y * W + x]) {
        const w = d[i] + d[i + 1] + d[i + 2];
        lr += d[i] * w; lg += d[i + 1] * w; lb += d[i + 2] * w; ln += w;
      }
    }
  }
  let skyOnlyTex: Texture | null | undefined;
  const buildSkyOnly = (): Texture | null => {
    // Per column: the last sky pixel above the first land pixel; its colour (smoothed sideways) runs down from there.
    const yb = new Int32Array(W);
    const col = new Float32Array(W * 3);
    for (let x = 0; x < W; x++) {
      let last = 0;
      for (let y = 0; y < H; y++) {
        if (land[y * W + x]) break;
        if (sky[y * W + x]) last = y;
      }
      yb[x] = last;
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = Math.max(0, last - 3); y <= last; y++) {
        const i = (y * W + x) * 4;
        r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
      }
      col[x * 3] = r / n; col[x * 3 + 1] = g / n; col[x * 3 + 2] = b / n;
    }
    const sm = new Float32Array(W * 3);
    for (let x = 0; x < W; x++) {
      for (let ch = 0; ch < 3; ch++) {
        let v = 0, n = 0;
        for (let k = -6; k <= 6; k++) {
          const xx = Math.min(W - 1, Math.max(0, x + k));
          v += col[xx * 3 + ch];
          n++;
        }
        sm[x * 3 + ch] = v / n;
      }
    }
    const [fc, fctx] = makeCanvas(W, H);
    const fimg = fctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const below = y > yb[x];
        // Under the horizon the sky colour fades a little darker with depth (it is never seen unless the land layer drifts).
        const k = below ? 1 - 0.18 * Math.min(1, (y - yb[x]) / (H * 0.25)) : 1;
        fimg.data[i] = below ? sm[x * 3] * k : d[i];
        fimg.data[i + 1] = below ? sm[x * 3 + 1] * k : d[i + 1];
        fimg.data[i + 2] = below ? sm[x * 3 + 2] * k : d[i + 2];
        fimg.data[i + 3] = 255;
      }
    }
    fctx.putImageData(fimg, 0, 0);
    const [oc, octx] = makeCanvas(TW, TH);
    octx.imageSmoothingEnabled = true;
    octx.drawImage(fc, 0, 0, TW, TH);
    // The real painting over it wherever it is sky (soft-edged, like the landscape cut-out).
    const [tc, tctx] = makeCanvas(TW, TH);
    tctx.drawImage(res, 0, 0, TW, TH);
    tctx.globalCompositeOperation = 'destination-in';
    tctx.imageSmoothingEnabled = true;
    tctx.filter = `blur(${Math.max(2, TW / W)}px)`;
    tctx.drawImage(mc, 0, 0, TW, TH);
    tctx.filter = 'none';
    octx.drawImage(tc, 0, 0);
    return canvasTexture(oc);
  };
  const info: SkyInfo = {
    land: canvasTexture(lc),
    top: rgb(tr / tn, tg / tn, tb / tn),
    light: ln ? rgb(lr / ln, lg / ln, lb / ln) : 0xffffff,
    skyOnly: () => {
      if (skyOnlyTex === undefined) {
        try {
          skyOnlyTex = buildSkyOnly();
        } catch {
          skyOnlyTex = null;
        }
      }
      return skyOnlyTex;
    },
  };
  skies.set(tex.uid, info);
  return info;
}

/** Scales a colour so its brightest channel is 255, then mixes it toward white by `1 - k`. */
export function lightGrade(color: number, k: number): number {
  const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
  const m = Math.max(1, r, g, b);
  const f = (c: number) => 255 - (255 - (c / m) * 255) * k;
  return rgb(f(r), f(g), f(b));
}

/** Multiplies two colours channel by channel. */
export function mulColor(a: number, b: number): number {
  return rgb(
    (((a >> 16) & 255) * ((b >> 16) & 255)) / 255,
    (((a >> 8) & 255) * ((b >> 8) & 255)) / 255,
    ((a & 255) * (b & 255)) / 255,
  );
}

// ---------- Ground line ----------

/** [plan4:ST-16] West end of the level gate-house yard (the surface row's apron; its east end meets the entrance hill). */
export const YARD_X0 = -540, YARD_X1 = -110;

/** The entrance sits on level ground; elsewhere the topsoil rolls gently so no edge reads as a ruler. */
export function groundY(x: number, flatX: number): number {
  const w = smoothstep(150, 235, Math.abs(x - flatX));
  // [plan4:ST-16] The old gate-house yard (x -540 .. -110) is level concrete ground: the surface row stands on it, and it eases back into rolling land past its west end.
  const pad = smoothstep(0, 70, x < YARD_X0 ? YARD_X0 - x : x > YARD_X1 ? x - YARD_X1 : 0);
  return w * pad * (2.4 * Math.sin(x * 0.0113 + 0.7) + 1.5 * Math.sin(x * 0.029 + 2.1) + 0.7 * Math.sin(x * 0.067 + 4));
}

/** Thickness factor of the soil band below the grass. */
export function soilThickness(x: number): number {
  return 1 + 0.16 * Math.sin(x * 0.0093 + 1.1) + 0.1 * Math.sin(x * 0.033 + 0.3);
}

// ---------- Smoke ----------

export interface SmokeOptions {
  x: number;
  y: number;
  /** Puffs per second. */
  rate: number;
  life: number;
  rise: number;
  size: [number, number];
  alpha: number;
  color: number;
  /** How strongly the wind bends the column. */
  drift: number;
}

interface Puff { s: Sprite; age: number; life: number; x: number; y: number; vx: number; spin: number }

/** A pooled smoke column: puffs rise, swell, lean with the wind and fade. */
export class Smoke {
  private puffs: Puff[] = [];
  private acc = 0;
  private seed: number;
  private o: SmokeOptions;

  constructor(layer: Container, o: SmokeOptions, max: number, seed = 1) {
    this.o = o;
    this.seed = seed;
    const tex = puffTexture();
    for (let i = 0; i < max; i++) {
      const s = new Sprite(tex);
      s.anchor.set(0.5);
      s.tint = o.color;
      s.visible = false;
      layer.addChild(s);
      this.puffs.push({ s, age: 0, life: 0, x: 0, y: 0, vx: 0, spin: 0 });
    }
  }

  private rnd(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  /** [plan4:ST-20] New puffs and the ones in the air take this colour (fire turns the exhaust black). */
  setColor(color: number): void {
    if (color === this.o.color) return;
    this.o.color = color;
    for (const p of this.puffs) p.s.tint = color;
  }

  update(dt: number, wind: number, cap: number, strength = 1): void {
    const o = this.o;
    this.acc += dt * o.rate * strength;
    const limit = Math.min(cap, this.puffs.length);
    for (let i = 0; i < this.puffs.length; i++) {
      const p = this.puffs[i];
      if (p.s.visible) {
        p.age += dt;
        const k = p.age / p.life;
        if (k >= 1) { p.s.visible = false; continue; }
        p.x += (p.vx + wind * o.drift * (0.3 + k)) * dt;
        p.y -= o.rise * (1 - 0.45 * k) * dt;
        const size = o.size[0] + (o.size[1] - o.size[0]) * Math.sqrt(k);
        p.s.width = p.s.height = size;
        p.s.position.set(p.x, p.y);
        p.s.rotation += p.spin * dt;
        p.s.alpha = o.alpha * smoothstep(0, 0.12, k) * (1 - smoothstep(0.45, 1, k));
      } else if (this.acc >= 1 && i < limit) {
        this.acc -= 1;
        p.s.visible = true;
        p.age = 0;
        p.life = o.life * (0.8 + 0.4 * this.rnd());
        p.x = o.x + (this.rnd() - 0.5) * o.size[0] * 0.4;
        p.y = o.y;
        p.vx = (this.rnd() - 0.5) * o.rise * 0.25;
        p.spin = (this.rnd() - 0.5) * 0.6;
        p.s.rotation = this.rnd() * 6.28;
        p.s.alpha = 0;
      }
    }
    if (this.acc > 1) this.acc = 1;
  }
}

// ---------- Birds ----------

interface Bird { s: Sprite; ox: number; oy: number; ph: number; rate: number }
interface Flock { birds: Bird[]; x: number; y: number; vx: number; ph: number; glide: boolean; circle?: { cx: number; cy: number; r: number; w: number } }

/**
 * Bird life over the panorama: loose flocks crossing the sky (crows early on, songbirds once the valley
 * greens), vultures circling the ruins in the first era, and bats around the entrance at night.
 */
export class Birds {
  private pool: Sprite[] = [];
  private flocks: Flock[] = [];
  private frames = birdFrames();
  private next = 3;
  private seed = 4711;
  private bats: Bird[] = [];
  private era: number;
  private span: [number, number];
  private sky: [number, number];
  private batAt: [number, number];

  constructor(layer: Container, batLayer: Container, era: number, span: [number, number], sky: [number, number], batAt: [number, number]) {
    this.era = era;
    this.span = span;
    this.sky = sky;
    this.batAt = batAt;
    for (let i = 0; i < 18; i++) {
      const s = new Sprite(this.frames[0]);
      s.anchor.set(0.5);
      s.visible = false;
      layer.addChild(s);
      this.pool.push(s);
    }
    for (let i = 0; i < 3; i++) {
      const s = new Sprite(this.frames[0]);
      s.anchor.set(0.5);
      s.tint = 0x0e0c0c;
      s.visible = false;
      batLayer.addChild(s);
      this.bats.push({ s, ox: 0, oy: 0, ph: i * 2.1, rate: 11 + i * 2 });
    }
    // Vultures turn slow circles over the ruins all day.
    if (era === 0) this.spawn(true);
  }

  private rnd(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  private spawn(circling = false): void {
    const free = this.pool.filter(s => !s.visible);
    const big = this.era <= 1;
    const n = Math.min(free.length, circling ? 3 : big ? 2 + Math.floor(this.rnd() * 3) : 3 + Math.floor(this.rnd() * 6));
    if (n <= 0) return;
    const dir = this.rnd() < 0.5 ? 1 : -1;
    const [x0, x1] = this.span;
    const f: Flock = {
      birds: [], x: dir > 0 ? x0 : x1, y: this.sky[0] + this.rnd() * (this.sky[1] - this.sky[0]),
      vx: dir * (big ? 16 + this.rnd() * 8 : 24 + this.rnd() * 14), ph: this.rnd() * 10, glide: big,
    };
    if (circling) {
      f.circle = { cx: x0 + (x1 - x0) * (0.42 + this.rnd() * 0.16), cy: this.sky[0] + 20, r: 46 + this.rnd() * 20, w: 0.22 };
    }
    for (let i = 0; i < n; i++) {
      const s = free[i];
      s.visible = true;
      const size = circling ? 8.5 : big ? 6.5 : 4.2;
      s.scale.set((size / 40) * (0.85 + this.rnd() * 0.3));
      s.tint = this.era <= 1 ? 0x17120f : 0x2a2420;
      // A loose V: each bird trails behind and to the side of the one ahead.
      const k = Math.ceil(i / 2) * (i % 2 ? 1 : -1);
      f.birds.push({
        s, ox: -dir * Math.abs(k) * (big ? 9 : 7) + (this.rnd() - 0.5) * 5, oy: k * 4 + (this.rnd() - 0.5) * 4,
        ph: circling ? (i / n) * Math.PI * 2 : this.rnd() * 8, rate: big ? 2.6 + this.rnd() * 0.6 : 5.5 + this.rnd() * 2,
      });
    }
    this.flocks.push(f);
  }

  update(t: number, dt: number, night: number, rain: number): void {
    // New flocks by day, fewer in rain, none at night.
    this.next -= dt;
    if (this.next <= 0) {
      this.next = 9 + this.rnd() * 22;
      if (night < 0.55 && rain < 0.5 && this.flocks.length < 2) this.spawn();
    }
    const [x0, x1] = this.span;
    for (let fi = this.flocks.length - 1; fi >= 0; fi--) {
      const f = this.flocks[fi];
      const c = f.circle;
      if (!c) f.x += f.vx * dt;
      const gone = !c && (f.x < x0 - 80 || f.x > x1 + 80);
      for (const b of f.birds) {
        let x: number, y: number, flip = f.vx < 0;
        if (c) {
          const a = t * c.w + b.ph;
          x = c.cx + Math.cos(a) * c.r;
          y = c.cy + Math.sin(a) * c.r * 0.32 + Math.sin(t * 0.13 + b.ph) * 6;
          flip = Math.sin(a) > 0;
        } else {
          x = f.x + b.ox;
          y = f.y + b.oy + Math.sin(t * 0.6 + f.ph + b.ph * 0.3) * 5;
        }
        // Big birds mostly glide with a few slow beats; small ones beat fast with short glides.
        const beat = f.glide || c ? Math.sin(t * 0.5 + b.ph) > 0.35 : Math.sin(t * 0.9 + b.ph) > -0.6;
        const fr = beat ? Math.floor(((t * b.rate + b.ph) % 1) * 8) : 2;
        b.s.texture = this.frames[(fr + 8) % 8];
        b.s.position.set(x, y);
        b.s.scale.x = Math.abs(b.s.scale.x) * (flip ? -1 : 1);
        b.s.alpha = (1 - smoothstep(0.45, 0.7, night)) * (1 - 0.5 * rain);
        if (gone) b.s.visible = false;
      }
      if (gone) this.flocks.splice(fi, 1);
    }
    // Bats: quick, jinking loops around the entrance after dark.
    const batA = smoothstep(0.6, 0.85, night) * (1 - rain);
    for (const b of this.bats) {
      b.s.visible = batA > 0.01;
      if (!b.s.visible) continue;
      const p = t * 0.9 + b.ph;
      const x = this.batAt[0] + Math.sin(p) * 46 + Math.sin(p * 3.7) * 9;
      const y = this.batAt[1] + Math.sin(p * 1.6) * 16 + Math.cos(p * 4.3) * 6;
      b.s.texture = this.frames[Math.floor((t * b.rate + b.ph) % 8)];
      b.s.scale.set((Math.cos(p) > 0 ? 1 : -1) * 0.12, 0.1);
      b.s.position.set(x, y);
      b.s.alpha = batA * 0.9;
    }
  }
}

// ---------- Weather ----------

interface Drop { s: Sprite; x: number; y: number; v: number; ph: number }

export interface View { x0: number; x1: number; y0: number; y1: number }

/**
 * Rain (streaks that splash on the topsoil) and the first era's falling ash. Particles live only in the
 * visible part of the sky, so a few dozen sprites cover any zoom; nothing runs while the surface is off-screen.
 */
export class Weather {
  private drops: Drop[] = [];
  private ash: Drop[] = [];
  private splashes: { s: Sprite; age: number }[] = [];
  private seed = 9001;
  private ground: (x: number) => number;

  constructor(layer: Container, ground: (x: number) => number) {
    this.ground = ground;
    const rt = rainTexture(), st = splashTexture(), mt = moteTexture();
    for (let i = 0; i < 150; i++) {
      const s = new Sprite(rt);
      s.anchor.set(0.5, 1);
      s.visible = false;
      layer.addChild(s);
      this.drops.push({ s, x: 0, y: 0, v: 0, ph: 0 });
    }
    for (let i = 0; i < 90; i++) {
      const s = new Sprite(mt);
      s.anchor.set(0.5);
      s.visible = false;
      layer.addChild(s);
      this.ash.push({ s, x: 0, y: 0, v: 0, ph: 0 });
    }
    for (let i = 0; i < 24; i++) {
      const s = new Sprite(st);
      s.anchor.set(0.5, 0.7);
      s.visible = false;
      layer.addChild(s);
      this.splashes.push({ s, age: 0 });
    }
  }

  private rnd(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  /** `rain` and `ash` are 0..1 strengths; `cap` the particle budget of the quality level (0..1). */
  update(dt: number, t: number, view: View, wind: number, rain: number, ash: number, cap: number, light: number, dirty: boolean): void {
    const top = view.y0 - 20, bottom = Math.min(view.y1, 12);
    const onScreen = bottom > top + 10;
    const w = view.x1 - view.x0;
    // Rain leans with the wind; the drops spawn upwind so the slant still fills the view.
    const slant = 0.12 + wind * 0.18;
    const nRain = onScreen ? Math.round(this.drops.length * cap * rain) : 0;
    const len = Math.max(16, Math.min(34, w * 0.045));
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      if (i >= nRain) { d.s.visible = false; continue; }
      const fresh = !d.s.visible;
      if (fresh || d.y > this.ground(d.x) - 3 || d.y > bottom + 40 || d.x < view.x0 - 80 || d.x > view.x1 + 80) {
        if (!fresh && d.y > this.ground(d.x) - 3) this.splash(d.x, this.ground(d.x) - 3, light, dirty);
        d.s.visible = true;
        d.v = 380 + this.rnd() * 120;
        d.x = view.x0 - (bottom - top) * slant + this.rnd() * (w + (bottom - top) * slant);
        // A shower starting (or the view jumping) fills the whole column at once; later drops start above it.
        d.y = fresh ? top + this.rnd() * (bottom - top) : top - this.rnd() * 60;
      }
      d.y += d.v * dt;
      d.x += d.v * slant * dt;
      d.s.position.set(d.x, d.y);
      d.s.rotation = -Math.atan(slant);
      d.s.height = len;
      d.s.width = Math.max(1.2, len * 0.07);
      d.s.alpha = 0.5 * light;
      d.s.tint = dirty ? 0xc8bcac : 0xd8e2f0;
    }
    for (const s of this.splashes) {
      if (!s.s.visible) continue;
      s.age += dt;
      const k = s.age / 0.28;
      if (k >= 1) { s.s.visible = false; continue; }
      s.s.scale.set(0.25 + 0.35 * k, 0.25 + 0.2 * k);
      s.s.alpha = (1 - k) * 0.5 * light;
    }
    // Ash: slow grey flakes tumbling down and drifting with the wind.
    const nAsh = onScreen ? Math.round(this.ash.length * cap * ash) : 0;
    for (let i = 0; i < this.ash.length; i++) {
      const a = this.ash[i];
      if (i >= nAsh) { a.s.visible = false; continue; }
      if (!a.s.visible || a.y > this.ground(a.x) - 1 || a.x > view.x1 + 30 || a.x < view.x0 - 60) {
        const fresh = !a.s.visible;
        a.s.visible = true;
        a.v = 7 + this.rnd() * 9;
        a.ph = this.rnd() * 10;
        a.x = view.x0 - 40 + this.rnd() * (w + 50);
        a.y = fresh ? top + this.rnd() * (bottom - top) : top - this.rnd() * 30;
        const size = 1.1 + this.rnd() * 1.8;
        a.s.width = size;
        a.s.height = size * 0.75;
      }
      a.y += a.v * dt;
      a.x += (wind * 14 + Math.sin(t * 1.3 + a.ph) * 6) * dt;
      a.s.position.set(a.x, a.y);
      a.s.rotation = t * 1.7 + a.ph;
      a.s.alpha = 0.55 * light * smoothstep(top, top + 40, a.y);
      a.s.tint = 0xb8b0a8;
    }
  }

  private splash(x: number, y: number, light: number, dirty: boolean): void {
    if (this.rnd() > 0.55) return;
    let s: { s: Sprite; age: number } | null = null;
    for (const p of this.splashes) if (!p.s.visible) { s = p; break; }
    if (!s) return;
    s.s.visible = true;
    s.age = 0;
    s.s.position.set(x, y);
    s.s.tint = dirty ? 0xa89a88 : 0xd0dae6;
    s.s.alpha = 0.5 * light;
  }
}
