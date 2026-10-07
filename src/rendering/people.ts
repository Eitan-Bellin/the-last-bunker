import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { BuildingType, SurvivorState } from '../core/GameState';
import { portraitFor, type PortraitDef } from '../data/portraits';
import { hashString, shade } from './draw';
import { ROOM_H } from './layout';
import type { Crowd, CrowdMember, Rest, Spot } from './workSpots';
import { Body3D, PEOPLE3D, UNITS_PER_M, bodyData, hasSetPoses, ppm, requestSetPoses, type Anim3, type BodyKind } from './people3d';
import { GFX } from './gfxFeatures';
import { SlopArea } from './HitSlop'; // [plan4:ST-12]

const SPEED = 24;
const FLOOR_FRONT = ROOM_H - 3;
const FLOOR_BACK = ROOM_H - 13;

/** Body proportions (px). Feet at y = 0. Children have a bigger head on a shorter body with shorter limbs. */
interface Build {
  thigh: number; shin: number; torso: number; upper: number; fore: number;
  legW: number; shinW: number; armW: number; foreW: number;
  /** Torso drawing scale (the torso is drawn at adult size). */
  bodyX: number;
  head: number;
}

const ADULT: Build = { thigh: 10, shin: 9, torso: 15, upper: 8, fore: 7.5, legW: 4.4, shinW: 3.8, armW: 3.4, foreW: 3, bodyX: 1, head: 1 };
const CHILD: Build = { thigh: 7.2, shin: 6.6, torso: 11.5, upper: 6, fore: 5.6, legW: 3.8, shinW: 3.3, armW: 2.9, foreW: 2.6, bodyX: 0.88, head: 1.2 };
/** Overall size of a child body relative to an adult one (with its own proportions about 0.68 of adult height). */
const CHILD_SCALE = 0.79;

export interface Lane {
  x0: number;
  x1: number;
}

export type Activity = 'idle' | 'water' | 'hammer' | 'wrench' | 'stir' | 'type' | 'lift' | 'carry' | 'tend' | 'dig' | 'punch' | 'run' | 'inspect';

/** What each room has its workers doing. */
export const ROOM_ACTIVITY: Partial<Record<BuildingType, Activity>> = {
  farm: 'water', hydroponics: 'water', workshop: 'hammer', armory: 'hammer',
  generator: 'wrench', reactor: 'wrench', waterPump: 'wrench', waterPurifier: 'wrench',
  canteen: 'stir', laboratory: 'type', radioTower: 'type', trainingRoom: 'lift', storage: 'carry', medbay: 'tend',
  cave: 'dig', lake: 'water', metro: 'carry', atrium: 'tend', reactorHall: 'type',
  // [plan4:BL-9..14,19,33] existing clips only: reading = inspect, guards stand watch (idle)
  library: 'inspect', recycler: 'hammer', mushroomFarm: 'tend', commons: 'idle', gatePost: 'idle', barracks: 'idle',
};

type Hat = 'straw' | 'hard' | 'chef' | 'cap' | 'helmet' | 'headset' | 'hazmat' | null;
type Tool = 'can' | 'hammer' | 'wrench' | 'spoon' | 'clipboard' | 'box' | 'pick' | 'dumbbell' | null;

interface Outfit {
  top: number;
  bottom: number;
  hat: Hat;
  tool: Tool;
  coat?: number;
  apron?: number;
  goggles?: boolean;
}

// gfx-p0 people: dusty, washed-out casual clothes (art bible: saturation is kept for alerts, fire and screens).
const CASUAL = [0x56708a, 0x8a5246, 0x66724e, 0x9a8450, 0x6c5c74, 0x4e7472, 0x8c6670, 0x5e6670, 0x847a60, 0x8a6040];
const PANTS = [0x2e3a4e, 0x3a3328, 0x2a2a2a, 0x4a4a52, 0x3e3a30];

/** Work clothes: you can tell who does what from across the bunker (worn, sun-starved colours). */
const JOB_OUTFIT: Partial<Record<BuildingType | 'ruin', Outfit>> = {
  farm: { top: 0x74885a, bottom: 0x4a5a72, hat: 'straw', tool: 'can' },
  hydroponics: { top: 0x4c7a66, bottom: 0x2e3a4e, hat: 'cap', tool: 'can' },
  workshop: { top: 0x8a6a4a, bottom: 0x3a3328, hat: null, tool: 'hammer', apron: 0x5a3a22, goggles: true },
  armory: { top: 0x5a5a3a, bottom: 0x3a3a2a, hat: 'helmet', tool: 'hammer' },
  generator: { top: 0xa8673a, bottom: 0x8a5530, hat: 'hard', tool: 'wrench' },
  waterPump: { top: 0x4a6a8e, bottom: 0x2e4a66, hat: 'hard', tool: 'wrench' },
  waterPurifier: { top: 0x4a6a8e, bottom: 0x2e4a66, hat: 'cap', tool: 'wrench' },
  reactor: { top: 0xb8a64e, bottom: 0xa08e44, hat: 'hazmat', tool: 'wrench' },
  canteen: { top: 0xe0dccf, bottom: 0x3a3a42, hat: 'chef', tool: 'spoon', apron: 0xeae6da },
  laboratory: { top: 0x4a6a8a, bottom: 0x2e3a4e, hat: null, tool: 'clipboard', coat: 0xe4e2da, goggles: true },
  medbay: { top: 0x6a9e9a, bottom: 0x5a8a86, hat: null, tool: 'clipboard', coat: 0xe8e6de },
  radioTower: { top: 0x8a6a4a, bottom: 0x3a3328, hat: 'headset', tool: null },
  trainingRoom: { top: 0x96504a, bottom: 0x2a2a2a, hat: null, tool: 'dumbbell' },
  storage: { top: 0x5a6a7a, bottom: 0x3a3328, hat: 'cap', tool: 'box' },
  ruin: { top: 0x7a6a52, bottom: 0x3a3328, hat: 'hard', tool: 'pick' },
  cave: { top: 0x6a5a3a, bottom: 0x3a3328, hat: 'hard', tool: 'pick' },
  lake: { top: 0x3a5a6a, bottom: 0x2e3a4e, hat: 'cap', tool: 'can' },
  metro: { top: 0x5a4a3a, bottom: 0x2a2a2a, hat: 'helmet', tool: 'box' },
  atrium: { top: 0x667e50, bottom: 0x4a5a3a, hat: 'straw', tool: 'can' },
  reactorHall: { top: 0xb8a64e, bottom: 0xa08e44, hat: 'hazmat', tool: 'clipboard', goggles: true },
  // [plan4:BL-9..14,19,33] (batteryBank and condenser have no crew)
  commons: { top: 0x9a8450, bottom: 0x3a3a42, hat: null, tool: null },
  library: { top: 0x6c5c74, bottom: 0x2e3a4e, hat: null, tool: 'clipboard', goggles: true },
  recycler: { top: 0x7a7a5a, bottom: 0x3a3328, hat: 'hard', tool: 'hammer', apron: 0x4a4a3a, goggles: true },
  mushroomFarm: { top: 0x7a6a74, bottom: 0x3a3328, hat: 'cap', tool: 'can' },
  gatePost: { top: 0x5a5a3a, bottom: 0x3a3a2a, hat: 'helmet', tool: null },
  barracks: { top: 0x5a6a4a, bottom: 0x3a3a2a, hat: 'helmet', tool: null },
};

export type Mood = 'happy' | 'neutral' | 'sad';

interface Pose {
  thighF: number; shinF: number; thighB: number; shinB: number;
  upperF: number; foreF: number; upperB: number; foreB: number;
  bob: number; lean: number; headTilt: number;
}

const POSE_KEYS = ['thighF', 'shinF', 'thighB', 'shinB', 'upperF', 'foreF', 'upperB', 'foreB', 'bob', 'lean', 'headTilt'] as const;

const REST: Pose = { thighF: 0, shinF: 0, thighB: 0, shinB: 0, upperF: 0.08, foreF: -0.1, upperB: -0.06, foreB: -0.1, bob: 0, lean: 0, headTilt: 0 };

function copyPose(to: Pose, from: Pose): void {
  for (const k of POSE_KEYS) to[k] = from[k];
}

/** Graphics overhaul: painted people (shaded limbs, soft outline, muted cloth). Set by the renderer. */
export const PEOPLE_STYLE = { painted: false };

/**
 * gfx-p0 people: overall body scale in the painted style. Measured against the paintings' furniture (desks and
 * counters 15-25 u, lockers 44-63 u, bunks 42 u) an adult reads right at about 48-50 u, not the 55-59 u that
 * 1.16 gave; 1.02 puts an adult's head at ~49 u while keeping them readable on a phone.
 */
