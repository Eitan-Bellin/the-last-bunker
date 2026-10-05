import { Application, ColorMatrixFilter, Container, Graphics, Rectangle, Text, TextStyle } from 'pixi.js';
import type { IconName } from '../ui/icons';
import type { EraDef } from '../data/eras';
import type { BuildingInstance, GameState, Position, Ruin, SurvivorState } from '../core/GameState';
import { effectiveLevel, getDef, isDistrict, roomFloors, roomSlots } from '../data/buildingDefs';
import { SLOTS_PER_FLOOR } from '../systems/BuildingSystem';
import { i18n } from '../i18n/I18nManager';
import { BUILDING_W, DEPTH_X, DISTRICT_X, FLOOR_H, ROOM_H, SIDE_MARGIN, SLAB, SLOT_W, buildingH, buildingX, floorTop, slotX } from './layout';
import { hashString, seeded } from './draw';
import { buildConstructionVisual, buildPaintedConstruction, buildRoomVisual, buildScaffold, type RoomVisual } from './roomArt';
import { PEOPLE_STYLE, Person, ROOM_ACTIVITY, type Activity, type Lane } from './people';
import { crowdFor, settleCrowds } from './workSpots'; // gfx-p0 people
import { ProjectSites, type SiteInfo } from './projectSites';
import { AMBIENCE_FOR, type AmbienceKey } from '../audio/ambience';
import type { AmbienceMix } from '../audio/AudioEngine';
import { Dust, buildDigSign, buildShaft, buildSurface, buildUnderground, buildUtilities, type Animated } from './world';
import { buildShaft2 } from './shaft';
import { buildSurface2, mountSurface2, surface2Sig } from './surface2'; // [gfx2 surface]
import { buildPaintedRoom, roomFlicker, setRoomFxQuality } from './paintedRoom'; // gfx-p0 rooms: quality
import { lineWidth, richLine } from './richText';
import { ArtLibrary } from '../art/ArtLibrary';
import { artEntry, buildingArtKey, roomTier, ruinArtKey } from '../art/registry';
import { buildCityMap, type CityMap } from './cityMap';
import { PostFX, startQuality, targetResolution } from './postfx';
import { isLiteMode, logCrash } from '../core/crashGuard';
import { isTouchDevice } from '../utils/device';
import { coneTexture } from '../art/ArtLibrary';
import { buildRuinVisual, type RuinVisual } from './ruinArt';
import { iconSprite } from './richText';
import { glowTexture, moteTexture } from '../art/ArtLibrary';
import { Sprite } from 'pixi.js';
import { IncidentLayer, DisasterLayer } from './incidentFx';
import { PopulationSystem } from '../systems/PopulationSystem';
/** [Danger C5] Only used to turn a stored name into its Hebrew form for the plaque. */
const NAME_LOCALIZER = new PopulationSystem();
import { setPopupBlocker } from '../ui/components/NumberPopup'; // [camera]
import { buildDecals, type DecalLayer } from './decals'; // [gfx2 wear]
import { buildAtmosphere, type Atmosphere } from './atmosphere'; // [gfx2 wear]
import { specOf } from '../data/specializations';
import { ROOMS_W, ROOMS_X } from './layout';
import { buildSignage, sprayOutline, steelTag, tagLamp } from './signage';
import { KIT_KEYS, buildBays,buildCasing, buildFrontStructure, depthGains, structureAmbient, gfx2Enabled, kitReady, kitState, occupancy, type WorldLamp } from './structure';

const DRAG_THRESHOLD = 6;
const HUD_TOP = 150;
const HUD_BOTTOM = 72;
const VIEW_TOP = -140;
const MAX_ZOOM = 3;
// [camera] Feel constants: glide friction (1/s), edge spring and focus spring (rad/s, critically damped),
// shake size at full trauma (screen px), double-tap window.
const FRICTION = 4.2;
const EDGE_SPRING = 13;
const FOCUS_SPRING = 7.5;
const ZOOM_SPRING = 14;
const SHAKE_PX = 16;
const DOUBLE_TAP_MS = 320;

interface RoomView {
  root: Container;
  visualHolder: Container;
  visual: RoomVisual | null;
  /** Previous look fading out after the room changed tier. */
  oldVisual: Container | null;
  fade: number;
  scaffold: RoomVisual | null;
  people: Container;
  outline: Graphics;
  label: Container;
  progress: Graphics | null;
  visualSig: string;
  labelSig: string;
  lane: Lane;
  width: number;
  height: number;
  /** Off screen this frame: not drawn and not animated. */
  culled?: boolean;
}

interface RuinView {
  root: Container;
  visual: RuinVisual | null;
  people: Container;
  label: Container;
  visualSig: string;
  labelSig: string;
  lane: Lane;
  width: number;
  bar: Graphics | null;
}

interface Burst {
  s: Sprite;
  vx: number;
  vy: number;
  life: number;
  max: number;
}

const nameStyle = new TextStyle({ fontFamily: 'Rubik, sans-serif', fontSize: 10, fontWeight: '600', fill: 0xffffff });

export class BunkerRenderer {
  app = new Application();
  readonly worldContainer = new Container();
  private surface: Animated | null = null;
  private surfaceHolder = new Container();
  private surfaceEra = -1;
  private surfaceSig = '';
  private gloom = 0.3;
  private structureGloom = -1;
  private undergroundHolder = new Container();
  private slotLayer = new Container();
  private highlightLayer = new Graphics();
  private roomLayer = new Container();
  private shaftHolder = new Container();
  private shaft: Animated | null = null;
  private utilitiesHolder = new Container();
  private utilities: Animated | null = null;
  /** Graphics overhaul switch: the painted structure kit instead of flat shapes. */
  readonly gfx2 = gfx2Enabled();
  private bayHolder = new Container();
  private front: Animated | null = null;
  /** [gfx2 wear] Story-telling decals and the living atmosphere (decals.ts, atmosphere.ts). */
  private decals: DecalLayer | null = null;
  private atmo: Atmosphere | null = null;
  /** Each room's light colour, used to tint the people inside it. */
  private roomLight = new Map<string, number>();
  private dust = new Dust();
  private labelLayer = new Container();
  private digHolder = new Container();

  private camX = BUILDING_W / 2;
  private camY = 0;
  private baseZoom = 1;
  private zoom = 1;
  private isDragging = false;
  private pointerDown = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private camStartX = 0;
  private camStartY = 0;
  // [camera] Camera physics (see the camera section after setupCamera): velocities in world units/s, zoom in ln-space.
  private camVX = 0;
  private camVY = 0;
  private zoomV = 0;
  private focusTarget: { x: number; y: number; z: number } | null = null;
  private wheelZoom: number | null = null;
  private zoomAnchorX = 0;
  private zoomAnchorY = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { d0: number; z0: number; wx: number; wy: number } | null = null;
  /** Last pointer positions (t, x, y) × 8 for the release velocity. */
  private samples = new Float64Array(24);
  private sampleN = 0;
  private downAt = 0;
  private lastTap = { t: 0, x: 0, y: 0 };
  private swallowClickUntil = 0;
  /** Screen px at the bottom covered by an open sheet; the camera may rest lower while it is open. */
  private bottomInset = 0;
  private framedId: string | null = null;
  /** Rooms (or floors, for a blackout) with an active incident: popups stay out of them. */
  private blockRects: { x: number; y: number; w: number; h: number }[] = [];
  private blockN = 0;
  private insetCheck = 0;
  private bnd = { x0: 0, x1: 0, y0: 0, y1: 0 };
  private trauma = 0;
  private traumaDecay = 1;
  private punchT = 9;
  private punchAmt = 0;
  private punchDX = 0;
  private punchDY = 0;
  private readonly calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  private views = new Map<string, RoomView>();
  private ruinViews = new Map<string, RuinView>();
  private fxLayer = new Container();
  private bursts: Burst[] = [];
  private grade = new ColorMatrixFilter();
  private gradeNow = { r: 1, g: 1, b: 1, saturation: 1, brightness: 1, contrast: 1 };
  private gradeTarget = { r: 1, g: 1, b: 1, saturation: 1, brightness: 1, contrast: 1 };
  private gradeDirty = true;
  private people = new Map<string, Person>();
  private selectedId: string | null = null;
  private floors = 0;
  private utilitiesSig = '';
  private digSig = '';
  private time = 0;
  private lastFrame = performance.now();

  onTileClick: ((pos: Position) => void) | null = null;
  onBuildingClick: ((buildingId: string) => void) | null = null;
  onDigClick: (() => void) | null = null;
  onRuinClick: ((ruinId: string) => void) | null = null;
  /** Tap on a big project's lot on the surface. */
  onProjectClick: ((projectId: string) => void) | null = null;
  /** Big projects on the surface: scaffolding while they are built, the building when done, and the crew at work. */
  private projectSites = new ProjectSites();
  /** A survivor was carried by the player and dropped on a room or ruin (null = empty space). */
  onPersonDrop: ((survivorId: string, targetId: string | null) => void) | null = null;
  onPersonTap: ((survivorId: string) => void) | null = null;
  /** Localized display name for close-up tags. */
  nameOf: ((s: { name: string }) => string) | null = null;
  private drag: { person: Person; survivorId: string; pointerId: number } | null = null;
  private pressTimer = 0;
  private nightNow = 0;
  private sleepMarks = new Map<string, Container>();
  private bubbles = new Map<string, Container>();
  onBubbleTap: ((buildingId: string) => void) | null = null;
  readonly incidents = new IncidentLayer();
  /** [Danger] disaster countdown washes and rust on worn rooms. */
  private disasterFx = new DisasterLayer();
  postfx: PostFX | null = null;

  /**
   * [camera] Camera shake for big moments (a crisis breaking out, a new era, the drill): adds trauma; the shake is
   * trauma² × smooth noise, so it starts at about `amount` screen px and eases out over `seconds`.
   * Strong shakes (≥ 4) also land a downward kick and a zoom punch.
   */
  shake(amount: number, seconds: number): void {
    const t = Math.min(1, Math.sqrt(Math.max(0, amount) / SHAKE_PX));
    if (t >= this.trauma) {
      this.trauma = t;
      this.traumaDecay = t / Math.max(0.05, seconds);
    } else this.trauma = Math.min(1, this.trauma + t * 0.25);
    if (amount >= 4) this.punch(amount / 5, 0, 1);
  }

  /**
   * [camera] A short zoom punch (+3% × strength, ~120 ms, springs back) with an optional directional kick
   * (screen direction, ~6 px × strength). For build complete, collect, crisis start.
   */
  punch(strength = 1, dirX = 0, dirY = 0): void {
    const s = Math.min(2.5, strength) * (this.calm ? 0.4 : 1);
    // A punch already in flight keeps the stronger one.
    if (this.punchT < 0.12 && this.punchAmt >= 0.03 * s) return;
    this.punchT = 0;
    this.punchAmt = 0.03 * s;
    const len = Math.hypot(dirX, dirY) || 1;
    this.punchDX = (dirX / len) * 6 * s;
    this.punchDY = (dirY / len) * 6 * s;
  }
  private floaters: { s: Sprite; vy: number; life: number; max: number; vx: number }[] = [];

  /** [camera] Is a world point inside the current view? */
  private onScreen(x: number, y: number): boolean {
    const sx = this.worldContainer.x + x * this.worldContainer.scale.x;
    const sy = this.worldContainer.y + y * this.worldContainer.scale.y;
    return sx > 0 && sx < this.app.screen.width && sy > HUD_TOP * 0.5 && sy < this.app.screen.height - HUD_BOTTOM * 0.5;
  }

  /** World rectangle of a room (for effects and focusing). */
  roomRect(buildingId: string): { x: number; y: number; w: number; h: number } | null {
    const v = this.views.get(buildingId);
    return v ? { x: v.root.x, y: v.root.y, w: v.width, h: v.height } : null;
  }

