import { Assets, Container, Rectangle, Sprite, Texture } from 'pixi.js';
import { HEAD_SCALE, faceTexture, type FaceMood } from './faces';

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
  | 'type' | 'inspect' | 'lift' | 'tend' | 'dig' | 'punch' | 'run' | 'dangle'
  // Plan 2026-10 M3: the set poses (their own atlases, loaded on demand)
  | 'sit' | 'sitTalk' | 'eat' | 'sleep' | 'talk';

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

/** The animations of one atlas (frames cut out of it as sub-textures). */
function buildAnims(atlas: Texture, mb: MetaBody): Record<string, Anim3Data> {
  const anims: Record<string, Anim3Data> = {};
  for (const [name, a] of Object.entries(mb.anims)) {
    anims[name] = {
      fps: a.fps,
      stride: a.stride ?? 1,
      frames: a.f.map(f => ({
        tex: f.l.map(r => (r ? new Texture({ source: atlas.source, frame: new Rectangle(r[0], r[1], r[2], r[3]) }) : null)),
        off: f.l.map(r => (r ? [r[4], r[5]] as [number, number] : [0, 0] as [number, number])),
        head: f.h,
      })),
    };
  }
  return anims;
}

// --- Plan 2026-10 M3: the set poses (sit, sitTalk, eat, sleep, talk) live in their own small atlases, loaded on demand ---
let setMeta: { bodies: Record<string, MetaBody> } | null | undefined;
const setLoading = new Set<BodyKind>();
const setReady = new Set<BodyKind>();

/** True once the body has its set poses (sit, eat, sleep, talk). */
export function hasSetPoses(kind: BodyKind): boolean {
  return setReady.has(kind);
}

/** Starts loading the set poses of a body type (a few hundred KB, ~2 MB of texture memory); no-op when loaded or loading. */
export function requestSetPoses(kind: BodyKind): void {
  if (setReady.has(kind) || setLoading.has(kind) || setMeta === null) return;
  setLoading.add(kind);
  void (async () => {
    try {
      if (setMeta === undefined) {
        const r = await fetch(url('people/people-set.json'));
        setMeta = r.ok ? await r.json() : null;
      }
      const mb = setMeta?.bodies[kind];
      const body = bodies.get(kind);
      if (!mb || !body) return;
      const atlas = await Assets.load<Texture>({ src: url(mb.atlas), data: { autoGenerateMipmaps: true, scaleMode: 'linear' } });
      Object.assign(body.anims, buildAnims(atlas, mb));
      setReady.add(kind);
    } catch {
      setMeta = null; // missing art: people simply keep standing
    } finally {
      setLoading.delete(kind);
    }
  })();
}

