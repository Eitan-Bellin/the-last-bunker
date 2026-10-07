import { Container, Graphics, Rectangle, Sprite, Text, TextStyle, Texture, TilingSprite } from 'pixi.js';
import type { BuildingInstance } from '../core/GameState';
import { getDef, isDistrict, isHall, roomSlots } from '../data/buildingDefs';
import { needsWater, zoneForFloor } from '../data/zones';
import { BASE_EAST, BUILDING_W, DEPTH_TOP, DEPTH_X, ROOMS_W, ROOMS_X, ROOM_H, SHAFT_GAP, SHAFT_W, SLAB, SLOT_W, TOPSOIL, districtXAt, floorTop, slotX, type Ext } from './layout';
import { block, hGradient, seeded, shade, softGlow, vGradient } from './draw';
import { lineWidth, richLine } from './richText';
import { steelTag } from './signage';
import { FlowBeads } from './perfFx';
import { GFX } from './gfxFeatures';
import { buildStrata } from './strata';

export const WORLD_LEFT = -260;
/** Right edge of the painted panorama's own span (the painting is scaled to this width, never to the wider world). */
export const PAINT_RIGHT = BUILDING_W + 260;
/** The surface carries on east of the bunker for the big projects' lots (src/rendering/projectSites.ts). */
export const SURFACE_EAST = 1500;
export const WORLD_RIGHT = PAINT_RIGHT + SURFACE_EAST;
export const SKY_TOP = -300;

/**
 * [plan4:ST-4] The world's west edge for a bunker whose widest west wing is `maxW` slots: the classic WORLD_LEFT, or 260 units beyond the wing's
 * outer wall. The rock, the topsoil, the ground line and the surface's dark edge all start here, so a wing never ends against empty sky.
 * (The east side needs no such help: the surface already runs 1500 units past the bunker for the project lots, wider than the 22-slot cap.)
 */
export function worldLeft(maxW: number): number {
  return Math.min(WORLD_LEFT, slotX(-maxW) - 260);
}
const ENTRANCE_H = 52;

const signStyle = new TextStyle({ fontFamily: 'Rubik, sans-serif', fontSize: 11, fontWeight: '700', fill: 0xf2e6c8 });

export interface Animated {
  container: Container;
  animate: (t: number, power: number) => void;
}

/**
 * Everything above ground: the era's painted panorama (or a drawn skyline while it loads),
 * rubble and the bunker's entrance block.
 */
