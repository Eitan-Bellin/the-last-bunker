import { Assets, Container, Rectangle, Sprite, Texture } from 'pixi.js';

/**
 * Graphics phase 1: pre-rendered 3D bodies for the people (see tools/people3d.ts for the pipeline).
 *
 * Each frame is four greyscale-shaded layers (trousers, shirt, skin, gear) that are tinted with the person's
 * outfit and skin colours, so one render serves every outfit; hair, beards, glasses, goggles, hats and the head
 * bandage are separate sprites placed at the frame's head anchor. Atlases load per body type on first use.
 *
 * Switch: `?people3d` turns the 3D bodies on, `?people2d` back to the vector rig (stored in localStorage).
 * Only used in the painted (gfx2) style.
 */

const FLAG_KEY = 'lastbunker_people3d';

function readFlag(): boolean {
  try {
    const p = new URLSearchParams(location.search);
    if (p.has('people3d')) localStorage.setItem(FLAG_KEY, '1');
    if (p.has('people2d')) localStorage.setItem(FLAG_KEY, '0');
    return localStorage.getItem(FLAG_KEY) !== '0';
  } catch {
    return true;
  }
}

export const PEOPLE3D = { on: readFlag() };

/** World units per metre (an adult man of 1.79 m stands ~48 units, the painted furniture's scale). */
export const UNITS_PER_M = 27;

export type BodyKind = 'man' | 'woman' | 'child' | 'elder';
export type Anim3 =
  | 'idle' | 'look' | 'sad' | 'hunch' | 'walk' | 'limp' | 'walkCarry' | 'carry' | 'water' | 'hammer' | 'wrench' | 'stir'
  | 'type' | 'inspect' | 'lift' | 'tend' | 'dig' | 'punch' | 'run' | 'dangle';

type Rect6 = [number, number, number, number, number, number];

interface MetaFrame { l: (Rect6 | 0)[]; h: [number, number, number] }
interface MetaAnim { fps: number; stride?: number; f: MetaFrame[] }
interface MetaBody { atlas: string; w: number; h: number; height: number; headRef: number; anims: Record<string, MetaAnim> }
interface Meta {
  ppm: number;
  bodies: Record<string, MetaBody>;
  attach: { atlas: string; items: Record<string, Record<string, number[]>> };
}

export interface Frame3 {
  tex: (Texture | null)[];
  off: [number, number][];
  head: [number, number, number];
}

export interface Anim3Data {
  fps: number;
  /** Metres covered per loop (walk cycles). */
  stride: number;
  frames: Frame3[];
}

export interface BodyData {
  kind: BodyKind;
  /** Standing height in pixels of the render. */
  height: number;
  headRef: number;
  anims: Record<string, Anim3Data>;
  attach: Record<string, { tex: Texture; ox: number; oy: number; tinted: boolean }>;
}

let meta: Meta | null = null;
let metaFailed = false;
let metaLoading: Promise<void> | null = null;
let attachTex: Texture | null = null;
let attachLoading: Promise<void> | null = null;
const bodies = new Map<BodyKind, BodyData>();
const loading = new Set<BodyKind>();

function url(path: string): string {
  return `${import.meta.env.BASE_URL}art/${path}`;
}

function loadMeta(): Promise<void> {
  metaLoading ??= fetch(url('people/people.json'))
    .then(r => (r.ok ? r.json() : Promise.reject(new Error('no people meta'))))
    .then((m: Meta) => { meta = m; })
    .catch(() => { metaFailed = true; });
  return metaLoading;
}

if (PEOPLE3D.on) void loadMeta();

/** Pixels per metre of the renders (0 until the meta has loaded). */
export function ppm(): number {
  return meta?.ppm ?? 0;
}

async function loadBody(kind: BodyKind): Promise<void> {
  await loadMeta();
  const m = meta;
  if (!m || !m.bodies[kind]) return;
  const mb = m.bodies[kind];
  attachLoading ??= Assets.load<Texture>({ src: url(m.attach.atlas), data: { autoGenerateMipmaps: true, scaleMode: 'linear' } }).then(t => { attachTex = t; });
  const [atlas] = await Promise.all([Assets.load<Texture>({ src: url(mb.atlas), data: { autoGenerateMipmaps: true, scaleMode: 'linear' } }), attachLoading]);
  const sub = (src: Texture, x: number, y: number, w: number, h: number) => new Texture({ source: src.source, frame: new Rectangle(x, y, w, h) });
  const anims: Record<string, Anim3Data> = {};
  for (const [name, a] of Object.entries(mb.anims)) {
    anims[name] = {
      fps: a.fps,
      stride: a.stride ?? 1,
      frames: a.f.map(f => ({
        tex: f.l.map(r => (r ? sub(atlas, r[0], r[1], r[2], r[3]) : null)),
        off: f.l.map(r => (r ? [r[4], r[5]] as [number, number] : [0, 0] as [number, number])),
        head: f.h,
      })),
    };
  }
  const attach: BodyData['attach'] = {};
  const items = m.attach.items[kind] ?? {};
  for (const [id, r] of Object.entries(items)) {
    if (r.length < 6 || !attachTex) continue;
    attach[id] = { tex: sub(attachTex, r[0], r[1], r[2], r[3]), ox: r[4], oy: r[5], tinted: r[6] === 1 };
  }
  bodies.set(kind, { kind, height: mb.height, headRef: mb.headRef, anims, attach });
}

