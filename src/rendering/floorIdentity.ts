import { Texture } from 'pixi.js';
import type { BuildingInstance, BuildingType } from '../core/GameState';
import { isDistrict, isHall, roomSlots } from '../data/buildingDefs';
import { zoneForFloor } from '../data/zones';
import { rgba } from './draw';

/**
 * [plan4:ST-11] Floor identity: every level of the bunker gets a kind, and the kind (with the depth) sets the colour of its concrete, the colour of its lamps,
 * a paint band on its columns and the number on its end posts; a deterministic hash of the floor picks the column, slab and ceiling variant. Nothing here needs a
 * new painting: the kit stays the same, the pieces are tinted and a few small overlay textures (made in code, once) are laid on top.
 *
 * Kinds: living | agri | engineering | industrial | research | deep-a | deep-b | surface. The three founding levels keep their zone; levels below
 * them take the kind of the rooms that fill most of them, an empty or unclassified one takes its depth (deep-a down to level 9, deep-b below that).
 * Style rule 4 (saturation is reserved): every tint stays close to white, the lamp colours are blended into the lamps' own, never replace them.
 */

export type FloorKind = 'living' | 'agri' | 'engineering' | 'industrial' | 'research' | 'deep-a' | 'deep-b' | 'surface';

/** Which kind each room type votes for (a type missing here votes for nothing: it takes on the look of its floor). */
const VOTE: Partial<Record<BuildingType, FloorKind>> = {
  quarters: 'living', canteen: 'living', commons: 'living', barracks: 'living', atrium: 'living',
  farm: 'agri', waterPump: 'agri', hydroponics: 'agri', waterPurifier: 'agri', mushroomFarm: 'agri', condenser: 'agri',
  workshop: 'engineering', recycler: 'engineering',
  generator: 'industrial', reactor: 'industrial', reactorHall: 'industrial', batteryBank: 'industrial', armory: 'industrial', trainingRoom: 'industrial', storage: 'industrial', gatePost: 'industrial',
  medbay: 'research', laboratory: 'research', radioTower: 'research', library: 'research',
};

/** Rooms that carry real weight or heat: the slab under their floor is the heavy girder variant. */
const HEAVY: ReadonlySet<BuildingType> = new Set<BuildingType>(['generator', 'reactor', 'reactorHall', 'batteryBank', 'recycler']);

export interface FloorStyle {
  kind: FloorKind;
  /** Multiplied into every lit piece of the floor (close to white). */
  tint: number;
  /** The colour of the kind's lamps (blended into the painted lamps' colours). */
  light: number;
  /** The paint band on the column caps and the ground of the number tag. */
  band: number;
  /** 0 plain steel column, 1 lattice-laced, 2 structural pipe. */
  col: 0 | 1 | 2;
  /** 0 plain slab, 1 heavy girder, 2 perforated plate. */
  slab: 0 | 1 | 2;
  /** 0 exposed pipe bundle, 1 ceiling panels hung under it. */
  ceil: 0 | 1;
  /** Short string of everything above, for the chunk signature. */
  key: string;
}

const BASE: Record<FloorKind, { tint: number; light: number; band: number }> = {
  living: { tint: 0xfff0dc, light: 0xffc878, band: 0xc9a25a },
  agri: { tint: 0xe4f2e0, light: 0xdfffb8, band: 0x4e8c84 },
  engineering: { tint: 0xf8e8d8, light: 0xffb070, band: 0xc46a2a },
  industrial: { tint: 0xe8e8ea, light: 0xffd890, band: 0xd29a30 },
  research: { tint: 0xdeecf6, light: 0xcfe6ff, band: 0x9fb4c8 },
  'deep-a': { tint: 0xe0e6ee, light: 0xd0e0ff, band: 0x6a7a8a },
  'deep-b': { tint: 0xd2d4dc, light: 0xff6048, band: 0xa8443a },
  surface: { tint: 0xffffff, light: 0xfff0d0, band: 0xd9c8a0 },
};