export function buildSurface(backdrop: Texture | null = null, rayTexture: Texture | null = null, rayColor = 0xffe2b8, left = WORLD_LEFT): Animated {
  const root = new Container();
  const g = new Graphics();
  const rnd = seeded(77);
  const w = WORLD_RIGHT - left; // [plan4:ST-4]
  // Volumetric light: slow sun shafts falling through the haze over the ruins.
  const rays = new Container();
  rays.blendMode = 'add';
  const shafts: { s: Sprite; base: number; ph: number }[] = [];
  if (rayTexture) {
    for (let i = 0; i < 6; i++) {
      const s = new Sprite(rayTexture);
      s.anchor.set(0.5, 0);
      s.tint = rayColor;
      s.width = 70 + rnd() * 90;
      s.height = 340;
      const base = -0.5 + rnd() * 0.35;
      s.rotation = base;
      s.position.set(BUILDING_W * (0.35 + rnd() * 0.7), SKY_TOP - 40);
      s.alpha = 0;
      rays.addChild(s);
      shafts.push({ s, base, ph: rnd() * 10 });
    }
  }

  const sun = new Graphics();
  let painted: Sprite | null = null;
  if (backdrop) {
    // The painting's horizon sits ~80% down; anchor it just below ground level.
    painted = new Sprite(backdrop);
    const scale = (PAINT_RIGHT - WORLD_LEFT + 40) / backdrop.width;
    painted.scale.set(scale);
    painted.position.set(WORLD_LEFT - 20, -backdrop.height * scale * 0.84);
    g.rect(left, SKY_TOP - 400, w, painted.y - SKY_TOP + 404).fill(0x0c0b10);
  } else {
    g.rect(left, SKY_TOP, w, -SKY_TOP).fill(vGradient([[0, 0x14101e], [0.55, 0x3a2430], [0.85, 0x7a4a2e], [1, 0x9a6a3a]]));
    softGlow(sun, BUILDING_W * 0.78, -150, 170, 120, 0xff8a4a, 0.35);
    sun.circle(BUILDING_W * 0.78, -150, 26).fill({ color: 0xffb070, alpha: 0.55 });
    sun.blendMode = 'add';
  }

  // Two layers of ruined skyline (only while the painted panorama is missing).
  for (const [layer, base, color] of (backdrop ? [] : [[0, -110, 0x2a1e24], [1, -60, 0x1c1418]]) as [number, number, number][]) {
    let x = left;
    while (x < WORLD_RIGHT) {
      const bw = 26 + rnd() * 50;
      const bh = (layer ? 30 : 60) + rnd() * (layer ? 50 : 90);
      const top = base - bh + (layer ? 60 : 110);
      const broken = rnd() * 14;
      g.poly([x, 0, x, top + broken, x + bw * 0.3, top, x + bw * 0.55, top + broken * 1.4, x + bw, top + 4, x + bw, 0]).fill(color);
      if (layer === 0) {
        for (let wy = top + 10; wy < -10; wy += 12) {
          for (let wx = x + 5; wx < x + bw - 6; wx += 9) {
            if (rnd() < 0.12) g.rect(wx, wy, 3, 4).fill({ color: 0xffb060, alpha: 0.35 });
          }
        }
      }
      x += bw + rnd() * 8;
    }
  }
  // Ground line with rubble, a dead tree and a wrecked car.
  g.rect(left, -8, w, 10).fill(0x4a3a2a);
  for (let i = 0; i < 70; i++) {
    const x = left + rnd() * w, s = 2 + rnd() * 6;
    g.poly([x, -6, x + s, -6 - s * 0.7, x + s * 2, -6]).fill(shade(0x6a5a48, 0.7 + rnd() * 0.5));
  }
  const tx = BUILDING_W - 60;
  g.moveTo(tx, -6).lineTo(tx + 4, -60).stroke({ color: 0x2a201a, width: 5 });
  g.moveTo(tx + 3, -40).lineTo(tx + 22, -58).stroke({ color: 0x2a201a, width: 3 });
  g.moveTo(tx + 3, -48).lineTo(tx - 16, -66).stroke({ color: 0x2a201a, width: 2.5 });
  const cx = BUILDING_W * 0.45;
  g.roundRect(cx, -24, 62, 16, 4).fill(0x5a3a2a);
  g.roundRect(cx + 12, -36, 34, 14, 4).fill(0x4a2e22);
  g.circle(cx + 14, -7, 7).fill(0x1a1a1a);
  g.circle(cx + 48, -7, 7).fill(0x1a1a1a);
  g.rect(cx + 16, -33, 12, 8).fill({ color: 0x8ab0c8, alpha: 0.3 });

  // Entrance block above the shaft with the blast door.
  const ex = -14, ew = SHAFT_W + 70;
  block(g, ex, 0, ew, ENTRANCE_H, 0x6a6a70, 10, { shadow: false });
  for (let x = ex; x < ex + ew; x += 14) g.poly([x, -ENTRANCE_H + 6, x + 7, -ENTRANCE_H + 6, x + 4, -ENTRANCE_H + 11, x - 3, -ENTRANCE_H + 11]).fill(0xd9a441);
  const doorX = ex + ew / 2;
  g.circle(doorX, -22, 18).fill(0x3a3e44);
  g.circle(doorX, -22, 15).fill(0x7a8088);
  g.circle(doorX, -22, 5).fill(0x3a3e44);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    g.moveTo(doorX, -22).lineTo(doorX + Math.cos(a) * 14, -22 + Math.sin(a) * 14).stroke({ color: 0x4a4e54, width: 3 });
  }
  const plate = new Text({ text: 'BUNKER 17', style: { ...signStyle, fontSize: 9, fill: 0x1a1a1a }, resolution: 4 });
  plate.anchor.set(0.5);
  plate.position.set(doorX, -ENTRANCE_H + 18);
  // Antenna mast with a warning light.
  const mx = ex + ew - 12;
  g.rect(mx, -ENTRANCE_H - 70, 3, 70).fill(0x8a8f96);
  for (let y = -ENTRANCE_H - 66; y < -ENTRANCE_H; y += 12) g.moveTo(mx - 6, y + 10).lineTo(mx + 9, y).stroke({ color: 0x6a6f76, width: 1 });
  const beacon = new Graphics();
  beacon.circle(mx + 1.5, -ENTRANCE_H - 72, 3).fill(0xff3a3a);
  softGlow(beacon, mx + 1.5, -ENTRANCE_H - 72, 16, 16, 0xff3a3a, 0.6);
  beacon.blendMode = 'add';

  if (painted) root.addChild(painted);
  root.addChild(g, rays, sun, plate, beacon);
  if (painted) root.setChildIndex(painted, 0);
  return {
    container: root,
    animate: (t) => {
      beacon.alpha = Math.sin(t * 3) > 0.3 ? 1 : 0.15;
      for (const r of shafts) {
        r.s.rotation = r.base + Math.sin(t * 0.07 + r.ph) * 0.05;
        r.s.alpha = 0.06 + 0.07 * (0.5 + 0.5 * Math.sin(t * 0.21 + r.ph));
      }
    },
  };
}

/**
 * Earth cross-section (the painted rock strata when loaded), concrete casing, floor slabs, empty bays,
 * floor plaques, and the tunnels out to any districts.
 */