const PAINTED_SCALE = 1.02;

/** Cloth and skin pulled toward a lamp-lit, slightly dusty palette (only in the painted style). */
function mute(c: number): number {
  if (!PEOPLE_STYLE.painted) return c;
  const r = (c >> 16) & 0xff, g = (c >> 8) & 0xff, b = c & 0xff;
  const l = 0.3 * r + 0.59 * g + 0.11 * b;
  const k = 0.72;
  const m = (v: number, warm: number) => Math.max(0, Math.min(255, Math.round((v * k + l * (1 - k)) * 0.95 + warm)));
  return (m(r, 6) << 16) | (m(g, 2) << 8) | m(b, -4);
}

function limb(len: number, w: number, color: number): Graphics {
  const g = new Graphics().roundRect(-w / 2, -0.8, w, len + 1.6, w / 2).fill(mute(color));
  if (PEOPLE_STYLE.painted) {
    // Form shadow on the far side, a lit edge on the near side, and a soft dark outline.
    g.roundRect(0, -0.6, w / 2, len + 1.2, w / 4).fill({ color: 0x000000, alpha: 0.2 });
    g.rect(-w / 2 + 0.5, 0.4, 0.6, len - 0.8).fill({ color: 0xffffff, alpha: 0.12 });
    g.roundRect(-w / 2, -0.8, w, len + 1.6, w / 2).stroke({ color: shade(mute(color), 0.42), width: 0.55, alpha: 0.85 });
  }
  return g;
}

let blobTex: Texture | null = null;

/** gfx-p0 people: one shared soft round shadow (a radial gradient), stretched per person into contact and cast shadows. */
function blobTexture(): Texture {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,1)');
  grd.addColorStop(0.45, 'rgba(0,0,0,0.6)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  blobTex = Texture.from(c);
  return blobTex;
}

/** gfx-p1 people: which 3D body fits a look (white-haired adults are elders). */
function bodyKind(look: PortraitDef, child: boolean): BodyKind {
  if (child) return 'child';
  const h = look.hair;
  const lum = (0.3 * ((h >> 16) & 255) + 0.59 * ((h >> 8) & 255) + 0.11 * (h & 255)) / 255;
  if (lum > 0.7) return 'elder';
  return look.gender === 'f' ? 'woman' : 'man';
}

/** gfx-p1 people: the 3D animation for each work activity. */
const WORK_ANIM: Record<Activity, Anim3> = {
  idle: 'idle', water: 'water', hammer: 'hammer', wrench: 'wrench', stir: 'stir', type: 'type', lift: 'lift',
  carry: 'carry', tend: 'tend', dig: 'dig', punch: 'punch', run: 'run', inspect: 'inspect',
};

/** 0..1 → 0..1, smooth at both ends. */
function smooth(k: number): number {
  return k * k * (3 - 2 * k);
}

/** A tool swing: a slow wind-up (anticipation), a fast strike, then a short hold on impact. 0 = down, 1 = raised. */
function swing(ph: number): number {
  if (ph < 0.55) return smooth(ph / 0.55);
  if (ph < 0.67) {
    const k = (ph - 0.55) / 0.12;
    return 1 - k * k;
  }
  return 0;
}

/**
 * A survivor drawn side-on with a jointed skeleton: dressed for their job, carrying its tool,
 * wearing their mood on their face, and acting out the work of the room they are in.
 *
 * gfx-p0 people: workers claim a work spot at the painted equipment (see workSpots.ts) and face it, everyone keeps
 * their distance, poses cross-fade, turns happen in place, the stride matches the walking speed, and a soft shadow
 * falls away from the room's lamp.
 */
export class Person implements CrowdMember {
  readonly container = new Container();
  roomId: string | null = null;
  readonly id: string;

  private figure = new Container();
  private hit!: SlopArea;
  private shadow = new Graphics();
  private contact: Sprite | null = null;
  private cast: Sprite | null = null;
  private thighF = new Container();
  private shinF = new Container();
  private thighB = new Container();
  private shinB = new Container();
  private upperF = new Container();
  private foreF = new Container();
  private upperB = new Container();
  private foreB = new Container();
  private torso = new Container();
  private head = new Container();
  private face = new Graphics();
  private toolHolder = new Container();
  /** gfx-p1 people: the pre-rendered 3D body (replaces the vector limbs once its atlas has loaded). */
  private b3: Body3D | null = null;
  private kind: BodyKind;
  /** Walk loop position (0..1 per stride), advanced by the ground covered so the planted foot stays put. */
  private walk3 = 0;
  private outfit: Outfit | null = null;

  private look: PortraitDef;
  private child: boolean;
  private b: Build;
  private baseScale: number;
  private casual: number;
  private pants: number;
  private outfitKey = '';
  private job: BuildingType | 'ruin' | null = null;
  private mood: Mood = 'neutral';
  private hurt = false;
  /** Badly hurt: hunched, clutching their side, slow. */
  private wounded = false;

  private x = 0;
  private depth = 0.5;
  private depthGoal = 0.5;
  /** Depth to stand at once arrived (depthGoal may differ while stepping around someone). */
  private destDepth = 0.5;
  private tx = 0;
  private wait = 0;
  private walkPhase = 0;
  private facing = 1;
  /** Shown facing, -1..1: crosses zero during a turn (the figure narrows and flips instead of mirroring at once). */
  private turn = 1;
  private lane: Lane = { x0: 0, x1: 1 };
  private rnd: () => number;
  private working = false;
  private lifted = false;
  /** Cloth shade variant, so two workers in the same job are not twins. */
  private variant = 0;
  private blinkIn = 2 + Math.random() * 4;
  private blinkT = 0;
  /** Per-person phase offset, so a room's workers don't move in lockstep. */
  private off = 0;
  /** Plan 2026-10 Q3: build variety from the id hash (height, width, skin lightness): no twins in a room. */
  private sizeV = 1;
  private widthV = 1;
  private skinV = 1;
  /** The room's ambient tint as the renderer set it (before the lamp pools of the painting are applied, Q2). */
  private ambient = 0xffffff;
  private placeRGB: [number, number, number] = [1, 1, 1];

  private crowd: Crowd | null = null;
  private spot: Spot | null = null;
  /** Re-plan on the next update (new room, new crowd, started or stopped working). */
  private replan = true;
  /** How to arrive after a room change: appear in place, or walk in from the room's edge. */
  private arrive: 'snap' | 'walk' = 'snap';
  /** A short pause from work (stands, looks around) before carrying on. */
  private breather = false;

  // Plan 2026-10 M5 (people use the set): lie in a bunk, sit on a bench or bunk edge, eat at the table.
  private intent: 'none' | 'sleep' | 'sit' | 'eat' = 'none';
  private rest: Rest | null = null;
  private atRest = false;
  /** 0 on the floor .. 1 on the bed or seat (the hop up and down, about 0.45 s). */
  private restPhase = 0;
  private restHit = false;

  // Pose cross-fade: the pose shown is blended from a snapshot of the last one into the new target over ~0.2 s.
  private cur: Pose = { ...REST };
  private from: Pose = { ...REST };
  private tgt: Pose = { ...REST };
  private blend = 1;
  private blendDur = 0.22;
  private mode = '';

  /** Light level of the room on this person (from the ambient tint), for the cast shadow. */
  private light = 1;
  private tagRow = 0;
  private tagLift = 0;
  private tagBaseY = 0;

  /**
   * Plan 2026-10 M5: what the person would like to do with the room's furniture right now (the renderer decides from the
   * clock: sleep at night, eat at mealtimes, sit now and then by day). It only takes effect where the painting has set data.
   */
  setIntent(intent: 'none' | 'sleep' | 'sit' | 'eat'): void {
    this.intent = intent;
  }

  /** True while lying on a bed (so the renderer shows them instead of just a Zzz). */
  get isSleeping(): boolean {
    return this.rest?.kind === 'sleep' && this.restPhase > 0.5;
  }

  private restWanted(): boolean {
    if (!GFX.sitSleep || !this.b3 || this.intent === 'none' || !this.crowd) return false;
    if (!hasSetPoses(this.kind)) {
      requestSetPoses(this.kind);
      return false;
    }
    return true;
  }

  private restClaim(): void {
    const c = this.crowd!;
    if (this.intent === 'none') return;
    const r = c.claimRest(this, this.intent, this.x);
    if (!r) return;
    this.rest = r;
    this.atRest = false;
    c.release(this);
    this.spot = null;
    this.breather = false;
  }

  private restLeave(): void {
    this.crowd?.releaseRest(this);
    if (this.atRest) {
      this.atRest = false;
      this.wait = 0;
      this.replan = true;
    }
    if (this.restPhase <= 0) this.rest = null;
  }

