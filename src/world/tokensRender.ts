/**
 * Render-side tokens for "The City Below" that `tokens.ts` does not carry: how the lightmap is encoded and sampled, the level of
 * detail thresholds, the 'lite' tier, light culling cells, fog presentation, and the procedural backdrop's dressing numbers.
 *
 * Art direction stays in `tokens.ts` (colours, presets, readability floors, layer stack, tier budgets); this file only adds the
 * numbers the renderer needs to turn those into pixels. Owned by the tech-artist; `src/world/render/*` reads both files and has no
 * literals of its own. Pure data, no runtime imports.
 */
import type { Hex, Tier } from './tokens';

/** The renderer's tiers: the game's three quality levels plus 'lite' (crash-recovery / very weak devices: no lightmap, flat tint). */
export type RenderTier = Tier | 'lite';
/** Tiers from richest to poorest. */
export const RENDER_TIERS: readonly RenderTier[] = ['high', 'medium', 'low', 'lite'];
/** For per-tier tables that 'lite' shares with 'low'. */
export const baseTier = (t: RenderTier): Tier => (t === 'lite' ? 'low' : t);

export const LIGHTMAP_RENDER = {
  /**
   * Light values are stored at 1/gain in the 8-bit light texture and multiplied back in the LightmapFilter, so a pool may overexpose
   * to `gain` x the painted exposure (LIGHT.presets intensities above 1 feed the bloom) without clipping at 1.
   */
  gain: 2,
  /**
   * Highlight shoulder in the LightmapFilter: light up to 1 stays linear (readability floors are exact), light above 1 is compressed
   * as 1 + e / (1 + e * shoulder), so a hub full of overlapping pools glows instead of blowing out to white.
   */
  shoulder: 1.6,
  /** Ambient: the stratum `ambient` colour is normalised to its brightest channel (the hue) and scaled by `ambientLevel` (the strength). */
  ambientNormalize: true,
  /**
   * LIGHT.depthRamp is read as depth below the ground line (the top of stratum 1 in the layout), and its light is scaled by this:
   * at full strength the sky would light the whole first stratum to ~0.9 and drown the lamps (lab, 2026-10-15).
   */
  depthRampGain: 0.3,
  /** Extra multiplier on every stratum's ambient (lab tuning hook; 1 = as the style guide). */
  ambientGain: 1,
  /** Size (px) of the generated pool texture; its profile is `poolFalloff` from tokens, so every pool follows the one curve. */
  poolTex: 256,
  /** Halo texture: softer radial (exponent) so cores bloom without a hard disc. */
  haloTex: 128,
  haloExp: 1.6,
  /** Cone texture size (w, h). */
  coneTex: [128, 256] as readonly [number, number],
  /** Room readability fills: the feathered rectangle's ramp texture (px per side; the drawn feather is LIGHT.read.edgeFeather). */
  softRectTex: 32,
  /** Stratum ambient bands overlap and cross-fade over this many world units (the seam). */
  seamFeather: 60,
  /** Extra light slots kept beyond the tier budget so lights leaving the budget can fade out instead of popping. */
  fadeSlack: 12,
  /** Static lights are bucketed in square cells of this size (world units) for view culling (prototype C's light cells, in 2D). */
  cell: 256,
  /** Room lamp radius: preset radius x clamp(meta r / refR, minFrac, 1). meta.json `r` 0.15 is a ceiling lamp. */
  roomLampRefR: 0.15,
  /**
   * Room lamps add on top of the room's readability floor, and the paintings already carry their own baked light: at full preset
   * intensity a working room reached ~1.7x its painted exposure (lab). Pools from meta.json lamps are scaled by this.
   */
  roomLampGain: 0.55,
  roomLampMinFrac: 0.4,
  /** The corridor spill of a room's main lamp sits this far below the room's floor line (world units). */
  roomSpillDy: 14,
  /** The Lite tier: no lightmap; the lit group is tinted flat with this colour (a mid-dark warm grey, rooms still read). */
  liteTint: 0xb8b0a4 as Hex,
} as const;

/** The LightmapFilter's screen-UV source. 'global': Pixi's uGlobalFrame (nested-filter safe). 'area': filterArea pinned to the screen. */
export type LightmapUvMode = 'global' | 'area';
export const LIGHTMAP_UV_DEFAULT: LightmapUvMode = 'global';

/** Level of detail by zoom (architecture section 5; the map threshold is CAMERA.zoom.far in tokens). */
export const LOD = {
  /** Below this zoom no cones and no fore plane (above the map threshold). */
  conesMinZoom: 0.85,
  /** Above this zoom name tags and fine signs (owned by the labels layer; listed here for one source of truth). */
  closeZoom: 1.2,
} as const;

