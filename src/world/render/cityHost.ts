/**
 * CityHost: the glue between BunkerRenderer and CityRenderer behind `?city` (C-render-notes.md section 4 and Phase 2). BunkerRenderer
 * keeps its camera, its play-plane holders and `app.render()`; this class
 *  - mounts the city's layer stack around the host's holders (architecture section 5);
 *  - asks the layout provider (citySeams.ts) for the layout when its signature changes, and mounts the shell through the shell seam;
 *  - feeds the lightmap the rooms (readability floors per state and the painted lamps from `ArtLibrary.lightsFor`), the walkway
 *    strips, the selection, the era and the night;
 *  - runs the city's per-frame update (parallax, culling, fog, the light texture) right before the picture is drawn;
 *  - binds the city tier to the game's quality level (PostFX `quality`, which follows QUALITY_PROFILE and the player's pick), with
 *    'lite' (no lightmap, flat tint) in lite mode;
 *  - wraps `renderer.extract` so a snapshot (the share picture, dev shots) samples the light texture in the fallback 'area' UV mode.
 * Nothing here runs in classic mode: BunkerRenderer only creates it when `CITY` is set.
 */
import { Container, type Renderer } from 'pixi.js';
import type { BuildingInstance, GameState } from '../../core/GameState';
import { effectiveLevel, isDistrict } from '../../data/buildingDefs';
import { ArtLibrary } from '../../art/ArtLibrary';
import { artEntry, buildingArtKey, roomTier } from '../../art/registry';
import { FLOOR_H, ROOM_H, SLOT_W, extentsFor, floorTop } from '../../rendering/geom';
import { buildingRect, slotX, stripX } from '../project';
import { stratumOf } from '../../data/strata';
import { LIGHT } from '../tokens';
import { CityRenderer, parallaxFromWorld, type ParallaxInfo, type RenderTier } from './CityRenderer';
import { cityLayoutProvider, shellMounter, type MountedShell } from './citySeams';
import type { FloorRect, RoomLightInput } from './lighting';
import type { CityLayout } from './layoutTypes';

/** The host's layers, by where they go in the city's stack. */
export interface CityHostLayers {
  /** Above the far and back planes, outside the lit group (never darkened): the surface and the project sites. */
  surface: Container[];
  /** Inside the lit group, in this order: rock, bays, rooms, shaft, utilities, walkers. The shell's front goes after the shaft. */
  play: Container[];
  /** The holder after which the shell's front is placed (the shaft). */
  shaft: Container;
  /** Right above the lit group (never darkened): the empty-slot pads and the placement highlight. */
  overLit: Container[];
  /** Between the glow and the fog: dust, effects, incidents, the dig / district / wing signs (tap targets). */
  overGlow: Container[];
  /** Last, above the fore plane: labels, badges, the ghost. */
  top: Container[];
}

/** What the host needs to know of a room view to build its light (the rendered rect and how many people stand in it). */
export interface RoomProbe {
  rect(id: string): { x: number; y: number; w: number; h: number } | null;
  people(id: string): number;
  mirrored(b: BuildingInstance): boolean;
}

const ROOM_SYNC_S = 0.25;

export class CityHost {
  readonly city: CityRenderer;
  /** The shell's front holder (balconies, stairs, rails, edge rubble), inside the lit group after the shaft. */
  readonly shellFront = new Container();
  private layout: CityLayout | null = null;
  private layoutSig = '';
  private shell: MountedShell | null = null;
  private shellSig = '';
  private roomSig = '';
  private roomAt = -1;
  private selected: string | null = null;
  private eraNow = NaN;
  private nightNow = NaN;
  private readonly pi: ParallaxInfo = { cx: 0, cy: 0, z: 1, ox: 0, oy: 0, sw: 1, sh: 1 };
  private rooms: RoomLightInput[] = [];
  private extra: FloorRect[] = [];
  private t = 0;
  private snapDepth = 0;

  constructor(renderer: Renderer, tier: RenderTier, canvas: HTMLCanvasElement) {
    this.city = new CityRenderer({ renderer, tier, canvas });
    this.shellFront.label = 'shellFront';
    this.shellFront.eventMode = 'none';
    this.wrapExtract(renderer);
  }

