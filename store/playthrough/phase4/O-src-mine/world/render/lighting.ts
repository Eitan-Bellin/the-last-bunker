/**
 * The city's light: one screen-space lightmap and one additive glow layer (style guide section 4, architecture section 5).
 *
 * Per frame, before `app.render()`:
 *  1. `update()` culls the lights to the view through a grid of light cells (prototype C), ranks them (room lamps first, then the
 *     nearest to the view centre), keeps at most the tier's budget (LIGHT.budget) and fades lights in/out over LIGHT.budgetFade as they
 *     cross it, steps the flicker (only the kinds the tier animates), and places pooled sprites. Nothing is allocated.
 *  2. `render()` draws the off-stage `lightRoot` into the light texture (LIGHT.lightmap.scale of the screen):
 *     clear to the section fill -> stratum ambient bands (depth-graded darkness, cross-faded at the seams) -> the sky depth ramp ->
 *     room READABILITY FLOORS ('max' blend: a working room never drops below 0.70) -> the pools (additive, the one falloff curve).
 * The LightmapFilter on the lit group multiplies by that texture. The glow layer (halos, cones, lit dust motes) sits on stage above the
 * lit group; tease halos sit above the fog (FOG.teaseAlpha while their area is still dark).
 * Values in the light texture are stored at 1/LIGHTMAP_RENDER.gain so pools can overexpose without clipping.
 */
import { Container, NineSliceSprite, RenderTexture, Sprite, Texture, type Renderer } from 'pixi.js';
import {
  DAY_NIGHT, DETAIL, ERA_LIGHT, FOG, LIGHT, PEOPLE, STRATA, poolFalloff, roomFloorLight,
  type FlickerKind, type Hex, type LightPreset, type StratumId,
} from '../tokens';
import { FLICKER_MEAN, LIGHTMAP_RENDER, LOD, TIER_RENDER, baseTier, type RenderTier } from '../tokensRender';
import { LightmapFilter } from './LightmapFilter';
import type { CityLayout } from './layoutTypes';

export type PresetName = keyof typeof LIGHT.presets;
/** room: a painted room's lamp (first in the budget); spill: its corridor spill; civic: public lamps (era/night scaled); shell: structure lamps; carried: lanterns and headlamps; tease: a cold light beyond fog/rubble. */
export type LightKind = 'room' | 'spill' | 'civic' | 'shell' | 'carried' | 'tease';

export interface LightInput {
  x: number;
  y: number;
  preset: PresetName;
  color?: Hex;
  radius?: number;
  intensity?: number;
  flicker?: FlickerKind;
  halo?: number;
  cone?: number;
  kind?: LightKind;
  /** The fog area this light belongs to: it is dark while that area is hidden (teases still show at FOG.teaseAlpha). */
  area?: string;
  on?: boolean;
  /** Moves every frame (lanterns, headlamps): kept out of the cell grid. */
  dynamic?: boolean;
}

/** A painted room as the light sees it. */
export interface RoomLightInput {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  state: 'working' | 'idle' | 'building' | 'unpowered' | 'ruin';
  /** meta.json lamps (fractions of the painting) via ArtLibrary.lightsFor. */
  lamps?: readonly { x: number; y: number; r: number; color: number; flicker?: number }[];
  area?: string;
}

/** A plain readability floor (walkways, hub floor strips). */
export interface FloorRect { x: number; y: number; w: number; h: number; value: number }

/** What the lighting needs of the camera each frame (all world units except the screen size). */
export interface LightView {
  x0: number; y0: number; x1: number; y1: number;
  /** View centre (world). */
  cx: number; cy: number;
  zoom: number;
  /** worldContainer screen offset (wc.x, wc.y) and scale. */
  ox: number; oy: number;
  /** Screen size (CSS px) and renderer resolution. */
  sw: number; sh: number; res: number;
}

// ------------------------------------------------------------------------------------------------------------------------- textures

function canvas(w: number, h: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, ctx: c.getContext('2d')! };
}

function radial(size: number, profile: (d: number) => number): Texture {
  const { c, ctx } = canvas(size, size);
  const img = ctx.createImageData(size, size);
  const h = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - h, y + 0.5 - h) / h;
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(Math.max(0, Math.min(1, profile(d))) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return Texture.from(c);
}

let shared: { pool: Texture; halo: Texture; soft: Texture; cone: Texture; rect: Texture; ramp: Texture } | null = null;