/** A repeatable pseudo-random number in [0, 1) from a floor and a salt (the same floor always dresses the same). */
export function floorHash(f: number, salt: number): number {
  let h = Math.imul(f + 211, 374761393) ^ Math.imul(salt * 977 + 31, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The kind of every floor 0..floors-1 and whether it holds heavy rooms. */
export function floorKinds(buildings: readonly BuildingInstance[], floors: number): { kind: FloorKind; heavy: boolean }[] {
  const out: { kind: FloorKind; heavy: boolean }[] = [];
  const votes: Map<FloorKind, number>[] = Array.from({ length: floors }, () => new Map());
  const heavy: boolean[] = new Array(floors).fill(false);
  for (const b of buildings) {
    if (isDistrict(b.type) || (b.isConstructing && b.level === 1)) continue;
    const k = VOTE[b.type];
    const f = b.position.floor;
    if (f < 0 || f >= floors) continue;
    if (k) votes[f].set(k, (votes[f].get(k) ?? 0) + roomSlots(b.type));
    if (HEAVY.has(b.type) || isHall(b.type)) heavy[f] = true;
  }
  for (let f = 0; f < floors; f++) {
    const z = zoneForFloor(f);
    let kind: FloorKind;
    if (z.id !== 'deep') kind = z.id === 'living' ? 'living' : z.id === 'agri' ? 'agri' : 'engineering';
    else {
      let best: FloorKind | null = null;
      for (const [k, w] of votes[f]) if (!best || w > votes[f].get(best)!) best = k;
      kind = best ?? (f < 9 ? 'deep-a' : 'deep-b');
    }
    out.push({ kind, heavy: heavy[f] });
  }
  return out;
}

/** The look of one floor: its kind's palette (drifting toward deep-b with depth) and the variants its hash picked. */
export function floorStyle(kind: FloorKind, f: number, heavy: boolean): FloorStyle {
  const b = BASE[kind];
  // Below the ninth level every kind slides a little toward the cold, dark deep-b look (a third of the way at level 24).
  const deepK = kind === 'surface' ? 0 : Math.max(0, Math.min(0.34, (f - 6) / 50));
  const tint = deepK > 0 ? mixRgb(b.tint, BASE['deep-b'].tint, deepK) : b.tint;
  const hc = floorHash(f, 1), hs = floorHash(f, 2), hl = floorHash(f, 3);
  // Columns: mostly plain, the deep levels take more lattice, the plant levels take the structural pipe.
  const latticeAt = kind === 'deep-a' || kind === 'deep-b' || kind === 'industrial' ? 0.4 : 0.2;
  const pipeAt = latticeAt + (kind === 'agri' || kind === 'engineering' ? 0.3 : 0.15);
  const col: 0 | 1 | 2 = hc < latticeAt ? 1 : hc < pipeAt ? 2 : 0;
  const perfAt = kind === 'engineering' || kind === 'industrial' || kind === 'deep-a' || kind === 'deep-b' ? 0.45 : 0.15;
  const slab: 0 | 1 | 2 = heavy || kind === 'industrial' ? (hs < 0.8 ? 1 : 0) : hs < perfAt ? 2 : 0;
  const ceil: 0 | 1 = (kind === 'living' || kind === 'research' || kind === 'agri') && hl < 0.4 ? 1 : 0;
  return { kind, tint, light: b.light, band: b.band, col, slab, ceil, key: `${kind}${f >= 6 ? Math.round(deepK * 100) : ''}.${col}${slab}${ceil}` };
}

/** Every floor's style. */
export function floorStyles(buildings: readonly BuildingInstance[], floors: number): FloorStyle[] {
  return floorKinds(buildings, floors).map((k, f) => floorStyle(k.kind, f, k.heavy));
}

const mixRgb = (a: number, b: number, t: number): number => {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

/** `color` multiplied channel by channel with `mul` (0xffffff = unchanged). */
export function mulTint(color: number, mul: number): number {
  if (mul === 0xffffff) return color;
  const m = (x: number, y: number) => Math.round((x * y) / 255);
  return (m((color >> 16) & 255, (mul >> 16) & 255) << 16) | (m((color >> 8) & 255, (mul >> 8) & 255) << 8) | m(color & 255, mul & 255);
}

/** A lamp colour pulled toward the kind's light (a third of the way: the painted lamp stays the main source). */
export function kindLight(lamp: number, kindLightColor: number, k = 0.35): number {
  return mixRgb(lamp, kindLightColor, k);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Overlay textures (painted in code once; world size in units, canvases are 4x for the close zoom)
// ---------------------------------------------------------------------------------------------------------------------------------

const R = 4;
const cache = new Map<string, Texture>();

function tex(key: string, w: number, h: number, paint: (g: CanvasRenderingContext2D, W: number, H: number) => void): Texture {
  let t = cache.get(key);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * R);
    c.height = Math.ceil(h * R);
    const g = c.getContext('2d')!;
    paint(g, c.width, c.height);
    t = Texture.from(c);
    cache.set(key, t);
  }
  return t;
}

/** Lattice-laced steel column (9 x 100): two flats zig-zagging between the flanges, gusset plates and rivets every 50 units. */
export function latticeTexture(): Texture {
  return tex('lattice', 9, 100, (g, W, H) => {
    // Flanges down both edges, lit on the left.
    const fl = g.createLinearGradient(0, 0, W, 0);
    fl.addColorStop(0, 'rgba(176,180,184,0.95)');
    fl.addColorStop(0.18, 'rgba(120,124,128,0.95)');
    fl.addColorStop(0.5, 'rgba(40,42,44,0.55)');
    fl.addColorStop(0.82, 'rgba(96,100,104,0.95)');
    fl.addColorStop(1, 'rgba(58,60,64,0.95)');
    g.fillStyle = fl;
    g.fillRect(0, 0, W, H);
    // The openings between the flats are dark (the room shows through).
    g.fillStyle = 'rgba(8,8,10,0.62)';
    g.fillRect(W * 0.2, 0, W * 0.6, H);
    // Zig-zag flats.
    const step = 11 * R;
    for (let y = -step; y < H; y += step) {
      g.fillStyle = 'rgba(132,136,140,0.96)';
      g.beginPath();
      g.moveTo(W * 0.2, y);
      g.lineTo(W * 0.8, y + step * 0.5);
      g.lineTo(W * 0.8, y + step * 0.5 + 1.7 * R);
      g.lineTo(W * 0.2, y + 1.7 * R);
      g.fill();
      g.beginPath();
      g.moveTo(W * 0.8, y + step * 0.5);
      g.lineTo(W * 0.2, y + step);
      g.lineTo(W * 0.2, y + step + 1.7 * R);
      g.lineTo(W * 0.8, y + step * 0.5 + 1.7 * R);
      g.fill();
      g.fillStyle = 'rgba(222,224,220,0.3)';
      g.fillRect(W * 0.2, y + 0.2 * R, W * 0.6, 0.3 * R);
    }
    // Gusset plates with rivets, rust under them.
    for (const y of [4, 50, 94]) {
      g.fillStyle = 'rgba(88,92,96,1)';
      g.fillRect(0, (y - 3) * R, W, 6 * R);
      g.fillStyle = 'rgba(190,194,196,0.45)';
      g.fillRect(0, (y - 3) * R, W, 0.8 * R);
      g.fillStyle = 'rgba(0,0,0,0.4)';
      g.fillRect(0, (y + 2.2) * R, W, 0.8 * R);
      for (const x of [1.8, 4.5, 7.2]) {
        g.fillStyle = 'rgba(30,30,32,0.9)';
        g.beginPath(); g.arc(x * R, y * R, 0.7 * R, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = 'rgba(122,64,28,0.22)';
      g.fillRect(2 * R, (y + 3) * R, 1.2 * R, 6 * R);
    }
  });
}

/** Structural pipe column (9 x 100): a round pipe with flange collars and bolts, rust weeping from the lower collars. */
export function pipeColumnTexture(): Texture {
  return tex('pipecol', 9, 100, (g, W, H) => {
    const body = g.createLinearGradient(0, 0, W, 0);
    body.addColorStop(0, 'rgba(46,52,50,1)');
    body.addColorStop(0.22, 'rgba(150,158,150,1)');
    body.addColorStop(0.42, 'rgba(112,120,114,1)');
    body.addColorStop(0.8, 'rgba(48,54,52,1)');
    body.addColorStop(1, 'rgba(26,30,28,1)');
    g.fillStyle = body;
    g.fillRect(0.6 * R, 0, W - 1.2 * R, H);
    // A soft specular streak and a dark seam.
    g.fillStyle = 'rgba(236,240,230,0.28)';
    g.fillRect(2.2 * R, 0, 0.9 * R, H);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(5.8 * R, 0, 0.5 * R, H);
    for (const y of [8, 36, 64, 92]) {
      const col = g.createLinearGradient(0, 0, W, 0);
      col.addColorStop(0, 'rgba(70,76,72,1)');
      col.addColorStop(0.3, 'rgba(176,182,172,1)');
      col.addColorStop(1, 'rgba(40,44,42,1)');
      g.fillStyle = col;
      g.fillRect(0, (y - 2.2) * R, W, 4.4 * R);
      g.fillStyle = 'rgba(0,0,0,0.38)';
      g.fillRect(0, (y + 1.6) * R, W, 0.7 * R);
      for (const x of [1.5, 4.5, 7.5]) {
        g.fillStyle = 'rgba(28,30,28,0.9)';
        g.beginPath(); g.arc(x * R, y * R, 0.55 * R, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = 'rgba(122,64,28,0.2)';
      g.fillRect((2.5 + (y % 3)) * R, (y + 2.4) * R, 1.1 * R, 7 * R);
    }
  });
}

/** Heavy girder face for a slab segment (46 x 19): a dark plate between two thick flanges, stiffener ribs, rivet rows. */
export function heavySlabTexture(): Texture {
  return tex('slab-heavy', 46, 19, (g, W, H) => {
    const plate = g.createLinearGradient(0, 0, 0, H);
    plate.addColorStop(0, 'rgba(92,92,90,0.96)');
    plate.addColorStop(0.5, 'rgba(52,52,52,0.96)');
    plate.addColorStop(1, 'rgba(30,30,32,0.98)');
    g.fillStyle = plate;
    g.fillRect(0, 0, W, H);
    // Upper flange, lit on its top edge; the lower one is thicker and throws a dark edge.
    g.fillStyle = 'rgba(140,140,136,0.9)';
    g.fillRect(0, 0.6 * R, W, 3.4 * R);
    g.fillStyle = 'rgba(232,228,214,0.42)';
    g.fillRect(0, 0.6 * R, W, 0.8 * R);
    g.fillStyle = 'rgba(74,74,72,0.95)';
    g.fillRect(0, 14.2 * R, W, 4.4 * R);
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(0, 18 * R, W, 1 * R);
    // Stiffeners and rivets.
    for (let x = 0; x < 46; x += 11.5) {
      g.fillStyle = 'rgba(104,104,100,0.95)';
      g.fillRect((x + 0.4) * R, 4 * R, 2.2 * R, 10 * R);
      g.fillStyle = 'rgba(210,206,194,0.25)';
      g.fillRect((x + 0.4) * R, 4 * R, 0.6 * R, 10 * R);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect((x + 2.6) * R, 4 * R, 0.6 * R, 10 * R);
    }
    for (let x = 3; x < 46; x += 5.75) {
      g.fillStyle = 'rgba(26,26,26,0.85)';
      g.beginPath(); g.arc(x * R, 2.4 * R, 0.55 * R, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(x * R, 16.4 * R, 0.55 * R, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = 'rgba(122,64,28,0.24)';
    g.fillRect(9 * R, 8 * R, 1.4 * R, 6 * R);
    g.fillRect(31 * R, 6 * R, 1.2 * R, 8 * R);
  });
}

/** Perforated steel plate for a slab segment (23 x 19, tiles sideways): a row of round holes with a lit lower lip. */
export function perforatedSlabTexture(): Texture {
  return tex('slab-perf', 23, 19, (g, W, H) => {
    g.fillStyle = 'rgba(66,68,66,0.94)';
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(150,150,144,0.7)';
    g.fillRect(0, 0.6 * R, W, 1.4 * R);
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.fillRect(0, 17.6 * R, W, 1.4 * R);
    for (const y of [7, 12.5]) {
      for (let x = 3.2; x < 23; x += 5.75) {
        g.fillStyle = 'rgba(8,8,10,0.92)';
        g.beginPath(); g.ellipse(x * R, y * R, 1.55 * R, 1.55 * R, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(214,210,196,0.34)';
        g.beginPath(); g.ellipse(x * R, (y + 1.35) * R, 1.3 * R, 0.4 * R, 0, 0, Math.PI); g.fill();
      }
    }
  });
}

/** Ceiling panels hung under the pipe bundle (23 x 11, tiles sideways): pale acoustic tiles with dark seams, one water stain. */
export function ceilingPanelTexture(): Texture {
  return tex('ceil-panel', 23, 11, (g, W, H) => {
    const p = g.createLinearGradient(0, 0, 0, H);
    p.addColorStop(0, 'rgba(120,116,104,0.97)');
    p.addColorStop(1, 'rgba(84,80,72,0.97)');
    g.fillStyle = p;
    g.fillRect(0, 0, W, H);
    // Grain of the board.
    for (let n = 0; n < 60; n++) {
      g.fillStyle = n % 2 ? 'rgba(0,0,0,0.12)' : 'rgba(236,230,214,0.1)';
      g.fillRect(((n * 37) % 100) / 100 * W, ((n * 53) % 100) / 100 * H, 0.7 * R, 0.5 * R);
    }
    g.fillStyle = 'rgba(14,12,10,0.75)';
    g.fillRect(0, 0, 0.7 * R, H);
    g.fillRect(0, 9.6 * R, W, 1.4 * R);
    g.fillStyle = 'rgba(236,230,214,0.2)';
    g.fillRect(0, 0, W, 0.5 * R);
    g.fillStyle = 'rgba(96,70,36,0.22)';
    g.beginPath(); g.ellipse(14 * R, 5 * R, 3.2 * R, 2.2 * R, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(96,70,36,0.18)';
    g.beginPath(); g.ellipse(14.5 * R, 5.4 * R, 1.8 * R, 1.2 * R, 0, 0, Math.PI * 2); g.fill();
  });
}

/**
 * The floor number on an enamel tag (16 x 9): "B3" in dark letters on the kind's paint colour, a bolt in each corner. Cached by number and band colour
 * (a floor's tag never changes; there are at most 24 of them).
 */
export function floorNumberTexture(f: number, band: number): Texture {
  return tex(`tag${f}.${band}`, 16, 9, (g, W, H) => {
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(0.5 * R, 0.9 * R, W - 0.5 * R, H - 0.9 * R);
    const plate = g.createLinearGradient(0, 0, 0, H);
    plate.addColorStop(0, rgba(band, 1));
    plate.addColorStop(1, rgba(band, 0.8));
    g.fillStyle = plate;
    g.fillRect(0, 0, W - 0.5 * R, H - 0.9 * R);
    g.fillStyle = 'rgba(255,248,230,0.3)';
    g.fillRect(0, 0, W - 0.5 * R, 0.6 * R);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(0, H - 1.5 * R, W - 0.5 * R, 0.6 * R);
    for (const [x, y] of [[1.2, 1.2], [14, 1.2], [1.2, 6.2], [14, 6.2]]) {
      g.fillStyle = 'rgba(30,26,22,0.8)';
      g.beginPath(); g.arc(x * R, y * R, 0.45 * R, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = 'rgba(28,24,20,0.9)';
    g.font = `800 ${5.6 * R}px Rubik, "Arial Black", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(`B${f + 1}`, (W - 0.5 * R) / 2, (H - 0.9 * R) / 2 + 0.2 * R);
  });
}
