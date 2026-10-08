import { Application, ColorMatrixFilter, Container, Graphics, Rectangle, Text } from 'pixi.js';
import { CameraController, FAR_ZOOM, hudBottom, hudTop } from './CameraController'; // [plan4 X-1]
import { PlacementController, dashedRect } from './PlacementController'; // [plan4 X-1]
import { PlacementGhost } from './PlacementGhost'; // [plan4:ST-19]
import { RoomViews, type RoomView, type RuinView } from './RoomViews'; // [plan4 X-1]
import type { IconName } from '../ui/icons';
import type { EraDef } from '../data/eras';
import type { BuildingInstance, BuildingType, GameState, Position, Ruin, SurvivorState } from '../core/GameState';
import { effectiveLevel, isDistrict, roomFloors, roomSlots } from '../data/buildingDefs';
import { i18n } from '../i18n/I18nManager';
import { BASE_EAST, BUILDING_W, districtXAt, FLOOR_H, ROOM_H, SHAFT_GAP, SHAFT_W, SLOT_W, TOPSOIL, buildingH, buildingX, extentsFor, floorExtent, floorIndexAt, floorTop, slotX, ROOMS_X, type Ext } from './layout';
import { hashString, seeded } from './draw';
import { PEOPLE_STYLE, Person, ROOM_ACTIVITY, type Activity, type Lane } from './people';
import { crowdFor, restCountFor, settleCrowds } from './workSpots'; // gfx-p0 people
import { GFX, setGfxQuality } from './gfxFeatures';
import { timeOfDay } from '../data/dayCycle';
import { ProjectSites, type SiteInfo } from './projectSites';
import { AMBIENCE_FOR, type AmbienceKey } from '../audio/ambience';
import type { AmbienceMix } from '../audio/AudioEngine';
import { Dust, buildDigSign, buildShaft, buildSurface, buildUnderground, buildUtilities, worldLeft, type Animated } from './world';
import { LAYOUT, VIEW, bandize, hashLayout } from './perfFx'; // [perf]
import { buildShaft2, type ShaftAnimated } from './shaft';
import { Walkers } from './walkers'; // plan4:ST-18
import { setDoorBlocked } from './routes'; // plan4:ST-18
import { isPassable } from '../systems/doors'; // plan4:ST-14
import { buildGalleries } from './gallery'; // [plan4:ST-1]
import { InfraLayer } from './infra'; // plan4:ST-14
import { buildSurface2, mountSurface2, surface2Sig } from './surface2'; // [gfx2 surface]
import { ROW_X0, buildSurfaceRuin, newInside, readInside } from './surfaceRow'; // plan4:ST-16
import { roomFlicker, setRoomFxQuality } from './paintedRoom'; // gfx-p0 rooms: quality
import { lineWidth, richLine } from './richText';
import { ArtLibrary } from '../art/ArtLibrary';
import { artEntry, buildingArtKey, roomTier, ruinArtKey } from '../art/registry';
import { buildCityMap, type CityMap } from './cityMap';
import { updateLabelScale } from './LabelScale'; // [plan4:ST-12]
import { SlopArea, hitState } from './HitSlop'; // [plan4:ST-12]
import { PostFX, startQuality, targetResolution } from './postfx';
import { isLiteMode, logCrash } from '../core/crashGuard';
import { isTouchDevice } from '../utils/device';
import { statusTint, pressMs } from '../utils/a11y';
import { coneTexture } from '../art/ArtLibrary';
import { buildRuinVisual } from './ruinArt';
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
import { WingSigns } from './wingSigns'; // [plan4:ST-4]
import { wingOptions } from './wingsApi'; // [plan4:ST-4] (one-line swap to ../data/wings once it merges)
import { buildSignage, signZone, sprayOutline, steelTag } from './signage';
import { FrontChunks } from './frontChunks'; // [plan4:ST-7]
import { KIT_KEYS, buildBays,buildCasing, depthGains, structureAmbient, gfx2Enabled, kitReady, kitState, occupancy, type WorldLamp } from './structure';