export function buildUnderground(
  floors: number, locale: string, gloom = 0.3, rock: Texture | null = null, districts: number[] = [], casing: Container | null = null,
  exts: readonly Ext[] = [], districtSlot: Readonly<Record<number, number>> = {},
): Container {
  const root = new Container();
  const g = new Graphics();
  const rnd = seeded(4242);
  const bottom = floorTop(floors) + 170;
  // [plan4:ST-4] The rock reaches further west only when a wing needs it (the plain bunker keeps the classic world edge).
  const maxW = exts.reduce((m, x) => Math.max(m, x.w), 0), maxE = exts.reduce((m, x) => Math.max(m, x.e), BASE_EAST);
  const WORLD_LEFT_U = worldLeft(maxW);
  const extOf = (f: number): Ext => exts[f] ?? { w: 0, e: BASE_EAST };
  const w = WORLD_RIGHT - WORLD_LEFT_U;
  // gfx-p0 light: the rock layers sit behind the casing (they used to darken it too), and the earth carries on
  // far below the dig as bedrock, so no empty navy shows under the bunker.
  const rockLayers = new Container();
  rockLayers.eventMode = 'none';
  const deep = bottom + 1100;

  // [plan4:ST-10] Five geology bands (src/rendering/strata.ts) replace the single stretched painting; `?gx=-strata` brings the old one back.
  const strataLayer = GFX.strata ? buildStrata(deep, WORLD_LEFT_U, WORLD_RIGHT, { rock }) : null;
  if (strataLayer) rockLayers.addChild(strataLayer);
  const painted = !!rock || !!strataLayer;
  const dk = strataLayer ? 0.8 : 1; // the bands carry their own depth shading
  if (rock && !strataLayer) {
    // The painting runs topsoil → clay → gravel → sandstone → bedrock; stretch it over the dug depth.
    const strataSprite = new TilingSprite({ texture: rock, width: w, height: bottom });
    const s = Math.max(0.3, bottom / rock.height);
    strataSprite.tileScale.set(s);
    strataSprite.position.set(WORLD_LEFT_U, 0);
    rockLayers.addChild(strataSprite);
    // Below: the painting's bedrock band again and again, mirrored at every seam.
    const fr = rock.frame;
    const band = new Texture({ source: rock.source, frame: new Rectangle(fr.x, fr.y + fr.height * 0.78, fr.width, fr.height * 0.22) });
    const bandH = band.height * s;
    for (let y = bottom, i = 0; y < deep; y += bandH, i++) {
      const row = new TilingSprite({ texture: band, width: w, height: bandH });
      row.tileScale.set(s);
      row.tilePosition.x = -i * 97;
      row.position.set(WORLD_LEFT_U, y);
      if (i % 2 === 0) {
        row.scale.y = -1;
        row.y += bandH;
      }
      rockLayers.addChild(row);
    }
  }
  const rockG = new Graphics();
  if (!painted) {
    const strata = [0x5a4430, 0x4a3828, 0x3e3226, 0x34302c, 0x2a2826, 0x201e1e];
    const bandH = bottom / strata.length;
    for (let i = 0; i < strata.length; i++) rockG.rect(WORLD_LEFT_U, i * bandH, w, bandH + 1).fill(strata[i]);
    rockG.rect(WORLD_LEFT_U, bottom, w, deep - bottom).fill(strata[strata.length - 1]);
  }
  // Lighter than before (the strata stayed near-black); deeper rock sinks cold and dark.
  rockG.rect(WORLD_LEFT_U, 0, w, bottom).fill(vGradient([[0, 0x000000, painted ? 0.1 * dk : 0], [0.7, 0x04060a, painted ? 0.28 * dk : 0.2], [1, 0x05070c, painted ? 0.46 * dk : 0.4]]));
  rockG.rect(WORLD_LEFT_U, bottom, w, deep - bottom).fill(vGradient([[0, 0x05070c, painted ? 0.46 * dk : 0.4], [0.35, 0x05070c, strataLayer ? 0.5 : 0.8], [1, 0x05070c, strataLayer ? 0.72 : 0.95]]));
  rockLayers.addChild(rockG);
  if (casing) rockLayers.addChild(rockDetails(floors, districts, exts));
  for (let i = 0; i < (painted ? 0 : 220); i++) {
    const x = WORLD_LEFT_U + rnd() * w, y = 8 + rnd() * (bottom - 20);
    const r = 1.5 + rnd() * 5;
    const pts: number[] = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const rr = r * (0.7 + rnd() * 0.5);
      pts.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.7);
    }
    g.poly(pts).fill({ color: shade(0x7a6a58, 0.6 + rnd() * 0.5), alpha: 0.5 });
  }
  for (let i = 0; i < (painted ? 0 : 14); i++) {
    const x = WORLD_LEFT_U + rnd() * w;
    g.moveTo(x, 2).bezierCurveTo(x + 6, 14, x - 5, 26, x + 3, 30 + rnd() * 20).stroke({ color: 0x2a1e16, width: 1.2, alpha: 0.7 });
  }

  // Tunnels through the east casing into each district, with the dug-out hollow around the cavern.
  for (let di = 0; di < districts.length; di++) {
    const f = districts[di];
    const top = floorTop(f);
    const dw = 4 * SLOT_W;
    // [plan4:ST-8] The tunnel runs from the end of the floor (its east casing) to the cavern, which sits wherever the district's own position says.
    const wallX = slotX(districtSlot[f] ?? BASE_EAST), dx = districtXAt(districtSlot[f] ?? BASE_EAST);
    const hollow: number[] = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      hollow.push(dx + dw / 2 + Math.cos(a) * (dw / 2 + 10 + rnd() * 6), top + ROOM_H / 2 + Math.sin(a) * (ROOM_H / 2 + 8 + rnd() * 5));
    }
    g.poly(hollow).fill({ color: 0x0c0a08, alpha: 0.85 });
    g.rect(wallX - 4, top + ROOM_H * 0.3, dx - wallX + 8, ROOM_H * 0.7).fill(0x100c0a);
    for (const x of [wallX + 2, dx - 4]) {
      g.rect(x, top + ROOM_H * 0.3, 3, ROOM_H * 0.7).fill(0x5a4026);
    }
    g.rect(wallX, top + ROOM_H * 0.3, dx - wallX + 2, 3).fill(0x5a4026);
    g.circle((wallX + dx) / 2, top + ROOM_H * 0.36, 1.6).fill(0xffc070);
  }

  // Concrete casing around the whole bunker (the painted kit draws its own when given).
  const casingTop = TOPSOIL - SLAB;
  const casingBottom = floorTop(floors) + 6;
  if (!casing) {
    const cx0 = (maxW > 0 ? slotX(-maxW) : 0) - 12, cw = slotX(maxE) + 12 - cx0;
    g.rect(cx0, casingTop - 4, cw, casingBottom - casingTop + 10).fill(0x55565c);
    g.rect(cx0, casingTop - 4, cw, 4).fill(0x7a7b80);
  }

  for (let f = 0; f < floors; f++) {
    const top = floorTop(f);
    const zone = zoneForFloor(f);
    // Empty excavated bay behind where rooms sit: east of the shaft, and west of it where the floor has a wing [plan4:ST-4].
    const fe = extOf(f);
    const eastX1 = slotX(fe.e);
    for (const [bx0, bx1] of [[ROOMS_X, eastX1], ...(fe.w > 0 ? [[slotX(-fe.w), -SHAFT_GAP]] : [])] as [number, number][]) {
      const bw = bx1 - bx0;
      g.rect(bx0, top, bw, ROOM_H).fill(vGradient([[0, shade(zone.rock, 0.85)], [1, shade(zone.rock, 0.55)]]));
      g.rect(bx0 + DEPTH_X, top + DEPTH_TOP, bw - 2 * DEPTH_X, ROOM_H - DEPTH_TOP - 16).fill({ color: 0x000000, alpha: 0.12 + gloom * 0.6 });
      for (let x = bx0 + SLOT_W; x < bx1; x += SLOT_W) g.rect(x - 1, top, 2, ROOM_H).fill({ color: 0x000000, alpha: 0.18 });
      g.poly([bx0 + DEPTH_X, top + ROOM_H - 16, bx1 - DEPTH_X, top + ROOM_H - 16, bx1, top + ROOM_H, bx0, top + ROOM_H])
        .fill(shade(zone.floorTile, 0.75));
    }
    // Floor slab under this level, with a hazard edge (the painted kit draws the slab in front of the rooms instead).
    if (!casing) {
      const sx0 = (fe.w > 0 ? slotX(-fe.w) : 0) - 12;
      g.rect(sx0, top + ROOM_H, eastX1 + 12 - sx0, SLAB).fill(vGradient([[0, 0x6e6f75], [1, 0x4a4b50]]));
      for (let x = ROOMS_X; x < eastX1; x += 18) g.rect(x, top + ROOM_H + 2, 9, 2).fill({ color: 0xd9a441, alpha: 0.65 });
      for (let x = fe.w > 0 ? sx0 + 6 : -6; x < eastX1 + 12; x += 30) g.circle(x, top + ROOM_H + SLAB - 4, 1.4).fill(0x3a3a3e);
    }
    // Level plaque on the shaft, and the zone name stencilled on the empty back wall.
    // [gfx2 signage] With the painted kit both live in signage.ts (enamel zone plate + spray stencil on the slab).
    if (casing) continue;
    const label = richLine(`B${f + 1} ${zone.icon}`, signStyle, 11, false, 4);
    const lw = lineWidth(label);
    const plate = new Graphics();
    plate.roundRect(-lw / 2 - 5, -9, lw + 10, 18, 3).fill(0x2a2620).stroke({ color: 0xd9a441, width: 1.2 });
    const sign = new Container();
    sign.addChild(plate, label);
    sign.position.set(SHAFT_W / 2 - 10, top + 12);
    const stencil = new Text({
      text: `B${f + 1} · ${zone.name[locale] ?? zone.name.en}`,
      style: { ...signStyle, fontSize: 22, fill: 0xd9c8a0 },
      resolution: 3,
    });
    stencil.alpha = 0.18;
    stencil.anchor.set(1, 0.5);
    stencil.position.set(eastX1 - 18, top + ROOM_H * 0.42);
    root.addChild(stencil, sign);
  }
  root.addChildAt(g, 0);
  if (casing) root.addChildAt(casing, 0);
  root.addChildAt(rockLayers, 0);
  return root;
}

