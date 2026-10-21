// v2 view: the mine as one vertical Pixi scene (surface with headframe and market, floors as room paintings, the shaft).
// Reads the Mine's state every frame; taps are resolved against plain world rectangles (no Pixi hit testing).
import { Application, Assets, Container, Graphics, Sprite, Text, Texture, TilingSprite } from 'pixi.js';
import { Body3D, bodyData, type Anim3, type BodyKind } from '../rendering/people3d.ts';
import { FLOORS, tierOf } from './econ.ts';
import { Particles, RoomFx, softDot, type Light } from './roomfx.ts';
import { Room3D, loadRoom3D, releaseRoom3D } from './room3d.ts';
import { Worker3D, loadPeople, peopleReady, type WorkerAnim } from './people.ts';

/** Anything drawn as a person: the pre-rendered 3D worker when its atlases loaded, else the older body. */
interface Fig { root: Container; update(dt: number, x: number, y: number, anim: Anim3, faceRight: boolean): void }
const TO_WORKER: Partial<Record<Anim3, WorkerAnim>> = { water: 'tend', talk: 'idle', look: 'idle', stir: 'wrench', dig: 'lift', carry: 'walkCarry' };
let lookSeq = 0;
function makeFig(kind: BodyKind): Fig {
  if (!peopleReady()) return new Figure(kind);
  const w = new Worker3D(lookSeq++);
  return { root: w.root, update: (dt, x, y, anim, right) => w.update(dt, x, y, (TO_WORKER[anim] ?? anim) as WorkerAnim, right) };
}
import { big } from './format.ts';
import {
  CRATE_X, DEPOT_X, FLOOR_H, MARKET_X, Mine, ROOM_H, ROOM_W, SHAFT_W, SHAFT_X, SURF_H, WORLD_W, floorTop, stopY,
  type MineEvent, type StageId,
} from './mine.ts';

const ART = `${import.meta.env.BASE_URL}art/`;
const FONT = 'Rubik, system-ui, sans-serif';
/** Floor line of each room painting (fraction of its height); the window is cropped so it sits FEET_PAD above the slab. */
const FLOOR_LINE: Record<string, number> = {
  recycler: 0.88, farm: 0.87, hydroponics: 0.88, seedLab: 0.9, componentsPlant: 0.8, alloyFoundry: 0.82, dataCenter: 0.86, reactor: 0.87,
};
const FEET_PAD = 16;
/** Feet line in world units from the top of a floor. */
const FEET_Y = ROOM_H - FEET_PAD;
const PAINT_H = (ROOM_W / 720) * 522;
const cropTop = (art: string) => Math.max(0, Math.min(PAINT_H - ROOM_H, (FLOOR_LINE[art] ?? 0.88) * PAINT_H + FEET_PAD - ROOM_H));
const PERSON_SCALE = 1.05;
const WORK_ANIM: Record<string, Anim3> = {
  recycler: 'hammer', farm: 'tend', hydroponics: 'water', seedLab: 'inspect', componentsPlant: 'wrench',
  alloyFoundry: 'lift', dataCenter: 'type', reactor: 'wrench',
};
const SKINS = [0xf1c7a5, 0xd9a47e, 0xb07a55, 0x8a5a3c, 0x5e3b27];
const TOPS = [0x6d7f5a, 0x8b5a3c, 0x4f6478, 0x9a8a5c, 0x7a4a4a, 0x5a6b6b, 0xa0703c];
const BOTTOMS = [0x3b3a36, 0x4a4136, 0x2f3a44, 0x514a3a];
const HAIRS = [0x2a1d14, 0x5a3a22, 0x8a6a3a, 0x1a1a1a, 0x9a9590];
const HAIR_STYLES = ['short', 'curly', 'bun', 'cropped', 'long', 'braids'];
const HATS = [null, null, 'hard', 'cap', 'helmet', null];

export interface HitZone { x: number; y: number; w: number; h: number; action: () => void }

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];

/** A person on screen: a 3D sprite body once its atlas has loaded. */
class Figure {
  root = new Container();
  private body: Body3D | null = null;
  private shadow = new Graphics().ellipse(0, 0, 22, 6).fill({ color: 0x000000, alpha: 0.35 });
  private walked = 0;
  private lastX = 0;
  private t = rnd() * 10;
  private kind: BodyKind;
  private look = {
    skin: pick(SKINS), top: pick(TOPS), bottom: pick(BOTTOMS), hair: pick(HAIRS), beard: null as number | null,
    hairStyle: pick(HAIR_STYLES), glasses: false, goggles: rnd() < 0.15, hat: pick(HATS) as string | null, hatTint: 0xd8a040, hurt: false,
  };

  constructor(kind: BodyKind) {
    this.kind = kind;
    if (kind === 'man' && rnd() < 0.4) this.look.beard = this.look.hair;
    this.root.addChild(this.shadow);
    this.root.scale.set(PERSON_SCALE);
  }

