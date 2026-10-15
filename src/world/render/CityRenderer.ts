/**
 * CityRenderer: the render side of "The City Below" (architecture section 5). It owns the parallax planes, the lit group with its
 * LightmapFilter, the glow layer, the fog and the tease layer, and drives them from a CityLayout and the camera. The host
 * (BunkerRenderer behind `?city`, or tools/world/render-lab.ts) owns the camera, the play-plane content and `app.render()`.
 *
 * Stack inside worldContainer after `mount()` (back to front; the host slots its own layers in between, see C-render-notes.md):
 *   far plane, back plane, [host: surface, project sites], litGroup { mid plane, playLayer { host: rock, rooms, structure, people } },
 *   [host: slots, highlight], glowLayer, [host: dust, fx, dig/district/wing signs], fogLayer, teaseLayer, fore plane, [host: map, labels].
 *
 * Per frame the host calls `update(cam, t, dt)` BEFORE `app.render()`: it positions the planes, builds backdrop chunks, culls and
 * flickers the lights, redraws the fog when it changed, re-bakes cached planes when needed, and renders the light texture.
 * When the far map covers the scene (`mapCovers`), the light texture, the fog and the glow are skipped and the filter is disabled.
 */
import { Container, Rectangle, type Renderer } from 'pixi.js';
import { CAMERA, FOG } from '../tokens';
import { LIGHTMAP_RENDER, LIGHTMAP_UV_DEFAULT, TIER_RENDER, type LightmapUvMode, type RenderTier } from '../tokensRender';
import { Backdrop } from './backdrop';
import { FogLayer } from './fog';
import { ParallaxPlane, type ParallaxInfo } from './layers';
import { Lighting, type FloorRect, type LightInput, type LightView, type RoomLightInput } from './lighting';
import type { AreaState, CityArea, CityLayout, Rect } from './layoutTypes';

export type { ParallaxInfo, LightInput, RoomLightInput, FloorRect, RenderTier, LightmapUvMode };

export interface CityRendererOptions {
  renderer: Renderer;
  tier: RenderTier;
  /** The canvas, to rebuild render textures after a lost GL context (the host may call `onContextRestored()` itself instead). */
  canvas?: HTMLCanvasElement;
  uvMode?: LightmapUvMode;
}

export interface CityFrameOptions {
  /** The far city map covers the scene (zoom below CAMERA.zoom.far): no lightmap, fog or glow work. */
  mapCovers?: boolean;
}

/** The camera as the city needs it, from worldContainer's transform (anchor = the screen point the camera centre sits on). */
export function parallaxFromWorld(out: ParallaxInfo, wc: Container, sw: number, sh: number, anchorX = sw / 2, anchorY = sh / 2): ParallaxInfo {
  const z = wc.scale.x;
  out.z = z;
  out.ox = wc.x;
  out.oy = wc.y;
  out.cx = (anchorX - wc.x) / z;
  out.cy = (anchorY - wc.y) / z;
  out.sw = sw;
  out.sh = sh;
  return out;
}

export class CityRenderer {
  readonly planes: { far: ParallaxPlane; back: ParallaxPlane; mid: ParallaxPlane; fore: ParallaxPlane };
  /** Mid plane + play plane: everything the lightmap multiplies. */
  readonly litGroup = new Container();
  /** Inside litGroup, after the mid plane: the host's play-plane holders go here. */
  readonly playLayer = new Container();
  readonly lighting: Lighting;
  readonly fog: FogLayer;
  readonly backdrop: Backdrop;
  private renderer: Renderer;
  private tier: RenderTier;
  private uvMode: LightmapUvMode;
  private layout: CityLayout | null = null;
  private view: LightView = { x0: 0, y0: 0, x1: 0, y1: 0, cx: 0, cy: 0, zoom: 1, ox: 0, oy: 0, sw: 1, sh: 1, res: 1 };
  private area = new Rectangle();
  private mapCovers = false;
  private filterOn = true;
  private tintNow = -1;
  private onRestored = (): void => this.onContextRestored();
  private canvas: HTMLCanvasElement | null;
  /** Lab/debug switches. */
  lightmapEnabled = true;
  fogEnabled = true;
  readonly stats = { frame: 0, updateMs: 0, lightPasses: 0, bakes: 0 };

  constructor(opts: CityRendererOptions) {
    this.renderer = opts.renderer;
    this.tier = opts.tier;
    this.uvMode = opts.uvMode ?? LIGHTMAP_UV_DEFAULT;
    this.planes = { far: new ParallaxPlane('far'), back: new ParallaxPlane('back'), mid: new ParallaxPlane('mid'), fore: new ParallaxPlane('fore') };
    this.lighting = new Lighting(this.tier);
    this.fog = new FogLayer(this.tier);
    this.backdrop = new Backdrop(this.planes, this.tier);
    this.litGroup.label = 'city:lit';
    this.playLayer.label = 'city:play';
    this.litGroup.addChild(this.planes.mid.container, this.playLayer);
    this.lighting.glowLayer.label = 'city:glow';
    this.fog.layer.label = 'city:fog';
    this.lighting.teaseLayer.label = 'city:tease';
    this.lighting.filter.mode = this.uvMode;
    this.canvas = opts.canvas ?? null;
    this.canvas?.addEventListener('webglcontextrestored', this.onRestored);
    this.applyTier();
  }