  /** The animation of the place the person is on (a seated person now and then talks). */
  private restAnim(t: number): Anim3 {
    const k = this.rest!.kind;
    if (k === 'sleep') return 'sleep';
    if (k === 'eat' || this.intent === 'eat') return 'eat';
    return (Math.floor((t + this.off) / 9) % 3 === 1 ? 'sitTalk' : 'sit');
  }

  /** Whether this body was made for a child (rebuilt when they grow up). */
  readonly bornChild: boolean;

  constructor(s: SurvivorState & { child?: boolean }) {
    this.id = s.id;
    this.bornChild = !!s.child;
    this.look = portraitFor(s);
    this.child = !!s.child || !!this.look.child;
    this.b = this.child ? CHILD : ADULT;
    this.kind = bodyKind(this.look, this.child);
    const h = hashString(s.id);
    this.casual = CASUAL[h % CASUAL.length];
    this.pants = PANTS[(h >>> 5) % PANTS.length];
    this.variant = (h >>> 9) % 3;
    let seed = h || 1;
    this.rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    this.off = this.rnd() * 10;
    this.sizeV = 0.94 + this.rnd() * 0.12;
    this.widthV = 0.92 + this.rnd() * 0.16;
    this.skinV = 0.93 + this.rnd() * 0.14;
    this.shadow.ellipse(0, 0, 9, 2.8).fill({ color: 0x000000, alpha: 0.35 });
    // Draw order: back leg, back arm, torso (with head), front leg, front arm.
    this.thighB.addChild(this.shinB);
    this.thighF.addChild(this.shinF);
    this.upperB.addChild(this.foreB);
    this.upperF.addChild(this.foreF);
    this.foreF.addChild(this.toolHolder);
    this.torso.addChild(this.head);
    this.figure.addChild(this.thighB, this.upperB, this.torso, this.thighF, this.upperF);
    this.container.addChild(this.shadow, this.figure);
    // The painted style: life-size against the painted furniture.
    const base = PEOPLE_STYLE.painted ? PAINTED_SCALE : 1;
    this.baseScale = this.child ? (PEOPLE_STYLE.painted ? CHILD_SCALE : 0.74) * base : base;
    this.figure.scale.set(this.baseScale);
    if (PEOPLE_STYLE.painted) {
      // Soft sprites instead of the flat oval: a contact shadow under the feet and a cast shadow along the floor.
      this.cast = new Sprite(blobTexture());
      this.cast.anchor.set(0.5);
      this.cast.alpha = 0;
      this.contact = new Sprite(blobTexture());
      this.contact.anchor.set(0.5);
      this.contact.width = this.child ? 16 : 22;
      this.contact.height = 5;
      this.contact.alpha = 0.75;
      this.shadow.visible = false;
      this.container.addChildAt(this.cast, 0);
      this.container.addChildAt(this.contact, 1);
    }
    this.container.eventMode = 'static';
    this.container.cursor = 'grab';
    // [plan4:ST-12 #4] A SlopArea: at least 44 screen px each way whatever the zoom (HitSlop.ts); the drawn rectangle is what `set` receives.
    this.hit = PEOPLE_STYLE.painted ? new SlopArea(-10, -this.height() - 2, 20, this.height() + 4, this.container) : new SlopArea(-9, -48, 18, 50, this.container);
    this.container.hitArea = this.hit;
    this.container.once('destroyed', () => this.crowd?.leave(this));
    this.dress(null);
  }

  /** Standing height to the top of the head (world units, before the depth scale). */
  private height(): number {
    if (this.b3) return ((this.b3.data.height * UNITS_PER_M) / ppm()) * this.sizeV;
    const b = this.b;
    return (b.thigh + b.shin + b.torso + (2.6 + 9.8) * b.head) * this.baseScale;
  }

  // --- CrowdMember ---
  get posX(): number {
    return this.x;
  }

  get goalX(): number {
    return this.tx;
  }

  get posD(): number {
    return this.depth;
  }

  tagWidth(): number {
    return this.tag && this.tag.visible && this.container.visible ? this.tag.width * this.container.scale.x : 0;
  }

  setTagRow(row: number): void {
    this.tagRow = row;
  }

  /**
   * Graphics overhaul: sit the figure in the room's light — tint it with the room's ambient colour and
   * give it a two-layer contact shadow instead of a flat oval.
   */
  setAmbient(tint: number): void {
    if (this.ambient === tint) return;
    this.ambient = tint;
    this.applyTint();
    this.light = Math.max((tint >> 16) & 255, (tint >> 8) & 255, tint & 255) / 255;
    if (this.contact) return;
    this.shadow.clear();
    this.shadow.ellipse(0, 0, 15, 3.6).fill({ color: 0x000000, alpha: 0.18 });
    this.shadow.ellipse(0, 0, 8, 2.2).fill({ color: 0x000000, alpha: 0.42 });
  }

  /**
   * Plan 2026-10 Q2: the figure's tint is the room's ambient colour times the painting's own lamp pools at this spot:
   * a little darker and cooler between the lamps, a little warmer and brighter under one (the average stays put).
   */
  private applyTint(): void {
    let t = this.ambient;
    if (GFX.place && !this.lifted && this.crowd?.lightAt(this.x, this.placeRGB)) {
      const [kr, kg, kb] = this.placeRGB;
      const c = (sh: number, k: number) => Math.max(0, Math.min(255, Math.round(((t >> sh) & 255) * k)));
      t = (c(16, kr) << 16) | (c(8, kg) << 8) | c(0, kb);
    }
    if (this.figure.tint !== t) this.figure.tint = t;
  }