  /** Builds worldContainer's stack (it must be empty): far, back, surface, litGroup{mid, play}, overLit, glow, overGlow, fog, tease, fore, top. */
  mount(world: Container, L: CityHostLayers): void {
    const c = this.city;
    c.mount(world);
    world.removeChildren();
    for (const h of L.play) {
      c.playLayer.addChild(h);
      if (h === L.shaft) c.playLayer.addChild(this.shellFront);
    }
    world.addChild(c.planes.far.container, c.planes.back.container, ...L.surface, c.litGroup, ...L.overLit, c.glowLayer, ...L.overGlow,
      c.fogLayer, c.teaseLayer, c.planes.fore.container, ...L.top);
  }

  /** The current layout (null until the first sync). */
  get current(): CityLayout | null {
    return this.layout;
  }

  /**
   * The layout follows the provider's signature. Returns true when the shell must be (re)built by the host: a new layout, a new era or a
   * new kit state (`extraSig`); the host then calls `mountShell` (or falls back to the classic underground when no mounter is set).
   */
  syncLayout(state: GameState, extraSig: string): boolean {
    const p = cityLayoutProvider();
    const sig = p.sig(state);
    if (sig !== this.layoutSig || !this.layout) {
      this.layoutSig = sig;
      this.layout = p.build(state);
      this.city.setLayout(this.layout);
      this.roomSig = '';
    }
    const ss = `${this.layout.sig}|${extraSig}|${!!shellMounter()}`;
    if (ss === this.shellSig) return false;
    this.shellSig = ss;
    return true;
  }

  /** Mounts the level-builder's shell into `back` (the host's rock holder) and the shell front. False when no mounter is set. */
  mountShell(state: GameState, back: Container, era: number): boolean {
    this.shell?.destroy();
    this.shell = null;
    this.shellFront.removeChildren().forEach(ch => ch.destroy({ children: true }));
    const m = shellMounter();
    if (!m || !this.layout) return false;
    this.shell = m({
      state, layout: this.layout, back, front: this.shellFront, era, tier: this.city.quality,
      addLight: l => this.city.addLight(l), removeLight: id => this.city.removeLight(id),
    });
    return true;
  }

  /** Forget everything that was built from the scene (after a context restore or a scene reset): rebuilt on the next frame. */
  invalidate(): void {
    this.roomSig = '';
    this.shellSig = '';
  }

  // ------------------------------------------------------------------ rooms

  private roomState(state: GameState, b: BuildingInstance, probe: RoomProbe, darkFloors: ReadonlySet<number>): RoomLightInput['state'] {
    if (b.isConstructing) return 'building';
    if ((state.powerRatio ?? 1) < 0.05 || darkFloors.has(b.position.floor)) return 'unpowered';
    return probe.people(b.id) > 0 ? 'working' : 'idle';
  }