  get glowLayer(): Container {
    return this.lighting.glowLayer;
  }

  get fogLayer(): Container {
    return this.fog.layer;
  }

  get teaseLayer(): Container {
    return this.lighting.teaseLayer;
  }

  /** Adds the city's layers to worldContainer: far and back at the bottom, the rest on top (the host reorders its own around them). */
  mount(world: Container): void {
    world.addChildAt(this.planes.back.container, 0);
    world.addChildAt(this.planes.far.container, 0);
    world.addChild(this.litGroup, this.lighting.glowLayer, this.fog.layer, this.lighting.teaseLayer, this.planes.fore.container);
    for (const c of [this.planes.far.container, this.planes.back.container, this.litGroup, this.lighting.glowLayer, this.fog.layer, this.lighting.teaseLayer, this.planes.fore.container]) {
      c.isRenderGroup = true;
    }
  }

  setLayout(layout: CityLayout): void {
    const same = this.layout?.sig === layout.sig;
    this.layout = layout;
    if (!same) {
      this.lighting.setLayout(layout);
      this.backdrop.setLayout(layout);
    }
    this.fog.setLayout(layout);
    this.lighting.setAreaVisibility(this.fog.hiddenIds, this.fog.darkIds);
  }

  /** One area's state changed (cheaper than a new layout): tweens the fog and updates which lights are dark. */
  setAreaState(id: string, state: AreaState, progress = 0): void {
    this.fog.setState(id, state, progress);
    this.lighting.setAreaVisibility(this.fog.hiddenIds, this.fog.darkIds);
  }

  setTier(tier: RenderTier): void {
    if (tier === this.tier) return;
    this.tier = tier;
    this.applyTier();
  }

  get quality(): RenderTier {
    return this.tier;
  }

  private applyTier(): void {
    const T = TIER_RENDER[this.tier];
    this.lighting.setTier(this.tier);
    this.fog.setTier(this.tier);
    this.backdrop.setTier(this.tier);
    const P = this.planes;
    P.far.merged = [];
    if (T.planes === 'live') { P.far.setMode('live'); P.back.setMode('live'); }
    else if (T.planes === 'cached') { P.far.setMode('cached'); P.back.setMode('cached'); }
    else if (T.planes === 'merged') { P.back.setMode('cached'); P.far.setMode('merged'); P.back.merged = [P.far]; }
    else { P.far.setMode('off'); P.back.setMode('off'); }
    if (T.planes !== 'merged') P.back.merged = [];
    this.syncFilter();
  }

  setUvMode(mode: LightmapUvMode): void {
    this.uvMode = mode;
    this.lighting.filter.mode = mode;
  }

  private syncFilter(): void {
    const want = TIER_RENDER[this.tier].lightmap && this.lightmapEnabled && !this.mapCovers;
    if (want !== this.filterOn || (want && !this.litGroup.filters?.length)) {
      this.filterOn = want;
      this.litGroup.filters = want ? [this.lighting.filter] : [];
    }
    const tint = TIER_RENDER[this.tier].lightmap || !this.lightmapEnabled ? 0xffffff : LIGHTMAP_RENDER.liteTint;
    if (tint !== this.tintNow) {
      this.tintNow = tint;
      this.litGroup.tint = tint;
    }
  }

  // ------------------------------------------------------------------ content

  setRooms(rooms: readonly RoomLightInput[], extra: readonly FloorRect[] = []): void {
    this.lighting.setRooms(rooms, extra);
  }

  selectRoom(id: string | null): void {
    this.lighting.select(id);
  }

  addLight(l: LightInput): number {
    return this.lighting.add(l);
  }

  removeLight(id: number): void {
    this.lighting.remove(id);
  }

  moveLight(id: number, x: number, y: number): void {
    this.lighting.move(id, x, y);
  }

  setLightOn(id: number, on: boolean): void {
    this.lighting.setOn(id, on);
  }

  setEra(era: number, night = 0): void {
    this.lighting.setEra(era, night);
  }

  /** A growing fog reveal at a world point (a tap, a dig, a story beat: FOG.reveal radii). */
  reveal(x: number, y: number, r: number = FOG.reveal.radius): void {
    this.fog.reveal(x, y, r);
  }

  /** The topmost area under a world point (taps on edges, pockets, districts). */
  areaAt(x: number, y: number): CityArea | null {
    const areas = this.layout?.areas;
    if (!areas) return null;
    for (let i = areas.length - 1; i >= 0; i--) if (FogLayer.contains(areas[i], x, y)) return areas[i];
    return null;
  }

  bounds(): Rect {
    return this.layout?.bounds ?? { x: 0, y: 0, w: 0, h: 0 };
  }

  // ------------------------------------------------------------------ per frame

