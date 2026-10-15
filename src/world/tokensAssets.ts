/**
 * World redesign "The City Below": the WORLD KIT asset table (asset-pipeline agent).
 *
 * One row per baked sprite / tile of `public/art/world/`. The bake tool (`tools/world/kit-world.ts`) paints exactly the pixel sizes
 * given here, and the runtime (`src/art/worldKit.ts`) reads the same rows to place, scale and light the art, and to draw a procedural
 * stand-in while a file is missing. Change a size here and re-run the tool; nothing else needs to move.
 *
 * Conventions (same as `tokens.ts`)
 * - Distances are WORLD UNITS. Scale reference: an adult survivor is about 48 u tall (1.75 m, so 1 m = 27.4 u); ROOM_H 100,
 *   SLOT_W 46, FLIGHT_RUN 38 / FLIGHT_RISE 36 (rendering/geom.ts).
 * - `ppu` = texture pixels per world unit. A sprite drawn at scale 1/ppu has its true world size.
 * - `px` is the FULL frame in pixels, transparent padding included (`pad` px on every side, room for the 1.5 u outline).
 *   `world` is the CONTENT size (without padding). `anchor` is normalised over the full frame (Pixi `sprite.anchor`).
 * - Lamp and glow spots are in world units relative to the anchor point (y grows downward), so a builder adds them to the sprite's
 *   world position. `preset` names a `LIGHT.presets` entry in tokens.ts: the pool itself is the lighting system's, not baked.
 * - `repeat`: 'none' = a sprite; 'x' = a strip that tiles sideways (TilingSprite); 'xy' = a seamless tile.
 * - `tint`: which stratum palette entry (tokens STRATA[i].palette) the runtime may multiply onto the art so one neutral piece serves
 *   every stratum ('none' = the art carries its own colour and is used as is).
 * - Emissive masks hold glow colour on black and are drawn ADDITIVELY above the lightmap (glow layer) or fed into it.
 *
 * Pure data and pure helpers: imports types only, safe in Node tests.
 */
import type { LIGHT, StratumId } from './tokens';

export type LightPresetName = keyof typeof LIGHT.presets;

/** Same strings as `KitId` in src/data/strata.ts (kept local so this table does not depend on a file still in flux). */
export type WorldKitId = 'surface' | 'shelter' | 'works' | 'metro' | 'mines' | 'caves' | 'core';
export const WORLD_KIT_IDS: readonly WorldKitId[] = ['surface', 'shelter', 'works', 'metro', 'mines', 'caves', 'core'];
export const KIT_STRATUM: Record<WorldKitId, StratumId> = { surface: 0, shelter: 1, works: 2, metro: 3, mines: 4, caves: 5, core: 6 };

/** Bump when the art changes shape (sizes, packing): it is appended to every URL as ?v= so browsers and the service worker refetch. */
export const WORLD_KIT_VERSION = 1;
/** Folder under public/art. */
export const WORLD_DIR = 'world';

export type WorldRepeat = 'none' | 'x' | 'xy';
export type WorldLayerId = 'far' | 'back' | 'mid' | 'play' | 'fore';
export type TintRole = 'none' | 'rock' | 'rockRim' | 'built' | 'metal' | 'secondary' | 'farBase';
/** Which procedural stand-in the runtime draws while the file is missing (see worldKit.ts). */
export type FallbackKind = 'rock' | 'band' | 'rim' | 'ao' | 'stripe' | 'rail' | 'deck' | 'wall' | 'tiles' | 'plate' | 'lip' | 'box' | 'stair' | 'rubble' | 'lamp' | 'silhouette';

export interface WorldLampSpot {
  x: number;
  y: number;
  preset: LightPresetName;
  /** Cone direction in radians (0 = straight down, positive = toward +x), when the preset has a cone. */
  dir?: number;
}

export interface WorldGlowSpot {
  x: number;
  y: number;
  /** Halo radius (world units). */
  r: number;
}