  /** Rebuilds the body when the job (outfit) changes. */
  dress(job: BuildingType | 'ruin' | null): void {
    this.job = job;
    const base: Outfit = (job && JOB_OUTFIT[job]) || { top: this.casual, bottom: this.pants, hat: null, tool: null };
    // Same uniform, different wear: a lighter, a standard and a darker, more faded set.
    const vary = PEOPLE_STYLE.painted ? [0.84, 1, 1.12][this.variant] : 1;
    const outfit: Outfit = vary === 1 ? base : { ...base, top: shade(base.top, vary), bottom: shade(base.bottom, 2 - vary), coat: base.coat && shade(base.coat, 0.94 + (vary - 1) * 0.3) };
    const key = `${job}|${this.hurt}`;
    if (key === this.outfitKey) return;
    this.outfitKey = key;
    this.outfit = outfit;
    this.dress3();
    const b = this.b;
    const hip = -(b.thigh + b.shin);
    const skin = mute(this.look.skin), hair = mute(this.look.hair);
    for (const c of [this.thighF, this.shinF, this.thighB, this.shinB, this.upperF, this.foreF, this.upperB, this.foreB, this.torso, this.head, this.toolHolder]) {
      for (const g of c.children.filter(ch => ch instanceof Graphics && ch !== this.face)) g.destroy();
    }

    // Legs: thigh + shin with a boot that points forward.
    const leg = (thigh: Container, shin: Container, front: boolean) => {
      const col = front ? outfit.bottom : shade(outfit.bottom, 0.78);
      thigh.addChildAt(limb(b.thigh, b.legW, col), 0);
      shin.position.set(0, b.thigh);
      shin.addChildAt(limb(b.shin, b.shinW, col), 0);
      const bw = this.child ? 5.2 : 6.2;
      shin.addChild(new Graphics().roundRect(-2.2, b.shin - 1.4, bw, 3, 1.4).fill(front ? 0x2a221c : 0x1e1814));
    };
    leg(this.thighB, this.shinB, false);
    leg(this.thighF, this.shinF, true);
    this.thighB.position.set(-1.2, hip);
    this.thighF.position.set(1.2, hip);

    // Torso: shirt, belt, coat or apron (drawn at adult size, scaled to the build).
    const TORSO = 15;
    const body = new Graphics();
    if (outfit.coat) body.roundRect(-6.2, -TORSO + 1, 12.4, TORSO + 8, 3.5).fill(mute(outfit.coat));
    body.roundRect(-5.6, -TORSO, 11.2, TORSO + 0.5, 4).fill(mute(outfit.top));
    body.roundRect(1.8, -TORSO + 1, 3.6, TORSO - 1, 2.5).fill({ color: 0x000000, alpha: 0.13 });
    if (outfit.coat) {
      body.rect(-6.2, -TORSO + 2, 2.6, TORSO + 6).fill(mute(shade(outfit.coat, 0.88)));
      body.rect(2.5, -TORSO + 2, 1, TORSO + 6).fill({ color: 0x000000, alpha: 0.12 });
    }
    if (outfit.apron) body.roundRect(1, -TORSO + 5, 5, TORSO + 3, 1.5).fill(mute(outfit.apron));
    body.rect(-5.6, -2, 11.2, 2).fill(mute(shade(outfit.bottom, 0.65)));
    if (PEOPLE_STYLE.painted) {
      // Light from above: the chest catches it, the belly falls into shade; a soft outline holds the shape.
      body.roundRect(-5.6, -TORSO * 0.45, 11.2, TORSO * 0.45, 3).fill({ color: 0x000000, alpha: 0.14 });
      body.roundRect(-4.6, -TORSO + 0.8, 7, 2.2, 1.1).fill({ color: 0xffffff, alpha: 0.1 });
      body.roundRect(-5.6, -TORSO, 11.2, TORSO + 0.5, 4).stroke({ color: shade(mute(outfit.top), 0.42), width: 0.55, alpha: 0.85 });
    }
    body.scale.set(b.bodyX, b.torso / TORSO);
    this.torso.addChildAt(body, 0);
    this.torso.position.set(0, hip);

    // Arms with sleeves and a bare hand.
    const arm = (upper: Container, fore: Container, front: boolean) => {
      const sleeve = front ? shade(outfit.coat ?? outfit.top, 0.95) : shade(outfit.coat ?? outfit.top, 0.72);
      const handSkin = front ? skin : shade(skin, 0.85);
      upper.addChildAt(limb(b.upper, b.armW, sleeve), 0);
      fore.position.set(0, b.upper);
      fore.addChildAt(limb(b.fore, b.foreW, outfit.hat === 'hazmat' ? sleeve : handSkin), 0);
      fore.addChildAt(new Graphics().circle(0, b.fore + 0.6, this.child ? 1.6 : 1.9).fill(outfit.hat === 'hazmat' ? 0x3a3a3a : handSkin), 1);
    };
    arm(this.upperB, this.foreB, false);
    arm(this.upperF, this.foreF, true);
    this.upperB.position.set(-0.5, hip - b.torso + 2);
    this.upperF.position.set(0.5, hip - b.torso + 2);

    // Head: neck, skull, hair, beard, glasses, hat; the face is drawn separately.
    const headG = new Graphics();
    headG.rect(-1.5, 0.5, 3, 3).fill(shade(skin, 0.9));
    headG.circle(0.4, -4.2, 5.6).fill(skin);
    headG.circle(5.6, -3.6, 1.1).fill(skin);
    const hs = this.look.hairStyle;
    const hidden = outfit.hat === 'hazmat';
    if (hs !== 'bald' && !hidden) {
      const top = hs === 'cropped' ? 2.6 : 3.6;
      headG.ellipse(-0.4, -7.6, 5.9, top).fill(hair);
      headG.rect(-5.4, -7.6, 3.2, hs === 'long' || hs === 'braids' ? 9 : 5).fill(hair);
      if (hs === 'curly') for (const [cx, cy] of [[-4, -9], [-1, -10.4], [2.6, -9.6], [-5, -6]]) headG.circle(cx, cy, 2.1).fill(hair);
      if (hs === 'bun') headG.circle(-5.4, -8.4, 2.4).fill(hair);
      if (hs === 'long') headG.roundRect(-6.2, -6, 3.6, 10, 1.6).fill(hair);
      if (hs === 'braids') headG.roundRect(-6.4, -3, 2.2, 9, 1.1).fill(shade(hair, 1.15));
    }
    if (this.look.beard !== undefined && !hidden) headG.ellipse(1.6, -0.6, 4.2, 2.6).fill(this.look.beard);
    if (this.look.glasses && !hidden) {
      headG.roundRect(2.6, -5.4, 3.4, 2.2, 0.8).stroke({ color: 0x2a2a2a, width: 0.7 });
      headG.moveTo(-0.5, -4.6).lineTo(2.6, -4.6).stroke({ color: 0x2a2a2a, width: 0.5 });
    }
    if (outfit.goggles && !this.look.glasses) headG.roundRect(-2.5, -9.6, 7, 2, 1).fill(mute(0x3a4a5a));
    if (this.hurt) {
      // A grubby bandage with a spot of blood, not a white bar.
      headG.rect(-5, -8.5, 10.6, 2).fill(mute(0xd8d0bc));
      headG.circle(3.4, -7.5, 0.8).fill(mute(0x8a3a30));
    }
    switch (outfit.hat) {
      case 'straw':
        headG.ellipse(0.4, -9.2, 8.4, 1.6).fill(mute(0xc8a868));
        headG.roundRect(-3.4, -12.6, 7.6, 3.8, 1.6).fill(mute(0xd0b478));
        break;
      case 'hard':
        headG.ellipse(0.4, -8.6, 6.4, 1.3).fill(mute(0xd09a30));
        headG.ellipse(0.4, -9.2, 5.6, 3.8).fill(mute(0xdcaa3c));
        break;
      case 'hazmat':
        headG.circle(0.4, -4.4, 6.6).fill(mute(0xcdb850));
        headG.roundRect(1.4, -6.6, 5, 4, 1.6).fill({ color: 0x9fc8e0, alpha: 0.85 });
        break;
      case 'chef':
        headG.roundRect(-3.6, -14.4, 8, 6, 2.4).fill(mute(0xeeece4));
        headG.rect(-3.8, -9.6, 8.4, 1.6).fill(mute(0xdcdad0));
        break;
      case 'cap':
        headG.ellipse(0.2, -8.8, 5.6, 2.8).fill(shade(outfit.top, 0.8));
        headG.roundRect(3.4, -8.4, 4.6, 1.4, 0.7).fill(shade(outfit.top, 0.6));
        break;
      case 'helmet':
        headG.ellipse(0.2, -8.2, 6.4, 4.4).fill(mute(0x5a6a3a));
        headG.rect(-6, -8.2, 12.4, 1.4).fill(mute(0x4a5a2e));
        break;
      case 'headset':
        headG.moveTo(-3.6, -4).bezierCurveTo(-3.6, -12, 4.4, -12, 4.4, -4).stroke({ color: 0x2a2a2a, width: 1.1 });
        headG.circle(0.4, -4.4, 2).fill(mute(0x3a3a3a));
        break;
      default:
        break;
    }
    if (PEOPLE_STYLE.painted && !hidden) {
      // Shade the back of the head and outline the skull, like the painted portraits.
      headG.circle(0.4, -4.2, 5.6).stroke({ color: shade(skin, 0.45), width: 0.5, alpha: 0.8 });
      headG.ellipse(-2.4, -3.4, 2.6, 4).fill({ color: 0x000000, alpha: 0.12 });
    }
    this.head.addChildAt(headG, 0);
    if (!this.face.parent) this.head.addChild(this.face);
    this.face.visible = !hidden;
    this.head.scale.set(b.head);
    this.head.position.set(0.6, -b.torso - 2.6);
    this.drawFace();

    // Tool in the front hand.
    const FORE = b.fore;
    const tool = new Graphics();
    switch (outfit.tool) {
      case 'can':
        tool.roundRect(-2.5, FORE - 1, 6, 5, 1).fill(mute(0x6a8aa0));
        tool.moveTo(3.5, FORE).lineTo(7, FORE - 3).stroke({ color: 0x6a8aa0, width: 1.2 });
        break;
      case 'hammer':
        tool.rect(-0.6, FORE - 7, 1.4, 9).fill(mute(0x8a5a2a));
        tool.roundRect(-3, FORE - 9, 6, 2.6, 0.8).fill(mute(0x6a6e76));
        break;
      case 'wrench':
        tool.rect(-0.7, FORE - 6, 1.4, 8).fill(mute(0x9aa0a8));
        tool.circle(0, FORE - 6.4, 1.8).stroke({ color: 0x9aa0a8, width: 1.2 });
        break;
      case 'spoon':
        tool.rect(-0.5, FORE - 7, 1, 8).fill(mute(0xb08a52));
        tool.ellipse(0, FORE - 7.6, 1.6, 1.1).fill(mute(0xb08a52));
        break;
      case 'clipboard':
        tool.roundRect(-2.6, FORE - 3, 5.2, 6.4, 0.6).fill(mute(0x8a6a4a));
        tool.rect(-1.8, FORE - 2, 3.6, 4.6).fill(mute(0xf2eee2));
        break;
      case 'box':
        tool.roundRect(-4, FORE - 3, 9, 7, 0.8).fill(mute(0xb08a52));
        tool.rect(-4, FORE - 0.4, 9, 1).fill(mute(0x8a6a3a));
        break;
      case 'pick':
        tool.rect(-0.6, FORE - 9, 1.3, 11).fill(mute(0x8a5a2a));
        tool.poly([-4.6, FORE - 8, 0, FORE - 10.6, 4.6, FORE - 8, 0, FORE - 9.2]).fill(mute(0x7a7e86));
        break;
      case 'dumbbell':
        tool.rect(-3.4, FORE - 0.5, 6.8, 1.4).fill(mute(0x4a4a4a));
        tool.roundRect(-4.6, FORE - 2.4, 2, 5.2, 0.6).fill(mute(0x2a2a2a));
        tool.roundRect(2.6, FORE - 2.4, 2, 5.2, 0.6).fill(mute(0x2a2a2a));
        break;
      default:
        break;
    }
    this.toolHolder.addChild(tool);
  }