  update(cam: ParallaxInfo, t: number, dt: number, opts?: CityFrameOptions): void {
    const t0 = performance.now();
    this.stats.frame++;
    // [world:M2] The host says when its map covers (the map has faded in): during the crossfade the scene keeps drawing under it. Hosts
    // without a map (the lab) fall back to the zoom threshold.
    const covers = opts?.mapCovers !== undefined ? opts.mapCovers : cam.z < CAMERA.zoom.far;
    if (covers !== this.mapCovers) this.mapCovers = covers;
    this.syncFilter();
    const P = this.planes;
    P.far.apply(cam, this.tier);
    P.back.apply(cam, this.tier);
    P.mid.apply(cam, this.tier);
    P.fore.apply(cam, this.tier);
    if (covers) {
      // The map draws over everything: keep the planes still and do no light/fog work (and draw no plane under it).
      P.far.container.visible = P.back.container.visible = P.mid.container.visible = P.fore.container.visible = false;
      this.lighting.glowLayer.visible = false;
      this.lighting.teaseLayer.visible = false;
      this.fog.layer.visible = false;
      this.stats.updateMs = performance.now() - t0;
      return;
    }
    const now = performance.now();
    this.backdrop.update(cam, t, now);
    const v = this.view, z = cam.z;
    v.zoom = z;
    v.ox = cam.ox;
    v.oy = cam.oy;
    v.sw = cam.sw;
    v.sh = cam.sh;
    v.res = this.renderer.resolution;
    v.x0 = -cam.ox / z;
    v.y0 = -cam.oy / z;
    v.x1 = (cam.sw - cam.ox) / z;
    v.y1 = (cam.sh - cam.oy) / z;
    v.cx = (v.x0 + v.x1) / 2;
    v.cy = (v.y0 + v.y1) / 2;
    const T = TIER_RENDER[this.tier];
    this.lighting.glowLayer.visible = T.glow;
    this.lighting.teaseLayer.visible = T.glow && this.fogEnabled;
    if (T.lightmap || T.glow) this.lighting.update(v, t, dt);
    // [world:M2 perf] The filter area is pinned to the view in BOTH uv modes. Without it Pixi measures the lit group's bounds every frame
    // (getFastGlobalBounds over every room, walker and shell piece): 3-4 ms of CPU per picture at e55, the biggest single cost of the city
    // over classic. In 'global' mode the shader derives screen UV from the output frame, so any frame that covers the view is correct.
    this.area.x = v.x0;
    this.area.y = v.y0;
    this.area.width = v.x1 - v.x0;
    this.area.height = v.y1 - v.y0;
    if (this.litGroup.filterArea !== this.area) this.litGroup.filterArea = this.area;
    this.fog.layer.visible = this.fogEnabled;
    if (this.fogEnabled) this.fog.update(this.renderer, t, dt);
    if (P.far.needsBake(cam, t)) { P.far.bake(this.renderer, cam, t); this.stats.bakes++; }
    if (P.back.needsBake(cam, t)) { P.back.bake(this.renderer, cam, t); this.stats.bakes++; }
    if (this.filterOn) {
      this.lighting.render(this.renderer, t);
      this.stats.lightPasses++;
    }
    this.stats.updateMs = performance.now() - t0;
  }

  /**
   * Snapshots (`renderer.extract`): the extract renders into its own root target, where the 'global' screen UV would read the light
   * texture against the extract frame. Between `beginSnapshot()` and `endSnapshot()` the filter uses the 'area' fallback (filterArea
   * pinned to the current view), and the light texture is redrawn for the camera as it stands.
   */
  beginSnapshot(t: number): void {
    this.snapPrev = this.uvMode;
    if (this.uvMode !== 'area') this.setUvMode('area');
    const v = this.view;
    this.area.x = v.x0;
    this.area.y = v.y0;
    this.area.width = v.x1 - v.x0;
    this.area.height = v.y1 - v.y0;
    if (this.filterOn) this.litGroup.filterArea = this.area;
    this.renderLightmap(t);
  }

  endSnapshot(): void {
    if (this.snapPrev && this.snapPrev !== this.uvMode) this.setUvMode(this.snapPrev);
    this.snapPrev = null;
  }

  private snapPrev: LightmapUvMode | null = null;

  /** Renders the light texture now (the host may call it itself right before `app.render()`). */
  renderLightmap(t: number): void {
    if (this.filterOn) this.lighting.render(this.renderer, t, true);
  }

  /** After a lost and restored GL context: every render texture's content is gone; make new ones. */
  onContextRestored(): void {
    this.lighting.resizeTarget(this.view.sw, this.view.sh);
    this.fog.restore();
    this.planes.far.restore();
    this.planes.back.restore();
  }

  destroy(): void {
    this.canvas?.removeEventListener('webglcontextrestored', this.onRestored);
    this.backdrop.destroy();
    this.lighting.destroy();
    this.fog.destroy();
    for (const p of Object.values(this.planes)) p.destroy();
    this.litGroup.destroy({ children: true });
  }
}