  /** Places the figure (feet at x, y) and picks a frame. */
  update(dt: number, x: number, y: number, anim: Anim3, faceRight: boolean): void {
    if (!this.body) {
      const d = bodyData(this.kind);
      if (d) {
        this.body = new Body3D(d);
        this.body.dress(this.look);
        this.root.addChild(this.body.container);
      }
    }
    this.root.position.set(x, y);
    this.walked += Math.abs(x - this.lastX);
    this.lastX = x;
    this.t += dt;
    if (!this.body) return;
    this.body.container.scale.x = faceRight ? 1 : -1;
    const a = this.body.data.anims[anim] ?? this.body.data.anims.idle;
    const walking = anim === 'walk' || anim === 'walkCarry';
    const frame = walking ? Math.floor((this.walked / (a.stride * 80 * PERSON_SCALE)) * a.frames.length) : Math.floor(this.t * a.fps);
    this.body.show(anim, frame, true);
    this.body.step(dt);
  }
}

interface FloorView {
  root: Container;
  inner: Container;
  painting: Sprite;
  fx: RoomFx;
  room3d: Room3D | null;
  /** Streaming state of the floor's picture: 3D render, painting fallback, or nothing loaded. */
  pic: 'none' | 'loading' | 'room3d' | 'painting';
  crateBox: Graphics;
  activity: number;
  tier: number;
  crate: Text;
  badge: Text;
  badgeBg: Graphics;
  mgr: Container;
  mgrKey: string;
  hint: Text;
  people: Fig[];
}

function roundBox(w: number, h: number, color: number, alpha = 0.92, r = 14): Graphics {
  return new Graphics().roundRect(0, 0, w, h, r).fill({ color, alpha }).stroke({ width: 2, color: 0x000000, alpha: 0.5 });
}

function label(text: string, size: number, color = 0xf3ead8, weight: '400' | '700' | '800' = '700'): Text {
  return new Text({ text, style: { fontFamily: FONT, fontSize: size, fill: color, fontWeight: weight, stroke: { color: 0x000000, width: Math.max(2, size / 7) } } });
}

export class MineView {
  readonly app = new Application();
  readonly world = new Container();
  private rock!: TilingSprite;
  private floorsLayer = new Container();
  private shaftLayer = new Container();
  private surfaceLayer = new Container();
  private peopleLayer = new Container();
  private uiLayer = new Container();
  private fxLayer = new Container();
  private floors: FloorView[] = [];
  private cab!: Sprite;
  private cabText!: Text;
  private cable = new Graphics();
  private landingLamps = new Container();
  private wheel = new Graphics();
  private surfFx = new Particles(false);
  private vendors: Fig[] = [];
  private surface3d: Room3D | null = null;
  private shaftBg = new Graphics();
  private depotText!: Text;
  private elevBadge!: Text;
  private marketBadge!: Text;
  private elevHint!: Text;
  private marketHint!: Text;
  private dig = new Container();
  private digText!: Text;
  private digPreview: Sprite | null = null;
  private porterFigs: Fig[] = [];
  private floats: { t: Text; life: number; vy: number }[] = [];
  private pulses: { g: Graphics; life: number }[] = [];
  private zones: HitZone[] = [];
  camY = 0;
  private velY = 0;
  scale = 1;
  topInset = 0;
  onOpen: (id: StageId) => void = () => {};
  onDig: () => void = () => {};
  /** What the dig slot shows (price, digging progress, or the Command Center level it needs). */
  digInfo: () => { text: string; color: number; progress: number | null } = () => ({ text: '', color: 0xffd36b, progress: null });
  private digBar = new Graphics();
  onTap: (id: StageId) => void = () => {};

  private mine: Mine;