let seepTex: Texture | null = null;

/** A soft vertical streak (wet run down the rock face). */
function seepTexture(): Texture {
  if (seepTex) return seepTex;
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const h = ctx.createLinearGradient(0, 0, 16, 0);
  h.addColorStop(0, 'rgba(255,255,255,0)');
  h.addColorStop(0.5, 'rgba(255,255,255,1)');
  h.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = h;
  ctx.fillRect(0, 0, 16, 128);
  ctx.globalCompositeOperation = 'destination-in';
  const v = ctx.createLinearGradient(0, 0, 0, 128);
  v.addColorStop(0, 'rgba(255,255,255,0.9)');
  v.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  v.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, 16, 128);
  seepTex = Texture.from(c);
  return seepTex;
}

/**
 * gfx-p0 light: life in the rock around the shell — roots reaching down under the soil, seepage running from
 * the backfill, and old conduits leaving the casing into the earth. Deterministic, drawn once per rebuild.
 */
function rockDetails(floors: number, districts: number[], exts: readonly Ext[] = []): Container {
  const root = new Container();
  const rnd = seeded(5150);
  const g = new Graphics();
  // [plan4:ST-6] The wall faces follow each floor's reach (a plain bunker: x -30 and BUILDING_W + 14 all the way down).
  const extOf = (f: number): Ext => exts[f] ?? { w: 0, e: BASE_EAST };
  const faceW = (x: Ext) => (x.w > 0 ? slotX(-x.w) - 14 : -30), faceE = (x: Ext) => slotX(x.e) + 14;
  const west = exts.reduce((m, x) => Math.min(m, faceW(x)), -30) - 10, east = exts.reduce((m, x) => Math.max(m, faceE(x)), BUILDING_W + 14) + 10;
  // Roots: tapering, wandering, with a few rootlets; thicker near the bunker where the soil was disturbed.
  for (let i = 0; i < 26; i++) {
    let x = WORLD_LEFT + 10 + rnd() * (WORLD_RIGHT - WORLD_LEFT - 20);
    if (x > west - 6 && x < east + 6) x = rnd() < 0.5 ? west - 8 - rnd() * 40 : east + 8 + rnd() * 40;
    let y = 46 + rnd() * 24;
    const n = 5 + Math.floor(rnd() * 5);
    const w0 = 1.2 + rnd() * 1.6;
    let dx = (rnd() - 0.5) * 2;
    for (let k = 0; k < n; k++) {
      dx = dx * 0.6 + (rnd() - 0.5) * 3.2;
      const nx = x + dx, ny = y + 7 + rnd() * 9;
      const wk = w0 * (1 - k / n) + 0.35;
      g.moveTo(x, y).lineTo(nx, ny).stroke({ color: 0x24180f, width: wk, alpha: 0.85, cap: 'round' });
      g.moveTo(x - wk * 0.25, y).lineTo(nx - wk * 0.25, ny).stroke({ color: 0x8a6a4a, width: wk * 0.3, alpha: 0.22, cap: 'round' });
      if (rnd() < 0.3) {
        const side = rnd() < 0.5 ? -1 : 1;
        g.moveTo(nx, ny).quadraticCurveTo(nx + side * 4, ny + 3, nx + side * (6 + rnd() * 6), ny + 6 + rnd() * 8)
          .stroke({ color: 0x24180f, width: Math.max(0.35, wk * 0.45), alpha: 0.7, cap: 'round' });
      }
      x = nx;
      y = ny;
    }
  }
  // Old conduits leaving the casing: rusty pipe runs with flanges, ending in an elbow or a broken stub.
  const conduit = (x0: number, y: number, len: number, dir: 1 | -1) => {
    const xa = dir > 0 ? x0 : x0 - len;
    g.rect(xa, y + 2, len, 3).fill({ color: 0x000000, alpha: 0.2 });
    g.rect(xa, y + 5, len, 3).fill({ color: 0x000000, alpha: 0.08 });
    g.rect(xa, y - 2, len, 4).fill(0x4a3426);
    g.rect(xa, y - 2, len, 1).fill({ color: 0xa07a58, alpha: 0.45 });
    g.rect(xa, y + 1.2, len, 0.8).fill({ color: 0x140c08, alpha: 0.6 });
    for (let x = 10; x < len - 4; x += 24 + rnd() * 8) {
      const fx = x0 + dir * x;
      g.rect(fx - 1, y - 3, 2, 6).fill(0x5a4232);
      g.rect(fx - 1, y - 3, 2, 0.8).fill({ color: 0xb08a66, alpha: 0.4 });
    }
    const end = x0 + dir * len;
    if (rnd() < 0.5) {
      // Elbow down into the dark.
      const drop = 14 + rnd() * 30;
      g.rect(end - 2, y - 2, 4, drop).fill(0x4a3426);
      g.rect(end - 2, y - 2, 1, drop).fill({ color: 0xa07a58, alpha: 0.35 });
      g.rect(end - 2, y + drop - 2, 4, 2).fill(0x2a1c14);
    } else {
      g.poly([end, y - 2, end + dir * 1.5, y - 1, end + dir * 0.4, y + 0.5, end + dir * 1.8, y + 2, end, y + 2]).fill(0x22160e);
    }
    // Rust weeping from the joints.
    for (let k = 0; k < 2; k++) g.rect(x0 + dir * (6 + rnd() * (len - 10)), y + 2, 0.8, 3 + rnd() * 8).fill({ color: 0x6a3a1c, alpha: 0.25 });
  };
  const levels = Array.from({ length: floors }, (_, f) => f);
  for (const f of levels) {
    if (rnd() < 0.5) conduit(faceW(extOf(f)) - 10, floorTop(f) + 18 + rnd() * 60, 30 + rnd() * 70, -1);
    if (!districts.includes(f) && rnd() < 0.25) conduit(faceE(extOf(f)) + 10, floorTop(f) + 20 + rnd() * 50, 20 + rnd() * 40, 1);
  }
  root.addChild(g);
  // Seepage: wet runs from the backfill down the rock, dark with a faint cold sheen.
  const seep = seepTexture();
  for (let i = 0; i < 3 + floors; i++) {
    const westSide = rnd() < 0.6;
    const x = westSide ? west - 2 - rnd() * 30 : east + 2 + rnd() * 30;
    const y = TOPSOIL + rnd() * (floorTop(floors) - TOPSOIL);
    const h = 60 + rnd() * 140;
    const wet = new Sprite(seep);
    wet.tint = 0x05080c;
    wet.alpha = 0.45;
    wet.width = 5 + rnd() * 7;
    wet.height = h;
    wet.position.set(x - wet.width / 2, y);
    const sheen = new Sprite(seep);
    sheen.tint = 0x8aa4b8;
    sheen.alpha = 0.08;
    sheen.blendMode = 'add';
    sheen.width = 1.6;
    sheen.height = h * 0.8;
    sheen.position.set(x - wet.width * 0.2, y + 2);
    root.addChild(wet, sheen);
  }
  return root;
}