  /** gfx-p1 people: swap the vector limbs for the 3D body as soon as its atlas is in (painted style only). */
  private try3d(): void {
    if (this.b3 || !PEOPLE_STYLE.painted || !PEOPLE3D.on) return;
    const data = bodyData(this.kind);
    if (!data) return;
    this.b3 = new Body3D(data);
    const k3 = UNITS_PER_M / ppm() / this.baseScale;
    this.b3.container.scale.set(k3 * this.widthV, k3 * this.sizeV);
    for (const c of [this.thighB, this.upperB, this.torso, this.thighF, this.upperF]) c.visible = false;
    this.figure.addChild(this.b3.container);
    const h = this.height();
    this.hit.set(-10, -h - 2, 20, h + 4);
    this.tagBaseY = -h - 6;
    this.dress3();
  }

  /** gfx-p1 people: outfit, skin and head gear onto the 3D body's layers. */
  private dress3(): void {
    const o = this.outfit;
    if (!this.b3 || !o) return;
    this.b3.dress({
      skin: mute(shade(this.look.skin, this.skinV)), top: mute(o.coat ?? o.top), bottom: mute(o.bottom), hair: mute(this.look.hair),
      beard: this.look.beard !== undefined ? mute(this.look.beard) : null, hairStyle: this.look.hairStyle,
      glasses: !!this.look.glasses, goggles: !!o.goggles, hat: o.hat, hatTint: mute(shade(o.top, 0.8)), hurt: this.hurt,
    });
  }

  /** gfx-p1 people: the 3D animation and frame for the current state. */
  private show3(t: number, moving: boolean, act: Activity, carrying: boolean): void {
    const b3 = this.b3!;
    if (moving) {
      const anim: Anim3 = carrying ? 'walkCarry' : this.hurt ? 'limp' : 'walk';
      b3.show(anim, Math.floor(this.walk3 * b3.data.anims[anim].frames.length), GFX.fade);
      return;
    }
    let anim: Anim3;
    if (this.rest && this.restPhase > 0.55) anim = this.restAnim(t);
    else if (this.breather) anim = 'look';
    else if (act === 'idle') anim = this.wounded ? 'hunch' : this.mood === 'sad' ? 'sad' : this.talkingTo(t) ? 'talk' : 'idle';
    else if (act === 'tend' && (this.job === 'laboratory' || this.job === 'reactorHall')) anim = 'inspect';
    else anim = WORK_ANIM[act];
    const a = b3.data.anims[anim] ?? b3.data.anims.idle;
    b3.show(anim, Math.floor((t + this.off) * a.fps), GFX.fade);
  }

  /**
   * Plan 2026-10 M3: an idle person standing close to another gestures and nods for a few seconds every so often (and turns
   * to them), instead of both standing like statues. Needs the set poses.
   */
  private talkingTo(t: number): boolean {
    const c = this.crowd;
    if (!GFX.sitSleep || !c || !this.b3 || !hasSetPoses(this.kind) || this.wounded) return false;
    if (Math.floor((t + this.off) / 7) % 4 !== 0) return false;
    for (const m of c.members) {
      if (m === (this as unknown as CrowdMember) || m.goalX !== m.posX) continue;
      const dx = m.posX - this.x;
      if (Math.abs(dx) < 26 && Math.abs(m.posD - this.depth) < 0.4) {
        this.facing = dx < 0 ? -1 : 1;
        return true;
      }
    }
    return false;
  }

  /** Mood and health show on the face (and posture). */
  setCondition(happiness: number, health: number): void {
    const mood: Mood = happiness >= 65 ? 'happy' : happiness < 35 ? 'sad' : 'neutral';
    const hurt = health < 40;
    this.wounded = health < 20;
    if (hurt !== this.hurt) {
      this.hurt = hurt;
      this.outfitKey = '';
      this.dress(this.job);
    }
    if (mood !== this.mood) {
      this.mood = mood;
      this.drawFace();
      this.faceStep();
    }
  }

  /** Plan 2026-10 M4: the 3D body's face overlay follows the mood and closes its eyes to blink and to sleep. */
  private faceStep(): void {
    if (!this.b3) return;
    const asleep = !!this.rest && this.rest.kind === 'sleep' && this.restPhase > 0.55;
    this.b3.setFace(this.mood, asleep || this.blinkT > 0);
  }

  private drawFace(blink = false): void {
    const f = this.face;
    f.clear();
    const ink = 0x1a1410;
    if (blink) f.rect(2.4, -4.7, 1.6, 0.35).fill(ink);
    else f.ellipse(3.2, -4.6, 0.75, this.mood === 'sad' ? 0.55 : 0.85).fill(ink);
    if (this.mood === 'sad') f.moveTo(2.2, -6.6).lineTo(4.2, -6.1).stroke({ color: ink, width: 0.6 });
    else f.moveTo(2.2, -6.5).lineTo(4.2, -6.7).stroke({ color: shade(this.look.hair, 0.9), width: 0.7 });
    if (this.mood === 'happy') f.moveTo(2.6, -2.2).quadraticCurveTo(4, -1.2, 5, -2.4).stroke({ color: ink, width: 0.65 });
    else if (this.mood === 'sad') f.moveTo(2.6, -1.4).quadraticCurveTo(4, -2.4, 5, -1.3).stroke({ color: ink, width: 0.65 });
    else f.moveTo(2.8, -1.9).lineTo(4.8, -1.9).stroke({ color: ink, width: 0.6 });
  }

  /**
   * Puts the person in a room. Coming from another room they walk in from its edge; on load, after a drop
   * or without a crowd they simply appear there.
   */
  placeIn(roomId: string, lane: Lane, crowd?: Crowd | null): void {
    this.arrive = this.roomId !== null && this.roomId !== roomId ? 'walk' : 'snap';
    this.roomId = roomId;
    this.lane = lane;
    this.x = lane.x0 + this.rnd() * (lane.x1 - lane.x0);
    this.tx = this.x;
    this.depth = this.depthGoal = this.destDepth = this.rnd();
    this.wait = this.rnd() * 2;
    this.replan = true;
    if (crowd !== undefined) this.setCrowd(crowd);
    this.sync();
  }

  // --- [plan4:ST-18] Walking between rooms: walkers.ts takes the person out of their room, moves the container along a route and hands them back ---

  /** True while walkers.ts drives this person (they stand in no room's crowd and `update` does nothing). */
  inTransit = false;
  /** Where to appear in the next room once the walk is over: room-local x and floor depth (null = the crowd's usual entry). */
  private entryLocal: number | null = null;
  private entryDepth = 0.5;

  /** Leaves the room's crowd and starts being moved by the walkers (the work spot and bed are given up). */
  beginTransit(): void {
    this.inTransit = true;
    this.setCrowd(null);
    this.breather = false;
    this.wait = 0;
    this.setTag(null);
    if (this.restHit) {
      this.restHit = false;
      const h = this.height();
      this.hit.set(-10, -h - 2, 20, h + 4);
    }
    this.container.visible = true;
  }

  /**
   * One step of a walk: `wx, wy` the new position (world units, feet), `dist` the ground covered since the last step, `facing` -1/1 (0 keeps it),
   * `moving` false while waiting (for the lift). Uses the same bodies, strides and turning as in a room.
   */
  stepTransit(dt: number, t: number, wx: number, wy: number, dist: number, facing: number, moving: boolean): void {
    this.try3d();
    this.b3?.step(dt);
    if (this.b3) this.faceStep();
    if (facing !== 0) this.facing = facing;
    this.container.scale.set(1);
    if (moving) {
      if (this.b3) {
        const a = this.b3.data.anims[this.hurt ? 'limp' : 'walk'];
        this.walk3 = (this.walk3 + dist / (a.stride * UNITS_PER_M)) % 1;
      }
      this.walkPhase += dist / ((this.b.thigh + this.b.shin) * this.baseScale * 0.36);
      this.setMode('walk', 0.18);
      this.walkPose(this.tgt, false);
    } else {
      this.setMode('idle');
      this.workPose(this.tgt, 'idle', t);
    }
    this.turnStep(dt);
    if (this.b3) this.show3(t, moving, 'idle', false);
    else this.show(dt);
    this.container.position.set(wx, wy);
    this.container.zIndex = Math.round(wy * 10);
    this.applyTint();
    this.shadowStep();
  }