export interface WorldAssetDef {
  id: WorldAssetId;
  /** Atlas page id (WORLD_PAGES) or null when the asset is its own file. */
  page: WorldPageId | null;
  /** File base name (no extension) under public/art/world: the page file for atlas items, the asset's own file otherwise. */
  file: string;
  px: readonly [number, number];
  pad: number;
  ppu: number;
  world: readonly [number, number];
  anchor: readonly [number, number];
  repeat: WorldRepeat;
  layer: WorldLayerId;
  /** Strata the piece was designed for (the generic set lists 2..6). */
  strata: readonly StratumId[];
  tint: TintRole;
  /**
   * Emissive mask. Atlas items: true = the twin page `<page>-e` holds the mask in the same frame. Own-file assets: the mask file and
   * its resolution relative to the albedo (0.5 = half size, stretched to the same world size).
   */
  emissive?: true | { file: string; scale: number };
  lamps?: readonly WorldLampSpot[];
  glows?: readonly WorldGlowSpot[];
  /** Stair flights and similar: the world offset from one copy to the next when chained. */
  repeatStep?: readonly [number, number];
  fallback: FallbackKind;
  purpose: string;
}

// =================================================================================================================================
// Atlas pages
// =================================================================================================================================

export type WorldPageId = 'struct' | 'lamps' | 'fore';

export interface WorldPageDef {
  file: string;
  size: readonly [number, number];
  /** A twin `<file>-e` page with the emissive masks in the same frames. */
  emissive: boolean;
}

export const WORLD_PAGES: Record<WorldPageId, WorldPageDef> = {
  struct: { file: 'atlas-struct', size: [1024, 512], emissive: false },
  lamps: { file: 'atlas-lamps', size: [512, 512], emissive: true },
  fore: { file: 'atlas-fore', size: [1024, 512], emissive: false },
};

// =================================================================================================================================
// The table
// =================================================================================================================================

export const WORLD_ASSET_IDS = [
  // rock cut-face tiles and their banding strips, one pair per kit
  'rock-surface', 'rock-shelter', 'rock-works', 'rock-metro', 'rock-mines', 'rock-caves', 'rock-core',
  'band-surface', 'band-shelter', 'band-works', 'band-metro', 'band-mines', 'band-caves', 'band-core',
  // cut edge
  'edge-rim', 'edge-ao',
  // strips
  'tape', 'railing', 'deck',
  // walls
  'hub-vault', 'corridor-tile',
  // plates
  'far-shelter', 'far-generic', 'back-shelter', 'back-pipes', 'back-surface', 'fore-lip',
  // struct atlas
  'door-closed', 'door-open', 'door-welded', 'stair-flight', 'rubble-a', 'rubble-b', 'rubble-c', 'timber-set', 'timber-planks', 'timber-beam',
  // lamps atlas
  'lamp-tube', 'lamp-chandelier', 'lamp-bulb', 'lamp-work', 'lamp-cage', 'lamp-wall', 'lamp-beacon', 'lamp-lantern',
  // fore atlas
  'fore-outcrop', 'fore-pipes', 'fore-cable', 'fore-pipe-h',
] as const;

export type WorldAssetId = typeof WORLD_ASSET_IDS[number];

const ALL: readonly StratumId[] = [0, 1, 2, 3, 4, 5, 6];
const UNDER: readonly StratumId[] = [1, 2, 3, 4, 5, 6];
const GENERIC: readonly StratumId[] = [2, 3, 4, 5, 6];

type Opt = Partial<Omit<WorldAssetDef, 'id' | 'px' | 'pad' | 'ppu' | 'world' | 'page' | 'file'>> & { purpose: string; fallback: FallbackKind };

/** An asset in its own file: `px` is exact, world = px / ppu. */
function own(id: WorldAssetId, px: [number, number], ppu: number, repeat: WorldRepeat, layer: WorldLayerId, strata: readonly StratumId[], o: Opt): WorldAssetDef {
  return {
    id, page: null, file: id, px, pad: 0, ppu, world: [px[0] / ppu, px[1] / ppu], anchor: [0, 0], repeat, layer, strata,
    tint: 'none', ...o,
  };
}