interface Burst {
  s: Sprite;
  vx: number;
  vy: number;
  life: number;
  max: number;
}


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
  /** [plan4:ST-7] The structure in front of the rooms, in chunks of 4 slots x 3 floors (frontChunks.ts); one manager for the life of the renderer, its chunks outlive a rebuild when unchanged. */
  private frontChunks = new FrontChunks();
  private front: FrontChunks | null = null;
  /** [plan4:ST-1] The service galleries between floors (gallery.ts). */
  private galleries: Animated | null = null;
  /** [gfx2 wear] Story-telling decals and the living atmosphere (decals.ts, atmosphere.ts). */
  private decals: DecalLayer | null = null;
  private atmo: Atmosphere | null = null;
  private infra: InfraLayer | null = null; // plan4:ST-14 bulkheads, stairwells, vent stacks, feed lines
  /** Each room's light colour, used to tint the people inside it. */
  private roomLight = new Map<string, number>();
  private dust = new Dust();
  private labelLayer = new Container();
  private digHolder = new Container();

  /** Rooms (or floors, for a blackout) with an active incident: popups stay out of them. */
  private blockRects: { x: number; y: number; w: number; h: number }[] = [];
  private blockN = 0;

  private views = new Map<string, RoomView>();
  private ruinViews = new Map<string, RuinView>();
  private fxLayer = new Container();
  private bursts: Burst[] = [];
  private grade = new ColorMatrixFilter();
  private gradeNow = { r: 1, g: 1, b: 1, saturation: 1, brightness: 1, contrast: 1 };
  private gradeTarget = { r: 1, g: 1, b: 1, saturation: 1, brightness: 1, contrast: 1 };
  private gradeDirty = true;
  private people = new Map<string, Person>();
  /** [plan4:ST-18] People walking between rooms, floors and the lift (cosmetic; behind the `walkers` flag). */
  private walkers = new Walkers();
  private selectedId: string | null = null;
  private floors = 0;
  private utilitiesSig = '';
  private digSig = '';
  private time = 0;
  private lastFrame = performance.now();

  onTileClick: ((pos: Position) => void) | null = null;
  onBuildingClick: ((buildingId: string) => void) | null = null;
  /** [plan4:ST-19] A room was pressed and held (its action sheet). */
  onBuildingLongPress: ((buildingId: string) => void) | null = null;
  onDigClick: (() => void) | null = null;
  /** [plan4:ST-3] Tap on a wing dig sign (assigned in app.ts; the wing signs call it). */
  onWingDig?: (floor: number, side: 'w' | 'e') => void;
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

  // [plan4 X-1] The camera, the empty-slot pad / placement highlight and the room views live in their own modules (CameraController.ts,
  // PlacementController.ts, RoomViews.ts); this class stays the facade the rest of the game talks to.
  private readonly cam: CameraController;
  private readonly placement: PlacementController;
  private readonly roomViews: RoomViews;
  /** [plan4:ST-19] The ghost of the room being placed, and the finger that drags it (grab offset in world px from the ghost's corner). */
  private readonly ghost = new PlacementGhost();
  private ghostDrag: { pointerId: number; grabX: number; grabY: number } | null = null;
  /** [plan4:ST-19] The ghost was pressed / dragged to a world point (top-left of where the room would go) / let go. The controller snaps and answers with showGhost. */
  onGhostLift: (() => void) | null = null;
  onGhostDrag: ((worldX: number, worldY: number) => void) | null = null;
  onGhostDrop: (() => void) | null = null;
  /** [plan4:ST-19] A quick tap on empty space (outside the bunker's outline, not on the ghost): the app cancels a placement in progress. */
  onPlacementEmptyTap: (() => void) | null = null;
  /** [plan4:UX-20] A survivor was lifted by the player (haptics hook). */
  onPersonLift: ((survivorId: string) => void) | null = null;
  /** [plan4:UX-20] The carried survivor is over a room or ruin (id) or over nothing (null); (sx, sy) = the finger in canvas px. Called on every move so the label follows. */
  onPersonHover: ((survivorId: string, targetId: string | null, sx: number, sy: number) => void) | null = null;
  /** [plan4:UX-20] Ring around the room or ruin the carried survivor would be dropped on. */
  private readonly dropRing = new Graphics();
  private dropRingSig = '';
  private hoverId: string | null = null;

  constructor() {
    const r = this;
    this.cam = new CameraController({
      get app() { return r.app; },
      get worldContainer() { return r.worldContainer; },
      contentBottom: () => r.contentBottom(),
      extentR: () => r.extentR,
      floorSpan: () => r.span,
      extentL: () => r.extentL, // [plan4:ST-4]
      projectTop: () => r.projectSites.top,
      time: () => r.time,
      selectedId: () => r.selectedId,
      roomRect: id => r.roomRect(id),
      targetRect: id => {
        const room = r.views.get(id);
        if (room) return { x: room.root.x, y: room.root.y, w: room.width, h: room.height };
        const ruin = r.ruinViews.get(id);
        return ruin ? { x: ruin.root.x, y: ruin.root.y, w: ruin.width, h: ROOM_H } : null;
      },
      targetAt: (sx, sy) => r.targetAt(sx, sy),
      carryPointer: () => (r.drag ? r.drag.pointerId : r.ghostDrag ? r.ghostDrag.pointerId : null),
      moveCarried: (sx, sy) => { if (r.ghostDrag) r.moveGhostTo(sx, sy); else r.movePersonTo(sx, sy); },
      endCarry: (sx, sy, overHud) => { if (r.ghostDrag) r.endGhostDrag(); else r.endDrag(sx, sy, overHud); },
      cancelPress: () => window.clearTimeout(r.pressTimer),
      canvasTap: (sx, sy) => r.onCanvasTap(sx, sy), // [plan4:ST-19]
    });
    this.placement = new PlacementController({
      isDragging: () => r.cam.isDragging,
      onTileClick: pos => r.onTileClick?.(pos),
    }, this.slotLayer, this.highlightLayer);
    this.roomViews = new RoomViews({
      gfx2: this.gfx2,
      selectedId: () => r.selectedId,
      isDragging: () => r.cam.isDragging,
      onBuildingClick: id => r.onBuildingClick?.(id),
      onBuildingLongPress: id => r.onBuildingLongPress?.(id), // [plan4:ST-19]
      carrying: () => !!r.drag || !!r.ghostDrag,
      projectRight: () => r.projectSites.right,
      setExtentR: x => { r.extentR = Math.max(x, r.extentWingR); }, // [plan4:ST-4] the widest floor counts too
      burstAt: (x, y, w) => r.burstAt(x, y, w),
      onScreen: (x, y) => r.onScreen(x, y),
      punch: k => r.punch(k),
      mapCovers: () => r.mapCovers,
    }, this.views, this.ruinViews, this.roomLayer, this.labelLayer);
    // [plan4:ST-4] Dev only: `__setExt(floor, w, e)` edits state.layout.ext (the structure rebuilds on the next picture) to look at wings before the dig flow exists.
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__setExt = (floor: number, w: number, e: number): boolean => {
        const st = this.devState;
        if (!st) return false;
        st.layout.ext[String(floor)] = { w, e };
        return true;
      };
    }
  }

  /**
   * [camera] Camera shake for big moments (a crisis breaking out, a new era, the drill): adds trauma; the shake is
   * trauma² × smooth noise, so it starts at about `amount` screen px and eases out over `seconds`.
   * Strong shakes (≥ 4) also land a downward kick and a zoom punch.
   */
  shake(amount: number, seconds: number): void {
    this.cam.shake(amount, seconds);
  }

  /**
   * [camera] A short zoom punch (+3% × strength, ~120 ms, springs back) with an optional directional kick
   * (screen direction, ~6 px × strength). For build complete, collect, crisis start.
   */
  punch(strength = 1, dirX = 0, dirY = 0): void {
    this.cam.punch(strength, dirX, dirY);
  }
  private floaters: { s: Sprite; vy: number; life: number; max: number; vx: number }[] = [];

  /** [camera] Is a world point inside the current view? */
  private onScreen(x: number, y: number): boolean {
    const sx = this.worldContainer.x + x * this.worldContainer.scale.x;
    const sy = this.worldContainer.y + y * this.worldContainer.scale.y;
    return sx > 0 && sx < this.app.screen.width && sy > hudTop() * 0.5 && sy < this.app.screen.height - hudBottom() * 0.5;
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
  /** [plan4:ST-12] Widest floor in world x (west wing reach, east reach): what the floor-overview zoom fits. */
  private span = { l: 0, r: BUILDING_W };
  /** [plan4:ST-4] How far the floors reach, for the camera: the west edge (0 without a wing) and the east edge of the widest floor. */
  private extentL = 0;
  /** [plan4:ST-4] The world's west edge the surface was built for (see world.ts worldLeft). */
  private surfaceLeft = worldLeft(0);
  /** [plan4:ST-16] The surface (gate-house) row is open: the world reaches west far enough for its 8 slots. */
  private rowOpen = false;
  private inside = newInside();
  private extentWingR = BUILDING_W;
  private exts: Ext[] = [];
  private wingSigns = new WingSigns(() => this.cam.isDragging);
  private wingSig = '';
  private wingHash = -1;
  private wingAt = -9;
  /** Dev only: the live state, for the `__setExt(floor, w, e)` console helper. */
  private devState: GameState | null = null;
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
  setDistrictSign(info: { floor: number; text: string; cost: string; /** [plan4:ST-8] The slot the tunnel starts from: the east end of that floor (a wing moves it). */ slot?: number } | null): void {
    const sig = info ? `${info.floor}|${info.slot ?? ''}|${info.text}|${info.cost}` : '';
    if (sig === this.districtSig) return;
    this.districtSig = sig;
    this.districtSignHolder.removeChildren().forEach(c => c.destroy({ children: true }));
    if (!info) return;
    const top = floorTop(info.floor);
    const wallX = slotX(info.slot ?? BASE_EAST), DX = districtXAt(info.slot ?? BASE_EAST);
    const w = 4 * SLOT_W;
    const g = new Graphics();
    // [gfx2 signage] Miners' spray marks on the rock instead of a dashed UI box (see signage.ts).
    if (this.gfx2) sprayOutline(g, DX + 6, top + 8, w - 12, ROOM_H - 16, seeded(77 + info.floor));
    else {
      for (let x = DX; x < DX + w; x += 14) {
        g.rect(x, top + 4, 8, 2).fill({ color: 0xd9a441, alpha: 0.75 });
        g.rect(x, top + ROOM_H - 6, 8, 2).fill({ color: 0xd9a441, alpha: 0.75 });
      }
      for (let y = top + 4; y < top + ROOM_H - 4; y += 14) {
        g.rect(DX, y, 2, 8).fill({ color: 0xd9a441, alpha: 0.75 });
        g.rect(DX + w - 2, y, 2, 8).fill({ color: 0xd9a441, alpha: 0.75 });
      }
      g.rect(DX + 2, top + 6, w - 4, ROOM_H - 12).fill({ color: 0x000000, alpha: 0.35 });
    }
    // A crack in the casing hints at the hollow beyond.
    g.moveTo(wallX + 4, top + 20).lineTo(wallX + 9, top + 40).lineTo(wallX + 5, top + 58).lineTo(wallX + 11, top + 80)
      .stroke({ color: 0x0a0806, width: 2 });
    const label = richLine(`[[pick]] ${info.text}`, { fontFamily: 'Rubik, sans-serif', fontSize: 11, fontWeight: '700', fill: 0xf2e6c8 }, 12, true, 4);
    label.position.set(DX + w / 2, top + ROOM_H / 2 - 9);
    const cost = richLine(info.cost, { fontFamily: 'Rubik, sans-serif', fontSize: 11, fontWeight: '700', fill: 0xffd447 }, 12, false, 4);
    cost.position.set(DX + w / 2, top + ROOM_H / 2 + 11);
    const sign = new Container();
    sign.addChild(g);
    if (this.gfx2) {
      // [gfx2 signage] Bolted steel sign, same look as the room tags and the dig sign.
      const pw = Math.min(w - 8, Math.max(lineWidth(label), lineWidth(cost)) + 26);
      const plate = new Graphics();
      steelTag(plate, DX + (w - pw) / 2, top + ROOM_H / 2 - 24, pw, 46, { rivets: 4, stripe: true });
      sign.addChild(plate);
      label.y += 3;
      cost.y += 2;
    }
    sign.addChild(label, cost);
    sign.eventMode = 'static';
    sign.cursor = 'pointer';
    sign.hitArea = new Rectangle(DX, top, w, ROOM_H);
    sign.on('pointertap', () => {
      if (!this.cam.isDragging) this.onDistrictDig?.();
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
    if (!p.container.parent.parent?.parent) return null; // [perf] the room (or lot) is out of view and out of the scene
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
    b.hitArea = new SlopArea(-16, -16, 32, 34, b); // [plan4:ST-12 #4] >= 44 screen px
    b.on('pointertap', (e) => {
      e.stopPropagation();
      if (!this.cam.isDragging) this.onBubbleTap?.(buildingId);
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
      // [plan4:UX-17] Medium and Low ask the system for the economical GPU (only matters where there are two, e.g. a MacBook).
      powerPreference: startQuality() === 'high' ? 'high-performance' : 'low-power',
      resolution: targetResolution(startQuality()),
      autoDensity: true,
      autoStart: false,
      // Textures idle for a while leave the GPU (they come back when drawn again): sooner than Pixi's minute, sooner still in lite mode.
      gcMaxUnusedTime: isLiteMode() ? 15_000 : 30_000,
    });
    this.watchContext(canvas);
    this.highlightLayer.eventMode = 'none';
    this.labelLayer.eventMode = 'none';
    this.dust.container.eventMode = 'none';
    this.utilitiesHolder.eventMode = 'none';

    this.surface = buildSurface();
    this.worldContainer.addChild(
      this.surfaceHolder, this.projectSites.layer, this.projectSites.smokeLayer, this.projectSites.glowLayer, this.projectSites.crew, this.projectSites.signLayer, this.undergroundHolder, this.bayHolder, this.slotLayer, this.highlightLayer,
      this.roomLayer, this.shaftHolder, this.utilitiesHolder, this.walkers.layer, this.dust.container, this.digHolder, this.wingSigns.container, this.districtSignHolder, this.fxLayer, this.incidents.fx, this.disasterFx.fx,
      this.labelLayer, this.incidents.badges, this.ghost.layer,
    );
    this.ghost.onDown = (e, gx, gy) => this.beginGhostDrag(e.pointerId, gx, gy); // [plan4:ST-19]
    this.dropRing.eventMode = 'none';
    this.dropRing.zIndex = 9000; // under the carried survivor (9999), over the rooms
    this.fxLayer.addChild(this.dropRing);
    this.app.stage.addChild(this.worldContainer);
    this.worldContainer.filters = [this.grade];
    this.surfaceHolder.addChild(this.surface.container);
    this.projectSites.onTap = id => { if (!this.cam.isDragging) this.onProjectClick?.(id); };
    this.bayHolder.eventMode = 'none';
    PEOPLE_STYLE.painted = this.gfx2;
    if (this.gfx2) for (const k of KIT_KEYS) ArtLibrary.get(k);
    // A painting finished loading: rebuild room visuals so placeholders switch to art.
    // [perf] Arrivals are gathered and applied together (applyLoadedArt): a painting used to rebuild the whole scene by itself,
    // and the dozens that arrive at start-up did that dozens of times.
    ArtLibrary.onLoaded(key => {
      const now = performance.now();
      if (this.artPending.size === 0) this.artFirstAt = now;
      this.artPending.add(key);
      this.artLastAt = now;
    });
    this.setupRenderGroups(); // [perf]
    this.cam.setup();
    setPopupBlocker((x, y) => this.inIncident(x, y)); // [camera]
    this.cam.fitToScreen();
    // gfx-p0 light: the composite takes over the era grade and reads the era/night for vignette and night lighting.
    this.postfx = new PostFX(this.app, this.worldContainer, this.grade, () => ({ era: this.surfaceEra, night: this.nightNow, target: this.frameTarget }));
    window.addEventListener('resize', () => {
      this.app.renderer.resize(window.innerWidth, window.innerHeight);
      this.cam.onResize(); // [plan4:ST-12] keeps zoom and centre for small changes (Safari's address bar)
    });
  }

  /**
   * [perf] Render groups. Pixi rebuilds the draw list of a whole render group whenever anything in it is shown, hidden, added or
   * removed, and the world used to be ONE group of ~13,000 objects (every particle that hid itself rebuilt all of them, every picture:
   * 55% of the render time). Each layer is its own group now, and so is every room, so a change only rebuilds what contains it.
   * The labels are what the probe (src/dev/perf.ts) prints.
   */
  private setupRenderGroups(): void {
    const named: [Container, string][] = [
      [this.worldContainer, 'world'], [this.surfaceHolder, 'surface'], [this.projectSites.layer, 'sites'], [this.projectSites.smokeLayer, 'siteSmoke'],
      [this.projectSites.glowLayer, 'siteGlow'], [this.projectSites.crew, 'siteCrew'], [this.projectSites.signLayer, 'siteSigns'],
      [this.undergroundHolder, 'underground'], [this.bayHolder, 'bays'], [this.slotLayer, 'slots'], [this.roomLayer, 'rooms'], [this.shaftHolder, 'shaft'],
      [this.utilitiesHolder, 'utilities'], [this.dust.container, 'dust'], [this.digHolder, 'dig'], [this.districtSignHolder, 'districtSign'],
      [this.fxLayer, 'fx'], [this.incidents.fx, 'incidentFx'], [this.disasterFx.fx, 'disasterFx'], [this.labelLayer, 'labels'], [this.incidents.badges, 'badges'],
    ];
    for (const [c, label] of named) {
      c.label = label;
      c.isRenderGroup = true;
    }
    this.roomLayer.sortableChildren = true; // rooms come and go with the camera (cullRooms); their z-index keeps the order
  }

  private contentBottom(): number {
    return floorTop(this.floors + 1) + 20;
  }

  /** [plan4:ST-12] Camera facade for the depth ruler and the section chips (src/ui/components/DepthRuler.ts). */
  get camera(): CameraController {
    return this.cam;
  }

  /** [plan4:ST-12] Widest floor reach in world x (west wing end, east end). */
  get floorSpan(): Readonly<{ l: number; r: number }> {
    return this.span;
  }

  /** [plan4:ST-12] Current camera zoom (world px to screen px), for screen-space text and the depth ruler. */
  get cameraZoom(): number {
    return this.cam.zoom;
  }

  /** [perf] The camera (or a carried person) is moving right now: the engine draws at its motion rate (60) while this holds. */
  get cameraMoving(): boolean {
    return this.cam.moving || this.ghost.moving;
  }

  /** [perf] Short animations on the picture (bursts, floating icons, a crisis in a room) that would stutter at the idle rate. */
  get fxActive(): boolean {
    return this.bursts.length > 0 || this.floaters.length > 0 || this.blockN > 0;
  }

  /** Dev tools: put the camera at a world point with a zoom relative to the fit-to-screen zoom. */
  devCamera(x: number, y: number, zoomRel: number): void {
    this.cam.devCamera(x, y, zoomRel);
  }

  /** Glides a floor into view (used when placing a room and after digging). */
  focusFloor(floor: number): void {
    this.cam.focusFloor(floor);
  }

  /** Which room soundscapes should be audible, from the rooms currently on screen. */
  getAmbienceMix(state: GameState): AmbienceMix[] {
    const { width, height } = this.app.screen;
    const closeness = Math.min(1, 0.35 + 0.65 * ((this.cam.zoom - this.cam.baseZoom) / Math.max(0.01, this.cam.baseZoom * 1.5)));
    const acc = new Map<AmbienceKey, { level: number; panSum: number; w: number }>();
    for (const b of state.buildings) {
      if (b.isConstructing && b.level === 1) continue;
      const key = AMBIENCE_FOR[b.type];
      if (!key) continue;
      const c = this.roomCenter(b);
      const sx = this.worldContainer.x + c.x * this.cam.zoom;
      const sy = this.worldContainer.y + (c.y + ROOM_H / 3) * this.cam.zoom;
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
    // [plan4:ST-4] How far every floor reaches (layout.ext): the camera's world edges follow the widest ones.
    const exts = this.extsFor(state);
    this.exts = exts;
    this.extentL = exts.reduce((m, x) => Math.max(m, x.w), 0) > 0 ? slotX(-exts.reduce((m, x) => Math.max(m, x.w), 0)) - 14 : 0;
    this.extentL = Math.min(this.extentL, this.rowOpen ? ROW_X0 - 14 : -280); // plan4:ST-16 the camera may pan to the row's west end, or (closed) to the ruin of the old gate house
    this.extentWingR = slotX(exts.reduce((m, x) => Math.max(m, x.e), 12));
    this.extentR = Math.max(BUILDING_W, this.extentWingR, this.projectSites.right);
    // [plan4:ST-4] A west wing past the classic edge: the sky, ground and dark edge of the surface move out with the rock (rebuilt once per two-slot step).
    const rowWas = this.rowOpen;
    this.rowOpen = !!state.layout?.surfaceOpen; // plan4:ST-16
    const wl = worldLeft(Math.max(this.rowOpen ? 11 : 0, exts.reduce((m, x) => Math.max(m, x.w), 0))); // plan4:ST-16 the row's slots -11..-4 need the world to reach west
    if (wl !== this.surfaceLeft || rowWas !== this.rowOpen) { this.surfaceLeft = wl; this.surfaceSig = ''; this.refreshSurface(); }
    this.undergroundHolder.removeChildren().forEach(c => c.destroy({ children: true }));
    const districtList = state.buildings.filter(b => isDistrict(b.type));
    const districts = districtList.map(b => b.position.floor);
    const districtSlot: Record<number, number> = {};
    for (const b of districtList) districtSlot[b.position.floor] = b.position.x; // [plan4:ST-8]
    const casing = this.gfx2 && kitReady() ? buildCasing(this.floors, kitState(this.surfaceEra), exts) : null;
    this.undergroundHolder.addChild(buildUnderground(this.floors, i18n.currentLocale, this.gloom, ArtLibrary.get('backdrops/rock'), districts, casing, exts, districtSlot, this.rowOpen ? 11 : 0)); // plan4:ST-16
    this.undergroundSig = this.structureSig(state);
    this.structureGloom = this.gloom;
    this.shaftHolder.removeChildren().forEach(c => c.destroy({ children: true }));
    // G3 shaft hook: the painted industrial lift with the new look.
    this.shaft = this.gfx2 && kitReady()
      ? buildShaft2(this.floors, this.surfaceEra, () => this.onElevator?.(), exts.map(x => x.w > 0), GFX.airy ? Array.from({ length: this.floors }, (_, f) => signZone(f, state.buildings, i18n.currentLocale).color) : []) // [plan4:ST-4] a second landing door where a floor has a west wing [airy:B3] zone colours for the landing beacons
      : buildShaft(this.floors, () => this.onElevator?.());
    this.shaftHolder.addChild(this.shaft.container);
    this.walkers.setLift((this.shaft as Partial<ShaftAnimated>).lift ?? null); // plan4:ST-18
    this.dust.setFloors(this.floors);
    this.placement.rebuildPad(this.floors, f => floorExtent(state, f)); // [plan4:X-2]
    this.placement.surfaceOpen = this.rowOpen; // plan4:ST-16
    this.utilitiesSig = '';
    this.digSig = '';
    this.roomViews.collectStructureCullables(this.undergroundHolder);
  }


  /** [plan4:ST-4] How far every floor reaches; with the `wings` feature switched off every floor draws as the classic 12 east of the shaft. */
  private extsFor(state: GameState): Ext[] {
    return GFX.wings ? extentsFor(state, this.floors) : Array.from({ length: this.floors }, () => ({ w: 0, e: 12 }));
  }

  /** [plan4:ST-4] The dig signs at the open ends of the floors: the options are asked for twice a second (or when the reach of a floor changes). */
  private updateWingSigns(state: GameState): void {
    if (import.meta.env.DEV) this.devState = state;
    if (LAYOUT.ext !== this.wingHash || this.time - this.wingAt > 0.5) {
      this.wingHash = LAYOUT.ext;
      this.wingAt = this.time;
      const opts = wingOptions(state);
      const sig = opts.map(o => `${o.floor}${o.side}${o.steps}${o.block ?? ''}${JSON.stringify(o.cost)}`).join(';') + `|${this.floors}|${LAYOUT.ext}`;
      if (sig !== this.wingSig) {
        this.wingSig = sig;
        this.wingSigns.onDig = (f, side) => this.onWingDig?.(f, side);
        this.wingSigns.set(opts, this.exts);
      }
    }
    this.wingSigns.update(this.mapCovers);
  }

  private structureSig(state: GameState): string {
    void state;
    return `${LAYOUT.districts}|${LAYOUT.ext}|${!!ArtLibrary.get('backdrops/rock')}|${this.gfx2 && kitReady()}|${this.gfx2 ? this.surfaceEra : ''}`; // [perf] districts = hash of their floors (hashLayout)
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
      if (!this.cam.isDragging) this.onDigClick?.();
    });
    this.digHolder.addChild(sign);
  }

  setPlacementHighlight(isValid: ((pos: Position) => boolean) | null, levels = 1): void {
    this.placement.setHighlight(isValid, levels, this.floors);
  }

  // ───────────────────────────── [plan4:ST-19] the ghost room ─────────────────────────────

  /** Shows (or moves) the ghost of a room on a spot; `ok` = the room can stand there. */
  showGhost(type: BuildingType, pos: Position, ok: boolean): void {
    this.ghost.show(type, pos, ok);
  }

  hideGhost(): void {
    this.ghostDrag = null;
    this.ghost.hide();
    this.cam.carryBottomExtra = 0;
  }

  /** Refused spot: the ghost shakes (not under reduced motion). */
  shakeGhost(): void {
    this.ghost.shake();
  }

  get ghostSpot(): Position | null {
    return this.ghost.spot;
  }

  /** The ghost's rectangle in canvas px (for the chips above it), or null. */
  ghostScreenRect(): { x: number; y: number; w: number; h: number } | null {
    const r = this.ghost.rect();
    if (!r) return null;
    const wc = this.worldContainer;
    return { x: wc.x + r.x * wc.scale.x, y: wc.y + r.y * wc.scale.y, w: r.w * wc.scale.x, h: r.h * wc.scale.y };
  }

  /** Glides the camera so the ghost sits fully in view above the confirm bar (`barPx` = what the bar covers at the bottom). */
  revealGhost(barPx: number, centre = false): void {
    const r = this.ghost.rect();
    if (r) this.cam.keepRectInSight(r, barPx, centre);
  }

  /** Screen px at the bottom that a carried thing's finger may not scroll under (the confirm bar). */
  setCarryInset(px: number): void {
    this.cam.carryBottomExtra = px;
  }

  /** Brings a world rectangle into view (above the bar). */
  revealRect(x: number, y: number, w: number, h: number, barPx: number): void {
    this.cam.keepRectInSight({ x, y, w, h }, barPx);
  }

  private beginGhostDrag(pointerId: number, grabX: number, grabY: number): void {
    window.clearTimeout(this.pressTimer);
    this.ghostDrag = { pointerId, grabX, grabY };
    this.cam.pointerDown = false; // the finger is on the ghost, not on the camera
    this.onGhostLift?.();
  }

  private moveGhostTo(sx: number, sy: number): void {
    const d = this.ghostDrag;
    if (!d) return;
    const p = this.worldContainer.toLocal({ x: sx, y: sy });
    this.onGhostDrag?.(p.x - d.grabX, p.y - d.grabY);
  }

  private endGhostDrag(): void {
    if (!this.ghostDrag) return;
    this.ghostDrag = null;
    this.onGhostDrop?.();
  }

  /** A quick tap on the canvas: outside the bunker's outline (and off the ghost) it is an "empty space" tap. */
  private onCanvasTap(sx: number, sy: number): void {
    if (this.ghostDrag || this.drag) return;
    const p = this.worldContainer.toLocal({ x: sx, y: sy });
    const r = this.ghost.rect();
    if (r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return;
    if (this.placement.insideBunker(p.x, p.y)) return;
    this.onPlacementEmptyTap?.();
  }

  setSelected(buildingId: string | null): void {
    this.selectedId = buildingId;
    for (const [id, v] of this.views) v.outline.visible = id === buildingId;
    // [camera] The sheet that opens for the room must not hide it: glide it into the space above the sheet.
    if (buildingId) window.setTimeout(() => this.cam.keepInSight(buildingId), 60);
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
    this.walkers.clear(); // plan4:ST-18
    for (const p of this.people.values()) p.container.destroy({ children: true });
    this.people.clear();
    this.selectedId = null;
    this.placement.clearHighlight();
    this.floors = 0;
  }




  /** Picking a survivor up: a short press on them lifts them off the floor. */
  private attachDrag(person: Person, survivorId: string): void {
    person.container.on('pointerdown', (e) => {
      window.clearTimeout(this.pressTimer);
      const pointerId = e.pointerId;
      this.pressTimer = window.setTimeout(() => {
        if (this.cam.isDragging) return;
        this.drag = { person, survivorId, pointerId };
        person.setLifted(true);
        this.fxLayer.addChild(person.container);
        person.container.zIndex = 9999;
        this.cam.pointerDown = false;
        this.movePersonTo(e.global.x, e.global.y);
        this.onPersonLift?.(survivorId); // [plan4:UX-20] haptic impact on the lift
      }, pressMs(260)); // plan4:AC-13
    });
    person.container.on('pointerup', () => {
      if (!this.drag && !this.cam.isDragging) this.onPersonTap?.(survivorId);
      window.clearTimeout(this.pressTimer);
    });
    person.container.on('pointerupoutside', () => window.clearTimeout(this.pressTimer));
  }

  /** [plan4:UX-20] The carried survivor hovers this many screen px above the finger, so the hand does not hide them or the room they are over. */
  private static readonly LIFT_PX = 44;

  private movePersonTo(sx: number, sy: number): void {
    if (!this.drag) return;
    // The feet are 44 screen px above the fingertip (at any zoom); the room under the feet is the drop target.
    const p = this.worldContainer.toLocal({ x: sx, y: sy - BunkerRenderer.LIFT_PX });
    this.drag.person.container.position.set(p.x, p.y);
    this.drag.person.container.scale.set(1.25);
    this.hoverId = this.targetAt(sx, sy - BunkerRenderer.LIFT_PX);
    this.onPersonHover?.(this.drag.survivorId, this.hoverId, sx, sy);
  }

  /** [plan4:UX-20] A ring round a room or ruin (green, solid: it takes the survivor; red, dashed: it does not); null clears it. */
  setDropRing(targetId: string | null, ok: boolean): void {
    const sig = `${targetId ?? ''}|${ok}`;
    if (sig === this.dropRingSig) return;
    this.dropRingSig = sig;
    const g = this.dropRing;
    g.clear();
    if (!targetId) return;
    const room = this.views.get(targetId);
    const ruin = this.ruinViews.get(targetId);
    const x = room ? room.root.x : ruin ? ruin.root.x : 0, y = room ? room.root.y : ruin ? ruin.root.y : 0;
    const w = room ? room.width : ruin ? ruin.width : 0, h = room ? room.height : ROOM_H;
    if (w <= 0) return;
    const c = statusTint(ok ? 'ok' : 'bad');
    g.rect(x, y, w, h).fill({ color: c, alpha: 0.14 });
    if (ok) g.rect(x + 1.5, y + 1.5, w - 3, h - 3).stroke({ color: c, alpha: 0.95, width: 3 });
    else {
      dashedRect(g, x + 1.5, y + 1.5, w - 3, h - 3, 9, 5);
      g.stroke({ color: c, alpha: 0.95, width: 3 });
    }
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

  private endDrag(sx: number, sy: number, overHud = false): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    d.person.setLifted(false);
    d.person.roomId = null;
    this.hoverId = null;
    this.setDropRing(null, true);
    this.onPersonHover?.(d.survivorId, null, sx, sy);
    // [plan4:UX-20] Let go over the HUD (or over nothing) and the drop is cancelled: the survivor goes back to what they were doing.
    this.onPersonDrop?.(d.survivorId, overHud ? null : this.targetAt(sx, sy - BunkerRenderer.LIFT_PX));
  }

  /** [plan4:ST-14/18] Latest state for the walkers' door check (one closure for the renderer's life: no allocation per frame). */
  private doorState: GameState | null = null;
  private readonly doorBlockedFn = (f: number, a: number, b: number): boolean => !!this.doorState && !isPassable(this.doorState, f, a, b);

  private renderPeople(state: GameState, dt: number): void {
    this.doorState = state; setDoorBlocked(this.doorBlockedFn); // plan4:ST-14/18 closed or sealed bulkheads stop walkers
    this.walkers.power = state.powerRatio ?? 1; // plan4:polish
    this.walkers.refreshHot(state); // plan4:polish rooms on fire or collapsing: their crew walks out
    this.walkers.update(dt, this.time, this.cam.zoom); // plan4:ST-18 (before the placement below, so a finished walk is placed this picture)
    const quarters = state.buildings.filter(b => b.type === 'quarters' && !(b.isConstructing && b.level === 1));
    const seen = new Set<string>();
    const sleeping = new Map<string, number>();
    let idleIndex = 0;
    // Plan 2026-10 M5: at mealtimes (7, 12 and 19 o'clock on the bunker clock) a few idle people eat at the canteen's table.
    const hour = timeOfDay(state.stats.totalPlayTime).hour;
    const mealMap = new Map<string, string>();
    const forcedMeal = (window as unknown as { __forceMeal?: boolean }).__forceMeal;
    const mealOn = this.gfx2 && GFX.sitSleep && this.nightNow < 0.65 && (forcedMeal ?? (hour === 7 || hour === 12 || hour === 19));
    if (mealOn) {
      const free = state.survivors.filter(sv => !sv.isOnMission && !sv.assignedBuildingId)
        .sort((a, b) => hashString(a.id + hour) - hashString(b.id + hour));
      let next = 0;
      for (const cb of state.buildings) {
        if (cb.type !== 'canteen' || (cb.isConstructing && cb.level === 1)) continue;
        const cap = restCountFor(this.views.get(cb.id)?.visualSig ?? '', 'eat');
        for (let i = 0; i < cap && next < free.length; i++) mealMap.set(free[next++].id, cb.id);
      }
    }
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
      const meal = !ruinView && !usable ? mealMap.get(s.id) : undefined;
      const roomId = ruinView ? s.assignedBuildingId : usable ? job!.id : meal ?? home?.id ?? null;
      const view: { people: Container; lane: Lane } | undefined = ruinView ?? (roomId ? this.views.get(roomId) : undefined);
      if (!view) {
        person.container.parent?.removeChild(person.container);
        person.roomId = null;
        continue;
      }
      // At night the idle go to bed in the bunks: hidden, with a Zzz over the dormitory.
      const asleep = !ruinView && !usable && this.nightNow > 0.65;
      // Plan 2026-10 M5: where the painting has beds and seats, the idle use them (lie down at night, eat at mealtimes, sit by day).
      person.setIntent(!this.gfx2 || ruinView || usable ? 'none' : asleep ? 'sleep' : meal ? 'eat' : (hashString(s.id) + hour) % 5 < 2 ? (mealOn ? 'eat' : 'sit') : 'none');
      if (person.roomId !== roomId || person.container.parent !== view.people) {
        if (this.walkers.intercept(person, person.roomId ? this.views.get(person.roomId) : undefined, this.views.get(roomId!), roomId!, state, this.cam.zoom)) continue; // plan4:ST-18 walks there instead of appearing
        view.people.addChild(person.container);
        person.placeIn(roomId!, view.lane);
      }
      if (!ruinView && this.walkers.isHot(roomId!) && this.walkers.evacuate(person, this.views.get(roomId!)!, roomId!, state, this.cam.zoom)) continue; // plan4:polish fire or collapse: out to the stairwell
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
      // [airy:B5] Name tags over every head stacked up on the painting: with `airy` only the selected room's people and a really close camera show them.
      const tagged = this.lod === 'close' && (!GFX.airy || this.cam.zoom > 1.9 || (roomId !== null && roomId === this.selectedId));
      person.setTag(tagged ? this.nameOf?.(s) ?? s.name : null);
      person.setCondition(s.happiness, s.health);
      const activity: Activity = siteView ? 'hammer' : ruinView ? 'dig' : usable ? ROOM_ACTIVITY[job!.type] ?? 'idle' : 'idle';
      // [perf] Nobody watches a room that is off screen: its people stand still until it comes back into view.
      if (!(siteView ? this.surfaceOff : (view as { culled?: boolean }).culled) && !this.lowSkip) person.update(dt, this.time, 0.4 + (s.happiness / 100) * 0.6, activity);
      // Whoever is not in a bed at night is still hidden, with a Zzz over the dormitory.
      const lying = person.isSleeping;
      person.container.visible = !asleep || lying;
      if (asleep && !lying) sleeping.set(roomId!, (sleeping.get(roomId!) ?? 0) + 1);
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
    this.infra?.sync(state); // plan4:ST-14 the doors' states and the set of infra items are read every picture
    const painted = this.gfx2 && kitReady();
    // [perf] The structure follows the rooms (place, level, new), the ruins, the era's darkness and the plaque's names; LAYOUT.util is
    // one number for the first three (hashLayout), so a picture where nothing changed builds one short string, not a 4 KB one.
    const sig = `${LAYOUT.util}|${this.floors}|${painted}|${painted ? `${this.gloom}|${this.surfaceEra}` : ''}|${i18n.currentLocale}|${state.danger?.fallen?.length ?? 0}|${state.danger?.fallen?.[(state.danger.fallen.length ?? 1) - 1]?.name ?? ''}`;
    if (sig === this.utilitiesSig) return;
    this.utilitiesSig = sig;
    const memorial = this.memorialText(state); // [Danger C5]
    this.frontChunks.container.parent?.removeChild(this.frontChunks.container); // [plan4:ST-7] the chunks are kept, not destroyed with the rest
    this.utilitiesHolder.removeChildren().forEach(c => c.destroy({ children: true }));
    this.bayHolder.removeChildren().forEach(c => c.destroy({ children: true }));
    this.front = null;
    this.galleries = null;
    if (!painted) this.frontChunks.clear();
    this.decals = null; // [gfx2 wear]
    this.atmo = null; // [gfx2 wear]
    this.infra = null; // plan4:ST-14 (destroyed with the holder's children)
    if (painted) {
      const exts = this.extsFor(state); // [plan4:ST-4]
      const grid = occupancy(state.buildings, state.ruins, this.floors, exts);
      this.bayHolder.addChild(buildBays(grid));
      const lamps = this.worldLamps(state);
      // [plan4:ST-7] Describe the structure to the chunk manager: unchanged chunks stay as they are, changed ones are rebuilt lazily when near the camera.
      this.frontChunks.set(grid, state.buildings, this.floors, lamps, structureAmbient(this.surfaceEra) /* G4 lighting: era ambient */, kitState(this.surfaceEra));
      this.front = this.frontChunks;
      this.utilitiesHolder.addChild(this.group(this.frontChunks.container, 'front'));
      this.frontChunks.update(performance.now());
      // [plan4:ST-1] Service galleries (no-op while the flag is off or fewer than four floors exist).
      this.galleries = buildGalleries(this.floors, exts, kitState(this.surfaceEra), structureAmbient(this.surfaceEra));
      if (this.galleries.container.children.length) this.utilitiesHolder.addChild(this.group(this.galleries.container, 'galleries'));
      // [gfx2 signage] Zone plates, slab stencils and wall props (signage.ts).
      this.utilitiesHolder.addChild(this.group(buildSignage({
        buildings: state.buildings, ruins: state.ruins, floors: this.floors, era: Math.max(0, this.surfaceEra),
        locale: i18n.currentLocale, rtl: i18n.isRTL, lamps, ambient: 0.5 - this.gloom * 0.35, memorial, exts,
        infra: state.layout?.infra, // plan4:polish
      }), 'signage'));
      // [gfx2 wear] Wear decals in front of the structure (clear of the signage), then the atmosphere.
      const wearEra = Math.max(0, this.surfaceEra);
      this.decals = buildDecals(grid, state.buildings, this.floors, wearEra, lamps, structureAmbient(this.surfaceEra),
        this.utilitiesHolder.children.filter(c => c !== this.front?.container));
      this.utilitiesHolder.addChild(this.group(this.decals.container, 'decals'));
      this.atmo = buildAtmosphere(state.buildings, this.floors, wearEra, lamps, this.decals.sources, exts);
      this.utilitiesHolder.addChild(this.group(this.atmo.container, 'atmosphere'));
      this.infra = new InfraLayer(); // plan4:ST-14
      this.infra.set(state, { floors: this.floors, exts, st: kitState(this.surfaceEra), ambient: structureAmbient(this.surfaceEra) }); // plan4:ST-14
      this.utilitiesHolder.addChild(this.group(this.infra.container, 'infra')); // plan4:ST-14
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
    this.utilities = buildUtilities(state.buildings, this.floors, painted, this.extsFor(state));
    this.utilitiesHolder.addChild(this.group(this.utilities.container, 'pipes'));
  }

  /** [perf] Makes a container a render group of its own (and names it for the probe). */
  private group<T extends Container>(c: T, label: string): T {
    c.label = label;
    c.isRenderGroup = true;
    return c;
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
      const mirror = this.roomViews.compoundIndex(state, b) % 2 === 1;
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
  /** [plan4:UX-17] Told when the GPU context is lost (true) and when it is back (false). */
  onContextChange: ((lost: boolean) => void) | null = null;
  private drawFails = 0;

  private watchContext(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('webglcontextlost', ev => {
      ev.preventDefault();
      this.contextLost = true;
      this.onContextChange?.(true); // [plan4:UX-17] the app shows a quiet "restoring graphics" note
      logCrash('gl-context-lost', 'WebGL context lost');
    });
    // Pixi's own listener (registered first) has already re-initialised the GL systems by now.
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.onContextChange?.(false);
      // [perf] The paintings gave up their decoded copies once on the GPU (ArtLibrary.trimBitmaps): they are loaded again from the cache.
      ArtLibrary.reset();
      if (this.gfx2) for (const k of KIT_KEYS) ArtLibrary.get(k);
      this.recoverGraphics();
    });
  }

  /**
   * Rooms wholly off screen are neither drawn nor animated: zoomed in, most of the bunker is out of view, and every
   * hidden room used to cost as much CPU and GPU as a visible one (heat, battery).
   */
  /** [perf] When the paintings' decoded copies were last given back (ArtLibrary.trimBitmaps), and the last memory sweep. */
  private lastTrim = 0;
  private lastSweep = 0;
  /** [perf] Low quality steps some animation every other picture (see updateScene). */
  private lowSkip = false;
  private frameNo = 0;
  private artIdle = new Map<string, number>();

  /**
   * [perf] Room, hall, district and ruin paintings that no room shows any more (it left the camera's reach, see renderRooms) are released
   * after 20 s: the GPU copy and the decoded copy go, and the painting is fetched again (from the cache) if a room needs it later.
   */
  private sweepArt(now: number): void {
    this.lastSweep = now;
    const used = new Set<string>();
    for (const v of this.views.values()) {
      const k = v.visualSig.split('|')[4];
      if (k && k !== 'code') used.add(k);
      if (v.oldVisual) used.add('*'); // a look is still fading: leave everything alone this round
    }
    for (const v of this.ruinViews.values()) {
      const k = v.visualSig.split('|')[0];
      if (k && k !== 'code') used.add(k);
    }
    const ghostArt = this.ghost.paintingKey; // [plan4:ST-19] the ghost room holds its painting
    if (ghostArt) used.add(ghostArt);
    if (used.has('*')) return;
    const free: string[] = [];
    for (const key of ArtLibrary.loadedKeys) {
      if (!(key.startsWith('rooms/') || key.startsWith('halls/') || key.startsWith('districts/') || key.startsWith('ruins/'))) continue;
      if (used.has(key)) {
        this.artIdle.delete(key);
        continue;
      }
      const since = this.artIdle.get(key);
      if (since === undefined) this.artIdle.set(key, now);
      else if (now - since > 20000) {
        free.push(key);
        this.artIdle.delete(key);
      }
    }
    if (free.length) ArtLibrary.release(free);
  }
  /** [perf] Paintings that arrived since the last scene refresh, and when the first / the latest of them did. */
  private artPending = new Set<string>();
  private artFirstAt = 0;
  private artLastAt = 0;

  /** Applies the arrivals once they have settled (100 ms without a new one, or 600 ms since the first): only what used them is rebuilt. */
  private applyLoadedArt(now: number): void {
    if (this.artPending.size === 0 || (now - this.artLastAt < 100 && now - this.artFirstAt < 600)) return;
    const keys = this.artPending;
    this.artPending = new Set();
    let structure = false;
    let rooms = false;
    let ruins = false;
    for (const k of keys) {
      if (k.startsWith('rooms/') || k.startsWith('halls/') || k.startsWith('districts/')) rooms = true;
      else if (k.startsWith('ruins/')) ruins = true;
      else structure = true;
    }
    if (rooms) {
      // A room shows its painting or, until it arrives, a drawn stand-in ('code'): rebuild those waiting and those using a key that came.
      for (const v of this.views.values()) {
        const used = v.visualSig.split('|')[4];
        if (used === 'code' || keys.has(used)) v.visualSig = '';
      }
    }
    if (ruins) {
      for (const v of this.ruinViews.values()) {
        const used = v.visualSig.split('|')[0];
        if (used === 'code' || keys.has(used)) v.visualSig = '';
      }
    }
    if (structure) {
      this.undergroundSig = '';
      this.utilitiesSig = '';
      this.refreshSurface();
    }
  }

  /** [perf] The world rectangle on screen (plus a margin for glows and shadows), shared with the effects through perfFx.VIEW. */
  private updateView(): void {
    const wc = this.worldContainer;
    const s = wc.scale.x || 1;
    const margin = 80; // glows and shadows reach past a room's edge
    VIEW.x0 = -wc.x / s - margin;
    VIEW.y0 = -wc.y / s - margin;
    VIEW.x1 = (this.app.screen.width - wc.x) / s + margin;
    VIEW.y1 = (this.app.screen.height - wc.y) / s + margin;
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
    const hook = this.perfHook; // [perf] only set while the probe (?perf) is on
    const t0 = hook ? performance.now() : 0;
    let t1 = 0;
    try {
      this.updateScene(state, dt, alpha);
    } finally {
      if (hook) { t1 = performance.now(); hook.beforeDraw(); }
      this.draw();
      if (hook) hook.afterDraw(t0, t1, performance.now());
    }
  }

  /** [perf] Set by src/dev/perf.ts: counts what each picture costs (draw calls, render group rebuilds, update/draw time). */
  perfHook: { beforeDraw(): void; afterDraw(t0: number, t1: number, t2: number): void } | null = null;

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

    setGfxQuality(this.postfx?.quality ?? 'high', isLiteMode());
    this.applyLoadedArt(now);
    if (now - this.lastTrim > 2000) {
      this.lastTrim = now;
      ArtLibrary.trimBitmaps((this.app.renderer as unknown as { uid: number }).uid);
      if (now - this.lastSweep > 5000) this.sweepArt(now);
    }
    hashLayout(state); // [perf] one cheap pass instead of strings joined from every building several times per picture
    this.updateSpan(state);
    if (state.currentFloors !== this.floors || this.structureGloom !== this.gloom || this.undergroundSig !== this.structureSig(state)) this.rebuildStructure(state);
    this.cam.stepCamera(dt); // [camera]
    this.ghost.update(dt); // [plan4:ST-19]
    hitState.zoom = this.cam.zoom;
    if (updateLabelScale(this.cam.zoom, now)) this.roomViews.applyLabelScale(); // [plan4:ST-12] tags keep a readable screen size
    this.updateView(); // [perf]
    this.front?.update(now); // [plan4:ST-7] chunks near the camera are built, the ones in view shown, the far ones given back
    this.updateLod(state, dt);
    this.roomViews.render(state);
    this.renderRuins(state);
    this.renderUtilities(state);
    this.updateWingSigns(state);
    this.renderPeople(state, dt);

    const power = state.powerRatio ?? 1;
    (this.surface as { setQuality?: (q: 'high' | 'medium' | 'low') => void } | null)?.setQuality?.(this.postfx?.quality ?? 'high'); // gfx-p0 surface: particle budget
    // [perf] Far below the ground nothing of the surface (sky, weather, the project lots) can be seen: it is neither drawn nor animated.
    const surfaceOff = VIEW.y0 > 20;
    if (surfaceOff !== this.surfaceOff) {
      this.surfaceOff = surfaceOff;
      for (const c of [this.surfaceHolder, this.projectSites.layer, this.projectSites.smokeLayer, this.projectSites.glowLayer, this.projectSites.crew, this.projectSites.signLayer]) c.visible = !surfaceOff;
    }
    if (!surfaceOff) {
      const live = this.surface as { playTime?: number; inside?: unknown } | null; // plan4:ST-16/20 the game clock (wind, blades) and what the inside is doing (smoke, vents)
      if (live && 'playTime' in live) { live.playTime = state.stats.totalPlayTime; live.inside = readInside(state, this.inside); }
      this.surface?.animate(this.time, power);
      // The project lots share the surface's light, the painting's grade and the wind (src/rendering/projectSites.ts).
      const s2 = this.surface as { light?: number; grade?: number; wind?: number } | null;
      this.projectSites.animate(this.time, s2?.light ?? 0xffffff, s2?.grade ?? 0xffffff, this.nightNow, power, s2?.wind ?? 0.6);
    }
    // [perf] Low is really cheaper: the wear decals are not drawn, and the lamps' flicker, the rooms' and the people's animation step every
    // other picture (their motion is driven by the clock, so it only becomes a little coarser: Low draws at ~24 pictures a second anyway).
    const lowQ = this.postfx?.quality === 'low';
    this.lowSkip = lowQ && (++this.frameNo & 1) === 1;
    if (this.decals && this.decals.container.visible === lowQ) this.decals.container.visible = !lowQ;
    this.shaft?.animate(this.time, power);
    this.utilities?.animate(this.time, power);
    if (!this.lowSkip) {
      this.front?.animate(this.time, power);
      this.galleries?.animate(this.time, power);
      this.infra?.animate(this.time, power); // plan4:ST-14
      if (!lowQ) this.decals?.animate(this.time, power); // [gfx2 wear]
    }
    this.atmo?.update(this.time, dt, power, this.worldContainer, this.app.screen, this.postfx?.quality ?? 'high'); // [gfx2 wear]
    setRoomFxQuality(this.postfx?.quality ?? 'high'); // gfx-p0 rooms: heat haze on high, fewer particles on low
    this.roomViews.cull();
    for (const [id, v] of this.views) {
      if (!v.culled && !this.lowSkip) {
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
      if (!v.culled) v.visual?.animate(this.time, dt, working); // [perf]
      v.label.y = floorTop(r?.floor ?? 0) + ROOM_H * 0.3 + Math.sin(this.time * 2.2 + v.root.x) * 2;
    }
    this.incidents.quality = this.postfx?.quality ?? 'high'; // gfx-p0 crisis: particle budget follows the quality ladder
    this.incidents.update(state, this.time, dt, id => this.roomRect(id), f => { const ex = floorExtent(state, f); return { x: slotX(-ex.w), y: floorTop(f), w: (ex.w + ex.e) * SLOT_W }; }); // [plan4:ST-4] a floor reaches as far as its wings
    this.disasterFx.update(state, this.time, id => this.roomRect(id)); // [Danger]
    this.updateBlockers(state); // [camera]
    this.updateBursts(dt);
    this.updateFloaters(dt);
    this.updateGrade(dt);
    this.animateBubbles();
    // Battery saver drops the free-floating dust.
    const low = this.postfx?.quality === 'low';
    this.dust.container.visible = !low && !this.mapCovers;
    if (!low) this.dust.update(dt, this.time);
    this.postfx?.update(now);
  }

  /** [plan4:ST-12] Widest floor reach from the side wings (state.layout.ext); no allocation (this runs every picture). */
  private updateSpan(state: GameState): void {
    let w = 0, e = floorExtent(state, -1 /* a floor with no entry: the default extent */).e;
    const ext = state.layout?.ext;
    if (ext) for (const k in ext) { const x = ext[k]; if (x.w > w) w = x.w; if (x.e > e) e = x.e; }
    const l = w > 0 ? -SHAFT_GAP - w * SLOT_W : 0;
    const r = ROOMS_X + e * SLOT_W;
    if (l !== this.span.l || r !== this.span.r) { this.span.l = l; this.span.r = r; }
  }

  private updateLod(state: GameState, dt: number): void {
    // [plan4:ST-12] Absolute thresholds: the far city map under 0.42 (it used to be relative to the fit zoom, which moved with the screen width).
    const z = this.cam.zoom;
    const lod = z < (this.lod === 'far' ? FAR_ZOOM * 1.07 : FAR_ZOOM) ? 'far' : z > (this.lod === 'close' ? 1.1 : 1.2) ? 'close' : 'mid';
    if (lod !== this.lod) this.onLodChange?.(lod);
    this.lod = lod;
    const sig = lod === 'far' ? `${this.floors}|${LAYOUT.util}|${i18n.currentLocale}` : ''; // [perf] only needed while the map is up
    if (lod === 'far' && (!this.cityMap || sig !== this.cityMapSig)) {
      this.cityMap?.container.destroy({ children: true });
      this.cityMap = buildCityMap(state, this.floors, i18n.currentLocale);
      this.cityMapSig = sig;
      this.group(this.cityMap.container, 'cityMap');
      this.worldContainer.addChildAt(this.cityMap.container, this.worldContainer.getChildIndex(this.labelLayer));
    }
    if (this.cityMap) {
      const target = lod === 'far' ? 1 : 0;
      let a = this.cityMap.container.alpha + (target - this.cityMap.container.alpha) * (1 - Math.exp(-dt * 6)); // [camera] dt-exact
      // Plan 2026-10 Q11: the far-zoom map's labels end their fade instead of lingering as a faint ghost over the rooms.
      if (target === 0 && a < 0.06) a = 0;
      this.cityMap.container.alpha = a;
      this.cityMap.container.visible = a > 0.01;
      // [perf] The map's lit windows are one Graphics redrawn from scratch: 12 times a second is plenty for slow drifting sparks.
      if (this.cityMap.container.visible && this.time - this.mapAt >= 1 / 12) {
        this.mapAt = this.time;
        this.cityMap.animate(state, this.time, this.nightNow);
      }
      this.labelLayer.alpha = 1 - a;
      this.labelLayer.visible = a < 0.99;
      // Once the map is (all but) opaque, the rooms, the structure and the people under it are not drawn at all.
      const covers = a > 0.985;
      if (covers !== this.mapCovers) {
        this.mapCovers = covers;
        // (The rooms keep their roots so a tap on a lit window still opens the room, and the lift and empty slots stay tappable.)
        for (const l of [this.bayHolder, this.utilitiesHolder]) l.visible = !covers;
      }
    }
  }
  /** [perf] The far-zoom city map is up and covers the scene (see updateLod); time of its last redraw. */
  private mapCovers = false;
  private mapAt = -1;
  /** [perf] The camera is far below the ground: the surface is hidden and not animated (see updateScene). */
  private surfaceOff = false;

  /** Each era has its own look: the Remnant is cold and drained, the Undercity warm and full. */
  private refreshSurface(): void {
    const key = `backdrops/surface-${Math.max(0, this.surfaceEra)}`;
    const tex = ArtLibrary.get(key);
    const sig = `${key}|${!!tex}|${this.surfaceLeft}|${this.rowOpen}${this.gfx2 ? `|${surface2Sig(Math.max(0, this.surfaceEra))}` : ''}`; // [gfx2 surface] [plan4:ST-4] the west edge [plan4:ST-16] the row's apron or the gate-house ruin
    if (sig === this.surfaceSig) return;
    this.surfaceSig = sig;
    this.surfaceHolder.removeChildren().forEach(c => c.destroy({ children: true }));
    const RAYS = [0xc8d4e8, 0xffe2b8, 0xffd496, 0xffc878];
    if (this.gfx2) {
      // [gfx2 surface] painted entrance, topsoil and props: src/rendering/surface2.ts
      const s2 = buildSurface2(tex, coneTexture(), RAYS[Math.max(0, Math.min(3, this.surfaceEra))], Math.max(0, this.surfaceEra), () => this.nightNow, this.surfaceLeft, this.rowOpen); // plan4:ST-16
      mountSurface2(s2, this.worldContainer, this.undergroundHolder, this.shaftHolder);
      this.surface = s2;
    } else this.surface = buildSurface(tex, coneTexture(), RAYS[Math.max(0, Math.min(3, this.surfaceEra))], this.surfaceLeft);
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
        view.visual = r.floor < 0 ? buildSurfaceRuin(r, view.width, seeded(hashString(r.id))) : buildRuinVisual(r, view.width, texture, !!art?.darken, seeded(hashString(r.id))); // plan4:ST-16 a wreck on the surface row is rubble in the open
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
    root.label = 'ruin';
    root.isRenderGroup = true; // [perf]
    root.position.set(slotX(r.x), floorTop(r.floor));
    const people = new Container();
    people.sortableChildren = true;
    root.addChild(people);
    root.hitArea = { contains: (x: number, y: number) => x >= 0 && x <= width && y >= 0 && y <= ROOM_H };
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.on('pointertap', () => {
      if (!this.cam.isDragging) this.onRuinClick?.(r.id);
    });
    const label = new Container();
    label.position.set(slotX(r.x) + width / 2, floorTop(r.floor) + ROOM_H * 0.3);
    label.eventMode = 'none';
    return { root, visual: null, people, label, visualSig: '', labelSig: '', width, bar: null, attached: true, lane: { x0: 14, x1: width - 14 } };
  }

  /** Floating badge over a ruin: tap to clear, needs a pump, needs hands, and the work progress. */
  private drawRuinLabel(view: RuinView, r: Ruin, workers: number, blocked: boolean): void {
    view.label.removeChildren().forEach(c => c.destroy({ children: true }));
    view.bar = null;
    const icon = blocked ? 'lock' : r.started ? (workers > 0 ? 'pick' : 'worker') : r.kind === 'wreck' ? 'workshop' : 'broom';
    const ring = new Graphics();
    const color = blocked ? 0x8aa0b8 : r.started && workers === 0 ? statusTint('bad') : statusTint('warn');
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

  /**
   * Dust cloud when a ruin is cleared. [plan4:GP-2] `count` < 26 is a small burst for the ceremonies.
   * [plan4 perf] The plain motes go into the layer first and the additive ones after them: a blend change breaks the batch, so the old
   * alternation (every third one additive) cost a draw call per mote, this costs two.
   */
  burstAt(x: number, y: number, width: number, count = 26): void {
    const small = count < 26;
    const isGlow = (i: number): boolean => (small ? i >= Math.ceil((count * 2) / 3) : i % 3 === 0);
    for (const glow of [false, true]) {
      for (let i = 0; i < count; i++) {
        if (isGlow(i) !== glow) continue;
        const s = new Sprite(moteTexture());
        s.anchor.set(0.5);
        s.tint = glow ? 0xffd27a : 0xc9bda6;
        s.scale.set(0.6 + Math.random() * 1.1);
        s.position.set(x + (Math.random() - 0.5) * width * 0.8, y + (Math.random() - 0.5) * 20);
        if (glow) s.blendMode = 'add';
        this.fxLayer.addChild(s);
        this.bursts.push({ s, vx: (Math.random() - 0.5) * 60, vy: -10 - Math.random() * 40, life: 0, max: 1 + Math.random() * 1.2 });
      }
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

  /**
   * [plan4:GP-6] Tour stops that only the scene knows: the world position of someone chatting with a neighbour right now (null when nobody is;
   * `pick` rotates which one), and of the lift car (null when the shaft has no car API, i.e. the flat fallback shaft).
   */
  talkingSpot(pick = 0): { x: number; y: number } | null {
    const found: { x: number; y: number }[] = [];
    for (const p of this.people.values()) {
      if (!p.container.parent || !p.container.visible || !p.isTalking(this.time)) continue;
      const w = this.worldContainer.toLocal(p.container.getGlobalPosition());
      found.push({ x: w.x, y: w.y - 24 });
    }
    return found.length ? found[pick % found.length] : null;
  }

  liftSpot(): { x: number; y: number } | null {
    const lift = (this.shaft as Partial<ShaftAnimated> | null)?.lift;
    return lift ? { x: SHAFT_W / 2, y: lift.carY() } : null;
  }

  /** Centers the camera on a world point and zooms in a little. */
  focusOn(x: number, y: number, zoomBoost = 1.5): void {
    this.cam.focusOn(x, y, zoomBoost);
  }

  /** [camera] Keeps the incident rectangles for the popup blocker (no allocation once warmed up). */
  private updateBlockers(state: GameState): void {
    let n = 0;
    for (const inc of state.incidents ?? []) {
      const v = this.views.get(inc.buildingId);
      if (!v) continue;
      const r = this.blockRects[n] ?? (this.blockRects[n] = { x: 0, y: 0, w: 0, h: 0 });
      if (inc.kind === 'blackout') {
        const fx = floorExtent(state, floorIndexAt(v.root.y)); // [plan4:ST-4] the whole floor, wings included
        r.x = slotX(-fx.w); r.y = v.root.y; r.w = (fx.w + fx.e) * SLOT_W; r.h = v.height;
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
