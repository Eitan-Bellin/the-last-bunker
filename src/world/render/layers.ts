/**
 * Parallax depth planes (style guide section 3, architecture section 5).
 *
 * Every plane is a child of `worldContainer` (so PostFX and the camera transform still apply) and is COUNTER-transformed so that its
 * content, authored in plane units (a world point (x, y) sits at (x * p, y * p)), lands on screen at
 *   screen = anchor + (u - cam * p) * zoom^(p * zoomCoupling).
 * Inside worldContainer (scale z) that is: scale k = z^(p*c - 1), position = cam * (1 - p * k). With c = 1 this is the architecture's
 * k = z^(p-1). Only the play plane is hit-tested: every plane here has eventMode 'none'.
 *
 * Caching (LAYER_CACHE): far/back may be baked into a render texture, re-baked only when the plane moved LAYER_CACHE.refreshPx on
 * screen or the zoom changed LAYER_CACHE.refreshZoom (never more often than minInterval, at once when the overscan runs out). The
 * baked sprite lives INSIDE the plane's own container, so between bakes it moves with exact parallax; only its resolution is stale.
 * On Low the far plane's content is baked into the back plane's texture ('merged'), so two planes cost one sprite.
 */
import { Container, RenderTexture, Sprite, type Renderer } from 'pixi.js';
import { DETAIL, LAYERS, LAYER_CACHE, type LayerId, type LayerTokens } from '../tokens';
import { TIER_RENDER, baseTier, type RenderTier } from '../tokensRender';
import type { Rect } from './layoutTypes';

/** The camera as the planes need it: the world point under the screen anchor, the zoom, and worldContainer's transform. */
export interface ParallaxInfo {
  /** World point at the screen anchor (the camera centre). */
  cx: number;
  cy: number;
  /** Zoom (worldContainer scale). */
  z: number;
  /** worldContainer offset on screen. */
  ox: number;
  oy: number;
  /** Screen size (CSS px). */
  sw: number;
  sh: number;
}

export function layerToken(id: LayerId): LayerTokens {
  return LAYERS.find(l => l.id === id)!;
}

const TIER_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
/** Transparent clear for a plane cache (hoisted: no array per bake). */
const CLEAR: [number, number, number, number] = [0, 0, 0, 0];

export class ParallaxPlane {
  /** On stage (child of worldContainer), counter-transformed. */
  readonly container = new Container();
  /** Static content in plane units (cacheable). */
  readonly content = new Container();
  /** Always-live content in plane units (moving trains and lifts), drawn over the cache. */
  readonly live = new Container();
  readonly token: LayerTokens;
  /** 'live': content drawn every frame; 'cached': baked texture; 'merged': baked into another plane; 'off': hidden. */
  mode: 'live' | 'cached' | 'merged' | 'off' = 'live';
  /** Planes whose content this plane's cache also bakes (Low: far into back). */
  merged: ParallaxPlane[] = [];
  /** Absolute scale and screen offset of the plane this frame. */
  absScale = 1;
  sx = 0;
  sy = 0;
  private k = 1;
  private cacheSprite = new Sprite();
  private cacheRT: RenderTexture | null = null;
  private bakeRoot = new Container();
  private holders: Container[] = [];
  /** This plane then its merged planes, refilled per bake (no array per bake). */
  private bakeList: ParallaxPlane[] = [];
  private bakedSx = NaN;
  private bakedSy = NaN;
  private bakedZ = NaN;
  private bakedAt = -1e9;
  private zoomVisible = true;
  private tier: RenderTier = 'high';
  /** Content changed since the last bake (re-baked at the next LAYER_CACHE.minInterval). */
  private stale = false;
  readonly stats = { bakes: 0 };

  readonly id: LayerId;

  constructor(id: LayerId) {
    this.id = id;
    this.token = layerToken(id);
    this.container.label = `plane:${id}`;
    this.container.eventMode = 'none';
    this.cacheSprite.visible = false;
    this.container.addChild(this.cacheSprite, this.content, this.live);
  }

  get p(): number {
    return this.token.p;
  }

  /** Applies the parallax transform and the zoom/tier visibility. */
  apply(pi: ParallaxInfo, tier: RenderTier): void {
    this.tier = tier;
    const L = this.token;
    const A = Math.pow(pi.z, L.p * L.zoomCoupling);
    const k = A / pi.z;
    this.k = k;
    this.absScale = A;
    const px = pi.cx * (1 - L.p * k), py = pi.cy * (1 - L.p * k);
    this.container.scale.set(k);
    this.container.position.set(px, py);
    this.sx = pi.ox + pi.z * px;
    this.sy = pi.oy + pi.z * py;
    // Zoom window with a soft band, and the tier's floor.
    const bt = baseTier(tier);
    let a = 1;
    const minZ = this.id === 'fore' ? Math.max(L.minZoom, DETAIL[bt].foreMinZoom) : L.minZoom;
    if (L.fadeBand > 0) a = Math.max(0, Math.min(1, (pi.z - (minZ - L.fadeBand / 2)) / L.fadeBand, ((L.maxZoom + L.fadeBand / 2) - pi.z) / L.fadeBand));
    else a = pi.z >= minZ && pi.z <= L.maxZoom ? 1 : 0;
    if (!isFinite(minZ)) a = 0;
    const tierOk = tier !== 'lite' && TIER_RANK[bt] <= TIER_RANK[L.minTier] && DETAIL[bt].layers.includes(this.id);
    this.zoomVisible = a > 0.01 && tierOk && this.mode !== 'off' && this.mode !== 'merged';
    this.container.visible = this.zoomVisible;
    this.container.alpha = a;
  }

