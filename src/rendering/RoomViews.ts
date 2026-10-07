import { Container, Graphics, TextStyle } from 'pixi.js';
import type { BuildingInstance, GameState } from '../core/GameState';
import { effectiveLevel, getDef, roomSlots } from '../data/buildingDefs';
import { specOf } from '../data/specializations';
import { i18n } from '../i18n/I18nManager';
import { ArtLibrary } from '../art/ArtLibrary';
import { artEntry, buildingArtKey, roomTier } from '../art/registry';
import { BUILDING_W, DEPTH_X, FLOOR_H, ROOM_H, SLAB, SLOT_W, buildingH, buildingX, floorTop } from './layout';
import { hashString, seeded } from './draw';
import { buildConstructionVisual, buildPaintedConstruction, buildRoomVisual, buildScaffold, type RoomVisual } from './roomArt';
import { buildPaintedRoom } from './paintedRoom';
import type { Lane } from './people';
import { LAYOUT, VIEW } from './perfFx';
import { lineWidth, richLine } from './richText';
import { steelTag, tagLamp } from './signage';
import { depthGains } from './structure';
import type { RuinVisual } from './ruinArt';
import { labelState } from './LabelScale'; // [plan4:ST-12]

// [plan4 X-1] Split out of BunkerRenderer.ts with no change in behaviour: the room views (build queue, look rebuilds, name tags),
// the "in zone" / parking logic and the per-picture culling of rooms, ruins and the structure.

/** [perf] A room out of the camera's reach for this long gives its look back (see render). */
const PARK_AFTER_MS = 8000;

export interface RoomView {
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
  /** [plan4:ST-12] The tag's two looks: name + stars + lamps (full), colour chip + lamps (icon-only); LabelScale picks one by zoom. */
  labelFull?: Container;
  labelMini?: Container;
  progress: Graphics | null;
  visualSig: string;
  labelSig: string;
  lane: Lane;
  width: number;
  height: number;
  /** Off screen this frame: not drawn and not animated. */
  culled?: boolean;
  /** [perf] Stamp of the last picture in which the room was still in the state (see render). */
  gen?: number;
  /** [perf] The root is in the scene (rooms out of view are taken out of it, see cull). */
  attached?: boolean;
  /** [perf] The label wants to be shown (before the off-screen test in cull). */
  labelOn?: boolean;
  /** [perf] The layout hash the look was last built for; when the room left the camera's reach (performance.now), or 0. */
  layoutH?: number;
  outSince?: number;
  /** [perf] Since when the room has been waiting for its painting (performance.now). */
  waitSince?: number;
  /** [perf] What the label was last drawn from: level, staff, constructing (packed), specialization, language. */
  lk?: number;
  lspec?: string | null;
  lloc?: string;
}

export interface RuinView {
  root: Container;
  visual: RuinVisual | null;
  people: Container;
  label: Container;
  visualSig: string;
  labelSig: string;
  lane: Lane;
  width: number;
  bar: Graphics | null;
  /** [perf] Off screen this frame. */
  culled?: boolean;
  /** [perf] The root is in the scene (rooms out of view are taken out of it, see cull). */
  attached?: boolean;
}

/** What the room views need from the renderer. */
export interface RoomsHost {
  /** Graphics overhaul switch (the painted look). */
  readonly gfx2: boolean;
  selectedId(): string | null;
  /** The camera is dragging: a tap that ends a drag is not a tap on a room. */
  isDragging(): boolean;
  onBuildingClick(buildingId: string): void;
  /** Right edge of the project lots on the surface. */
  projectRight(): number;
  /** Reports how far east the rooms reach (the camera's bounds). */
  setExtentR(x: number): void;
  burstAt(x: number, y: number, width: number): void;
  onScreen(x: number, y: number): boolean;
  punch(strength: number): void;
  /** The opaque far-zoom city map covers the scene. */
  mapCovers(): boolean;
}