/** Elevator shaft with risers, landings and a car that travels between floors. */
export function buildShaft(floors: number, onArrive?: () => void): Animated {
  const root = new Container();
  const g = new Graphics();
  const top = -ENTRANCE_H + 6;
  const bottomY = floorTop(floors - 1) + ROOM_H;
  g.rect(0, top, SHAFT_W, bottomY - top).fill(hGradient([[0, 0x1c1c22], [0.5, 0x2a2a32], [1, 0x18181e]]));
  for (const x of [6, SHAFT_W - 8]) g.rect(x, top, 2, bottomY - top).fill(0x5a5e66);
  // Risers: water, power, ventilation.
  g.rect(SHAFT_W - 20, top, 5, bottomY - top).fill(0x35587a);
  g.rect(SHAFT_W - 14, top, 3, bottomY - top).fill(0x151518);
  g.rect(SHAFT_W - 10, top, 6, bottomY - top).fill(0x6a6f76);
  for (let f = 0; f < floors; f++) {
    const y = floorTop(f);
    g.rect(0, y + ROOM_H - 3, SHAFT_W, 3).fill(0x7a7b80);
    g.rect(4, y + 18, SHAFT_W - 30, ROOM_H - 21).stroke({ color: 0xd9a441, width: 1.5, alpha: 0.6 });
  }
  const car = new Container();
  const cg = new Graphics();
  const carH = ROOM_H - 24;
  cg.rect(2, 0, SHAFT_W - 28, carH).fill(0x3a3e46);
  cg.rect(4, 2, SHAFT_W - 32, carH - 4).fill(0x5a5e66);
  for (let x = 8; x < SHAFT_W - 30; x += 6) cg.rect(x, 4, 1.5, carH - 8).fill(0x3a3e46);
  cg.rect(2, 0, SHAFT_W - 28, 4).fill(0xd9a441);
  const carLight = new Graphics();
  softGlow(carLight, (SHAFT_W - 26) / 2, 10, 20, 12, 0xfff0b0, 0.6);
  carLight.blendMode = 'add';
  car.addChild(cg, carLight);
  const cable = new Graphics();
  root.addChild(g, cable, car);

  let from = 0, to = 0, phase = 1, wait = 2, lastT = 0;
  const yFor = (f: number) => floorTop(f) + 21;
  car.y = yFor(0);
  return {
    container: root,
    animate: (t, power) => {
      const dt = lastT ? Math.min(0.1, t - lastT) : 0;
      lastT = t;
      if (phase >= 1) {
        wait -= dt;
        if (wait <= 0 && power > 0.3) {
          from = to;
          to = Math.floor(Math.random() * floors);
          phase = from === to ? 1 : 0;
          wait = 2 + Math.random() * 4;
        }
      } else {
        phase = Math.min(1, phase + dt * 0.5);
        const e = phase < 0.5 ? 2 * phase * phase : 1 - Math.pow(-2 * phase + 2, 2) / 2;
        car.y = yFor(from) + (yFor(to) - yFor(from)) * e;
        if (phase >= 1) onArrive?.();
      }
      cable.clear();
      cable.rect((SHAFT_W - 26) / 2, top, 1.5, car.y - top).fill(0x9aa0a8);
      carLight.alpha = 0.4 + 0.6 * power;
    },
  };
}