/** Per-tier render switches that are not art direction. */
export const TIER_RENDER: Record<RenderTier, {
  lightmap: boolean;
  /** Fog breathing halos (jittered copies of the fog texture). */
  fogHalos: number;
  /** Fog texture redraws per second while it animates (0 = only when something changed). */
  fogHz: number;
  /** Far/back planes: 'live' content, 'cached' per-plane texture, 'merged' far baked into back's cache. */
  planes: 'live' | 'cached' | 'merged' | 'off';
  /** Glow layer (halos, cones, motes). */
  glow: boolean;
  /**
   * Pixel density of the far/back plane caches relative to the renderer (the planes are hazed and soft: half density is invisible and
   * a quarter of the memory; in the game at Medium the two caches were 13 MB at 1x on a 1280x800 desktop).
   */
  planeRes: number;
}> = {
  high: { lightmap: true, fogHalos: 2, fogHz: 30, planes: 'live', glow: true, planeRes: 1 },
  medium: { lightmap: true, fogHalos: 1, fogHz: 15, planes: 'merged', glow: true, planeRes: 0.5 }, // [world:C2] far baked into back's cache (one cache, not two)
  low: { lightmap: true, fogHalos: 1, fogHz: 0, planes: 'merged', glow: true, planeRes: 0.5 },
  lite: { lightmap: false, fogHalos: 0, fogHz: 0, planes: 'off', glow: false, planeRes: 0.5 },
};

/** Flicker means: what a light holds when its flicker kind does not animate on the tier (fraction of intensity). */
export const FLICKER_MEAN = { fire: 0.91, failingTube: 1, pulse: 1, sway: 1, blink: 1, tv: 0.85, weld: 0.35, steady: 1 } as const;

/** Fog presentation (FOG in tokens holds the look; these map the layout's area states onto it). */
export const FOG_RENDER = {
  /** Texture size cap per side; the cell grows past FOG.cell when the city is wider than cap x cell. */
  maxTex: 2048,
  /** Margin around the layout bounds covered by the fog texture (world units). */
  margin: 256,
  /** Blur of the area mask in fog texels per FOG.edge.softCells (soft organic edges). */
  blurPerCell: 1.6,
  /** Halo copies jitter by base + breath x amp fog texels... in world units. */
  haloJitter: { base: 6, amp: 10 },
  /** Undiscovered mottling: noise texture size and the tile scale (world units per noise texel = FOG.states.undiscovered.noiseScale / tex). */
  noiseTex: 128,
  /** A glimpsed `edge` area starts at FOG.hintStart open (the dark-edge hint); other glimpsed areas take the 'known' memory look. */
  edgeKinds: ['edge'] as readonly string[],
  /** Max reveal brushes remembered (taps); the oldest is recycled. */
  maxBrushes: 48,
  /** Mottling: the noise erases up to this share of the fog (times FOG.states.undiscovered.noiseAlpha). */
  mottle: 0.35,
  /** Noise cells across one tile of the noise texture. */
  noiseCells: 4,
  /** A reveal brush grows from this fraction of its radius. */
  brushStart: 0.25,
} as const;

/** People in the city (BunkerRenderer behind `?city`): they stand in the lit group, so the lightmap lights them; their own tint is this neutral. */
export const PEOPLE_RENDER = {
  /** Replaces the classic lamp-pool / depth tint of room people and walkers (a touch warm so skin never reads grey). */
  cityAmbient: 0xf4eee6 as Hex,
} as const;

/** Procedural backdrop (far / back / mid / fore) dressing. Counts per chunk scale with DETAIL. */
export const BACKDROP = {
  /** Chunk size in plane units. */
  chunk: 512,
  /** Builds per frame (architecture: at most 2). */
  maxBuilds: 2,
  /** Chunks outside the keep window are given back after this long (ms). */
  parkAfterMs: 8000,
  far: { pillarsPerChunk: 2, clusterChance: 0.6, windowsPerCluster: 12, hazePerChunk: 1, pillarW: [30, 110] as readonly [number, number] },
  back: { ribsPerChunk: 7, clusterChance: 0.55, housesPerCluster: 8, windowChance: 0.55, ribRimAlpha: 0.35 },
  mid: { shacksPerDistrict: 9, galleryRings: 3, crystalsPerCave: 8 },
  /**
   * [world:C2] `enabled`: the fore lip runs along the stratum seams at parallax 1.32, so in the game it drifts over the dig face, its sign and
   * the rooms (style guide: never over a room or a badge). Off until a layout-aware fore keeps clear of the storey strips.
   */
  fore: { enabled: false, lipStep: [40, 90] as readonly [number, number], outcropChance: 0.35, rimAlpha: 0.45 },
  /** Lit windows: colour pool (inhabited temperatures) and halo size (plane units). */
  windowHalo: 22,
  windowAlpha: 0.35,
  /** Back-plane life: the metro train (plane units/s) and far lifts (cycles/s). */
  trainSpeed: 70,
  liftSpeed: [0.04, 0.09] as readonly [number, number],
  /** Strata whose back plane carries the viaduct (the shelter foreshadows the metro). */
  viaductStrata: [1, 3] as readonly number[],
  /** Backlit glow behind a back-plane house cluster (plane units) and its strength at full windows. */
  clusterHalo: [720, 360] as readonly [number, number],
  clusterHaloAlpha: 0.22,
  /** The train's window glow. */
  trainGlowAlpha: 0.35,
  /** Cached planes build chunks this far (fraction of the screen per side) beyond the view, for the overscan. */
  cachedGrow: 0.2,
  /** The outermost underground bands' backdrop runs on this far past them (world units), so parallax never opens a gap. */
  bandOverrun: 900,
  /** The haze band (screen-space feel, plane units). */
  hazeH: [120, 220] as readonly [number, number],
} as const;