async function loadBody(kind: BodyKind): Promise<void> {
  await loadMeta();
  const m = meta;
  if (!m || !m.bodies[kind]) return;
  const mb = m.bodies[kind];
  attachLoading ??= Assets.load<Texture>({ src: url(m.attach.atlas), data: { autoGenerateMipmaps: true, scaleMode: 'linear' } }).then(t => { attachTex = t; });
  const [atlas] = await Promise.all([Assets.load<Texture>({ src: url(mb.atlas), data: { autoGenerateMipmaps: true, scaleMode: 'linear' } }), attachLoading]);
  const sub = (src: Texture, x: number, y: number, w: number, h: number) => new Texture({ source: src.source, frame: new Rectangle(x, y, w, h) });
  const anims = buildAnims(atlas, mb);
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

/** Cross-fade length between two animations (plan 2026-10 Q1). */
const FADE_S = 0.16;

/** A frozen copy of the sprites on screen (the pose being faded out), built on the first transition. */
interface Ghost {
  container: Container;
  layers: Sprite[];
  headHolder: Container;
  slots: Sprite[];
}

/**
 * A sprite body: four tinted layers plus head attachments. Lives inside the Person's figure container
 * (which handles facing, turning, lamp tint and shadows).
 *
 * Plan 2026-10: when the animation changes (or the person turns) the previous pose stays behind as a ghost that fades out
 * over `FADE_S` while the new one fades in, so poses no longer jump; and a black copy of the body can be drawn for the
 * shadow on the back wall (`shadow`, same textures, no extra atlas memory).
 */
export class Body3D {
  readonly container = new Container();
  private layers: Sprite[] = [];
  private headHolder = new Container();
  private slots: Record<Slot, Sprite>;
  /** Plan 2026-10 M4: the eyes, brows and mouth overlay (under the hair and hats). */
  private face = new Sprite(Texture.EMPTY);
  private faceMood: FaceMood = 'neutral';
  private faceClosed = false;
  private cur: Frame3 | null = null;
  private curAnim = '';
  private ghost: Ghost | null = null;
  private fade = 1;
  /** The shadow copy (black layers + hair), parented by the Person; null until asked for. */
  private shadowSet: { container: Container; layers: Sprite[]; head: Container; hair: Sprite } | null = null;

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
    this.face.anchor.set(0.5);
    this.headHolder.addChildAt(this.face, 0);
    this.container.addChild(this.headHolder);
    this.setFace('neutral', false);
  }

  /** The face overlay: a mood and eyes open or closed (cheap when unchanged). */
  setFace(mood: FaceMood, closed: boolean): void {
    if (mood === this.faceMood && closed === this.faceClosed && this.face.texture !== Texture.EMPTY) return;
    this.faceMood = mood;
    this.faceClosed = closed;
    this.face.texture = faceTexture(mood, closed);
    this.face.scale.set(HEAD_SCALE[this.data.kind] / 4);
  }

  /** Clothes, skin and head gear (colours already muted by the caller). */
  dress(l: Look3): void {
    this.layers[0].tint = l.bottom;
    this.layers[1].tint = l.top;
    this.layers[2].tint = l.skin;
    this.layers[3].tint = 0xffffff;
    const hood = l.hat === 'hazmat';
    this.face.visible = !hood;
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

  /**
   * Shows frame `i` (wrapped) of an animation. Cheap when the frame is unchanged. A change of animation starts a
   * cross-fade from the pose on screen when `fade` is set.
   */
  show(anim: Anim3, i: number, fade = false): void {
    const a = this.data.anims[anim] ?? this.data.anims.idle;
    const n = a.frames.length;
    const f = a.frames[((i % n) + n) % n];
    if (f === this.cur) return;
    // (a turn that already started this frame's fade keeps its mirrored ghost)
    if (fade && this.cur && anim !== this.curAnim && this.fade >= 1) this.startFade(false);
    this.curAnim = anim;
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
    if (this.shadowSet) this.syncShadow();
  }

  /** Freezes what is on screen as a ghost and fades it out (mirrored when the figure has just turned around). */
  startFade(mirror: boolean): void {
    const g = (this.ghost ??= this.makeGhost());
    for (let k = 0; k < 4; k++) {
      const src = this.layers[k], dst = g.layers[k];
      dst.visible = src.visible;
      dst.texture = src.texture;
      dst.position.copyFrom(src.position);
      dst.tint = src.tint;
    }
    g.headHolder.position.copyFrom(this.headHolder.position);
    g.headHolder.rotation = this.headHolder.rotation;
    SLOTS.forEach((k, j) => {
      const src = this.slots[k], dst = g.slots[j];
      dst.visible = src.visible;
      dst.texture = src.texture;
      dst.position.copyFrom(src.position);
      dst.tint = src.tint;
    });
    g.container.scale.x = mirror ? -1 : 1;
    g.container.visible = true;
    g.container.alpha = 1;
    this.fade = 0;
  }

  private makeGhost(): Ghost {
    const container = new Container();
    const layers: Sprite[] = [];
    for (let i = 0; i < 4; i++) {
      const s = new Sprite(Texture.EMPTY);
      layers.push(s);
      container.addChild(s);
    }
    const headHolder = new Container();
    const slots = SLOTS.map(() => {
      const s = new Sprite(Texture.EMPTY);
      s.visible = false;
      headHolder.addChild(s);
      return s;
    });
    container.addChild(headHolder);
    container.visible = false;
    // Under the live body, so the new pose settles over the fading old one.
    this.container.addChildAt(container, 0);
    return { container, layers, headHolder, slots };
  }

  /** Advances the cross-fade (call once a frame). */
  step(dt: number): void {
    if (this.fade >= 1) return;
    this.fade = Math.min(1, this.fade + dt / FADE_S);
    const a = this.fade * this.fade * (3 - 2 * this.fade);
    if (this.ghost) {
      this.ghost.container.alpha = 1 - a;
      if (this.fade >= 1) this.ghost.container.visible = false;
    }
    // The new pose arrives in the first half so the two never add up to less than a body.
    const m = this.fade >= 1 ? 1 : Math.min(1, a * 2);
    for (const s of this.layers) s.alpha = m;
    this.headHolder.alpha = m;
  }

  /** The black copy of the body for the back wall's shadow (hidden when `on` is false); parent it where it should be drawn. */
  shadow(on: boolean): Container | null {
    if (!on) {
      if (this.shadowSet) this.shadowSet.container.visible = false;
      return this.shadowSet?.container ?? null;
    }
    if (!this.shadowSet) {
      const container = new Container();
      const layers: Sprite[] = [];
      for (let i = 0; i < 4; i++) {
        const s = new Sprite(Texture.EMPTY);
        s.tint = 0x000000;
        layers.push(s);
        container.addChild(s);
      }
      const head = new Container();
      const hair = new Sprite(Texture.EMPTY);
      hair.tint = 0x000000;
      hair.visible = false;
      head.addChild(hair);
      container.addChild(head);
      this.shadowSet = { container, layers, head, hair };
      this.syncShadow();
    }
    this.shadowSet.container.visible = true;
    return this.shadowSet.container;
  }

  private syncShadow(): void {
    const sh = this.shadowSet;
    if (!sh) return;
    for (let k = 0; k < 4; k++) {
      const src = this.layers[k], dst = sh.layers[k];
      dst.visible = src.visible;
      dst.texture = src.texture;
      dst.position.copyFrom(src.position);
    }
    sh.head.position.copyFrom(this.headHolder.position);
    sh.head.rotation = this.headHolder.rotation;
    const hair = this.slots.hair;
    sh.hair.visible = hair.visible;
    sh.hair.texture = hair.texture;
    sh.hair.position.copyFrom(hair.position);
  }
}