  /** Zoom detail level: far = live city map, close = name tags. */
  private lod: 'far' | 'mid' | 'close' = 'mid';
  private cityMap: CityMap | null = null;
  private cityMapSig = '';
  private extentR = BUILDING_W;
  private districtSignHolder = new Container();
  private districtSig = '';
  private undergroundSig = '';
  onDistrictDig: (() => void) | null = null;
  onElevator: (() => void) | null = null;
  /** Fires when the zoom detail level changes. */
  onLodChange: ((lod: 'far' | 'mid' | 'close') => void) | null = null;

  get zoomLevel(): 'far' | 'mid' | 'close' {
    return this.lod;
  }

  /** The dashed outline beyond the east wall inviting the next sideways tunnel. */
  setDistrictSign(info: { floor: number; text: string; cost: string } | null): void {
    const sig = info ? `${info.floor}|${info.text}|${info.cost}` : '';
    if (sig === this.districtSig) return;
    this.districtSig = sig;
    this.districtSignHolder.removeChildren().forEach(c => c.destroy({ children: true }));
    if (!info) return;
    const top = floorTop(info.floor);
    const w = 4 * SLOT_W;
    const g = new Graphics();
    // [gfx2 signage] Miners' spray marks on the rock instead of a dashed UI box (see signage.ts).
    if (this.gfx2) sprayOutline(g, DISTRICT_X + 6, top + 8, w - 12, ROOM_H - 16, seeded(77 + info.floor));
    else {
      for (let x = DISTRICT_X; x < DISTRICT_X + w; x += 14) {
        g.rect(x, top + 4, 8, 2).fill({ color: 0xd9a441, alpha: 0.75 });
        g.rect(x, top + ROOM_H - 6, 8, 2).fill({ color: 0xd9a441, alpha: 0.75 });
      }
      for (let y = top + 4; y < top + ROOM_H - 4; y += 14) {
        g.rect(DISTRICT_X, y, 2, 8).fill({ color: 0xd9a441, alpha: 0.75 });
        g.rect(DISTRICT_X + w - 2, y, 2, 8).fill({ color: 0xd9a441, alpha: 0.75 });
      }
      g.rect(DISTRICT_X + 2, top + 6, w - 4, ROOM_H - 12).fill({ color: 0x000000, alpha: 0.35 });
    }
    // A crack in the casing hints at the hollow beyond.
    g.moveTo(BUILDING_W + 4, top + 20).lineTo(BUILDING_W + 9, top + 40).lineTo(BUILDING_W + 5, top + 58).lineTo(BUILDING_W + 11, top + 80)
      .stroke({ color: 0x0a0806, width: 2 });
    const label = richLine(`[[pick]] ${info.text}`, { fontFamily: 'Rubik, sans-serif', fontSize: 11, fontWeight: '700', fill: 0xf2e6c8 }, 12, true, 4);
    label.position.set(DISTRICT_X + w / 2, top + ROOM_H / 2 - 9);
    const cost = richLine(info.cost, { fontFamily: 'Rubik, sans-serif', fontSize: 11, fontWeight: '700', fill: 0xffd447 }, 12, false, 4);
    cost.position.set(DISTRICT_X + w / 2, top + ROOM_H / 2 + 11);
    const sign = new Container();
    sign.addChild(g);
    if (this.gfx2) {
      // [gfx2 signage] Bolted steel sign, same look as the room tags and the dig sign.
      const pw = Math.min(w - 8, Math.max(lineWidth(label), lineWidth(cost)) + 26);
      const plate = new Graphics();
      steelTag(plate, DISTRICT_X + (w - pw) / 2, top + ROOM_H / 2 - 24, pw, 46, { rivets: 4, stripe: true });
      sign.addChild(plate);
      label.y += 3;
      cost.y += 2;
    }
    sign.addChild(label, cost);
    sign.eventMode = 'static';
    sign.cursor = 'pointer';
    sign.hitArea = new Rectangle(DISTRICT_X, top, w, ROOM_H);
    sign.on('pointertap', () => {
      if (!this.isDragging) this.onDistrictDig?.();
    });
    this.districtSignHolder.addChild(sign);
  }

  /** Little icons (hearts, stars) rising from a survivor or a room. */
  floatIcons(x: number, y: number, icon: IconName, count = 6, color?: string): void {
    for (let i = 0; i < count; i++) {
      const s = iconSprite(icon, 10 + Math.random() * 5, color);
      s.anchor.set(0.5);
      s.position.set(x + (Math.random() - 0.5) * 18, y - Math.random() * 6);
      this.fxLayer.addChild(s);
      this.floaters.push({ s, vy: -16 - Math.random() * 14, vx: (Math.random() - 0.5) * 10, life: -i * 0.12, max: 1.6 + Math.random() * 0.6 });
    }
  }

  /** World position of a survivor's head, if they are on screen. */
  personPos(survivorId: string): { x: number; y: number } | null {
    const p = this.people.get(survivorId);
    if (!p?.container.parent || !p.container.visible) return null;
    const g = p.container.getGlobalPosition();
    const w = this.worldContainer.toLocal(g);
    return { x: w.x, y: w.y - 34 };
  }