const nameStyle = new TextStyle({ fontFamily: 'Rubik, sans-serif', fontSize: 10, fontWeight: '600', fill: 0xffffff });

export class RoomViews {
  /** [perf] Hash of the layout last drawn, and a per-picture stamp that marks the rooms still in the state (replaces a Set built every picture). */
  private roomsH = -1;
  private roomGen = 0;
  private buildsLeft = 0;
  private nextRoomZ = 0;
  /**
   * [P6] With up to 24 floors most of the structure is off screen: every part of the rock, casing and the empty-slot tiles
   * gets its vertical extent measured once, and cull() hides what the camera cannot see.
   */
  private structureCull: { obj: Container; y0: number; y1: number }[] = [];

  private readonly host: RoomsHost;
  readonly views: Map<string, RoomView>;
  private readonly ruinViews: Map<string, RuinView>;
  private readonly roomLayer: Container;
  private readonly labelLayer: Container;

  constructor(host: RoomsHost, views: Map<string, RoomView>, ruinViews: Map<string, RuinView>, roomLayer: Container, labelLayer: Container) {
    this.host = host;
    this.views = views;
    this.ruinViews = ruinViews;
    this.roomLayer = roomLayer;
    this.labelLayer = labelLayer;
  }

  render(state: GameState): void {
    const host = this.host;
    const roomsChanged = LAYOUT.rooms !== this.roomsH; // [perf]
    this.roomsH = LAYOUT.rooms;
    const gen = ++this.roomGen;
    const now = performance.now();
    this.buildsLeft = 3; // looks built per picture for rooms nobody is looking at yet (the ones about to scroll in)
    for (const b of state.buildings) {
      const def = getDef(b.type);
      if (!def) continue;
      let view = this.views.get(b.id);
      if (!view) {
        view = this.createView(b);
        this.views.set(b.id, view);
        this.roomLayer.addChild(view.root);
        this.labelLayer.addChild(view.label);
      }
      view.gen = gen;
      const isNew = b.isConstructing && b.level === 1;
      // [perf] What a room's look depends on (type, place, level, who is next to it) is one number for the whole bunker (hashLayout):
      // the neighbour search and the signature string run only when it changed, or when the room has no look yet / a painting arrived.
      // Rooms far from the camera (more than a screen away) are not built, and one that has been far away for a while gives its look back
      // (objects and, once nothing uses it, its painting): at 24 floors a close view needs a fraction of the rooms and paintings.
      const zone = this.inZone(view);
      if (zone) view.outSince = 0;
      else if (!view.outSince) view.outSince = now;
      else if (view.visual && !view.oldVisual && now - view.outSince > PARK_AFTER_MS) {
        view.visual.container.destroy({ children: true });
        view.visual = null;
        view.visualSig = '';
        view.layoutH = undefined;
      }
      if (zone && (view.layoutH !== LAYOUT.rooms || !view.visualSig) && (view.culled === false || view.culled === undefined || this.buildsLeft > 0)) {
      const openL = this.isOpenTo(state, b, -1);
      const openR = this.isOpenTo(state, b, 1);
      // The look follows the finished level, so an upgrade reveals the new painting when it completes.
      const artKey = isNew ? buildingArtKey(b.type, 0) : buildingArtKey(b.type, roomTier(effectiveLevel(b)));
      const texture = artKey ? ArtLibrary.get(artKey) : null;
      // A painting on its way (it was released, or is new): keep what the room shows instead of drawing a stand-in; a room that has
      // shown nothing yet gets the drawn stand-in after 0.7 s (a slow connection must not leave a new room empty).
      const waiting = !!artKey && !texture && !ArtLibrary.hasFailed(artKey) && !(!view.visual && view.waitSince !== undefined && now - view.waitSince > 700);
      if (waiting) {
        if (view.waitSince === undefined) view.waitSince = now;
        view.layoutH = undefined;
      } else {
      view.waitSince = undefined;
      view.layoutH = LAYOUT.rooms;
      if (view.culled) this.buildsLeft--;
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
            ? buildPaintedRoom(texture, artEntry(artKey)!, view.width, openL, openR, mirror, rnd, view.height, host.gfx2 ? this.roomGains(b, artKey) : undefined, b.id /* G4 lighting: shared flicker key */)
            : buildRoomVisual(b.type, view.width, openL, openR, rnd);
        view.visualHolder.removeChildren();
        view.visualHolder.addChild(view.visual.container);
        if (view.oldVisual) {
          view.visualHolder.addChild(view.oldVisual);
          host.burstAt(view.root.x + view.width / 2, view.root.y + view.height * 0.55, view.width);
          if (host.onScreen(view.root.x + view.width / 2, view.root.y + view.height / 2)) host.punch(finishedBuild ? 1 : 0.7); // [camera]
        }
      }
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
      // [perf] The label's inputs packed into a number (no string per room per picture).
      const lk = (b.level * 64 + b.assignedSurvivorIds.length) * 2 + (b.isConstructing ? 1 : 0);
      const spec = b.specialization ?? null;
      if (view.lk !== lk || view.lspec !== spec || view.lloc !== i18n.currentLocale) {
        view.lk = lk;
        view.lspec = spec;
        view.lloc = i18n.currentLocale;
        view.labelSig = 'drawn';
        this.drawLabel(view, b);
      }
      // New look: a room keeps its sign to itself unless it needs you (no workers, building) or is selected.
      if (host.gfx2) {
        const staffed = (def.maxWorkers ?? 0) === 0 || b.assignedSurvivorIds.length > 0;
        view.labelOn = b.id === host.selectedId() || b.isConstructing || !staffed;
      } else view.labelOn = true;
      if (view.progress) {
        const pct = b.constructionProgress / b.constructionTotal;
        view.progress.clear();
        view.progress.roundRect(0, 0, view.width - 30, 5, 2.5).fill({ color: 0x000000, alpha: 0.7 });
        view.progress.roundRect(0, 0, Math.max(3, (view.width - 30) * pct), 5, 2.5).fill(0xffb547);
      }
    }
    let right = Math.max(BUILDING_W, host.projectRight());
    for (const v of this.views.values()) right = Math.max(right, v.root.x + v.width);
    host.setExtentR(right);
    if (this.views.size > state.buildings.length || roomsChanged) {
      for (const [id, view] of this.views) {
        if (view.gen === gen) continue;
        for (const child of [...view.people.children]) view.people.removeChild(child);
        view.root.destroy({ children: true });
        view.label.destroy({ children: true });
        this.views.delete(id);
      }
    }
  }

  /** [perf] Is the room within a screen's reach of the camera (the window in which rooms are built and kept)? */
  private inZone(v: RoomView): boolean {
    const w = VIEW.x1 - VIEW.x0, h = VIEW.y1 - VIEW.y0;
    const r = v.root;
    return r.x < VIEW.x1 + w * 0.75 && r.x + v.width > VIEW.x0 - w * 0.75 && r.y < VIEW.y1 + h && r.y + v.height > VIEW.y0 - h;
  }

  private createView(b: BuildingInstance): RoomView {
    const host = this.host;
    const width = roomSlots(b.type) * SLOT_W;
    const height = buildingH(b.type);
    const root = new Container();
    root.label = 'room';
    root.isRenderGroup = true; // [perf] a room is its own render group: its particles never rebuild the rest
    root.zIndex = this.nextRoomZ++; // draw order stays the order of creation when rooms are taken out of the scene and put back
    root.position.set(buildingX(b), floorTop(b.position.floor));
    const visualHolder = new Container();
    const people = new Container();
    people.sortableChildren = true;
    // In a two-storey hall people walk on the lower level's floor.
    people.y = height - ROOM_H;
    const outline = new Graphics();
    outline.rect(1, 1, width - 2, height - 2).stroke({ color: 0xffd47a, width: 2.5, alpha: 0.95 });
    outline.visible = b.id === host.selectedId();
    root.addChild(visualHolder, people, outline);
    root.hitArea = { contains: (x: number, y: number) => x >= 0 && x <= width && y >= 0 && y <= height };
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.on('pointertap', () => {
      if (!host.isDragging()) host.onBuildingClick(b.id);
    });
    const label = new Container();
    label.position.set(buildingX(b) + width / 2, floorTop(b.position.floor) - SLAB / 2);
    return {
      root, visualHolder, visual: null, oldVisual: null, fade: 0, scaffold: null, people, outline, label, progress: null,
      visualSig: '', labelSig: '', width, height, attached: true,
      lane: { x0: DEPTH_X + 10, x1: width - DEPTH_X - 10 },
    };
  }

  private drawLabel(view: RoomView, b: BuildingInstance): void {
    const def = getDef(b.type)!;
    const gfx2 = this.host.gfx2;
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
    if (gfx2) {
      // [gfx2 signage] A screwed-on steel tag with a soft drop shadow (signage.ts).
      steelTag(bg, -width / 2, -7.5, width, 15);
    } else {
      bg.roundRect(-width / 2, -7.5, width, 15, 4).fill({ color: 0x14141e, alpha: 0.9 });
      bg.roundRect(-width / 2, -7.5, width, 15, 4).stroke({ color: 0xd9a441, alpha: 0.5, width: 1 });
    }
    text.x = -pipsW / 2;
    const full = new Container();
    full.addChild(bg, text);
    if (pipCount > 0) {
      const pips = new Graphics();
      const startX = text.x + textW / 2 + 8;
      for (let i = 0; i < pipCount; i++) {
        const filled = i < b.assignedSurvivorIds.length;
        // [gfx2 signage] Worker pips as small indicator lamps.
        if (gfx2) { tagLamp(pips, startX + i * 7, 0, filled); continue; }
        pips.circle(startX + i * 7, 0, 2.4).fill(filled ? 0x4dff8f : 0x3a3a4a);
        if (!filled) pips.circle(startX + i * 7, 0, 2.4).stroke({ color: 0xff6b6b, width: 0.8 });
      }
      full.addChild(pips);
    }
    // [plan4:ST-12] Icon-only look for a far camera: the room's colour chip and the worker lamps, no text.
    const mini = new Container();
    const miniW = 18 + pipsW;
    const mbg = new Graphics();
    if (gfx2) steelTag(mbg, -miniW / 2, -7.5, miniW, 15);
    else {
      mbg.roundRect(-miniW / 2, -7.5, miniW, 15, 4).fill({ color: 0x14141e, alpha: 0.9 });
      mbg.roundRect(-miniW / 2, -7.5, miniW, 15, 4).stroke({ color: 0xd9a441, alpha: 0.5, width: 1 });
    }
    const chip = new Graphics();
    chip.roundRect(-miniW / 2 + 3.5, -4.5, 9, 9, 2.5).fill(def.color).stroke({ color: 0x000000, alpha: 0.55, width: 1 });
    mini.addChild(mbg, chip);
    if (pipCount > 0) {
      const mp = new Graphics();
      const x0 = -miniW / 2 + 18;
      for (let i = 0; i < pipCount; i++) {
        const filled = i < b.assignedSurvivorIds.length;
        if (gfx2) { tagLamp(mp, x0 + i * 7, 0, filled); continue; }
        mp.circle(x0 + i * 7, 0, 2.4).fill(filled ? 0x4dff8f : 0x3a3a4a);
        if (!filled) mp.circle(x0 + i * 7, 0, 2.4).stroke({ color: 0xff6b6b, width: 0.8 });
      }
      mini.addChild(mp);
    }
    view.label.addChild(full, mini);
    view.labelFull = full;
    view.labelMini = mini;
    this.styleLabel(view);
    if (b.isConstructing) {
      view.progress = new Graphics();
      view.progress.position.set(15, view.height - 14);
      view.root.addChild(view.progress);
    }
  }

  /** [plan4:ST-12] Puts the shared screen-space size and look (LabelScale) on one tag. */
  private styleLabel(v: RoomView): void {
    v.label.scale.set(labelState.k);
    const icon = labelState.mode !== 'full';
    if (v.labelFull) v.labelFull.visible = !icon;
    if (v.labelMini) v.labelMini.visible = icon;
  }

  /** [plan4:ST-12] The zoom changed (LabelScale, at most 10 Hz): every tag follows. */
  applyLabelScale(): void {
    for (const v of this.views.values()) this.styleLabel(v);
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

  isOpenTo(state: GameState, b: BuildingInstance, side: -1 | 1): boolean {
    if (b.isConstructing && b.level === 1) return false;
    const w = roomSlots(b.type);
    return state.buildings.some(o => o.id !== b.id && o.type === b.type && o.level === b.level
      && o.position.floor === b.position.floor && !(o.isConstructing && o.level === 1)
      && (side === 1 ? o.position.x === b.position.x + w : o.position.x + roomSlots(o.type) === b.position.x));
  }

  /** Position of a room inside its compound run (0 = leftmost); odd ones are mirrored for variety. */
  compoundIndex(state: GameState, b: BuildingInstance): number {
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

  /** Measures the vertical extent of each part of the underground structure (rock, casing, slot tiles) for cull(). */
  collectStructureCullables(undergroundHolder: Container): void {
    const out: { obj: Container; y0: number; y1: number }[] = [];
    const addChildren = (root: Container | undefined) => {
      if (!root) return;
      for (const c of root.children) {
        const b = c.getLocalBounds();
        if (!isFinite(b.minY) || !isFinite(b.maxY) || b.maxY - b.minY > 3 * FLOOR_H) continue; // tall pieces stay
        out.push({ obj: c, y0: root.y + c.y + b.minY, y1: root.y + c.y + b.maxY });
      }
    };
    addChildren(undergroundHolder.children[0] as Container | undefined);
    this.structureCull = out;
  }

  /**
   * Rooms wholly off screen are neither drawn nor animated: zoomed in, most of the bunker is out of view, and every
   * hidden room used to cost as much CPU and GPU as a visible one (heat, battery).
   */
  cull(): void {
    const { x0, y0, x1, y1 } = VIEW;
    const mapCovers = this.host.mapCovers();
    for (const v of this.views.values()) {
      const r = v.root;
      const seen = r.x < x1 && r.x + v.width > x0 && r.y < y1 && r.y + v.height > y0;
      // [perf] Under the opaque far-zoom city map nothing of the rooms is seen either: no animation, no people updates.
      v.culled = !seen || mapCovers;
      if (seen !== v.attached) { v.attached = seen; if (seen) this.roomLayer.addChild(r); else this.roomLayer.removeChild(r); } // [perf] a room out of view is not in the scene at all (155 render groups were walked every picture)
      const shown = seen && !mapCovers;
      if (v.visualHolder.visible !== shown) { v.visualHolder.visible = shown; v.people.visible = shown; }
      // The name tag goes with its room (it used to be drawn for all 119 rooms: 43% of the draw calls).
      const lv = !!v.labelOn && seen && labelState.mode !== 'hidden';
      if (v.label.visible !== lv) v.label.visible = lv;
    }
    for (const v of this.ruinViews.values()) {
      const r = v.root;
      const seen = r.x < x1 && r.x + v.width > x0 && r.y < y1 && r.y + ROOM_H > y0;
      v.culled = !seen || mapCovers;
      if (seen !== v.attached) { v.attached = seen; if (seen) this.roomLayer.addChild(r); else this.roomLayer.removeChild(r); }
      if (v.label.visible !== seen) v.label.visible = seen;
    }
    // [P6] The structure, by height only (it spans the whole width anyway).
    for (const c of this.structureCull) {
      const seen = c.y1 > y0 && c.y0 < y1;
      if (c.obj.visible !== seen) c.obj.visible = seen;
    }
  }
}