  /** The walk is over: the person is put back in a room by the renderer's usual placement and appears at `localX` (a doorway) on depth `depth`. */
  endTransit(localX: number | null, depth: number): void {
    this.inTransit = false;
    this.entryLocal = localX;
    this.entryDepth = depth;
    this.replan = true;
  }

  /** Gives up a walk without placing the person (they are being dragged, or are gone). */
  abortTransit(): void {
    this.inTransit = false;
    this.entryLocal = null;
  }

  /** Hidden while inside the lift cabin (the shaft draws a rider figure instead). */
  setRiding(on: boolean): void {
    this.container.visible = !on;
  }

  /** Shirt, skin and trouser colours, for the rider figure in the lift cabin. */
  riderColors(out: { shirt: number; skin: number; pants: number }): void {
    const o = this.outfit;
    out.shirt = mute(o ? o.coat ?? o.top : this.casual);
    out.skin = mute(shade(this.look.skin, this.skinV));
    out.pants = mute(o ? o.bottom : this.pants);
  }

  /** gfx-p0 people: the room's crowd (work spots, spacing, lamp); call every frame, cheap when unchanged. */
  setCrowd(crowd: Crowd | null): void {
    if (crowd === this.crowd && (!crowd || crowd.members.includes(this))) return;
    this.crowd?.leave(this);
    this.spot = null;
    this.rest = null;
    this.atRest = false;
    this.restPhase = 0;
    this.crowd = crowd;
    crowd?.join(this);
    this.replan = true;
  }

  private tag: Text | null = null;

  /** Close-up detail: a small name tag over the head (null hides it). */
  setTag(text: string | null): void {
    if (!text) {
      if (this.tag) this.tag.visible = false;
      return;
    }
    if (!this.tag) {
      this.tag = new Text({
        text,
        style: { fontFamily: 'Rubik, sans-serif', fontSize: 14, fontWeight: '600', fill: 0xf4ecd8, stroke: { color: 0x000000, width: 3 } },
        resolution: 2,
      });
      this.tag.anchor.set(0.5, 1);
      this.tag.scale.set(0.42);
      this.tagBaseY = PEOPLE_STYLE.painted ? -this.height() - 6 : (this.child ? -40 : -52);
      this.tag.y = this.tagBaseY;
      this.container.addChild(this.tag);
    }
    if (this.tag.text !== text) this.tag.text = text;
    this.tag.visible = true;
  }

  setLifted(lifted: boolean): void {
    this.lifted = lifted;
    if (lifted) {
      this.crowd?.releaseRest(this);
      this.rest = null;
      this.atRest = false;
      this.restPhase = 0;
    }
    this.shadow.visible = !lifted && !this.contact;
    if (this.contact) this.contact.visible = !lifted;
    if (this.cast) this.cast.visible = !lifted;
    this.container.cursor = lifted ? 'grabbing' : 'grab';
    if (!lifted) this.sync();
  }

  get isLifted(): boolean {
    return this.lifted;
  }

  private workTime(act: Activity): number {
    if (act === 'carry') return 1.6 + this.rnd() * 2.4;
    if (act === 'run') return 14 + this.rnd() * 10;
    return 6 + this.rnd() * 8;
  }

  /** Where to go next: a (new) work spot, a breather, or a free bit of floor away from everyone else. */
  private plan(snap: boolean): void {
    const c = this.crowd;
    if (this.working) {
      const s = c ? c.claim(this, this.x, this.rnd, null) : null;
      this.spot = s;
      if (s) this.goTo(s.x, s.depth, snap);
      else this.goTo(c ? c.freeX(this, this.x, this.rnd) : this.laneX(), this.rnd() * 0.6, snap);
      if (snap) {
        this.wait = this.workTime(this.spot?.act ?? 'idle') * (0.3 + 0.7 * this.rnd());
        if (this.spot) this.facing = this.turn = this.spot.face;
      }
    } else {
      c?.release(this);
      this.spot = null;
      this.goTo(c ? c.freeX(this, this.x, this.rnd) : this.laneX(), this.rnd(), snap);
      if (snap) this.wait = this.rnd() * 3;
    }
  }

  private laneX(): number {
    return this.lane.x0 + this.rnd() * (this.lane.x1 - this.lane.x0);
  }

  private goTo(x: number, depth: number, snap: boolean): void {
    this.tx = x;
    this.depthGoal = this.destDepth = depth;
    if (snap) {
      this.x = x;
      this.depth = depth;
    } else {
      this.wait = 0;
    }
  }

  /** A wait ran out: move on to another spot, take a breather, or keep at it. */
  private next(act: Activity): void {
    const c = this.crowd;
    if (this.breather) {
      this.breather = false;
      this.wait = this.workTime(act);
      return;
    }
    if (!this.working) {
      this.goTo(c ? c.freeX(this, this.x, this.rnd) : this.laneX(), this.rnd() < 0.3 ? this.rnd() : this.destDepth, false);
      return;
    }
    const roll = this.rnd();
    const moveOn = act === 'carry' || (act === 'run' ? roll < 0.25 : roll < 0.45);
    if (moveOn) {
      const s = c ? c.claim(this, this.x, this.rnd, this.spot) : null;
      if (s) {
        this.spot = s;
        this.goTo(s.x, s.depth, false);
        return;
      }
      if (!this.spot || act === 'carry') {
        c?.release(this);
        this.spot = null;
        this.goTo(c ? c.freeX(this, this.x, this.rnd) : this.laneX(), this.rnd() * 0.6, false);
        return;
      }
    }
    if (roll > 0.7 && act !== 'run') {
      // Straighten up, look around, then back to it.
      this.breather = true;
      this.wait = 1.2 + this.rnd() * 1.6;
      if (this.rnd() < 0.4) this.facing = -this.facing;
      return;
    }
    this.wait = this.workTime(act);
    if (!this.spot && this.rnd() < 0.5) this.facing = -this.facing;
  }

  private sync(): void {
    if (this.lifted) return;
    let y = FLOOR_BACK + (FLOOR_FRONT - FLOOR_BACK) * this.depth + (this.crowd?.dy ?? 0);
    let scale = 0.94 + 0.12 * this.depth;
    if (this.rest && this.restPhase > 0) {
      const e = smooth(this.restPhase);
      y += (this.rest.y - y) * e;
      scale += (1 - scale) * e;
      const hit = this.restPhase > 0.6;
      if (hit !== this.restHit) {
        this.restHit = hit;
        const h = this.height();
        if (hit) {
          if (this.rest.kind === 'sleep') this.hit.set(-26, -14, 52, 18);
          else this.hit.set(-10, -h * 0.72 - 2, 20, h * 0.72 + 4);
        } else this.hit.set(-10, -h - 2, 20, h + 4);
      }
    }
    this.container.position.set(this.x, y);
    this.container.scale.set(scale);
    this.container.zIndex = Math.round(y * 10);
  }

  private apply(p: Pose): void {
    const b = this.b;
    const hip = -(b.thigh + b.shin);
    this.thighF.rotation = p.thighF;
    this.shinF.rotation = p.shinF;
    this.thighB.rotation = p.thighB;
    this.shinB.rotation = p.shinB;
    this.upperF.rotation = p.upperF;
    this.foreF.rotation = p.foreF;
    this.upperB.rotation = p.upperB;
    this.foreB.rotation = p.foreB;
    this.torso.y = hip + p.bob;
    this.torso.rotation = p.lean;
    const shoulderY = hip - b.torso + 2 + p.bob;
    const shoulderX = Math.sin(p.lean) * (b.torso - 2);
    this.upperF.position.set(0.5 + shoulderX, shoulderY);
    this.upperB.position.set(-0.5 + shoulderX, shoulderY);
    this.head.rotation = p.headTilt;
  }