/**
 * A sprite on an atlas page: content `w` x `h` world units at `ppu`, `pad` px of transparent border. `ax`/`ay` is the anchor over the
 * CONTENT (0..1); it is converted to the full frame here.
 */
function spr(id: WorldAssetId, page: WorldPageId, w: number, h: number, ppu: number, ax: number, ay: number, layer: WorldLayerId, strata: readonly StratumId[], o: Opt, pad = 6): WorldAssetDef {
  const cw = Math.round(w * ppu), ch = Math.round(h * ppu);
  const fw = cw + pad * 2, fh = ch + pad * 2;
  return {
    id, page, file: WORLD_PAGES[page].file, px: [fw, fh], pad, ppu, world: [w, h],
    anchor: [(pad + ax * cw) / fw, (pad + ay * ch) / fh], repeat: 'none', layer, strata, tint: 'none', ...o,
  };
}

const ROCK_PPU = 512 / 400;
const KIT_ROCK_PURPOSE: Record<WorldKitId, string> = {
  surface: 'ash soil with roots, charcoal and pebbles: the cut face at and just under the ground',
  shelter: 'warm clay with laminae, gravel lenses and rootlets: the Upper Shelter cut face',
  works: 'sandstone beds and gravel: the Service Network cut face',
  metro: 'grey granite blocks, joints and mica: the Old Metro cut face',
  mines: 'wet basalt, columnar joints, copper veins and gold flecks: the Mines cut face',
  caves: 'violet-black rock with flowstone drapes and crystal flecks (emissive): the Deep Caves cut face',
  core: 'near-black bedrock with magma-lit cracks (emissive): the Core cut face',
};
const KIT_BAND_PURPOSE: Record<WorldKitId, string> = {
  surface: 'charcoal and ash layer', shelter: 'gravel lens and contact line', works: 'thick cross-bedded sandstone bed',
  metro: 'pale quartz vein band', mines: 'ore seam: copper green and rust', caves: 'calcite flowstone ledge (emissive crystals)',
  core: 'magma-lit fissure band (emissive)',
};

const defs: WorldAssetDef[] = [];
for (const k of WORLD_KIT_IDS) {
  const s = KIT_STRATUM[k];
  const glowRock = k === 'caves' || k === 'core';
  defs.push(own(`rock-${k}` as WorldAssetId, [512, 512], ROCK_PPU, 'xy', 'play', [s], {
    fallback: 'rock', tint: 'none', purpose: `Rock cut-face tile, seamless both ways. ${KIT_ROCK_PURPOSE[k]}.`,
    ...(glowRock ? { emissive: { file: `rock-${k}-e`, scale: 0.5 } } : {}),
  }));
  defs.push(own(`band-${k}` as WorldAssetId, [512, 128], ROCK_PPU, 'x', 'play', [s], {
    fallback: 'band', purpose: `Strata banding strip laid across the rock tile (feathered top and bottom): ${KIT_BAND_PURPOSE[k]}.`,
    ...(glowRock || k === 'mines' ? { emissive: { file: `band-${k}-e`, scale: 0.5 } } : {}),
  }));
}