interface Run {
  y: number;
  x0: number;
  x1: number;
  kind: 'power' | 'water';
  drops: number[];
  gaps: number[][];
}

/** Ceiling-hung cable tray and water main along every floor, with drops into each room. */
export function buildUtilities(buildings: BuildingInstance[], floors: number, painted = false, exts: readonly Ext[] = []): Animated {
  const root = new Container();
  root.eventMode = 'none';
  const g = new Graphics();
  const runs: Run[] = [];

  for (let f = 0; f < floors; f++) {
    const top = floorTop(f);
    const onFloor = buildings.filter(b => b.position.floor === f && !(b.isConstructing && b.level === 1) && !isDistrict(b.type));
    // A two-storey hall from the level above leaves no ceiling here for the mains to hang from.
    const halls = buildings.filter(b => isHall(b.type) && b.position.floor === f - 1).map(b => [slotX(b.position.x), slotX(b.position.x) + roomSlots(b.type) * SLOT_W]);
    const powerDrops: number[] = [];
    const waterDrops: number[] = [];
    for (const b of onFloor) {
      const def = getDef(b.type);
      if (!def) continue;
      const x = slotX(b.position.x);
      if (def.powerConsumption > 0 || def.production?.power) powerDrops.push(x + DEPTH_X + 6);
      if (needsWater(b.type) || b.type === 'waterPump' || b.type === 'waterPurifier') waterDrops.push(x + DEPTH_X + 14);
    }
    const yP = top + 3, yW = top + 8;
    // Mains run the length of the level, broken only where a hall passes through; [plan4:ST-4] split at the shaft, so a west wing has its own run.
    const fe = exts[f] ?? { w: 0, e: BASE_EAST };
    const segments: [number, number][] = [];
    const sorted = [...halls].sort((a, b) => a[0] - b[0]);
    let start = SHAFT_W - 20;
    for (const [h0, h1] of sorted) {
      if (h1 <= start) continue;
      if (h0 > start) segments.push([start, h0]);
      start = Math.max(start, h1);
    }
    if (slotX(fe.e) + 6 > start) segments.push([start, slotX(fe.e) + 6]);
    if (fe.w > 0) {
      start = slotX(-fe.w) - 6;
      for (const [h0, h1] of sorted) {
        if (h0 >= 20 || h1 <= start) continue;
        if (h0 > start) segments.push([start, h0]);
        start = Math.max(start, h1);
      }
      if (20 > start) segments.push([start, 20]);
    }
    // With the painted kit the pipe bundle is a texture; only the drops into the rooms are drawn here.
    for (const [s0, s1] of painted ? [] : segments) {
      const p0 = Math.max(s0, SHAFT_W - 14);
      g.rect(p0, yP - 1, s1 - p0, 4).fill(0x151518);
      g.rect(p0, yP - 1, s1 - p0, 1).fill(0x4a4a52);
      g.rect(s0, yW - 2, s1 - s0, 5).fill(0x35587a);
      g.rect(s0, yW - 2, s1 - s0, 1.3).fill(0x8ab8e0);
    }
    const inHall = (x: number) => halls.some(([h0, h1]) => x >= h0 && x <= h1);
    if (!painted) for (let x = ROOMS_X + 20; x < slotX(fe.e); x += 46) if (!inHall(x)) g.rect(x, top, 1.5, 11).fill(0x7a7f86);
    for (const x of powerDrops) {
      g.rect(x - 1, yP + 2, 2.5, DEPTH_TOP + 8).fill(0x151518);
      g.roundRect(x - 3, yP + DEPTH_TOP + 8, 7, 5, 1).fill(0xd9a441);
    }
    for (const x of waterDrops) {
      g.rect(x - 1.5, yW + 3, 3.5, DEPTH_TOP + 4).fill(painted ? 0x3e4a40 : 0x35587a);
      if (painted) g.rect(x - 1.5, yW + 3, 1, DEPTH_TOP + 4).fill({ color: 0xa0a890, alpha: 0.35 });
      g.roundRect(x - 3, yW + DEPTH_TOP + 6, 8, 4, 1).fill(painted ? 0x5a5e52 : 0x4a7aa8);
    }
    const eastP = powerDrops.filter(x => x > 0), westP = powerDrops.filter(x => x < 0);
    const eastW = waterDrops.filter(x => x > 0), westW = waterDrops.filter(x => x < 0);
    if (eastP.length) runs.push({ y: yP + 1, x0: SHAFT_W - 12, x1: Math.max(...eastP), kind: 'power', drops: eastP, gaps: halls });
    if (westP.length) runs.push({ y: yP + 1, x0: Math.min(...westP) - 4, x1: 12, kind: 'power', drops: westP, gaps: halls });
    if (eastW.length && !painted) runs.push({ y: yW, x0: SHAFT_W - 18, x1: Math.max(...eastW), kind: 'water', drops: eastW, gaps: halls });
    if (westW.length && !painted) runs.push({ y: yW, x0: Math.min(...westW) - 4, x1: 18, kind: 'water', drops: westW, gaps: halls });
  }

  // The current along the mains: pooled sprites in view only (src/rendering/perfFx.ts), not circles redrawn every picture.
  const flow = new FlowBeads(runs.map(r => ({ y: r.y, x0: r.x0, x1: r.x1, kind: r.kind, gaps: r.gaps })), painted);
  root.addChild(g, flow.container);
  return {
    container: root,
    animate: (t, power) => flow.animate(t, power),
  };
}