  private updateFloaters(dt: number): void {
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life += dt;
      if (f.life < 0) {
        f.s.alpha = 0;
        continue;
      }
      const k = f.life / f.max;
      if (k >= 1) {
        f.s.destroy();
        this.floaters.splice(i, 1);
        continue;
      }
      f.s.y += f.vy * dt;
      f.s.x += (f.vx + Math.sin(f.life * 5) * 12) * dt; // [camera] the sway was per frame
      f.s.alpha = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
      f.s.scale.set(0.7 + Math.min(1, k * 4) * 0.4);
    }
  }

  /** A bonus floating over a room, waiting for a tap. */
  showBubble(buildingId: string, icon: IconName): void {
    const v = this.views.get(buildingId);
    if (!v || this.bubbles.has(buildingId)) return;
    const b = new Container();
    const glow = new Sprite(glowTexture());
    glow.anchor.set(0.5);
    glow.width = glow.height = 46;
    glow.tint = 0xffe2a0;
    glow.blendMode = 'add';
    const ring = new Graphics();
    ring.circle(0, 0, 11.5).fill({ color: 0xfff6e0, alpha: 0.95 }).stroke({ color: 0xd9a441, width: 1.5 });
    ring.poly([-4, 9, 4, 9, 0, 15]).fill({ color: 0xfff6e0, alpha: 0.95 });
    const ic = iconSprite(icon, 15);
    ic.anchor.set(0.5);
    b.addChild(glow, ring, ic);
    b.position.set(v.root.x + v.width / 2, v.root.y + 26);
    b.eventMode = 'static';
    b.cursor = 'pointer';
    b.hitArea = new Rectangle(-16, -16, 32, 34);
    b.on('pointertap', (e) => {
      e.stopPropagation();
      if (!this.isDragging) this.onBubbleTap?.(buildingId);
    });
    (b as Container & { born: number }).born = this.time;
    this.labelLayer.addChild(b);
    this.labelLayer.eventMode = 'passive';
    this.bubbles.set(buildingId, b);
  }

  hasBubble(buildingId: string): boolean {
    return this.bubbles.has(buildingId);
  }

  /** Removes a bubble; returns its screen position for the fly-to-HUD effect. */
  popBubble(buildingId: string): { x: number; y: number } | null {
    const b = this.bubbles.get(buildingId);
    if (!b) return null;
    const g = b.getGlobalPosition();
    this.burstAt(b.x, b.y, 30);
    this.punch(0.5); // [camera] collect
    b.destroy({ children: true });
    this.bubbles.delete(buildingId);
    return { x: g.x, y: g.y };
  }

  private animateBubbles(): void {
    for (const [id, b] of this.bubbles) {
      if (!this.views.has(id)) {
        b.destroy({ children: true });
        this.bubbles.delete(id);
        continue;
      }
      const age = this.time - (b as Container & { born: number }).born;
      const pop = Math.min(1, age * 4);
      b.scale.set(pop * (1 + 0.06 * Math.sin(this.time * 4)));
      b.pivot.y = Math.sin(this.time * 2.4 + b.x) * 2.5;
    }
  }

  /** 0..1 darkness of the bunker clock; idle survivors go to bed at night. */
  setNight(night: number): void {
    this.nightNow = night;
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    await this.app.init({
      canvas,
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: 0x0d0f1a,
      // Lite mode (after the game was killed twice in an hour): fewer pixels, no multisampling. The picture is drawn by
      // render() itself rather than Pixi's ticker: a ticker that throws once never comes back.
      // The canvas itself is never multisampled (the world is drawn into the filter's texture, where the quality level
      // switches smoothing on or off); the pixel density starts at the level this session begins with and follows the setting.
      antialias: false,
      resolution: targetResolution(startQuality()),
      autoDensity: true,
      autoStart: false,
      // Textures idle for a while leave the GPU (they come back when drawn again): sooner than Pixi's minute, sooner still in lite mode.
      gcMaxUnusedTime: isLiteMode() ? 15_000 : 30_000,
    });
    this.watchContext(canvas);
    this.highlightLayer.eventMode = 'none';
    this.labelLayer.eventMode = 'none';
    this.dust.graphics.eventMode = 'none';
    this.utilitiesHolder.eventMode = 'none';

    this.surface = buildSurface();
    this.worldContainer.addChild(
      this.surfaceHolder, this.projectSites.layer, this.projectSites.crew, this.undergroundHolder, this.bayHolder, this.slotLayer, this.highlightLayer,
      this.roomLayer, this.shaftHolder, this.utilitiesHolder, this.dust.graphics, this.digHolder, this.districtSignHolder, this.fxLayer, this.incidents.fx, this.disasterFx.fx,
      this.labelLayer, this.incidents.badges,
    );
    this.app.stage.addChild(this.worldContainer);
    this.worldContainer.filters = [this.grade];
    this.surfaceHolder.addChild(this.surface.container);
    this.projectSites.onTap = id => { if (!this.isDragging) this.onProjectClick?.(id); };
    this.bayHolder.eventMode = 'none';
    PEOPLE_STYLE.painted = this.gfx2;
    if (this.gfx2) for (const k of KIT_KEYS) ArtLibrary.get(k);
    // A painting finished loading: rebuild room visuals so placeholders switch to art.
    ArtLibrary.onLoaded(() => {
      for (const v of this.views.values()) v.visualSig = '';
      for (const v of this.ruinViews.values()) v.visualSig = '';
      this.undergroundSig = '';
      this.utilitiesSig = '';
      this.refreshSurface();
    });
    this.setupCamera();
    setPopupBlocker((x, y) => this.inIncident(x, y)); // [camera]
    this.fitToScreen();
    // gfx-p0 light: the composite takes over the era grade and reads the era/night for vignette and night lighting.
    this.postfx = new PostFX(this.app, this.worldContainer, this.grade, () => ({ era: this.surfaceEra, night: this.nightNow, target: this.frameTarget }));
    window.addEventListener('resize', () => {
      this.app.renderer.resize(window.innerWidth, window.innerHeight);
      this.fitToScreen();
    });
  }

  private contentBottom(): number {
    return floorTop(this.floors + 1) + 20;
  }

  private fitToScreen(): void {
    const { width } = this.app.screen;
    const contentW = BUILDING_W + SIDE_MARGIN * 2;
    this.baseZoom = Math.max(0.35, Math.min(1.6, (width - 8) / contentW));
    this.zoom = this.baseZoom;
    this.camX = BUILDING_W / 2;
    const usable = this.app.screen.height - HUD_TOP - HUD_BOTTOM;
    this.camY = VIEW_TOP + usable / 2 / this.zoom;
    this.stopCamera();
    this.clampCamera();
    this.updateTransform();
  }

  // ───────────────────────────── [camera] input ─────────────────────────────
  // One finger drags 1:1 with a rubber band past the edges and glides on release; two fingers pinch around the
  // point between them (and pan); the wheel zooms around the cursor; a double tap frames a room. Everything is
  // stepped by time in stepCamera(), so it feels the same at 30, 60 and 120 Hz.

  private setupCamera(): void {
    const canvas = this.app.canvas;
    canvas.addEventListener('pointerdown', (e: PointerEvent) => {
      // A primary pointer starts a fresh gesture: forget any finger whose release we never saw.
      if (e.isPrimary) {
        this.pointers.clear();
        this.pinch = null;
      }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // A touch catches a gliding camera; that touch only stops it (no room tap).
      // (Not when this touch may be the second half of a double tap.)
      const pendingTap = performance.now() - this.lastTap.t < DOUBLE_TAP_MS;
      const moving = !pendingTap && (Math.hypot(this.camVX, this.camVY) * this.zoom > 140 || this.focusTarget !== null);
      this.stopCamera();
      if (this.pointers.size === 1) {
        this.isDragging = moving;
        this.downAt = e.timeStamp;
        this.beginPan(e.clientX, e.clientY, e.timeStamp);
      } else if (this.pointers.size === 2) this.beginPinch();
    });
    // Moves and releases are followed on the window, so a finger sliding over the HUD keeps dragging.
    window.addEventListener('pointermove', (e: PointerEvent) => {
      if (this.drag) {
        if (e.pointerId !== this.drag.pointerId) return;
        const r = canvas.getBoundingClientRect();
        this.movePersonTo(e.clientX - r.left, e.clientY - r.top);
        return;
      }
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.pinch) {
        this.movePinch();
        return;
      }
      if (!this.pointerDown) return;
      const dx = e.clientX - this.dragStartX;
      const dy = e.clientY - this.dragStartY;
      this.pushSample(e.timeStamp, e.clientX, e.clientY);
      if (!this.isDragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) this.isDragging = true;
      if (!this.isDragging) return;
      this.camBounds(this.zoom);
      const b = this.bnd;
      this.camX = rubber(this.camStartX - dx / this.zoom, b.x0, b.x1, this.viewW());
      this.camY = rubber(this.camStartY - dy / this.zoom, b.y0, b.y1, this.viewH());
      this.updateTransform();
    });
    const end = (e: PointerEvent) => {
      const known = this.pointers.delete(e.pointerId);
      window.clearTimeout(this.pressTimer);
      if (this.drag && (e.pointerId === this.drag.pointerId || !this.pointers.size)) {
        const r = canvas.getBoundingClientRect();
        this.endDrag(e.clientX - r.left, e.clientY - r.top);
      }
      if (!known) return;
      if (this.pinch) {
        if (this.pointers.size < 2) {
          this.pinch = null;
          // The finger left behind carries on as a one-finger drag from where the camera is.
          for (const p of this.pointers.values()) this.beginPan(p.x, p.y, e.timeStamp);
        }
        return;
      }
      if (this.pointers.size) return;
      if (this.pointerDown && this.isDragging) this.fling(e.timeStamp);
      else if (this.pointerDown && e.type === 'pointerup' && e.timeStamp - this.downAt < 300) this.tapAt(e.clientX, e.clientY, true);
      this.pointerDown = false;
      // Keep isDragging until PixiJS has dispatched pointertap for this release.
      setTimeout(() => { this.isDragging = false; }, 0);
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', () => {
      this.pointers.clear();
      this.pinch = null;
      this.pointerDown = false;
      this.isDragging = false;
    });
    canvas.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const from = this.wheelZoom ?? this.zoom;
      this.focusTarget = null;
      this.camVX = this.camVY = 0;
      this.wheelZoom = this.clampZoom(from * Math.exp(-Math.max(-300, Math.min(300, dy)) * 0.0016));
      this.zoomAnchorX = e.clientX;
      this.zoomAnchorY = e.clientY;
    }, { passive: false });
    // A double tap can land on the backdrop of the sheet the first tap opened: frame the room, keep the sheet.
    const isBackdrop = (t: EventTarget | null) => t instanceof HTMLElement && t.classList.contains('sheet-overlay');
    let backdropDown = 0;
    window.addEventListener('pointerdown', (e) => { if (isBackdrop(e.target)) backdropDown = e.timeStamp; }, true);
    window.addEventListener('pointerup', (e) => {
      if (!isBackdrop(e.target) || e.timeStamp - backdropDown > 300) return;
      if (this.tapAt(e.clientX, e.clientY, false)) this.swallowClickUntil = performance.now() + 450;
    }, true);
    window.addEventListener('click', (e) => {
      if (performance.now() > this.swallowClickUntil || !isBackdrop(e.target)) return;
      this.swallowClickUntil = 0;
      e.stopPropagation();
      e.preventDefault();
    }, true);
  }

  private beginPan(x: number, y: number, t: number): void {
    this.pointerDown = true;
    this.dragStartX = x;
    this.dragStartY = y;
    // Start from the "unstretched" position, so grabbing the camera inside the rubber band does not jump.
    this.camBounds(this.zoom);
    const b = this.bnd;
    this.camStartX = unrubber(this.camX, b.x0, b.x1, this.viewW());
    this.camStartY = unrubber(this.camY, b.y0, b.y1, this.viewH());
    this.sampleN = 0;
    this.pushSample(t, x, y);
  }

  private beginPinch(): void {
    let i = 0, ax = 0, ay = 0, bx = 0, by = 0;
    for (const p of this.pointers.values()) {
      if (i === 0) { ax = p.x; ay = p.y; } else if (i === 1) { bx = p.x; by = p.y; }
      i++;
    }
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const { width } = this.app.screen;
    this.pinch = {
      d0: Math.max(24, Math.hypot(ax - bx, ay - by)), z0: this.zoom,
      wx: this.camX + (mx - width / 2) / this.zoom, wy: this.camY + (my - this.viewCY()) / this.zoom,
    };
    this.isDragging = true;
    this.pointerDown = true;
  }

  /** Pinch: the world point under the fingers stays under them while they spread and move. */
  private movePinch(): void {
    const p = this.pinch!;
    let i = 0, ax = 0, ay = 0, bx = 0, by = 0;
    for (const q of this.pointers.values()) {
      if (i === 0) { ax = q.x; ay = q.y; } else if (i === 1) { bx = q.x; by = q.y; }
      i++;
    }
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const z = this.softZoom(p.z0 * Math.hypot(ax - bx, ay - by) / p.d0);
    this.zoom = z;
    this.camBounds(z);
    const b = this.bnd;
    const { width } = this.app.screen;
    this.camX = rubber(p.wx - (mx - width / 2) / z, b.x0, b.x1, this.viewW());
    this.camY = rubber(p.wy - (my - this.viewCY()) / z, b.y0, b.y1, this.viewH());
    this.zoomAnchorX = mx;
    this.zoomAnchorY = my;
    this.updateTransform();
  }

  private pushSample(t: number, x: number, y: number): void {
    const i = (this.sampleN % 8) * 3;
    this.samples[i] = t;
    this.samples[i + 1] = x;
    this.samples[i + 2] = y;
    this.sampleN++;
  }

  /** Release: the finger's speed over its last ~90 ms becomes the glide. A finger that stopped first does not fling. */
  private fling(t: number): void {
    const n = this.sampleN;
    if (n < 2) return;
    const s = this.samples;
    const last = ((n - 1) % 8) * 3;
    if (t - s[last] > 60) return;
    let first = last;
    for (let k = 2; k <= Math.min(8, n); k++) {
      const j = ((n - k) % 8) * 3;
      if (s[last] - s[j] > 90) break;
      first = j;
    }
    const dt = (s[last] - s[first]) / 1000;
    if (dt < 0.008) return;
    let vx = (s[last + 1] - s[first + 1]) / dt;
    let vy = (s[last + 2] - s[first + 2]) / dt;
    const sp = Math.hypot(vx, vy);
    if (sp < 60) return;
    if (sp > 5000) {
      vx *= 5000 / sp;
      vy *= 5000 / sp;
    }
    this.camVX = -vx / this.zoom;
    this.camVY = -vy / this.zoom;
  }

  /** Records a tap; true when it completes a double tap (which then frames what was tapped). Only canvas taps start one. */
  private tapAt(x: number, y: number, canStart: boolean): boolean {
    const now = performance.now();
    const t = this.lastTap;
    if (now - t.t < DOUBLE_TAP_MS && Math.hypot(x - t.x, y - t.y) < 36) {
      t.t = 0;
      this.onDoubleTap(x, y);
      return true;
    }
    t.t = canStart ? now : 0;
    t.x = x;
    t.y = y;
    return false;
  }

  /** Double tap: frame the room (or ruin) under the finger above any open sheet; again to zoom back out. Empty space zooms in. */
  private onDoubleTap(sx: number, sy: number): void {
    const { width, height } = this.app.screen;
    const id = this.targetAt(sx, sy);
    const room = id ? this.views.get(id) : undefined;
    const ruin = id ? this.ruinViews.get(id) : undefined;
    const rect = room ? { x: room.root.x, y: room.root.y, w: room.width, h: room.height }
      : ruin ? { x: ruin.root.x, y: ruin.root.y, w: ruin.width, h: ROOM_H } : null;
    const inset = this.sheetInset();
    const wx = this.camX + (sx - width / 2) / this.zoom;
    const wy = this.camY + (sy - this.viewCY()) / this.zoom;
    if (rect) {
      const visH = height - HUD_TOP - HUD_BOTTOM - inset;
      const z = this.clampZoom(Math.min(width * 0.9 / rect.w, visH * 0.82 / rect.h, MAX_ZOOM));
      const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
      // Already framed: the second double tap goes back to the overview.
      const framed = this.framedId === id && Math.abs(this.zoom / z - 1) < 0.08;
      this.framedId = framed ? null : id;
      this.bottomInset = inset;
      if (framed) this.focusTo(wx - (sx - width / 2) / this.baseZoom, wy - (sy - this.viewCY()) / this.baseZoom, this.baseZoom);
      // The visible middle sits inset/2 px above the view centre.
      else this.focusTo(cx, cy + inset / 2 / z, z);
    } else {
      const z = this.zoom > this.baseZoom * 2.2 ? this.baseZoom : this.clampZoom(this.zoom * 1.8);
      this.focusTo(wx - (sx - width / 2) / z, wy - (sy - this.viewCY()) / z, z);
    }
  }

  /** Screen px of an open bottom sheet that reach above the nav bar. */
  private sheetInset(): number {
    const s = document.querySelector('.sheet-overlay.open .sheet') as HTMLElement | null;
    return s ? Math.max(0, Math.min(this.app.screen.height * 0.7, s.offsetHeight - HUD_BOTTOM)) : 0;
  }

  /** After a room is selected: if its sheet (or the screen edge) hides it, glide just enough to show it. */
  private keepInSight(id: string): void {
    const v = this.views.get(id);
    if (!v || this.selectedId !== id || this.pointers.size || this.focusTarget) return;
    const { width, height } = this.app.screen;
    const inset = this.sheetInset();
    const z = this.zoom, cy = this.viewCY();
    const top = HUD_TOP + 10, bottom = height - HUD_BOTTOM - inset - 10;
    const rTop = cy + (v.root.y - this.camY) * z, rBot = cy + (v.root.y + v.height - this.camY) * z;
    const rL = width / 2 + (v.root.x - this.camX) * z, rR = width / 2 + (v.root.x + v.width - this.camX) * z;
    let sy = 0, sx = 0;
    if (rBot - rTop > bottom - top) sy = (rTop + rBot) / 2 - (top + bottom) / 2;
    else if (rBot > bottom) sy = rBot - bottom;
    else if (rTop < top) sy = rTop - top;
    if (rR - rL > width - 20) sx = (rL + rR) / 2 - width / 2;
    else if (rR > width - 10) sx = rR - (width - 10);
    else if (rL < 10) sx = rL - 10;
    if (Math.abs(sx) < 2 && Math.abs(sy) < 2) return;
    this.bottomInset = Math.max(this.bottomInset, inset);
    this.focusTo(this.camX + sx / z, this.camY + sy / z, z);
  }

  // ───────────────────────────── [camera] physics ─────────────────────────────

  private stopCamera(): void {
    this.camVX = this.camVY = this.zoomV = 0;
    this.focusTarget = null;
    this.wheelZoom = null;
  }

  private viewW(): number {
    return this.app.screen.width / this.zoom;
  }

  private viewH(): number {
    return (this.app.screen.height - HUD_TOP - HUD_BOTTOM) / this.zoom;
  }

  /** Screen y the camera centre maps to (the middle between the HUD bars). */
  private viewCY(): number {
    return HUD_TOP + (this.app.screen.height - HUD_TOP - HUD_BOTTOM) / 2;
  }

  /** Where the camera centre may rest at zoom z (lo === hi on an axis when the content fits). Writes this.bnd. */
  private camBounds(z: number): void {
    const { width, height } = this.app.screen;
    const halfW = width / 2 / z;
    const halfH = (height - HUD_TOP - HUD_BOTTOM) / 2 / z;
    const b = this.bnd;
    const minX = -SIDE_MARGIN, maxX = this.extentR + SIDE_MARGIN;
    if (maxX - minX <= halfW * 2) b.x0 = b.x1 = (minX + maxX) / 2;
    else { b.x0 = minX + halfW; b.x1 = maxX - halfW; }
    // An open sheet lets the camera go lower, so the deepest rooms can sit above it.
    // Tall project buildings on the surface let the camera rise to their tops.
    const minY = Math.min(VIEW_TOP, this.projectSites.top) - 60, maxY = this.contentBottom() + this.bottomInset / z;
    if (maxY - minY <= halfH * 2) b.y0 = b.y1 = minY + halfH;
    else { b.y0 = minY + halfH; b.y1 = maxY - halfH; }
  }

  private clampZoom(z: number): number {
    return Math.max(this.baseZoom * 0.5, Math.min(MAX_ZOOM, z));
  }

  /** Pinching past the zoom limits gives way with resistance, then springs back on release. */
  private softZoom(z: number): number {
    const lo = this.baseZoom * 0.5;
    if (z > MAX_ZOOM) return MAX_ZOOM * Math.exp(Math.log(z / MAX_ZOOM) * 0.3);
    if (z < lo) return lo * Math.exp(Math.log(z / lo) * 0.3);
    return z;
  }

  private clampCamera(): void {
    this.camBounds(this.zoom);
    const b = this.bnd;
    this.camX = Math.max(b.x0, Math.min(b.x1, this.camX));
    this.camY = Math.max(b.y0, Math.min(b.y1, this.camY));
  }

  /** Zoom to z keeping the world point under the screen point (ax, ay) where it is. */
  private zoomAround(z: number, ax: number, ay: number): void {
    const { width } = this.app.screen;
    const cy = this.viewCY();
    const wx = this.camX + (ax - width / 2) / this.zoom;
    const wy = this.camY + (ay - cy) / this.zoom;
    this.zoom = z;
    this.camX = wx - (ax - width / 2) / z;
    this.camY = wy - (ay - cy) / z;
  }

  /** Glide (critically damped spring) to a camera centre and zoom; the target is kept inside the bounds. */
  private focusTo(x: number, y: number, z: number): void {
    z = this.clampZoom(z);
    this.camBounds(z);
    const b = this.bnd;
    const f = this.focusTarget ?? { x: 0, y: 0, z: 0 };
    f.x = Math.max(b.x0, Math.min(b.x1, x));
    f.y = Math.max(b.y0, Math.min(b.y1, y));
    f.z = z;
    this.focusTarget = f;
    this.wheelZoom = null;
  }

  /** One time step of the camera: focus glide, wheel zoom, zoom-limit spring, coasting, edge springs, shake. */
  private stepCamera(dt: number): void {
    if (this.trauma > 0) this.trauma = Math.max(0, this.trauma - this.traumaDecay * dt);
    if (this.punchT < 1) this.punchT += dt;
    // While a sheet lets the camera rest lower, check now and then whether it closed (then glide back).
    if (this.bottomInset > 0 && (this.insetCheck += dt) > 0.25) {
      this.insetCheck = 0;
      if (!document.querySelector('.sheet-overlay.open')) this.bottomInset = 0;
    }
    if (this.pointers.size > 0 && (this.isDragging || this.pinch)) {
      // The fingers own the camera.
    } else if (this.focusTarget) {
      const f = this.focusTarget;
      const lz = crit(Math.log(this.zoom), this.zoomV, Math.log(f.z), FOCUS_SPRING, dt);
      this.zoom = Math.exp(lz);
      this.zoomV = SPRING_V;
      this.camX = crit(this.camX, this.camVX, f.x, FOCUS_SPRING, dt);
      this.camVX = SPRING_V;
      this.camY = crit(this.camY, this.camVY, f.y, FOCUS_SPRING, dt);
      this.camVY = SPRING_V;
      if (Math.abs(this.camX - f.x) * this.zoom < 0.3 && Math.abs(this.camY - f.y) * this.zoom < 0.3 && Math.abs(lz - Math.log(f.z)) < 0.0005) {
        this.camX = f.x;
        this.camY = f.y;
        this.zoom = f.z;
        this.stopCamera();
      }
    } else {
      if (this.wheelZoom !== null) {
        const target = Math.log(this.wheelZoom), lz = Math.log(this.zoom);
        const next = Math.abs(target - lz) < 0.0005 ? target : lz + (target - lz) * (1 - Math.exp(-dt * 16));
        this.zoomAround(Math.exp(next), this.zoomAnchorX, this.zoomAnchorY);
        if (next === target) this.wheelZoom = null;
      }
      // Past the zoom limits (after a pinch): spring back around the last pinch point.
      const zc = this.clampZoom(this.zoom);
      if (zc !== this.zoom || this.zoomV !== 0) {
        const lz = crit(Math.log(this.zoom), this.zoomV, Math.log(zc), ZOOM_SPRING, dt);
        this.zoomV = SPRING_V;
        const settled = Math.abs(lz - Math.log(zc)) < 0.0005 && Math.abs(this.zoomV) < 0.01;
        this.zoomAround(settled ? zc : Math.exp(lz), this.zoomAnchorX, this.zoomAnchorY);
        if (settled) this.zoomV = 0;
      }
      // Pan: glide with friction inside the bounds; outside them a spring pulls back (rubber band).
      this.camBounds(this.zoom);
      const b = this.bnd;
      this.camX = this.axisStep(this.camX, this.camVX, b.x0, b.x1, dt);
      this.camVX = SPRING_V;
      this.camY = this.axisStep(this.camY, this.camVY, b.y0, b.y1, dt);
      this.camVY = SPRING_V;
    }
    this.updateTransform();
  }

  /** One axis of the free camera; the new velocity is left in SPRING_V. */
  private axisStep(x: number, v: number, lo: number, hi: number, dt: number): number {
    if (x < lo || x > hi) {
      const t = x < lo ? lo : hi;
      const nx = crit(x, v, t, EDGE_SPRING, dt);
      if (Math.abs(nx - t) * this.zoom < 0.2 && Math.abs(SPRING_V) * this.zoom < 4) {
        SPRING_V = 0;
        return t;
      }
      return nx;
    }
    if (v === 0) {
      SPRING_V = 0;
      return x;
    }
    const e = Math.exp(-FRICTION * dt);
    const nx = x + (v * (1 - e)) / FRICTION;
    SPRING_V = Math.abs(v * e) * this.zoom < 8 ? 0 : v * e;
    return nx;
  }

  private updateTransform(): void {
    const { width } = this.app.screen;
    const cy = this.viewCY();
    let ox = 0, oy = 0, zk = 1;
    if (this.trauma > 0) {
      // Trauma² × smooth noise: big hits read big, the tail fades softly instead of buzzing.
      const a = SHAKE_PX * this.trauma * this.trauma * (this.calm ? 0.3 : 1);
      const t = this.time * 26;
      ox = a * (Math.sin(t) * 0.5 + Math.sin(t * 2.13 + 1.7) * 0.3 + Math.sin(t * 4.37 + 4.1) * 0.2);
      oy = a * (Math.sin(t * 1.11 + 3.3) * 0.5 + Math.sin(t * 2.41 + 0.6) * 0.3 + Math.sin(t * 3.97 + 2.2) * 0.2);
    }
    if (this.punchT < 0.5) {
      const e = punchEnvelope(this.punchT);
      zk += this.punchAmt * e;
      ox += this.punchDX * e;
      oy += this.punchDY * e;
    }
    // The punch zooms around the view centre.
    const z = this.zoom * zk;
    this.worldContainer.scale.set(z);
    this.worldContainer.x = width / 2 - this.camX * z + ox;
    this.worldContainer.y = cy - this.camY * z + oy;
  }

  /** Dev tools: put the camera at a world point with a zoom relative to the fit-to-screen zoom. */
  devCamera(x: number, y: number, zoomRel: number): void {
    this.stopCamera();
    this.zoom = this.clampZoom(this.baseZoom * zoomRel);
    this.camX = x;
    this.camY = y;
    this.clampCamera();
    this.updateTransform();
  }

  /** Glides a floor into view (used when placing a room and after digging). */
  focusFloor(floor: number): void {
    this.focusTo(this.camX, floorTop(floor) + ROOM_H / 2, this.zoom);
  }

  /** Which room soundscapes should be audible, from the rooms currently on screen. */
  getAmbienceMix(state: GameState): AmbienceMix[] {
    const { width, height } = this.app.screen;
    const closeness = Math.min(1, 0.35 + 0.65 * ((this.zoom - this.baseZoom) / Math.max(0.01, this.baseZoom * 1.5)));
    const acc = new Map<AmbienceKey, { level: number; panSum: number; w: number }>();
    for (const b of state.buildings) {
      if (b.isConstructing && b.level === 1) continue;
      const key = AMBIENCE_FOR[b.type];
      if (!key) continue;
      const c = this.roomCenter(b);
      const sx = this.worldContainer.x + c.x * this.zoom;
      const sy = this.worldContainer.y + (c.y + ROOM_H / 3) * this.zoom;
      if (sx < -80 || sx > width + 80 || sy < -80 || sy > height + 80) continue;
      const dx = (sx - width / 2) / (width / 2);
      const dy = (sy - height / 2) / (height / 2);
      const level = Math.max(0, 1 - Math.hypot(dx, dy) * 0.55) * closeness;
      const entry = acc.get(key) ?? { level: 0, panSum: 0, w: 0 };
      entry.level = Math.max(entry.level, level);
      entry.panSum += dx * level;
      entry.w += level;
      acc.set(key, entry);
    }
    return [...acc.entries()].map(([key, e]) => ({ key, level: e.level, pan: e.w > 0 ? (e.panSum / e.w) * 0.8 : 0 }));
  }

  roomCenter(b: BuildingInstance): { x: number; y: number } {
    return { x: buildingX(b) + (roomSlots(b.type) * SLOT_W) / 2, y: floorTop(b.position.floor) + 24 };
  }

  slotCenter(pos: Position): { x: number; y: number } {
    return { x: slotX(pos.x) + SLOT_W / 2, y: floorTop(pos.floor) + ROOM_H / 2 };
  }

  private rebuildStructure(state: GameState): void {
    this.floors = state.currentFloors;
    this.undergroundHolder.removeChildren().forEach(c => c.destroy({ children: true }));
    const districts = state.buildings.filter(b => isDistrict(b.type)).map(b => b.position.floor);
    const casing = this.gfx2 && kitReady() ? buildCasing(this.floors, kitState(this.surfaceEra)) : null;
    this.undergroundHolder.addChild(buildUnderground(this.floors, i18n.currentLocale, this.gloom, ArtLibrary.get('backdrops/rock'), districts, casing));
    this.undergroundSig = this.structureSig(state);
    this.structureGloom = this.gloom;
    this.shaftHolder.removeChildren().forEach(c => c.destroy({ children: true }));
    // G3 shaft hook: the painted industrial lift with the new look.
    this.shaft = this.gfx2 && kitReady()
      ? buildShaft2(this.floors, this.surfaceEra, () => this.onElevator?.())
      : buildShaft(this.floors, () => this.onElevator?.());
    this.shaftHolder.addChild(this.shaft.container);
    this.dust.setFloors(this.floors);
    this.slotLayer.removeChildren().forEach(c => c.destroy());
    for (let f = 0; f < this.floors; f++) {
      for (let s = 0; s < SLOTS_PER_FLOOR; s++) {
        const tile = new Graphics();
        const x = slotX(s), y = floorTop(f);
        tile.hitArea = { contains: (px: number, py: number) => px >= x && px < x + SLOT_W && py >= y && py < y + ROOM_H };
        tile.eventMode = 'static';
        tile.cursor = 'pointer';
        tile.on('pointertap', () => {
          if (!this.isDragging) this.onTileClick?.({ x: s, y: 0, floor: f });
        });
        this.slotLayer.addChild(tile);
      }
    }
    this.utilitiesSig = '';
    this.digSig = '';
    this.collectStructureCullables();
  }

  /**
   * [P6] With up to 24 floors most of the structure is off screen: every part of the rock, casing and the empty-slot tiles
   * gets its vertical extent measured once here, and cullRooms() hides what the camera cannot see.
   */
  private structureCull: { obj: Container; y0: number; y1: number }[] = [];

  private collectStructureCullables(): void {
    const out: { obj: Container; y0: number; y1: number }[] = [];
    const addChildren = (root: Container | undefined) => {
      if (!root) return;
      for (const c of root.children) {
        const b = c.getLocalBounds();
        if (!isFinite(b.minY) || !isFinite(b.maxY) || b.maxY - b.minY > 3 * FLOOR_H) continue; // tall pieces stay
        out.push({ obj: c, y0: root.y + c.y + b.minY, y1: root.y + c.y + b.maxY });
      }
    };
    addChildren(this.undergroundHolder.children[0] as Container | undefined);
    for (let f = 0, i = 0; f < this.floors; f++) {
      for (let s = 0; s < SLOTS_PER_FLOOR; s++, i++) {
        const tile = this.slotLayer.children[i];
        if (tile) out.push({ obj: tile as Container, y0: floorTop(f), y1: floorTop(f) + ROOM_H });
      }
    }
    this.structureCull = out;
  }

  private structureSig(state: GameState): string {
    return `${state.buildings.filter(b => isDistrict(b.type)).map(b => b.position.floor).join(',')}|${!!ArtLibrary.get('backdrops/rock')}|${this.gfx2 && kitReady()}|${this.gfx2 ? this.surfaceEra : ''}`;
  }

  setDigSign(available: boolean, text: string, cost: string): void {
    const rock = this.gfx2 && kitReady() ? ArtLibrary.get('kit/bay-A-wide') : null;
    const sig = `${available}|${text}|${cost}|${this.floors}|${!!rock}`;
    if (sig === this.digSig) return;
    this.digSig = sig;
    this.digHolder.removeChildren().forEach(c => c.destroy({ children: true }));
    if (!available) return;
    const sign = buildDigSign(this.floors, text, cost, rock);
    sign.on('pointertap', () => {
      if (!this.isDragging) this.onDigClick?.();
    });
    this.digHolder.addChild(sign);
  }

  setPlacementHighlight(isValid: ((pos: Position) => boolean) | null, levels = 1): void {
    const g = this.highlightLayer;
    g.clear();
    if (!isValid) return;
    const H = levels * ROOM_H + (levels - 1) * SLAB;
    for (let f = 0; f < this.floors; f++) {
      for (let s = 0; s < SLOTS_PER_FLOOR; s++) {
        if (!isValid({ x: s, y: 0, floor: f })) continue;
        const x = slotX(s), y = floorTop(f);
        g.rect(x + 2, y + 2, SLOT_W - 4, H - 4).fill({ color: 0x44ff88, alpha: 0.18 });
        g.rect(x + 2, y + 2, SLOT_W - 4, H - 4).stroke({ color: 0x7affb0, alpha: 0.8, width: 1.5 });
        g.moveTo(x + SLOT_W / 2 - 6, y + ROOM_H / 2).lineTo(x + SLOT_W / 2 + 6, y + ROOM_H / 2).stroke({ color: 0x7affb0, width: 2 });
        g.moveTo(x + SLOT_W / 2, y + ROOM_H / 2 - 6).lineTo(x + SLOT_W / 2, y + ROOM_H / 2 + 6).stroke({ color: 0x7affb0, width: 2 });
      }
    }
  }

  setSelected(buildingId: string | null): void {
    this.selectedId = buildingId;
    for (const [id, v] of this.views) v.outline.visible = id === buildingId;
    // [camera] The sheet that opens for the room must not hide it: glide it into the space above the sheet.
    if (buildingId) window.setTimeout(() => this.keepInSight(buildingId), 60);
  }

  resetScene(): void {
    for (const v of this.views.values()) {
      v.root.destroy({ children: true });
      v.label.destroy({ children: true });
    }
    this.views.clear();
    for (const v of this.ruinViews.values()) {
      v.root.destroy({ children: true });
      v.label.destroy({ children: true });
    }
    this.ruinViews.clear();
    for (const p of this.people.values()) p.container.destroy({ children: true });
    this.people.clear();
    this.selectedId = null;
    this.highlightLayer.clear();
    this.floors = 0;
  }

  private isOpenTo(state: GameState, b: BuildingInstance, side: -1 | 1): boolean {
    if (b.isConstructing && b.level === 1) return false;
    const w = roomSlots(b.type);
    return state.buildings.some(o => o.id !== b.id && o.type === b.type && o.level === b.level
      && o.position.floor === b.position.floor && !(o.isConstructing && o.level === 1)
      && (side === 1 ? o.position.x === b.position.x + w : o.position.x + roomSlots(o.type) === b.position.x));
  }

  /** Position of a room inside its compound run (0 = leftmost); odd ones are mirrored for variety. */
  private compoundIndex(state: GameState, b: BuildingInstance): number {
    let i = 0;
    let cur: BuildingInstance | undefined = b;
    while (cur && this.isOpenTo(state, cur, -1) && i < 12) {
      const c: BuildingInstance = cur;
      cur = state.buildings.find(o => o.type === c.type && o.position.floor === c.position.floor
        && o.position.x + roomSlots(o.type) === c.position.x);
      i++;
    }
    return i;
  }

  private renderRooms(state: GameState): void {
    const active = new Set<string>();
    for (const b of state.buildings) {
      const def = getDef(b.type);
      if (!def) continue;
      active.add(b.id);
      let view = this.views.get(b.id);
      if (!view) {
        view = this.createView(b);
        this.views.set(b.id, view);
        this.roomLayer.addChild(view.root);
        this.labelLayer.addChild(view.label);
      }
      const isNew = b.isConstructing && b.level === 1;
      const openL = this.isOpenTo(state, b, -1);
      const openR = this.isOpenTo(state, b, 1);
      // The look follows the finished level, so an upgrade reveals the new painting when it completes.
      const artKey = isNew ? buildingArtKey(b.type, 0) : buildingArtKey(b.type, roomTier(effectiveLevel(b)));
      const texture = artKey ? ArtLibrary.get(artKey) : null;
      const mirror = texture ? this.compoundIndex(state, b) % 2 === 1 : false;
      const visualSig = `${b.type}|${isNew}|${openL}|${openR}|${texture ? artKey : 'code'}|${mirror}`;
      if (view.visualSig !== visualSig) {
        const prevKey = view.visualSig.split('|')[4];
        const tierChange = !!view.visual && !isNew && view.visualSig.split('|')[1] === 'false'
          && prevKey !== 'code' && !!artKey && prevKey !== artKey;
        const finishedBuild = !!view.visual && view.visualSig.split('|')[1] === 'true' && !isNew;
        view.visualSig = visualSig;
        // Keep the old look on top and fade it away, so changes read as a transformation.
        if (view.oldVisual) view.oldVisual.destroy({ children: true });
        view.oldVisual = view.visual && (tierChange || finishedBuild) ? view.visual.container : null;
        if (!view.oldVisual) view.visual?.container.destroy({ children: true });
        view.fade = 0;
        const rnd = seeded(hashString(b.id));
        view.visual = isNew
          ? texture ? buildPaintedConstruction(texture, view.width, view.height) : buildConstructionVisual(b.type, view.width)
          : texture && artKey
            ? buildPaintedRoom(texture, artEntry(artKey)!, view.width, openL, openR, mirror, rnd, view.height, this.gfx2 ? this.roomGains(b, artKey) : undefined, b.id /* G4 lighting: shared flicker key */)
            : buildRoomVisual(b.type, view.width, openL, openR, rnd);
        view.visualHolder.removeChildren();
        view.visualHolder.addChild(view.visual.container);
        if (view.oldVisual) {
          view.visualHolder.addChild(view.oldVisual);
          this.burstAt(view.root.x + view.width / 2, view.root.y + view.height * 0.55, view.width);
          if (this.onScreen(view.root.x + view.width / 2, view.root.y + view.height / 2)) this.punch(finishedBuild ? 1 : 0.7); // [camera]
        }
      }
      const upgrading = b.isConstructing && b.level > 1;
      if (upgrading && !view.scaffold) {
        view.scaffold = buildScaffold(view.width);
        view.root.addChildAt(view.scaffold.container, view.root.getChildIndex(view.people) + 1);
      } else if (!upgrading && view.scaffold) {
        view.scaffold.container.destroy({ children: true });
        view.scaffold = null;
      }
      const labelSig = `${b.level}|${b.assignedSurvivorIds.length}|${b.isConstructing}|${i18n.currentLocale}|${b.specialization ?? ''}`;
      if (view.labelSig !== labelSig) {
        view.labelSig = labelSig;
        this.drawLabel(view, b);
      }
      // New look: a room keeps its sign to itself unless it needs you (no workers, building) or is selected.
      if (this.gfx2) {
        const staffed = (def.maxWorkers ?? 0) === 0 || b.assignedSurvivorIds.length > 0;
        view.label.visible = b.id === this.selectedId || b.isConstructing || !staffed;
      }
      if (view.progress) {
        const pct = b.constructionProgress / b.constructionTotal;
        view.progress.clear();
        view.progress.roundRect(0, 0, view.width - 30, 5, 2.5).fill({ color: 0x000000, alpha: 0.7 });
        view.progress.roundRect(0, 0, Math.max(3, (view.width - 30) * pct), 5, 2.5).fill(0xffb547);
      }
    }
    this.extentR = Math.max(BUILDING_W, this.projectSites.right, ...[...this.views.values()].map(v => v.root.x + v.width));
    for (const [id, view] of this.views) {
      if (active.has(id)) continue;
      for (const child of [...view.people.children]) view.people.removeChild(child);
      view.root.destroy({ children: true });
      view.label.destroy({ children: true });
      this.views.delete(id);
    }
  }

  private createView(b: BuildingInstance): RoomView {
    const width = roomSlots(b.type) * SLOT_W;
    const height = buildingH(b.type);
    const root = new Container();
    root.position.set(buildingX(b), floorTop(b.position.floor));
    const visualHolder = new Container();
    const people = new Container();
    people.sortableChildren = true;
    // In a two-storey hall people walk on the lower level's floor.
    people.y = height - ROOM_H;
    const outline = new Graphics();
    outline.rect(1, 1, width - 2, height - 2).stroke({ color: 0xffd47a, width: 2.5, alpha: 0.95 });
    outline.visible = b.id === this.selectedId;
    root.addChild(visualHolder, people, outline);
    root.hitArea = { contains: (x: number, y: number) => x >= 0 && x <= width && y >= 0 && y <= height };
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.on('pointertap', () => {
      if (!this.isDragging) this.onBuildingClick?.(b.id);
    });
    const label = new Container();
    label.position.set(buildingX(b) + width / 2, floorTop(b.position.floor) - SLAB / 2);
    return {
      root, visualHolder, visual: null, oldVisual: null, fade: 0, scaffold: null, people, outline, label, progress: null,
      visualSig: '', labelSig: '', width, height,
      lane: { x0: DEPTH_X + 10, x1: width - DEPTH_X - 10 },
    };
  }

  private drawLabel(view: RoomView, b: BuildingInstance): void {
    const def = getDef(b.type)!;
    view.label.removeChildren().forEach(c => c.destroy());
    if (view.progress) {
      view.progress.destroy();
      view.progress = null;
    }
    const name = def.name[i18n.currentLocale] ?? def.name.en;
    const stars = b.level > 1 ? ` ${'[[star]]'.repeat(b.level - 1)}` : '';
    // A specialized room wears its role's emblem instead of the row of stars.
    const spec = specOf(b);
    const badge = spec ? ` [[crown]] ${spec.name[i18n.currentLocale]}` : stars;
    const text = richLine(`${name}${badge}`, nameStyle, 8, i18n.isRTL, Math.min(window.devicePixelRatio, 2) * 2);
    const textW = lineWidth(text);
    const pipCount = def.maxWorkers;
    const pipsW = pipCount > 0 ? pipCount * 7 + 6 : 0;
    const width = textW + pipsW + 14;
    const bg = new Graphics();
    if (this.gfx2) {
      // [gfx2 signage] A screwed-on steel tag with a soft drop shadow (signage.ts).
      steelTag(bg, -width / 2, -7.5, width, 15);
    } else {
      bg.roundRect(-width / 2, -7.5, width, 15, 4).fill({ color: 0x14141e, alpha: 0.9 });
      bg.roundRect(-width / 2, -7.5, width, 15, 4).stroke({ color: 0xd9a441, alpha: 0.5, width: 1 });
    }
    text.x = -pipsW / 2;
    view.label.addChild(bg, text);
    if (pipCount > 0) {
      const pips = new Graphics();
      const startX = text.x + textW / 2 + 8;
      for (let i = 0; i < pipCount; i++) {
        const filled = i < b.assignedSurvivorIds.length;
        // [gfx2 signage] Worker pips as small indicator lamps.
        if (this.gfx2) { tagLamp(pips, startX + i * 7, 0, filled); continue; }
        pips.circle(startX + i * 7, 0, 2.4).fill(filled ? 0x4dff8f : 0x3a3a4a);
        if (!filled) pips.circle(startX + i * 7, 0, 2.4).stroke({ color: 0xff6b6b, width: 0.8 });
      }
      view.label.addChild(pips);
    }
    if (b.isConstructing) {
      view.progress = new Graphics();
      view.progress.position.set(15, view.height - 14);
      view.root.addChild(view.progress);
    }
  }

  /** Picking a survivor up: a short press on them lifts them off the floor. */
  private attachDrag(person: Person, survivorId: string): void {
    person.container.on('pointerdown', (e) => {
      window.clearTimeout(this.pressTimer);
      const pointerId = e.pointerId;
      this.pressTimer = window.setTimeout(() => {
        if (this.isDragging) return;
        this.drag = { person, survivorId, pointerId };
        person.setLifted(true);
        this.fxLayer.addChild(person.container);
        person.container.zIndex = 9999;
        this.pointerDown = false;
        this.movePersonTo(e.global.x, e.global.y);
      }, 260);
    });
    person.container.on('pointerup', () => {
      if (!this.drag && !this.isDragging) this.onPersonTap?.(survivorId);
      window.clearTimeout(this.pressTimer);
    });
    person.container.on('pointerupoutside', () => window.clearTimeout(this.pressTimer));
  }

  private movePersonTo(sx: number, sy: number): void {
    if (!this.drag) return;
    const p = this.worldContainer.toLocal({ x: sx, y: sy });
    this.drag.person.container.position.set(p.x, p.y + 22);
    this.drag.person.container.scale.set(1.25);
  }

  /** Which room or ruin is under a screen point (for drops). */
  targetAt(sx: number, sy: number): string | null {
    const p = this.worldContainer.toLocal({ x: sx, y: sy });
    for (const [id, v] of this.ruinViews) {
      if (p.x >= v.root.x && p.x <= v.root.x + v.width && p.y >= v.root.y && p.y <= v.root.y + ROOM_H) return id;
    }
    for (const [id, v] of this.views) {
      if (p.x >= v.root.x && p.x <= v.root.x + v.width && p.y >= v.root.y && p.y <= v.root.y + v.height) return id;
    }
    return null;
  }

  private endDrag(sx: number, sy: number): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    d.person.setLifted(false);
    d.person.roomId = null;
    this.onPersonDrop?.(d.survivorId, this.targetAt(sx, sy));
  }

  private renderPeople(state: GameState, dt: number): void {
    const quarters = state.buildings.filter(b => b.type === 'quarters' && !(b.isConstructing && b.level === 1));
    const seen = new Set<string>();
    const sleeping = new Map<string, number>();
    let idleIndex = 0;
    for (const s of state.survivors) {
      if (s.isOnMission) continue;
      seen.add(s.id);
      let person = this.people.get(s.id);
      // A child who grew up gets a new, grown-up body.
      if (person && person.bornChild !== !!s.child) {
        if (this.drag?.person === person) this.drag = null;
        person.container.destroy({ children: true });
        this.people.delete(s.id);
        person = undefined;
      }
      if (!person) {
        person = new Person(s);
        this.people.set(s.id, person);
        this.attachDrag(person, s.id);
      }
      if (this.drag?.person === person) {
        person.update(dt, this.time, 1);
        continue;
      }
      const job = s.assignedBuildingId ? state.buildings.find(b => b.id === s.assignedBuildingId) : undefined;
      const usable = job && !(job.isConstructing && job.level === 1);
      // A project crew stands on its lot on the surface (treated like a ruin crew: no bed, no room job).
      const siteView = s.assignedBuildingId?.startsWith('p_') ? this.projectSites.ensureView(s.assignedBuildingId.slice(2)) : undefined;
      const ruinView = s.assignedBuildingId ? this.ruinViews.get(s.assignedBuildingId) ?? siteView : undefined;
      const home = quarters.length ? quarters[idleIndex++ % quarters.length] : undefined;
      const roomId = ruinView ? s.assignedBuildingId : usable ? job!.id : home?.id ?? null;
      const view: { people: Container; lane: Lane } | undefined = ruinView ?? (roomId ? this.views.get(roomId) : undefined);
      if (!view) {
        person.container.parent?.removeChild(person.container);
        person.roomId = null;
        continue;
      }
      // At night the idle go to bed in the bunks: hidden, with a Zzz over the dormitory.
      const asleep = !ruinView && !usable && this.nightNow > 0.65;
      person.container.visible = !asleep;
      if (asleep) sleeping.set(roomId!, (sleeping.get(roomId!) ?? 0) + 1);
      if (person.roomId !== roomId || person.container.parent !== view.people) {
        view.people.addChild(person.container);
        person.placeIn(roomId!, view.lane);
      }
      // gfx-p0 people: the room's crowd (work spots at the painted equipment, spacing, the lamp shadows fall from).
      const cv = view as unknown as { width: number; visualSig: string; height?: number };
      person.setCrowd(crowdFor(view.people, view.lane, cv.visualSig, cv.width, this.gfx2, cv.height ?? ROOM_H));
      person.dress(ruinView ? 'ruin' : usable ? job!.type : null);
      if (this.gfx2) {
        // Warm lamp-lit ambient, dimmer when the power sags and in the wrecked rooms.
        // Warm ambient, coloured a little by the room's lamps; dimmer when the power sags and in the wrecks.
        // G4 lighting: people dim with the power and dip with their room's lamp flicker, like the room and the structure.
        const v = (ruinView ? 0.76 : 0.9) * (0.62 + 0.38 * (state.powerRatio ?? 1)) * (0.8 + 0.2 * (roomFlicker.get(roomId!) ?? 1));
        const lc = this.roomLight.get(roomId!) ?? 0xffe6c0;
        const dg = depthGains(view.people.parent ? view.people.parent.y + ROOM_H / 2 : 0);
        const ch = (base: number, sh: number, k: number) => Math.round(Math.min(255, (base * 0.72 + ((lc >> sh) & 255) * 0.28) * v * k));
        person.setAmbient((ch(255, 16, dg[0]) << 16) | (ch(247, 8, dg[1]) << 8) | ch(228, 0, dg[2]));
      }
      person.setTag(this.lod === 'close' ? this.nameOf?.(s) ?? s.name : null);
      person.setCondition(s.happiness, s.health);
      const activity: Activity = siteView ? 'hammer' : ruinView ? 'dig' : usable ? ROOM_ACTIVITY[job!.type] ?? 'idle' : 'idle';
      person.update(dt, this.time, 0.4 + (s.happiness / 100) * 0.6, activity);
    }
    settleCrowds(); // gfx-p0 people: release spots of people who left, stack overlapping name tags
    for (const [id, p] of this.people) {
      if (seen.has(id)) continue;
      p.container.destroy({ children: true });
      this.people.delete(id);
    }
    this.renderSleep(sleeping);
  }

  private renderSleep(sleeping: Map<string, number>): void {
    for (const [id, mark] of this.sleepMarks) {
      if (!sleeping.has(id)) {
        mark.destroy({ children: true });
        this.sleepMarks.delete(id);
      }
    }
    for (const id of sleeping.keys()) {
      const v = this.views.get(id);
      if (!v) continue;
      let mark = this.sleepMarks.get(id);
      if (!mark) {
        mark = new Container();
        for (let i = 0; i < 3; i++) {
          const z = new Text({ text: 'z', style: { fontFamily: 'Rubik, sans-serif', fontSize: 10 + i * 3, fontWeight: '700', fill: 0xcfe0ff }, resolution: 3 });
          z.anchor.set(0.5);
          mark.addChild(z);
        }
        mark.position.set(v.root.x + v.width * 0.5, v.root.y + v.height - ROOM_H * 0.55);
        this.fxLayer.addChild(mark);
        this.sleepMarks.set(id, mark);
      }
      mark.children.forEach((z, i) => {
        const k = ((this.time * 0.5 + i / 3) % 1);
        z.position.set(i * 7 + Math.sin(this.time * 2 + i) * 2, -k * 22);
        z.alpha = Math.sin(k * Math.PI) * 0.85;
      });
    }
  }

  /** [Danger C5] "In memory: names" for the plaque at the entrance (the latest few). */
  private memorialText(state: GameState): string {
    const fallen = state.danger?.fallen ?? [];
    if (fallen.length === 0) return '';
    const names = fallen.slice(-4).map(f => NAME_LOCALIZER.getLocalizedName({ name: f.name } as SurvivorState, i18n.currentLocale)).join(' · ');
    return `† ${i18n.t('memorial.plaque')}: ${names}`;
  }

  private renderUtilities(state: GameState): void {
    const painted = this.gfx2 && kitReady();
    let sig = state.buildings.map(b => `${b.id}:${b.type}:${b.position.floor}:${b.position.x}:${b.isConstructing && b.level === 1}`).join('|') + this.floors;
    // The painted structure also follows room levels (lamps, compounds), ruins and the era's darkness.
    const memorial = this.memorialText(state); // [Danger C5]
    sig += `|${memorial}`;
    if (painted) sig += `|${state.buildings.map(b => b.level).join(',')}|${state.ruins.map(r => `${r.id}:${r.x}`).join(',')}|${this.gloom}|${this.surfaceEra}`;
    if (sig === this.utilitiesSig) return;
    this.utilitiesSig = sig;
    this.utilitiesHolder.removeChildren().forEach(c => c.destroy({ children: true }));
    this.bayHolder.removeChildren().forEach(c => c.destroy({ children: true }));
    this.front = null;
    this.decals = null; // [gfx2 wear]
    this.atmo = null; // [gfx2 wear]
    if (painted) {
      const grid = occupancy(state.buildings, state.ruins, this.floors);
      this.bayHolder.addChild(buildBays(grid));
      const lamps = this.worldLamps(state);
      this.front = buildFrontStructure(grid, state.buildings, this.floors, lamps, structureAmbient(this.surfaceEra) /* G4 lighting: era ambient */, kitState(this.surfaceEra));
      this.utilitiesHolder.addChild(this.front.container);
      // [gfx2 signage] Zone plates, slab stencils and wall props (signage.ts).
      this.utilitiesHolder.addChild(buildSignage({
        buildings: state.buildings, ruins: state.ruins, floors: this.floors, era: Math.max(0, this.surfaceEra),
        locale: i18n.currentLocale, rtl: i18n.isRTL, lamps, ambient: 0.5 - this.gloom * 0.35, memorial,
      }));
      // [gfx2 wear] Wear decals in front of the structure (clear of the signage), then the atmosphere.
      const wearEra = Math.max(0, this.surfaceEra);
      this.decals = buildDecals(grid, state.buildings, this.floors, wearEra, lamps, structureAmbient(this.surfaceEra),
        this.utilitiesHolder.children.filter(c => c !== this.front?.container));
      this.utilitiesHolder.addChild(this.decals.container);
      this.atmo = buildAtmosphere(state.buildings, this.floors, wearEra, lamps, this.decals.sources);
      this.utilitiesHolder.addChild(this.atmo.container);
      // A room's light colour: its lamps' colours, weighted by strength.
      this.roomLight.clear();
      for (const l of lamps) {
        if (!l.room) continue;
        const prev = this.roomLight.get(l.room);
        const w = l.power;
        const mix = (a: number, b: number, k: number) => Math.round(a + (b - a) * k);
        const c = prev ?? l.color;
        const k = prev === undefined ? 1 : w / (w + 1);
        this.roomLight.set(l.room, (mix((c >> 16) & 255, (l.color >> 16) & 255, k) << 16) | (mix((c >> 8) & 255, (l.color >> 8) & 255, k) << 8) | mix(c & 255, l.color & 255, k));
      }
    }
    this.utilities = buildUtilities(state.buildings, this.floors, painted);
    this.utilitiesHolder.addChild(this.utilities.container);
  }

  /** Painting balance × depth fog × a small per-room variation, so neighbours never look copy-pasted. */
  private roomGains(b: BuildingInstance, artKey: string): [number, number, number] {
    const bal = ArtLibrary.balanceFor(artKey);
    const depth = depthGains(floorTop(b.position.floor) + buildingH(b.type) / 2);
    const h = hashString(b.id);
    const v = 0.96 + ((h % 100) / 100) * 0.08;
    const warm = (((h >>> 8) % 100) / 100 - 0.5) * 0.06;
    return [bal[0] * depth[0] * v * (1 + warm), bal[1] * depth[1] * v, bal[2] * depth[2] * v * (1 - warm)].map(x => Math.min(1, x)) as [number, number, number];
  }

  /** Every painted lamp of every finished room, in world space. */
  private worldLamps(state: GameState): WorldLamp[] {
    const lamps: WorldLamp[] = [];
    for (const b of state.buildings) {
      if (isDistrict(b.type) || (b.isConstructing && b.level === 1)) continue;
      const key = buildingArtKey(b.type, roomTier(effectiveLevel(b)));
      const entry = key ? artEntry(key) : null;
      if (!entry) continue;
      const W = roomSlots(b.type) * SLOT_W, H = buildingH(b.type);
      const mirror = this.compoundIndex(state, b) % 2 === 1;
      for (const l of ArtLibrary.lightsFor(entry)) {
        lamps.push({
          x: buildingX(b) + (mirror ? 1 - l.x : l.x) * W, y: floorTop(b.position.floor) + l.y * H, reach: W, color: l.color,
          power: l.r >= 0.15 ? 0.9 : 0.35, ceiling: l.y < 0.35 && l.r >= 0.12, room: b.id,
        });
      }
    }
    return lamps;
  }

  /** Milliseconds per picture the engine aims for right now (set by the app each frame). */
  frameTarget = 1000 / 60;

  /** The GPU took the context away (app switch, memory pressure, driver reset); until it is back nothing is drawn. */
  private contextLost = false;
  private drawFails = 0;

  private watchContext(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('webglcontextlost', ev => {
      ev.preventDefault();
      this.contextLost = true;
      logCrash('gl-context-lost', 'WebGL context lost');
    });
    // Pixi's own listener (registered first) has already re-initialised the GL systems by now.
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.recoverGraphics();
    });
  }

  /**
   * Rooms wholly off screen are neither drawn nor animated: zoomed in, most of the bunker is out of view, and every
   * hidden room used to cost as much CPU and GPU as a visible one (heat, battery).
   */
  private cullRooms(): void {
    const wc = this.worldContainer;
    const s = wc.scale.x || 1;
    const margin = 80; // glows and shadows reach past a room's edge
    const x0 = -wc.x / s - margin;
    const y0 = -wc.y / s - margin;
    const x1 = (this.app.screen.width - wc.x) / s + margin;
    const y1 = (this.app.screen.height - wc.y) / s + margin;
    for (const v of this.views.values()) {
      const r = v.root;
      const seen = r.x < x1 && r.x + v.width > x0 && r.y < y1 && r.y + v.height > y0;
      v.culled = !seen;
      if (r.visible !== seen) r.visible = seen;
    }
    // [P6] The structure, by height only (it spans the whole width anyway).
    for (const c of this.structureCull) {
      const seen = c.y1 > y0 && c.y0 < y1;
      if (c.obj.visible !== seen) c.obj.visible = seen;
    }
  }

  /** Numbers for crash records: how many textures the GPU holds and at what pixel density. */
  gpuStats(): { gpuTextures: number; res: number } {
    let n = -1;
    try {
      const items = (this.app.renderer.texture as unknown as { _managedTextures: { items: Record<string, unknown> } })._managedTextures.items;
      n = 0;
      for (const k in items) if (items[k]) n++;
    } catch {
      // internals moved: report unknown
    }
    return { gpuTextures: n, res: this.app.renderer.resolution };
  }

  /** Everything that holds GPU state is rebuilt from the game state: the cure for a scene left half-broken. */
  recoverGraphics(): void {
    this.resetScene();
    this.undergroundSig = '';
    this.utilitiesSig = '';
    this.surfaceSig = '';
    this.cityMapSig = '';
    this.refreshSurface();
  }

  /** Updates the scene, then draws it; the picture is drawn even when the update threw halfway. */
  render(state: GameState, dt: number, alpha: number): void {
    try {
      this.updateScene(state, dt, alpha);
    } finally {
      this.draw();
    }
  }

  private draw(): void {
    const gl = (this.app.renderer as { gl?: WebGL2RenderingContext }).gl;
    if (this.contextLost || gl?.isContextLost()) return;
    try {
      this.app.render();
      this.drawFails = 0;
    } catch (err) {
      this.drawFails++;
      throw err;
    }
  }

  private updateScene(state: GameState, _dt: number, _alpha: number): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.time += dt;

    if (state.currentFloors !== this.floors || this.structureGloom !== this.gloom || this.undergroundSig !== this.structureSig(state)) this.rebuildStructure(state);
    this.stepCamera(dt); // [camera]
    this.updateLod(state, dt);
    this.renderRooms(state);
    this.renderRuins(state);
    this.renderUtilities(state);
    this.renderPeople(state, dt);

    const power = state.powerRatio ?? 1;
    (this.surface as { setQuality?: (q: 'high' | 'medium' | 'low') => void } | null)?.setQuality?.(this.postfx?.quality ?? 'high'); // gfx-p0 surface: particle budget
    this.surface?.animate(this.time, power);
    this.shaft?.animate(this.time, power);
    this.utilities?.animate(this.time, power);
    this.front?.animate(this.time, power);
    this.decals?.animate(this.time, power); // [gfx2 wear]
    this.atmo?.update(this.time, dt, power, this.worldContainer, this.app.screen, this.postfx?.quality ?? 'high'); // [gfx2 wear]
    setRoomFxQuality(this.postfx?.quality ?? 'high'); // gfx-p0 rooms: heat haze on high, fewer particles on low
    this.cullRooms();
    for (const [id, v] of this.views) {
      if (!v.culled) {
        v.visual?.animate(this.time, power);
        v.scaffold?.animate(this.time, power);
      }
      if (v.oldVisual) {
        v.fade += dt / 1.1;
        v.oldVisual.alpha = Math.max(0, 1 - v.fade);
        if (v.fade >= 1) {
          v.oldVisual.destroy({ children: true });
          v.oldVisual = null;
        }
      }
      if (id === this.selectedId) v.outline.alpha = 0.6 + 0.4 * Math.sin(this.time * 5);
    }
    for (const [id, v] of this.ruinViews) {
      const r = state.ruins.find(x => x.id === id);
      const working = !!r?.started && v.people.children.length > 0;
      v.visual?.animate(this.time, dt, working);
      v.label.y = floorTop(r?.floor ?? 0) + ROOM_H * 0.3 + Math.sin(this.time * 2.2 + v.root.x) * 2;
    }
    this.incidents.quality = this.postfx?.quality ?? 'high'; // gfx-p0 crisis: particle budget follows the quality ladder
    this.incidents.update(state, this.time, dt, id => this.roomRect(id), f => ({ x: ROOMS_X, y: floorTop(f), w: ROOMS_W }));
    this.disasterFx.update(state, this.time, id => this.roomRect(id)); // [Danger]
    this.updateBlockers(state); // [camera]
    this.updateBursts(dt);
    this.updateFloaters(dt);
    this.updateGrade(dt);
    this.animateBubbles();
    // Battery saver drops the free-floating dust.
    const low = this.postfx?.quality === 'low';
    this.dust.graphics.visible = !low;
    if (!low) this.dust.update(dt, this.time);
    this.postfx?.update(now);
  }

  private updateLod(state: GameState, dt: number): void {
    const r = this.zoom / this.baseZoom;
    const lod = r < (this.lod === 'far' ? 0.78 : 0.72) ? 'far' : r > (this.lod === 'close' ? 1.8 : 1.9) ? 'close' : 'mid';
    if (lod !== this.lod) this.onLodChange?.(lod);
    this.lod = lod;
    const sig = `${this.floors}|${state.buildings.map(b => `${b.id}:${b.type}:${b.position.floor}:${b.position.x}:${b.isConstructing && b.level === 1}`).join(',')}|${i18n.currentLocale}`;
    if (lod === 'far' && (!this.cityMap || sig !== this.cityMapSig)) {
      this.cityMap?.container.destroy({ children: true });
      this.cityMap = buildCityMap(state, this.floors, i18n.currentLocale);
      this.cityMapSig = sig;
      this.worldContainer.addChildAt(this.cityMap.container, this.worldContainer.getChildIndex(this.labelLayer));
    }
    if (this.cityMap) {
      const target = lod === 'far' ? 1 : 0;
      const a = this.cityMap.container.alpha + (target - this.cityMap.container.alpha) * (1 - Math.exp(-dt * 6)); // [camera] dt-exact
      this.cityMap.container.alpha = a;
      this.cityMap.container.visible = a > 0.01;
      if (this.cityMap.container.visible) this.cityMap.animate(state, this.time, this.nightNow);
      this.labelLayer.alpha = 1 - a;
    }
  }

  /** Each era has its own look: the Remnant is cold and drained, the Undercity warm and full. */
  private refreshSurface(): void {
    const key = `backdrops/surface-${Math.max(0, this.surfaceEra)}`;
    const tex = ArtLibrary.get(key);
    const sig = `${key}|${!!tex}${this.gfx2 ? `|${surface2Sig(Math.max(0, this.surfaceEra))}` : ''}`; // [gfx2 surface]
    if (sig === this.surfaceSig) return;
    this.surfaceSig = sig;
    this.surfaceHolder.removeChildren().forEach(c => c.destroy({ children: true }));
    const RAYS = [0xc8d4e8, 0xffe2b8, 0xffd496, 0xffc878];
    if (this.gfx2) {
      // [gfx2 surface] painted entrance, topsoil and props: src/rendering/surface2.ts
      const s2 = buildSurface2(tex, coneTexture(), RAYS[Math.max(0, Math.min(3, this.surfaceEra))], Math.max(0, this.surfaceEra), () => this.nightNow);
      mountSurface2(s2, this.worldContainer, this.undergroundHolder, this.shaftHolder);
      this.surface = s2;
    } else this.surface = buildSurface(tex, coneTexture(), RAYS[Math.max(0, Math.min(3, this.surfaceEra))]);
    this.surfaceHolder.addChild(this.surface.container);
  }

  setEra(era: EraDef, instant = false): void {
    this.surfaceEra = era.id;
    this.gloom = era.gloom;
    this.refreshSurface();
    const t = era.grade.tint;
    this.gradeTarget = {
      r: ((t >> 16) & 0xff) / 255, g: ((t >> 8) & 0xff) / 255, b: (t & 0xff) / 255,
      saturation: era.grade.saturation, brightness: era.grade.brightness, contrast: era.grade.contrast,
    };
    if (instant) this.gradeNow = { ...this.gradeTarget };
    this.gradeDirty = true;
  }

  private updateGrade(dt: number): void {
    if (!this.gradeDirty) return;
    const k = 1 - Math.exp(-dt * 0.6); // [camera] dt-exact
    let settled = true;
    for (const key of Object.keys(this.gradeNow) as (keyof typeof this.gradeNow)[]) {
      const d = this.gradeTarget[key] - this.gradeNow[key];
      if (Math.abs(d) > 0.002) settled = false;
      this.gradeNow[key] += d * k;
    }
    const g = this.gradeNow;
    const m = this.grade;
    m.reset();
    m.saturate(g.saturation - 1, true);
    m.contrast(g.contrast - 1, true);
    m.brightness(g.brightness, true);
    // Per-channel tint as the last step of the matrix.
    const tint = [g.r, 0, 0, 0, 0, 0, g.g, 0, 0, 0, 0, 0, g.b, 0, 0, 0, 0, 0, 1, 0];
    m.matrix = multiply(tint, m.matrix);
    if (settled) {
      this.gradeNow = { ...this.gradeTarget };
      this.gradeDirty = false;
    }
  }

  /** Called by the app when a big project's progress changes. */
  setProjectSites(sites: SiteInfo[]): void {
    this.projectSites.set(sites);
    this.extentR = Math.max(this.extentR, this.projectSites.right);
  }

  private renderRuins(state: GameState): void {
    const active = new Set<string>();
    for (const r of state.ruins) {
      active.add(r.id);
      let view = this.ruinViews.get(r.id);
      if (!view) {
        view = this.createRuinView(r);
        this.ruinViews.set(r.id, view);
        this.roomLayer.addChild(view.root);
        this.labelLayer.addChild(view.label);
      }
      const art = ruinArtKey(r);
      const texture = art ? ArtLibrary.get(art.key) : null;
      const visualSig = `${texture ? art!.key : 'code'}|${r.started}`;
      if (view.visualSig !== visualSig) {
        view.visualSig = visualSig;
        view.visual?.container.destroy({ children: true });
        view.visual = buildRuinVisual(r, view.width, texture, !!art?.darken, seeded(hashString(r.id)));
        view.root.addChildAt(view.visual.container, 0);
      }
      const workers = state.survivors.filter(s => s.assignedBuildingId === r.id && !s.isOnMission).length;
      const blocked = r.flooded && !state.buildings.some(b => b.type === 'waterPump' && !(b.isConstructing && b.level === 1));
      const labelSig = `${r.started}|${workers}|${blocked}`;
      if (view.labelSig !== labelSig) {
        view.labelSig = labelSig;
        this.drawRuinLabel(view, r, workers, blocked);
      }
      if (view.bar) {
        const pct = r.progress / Math.max(1, r.total);
        view.bar.clear();
        view.bar.roundRect(-22, 13, 44, 5, 2.5).fill({ color: 0x000000, alpha: 0.75 });
        view.bar.roundRect(-22, 13, Math.max(3, 44 * pct), 5, 2.5).fill(0xffb547);
      }
    }
    for (const [id, view] of this.ruinViews) {
      if (active.has(id)) continue;
      const cx = view.root.x + view.width / 2;
      const cy = view.root.y + ROOM_H * 0.6;
      this.burstAt(cx, cy, view.width);
      for (const child of [...view.people.children]) view.people.removeChild(child);
      view.root.destroy({ children: true });
      view.label.destroy({ children: true });
      this.ruinViews.delete(id);
    }
  }

  private createRuinView(r: Ruin): RuinView {
    const width = r.w * SLOT_W;
    const root = new Container();
    root.position.set(slotX(r.x), floorTop(r.floor));
    const people = new Container();
    people.sortableChildren = true;
    root.addChild(people);
    root.hitArea = { contains: (x: number, y: number) => x >= 0 && x <= width && y >= 0 && y <= ROOM_H };
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.on('pointertap', () => {
      if (!this.isDragging) this.onRuinClick?.(r.id);
    });
    const label = new Container();
    label.position.set(slotX(r.x) + width / 2, floorTop(r.floor) + ROOM_H * 0.3);
    label.eventMode = 'none';
    return { root, visual: null, people, label, visualSig: '', labelSig: '', width, bar: null, lane: { x0: 14, x1: width - 14 } };
  }

  /** Floating badge over a ruin: tap to clear, needs a pump, needs hands, and the work progress. */
  private drawRuinLabel(view: RuinView, r: Ruin, workers: number, blocked: boolean): void {
    view.label.removeChildren().forEach(c => c.destroy({ children: true }));
    view.bar = null;
    const icon = blocked ? 'lock' : r.started ? (workers > 0 ? 'pick' : 'worker') : r.kind === 'wreck' ? 'workshop' : 'broom';
    const ring = new Graphics();
    const color = blocked ? 0x8aa0b8 : r.started && workers === 0 ? 0xff6b6b : 0xffc547;
    ring.circle(0, 0, 11).fill({ color: 0x14141e, alpha: 0.85 }).stroke({ color, width: 1.6, alpha: 0.9 });
    const glow = new Sprite(glowTexture());
    glow.anchor.set(0.5);
    glow.tint = color;
    glow.width = glow.height = 44;
    glow.alpha = 0.35;
    glow.blendMode = 'add';
    const sprite = iconSprite(icon, 13, blocked ? '#9fb4c8' : '#ffd68a');
    sprite.anchor.set(0.5);
    view.label.addChild(glow, ring, sprite);
    if (blocked) {
      const w = iconSprite('water', 9);
      w.anchor.set(0.5);
      w.position.set(9, 8);
      view.label.addChild(w);
    }
    if (r.started) {
      view.bar = new Graphics();
      view.label.addChild(view.bar);
    }
  }

  /** Dust cloud when a ruin is cleared. */
  burstAt(x: number, y: number, width: number): void {
    for (let i = 0; i < 26; i++) {
      const s = new Sprite(moteTexture());
      s.anchor.set(0.5);
      s.tint = i % 3 === 0 ? 0xffd27a : 0xc9bda6;
      s.scale.set(0.6 + Math.random() * 1.1);
      s.position.set(x + (Math.random() - 0.5) * width * 0.8, y + (Math.random() - 0.5) * 20);
      if (i % 3 === 0) s.blendMode = 'add';
      this.fxLayer.addChild(s);
      this.bursts.push({ s, vx: (Math.random() - 0.5) * 60, vy: -10 - Math.random() * 40, life: 0, max: 1 + Math.random() * 1.2 });
    }
  }

  private updateBursts(dt: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.life += dt;
      b.vy += 20 * dt;
      b.vx *= Math.exp(-1.8 * dt); // [camera] was 0.97 per frame (twice the drag at 120 Hz)
      b.s.x += b.vx * dt;
      b.s.y += b.vy * dt;
      b.s.scale.set(b.s.scale.x + dt * 0.8);
      b.s.alpha = Math.max(0, 0.8 * (1 - b.life / b.max));
      if (b.life >= b.max) {
        b.s.destroy();
        this.bursts.splice(i, 1);
      }
    }
  }

  /** Centers the camera on a world point and zooms in a little. */
  focusOn(x: number, y: number, zoomBoost = 1.5): void {
    // [camera] A glide (critically damped spring), not a jump.
    this.focusTo(x, y, Math.max(this.zoom, this.baseZoom * zoomBoost));
  }

  /** [camera] Keeps the incident rectangles for the popup blocker (no allocation once warmed up). */
  private updateBlockers(state: GameState): void {
    let n = 0;
    for (const inc of state.incidents ?? []) {
      const v = this.views.get(inc.buildingId);
      if (!v) continue;
      const r = this.blockRects[n] ?? (this.blockRects[n] = { x: 0, y: 0, w: 0, h: 0 });
      if (inc.kind === 'blackout') {
        r.x = ROOMS_X; r.y = v.root.y; r.w = ROOMS_W; r.h = v.height;
      } else {
        r.x = v.root.x; r.y = v.root.y; r.w = v.width; r.h = v.height;
      }
      n++;
    }
    this.blockN = n;
  }

  private inIncident(x: number, y: number): boolean {
    for (let i = 0; i < this.blockN; i++) {
      const r = this.blockRects[i];
      if (x >= r.x - 6 && x <= r.x + r.w + 6 && y >= r.y - 30 && y <= r.y + r.h) return true;
    }
    return false;
  }

  ruinCenter(r: Ruin): { x: number; y: number } {
    return { x: slotX(r.x) + (r.w * SLOT_W) / 2, y: floorTop(r.floor) + ROOM_H / 2 };
  }

  destroy(): void {
    this.app.destroy(true);
  }
}