defs.push(
  own('edge-rim', [256, 16], 2, 'x', 'play', ALL, {
    fallback: 'rim', tint: 'rockRim', anchor: [0, 0.25],
    purpose: 'Cut-edge light rim (white, ragged, chipped): tint with the stratum rockRim, alpha 0.35 (UNIFY.cutEdge). Anchor sits on the cut line.',
  }),
  own('edge-ao', [256, 32], 2, 'x', 'play', ALL, {
    fallback: 'ao', purpose: 'Cut-edge ambient occlusion band (black, ragged edge, 14 u falloff). Top edge on the cut line; rotate for walls and ceilings.',
  }),
  own('tape', [256, 24], 2, 'x', 'play', ALL, {
    fallback: 'stripe', anchor: [0, 0.5], purpose: 'Caution tape: hazard yellow and black, twisting, dirty. Stretch between posts across a blocked tunnel.',
  }),
  own('railing', [256, 48], 2, 'x', 'play', UNDER, {
    fallback: 'rail', tint: 'secondary', anchor: [0, 1],
    purpose: 'Balcony / walkway railing (neutral enamel, tint per stratum): top rail, mid rail, posts every 64 u, kick plate, 1.5 u outline. Anchor on the deck line.',
  }),
  own('deck', [256, 64], 2, 'x', 'play', UNDER, {
    fallback: 'deck', anchor: [0, 0],
    purpose: 'Balcony / bridge deck: grating lip, riveted channel face, brackets every 64 u, soffit shadow. Anchor at the walking line.',
  }),
  own('hub-vault', [512, 512], 512 / 192, 'x', 'play', [1], {
    fallback: 'wall', anchor: [0, 1],
    purpose: 'Bell Square back wall: one 192 u bay of board-formed concrete, a recessed arch, enamel green dado, cream upper paint, pilasters at the seams. Tiles sideways; stack per storey.',
    lamps: [{ x: 96, y: -150, preset: 'wallLamp' }],
  }),
  own('corridor-tile', [256, 256], 2.56, 'x', 'play', [1, 2], {
    fallback: 'tiles', anchor: [0, 1],
    purpose: 'Service corridor wall: cream subway tile over a green dado, cap band, skirting, grime and water streaks, chipped tiles. One room-height (100 u) repeat.',
  }),
  own('far-shelter', [1024, 512], 0.5, 'x', 'far', [1], {
    fallback: 'plate', anchor: [0, 1], emissive: { file: 'far-shelter-e', scale: 0.5 },
    purpose: 'Far plate, Upper Shelter: distant cavern cliffs with terraced dwellings on ledges and a colossal pillar. Windows in the emissive mask (fade it 0.45 day / 0.85 night).',
  }),
  own('far-generic', [1024, 512], 0.5, 'x', 'far', GENERIC, {
    fallback: 'plate', tint: 'farBase', anchor: [0, 1], emissive: { file: 'far-generic-e', scale: 0.5 },
    purpose: 'Far plate, generic (strata 2-6): neutral cliffs, pillars and a few window clusters; tint toward the stratum farBase, emissive tinted by its key light.',
  }),
  own('back-shelter', [1024, 512], 1024 / 1536, 'x', 'back', [1, 2], {
    fallback: 'plate', anchor: [0, 1], emissive: { file: 'back-shelter-e', scale: 0.5 },
    purpose: 'Back plate: tiers of galleries with railings, arches, doorways and pipe runs (the view through the hub window). Doorways and windows glow in the mask.',
  }),
  own('back-pipes', [1024, 256], 1024 / 1536, 'x', 'back', [1, 2, 3, 4, 5, 6], {
    fallback: 'plate', anchor: [0, 1],
    purpose: 'Back plate: pipe rack with valves, flanges, supports and cable trays (behind corridors and galleries), painted steel with red valve wheels; transparent around it.',
  }),
  own('back-surface', [1024, 256], 0.5, 'x', 'back', [0], {
    fallback: 'plate', anchor: [0, 1], emissive: { file: 'back-surface-e', scale: 0.5 },
    purpose: 'Back plate, surface: the ruined skyline (broken blocks, a radio mast with a red beacon, a few fires in windows) sitting on the horizon.',
    glows: [{ x: 1556, y: -398, r: 30 }],
  }),
  own('fore-lip', [1024, 128], 1, 'x', 'fore', ALL, {
    fallback: 'lip', anchor: [0, 0],
    purpose: 'Foreground ragged rock lip (baked near-black with a faint warm rim; draw untinted). Anchor on its top edge; flip vertically for a floor lip.',
  }),
);

