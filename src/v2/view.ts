// v2 view: the mine as one vertical Pixi scene (surface with headframe and market, floors as room paintings, the shaft).
// Reads the Mine's state every frame; taps are resolved against plain world rectangles (no Pixi hit testing).
import { Application, Assets, Container, Graphics, Sprite, Text, Texture, TilingSprite } from 'pixi.js';
import { Body3D, bodyData, type Anim3, type BodyKind } from '../rendering/people3d.ts';
import { FLOORS, tierOf } from './econ.ts';
import { big } from './format.ts';
import {
  CRATE_X, DEPOT_X, FLOOR_H, MARKET_X, Mine, ROOM_H, ROOM_W, SHAFT_W, SHAFT_X, SURF_H, WORLD_W, floorTop, stopY,
  type MineEvent, type StageId,
} from './mine.ts';

const ART = `${import.meta.env.BASE_URL}art/`;
const FONT = 'Rubik, system-ui, sans-serif';
/** Feet line inside a room painting (fraction of the painting height). */
const FEET = 0.9;
const PERSON_SCALE = 1.25;
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
  painting: Sprite;
  tier: number;
  crate: Text;
  badge: Text;
  badgeBg: Graphics;
  mgr: Container;
  mgrKey: string;
  hint: Text;
  people: Figure[];
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
  private shaftBg = new Graphics();
  private depotText!: Text;
  private elevBadge!: Text;
  private marketBadge!: Text;
  private elevHint!: Text;
  private marketHint!: Text;
  private dig = new Container();
  private digText!: Text;
  private digPreview: Sprite | null = null;
  private porterFigs: Figure[] = [];
  private floats: { t: Text; life: number; vy: number }[] = [];
  private pulses: { g: Graphics; life: number }[] = [];
  private zones: HitZone[] = [];
  camY = 0;
  private velY = 0;
  scale = 1;
  topInset = 0;
  onOpen: (id: StageId) => void = () => {};
  onDig: () => void = () => {};
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
      ...FLOORS.flatMap(f => [0, 1, 2].map(t => `rooms/${f.art}-${t}`)),
      ...Array.from({ length: 14 }, (_, i) => `portraits/p${String(i + 1).padStart(2, '0')}`),
    ];
    await Promise.all(keys.map(k => Assets.load({ alias: k, src: `${ART}${k}.webp`, data: { autoGenerateMipmaps: true } }).catch(() => null)));
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
    this.cabText = label('', 22);
    this.cabText.anchor.set(0.5, 1);
    this.shaftLayer.addChild(this.cable, this.cab, this.cabText);
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
      const prev = new Sprite(this.tex(`rooms/${FLOORS[n].art}-0`));
      prev.scale.set(ROOM_W / prev.texture.width);
      prev.position.set(0, y);
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
      this.dig.addChild(prev, box, title, this.digText);
    }
    this.layout();
  }

  private makeFloor(i: number): FloorView {
    const root = new Container();
    const y = floorTop(i);
    const f = this.mine.s.floors[i];
    const tier = tierOf(f.lvl);
    const painting = new Sprite(this.tex(`rooms/${FLOORS[i].art}-${tier}`));
    painting.scale.set(ROOM_W / painting.texture.width);
    painting.position.set(0, y);
    const frame = new Graphics()
      .rect(0, y + ROOM_H, WORLD_W, FLOOR_H - ROOM_H).fill(0x2a2520)
      .rect(0, y + ROOM_H, WORLD_W, 3).fill(0x4a4036)
      .rect(ROOM_W - 2, y, 4, ROOM_H).fill({ color: 0x000000, alpha: 0.5 });
    const crateBox = new Graphics()
      .rect(CRATE_X + 4, y + ROOM_H * FEET - 44, 50, 44).fill(0x7a5634).stroke({ width: 3, color: 0x3e2a18 })
      .moveTo(CRATE_X + 4, y + ROOM_H * FEET - 22).lineTo(CRATE_X + 54, y + ROOM_H * FEET - 22).stroke({ width: 3, color: 0x3e2a18 });
    const crate = label('0', 22);
    crate.anchor.set(0.5, 1);
    crate.position.set(CRATE_X + 29, y + ROOM_H * FEET - 50);
    const badgeBg = new Graphics();
    const badge = label('', 22, 0xffffff, '800');
    badge.position.set(16, y + 14);
    const mgr = new Container();
    mgr.position.set(14, y + 74);
    const hint = label('👆 לחץ', 34, 0xffe9a8, '800');
    hint.anchor.set(0.5);
    hint.position.set(ROOM_W / 2 - 40, y + ROOM_H * 0.45);
    root.addChild(painting, frame, crateBox, crate);
    this.floorsLayer.addChild(root);
    const ui = new Container();
    ui.addChild(badgeBg, badge, mgr, hint);
    this.uiLayer.addChild(ui);
    return { root, painting, tier, crate, badge, badgeBg, mgr, mgrKey: '', hint, people: [] };
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
    for (let i = 0; i < this.mine.s.floors.length; i++) {
      const y = floorTop(i);
      this.shaftBg.rect(ROOM_W, y + ROOM_H * 0.55, SHAFT_X - ROOM_W + 4, ROOM_H * 0.45).fill(0x221d18);
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
    else if (e.kind === 'deposit') this.float(`+${big(e.amount)}`, CRATE_X + 29, floorTop(e.floor) + ROOM_H * FEET - 80, 0xffffff, 22);
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
      if (tier !== fv.tier) {
        fv.tier = tier;
        fv.painting.texture = this.tex(`rooms/${FLOORS[i].art}-${tier}`);
      }
      fv.crate.text = big(f.crate);
      const afford = m.upgradeCost(i, 1) <= s.cash;
      this.drawBadge(fv.badgeBg, fv.badge, `${FLOORS[i].name}  ·  רמה ${f.lvl}${afford ? '  ⬆' : ''}`, 10, floorTop(i) + 8, afford);
      this.drawManager(fv, i);
      fv.hint.visible = m.idle(i);
      fv.hint.alpha = blink;
      const ws = m.workers[i];
      while (fv.people.length < ws.length) {
        const fig = new Figure(pick(['man', 'woman', 'man', 'woman', 'elder'] as BodyKind[]));
        fv.people.push(fig);
        this.peopleLayer.addChild(fig.root);
      }
      const feet = floorTop(i) + ROOM_H * FEET;
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
    this.cable.clear().moveTo(SHAFT_X + SHAFT_W / 2, SURF_H - 230).lineTo(SHAFT_X + SHAFT_W / 2, e.y - this.cab.height).stroke({ width: 3, color: 0x15120e });
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
      const fig = new Figure(pick(['man', 'woman'] as BodyKind[]));
      this.porterFigs.push(fig);
      this.peopleLayer.addChild(fig.root);
    }
    m.porters.forEach((p, k) => {
      const anim: Anim3 = p.phase === 'go' ? 'walkCarry' : p.phase === 'back' ? 'walk' : 'idle';
      this.porterFigs[k].update(dt, p.x + (p.phase === 'idle' ? -k * 18 : 0), SURF_H + 2 + (k % 2) * 5, anim, p.phase === 'back' || p.phase === 'idle');
    });
    // dig slot
    const dc = m.digCost();
    if (dc !== null && this.digText) {
      this.digText.text = `⛏ ${big(dc)}`;
      this.digText.style.fill = dc <= s.cash ? 0x9cf09c : 0xffd36b;
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
    bg.clear().roundRect(bx, y, w, 50, 16).fill({ color: hot ? 0x2f6b2f : 0x1f1a15, alpha: 0.92 }).stroke({ width: 2, color: hot ? 0x9cf09c : 0x000000, alpha: 0.7 });
  }
}