  /**
   * Room lights: one feathered readability floor per room at its state's value (worked / empty / building / blackout / ruin) and its
   * painted lamps; walkway strips in front of every dug floor. Rebuilt when the cheap signature changes (checked 4x a second).
   */
  syncRooms(state: GameState, probe: RoomProbe, t: number, layoutHash: number): void {
    if (this.roomSig && t - this.roomAt < ROOM_SYNC_S) return;
    this.roomAt = t;
    const dark = new Set<number>();
    for (const inc of state.incidents ?? []) {
      if (inc.kind !== 'blackout') continue;
      const b = state.buildings.find(x => x.id === inc.buildingId);
      if (b) dark.add(b.position.floor);
    }
    let sig = `${layoutHash}|${state.currentFloors}|${[...dark].join(',')}|${(state.powerRatio ?? 1) < 0.05}|`;
    for (const b of state.buildings) sig += this.roomState(state, b, probe, dark)[0];
    for (const r of state.ruins) sig += r.started ? 'R' : 'r';
    if (sig === this.roomSig) return;
    this.roomSig = sig;
    const rooms = this.rooms;
    rooms.length = 0;
    for (const b of state.buildings) {
      const r = probe.rect(b.id) ?? buildingRect(b);
      const st = this.roomState(state, b, probe, dark);
      const fresh = b.isConstructing && b.level === 1;
      const key = fresh || isDistrict(b.type) ? null : buildingArtKey(b.type, roomTier(effectiveLevel(b)));
      const entry = key ? artEntry(key) : null;
      let lamps: RoomLightInput['lamps'];
      if (entry) {
        const mirror = probe.mirrored(b);
        lamps = ArtLibrary.lightsFor(entry).map(l => ({ x: mirror ? 1 - l.x : l.x, y: l.y, r: l.r, color: l.color, flicker: l.flicker }));
      }
      const area = isDistrict(b.type) ? `d:${b.type}` : `f:${b.position.floor}`;
      rooms.push({ id: b.id, x: r.x, y: r.y, w: r.w, h: r.h, state: st, lamps, area });
    }
    for (const r of state.ruins) {
      rooms.push({ id: r.id, x: slotX(r.floor, r.x), y: floorTop(r.floor), w: r.w * SLOT_W, h: ROOM_H, state: 'ruin', area: `f:${r.floor}` });
    }
    const extra = this.extra;
    extra.length = 0;
    const exts = extentsFor(state, state.currentFloors);
    for (let f = 0; f < state.currentFloors; f++) {
      const sx = stripX(f, exts[f] ?? { w: 0, e: 12 });
      const hubL = Math.min(sx.x0, this.layout?.frames[stratumOf(f)]?.hubL ?? sx.x0);
      const y = floorTop(f) + ROOM_H;
      extra.push({ x: hubL, y, w: sx.x1 - hubL, h: FLOOR_H - ROOM_H, value: LIGHT.read.walkway });
    }
    this.city.setRooms(rooms, extra);
    this.city.selectRoom(this.selected);
  }

  select(id: string | null): void {
    if (id === this.selected) return;
    this.selected = id;
    this.city.selectRoom(id);
  }

  // ------------------------------------------------------------------ per frame

  /**
   * The camera for the parallax planes, derived from worldContainer (zoom, offset; the world point at the screen centre). The camera
   * agent's official `CameraController.parallaxInfo()` replaces this at merge; the values are the same (shake and punch included).
   */
  parallaxInfo(wc: Container, sw: number, sh: number): ParallaxInfo {
    return parallaxFromWorld(this.pi, wc, sw, sh);
  }

  /** Call right before `app.render()`, after every camera and position write of the picture. */
  frame(wc: Container, sw: number, sh: number, t: number, dt: number, tier: RenderTier, mapCovers: boolean, era: number, night: number): void {
    this.t = t;
    const c = this.city;
    c.setTier(tier);
    const e = Math.max(0, era), n = Math.round(night * 50) / 50;
    if (e !== this.eraNow || n !== this.nightNow) {
      this.eraNow = e;
      this.nightNow = n;
      c.setEra(e, n);
    }
    this.shell?.update?.(t, dt);
    c.update(this.parallaxInfo(wc, sw, sh), t, dt, { mapCovers });
  }

  /** Light (0..~2) at a world point from the pools drawn this frame (people's self-light, life-systems' hook). */
  lightAt(x: number, y: number): number {
    return this.city.lighting.lightAt(x, y);
  }

  /** After a lost and restored GL context (the city also listens itself; this re-syncs what the host fed it). */
  onContextRestored(): void {
    this.city.onContextRestored();
    this.invalidate();
  }

  private wrapExtract(renderer: Renderer): void {
    const ex = renderer.extract as unknown as Record<string, (...a: unknown[]) => unknown>;
    // (base64 / image go through canvas; the depth counter keeps a nested call from restoring the mode early.)
    for (const k of ['canvas', 'texture', 'pixels']) {
      const orig = ex[k];
      if (typeof orig !== 'function') continue;
      ex[k] = (...a: unknown[]): unknown => {
        if (this.snapDepth++ === 0) this.city.beginSnapshot(this.t);
        try {
          return orig.apply(ex, a);
        } finally {
          if (--this.snapDepth === 0) this.city.endSnapshot();
        }
      };
    }
  }

  destroy(): void {
    this.shell?.destroy();
    this.city.destroy();
  }
}