// ---------------------------------------------------------------------------------------------------------------------------------
// struct atlas (3 px/u). No emissive twin (it would cost 2 MB of GPU for three status lamps): the door lamps are `lamps` spots,
// and the lighting system's halo for their preset (emergency / signal) makes the glow.
// ---------------------------------------------------------------------------------------------------------------------------------
const SP = 3;
defs.push(
  spr('door-closed', 'struct', 56, 72, SP, 0.5, 1, 'play', ALL, {
    fallback: 'box', lamps: [{ x: 0, y: -68, preset: 'emergency' }],
    purpose: 'Blast door, closed: riveted enamel-green leaf worn to steel, hand wheel, hazard-banded frame, red status lamp above. Anchor bottom centre.',
  }),
  spr('door-open', 'struct', 56, 72, SP, 0.5, 1, 'play', ALL, {
    fallback: 'box', lamps: [{ x: 0, y: -68, preset: 'signal' }],
    purpose: 'Blast door, open: the leaf swung back edge-on, the dark passage beyond, teal status lamp. Same frame as closed.',
  }),
  spr('door-welded', 'struct', 56, 72, SP, 0.5, 1, 'play', ALL, {
    fallback: 'box',
    purpose: 'Blast door, welded shut: closed leaf with crossed steel straps, weld beads and scorch; the status lamp is dead.',
  }),
  spr('stair-flight', 'struct', 38, 36, SP, 0, 1, 'play', UNDER, {
    fallback: 'stair', repeatStep: [38, -36],
    purpose: 'One steel stair flight (FLIGHT_RUN 38 x FLIGHT_RISE 36): channel stringer, 6 grated treads with lit nosings. Chain by repeatStep; scale.x = -1 for the other hand.',
  }),
  spr('rubble-a', 'struct', 64, 26, SP, 0.5, 1, 'play', ALL, { fallback: 'rubble', purpose: 'Rubble pile, small: concrete chunks and dust. Anchor bottom centre.' }),
  spr('rubble-b', 'struct', 96, 36, SP, 0.5, 1, 'play', ALL, { fallback: 'rubble', purpose: 'Rubble pile, medium: slabs, chunks, a bent rebar.' }),
  spr('rubble-c', 'struct', 128, 50, SP, 0.5, 1, 'play', ALL, { fallback: 'rubble', purpose: 'Rubble choke, large: broken slab, rebar, blocks, plank ends (the blocked tunnel).' }),
  spr('timber-set', 'struct', 64, 72, SP, 0.5, 1, 'play', [1, 4], {
    fallback: 'box', purpose: 'Timber set: two posts and a cap beam with iron straps and wedges (tunnel support). Anchor bottom centre.',
  }),
  spr('timber-planks', 'struct', 56, 16, SP, 0.5, 1, 'play', [0, 1, 4], { fallback: 'box', purpose: 'A stack of rough planks on the ground.' }),
  spr('timber-beam', 'struct', 96, 20, SP, 0.5, 1, 'play', [1, 4], { fallback: 'box', purpose: 'A broken timber beam, snapped at one end, lying across rubble.' }),
);