/** The generated textures every city layer shares (made once; canvas-backed, so a restored GL context re-uploads them). */
export function cityTextures(): NonNullable<typeof shared> {
  if (shared) return shared;
  const R = LIGHTMAP_RENDER;
  const pool = radial(R.poolTex, d => (d >= 1 ? 0 : poolFalloff(d, 1)));
  const halo = radial(R.haloTex, d => (d >= 1 ? 0 : Math.pow(1 - d, R.haloExp)));
  const soft = radial(64, d => (d >= 1 ? 0 : Math.pow(1 - d, 1.2)));
  // Downward cone: bright narrow top, wide faint bottom.
  const [cw, ch] = R.coneTex;
  const cc = canvas(cw, ch);
  const ci = cc.ctx.createImageData(cw, ch);
  for (let y = 0; y < ch; y++) {
    const t = y / ch, half = 0.12 + 0.88 * t;
    for (let x = 0; x < cw; x++) {
      const u = (Math.abs((x + 0.5) / cw - 0.5) * 2) / half;
      const a = u >= 1 ? 0 : Math.pow(1 - u, 1 + LIGHT.cones.softEdge * 2) * Math.pow(1 - t, 1.4) * Math.min(1, t * 8);
      const i = (y * cw + x) * 4;
      ci.data[i] = ci.data[i + 1] = ci.data[i + 2] = 255;
      ci.data[i + 3] = Math.round(a * 255);
    }
  }
  cc.ctx.putImageData(ci, 0, 0);
  // Feathered rectangle for nine-slice fills: a linear ramp over `s` px on every side, a flat core.
  const s = R.softRectTex, n = s * 2 + 2;
  const rc = canvas(n, n);
  const ri = rc.ctx.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const ex = Math.min(x + 0.5, n - x - 0.5) / s, ey = Math.min(y + 0.5, n - y - 0.5) / s;
      const a = Math.min(1, ex) * Math.min(1, ey);
      const i = (y * n + x) * 4;
      ri.data[i] = ri.data[i + 1] = ri.data[i + 2] = 255;
      ri.data[i + 3] = Math.round(a * 255);
    }
  }
  rc.ctx.putImageData(ri, 0, 0);
  // Depth ramp (LIGHT.depthRamp): sky warmth near the surface fading to nothing by the last stop.
  const ramp = LIGHT.depthRamp, y0 = ramp[0].y, y1 = ramp[ramp.length - 1].y;
  const gc = canvas(4, 256);
  const grad = gc.ctx.createLinearGradient(0, 0, 0, 256);
  for (const st of ramp) {
    const a = st.a;
    grad.addColorStop((st.y - y0) / (y1 - y0), `rgba(${(st.color >> 16) & 255},${(st.color >> 8) & 255},${st.color & 255},${a})`);
  }
  gc.ctx.fillStyle = grad;
  gc.ctx.fillRect(0, 0, 4, 256);
  shared = { pool, halo, soft, cone: Texture.from(cc.c), rect: Texture.from(rc.c), ramp: Texture.from(gc.c) };
  return shared;
}

/** Feathered nine-slice rectangle (the feather is `f` world units, drawn inward from the given rect). */
export function softRect(f: number): NineSliceSprite {
  const s = LIGHTMAP_RENDER.softRectTex;
  const n = new NineSliceSprite({ texture: cityTextures().rect, leftWidth: s, rightWidth: s, topHeight: s, bottomHeight: s });
  placeSoftRect(n, 0, 0, f * 4, f * 4, f);
  return n;
}

/** Places a soft rect so its feather is `f` units and its outer edge is the given rectangle (no allocation). */
export function placeSoftRect(n: NineSliceSprite, x: number, y: number, w: number, h: number, f: number): void {
  const s = LIGHTMAP_RENDER.softRectTex;
  // A nine-slice keeps its borders at `s` local px: draw it in a space scaled by f/s so the border is f world units.
  const k = Math.max(0.001, Math.min(f, w / 2, h / 2)) / s;
  n.scale.set(k);
  n.width = Math.max(2 * s + 1, w / k);
  n.height = Math.max(2 * s + 1, h / k);
  n.x = x;
  n.y = y;
}

// ------------------------------------------------------------------------------------------------------------------------- helpers

/** Repeatable hash in [0, 1). */
export function hash01(a: number, b: number): number {
  let h = Math.imul((a | 0) + 0x9e3779b9, 374761393) ^ Math.imul((b | 0) + 7919, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function hexMul(c: Hex, k: number): Hex {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * k));
  const b = Math.min(255, Math.round((c & 255) * k));
  return (r << 16) | (g << 8) | b;
}