  /** The pose of a working body, per activity and time (written into `p`). */
  private workPose(p: Pose, a: Activity, t: number): void {
    copyPose(p, REST);
    const o = this.off;
    const s = Math.sin(t * 6 + o);
    switch (a) {
      case 'water':
        p.upperF = -1.1; p.foreF = -0.2 + 0.25 * Math.sin(t * 1.8 + o); p.lean = 0.08; p.headTilt = 0.12;
        break;
      case 'hammer': {
        // Wind up slowly, strike fast, rest on the impact: the body leans into the blow.
        const ph = (t / 0.9 + o) % 1;
        const k = swing(ph);
        const hit = ph > 0.67 && ph < 0.8 ? 1 - (ph - 0.67) / 0.13 : 0;
        p.upperF = -0.55 - k * 1.95; p.foreF = -0.55 - k * 0.35; p.upperB = -0.75; p.foreB = -0.9;
        p.lean = 0.12 - k * 0.08 + hit * 0.04; p.bob = hit * 0.6; p.headTilt = 0.16;
        break;
      }
      case 'wrench': {
        // A ratchet: pull, pull, reset.
        const ph = (t * 1.3 + o) % 1;
        const pull = ph < 0.7 ? Math.sin((ph / 0.7) * Math.PI * 2) : 0;
        p.upperF = -1.35; p.foreF = -0.4 + 0.45 * pull; p.upperB = -1.1; p.foreB = -0.6; p.lean = 0.1 + 0.02 * pull; p.headTilt = 0.1;
        break;
      }
      case 'stir':
        p.upperF = -0.95 + 0.2 * Math.sin(t * 4 + o); p.foreF = -0.7 + 0.35 * Math.cos(t * 4 + o); p.lean = 0.07; p.headTilt = 0.14;
        p.upperB = -0.4; p.foreB = -0.9;
        break;
      case 'type':
        p.upperF = -1.15; p.foreF = -0.75 + 0.08 * s; p.upperB = -1.1; p.foreB = -0.8 - 0.08 * s; p.headTilt = 0.12; p.lean = 0.05;
        break;
      case 'lift': {
        const k = 0.5 + 0.5 * Math.sin(t * 2.4 + o);
        p.upperF = p.upperB = -2.9 + k * 1.7; p.foreF = p.foreB = -0.2 - k * 0.6; p.bob = k * 1.2;
        p.thighF = p.thighB = 0.15 * k; p.shinF = p.shinB = -0.25 * k;
        break;
      }
      case 'tend':
        p.upperF = -0.9; p.foreF = -1.45; p.headTilt = 0.18 + 0.05 * Math.sin(t * 1.5 + o); p.lean = 0.06;
        break;
      case 'carry':
        p.upperF = p.upperB = -0.9; p.foreF = p.foreB = -1.2;
        break;
      case 'dig': {
        const ph = (t / 1.0 + o) % 1;
        const k = swing(ph);
        const hit = ph > 0.67 && ph < 0.8 ? 1 - (ph - 0.67) / 0.13 : 0;
        p.upperF = -0.4 - k * 2.3; p.upperB = -0.2 - k * 2.1; p.foreF = p.foreB = -0.3; p.lean = 0.16 - k * 0.12 + hit * 0.06; p.bob = k * 0.6 + hit * 1;
        p.thighF = 0.2; p.thighB = -0.25;
        break;
      }
      case 'punch': {
        // Guard up, jabs alternating with a cross.
        const ph = (t * 1.6 + o) % 2;
        const jab = Math.max(0, Math.sin(Math.min(1, ph) * Math.PI)) ** 2;
        const cross = Math.max(0, Math.sin(Math.max(0, ph - 1) * Math.PI)) ** 2;
        p.upperF = -1.2 - 0.35 * jab; p.foreF = -1.7 + 1.55 * jab; p.upperB = -1.15 - 0.4 * cross; p.foreB = -1.75 + 1.5 * cross;
        p.lean = 0.08 + 0.05 * cross; p.bob = 0.4 * Math.sin(t * 6 + o); p.thighF = 0.22; p.thighB = -0.2; p.shinB = 0.15;
        break;
      }
      case 'run': {
        // On the treadmill: a running stride in place.
        const ph = t * 9 + o;
        const sw = Math.sin(ph) * 0.62;
        p.thighF = sw; p.thighB = -sw;
        p.shinF = 0.2 + Math.max(0, Math.sin(ph - 1.1)) * 1.1; p.shinB = 0.2 + Math.max(0, Math.sin(ph + Math.PI - 1.1)) * 1.1;
        p.upperF = -sw * 0.9; p.upperB = sw * 0.9; p.foreF = p.foreB = -1.4;
        p.bob = -Math.abs(Math.cos(ph)) * 1.4; p.lean = 0.12;
        break;
      }
      default:
        p.upperF = 0.08 + 0.03 * Math.sin(t * 1.6 + o);
        p.bob = Math.sin(t * 2 + o) * 0.35;
        if (this.breather) p.headTilt = -0.08 + 0.12 * Math.sin(t * 0.9 + o);
    }
    if (this.mood === 'sad' && a === 'idle') {
      p.lean += 0.1;
      p.headTilt += 0.2;
    }
    this.bodyLanguage(p, a !== 'lift' && a !== 'dig' && a !== 'punch' && a !== 'run', a === 'idle' || a === 'water' || a === 'stir' || a === 'tend');
  }

  /** Hurt people favour a leg; badly hurt ones hunch over and hold their side. */
  private bodyLanguage(p: Pose, standing: boolean, armFree: boolean): void {
    if (this.hurt && standing) {
      // Weight off the hurt leg.
      p.thighF += 0.1; p.shinF += 0.25; p.lean += 0.04;
    }
    if (this.wounded) {
      p.lean += 0.15; p.headTilt += 0.16;
      if (armFree) { p.upperB = -0.45; p.foreB = -1.75; }
    }
  }

  /** A walking stride whose rate follows the ground covered, so the planted foot doesn't slide. */
  private walkPose(p: Pose, carrying: boolean): void {
    const ph = this.walkPhase;
    const amp = 0.36;
    const sw = Math.sin(ph) * amp;
    // A limp: the hurt (front) leg swings less and the body drops onto it.
    const bad = this.hurt ? 0.55 : 1;
    p.thighF = sw * bad; p.thighB = -sw;
    p.shinF = Math.max(0, Math.sin(ph - 1.2)) * 0.6 * bad; p.shinB = Math.max(0, Math.sin(ph + Math.PI - 1.2)) * 0.6;
    p.upperF = carrying ? -0.9 : -sw * 1.1; p.upperB = carrying ? -0.9 : sw * 1.1;
    p.foreF = carrying ? -1.2 : -0.25; p.foreB = carrying ? -1.2 : -0.25;
    p.bob = -Math.abs(Math.cos(ph)) * 0.9 - (this.hurt ? 1.3 * Math.max(0, -Math.sin(ph)) : 0);
    p.lean = 0.04 + (this.hurt ? 0.05 * Math.max(0, -Math.sin(ph)) : 0);
    p.headTilt = 0;
    this.bodyLanguage(p, false, !carrying);
  }

  private setMode(m: string, dur = 0.22): void {
    if (m === this.mode) return;
    copyPose(this.from, this.cur);
    this.mode = m;
    this.blend = 0;
    this.blendDur = dur;
  }