// ---------------------------------------------------------------------------------------------------------------------------------
// lamps atlas (3 px/u): albedo + emissive twin
// ---------------------------------------------------------------------------------------------------------------------------------
const LP = 3;
defs.push(
  spr('lamp-tube', 'lamps', 48, 8, LP, 0.5, 0, 'play', ALL, {
    fallback: 'lamp', emissive: true, lamps: [{ x: 0, y: 6, preset: 'fluoroTube' }],
    purpose: 'Caged fluorescent fixture, ceiling-mounted (anchor top centre). Use preset failingTube for the one bad tube per corridor.',
  }),
  spr('lamp-chandelier', 'lamps', 100, 84, LP, 0.5, 0, 'play', [1], {
    fallback: 'lamp', emissive: true, lamps: [{ x: 0, y: 70, preset: 'chandelier' }],
    glows: [-44, -31, -11, 11, 31, 44].map((x, i) => ({ x, y: 62 + (i === 0 || i === 5 ? 0 : i === 1 || i === 4 ? 6 : 9), r: 7 })),
    purpose: 'Bell Square brass ring chandelier hanging from its chain (anchor at the ceiling hook): 6 visible bulbs, the hub lamp.',
  }),
  spr('lamp-bulb', 'lamps', 6, 10, LP, 0.5, 0, 'play', ALL, {
    fallback: 'lamp', emissive: true, lamps: [{ x: 0, y: 6.5, preset: 'stringBulb' }],
    purpose: 'One string-light bulb in its socket (anchor at the wire). Hang along a catenary.',
  }),
  spr('lamp-work', 'lamps', 30, 80, LP, 0.5, 1, 'play', ALL, {
    fallback: 'lamp', emissive: true, lamps: [{ x: 4, y: -72, preset: 'floodlight', dir: -0.5 }],
    purpose: 'Work flood lamp on a tripod pole (dig faces, the ramp, building sites). Anchor at the feet.',
  }),
  spr('lamp-cage', 'lamps', 12, 16, LP, 0, 0.5, 'play', ALL, {
    fallback: 'lamp', emissive: true, lamps: [{ x: 7, y: 2, preset: 'cageLamp' }],
    purpose: 'Caged bulkhead lamp on a wall bracket (anchor at the wall plate). Ramp and tunnels.',
  }),
  spr('lamp-wall', 'lamps', 14, 14, LP, 0.5, 0.5, 'play', [1], {
    fallback: 'lamp', emissive: true, lamps: [{ x: 0, y: 1, preset: 'wallLamp' }],
    purpose: 'Brass wall sconce with a glass shade (balcony backs, the vault pilasters).',
  }),
  spr('lamp-beacon', 'lamps', 10, 10, LP, 0.5, 1, 'play', [0, 1], {
    fallback: 'lamp', emissive: true, lamps: [{ x: 0, y: -6, preset: 'emergency' }],
    purpose: 'Red emergency beacon (the hatch frame, the ramp threshold). Anchor at its base.',
  }),
  spr('lamp-lantern', 'lamps', 10, 16, LP, 0.5, 0, 'play', ALL, {
    fallback: 'lamp', emissive: true, lamps: [{ x: 0, y: 10, preset: 'lantern' }],
    purpose: 'Hand lantern (hung by its bail, anchor at the hook; set it on the ground with anchor y = 1).',
  }),
);

// ---------------------------------------------------------------------------------------------------------------------------------
// fore atlas (1.25 px/u, baked near-black silhouettes with a faint rim: draw untinted)
// ---------------------------------------------------------------------------------------------------------------------------------
const FP = 1.25;
defs.push(
  spr('fore-outcrop', 'fore', 260, 200, FP, 0.5, 1, 'fore', ALL, { fallback: 'silhouette', purpose: 'Foreground rock outcrop rising from the bottom edge.' }, 4),
  spr('fore-pipes', 'fore', 60, 380, FP, 0.5, 0, 'fore', UNDER, { fallback: 'silhouette', purpose: 'Foreground pair of vertical pipes with flanges and a clamp (hang from the top).' }, 4),
  spr('fore-cable', 'fore', 480, 70, FP, 0, 0, 'fore', ALL, { fallback: 'silhouette', purpose: 'Foreground sagging cable bundle, ends at the anchor (0,0) and (480,0).' }, 4),
  spr('fore-pipe-h', 'fore', 480, 50, FP, 0, 0.5, 'fore', UNDER, { fallback: 'silhouette', purpose: 'Foreground horizontal pipe pair with flanges and hangers.' }, 4),
);

export const WORLD_ASSETS: Readonly<Record<WorldAssetId, WorldAssetDef>> = Object.fromEntries(defs.map(d => [d.id, d])) as Record<WorldAssetId, WorldAssetDef>;

export function worldAssetDef(id: WorldAssetId): WorldAssetDef {
  return WORLD_ASSETS[id];
}

// =================================================================================================================================
// Atlas packing (pure, deterministic): the tool paints into these frames and the runtime cuts them out of the page, so both
// always agree as long as they run the same table.
// =================================================================================================================================