/** The body's frames once loaded; starts loading on the first call. Null while loading or when the art is missing. */
export function bodyData(kind: BodyKind): BodyData | null {
  const b = bodies.get(kind);
  if (b) return b;
  if (!loading.has(kind) && !metaFailed) {
    loading.add(kind);
    void loadBody(kind).catch(() => { metaFailed = true; });
  }
  return null;
}

/** True when the 3D art is unavailable (missing files): callers keep the vector rig. */
export function people3dFailed(): boolean {
  return metaFailed;
}

/** Attachment slots, drawn over the body in this order. */
const SLOTS = ['hair', 'beard', 'eyes', 'bandage', 'hat'] as const;
type Slot = (typeof SLOTS)[number];

export interface Look3 {
  skin: number; top: number; bottom: number; hair: number; beard: number | null;
  hairStyle: string; glasses: boolean; goggles: boolean; hat: string | null; hatTint: number; hurt: boolean;
}

/**
 * A sprite body: four tinted layers plus head attachments. Lives inside the Person's figure container
 * (which handles facing, turning, lamp tint and shadows).
 */
export class Body3D {
  readonly container = new Container();
  private layers: Sprite[] = [];
  private headHolder = new Container();
  private slots: Record<Slot, Sprite>;
  private cur: Frame3 | null = null;

  readonly data: BodyData;

  constructor(data: BodyData) {
    this.data = data;
    for (let i = 0; i < 4; i++) {
      const s = new Sprite(Texture.EMPTY);
      this.layers.push(s);
      this.container.addChild(s);
    }
    this.slots = {} as Record<Slot, Sprite>;
    for (const k of SLOTS) {
      const s = new Sprite(Texture.EMPTY);
      s.visible = false;
      this.slots[k] = s;
      this.headHolder.addChild(s);
    }
    this.container.addChild(this.headHolder);
  }

  /** Clothes, skin and head gear (colours already muted by the caller). */
  dress(l: Look3): void {
    this.layers[0].tint = l.bottom;
    this.layers[1].tint = l.top;
    this.layers[2].tint = l.skin;
    this.layers[3].tint = 0xffffff;
    const hood = l.hat === 'hazmat';
    this.setSlot('hair', !hood && l.hairStyle !== 'bald' ? `hair-${l.hairStyle}` : null, l.hair);
    this.setSlot('beard', !hood && l.beard !== null ? 'beard' : null, l.beard ?? 0);
    this.setSlot('eyes', hood ? null : l.glasses ? 'glasses' : l.goggles ? 'goggles' : null, 0xffffff);
    this.setSlot('bandage', l.hurt && !l.hat ? 'bandage' : null, 0xffffff);
    this.setSlot('hat', l.hat ? `hat-${l.hat}` : null, l.hatTint);
  }

  private setSlot(slot: Slot, id: string | null, tint: number): void {
    const s = this.slots[slot];
    const a = id ? this.data.attach[id] : undefined;
    if (!a) {
      s.visible = false;
      return;
    }
    s.visible = true;
    s.texture = a.tex;
    s.position.set(a.ox, a.oy);
    s.tint = a.tinted ? tint : 0xffffff;
  }

  /** Shows frame `i` (wrapped) of an animation. Cheap when the frame is unchanged. */
  show(anim: Anim3, i: number): void {
    const a = this.data.anims[anim] ?? this.data.anims.idle;
    const n = a.frames.length;
    const f = a.frames[((i % n) + n) % n];
    if (f === this.cur) return;
    this.cur = f;
    for (let k = 0; k < 4; k++) {
      const s = this.layers[k];
      const t = f.tex[k];
      if (!t) {
        s.visible = false;
        continue;
      }
      s.visible = true;
      s.texture = t;
      s.position.set(f.off[k][0], f.off[k][1]);
    }
    this.headHolder.position.set(f.head[0], f.head[1]);
    this.headHolder.rotation = f.head[2] - this.data.headRef;
  }
}