  get visible(): boolean {
    return this.zoomVisible;
  }

  /** The screen rectangle (grown by `grow` of its size per side) in this plane's units, for chunk culling. */
  viewRect(out: Rect, pi: ParallaxInfo, grow = 0): Rect {
    const gx = pi.sw * grow, gy = pi.sh * grow;
    const A = this.absScale;
    out.x = (-gx - this.sx) / A;
    out.y = (-gy - this.sy) / A;
    out.w = (pi.sw + gx * 2) / A;
    out.h = (pi.sh + gy * 2) / A;
    return out;
  }

  /** Switches live / cached; content moves between the stage and the bake root. */
  setMode(mode: 'live' | 'cached' | 'merged' | 'off'): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'live' || mode === 'off' || mode === 'merged') {
      if (mode === 'live' && this.content.parent !== this.container) this.container.addChildAt(this.content, 1);
      this.cacheSprite.visible = false;
      if (this.cacheRT && mode !== 'merged') { this.cacheRT.destroy(true); this.cacheRT = null; }
    }
    this.bakedSx = NaN;
  }

  /** Does the cache need a new bake this frame? */
  needsBake(pi: ParallaxInfo, t: number): boolean {
    if (this.mode !== 'cached' || !this.zoomVisible) return false;
    if (!this.cacheRT || this.bakedSx !== this.bakedSx) return true;
    const dx = Math.abs(this.sx - this.bakedSx), dy = Math.abs(this.sy - this.bakedSy);
    const dz = Math.abs(pi.z / this.bakedZ - 1);
    const ov = LAYER_CACHE.overscan;
    if (dx > pi.sw * ov * 0.9 || dy > pi.sh * ov * 0.9) return true; // the overscan is running out
    if (t - this.bakedAt < LAYER_CACHE.minInterval) return false;
    return this.stale || dx > LAYER_CACHE.refreshPx || dy > LAYER_CACHE.refreshPx || dz > LAYER_CACHE.refreshZoom;
  }

  /** Bakes this plane's content (and its merged planes') as seen now into the cache texture. */
  bake(renderer: Renderer, pi: ParallaxInfo, t: number): void {
    const ov = LAYER_CACHE.overscan;
    const W = Math.ceil(pi.sw * (1 + ov * 2)), H = Math.ceil(pi.sh * (1 + ov * 2));
    const res = renderer.resolution * TIER_RENDER[this.tier].planeRes;
    if (!this.cacheRT || this.cacheRT.width !== W || this.cacheRT.height !== H || this.cacheRT.source.resolution !== res) {
      this.cacheRT?.destroy(true);
      this.cacheRT = RenderTexture.create({ width: W, height: H, resolution: res });
      this.cacheSprite.texture = this.cacheRT;
    }
    const planes = this.bakeList;
    planes.length = 0;
    planes.push(this);
    for (const m of this.merged) planes.push(m);
    while (this.holders.length < planes.length) {
      const h = new Container();
      this.holders.push(h);
      this.bakeRoot.addChild(h);
    }
    for (let i = 0; i < planes.length; i++) {
      const q = planes[i], h = this.holders[i];
      if (q.content.parent !== h) h.addChild(q.content);
      h.scale.set(q.absScale);
      h.position.set(q.sx + pi.sw * ov, q.sy + pi.sh * ov);
      h.visible = true;
    }
    for (let i = planes.length; i < this.holders.length; i++) this.holders[i].visible = false;
    renderer.render({ container: this.bakeRoot, target: this.cacheRT, clear: true, clearColor: CLEAR });
    // The sprite sits in this plane's own units: screen = (sx, sy) + A * u.
    const A = this.absScale;
    this.cacheSprite.scale.set(1 / A);
    this.cacheSprite.position.set((-pi.sw * ov - this.sx) / A, (-pi.sh * ov - this.sy) / A);
    this.cacheSprite.visible = true;
    this.bakedSx = this.sx;
    this.bakedSy = this.sy;
    this.bakedZ = pi.z;
    this.bakedAt = t;
    this.stale = false;
    this.stats.bakes++;
  }

  /** Forces a bake next frame (content changed, context restored). */
  invalidate(): void {
    this.stale = true;
    if (this.cacheRT && this.cacheRT.source.destroyed) this.cacheRT = null;
  }

  /** After a lost GL context: the cache texture's content is gone. */
  restore(): void {
    this.cacheRT?.destroy(true);
    this.cacheRT = null;
    this.cacheSprite.visible = false;
    this.bakedSx = NaN;
  }

  destroy(): void {
    this.cacheRT?.destroy(true);
    this.bakeRoot.destroy({ children: true });
    this.container.destroy({ children: true });
  }
}