export interface Frame { x: number; y: number; w: number; h: number }

let packed: Map<WorldAssetId, Frame> | null = null;

/**
 * Shelf packer with sub-columns: items sorted by height (then id) go left to right on a shelf; an item that does not fit on the
 * shelf's remaining width is stacked under an earlier item in the same shelf when there is room, else a new shelf opens.
 * Throws when a page overflows (the bake tool reports it; the runtime never sees an overflowing table that the tool accepted).
 */
export function worldFrames(): Map<WorldAssetId, Frame> {
  if (packed) return packed;
  const out = new Map<WorldAssetId, Frame>();
  for (const pid of Object.keys(WORLD_PAGES) as WorldPageId[]) {
    const [PW, PH] = WORLD_PAGES[pid].size;
    const items = defs.filter(d => d.page === pid).sort((a, b) => b.px[1] - a.px[1] || (a.id < b.id ? -1 : 1));
    let shelfY = 0, shelfH = 0, x = 0;
    let cols: { x: number; w: number; used: number }[] = [];
    for (const it of items) {
      const [w, h] = it.px;
      if (shelfH && x + w <= PW) {
        out.set(it.id, { x, y: shelfY, w, h });
        cols.push({ x, w, used: h });
        x += w;
        continue;
      }
      const col = shelfH ? cols.find(c => c.w >= w && c.used + h <= shelfH) : undefined;
      if (col) {
        out.set(it.id, { x: col.x, y: shelfY + col.used, w, h });
        col.used += h;
        continue;
      }
      shelfY += shelfH;
      shelfH = h;
      x = 0;
      cols = [];
      if (w > PW || shelfY + h > PH) throw new Error(`world kit: page ${pid} overflows at ${it.id}`);
      out.set(it.id, { x, y: shelfY, w, h });
      cols.push({ x, w, used: h });
      x += w;
    }
  }
  packed = out;
  return out;
}

/** The frame of an asset in its file: the atlas frame, or the whole file. */
export function worldFrame(id: WorldAssetId): Frame {
  const d = WORLD_ASSETS[id];
  if (d.page) return worldFrames().get(id)!;
  return { x: 0, y: 0, w: d.px[0], h: d.px[1] };
}

/** File names (without extension) the kit consists of: own files, their masks, the pages and their twins. */
export function worldFiles(): string[] {
  const s = new Set<string>();
  for (const d of defs) {
    s.add(d.file);
    if (d.page && WORLD_PAGES[d.page].emissive) s.add(`${d.file}-e`);
    if (d.emissive && d.emissive !== true) s.add(d.emissive.file);
  }
  return [...s].sort();
}

/** The emissive file (no extension) of an asset, or null. */
export function worldEmissiveFile(id: WorldAssetId): string | null {
  const d = WORLD_ASSETS[id];
  if (!d.emissive) return null;
  return d.emissive === true ? `${d.file}-e` : d.emissive.file;
}

/** The ids a stratum uses (its own pieces plus the ones marked for every stratum). */
export function worldAssetsForStratum(s: StratumId): WorldAssetId[] {
  return defs.filter(d => d.strata.includes(s)).map(d => d.id);
}

/** The rock tile / band ids of a kit. */
export const rockTileId = (k: WorldKitId): WorldAssetId => `rock-${k}` as WorldAssetId;
export const rockBandId = (k: WorldKitId): WorldAssetId => `band-${k}` as WorldAssetId;

/** The ids the vertical slice (strata 0 and 1) needs, in load order. */
export const SLICE_ASSETS: readonly WorldAssetId[] = [
  'rock-surface', 'rock-shelter', 'band-surface', 'band-shelter', 'edge-rim', 'edge-ao', 'hub-vault', 'corridor-tile', 'railing', 'deck',
  'door-closed', 'stair-flight', 'rubble-c', 'tape', 'lamp-chandelier', 'lamp-tube', 'far-shelter', 'back-shelter', 'back-surface', 'fore-lip',
];