  /** Blends from the snapshot into the target pose and shows it. */
  private show(dt: number): void {
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / this.blendDur);
      const w = smooth(this.blend);
      for (const k of POSE_KEYS) this.cur[k] = this.from[k] + (this.tgt[k] - this.from[k]) * w;
    } else {
      copyPose(this.cur, this.tgt);
    }
    this.apply(this.cur);
  }

  /** Turning in place: the shown facing sweeps through zero (about 0.2 s for a full turn). */
  private turnStep(dt: number): void {
    if (this.b3 && GFX.fade) {
      // Plan 2026-10 Q1: turn in one step; the old orientation fades out as a mirrored ghost instead of squashing through zero width.
      if (this.turn !== this.facing) {
        this.b3.startFade(true);
        this.turn = this.facing;
      }
      this.figure.scale.x = this.baseScale * this.facing;
      return;
    }
    const d = this.facing - this.turn;
    if (d !== 0) this.turn += Math.sign(d) * Math.min(Math.abs(d), dt * 10);
    const k = Math.sin((this.turn * Math.PI) / 2);
    this.figure.scale.x = this.baseScale * (Math.abs(k) < 0.04 ? 0.04 * Math.sign(this.facing) : k);
  }

  /** Cast shadow away from the room's lamp: longer and fainter the further off to the side the lamp is. */
  private shadowStep(): void {
    const c = this.cast;
    if (!c) return;
    const lamp = this.crowd?.lamp;
    const rested = this.restPhase > 0.05;
    if (this.contact) this.contact.visible = !rested && !this.lifted;
    this.wallShadowStep(rested ? null : lamp ?? null);
    if (rested || !lamp || this.light < 0.2) {
      c.visible = false;
      return;
    }
    const dx = this.x - lamp.x;
    const h = this.height();
    const len = Math.min(30, (h * Math.abs(dx)) / lamp.h);
    c.visible = true;
    c.x = Math.sign(dx) * (len * 0.5 + 2);
    c.width = len + 14;
    c.height = 5.2;
    c.alpha = 0.48 * Math.min(1, this.light * 1.15) * Math.max(0.35, 1 - Math.abs(dx) / 140);
  }

  /**
   * Plan 2026-10 Q4: the person's shadow on the back wall, a skewed black copy of the same body sprites (no extra atlas)
   * that leans away from the room's main lamp and sits closer to the body the nearer it stands to the wall.
   */
  private wallShadowStep(lamp: { x: number; h: number } | null): void {
    const b3 = this.b3;
    if (!b3) return;
    if (!GFX.wallShadow || !lamp || this.lifted || this.light < 0.2) {
      b3.shadow(false);
      return;
    }
    const sh = b3.shadow(true)!;
    if (sh.parent !== this.container) this.container.addChildAt(sh, this.contact ? 2 : 1);
    const dx = this.x - lamp.x;
    const sgn = dx < 0 ? -1 : 1;
    const near = Math.min(1, Math.abs(dx) / 70);
    const s3 = UNITS_PER_M / ppm();
    sh.scale.set(s3 * this.widthV * this.facing * 1.04, s3 * this.sizeV * 0.9);
    sh.skew.x = -sgn * (0.12 + 0.24 * near);
    sh.position.set(sgn * (4 + 11 * near), -(5 + 11 * this.depth));
    sh.alpha = (0.3 - 0.12 * this.depth) * Math.min(1, this.light * 1.1) * Math.max(0.5, 1 - Math.abs(dx) / 220);
  }

  /**
   * Advances behaviour: workers walk to a work spot at their room's equipment and work there facing it,
   * now and then moving to another free spot or straightening up for a breather; idlers wander to free floor.
   * `activity` is what this person does when standing still.
   */
  update(dt: number, t: number, energy: number, activity: Activity = 'idle'): void {
    if (this.inTransit && !this.lifted) return; // [plan4:ST-18] walkers.ts moves this person
    this.try3d();
    this.b3?.step(dt);
    if (PEOPLE_STYLE.painted) {
      // Blink every few seconds; breathing rides on the idle bob.
      this.blinkIn -= dt;
      if (this.blinkIn <= 0 && this.blinkT <= 0) { this.blinkT = 0.13; if (!this.b3) this.drawFace(true); }
      if (this.blinkT > 0) {
        this.blinkT -= dt;
        if (this.blinkT <= 0) { this.blinkIn = 2.5 + Math.random() * 4; if (!this.b3) this.drawFace(); }
      }
      this.faceStep();
    }
    if (this.tag && this.isSleeping) this.tag.visible = false;
    if (this.tag) {
      // Name tags step up a row when they would overlap a neighbour's (see settleCrowds).
      this.tagLift += (this.tagRow * 8.5 - this.tagLift) * Math.min(1, dt * 8);
      const base = this.restPhase > 0.6 && this.rest ? (this.rest.kind === 'sleep' ? -13 : -this.height() * 0.72 - 6) : this.tagBaseY;
      this.tag.y = base - this.tagLift;
    }
    if (this.lifted) {
      // Dangling while being carried by the player.
      const sway = Math.sin(t * 9) * 0.25;
      this.setMode('lift', 0.12);
      const p = this.tgt;
      p.thighF = sway; p.thighB = -sway; p.shinF = 0.3; p.shinB = 0.3; p.upperF = -0.6 + sway; p.upperB = -0.4 - sway;
      p.foreF = -0.3; p.foreB = -0.3; p.bob = 0; p.lean = 0; p.headTilt = 0;
      if (this.b3) this.b3.show('dangle', Math.floor((t + this.off) * 8));
      else this.show(dt);
      return;
    }
    const working = activity !== 'idle';
    if (working !== this.working) {
      this.working = working;
      this.replan = true;
      this.breather = false;
    }
    const restOn = !working && this.restWanted();
    if (restOn && this.rest && !(this.rest.kind === this.intent || (this.intent === 'eat' && this.rest.kind === 'sit'))) {
      // A different thing to do now (up from bed for a meal, say): drop the old place at once and look for the new one.
      this.crowd?.releaseRest(this);
      this.rest = null;
      this.atRest = false;
      this.restPhase = 0;
      this.wait = 0;
      this.replan = true;
    }
    if (!restOn && (this.rest || this.atRest)) this.restLeave();
    if (restOn && !this.rest) this.restClaim();
    const resting = restOn && !!this.rest;
    if (resting && !this.atRest) {
      // Walk to the bed or seat.
      this.tx = this.rest!.x;
      this.depthGoal = this.destDepth = 0.15;
      this.wait = 0;
    }
    if (this.replan && !resting) {
      this.replan = false;
      const snap = this.arrive === 'snap';
      if (!snap && this.crowd) {
        // Walking in from the side of the room nearest the lift (or, after a walk across the bunker [plan4:ST-18], from the doorway they came through).
        this.x = this.entryLocal ?? this.crowd.entryX();
        if (this.entryLocal !== null) { this.depth = this.entryDepth; this.entryLocal = null; }
        this.facing = this.turn = this.x < (this.crowd.x0 + this.crowd.x1) / 2 ? 1 : -1;
      }
      this.arrive = 'snap';
      this.plan(snap);
    }
    const act: Activity = working ? (this.spot?.act ?? activity) : 'idle';
    if (this.wait > 0) {
      this.wait -= dt;
      if (this.wait <= 0) this.next(act);
    }
    let moving = false;
    if (this.wait <= 0) {
      const dx = this.tx - this.x;
      if (Math.abs(dx) > 0.01) {
        const dir = dx > 0 ? 1 : -1;
        this.facing = dir;
        const speed = SPEED * (0.6 + 0.4 * energy) * (this.child ? 1.15 : 1) * (this.hurt ? 0.72 : 1) * (this.wounded ? 0.8 : 1);
        // Turn first, then set off: no moonwalking.
        const gate = Math.max(0, Math.min(1, (this.turn * dir + 0.3) / 1.3));
        const step = Math.min(Math.abs(dx), speed * dt * gate);
        this.x += dir * step;
        if (this.b3) {
          // The rendered stride (metres per loop) at this body's scale on screen.
          const a = this.b3.data.anims[act === 'carry' || activity === 'carry' ? 'walkCarry' : this.hurt ? 'limp' : 'walk'];
          this.walk3 = (this.walk3 + step / (a.stride * UNITS_PER_M * this.container.scale.x)) % 1;
        }
        const leg = (this.b.thigh + this.b.shin) * this.baseScale * this.container.scale.y;
        this.walkPhase += step / (leg * 0.36);
        moving = Math.abs(this.tx - this.x) > 0.01;
        // Step around anyone standing in the way: toward the front of the floor or the back, whichever is clear.
        this.depthGoal = this.destDepth;
        if (moving && this.crowd) {
          for (const m of this.crowd.members) {
            if (m === this || Math.abs(m.posX - this.x) > 13 || m.goalX !== m.posX) continue;
            this.depthGoal = m.posD < 0.5 ? 0.95 : 0.05;
            break;
          }
        }
      }
      if (!moving) {
        // Arrived (or nowhere better to go): face the work and settle in.
        this.x = this.tx;
        this.depthGoal = this.destDepth;
        if (this.spot) this.facing = this.spot.face;
        else if (!working && this.rnd() < 0.5) this.facing = -this.facing;
        this.wait = working ? this.workTime(act) : 1.5 + this.rnd() * 4;
      }
    }
    if (resting) {
      if (!this.atRest && !moving && Math.abs(this.x - this.rest!.x) < 0.6) {
        this.atRest = true;
        this.x = this.rest!.x;
      }
      if (this.atRest) {
        this.wait = 1e9;
        this.facing = this.rest!.face;
        moving = false;
      }
    }
    // The hop up onto the bed or seat and back down.
    const toward = resting && this.atRest ? 1 : 0;
    this.restPhase = Math.max(0, Math.min(1, this.restPhase + (toward ? dt : -dt) / 0.45));
    if (!restOn && this.rest && this.restPhase <= 0) this.rest = null;
    if (moving) {
      const carrying = act === 'carry' || activity === 'carry';
      this.setMode(carrying ? 'walkCarry' : 'walk', 0.18);
      this.walkPose(this.tgt, carrying);
    } else {
      this.setMode(this.breather ? 'breather' : act);
      this.workPose(this.tgt, this.breather ? 'idle' : act, t);
    }
    // Depth glides instead of jumping (y and draw order follow).
    const dd = this.depthGoal - this.depth;
    this.depth += Math.sign(dd) * Math.min(Math.abs(dd), dt * 1.2);
    this.turnStep(dt);
    if (this.b3) this.show3(t, moving, act, act === 'carry' || activity === 'carry');
    else this.show(dt);
    this.sync();
    this.applyTint();
    this.shadowStep();
  }
}