// [camera] Spring and rubber-band helpers (allocation-free: crit() leaves the new velocity in SPRING_V).
let SPRING_V = 0;

/** Exact step of a critically damped spring towards target (stable for any dt). */
function crit(x: number, v: number, target: number, w: number, dt: number): number {
  const x0 = x - target;
  const e = Math.exp(-w * dt);
  const c = v + w * x0;
  SPRING_V = (v - w * c * dt) * e;
  return target + (x0 + c * dt) * e;
}

/** iOS-style rubber band: past [lo, hi] the camera gives way less and less (dim = view size in world units). */
function rubber(v: number, lo: number, hi: number, dim: number): number {
  const off = (o: number) => (1 - 1 / ((o * 0.55) / dim + 1)) * dim;
  return v < lo ? lo - off(lo - v) : v > hi ? hi + off(v - hi) : v;
}

/** The raw position that rubber() maps to v. */
function unrubber(v: number, lo: number, hi: number, dim: number): number {
  const inv = (y: number) => (dim / 0.55) * (1 / (1 - Math.min(0.95, y / dim)) - 1);
  return v < lo ? lo - inv(lo - v) : v > hi ? hi + inv(v - hi) : v;
}

/** Zoom punch shape: 40 ms attack, then a damped wobble (a small undershoot) gone by ~0.4 s. */
function punchEnvelope(t: number): number {
  if (t < 0.04) return Math.sin((t / 0.04) * Math.PI / 2);
  const u = t - 0.04;
  return Math.exp(-u * 11) * Math.cos(u * 15);
}

/** 4×5 color matrix product (a after b). */
function multiply(a: number[], b: number[]): [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number] {
  const out = new Array(20).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) {
      let v = c === 4 ? a[r * 5 + 4] : 0;
      for (let k = 0; k < 4; k++) v += a[r * 5 + k] * b[k * 5 + c];
      out[r * 5 + c] = v;
    }
  }
  return out as ReturnType<typeof multiply>;
}