  constructor(mine: Mine) { this.mine = mine; }

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: window, background: 0x0b0a09, antialias: false, autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2), powerPreference: 'high-performance',
    });
    host.appendChild(this.app.canvas);
    const keys = [
      'backdrops/rock', 'backdrops/surface-1', 'kit/car', 'kit/proj-surfaceGate', 'kit/proj-tradeLeague',
      ...Array.from({ length: 14 }, (_, i) => `portraits/p${String(i + 1).padStart(2, '0')}`),
    ];
    await Promise.all(keys.map(k => Assets.load({ alias: k, src: `${ART}${k}.webp`, data: { autoGenerateMipmaps: true } }).catch(() => null)));
    this.meta = await fetch(`${ART}meta.json`).then(r => r.json()).catch(() => ({}));
    await loadPeople();
    this.app.stage.addChild(this.world);
    this.rock = new TilingSprite({ texture: Assets.get('backdrops/rock') ?? Texture.WHITE, width: WORLD_W, height: 100 });
    this.rock.tint = 0x8a8178;
    this.world.addChild(this.rock, this.shaftBg, this.floorsLayer, this.surfaceLayer, this.shaftLayer, this.peopleLayer, this.uiLayer, this.fxLayer);
    this.buildSurface();
    this.buildShaft();
    this.dig.eventMode = 'none';
    this.uiLayer.addChild(this.dig);
    this.rebuildFloors();
    this.mine.on(e => this.onEvent(e));
    this.bindInput();
    window.addEventListener('resize', () => this.layout());
    this.layout();
  }

  private tex(key: string): Texture { return Assets.get(key) ?? Texture.WHITE; }

  private meta: Record<string, { lights?: Light[] }> = {};
  private lights(key: string): Light[] { return this.meta[key]?.lights ?? []; }

  private buildSurface(): void {
    const sky = new Graphics().rect(0, -400, WORLD_W, SURF_H + 400).fill(0x6a7f8c);
    const back = new Sprite(this.tex('backdrops/surface-1'));
    const s = (SURF_H + 40) / back.texture.height;
    back.scale.set(s);
    back.position.set(WORLD_W / 2 - (back.texture.width * s) / 2 - 120, SURF_H + 30 - back.texture.height * s);
    const ground = new Graphics().rect(0, SURF_H - 6, WORLD_W, 40).fill(0x3a3128).rect(0, SURF_H - 6, WORLD_W, 4).fill(0x5a4a38);
    const market = new Sprite(this.tex('kit/proj-tradeLeague'));
    market.scale.set(0.66);
    market.anchor.set(0.5, 1);
    market.position.set(MARKET_X, SURF_H + 8);
    const head = new Sprite(this.tex('kit/proj-surfaceGate'));
    head.anchor.set(0, 1);
    head.scale.set(-0.62, 0.62); // mirrored (extends left of its position) so the tower stands over the shaft on the right
    head.position.set(WORLD_W, SURF_H + 10);
    this.surfaceLayer.addChild(sky, back, ground, market, head);
    void loadRoom3D('surface').then(d => {
      if (!d) return;
      // the pre-rendered surface replaces the painted pieces; its sheave wheel replaces the drawn one
      const r3 = new Room3D(d, WORLD_W, SURF_H);
      for (const o of [sky, back, ground, market, head]) o.visible = false;
      this.surfaceLayer.addChildAt(r3.root, 0);
      this.surface3d = r3;
      this.wheel.visible = false;
    });
    this.depotText = label('', 22);
    this.depotText.anchor.set(0.5, 1);
    this.depotText.position.set(DEPOT_X - 40, SURF_H - 150);
    this.elevBadge = this.badgeText();
    this.marketBadge = this.badgeText();
    this.elevHint = this.hintText();
    this.marketHint = this.hintText();
    this.elevHint.position.set(SHAFT_X + SHAFT_W / 2, SURF_H - 210);
    this.marketHint.position.set(MARKET_X, SURF_H - 190);
    this.uiLayer.addChild(this.depotText, this.elevHint, this.marketHint);
  }

  private badgeText(): Text {
    const t = label('', 24, 0xffffff, '800');
    t.anchor.set(0.5);
    return t;
  }

  private hintText(): Text {
    const t = label('👆 לחץ', 30, 0xffe9a8, '800');
    t.anchor.set(0.5);
    return t;
  }

  private buildShaft(): void {
    this.cab = new Sprite(this.tex('kit/car'));
    this.cab.anchor.set(0.5, 1);
    const w = SHAFT_W - 30;
    this.cab.scale.set(w / this.cab.texture.width);
    void Assets.load<Texture>({ src: `${ART}v2/cab.webp`, data: { autoGenerateMipmaps: true } }).then(t => {
      this.cab.texture = t;
      this.cab.scale.set(w / t.width);
    }).catch(() => null);
    this.cabText = label('', 22);
    this.cabText.anchor.set(0.5, 1);
    this.landingLamps.blendMode = 'add';
    const r = 24;
    this.wheel.circle(0, 0, r).stroke({ width: 5, color: 0x2b2722 });
    for (let k = 0; k < 6; k++) { const a = (k * Math.PI) / 3; this.wheel.moveTo(0, 0).lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    this.wheel.stroke({ width: 3, color: 0x2b2722 }).circle(0, 0, 5).fill(0x55504a);
    this.wheel.position.set(SHAFT_X + SHAFT_W / 2 - r, SURF_H - 236);
    this.shaftLayer.addChild(this.landingLamps, this.cable, this.wheel, this.cab, this.cabText, this.surfFx.layer);
  }

  /** Builds views for floors that exist and the dig slot below them. */
  rebuildFloors(): void {
    for (let i = this.floors.length; i < this.mine.s.floors.length; i++) this.floors.push(this.makeFloor(i));
    const n = this.mine.s.floors.length;
    const next = this.mine.digCost();
    this.dig.removeChildren();
    this.digPreview = null;
    if (next !== null) {
      const y = floorTop(n);
      const prev = new Sprite(Texture.EMPTY);
      const nextArt = FLOORS[n].art;
      void loadRoom3D(nextArt).then(async d => {
        if (d) {
          prev.texture = d.bg;
          prev.scale.set(ROOM_W / d.bg.width, ROOM_H / d.bg.height);
          prev.position.set(0, y);
        } else {
          const key = `rooms/${nextArt}-0`;
          const t = await Assets.load<Texture>({ alias: key, src: `${ART}${key}.webp` }).catch(() => Texture.EMPTY);
          prev.texture = t;
          prev.scale.set(ROOM_W / Math.max(1, t.width));
          prev.position.set(0, y - cropTop(nextArt));
        }
      });
      const pm = new Graphics().rect(0, y, ROOM_W, ROOM_H).fill(0xffffff);
      prev.mask = pm;
      this.dig.addChild(pm);
      prev.alpha = 0.22;
      prev.tint = 0x705a48;
      this.digPreview = prev;
      const box = roundBox(380, 120, 0x2b2117, 0.95, 20);
      box.position.set(ROOM_W / 2 - 190, y + ROOM_H / 2 - 60);
      const title = label(`חפור קומה ${n + 1}: ${FLOORS[n].name}`, 26);
      title.anchor.set(0.5, 0);
      title.position.set(ROOM_W / 2, y + ROOM_H / 2 - 48);
      this.digText = label('', 30, 0xffd36b, '800');
      this.digText.anchor.set(0.5, 0);
      this.digText.position.set(ROOM_W / 2, y + ROOM_H / 2 + 0);
      this.dig.addChild(prev, box, title, this.digText, this.digBar);
    }
    this.layout();
  }

  private makeFloor(i: number): FloorView {
    const root = new Container();
    const y = floorTop(i);
    const f = this.mine.s.floors[i];
    const tier = tierOf(f.lvl);
    const art = FLOORS[i].art;
    const inner = new Container();
    inner.position.set(0, y - cropTop(art));
    const painting = new Sprite(Texture.EMPTY);
    const fx = new RoomFx(art, tier, this.lights(`rooms/${art}-${tier}`), ROOM_W, PAINT_H);
    inner.addChild(painting, fx.root);
    const mask = new Graphics().rect(0, y, ROOM_W, ROOM_H).fill(0xffffff);
    inner.mask = mask;
    const frame = new Graphics()
      .rect(0, y + ROOM_H, WORLD_W, FLOOR_H - ROOM_H).fill(0x2a2520)
      .rect(0, y + ROOM_H, WORLD_W, 3).fill(0x4a4036)
      .rect(ROOM_W - 2, y, 4, ROOM_H).fill({ color: 0x000000, alpha: 0.5 });
    const crateBox = new Graphics()
      .rect(CRATE_X + 4, y + FEET_Y - 44, 50, 44).fill(0x7a5634).stroke({ width: 3, color: 0x3e2a18 })
      .moveTo(CRATE_X + 4, y + FEET_Y - 22).lineTo(CRATE_X + 54, y + FEET_Y - 22).stroke({ width: 3, color: 0x3e2a18 });
    const crate = label('0', 22);
    crate.anchor.set(0.5, 1);
    crate.position.set(CRATE_X + 29, y + FEET_Y - 50);
    const badgeBg = new Graphics();
    const badge = label('', 22, 0xffffff, '800');
    badge.position.set(16, y + 14);
    const mgr = new Container();
    mgr.position.set(14, y + 74);
    const hint = label('👆 לחץ', 34, 0xffe9a8, '800');
    hint.anchor.set(0.5);
    hint.position.set(ROOM_W / 2 - 40, y + ROOM_H * 0.45);
    root.addChild(inner, mask, frame, crateBox, crate);
    // the 3D floor frame (slab, door gap, shaft) once loaded replaces the drawn slab
    void Assets.load<Texture>({ src: `${ART}v2/frame.webp`, data: { autoGenerateMipmaps: true } }).then(t => {
      const fs = new Sprite(t);
      fs.width = WORLD_W;
      fs.height = FLOOR_H;
      fs.position.set(0, y);
      frame.visible = false;
      root.addChildAt(fs, root.getChildIndex(frame));
    }).catch(() => null);
    this.floorsLayer.addChild(root);
    const ui = new Container();
    ui.addChild(badgeBg, badge, mgr, hint);
    this.uiLayer.addChild(ui);
    const fv: FloorView = { root, inner, painting, fx, room3d: null, pic: 'none', crateBox, activity: 0, tier, crate, badge, badgeBg, mgr, mgrKey: '', hint, people: [] };
    inner.visible = false;
    return fv;
  }

  /** Loads a floor's picture when it comes near the screen (the 3D render, else the painting) and frees it far away. */
  private streamFloor(i: number, fv: FloorView): void {
    const top = floorTop(i);
    const vh = this.viewH();
    const near = top + FLOOR_H > this.camY - vh * 1.2 && top < this.camY + vh * 2.2;
    const far = top + FLOOR_H < this.camY - vh * 3 || top > this.camY + vh * 4;
    const art = FLOORS[i].art;
    if (near && fv.pic === 'none') {
      fv.pic = 'loading';
      void loadRoom3D(art).then(async d => {
        if (fv.pic !== 'loading') return;
        if (d) {
          // a pre-rendered 3D room replaces the painting, its effects and the drawn crate (the render has its own)
          const r3 = new Room3D(d, ROOM_W, ROOM_H);
          r3.root.position.set(0, top);
          fv.inner.visible = false;
          fv.crateBox.visible = false;
          fv.root.addChildAt(r3.root, 0);
          fv.room3d = r3;
          fv.pic = 'room3d';
        } else {
          const key = `rooms/${art}-${fv.tier}`;
          const t = await Assets.load<Texture>({ alias: key, src: `${ART}${key}.webp`, data: { autoGenerateMipmaps: true } }).catch(() => Texture.WHITE);
          fv.painting.texture = t;
          fv.painting.scale.set(ROOM_W / t.width);
          fv.inner.visible = true;
          fv.pic = 'painting';
        }
      });
    } else if (far && fv.pic === 'room3d' && fv.room3d) {
      fv.room3d.root.destroy({ children: true });
      fv.room3d = null;
      releaseRoom3D(art);
      fv.crateBox.visible = true;
      fv.pic = 'none';
    }
  }

  private drawManager(fv: { mgr: Container; mgrKey: string }, id: StageId, x = 0, y = 0): void {
    const st = this.mine.stage(id);
    const now = this.mine.s.time;
    const boosting = st.boostUntil > now;
    const ready = this.mine.canBoost(id);
    const key = `${st.mgr}|${boosting}|${ready}`;
    if (key === fv.mgrKey) return;
    fv.mgrKey = key;
    fv.mgr.removeChildren();
    const R = 30;
    const ring = new Graphics().circle(R, R, R + 3).fill(boosting ? 0xffb43a : ready ? 0x7be07b : 0x1d1a16);
    fv.mgr.addChild(ring);
    if (st.mgr) {
      const idx = typeof id === 'number' ? id : id === 'elev' ? 9 : 11;
      const p = new Sprite(this.tex(`portraits/p${String((idx % 14) + 1).padStart(2, '0')}`));
      p.width = p.height = R * 2;
      const m = new Graphics().circle(R, R, R).fill(0xffffff);
      p.mask = m;
      fv.mgr.addChild(p, m);
      if (ready || boosting) {
        const t = label(boosting ? '×2' : '⚡', 20, 0xffffff, '800');
        t.anchor.set(0.5);
        t.position.set(R * 2 - 4, R * 2 - 6);
        fv.mgr.addChild(t);
      }
    } else {
      fv.mgr.addChild(new Graphics().circle(R, R, R).fill(0x3a332b));
      const t = label('מנהל', 17, 0xd9cdb5, '700');
      t.anchor.set(0.5);
      t.position.set(R, R);
      fv.mgr.addChild(t);
    }
    fv.mgr.position.set(x || fv.mgr.position.x, y || fv.mgr.position.y);
  }

  private elevMgr = { mgr: new Container(), mgrKey: '' };
  private marketMgr = { mgr: new Container(), mgrKey: '' };
  private elevBadgeBg = new Graphics();
  private marketBadgeBg = new Graphics();

  layout(): void {
    const w = this.app.screen.width;
    this.scale = w / WORLD_W;
    this.world.scale.set(this.scale);
    const bottom = this.worldBottom();
    this.rock.position.set(0, SURF_H);
    this.rock.height = bottom - SURF_H + 200;
    this.rock.tileScale.set(0.8);
    this.shaftBg.clear()
      .rect(SHAFT_X, SURF_H - 4, SHAFT_W, bottom - SURF_H).fill(0x141210)
      .rect(SHAFT_X + 8, SURF_H, 6, bottom - SURF_H).fill(0x3a342c)
      .rect(SHAFT_X + SHAFT_W - 14, SURF_H, 6, bottom - SURF_H).fill(0x3a342c);
    for (let y = SURF_H + 30; y < bottom; y += 72) {
      this.shaftBg.moveTo(SHAFT_X + 14, y).lineTo(SHAFT_X + SHAFT_W - 14, y + 36).stroke({ width: 3, color: 0x2a251f })
        .moveTo(SHAFT_X + SHAFT_W - 14, y).lineTo(SHAFT_X + 14, y + 36).stroke({ width: 3, color: 0x2a251f });
    }
    this.landingLamps.removeChildren();
    for (let i = 0; i < this.mine.s.floors.length; i++) {
      const y = floorTop(i);
      this.shaftBg.rect(ROOM_W, y + ROOM_H * 0.5, SHAFT_X - ROOM_W + 4, ROOM_H * 0.5).fill(0x221d18)
        .rect(SHAFT_X, y + ROOM_H, SHAFT_W, 8).fill(0x4a4036);
      const lamp = new Sprite(softDot());
      lamp.anchor.set(0.5);
      lamp.tint = 0xffc070;
      lamp.width = lamp.height = 90;
      lamp.alpha = 0;
      lamp.position.set(SHAFT_X + 10, y + 40);
      this.landingLamps.addChild(lamp);
    }
    if (!this.uiLayer.children.includes(this.elevMgr.mgr)) {
      this.uiLayer.addChild(this.elevBadgeBg, this.elevBadge, this.elevMgr.mgr, this.marketBadgeBg, this.marketBadge, this.marketMgr.mgr);
    }
    this.clampCam();
  }

  worldBottom(): number {
    const n = this.mine.s.floors.length + (this.mine.digCost() !== null ? 1 : 0);
    return floorTop(n) + 40;
  }

  private viewH(): number { return this.app.screen.height / this.scale; }

  private clampCam(): void {
    const min = 120 - this.topInset / this.scale;
    const max = Math.max(min, this.worldBottom() - this.viewH());
    this.camY = Math.min(max, Math.max(min, this.camY));
    this.world.position.y = -this.camY * this.scale;
  }

  setCam(y: number): void { this.camY = y; this.velY = 0; this.clampCam(); }

  /** Scrolls so floor i is in view (used after digging). */
  focusFloor(i: number): void {
    this.camY = floorTop(i) - this.viewH() * 0.35;
    this.velY = 0;
    this.clampCam();
  }

  // --- input: drag to scroll, tap = the first zone under the finger ---
  private bindInput(): void {
    const c = this.app.canvas;
    let down: { x: number; y: number; cam: number; t: number } | null = null;
    let dragging = false;
    let lastY = 0;
    let lastT = 0;
    c.addEventListener('pointerdown', e => {
      down = { x: e.clientX, y: e.clientY, cam: this.camY, t: performance.now() };
      dragging = false;
      lastY = e.clientY;
      lastT = performance.now();
      this.velY = 0;
    });
    window.addEventListener('pointermove', e => {
      if (!down) return;
      if (!dragging && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) dragging = true;
      if (dragging) {
        this.camY = down.cam - (e.clientY - down.y) / this.scale;
        const now = performance.now();
        const dtm = Math.max(1, now - lastT);
        this.velY = (-(e.clientY - lastY) / this.scale / dtm) * 1000;
        lastY = e.clientY;
        lastT = now;
        this.clampCam();
      }
    });
    window.addEventListener('pointerup', e => {
      if (down && !dragging) this.tapAt(e.clientX, e.clientY);
      if (performance.now() - lastT > 80) this.velY = 0;
      down = null;
    });
    c.addEventListener('wheel', e => { this.camY += e.deltaY / this.scale; this.clampCam(); }, { passive: true });
  }

  private tapAt(sx: number, sy: number): void {
    const r = this.app.canvas.getBoundingClientRect();
    const wx = (sx - r.left) / this.scale;
    const wy = (sy - r.top) / this.scale + this.camY;
    const z = this.zones.find(z => wx >= z.x && wx <= z.x + z.w && wy >= z.y && wy <= z.y + z.h);
    if (z) z.action();
  }

  private zonesFor(): HitZone[] {
    const zs: HitZone[] = [];
    const n = this.mine.s.floors.length;
    for (let i = 0; i < n; i++) {
      const y = floorTop(i);
      zs.push({ x: 0, y: y, w: 250, h: 140, action: () => this.onOpen(i) });
    }
    zs.push({ x: SHAFT_X - 150, y: SURF_H - 334, w: 310, h: 76, action: () => this.onOpen('elev') });
    zs.push({ x: MARKET_X - 150, y: SURF_H - 334, w: 340, h: 76, action: () => this.onOpen('market') });
    if (this.mine.digCost() !== null) zs.push({ x: 0, y: floorTop(n), w: ROOM_W, h: ROOM_H, action: () => this.onDig() });
    for (let i = 0; i < n; i++) zs.push({ x: 0, y: floorTop(i), w: ROOM_W, h: ROOM_H, action: () => this.onTap(i) });
    zs.push({ x: SHAFT_X - 20, y: SURF_H - 260, w: SHAFT_W + 20, h: this.worldBottom() - SURF_H + 260, action: () => this.onTap('elev') });
    zs.push({ x: 0, y: SURF_H - 250, w: SHAFT_X - 20, h: 250, action: () => this.onTap('market') });
    return zs;
  }

  // --- juice ---
  private onEvent(e: MineEvent): void {
    if (e.kind === 'sell') this.float(`+${big(e.amount)}`, e.x, SURF_H - 120, 0xffd36b, 34);
    else if (e.kind === 'deposit') this.float(`+${big(e.amount)}`, CRATE_X + 29, floorTop(e.floor) + FEET_Y - 80, 0xffffff, 22);
    else if (e.kind === 'upgrade') this.pulseStage(e.stage);
    else if (e.kind === 'dig') { this.rebuildFloors(); this.focusFloor(e.floor); this.pulseStage(e.floor); }
    else if (e.kind === 'hire' || e.kind === 'boost') this.pulseStage(e.stage);
  }

  float(text: string, x: number, y: number, color: number, size: number): void {
    const t = label(text, size, color, '800');
    t.anchor.set(0.5);
    t.position.set(x, y);
    this.fxLayer.addChild(t);
    this.floats.push({ t, life: 1.2, vy: -60 });
  }

  private pulseStage(id: StageId): void {
    const g = new Graphics();
    if (typeof id === 'number') g.rect(0, floorTop(id), ROOM_W, ROOM_H).fill({ color: 0xffe08a, alpha: 0.35 });
    else if (id === 'elev') g.rect(SHAFT_X, SURF_H - 300, SHAFT_W, 300).fill({ color: 0xffe08a, alpha: 0.35 });
    else g.rect(0, SURF_H - 260, SHAFT_X, 260).fill({ color: 0xffe08a, alpha: 0.35 });
    g.blendMode = 'add';
    this.fxLayer.addChild(g);
    this.pulses.push({ g, life: 0.5 });
  }

  // --- per frame ---
  update(dt: number): void {
    if (Math.abs(this.velY) > 5) {
      this.camY += this.velY * dt;
      this.velY *= Math.pow(0.04, dt);
      this.clampCam();
    }
    const m = this.mine;
    const s = m.s;
    const now = s.time;
    const blink = 0.75 + 0.25 * Math.sin(now * 6);
    s.floors.forEach((f, i) => {
      const fv = this.floors[i];
      const tier = tierOf(f.lvl);
      this.streamFloor(i, fv);
      if (tier !== fv.tier) {
        fv.tier = tier;
        if (fv.pic === 'painting') {
          const key = `rooms/${FLOORS[i].art}-${tier}`;
          void Assets.load<Texture>({ alias: key, src: `${ART}${key}.webp` }).then(t => { fv.painting.texture = t; }).catch(() => null);
        }
        fv.fx.root.destroy({ children: true });
        fv.fx = new RoomFx(FLOORS[i].art, tier, this.lights(`rooms/${FLOORS[i].art}-${tier}`), ROOM_W, PAINT_H);
        fv.inner.addChild(fv.fx.root);
      }
      fv.crate.text = big(f.crate);
      const afford = m.upgradeCost(i, 1) <= s.cash;
      this.drawBadge(fv.badgeBg, fv.badge, `${FLOORS[i].name}  ·  רמה ${f.lvl}${afford ? '  ⬆' : ''}`, 10, floorTop(i) + 8, afford);
      this.drawManager(fv, i);
      fv.hint.visible = m.idle(i);
      fv.hint.alpha = blink;
      const ws = m.workers[i];
      while (fv.people.length < ws.length) {
        const fig = makeFig(pick(['man', 'woman', 'man', 'woman', 'elder'] as BodyKind[]));
        fv.people.push(fig);
        this.peopleLayer.addChild(fig.root);
      }
      const working = ws.filter(w => w.phase !== 'idle').length / ws.length;
      fv.activity += (working - fv.activity) * Math.min(1, dt * 3);
      if (fv.room3d) fv.room3d.update(dt, fv.activity);
      else fv.fx.update(dt, fv.activity);
      const feet = floorTop(i) + FEET_Y;
      ws.forEach((w, k) => {
        const anim: Anim3 = w.phase === 'out' ? 'walk' : w.phase === 'back' ? 'walkCarry' : w.phase === 'work' ? WORK_ANIM[FLOORS[i].art] ?? 'hammer' : 'idle';
        const right = w.phase === 'back' || w.phase === 'idle';
        fv.people[k].update(dt, w.x, feet + (k % 2) * 6, anim, w.phase === 'work' ? k % 2 === 0 : right);
      });
    });
    // elevator
    const e = m.elev;
    this.cab.position.set(SHAFT_X + SHAFT_W / 2, e.y);
    this.cabText.text = e.carry > 0 ? big(e.carry) : '';
    this.cabText.position.set(SHAFT_X + SHAFT_W / 2, e.y - this.cab.height - 4);
    this.wheel.rotation = -e.y / 24;
    const moving = e.phase === 'down' || e.phase === 'up';
    this.surface3d?.update(dt, moving ? 1 : 0.25);
    this.cable.clear().moveTo(SHAFT_X + SHAFT_W / 2, this.surface3d ? SURF_H - 8 - 6.6 * 54 : SURF_H - 236).lineTo(SHAFT_X + SHAFT_W / 2, e.y - this.cab.height).stroke({ width: 3, color: 0x15120e });
    // surface
    this.depotText.text = s.depot >= 1 ? `📦 ${big(s.depot)}` : '';
    const eAfford = m.upgradeCost('elev', 1) <= s.cash;
    const mAfford = m.upgradeCost('market', 1) <= s.cash;
    this.drawBadge(this.elevBadgeBg, this.elevBadge, `מעלית · רמה ${s.elev.lvl}${eAfford ? ' ⬆' : ''}`, SHAFT_X - 180, SURF_H - 320, eAfford, true);
    this.drawBadge(this.marketBadgeBg, this.marketBadge, `שוק · רמה ${s.market.lvl}${mAfford ? ' ⬆' : ''}`, MARKET_X - 140, SURF_H - 320, mAfford, true);
    this.drawManager(this.elevMgr, 'elev', SHAFT_X + 78, SURF_H - 326);
    this.drawManager(this.marketMgr, 'market', MARKET_X + 112, SURF_H - 326);
    this.elevHint.visible = m.idle('elev') && s.floors.some(f => f.crate >= 1);
    this.marketHint.visible = m.idle('market') && s.depot >= 1;
    this.elevHint.alpha = this.marketHint.alpha = blink;
    while (this.porterFigs.length < m.porters.length) {
      const fig = makeFig(pick(['man', 'woman'] as BodyKind[]));
      this.porterFigs.push(fig);
      this.peopleLayer.addChild(fig.root);
    }
    m.porters.forEach((p, k) => {
      const anim: Anim3 = p.phase === 'go' ? 'walkCarry' : p.phase === 'back' ? 'walk' : 'idle';
      this.porterFigs[k].update(dt, p.x + (p.phase === 'idle' ? -k * 18 : 0), SURF_H - 6 + (k % 2) * 4, anim, p.phase === 'back' || p.phase === 'idle');
    });
    while (this.vendors.length < 2) {
      const fig = makeFig(this.vendors.length ? 'elder' : 'woman');
      this.vendors.push(fig);
      this.peopleLayer.addChildAt(fig.root, 0);
    }
    this.vendors[0].update(dt, MARKET_X - 70, SURF_H - 10, 'idle', true);
    this.vendors[1].update(dt, MARKET_X + 80, SURF_H - 10, this.mine.porters.some(p => p.phase === 'sell') ? 'talk' : 'look', false);
    if (Math.random() < dt * 2.5) this.surfFx.spawn({ x: Math.random() * WORLD_W, y: SURF_H - 10 - Math.random() * 60, vx: 14 + Math.random() * 10, vy: -3, life: 4, size: 10, color: 0xc8b090, alpha: 0.18, grow: 6 });
    if (e.phase === 'down' || e.phase === 'up') {
      if (Math.random() < dt * 6) this.surfFx.spawn({ x: SHAFT_X + SHAFT_W / 2 + (Math.random() - 0.5) * 100, y: e.y - this.cab.height * Math.random(), vy: e.phase === 'down' ? -30 : 30, life: 0.8, size: 6, color: 0x9a8a70, alpha: 0.3 });
    }
    this.surfFx.update(dt);
    // dig slot
    const dc = m.digCost();
    if (dc !== null && this.digText) {
      const info = this.digInfo();
      if (this.digText.text !== info.text) this.digText.text = info.text;
      this.digText.style.fill = info.color;
      const y = floorTop(s.floors.length) + ROOM_H / 2 + 40;
      this.digBar.clear();
      if (info.progress !== null) {
        this.digBar.roundRect(ROOM_W / 2 - 150, y, 300, 14, 7).fill({ color: 0x000000, alpha: 0.6 })
          .roundRect(ROOM_W / 2 - 150, y, 300 * Math.min(1, info.progress), 14, 7).fill(0xffb43a);
      }
    }
    // fx
    for (let k = this.floats.length - 1; k >= 0; k--) {
      const f = this.floats[k];
      f.life -= dt;
      f.t.y += f.vy * dt;
      f.t.alpha = Math.min(1, f.life * 2);
      if (f.life <= 0) { f.t.destroy(); this.floats.splice(k, 1); }
    }
    for (let k = this.pulses.length - 1; k >= 0; k--) {
      const p = this.pulses[k];
      p.life -= dt;
      p.g.alpha = Math.max(0, p.life * 2);
      if (p.life <= 0) { p.g.destroy(); this.pulses.splice(k, 1); }
    }
    this.zones = this.zonesFor();
  }

  private badgeCache = new Map<Text, string>();

  private drawBadge(bg: Graphics, t: Text, text: string, x: number, y: number, hot: boolean, center = false): void {
    const key = `${text}|${hot}`;
    if (this.badgeCache.get(t) === key) return;
    this.badgeCache.set(t, key);
    t.text = text;
    t.anchor.set(0, 0);
    const w = t.width + 28;
    const bx = center ? x + 140 - w / 2 : x;
    t.position.set(bx + 14, y + 12);
    // a riveted metal plate: drop shadow, dark body, lit top edge; affordable = a green glow edge
    bg.clear()
      .roundRect(bx + 2, y + 5, w, 50, 14).fill({ color: 0x000000, alpha: 0.45 })
      .roundRect(bx, y, w, 50, 14).fill({ color: hot ? 0x22401f : 0x1b1611, alpha: 0.95 })
      .stroke({ width: 2.5, color: hot ? 0x8fe38a : 0x6d5a42, alpha: 0.95 })
      .roundRect(bx + 4, y + 3, w - 8, 3, 2).fill({ color: 0xffffff, alpha: hot ? 0.22 : 0.12 })
      .circle(bx + 7, y + 25, 2.2).fill({ color: 0xb59a72, alpha: 0.8 })
      .circle(bx + w - 7, y + 25, 2.2).fill({ color: 0xb59a72, alpha: 0.8 });
  }
}