export function hexMix(a: Hex, b: Hex, t: number): Hex {
  const r = ((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * t);
  const g = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * t);
  const bl = (a & 255) + (((b & 255) - (a & 255)) * t);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

/** Stratum ambient as a light colour: the hue of `ambient` (normalised to its brightest channel) at `ambientLevel` strength. */
export function ambientLight(s: StratumId, era: number, night: number): Hex {
  const st = STRATA[s];
  const e = ERA_LIGHT[Math.max(0, Math.min(ERA_LIGHT.length - 1, era))];
  let level = st.light.ambientLevel;
  if (s === 0) level = DAY_NIGHT.surfaceAmbient.day + (DAY_NIGHT.surfaceAmbient.night - DAY_NIGHT.surfaceAmbient.day) * night;
  level *= e.ambientMul * LIGHTMAP_RENDER.ambientGain;
  const c = st.light.ambient;
  const m = LIGHTMAP_RENDER.ambientNormalize ? Math.max(1, (c >> 16) & 255, (c >> 8) & 255, c & 255) / 255 : 1;
  return hexMul(c, level / m);
}

// ------------------------------------------------------------------------------------------------------------------------- lights

interface Light {
  id: number;
  x: number;
  y: number;
  color: Hex;
  radius: number;
  intensity: number;
  flicker: FlickerKind;
  halo: number;
  cone: number;
  litMotes: boolean;
  kind: LightKind;
  area: string;
  on: boolean;
  dynamic: boolean;
  phase: number;
  /** Stratum gains (pool, glow) for where the light is. */
  poolGain: number;
  glowGain: number;
  fade: number;
  seen: number;
  score: number;
  cell: number;
  /** Civic lamps: lit share draws against this. */
  civicRoll: number;
}

interface Slot { pool: Sprite; halo: Sprite; tease: Sprite; cone: Sprite; light: Light | null }

interface Mote { s: Sprite; x: number; y: number; vx: number; vy: number; ph: number; size: number }

interface RoomFloor { n: NineSliceSprite; id: string; base: number; lift: number; x: number; y: number; w: number; h: number }

const byScore = (a: Light, b: Light): number => a.score - b.score;
const cellKey = (cx: number, cy: number): number => cx * 131071 + cy;

export class Lighting {
  /** Off-stage: rendered into `rt` each frame. */
  readonly lightRoot = new Container();
  /** On stage above the lit group: halos, cones, dust motes (additive). */
  readonly glowLayer = new Container();
  /** On stage above the fog: tease halos. */
  readonly teaseLayer = new Container();
  readonly filter: LightmapFilter;
  rt: RenderTexture;

  private world = new Container();
  private ambientC = new Container();
  private floorC = new Container();
  private poolC = new Container();
  private coneC = new Container();
  private haloC = new Container();
  private moteC = new Container();
  private ramp: Sprite;
  private bands: { n: NineSliceSprite; s: StratumId }[] = [];
  private clear = new Float32Array([0, 0, 0, 1]);

  private lights = new Map<number, Light>();
  private cells = new Map<number, Light[]>();
  private dyn: Light[] = [];
  private nextId = 1;
  private maxRadius = 0;
  private cand: Light[] = [];
  private slots: Slot[] = [];
  private used = 0;
  private frame = 0;
  private motes: Mote[] = [];
  private floors: RoomFloor[] = [];
  private floorCount = 0;
  private roomLights = new Map<string, number[]>();
  private selected: string | null = null;
  private hidden = new Set<string>();
  private dark = new Set<string>();
  private strata: { s: StratumId; y0: number; y1: number }[] = [];
  private era = 2;
  private night = 0;
  private tier: RenderTier = 'high';
  private animated = new Set<FlickerKind>();
  private ls = 0.5;
  private rtW = 1;
  private rtH = 1;
  private rw = 0;
  private lastRender = -1;
  private camSig = NaN;
  /** Stats for the lab and the perf probe. */
  readonly stats = { candidates: 0, drawn: 0, motes: 0, floors: 0 };

  constructor(tier: RenderTier) {
    const tx = cityTextures();
    this.lightRoot.addChild(this.world);
    this.world.addChild(this.ambientC, this.floorC, this.poolC);
    this.ramp = new Sprite(tx.ramp);
    this.ramp.blendMode = 'add';
    this.ambientC.addChild(this.ramp);
    this.glowLayer.addChild(this.coneC, this.haloC, this.moteC);
    for (const c of [this.glowLayer, this.teaseLayer]) c.eventMode = 'none';
    this.rt = RenderTexture.create({ width: 4, height: 4, resolution: 1 });
    this.filter = new LightmapFilter(this.rt);
    this.setTier(tier);
  }

  // ------------------------------------------------------------------ configuration

  setTier(tier: RenderTier): void {
    this.tier = tier;
    const bt = baseTier(tier);
    this.ls = LIGHT.lightmap.scale[bt];
    this.animated.clear();
    for (const k of LIGHT.flickerTiers[bt]) this.animated.add(k);
    const want = LIGHT.budget[bt] + LIGHTMAP_RENDER.fadeSlack;
    const tx = cityTextures();
    while (this.slots.length < want) {
      const pool = new Sprite(tx.pool), halo = new Sprite(tx.halo), tease = new Sprite(tx.halo), cone = new Sprite(tx.cone);
      pool.anchor.set(0.5);
      halo.anchor.set(0.5);
      tease.anchor.set(0.5);
      cone.anchor.set(0.5, 0);
      for (const s of [pool, halo, tease, cone]) {
        s.blendMode = 'add';
        s.visible = false;
      }
      this.poolC.addChild(pool);
      this.haloC.addChild(halo);
      this.teaseLayer.addChild(tease);
      this.coneC.addChild(cone);
      this.slots.push({ pool, halo, tease, cone, light: null });
    }
    const nm = TIER_RENDER[tier].glow ? DETAIL[bt].motes : 0;
    while (this.motes.length < nm) {
      const s = new Sprite(tx.soft);
      s.anchor.set(0.5);
      s.blendMode = 'add';
      s.visible = false;
      this.moteC.addChild(s);
      const i = this.motes.length;
      const [a, b] = LIGHT.motes.size;
      this.motes.push({ s, x: NaN, y: NaN, vx: 0, vy: 0, ph: hash01(i, 77) * 9, size: a + (b - a) * hash01(i, 78) });
    }
    for (let i = 0; i < this.motes.length; i++) this.motes[i].s.visible = i < nm && this.motes[i].s.visible;
    this.stats.motes = nm;
    this.glowLayer.visible = TIER_RENDER[tier].glow;
    this.camSig = NaN;
  }

  /** Strata bands (depth-graded darkness) and the depth ramp, from the layout. */
  setLayout(layout: CityLayout): void {
    this.strata = layout.strata.slice().sort((a, b) => a.y0 - b.y0);
    for (const b of this.bands) b.n.destroy();
    this.bands = [];
    const B = layout.bounds, pad = Math.max(B.w, B.h) + 4000;
    const f = LIGHTMAP_RENDER.seamFeather;
    for (let i = 0; i < this.strata.length; i++) {
      const st = this.strata[i];
      const n = softRect(f);
      n.blendMode = 'add';
      // Bands overlap by the feather so neighbouring strata cross-fade; the outermost bands run on past the bounds.
      const top = i === 0 ? B.y - pad : st.y0 - f / 2;
      const bot = i === this.strata.length - 1 ? B.y + B.h + pad : st.y1 + f / 2;
      placeSoftRect(n, B.x - pad, top, B.w + pad * 2, bot - top, f);
      this.ambientC.addChildAt(n, 0);
      this.bands.push({ n, s: st.s });
    }
    const r = LIGHT.depthRamp;
    const ground = this.strata.find(st => st.s === 1)?.y0 ?? 0;
    this.ramp.x = B.x - pad;
    this.ramp.y = ground + r[0].y;
    this.ramp.width = B.w + pad * 2;
    this.ramp.height = r[r.length - 1].y - r[0].y;
    this.applyAmbient();
    for (const L of this.lights.values()) this.gainsFor(L);
  }

  setEra(era: number, night = this.night): void {
    this.era = era;
    this.night = night;
    this.applyAmbient();
  }

  private applyAmbient(): void {
    const enc = 1 / LIGHTMAP_RENDER.gain;
    for (const b of this.bands) b.n.tint = hexMul(ambientLight(b.s, this.era, this.night), enc);
    this.ramp.alpha = enc * LIGHTMAP_RENDER.depthRampGain * (1 - this.night * (1 - DAY_NIGHT.surfaceAmbient.night / DAY_NIGHT.surfaceAmbient.day));
    const sf = LIGHT.sectionFill;
    this.clear[0] = (((sf.color >> 16) & 255) / 255) * sf.a * enc;
    this.clear[1] = (((sf.color >> 8) & 255) / 255) * sf.a * enc;
    this.clear[2] = ((sf.color & 255) / 255) * sf.a * enc;
  }

  /** Areas whose lights are dark (hidden fog) and areas that are not yet lit (glimpsed: teases still show at FOG.teaseAlpha). */
  setAreaVisibility(hidden: Iterable<string>, dark: Iterable<string>): void {
    this.hidden.clear();
    for (const a of hidden) this.hidden.add(a);
    this.dark.clear();
    for (const a of dark) this.dark.add(a);
  }

  private stratumAt(y: number): StratumId {
    const s = this.strata;
    for (let i = 0; i < s.length; i++) if (y < s[i].y1) return s[i].s;
    return s.length ? s[s.length - 1].s : 1;
  }

  private gainsFor(L: Light): void {
    const st = STRATA[this.stratumAt(L.y)].light;
    L.poolGain = st.poolGain;
    L.glowGain = st.glowGain;
  }

  // ------------------------------------------------------------------ lights

  add(input: LightInput): number {
    const p: LightPreset = LIGHT.presets[input.preset];
    const id = this.nextId++;
    const L: Light = {
      id, x: input.x, y: input.y, color: input.color ?? p.color, radius: input.radius ?? p.radius, intensity: input.intensity ?? p.intensity,
      flicker: input.flicker ?? p.flicker, halo: input.halo ?? p.halo, cone: input.cone ?? p.cone, litMotes: p.litMotes, kind: input.kind ?? 'shell',
      area: input.area ?? '', on: input.on ?? true, dynamic: !!input.dynamic, phase: hash01(id, 3) * 100, poolGain: 1, glowGain: 1,
      fade: 0, seen: -9, score: 0, cell: 0, civicRoll: hash01(id, 11),
    };
    this.gainsFor(L);
    this.lights.set(id, L);
    if (L.dynamic) this.dyn.push(L);
    else this.toCell(L);
    if (L.radius > this.maxRadius) this.maxRadius = L.radius;
    return id;
  }

  remove(id: number): void {
    const L = this.lights.get(id);
    if (!L) return;
    this.lights.delete(id);
    if (L.dynamic) this.dyn.splice(this.dyn.indexOf(L), 1);
    else this.fromCell(L);
  }

  /** Moves a light (dynamic lights every frame; static ones are re-bucketed). */
  move(id: number, x: number, y: number): void {
    const L = this.lights.get(id);
    if (!L) return;
    if (L.dynamic) {
      L.x = x;
      L.y = y;
      return;
    }
    this.fromCell(L);
    L.x = x;
    L.y = y;
    this.toCell(L);
    this.gainsFor(L);
  }

  setOn(id: number, on: boolean): void {
    const L = this.lights.get(id);
    if (L) L.on = on;
  }

  private toCell(L: Light): void {
    const c = LIGHTMAP_RENDER.cell;
    L.cell = cellKey(Math.floor(L.x / c), Math.floor(L.y / c));
    let list = this.cells.get(L.cell);
    if (!list) this.cells.set(L.cell, (list = []));
    list.push(L);
  }

  private fromCell(L: Light): void {
    const list = this.cells.get(L.cell);
    if (!list) return;
    const i = list.indexOf(L);
    if (i >= 0) list.splice(i, 1);
  }

  get count(): number {
    return this.lights.size;
  }

  // ------------------------------------------------------------------ rooms (readability floors + painted lamps)

  /**
   * The painted rooms. Each gets a feathered floor at its readability value (LIGHT.read) and real pools from its meta.json lamps
   * (plus the main lamp's corridor spill at LIGHT.roomSpill). Unpowered rooms keep their floor at 0.30 and get one emergency lamp.
   * Call when the rooms change (not every frame); `extra` are plain floors (walkways, the hub floor).
   */
  setRooms(rooms: readonly RoomLightInput[], extra: readonly FloorRect[] = []): void {
    for (const ids of this.roomLights.values()) for (const id of ids) this.remove(id);
    this.roomLights.clear();
    let n = 0;
    const f = LIGHT.read.edgeFeather;
    const need = rooms.length + extra.length;
    while (this.floors.length < need) {
      const s = softRect(f);
      s.blendMode = 'max';
      this.floorC.addChild(s);
      this.floors.push({ n: s, id: '', base: 0, lift: 0, x: 0, y: 0, w: 0, h: 0 });
    }
    const put = (id: string, x: number, y: number, w: number, h: number, v: number): void => {
      const fl = this.floors[n++];
      fl.id = id;
      fl.base = v;
      fl.lift = id && id === this.selected ? LIGHT.read.selectedLift : 0;
      fl.x = x; fl.y = y; fl.w = w; fl.h = h;
      placeSoftRect(fl.n, x - f, y - f, w + f * 2, h + f * 2, f);
      fl.n.visible = true;
      fl.n.tint = hexMul(0xffffff, Math.min(1, fl.base + fl.lift) / LIGHTMAP_RENDER.gain);
    };
    const R = LIGHTMAP_RENDER;
    for (const r of rooms) {
      put(r.id, r.x, r.y, r.w, r.h, roomFloorLight(r.state));
      const ids: number[] = [];
      const powered = r.state !== 'unpowered' && r.state !== 'ruin';
      if (powered && r.lamps) {
        let main = -1, mainR = -1;
        for (let i = 0; i < r.lamps.length; i++) {
          const sp = r.lamps[i];
          const p = LIGHT.presets.roomLamp;
          const radius = p.radius * Math.max(R.roomLampMinFrac, Math.min(1, sp.r / R.roomLampRefR));
          ids.push(this.add({
            x: r.x + sp.x * r.w, y: r.y + sp.y * r.h, preset: 'roomLamp', color: sp.color, radius, kind: 'room', area: r.area,
            intensity: p.intensity * R.roomLampGain,
          }));
          if (sp.r > mainR) { mainR = sp.r; main = i; }
        }
        if (main >= 0) {
          const sp = r.lamps[main];
          ids.push(this.add({
            x: r.x + sp.x * r.w, y: r.y + r.h + R.roomSpillDy, preset: 'roomLamp', color: sp.color, kind: 'spill', area: r.area,
            intensity: LIGHT.presets.roomLamp.intensity * LIGHT.roomSpill, halo: 0,
          }));
        }
      } else if (r.state === 'unpowered') {
        ids.push(this.add({ x: r.x + r.w / 2, y: r.y + 10, preset: 'emergency', kind: 'room', area: r.area }));
      }
      this.roomLights.set(r.id, ids);
    }
    for (const e of extra) put('', e.x, e.y, e.w, e.h, e.value);
    for (let i = n; i < this.floorCount; i++) this.floors[i].n.visible = false;
    this.floorCount = n;
    this.stats.floors = n;
    this.camSig = NaN;
  }

  /** The selected room (or the one placement is next to) gets LIGHT.read.selectedLift, eased in update(). */
  select(id: string | null): void {
    this.selected = id;
  }

  // ------------------------------------------------------------------ per frame

  // Culling query of the current frame (fields, so the per-light test allocates no closure).
  private qx0 = 0; private qy0 = 0; private qx1 = 0; private qy1 = 0; private qcx = 0; private qcy = 0; private qCivic = 1; private qn = 0;

  private consider(L: Light): void {
    if (!L.on || (L.area && this.hidden.has(L.area) && L.kind !== 'tease')) return;
    if (L.kind === 'civic' && L.civicRoll >= this.qCivic) return;
    const r = L.radius;
    if (L.x + r < this.qx0 || L.x - r > this.qx1 || L.y + r < this.qy0 || L.y - r > this.qy1) return;
    const dx = L.x - this.qcx, dy = L.y - this.qcy;
    L.score = (L.kind === 'room' ? 0 : 1e9) + dx * dx + dy * dy;
    this.cand[this.qn++] = L;
  }

  private flick(L: Light, t: number): number {
    this.rw = 0;
    const kind = L.flicker;
    if (kind === 'steady') return 1;
    const F = LIGHT.flicker[kind];
    if (!this.animated.has(kind)) return FLICKER_MEAN[kind];
    const ph = L.phase, w = Math.PI * 2 * F.hz;
    switch (kind) {
      case 'fire': {
        const n = Math.sin(t * w + ph) * 0.5 + Math.sin(t * w * 2.3 + ph * 2) * 0.3 + Math.sin(t * w * 0.37 + ph) * 0.2;
        this.rw = F.radiusWobble * n;
        return 1 - F.amp * (0.5 + 0.5 * n);
      }
      case 'failingTube': {
        const slot = Math.floor(t / F.eventLen);
        const out = hash01(slot, L.id) < F.events * F.eventLen;
        return out ? 0.08 : 1 - F.amp * (0.5 + 0.5 * Math.sin(t * w + ph));
      }
      case 'pulse':
      case 'sway': {
        const s = Math.sin(t * w + ph);
        this.rw = F.radiusWobble * s;
        return 1 + F.amp * s;
      }
      case 'blink':
        return Math.sin(t * w + ph) > 0 ? 1 : 1 - F.amp;
      case 'tv': {
        const cut = hash01(Math.floor(t / F.eventLen), L.id) < F.events * F.eventLen;
        return cut ? 0.2 : 1 - F.amp * (0.5 + 0.5 * Math.sin(t * w + ph));
      }
      case 'weld': {
        const on = hash01(Math.floor(t / F.eventLen), L.id) < F.events * F.eventLen * 1.6;
        if (!on) return 0;
        this.rw = F.radiusWobble * Math.sin(t * w * 1.7 + ph);
        return 1 - F.amp * (0.5 + 0.5 * Math.sin(t * w + ph));
      }
      default:
        return 1;
    }
  }

  /** Culls, ranks, flickers and places the pools and glows. `conesOn` is false at map-ish zooms. */
  update(v: LightView, t: number, dt: number): void {
    this.frame++;
    const bt = baseTier(this.tier);
    const budget = LIGHT.budget[bt];
    const cell = LIGHTMAP_RENDER.cell, R = this.maxRadius;
    const x0 = v.x0, y0 = v.y0, x1 = v.x1, y1 = v.y1;
    const cand = this.cand;
    const ev = ERA_LIGHT[Math.max(0, Math.min(ERA_LIGHT.length - 1, this.era))];
    this.qx0 = x0; this.qy0 = y0; this.qx1 = x1; this.qy1 = y1; this.qcx = v.cx; this.qcy = v.cy; this.qCivic = ev.civicLampsLit;
    this.qn = 0;
    const civicK = 1 - this.night * (1 - DAY_NIGHT.civicNight);
    const cx0 = Math.floor((x0 - R) / cell), cx1 = Math.floor((x1 + R) / cell);
    const cy0 = Math.floor((y0 - R) / cell), cy1 = Math.floor((y1 + R) / cell);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const list = this.cells.get(cellKey(cx, cy));
        if (list) for (let i = 0; i < list.length; i++) this.consider(list[i]);
      }
    }
    for (let i = 0; i < this.dyn.length; i++) this.consider(this.dyn[i]);
    const n = this.qn;
    cand.length = n;
    cand.sort(byScore);
    this.stats.candidates = n;

    const fadeStep = dt / LIGHT.budgetFade;
    const enc = 1 / LIGHTMAP_RENDER.gain;
    const conesOn = DETAIL[bt].cones && v.zoom >= LOD.conesMinZoom;
    const glowOn = TIER_RENDER[this.tier].glow;
    const gl = LIGHT.lightmap.glow, ca = LIGHT.cones.alpha;
    let s = 0;
    for (let i = 0; i < n && s < this.slots.length; i++) {
      const L = cand[i];
      const target = i < budget ? 1 : 0;
      if (L.seen !== this.frame - 1) L.fade = target;
      else L.fade = target > L.fade ? Math.min(1, L.fade + fadeStep) : Math.max(0, L.fade - fadeStep);
      L.seen = this.frame;
      if (L.fade <= 0.001) continue;
      let k = this.flick(L, t) * L.fade;
      if (L.kind === 'civic') k *= civicK;
      const rr = L.radius * (1 + this.rw);
      const slot = this.slots[s++];
      slot.light = L;
      const pool = slot.pool;
      pool.visible = k > 0.002;
      pool.x = L.x;
      pool.y = L.y;
      pool.width = pool.height = rr * 2;
      pool.tint = L.color;
      pool.alpha = Math.min(1, L.intensity * L.poolGain * LIGHT.intensity * k * enc);
      const tease = L.kind === 'tease';
      const ha = Math.min(1, gl * L.glowGain * L.intensity * k);
      const hs = L.halo * rr;
      const halo = tease ? slot.tease : slot.halo;
      (tease ? slot.halo : slot.tease).visible = false;
      halo.visible = glowOn && hs > 0 && ha > 0.004;
      if (halo.visible) {
        halo.x = L.x;
        halo.y = L.y;
        halo.width = halo.height = hs;
        halo.tint = L.color;
        halo.alpha = tease && L.area && (this.hidden.has(L.area) || this.dark.has(L.area)) ? ha * FOG.teaseAlpha : ha;
      }
      const cone = slot.cone;
      cone.visible = glowOn && conesOn && L.cone > 0 && k > 0.01;
      if (cone.visible) {
        cone.x = L.x;
        cone.y = L.y;
        cone.height = L.cone;
        cone.width = L.cone * 0.9;
        cone.tint = L.color;
        cone.alpha = ca * Math.min(1.2, k);
      }
    }
    for (let i = s; i < this.used; i++) {
      const sl = this.slots[i];
      sl.pool.visible = sl.halo.visible = sl.tease.visible = sl.cone.visible = false;
      sl.light = null;
    }
    this.used = s;
    this.stats.drawn = s;

    // Readability floors: the selected room eases its lift in.
    const sel = this.selected, liftStep = dt / 0.2;
    for (let i = 0; i < this.floorCount; i++) {
      const fl = this.floors[i];
      const want = fl.id && fl.id === sel ? LIGHT.read.selectedLift : 0;
      if (fl.lift !== want) {
        fl.lift = want > fl.lift ? Math.min(want, fl.lift + liftStep * LIGHT.read.selectedLift) : Math.max(want, fl.lift - liftStep * LIGHT.read.selectedLift);
        fl.n.tint = hexMul(0xffffff, Math.min(1, fl.base + fl.lift) * enc);
      }
    }

    if (glowOn) this.updateMotes(v, t, dt);

    // Lightmap transform follows the camera, at the lightmap's scale.
    const ls = this.ls;
    this.world.scale.set(v.zoom * ls);
    this.world.position.set(v.ox * ls, v.oy * ls);
    const w = Math.max(1, Math.ceil(v.sw * ls)), h = Math.max(1, Math.ceil(v.sh * ls));
    if (w !== this.rtW || h !== this.rtH) this.resizeTarget(v.sw, v.sh);
    this.filter.res = v.res;
  }

  private updateMotes(v: LightView, t: number, dt: number): void {
    const M = LIGHT.motes;
    const w = v.x1 - v.x0, h = v.y1 - v.y0;
    const slots = this.slots;
    for (let i = 0; i < this.motes.length; i++) {
      const m = this.motes[i];
      if (!m.s.parent || i >= this.stats.motes) break;
      if (!(m.x >= v.x0 && m.x <= v.x1 && m.y >= v.y0 && m.y <= v.y1)) {
        // Respawn somewhere in the view (repeatable per mote and respawn).
        const k = Math.floor(t * 0.37 + i * 1.7);
        m.x = v.x0 + hash01(i, k) * w;
        m.y = v.y0 + hash01(k, i + 999) * h;
        m.vx = (hash01(i, k + 5) - 0.5) * M.drift * 2;
        m.vy = -M.rise * (0.4 + hash01(i, k + 6));
      }
      m.x += (m.vx + Math.sin(t * 0.4 + m.ph) * M.drift * 0.5) * dt;
      m.y += (m.vy + Math.cos(t * 0.3 + m.ph) * M.drift * 0.3) * dt;
      // Lit by the lamps it floats through: strongest pool's colour, summed light.
      let sum = 0, best = 0, col: Hex = 0xffffff;
      for (let j = 0; j < this.used; j++) {
        const L = slots[j].light;
        if (!L || !L.litMotes) continue;
        const dx = m.x - L.x, dy = m.y - L.y, r = L.radius;
        if (dx > r || dx < -r || dy > r || dy < -r) continue;
        const f = poolFalloff(Math.sqrt(dx * dx + dy * dy), r) * L.intensity * L.fade;
        sum += f;
        if (f > best) { best = f; col = L.color; }
      }
      const a = M.alpha * Math.min(1, sum) * (0.5 + 0.5 * Math.abs(Math.sin(t * 0.7 + m.ph)));
      m.s.visible = a > 0.01;
      if (!m.s.visible) continue;
      m.s.x = m.x;
      m.s.y = m.y;
      m.s.width = m.s.height = m.size * 2.5;
      m.s.tint = col;
      m.s.alpha = a;
    }
  }

  /** Light texture sized to the screen at the tier's scale (and after a context restore). */
  resizeTarget(sw: number, sh: number): void {
    const w = Math.max(1, Math.ceil(sw * this.ls)), h = Math.max(1, Math.ceil(sh * this.ls));
    const old = this.rt;
    this.rt = RenderTexture.create({ width: w, height: h, resolution: 1, antialias: false });
    this.rtW = w;
    this.rtH = h;
    this.filter.setLight(this.rt, sw * this.ls, sh * this.ls);
    old.destroy(true);
    this.camSig = NaN;
  }

  /**
   * Draws the light texture. Low redraws at most LIGHT.lightmap.lowMaxHz times a second unless the camera moved (the texture is in
   * screen space, so a moved camera always needs a new one).
   */
  render(renderer: Renderer, t: number, force = false): void {
    if (!TIER_RENDER[this.tier].lightmap) return;
    const sig = this.world.x * 7.31 + this.world.y * 3.17 + this.world.scale.x * 1013;
    const low = baseTier(this.tier) === 'low';
    if (!force && low && sig === this.camSig && t - this.lastRender < 1 / LIGHT.lightmap.lowMaxHz) return;
    this.camSig = sig;
    this.lastRender = t;
    renderer.render({ container: this.lightRoot, target: this.rt, clear: true, clearColor: this.clear as unknown as number[] });
  }

  /** Approximate light (0..~gain) at a world point from the pools drawn this frame (people's minimum light, rim choice). */
  lightAt(x: number, y: number): number {
    let sum = 0;
    for (let j = 0; j < this.used; j++) {
      const L = this.slots[j].light;
      if (!L) continue;
      const dx = x - L.x, dy = y - L.y;
      sum += poolFalloff(Math.sqrt(dx * dx + dy * dy), L.radius) * L.intensity * L.fade;
    }
    return Math.max(sum, PEOPLE.minLight);
  }

  destroy(): void {
    this.rt.destroy(true);
    this.lightRoot.destroy({ children: true });
    this.glowLayer.destroy({ children: true });
    this.teaseLayer.destroy({ children: true });
    this.filter.destroy();
  }
}