/** Dashed outline of the next level with the dig prompt. */
export function buildDigSign(floors: number, text: string, cost: string, rock: Texture | null = null): Container {
  const root = new Container();
  const top = floorTop(floors);
  const g = new Graphics();
  if (rock) {
    // New look: the next level is a raw rock face behind warning tape, not a dashed box.
    for (let i = 0; i < 4; i++) {
      const s = new Sprite(rock);
      s.width = ROOMS_W / 4;
      s.height = ROOM_H;
      s.position.set(ROOMS_X + (i * ROOMS_W) / 4, top);
      if (i % 2) { s.scale.x *= -1; s.x += ROOMS_W / 4; }
      s.tint = 0x625c55;
      root.addChild(s);
    }
    const tape = (y: number, tilt: number) => {
      const t = new Graphics();
      t.rect(0, -2.5, ROOMS_W + 10, 5).fill(0xd9a441);
      for (let x = 0; x < ROOMS_W + 10; x += 10) t.poly([x, -2.5, x + 5, -2.5, x + 1, 2.5, x - 4, 2.5]).fill(0x1a1612);
      t.position.set(ROOMS_X - 5, y);
      t.rotation = tilt;
      t.alpha = 0.9;
      root.addChild(t);
    };
    tape(top + 14, 0.012);
    tape(top + ROOM_H - 18, -0.01);
    // [gfx2 signage] The same bolted steel as the room tags, with a worn hazard stripe.
    const plate = new Graphics();
    steelTag(plate, ROOMS_X + ROOMS_W / 2 - 80, top + ROOM_H / 2 - 26, 160, 50, { rivets: 4, stripe: true });
    root.addChild(plate);
    const label = richLine(`[[pick]] ${text}`, { ...signStyle, fontSize: 15 }, 16, true, 4);
    label.position.set(ROOMS_X + ROOMS_W / 2, top + ROOM_H / 2 - 5);
    const costText = richLine(cost, { ...signStyle, fontSize: 12, fill: 0xffd447 }, 13, false, 4);
    costText.position.set(ROOMS_X + ROOMS_W / 2, top + ROOM_H / 2 + 13);
    root.addChild(label, costText);
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = { contains: (x: number, y: number) => x >= ROOMS_X && x <= ROOMS_X + ROOMS_W && y >= top && y <= top + ROOM_H };
    return root;
  }
  for (let x = ROOMS_X; x < ROOMS_X + ROOMS_W; x += 14) {
    g.rect(x, top + 4, 8, 2).fill({ color: 0xd9a441, alpha: 0.7 });
    g.rect(x, top + ROOM_H - 6, 8, 2).fill({ color: 0xd9a441, alpha: 0.7 });
  }
  for (let y = top + 4; y < top + ROOM_H - 4; y += 14) {
    g.rect(ROOMS_X, y, 2, 8).fill({ color: 0xd9a441, alpha: 0.7 });
    g.rect(ROOMS_X + ROOMS_W - 2, y, 2, 8).fill({ color: 0xd9a441, alpha: 0.7 });
  }
  g.rect(ROOMS_X + 2, top + 6, ROOMS_W - 4, ROOM_H - 12).fill({ color: 0x000000, alpha: 0.25 });
  const label = richLine(`[[pick]] ${text}`, { ...signStyle, fontSize: 15 }, 16, true, 4);
  label.position.set(ROOMS_X + ROOMS_W / 2, top + ROOM_H / 2 - 9);
  const costText = richLine(cost, { ...signStyle, fontSize: 12, fill: 0xffd447 }, 13, false, 4);
  costText.position.set(ROOMS_X + ROOMS_W / 2, top + ROOM_H / 2 + 12);
  root.addChild(g, label, costText);
  root.eventMode = 'static';
  root.cursor = 'pointer';
  root.hitArea = { contains: (x: number, y: number) => x >= ROOMS_X && x <= ROOMS_X + ROOMS_W && y >= top && y <= top + ROOM_H };
  return root;
}

/** Dust motes drifting through the occupied floors: pooled sprites now, only those in view (src/rendering/perfFx.ts). */
export { Dust } from './perfFx';

export function roomWidth(b: BuildingInstance): number {
  return roomSlots(b.type) * SLOT_W;
}
