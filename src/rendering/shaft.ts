import { Container, Graphics, Sprite, TilingSprite, type Texture } from 'pixi.js';
import { ArtLibrary, glowTexture } from '../art/ArtLibrary';
import { FLOOR_H, GALLERY_H, ROOM_H, SHAFT_W, SLAB, floorAfterTravel, floorTop, galleryCount, galleryTop } from './layout';
import { seeded } from './draw';
import { depthGains, kitState, softTexture, type KitState } from './structure';
import type { Animated } from './world';
import { GFX } from './gfxFeatures';
import { labelState } from './LabelScale'; // [airy:B3]

/**
 * Graphics overhaul (G3, shaft): an industrial cage lift instead of the flat code-drawn shaft.
 * Concrete back wall, two steel guide rails, a riser bundle, the painted cage car on hoist cables,
 * a pulley housing with a turning sheave and a counterweight, and at every level a landing with a
 * collapsible gate that opens when the car stops there and an indicator lamp.
 * Static parts are built once; per frame only the car, cables, gates, sheave, counterweight and lamps move.
 */

const TOP = -46;
/** Car footprint in the shaft (the painting is stretched ~7% taller to read as a 2.2 m cabin). */
const CAR_X = 5;
const CAR_W = 48;
const CAR_H = 70;
/** Painted cabin lamp, relative to the car sprite. */
const LAMP_FX = 0.5;
const LAMP_FY = 0.14;
/** Sheave: car cables drop from its left edge, the counterweight hangs from its right edge. */
const SHEAVE_R = 8;
const SHEAVE_X = CAR_X + CAR_W / 2 + SHEAVE_R;
const SHEAVE_Y = TOP + 13;
const CW_W = 9;
const CW_H = 30;
const CW_TOP_MIN = TOP + 28;
const RAIL_W = 4;
const RAILS = [1, SHAFT_W - 1 - RAIL_W];
const DOOR_T = 0.4;
/** Landing: header above the door, gate leaves down to the floor lip. */
const HEADER_Y = 19;
const HEADER_H = 6;
const FLOOR_LIP = ROOM_H - 3;
const GATE_X0 = RAIL_W + 3;
const GATE_X1 = SHAFT_W - RAIL_W - 3;

// [plan4:ST-18] The lift as a service for walkers: a small ticket queue the car works through, and up to four riders drawn in the cabin.
// Behind the `walkers` feature flag: with it off the car does its old random trips and nobody rides.
export interface LiftApi {
  /** The car is serving walkers right now (feature on and power). */
  ready(): boolean;
  /** Asks for a ride between two floors. Returns a ticket (> 0), or 0 when the queue is full. */
  request(from: number, to: number): number;
  /** The car stands at the ticket's floor with its doors open and room (the same destination as those already aboard). */
  canBoard(ticket: number): boolean;
  /** Steps into the cabin: a rider figure appears (colours of shirt, skin and trousers). */
  board(ticket: number, shirt: number, skin: number, pants: number): void;
  /** The car has opened at the ticket's destination. */
  arrived(ticket: number): boolean;
  /** Steps out or gives up: frees the ticket and the seat. */
  release(ticket: number): void;
  /** [plan4:GP-6] Where the car is right now: the world y of its centre (the tour mode follows it). */
  carY(): number;
}

export type ShaftAnimated = Animated & { lift: LiftApi };

const SEATS = 4;
const TICKETS = 8;
/** How long the car holds its doors open after the last rider boarded before it leaves. */
const BOARD_DWELL = 1;
/** Seconds between the car's idle display trips while walkers are on (the old code made one every 2-6 s). */
const DISPLAY_TRIP_S = 90;

const STYLE: Record<KitState, { wall: number; steel: number; gate: number; cable: number; car: number; grime: number; speed: number; flicker: number }> = {
  R: { wall: 0x4c4a48, steel: 0x8a7a68, gate: 0x6a4e38, cable: 0x5a5650, car: 0xb4a48e, grime: 1, speed: 0.6, flicker: 0.35 },
  F: { wall: 0x5e5c5a, steel: 0x9a9a96, gate: 0x8a8a84, cable: 0x7a7c78, car: 0xd2ccc0, grime: 0.45, speed: 1, flicker: 0.08 },
  L: { wall: 0x6a6866, steel: 0xaeb0aa, gate: 0x9a9c94, cable: 0x8a8c88, car: 0xe8e4dc, grime: 0.15, speed: 1, flicker: 0 },
};

function tintAt(base: number, y: number): number {
  const [r, g, b] = depthGains(y);
  const c = (v: number, k: number) => Math.round(Math.max(0, Math.min(255, v * k)));
  return (c((base >> 16) & 0xff, r) << 16) | (c((base >> 8) & 0xff, g) << 8) | c(base & 0xff, b);
}

function kit(m: string, st: KitState): Texture | null {
  return ArtLibrary.get(`kit/${m}-${st}`) ?? ArtLibrary.get(`kit/${m}-F`);
}

/** A collapsible lattice gate leaf, drawn from x = 0 to w (it folds toward x = 0 by scaling). */
function gateLeaf(w: number, h: number, steel: number): Graphics {
  const g = new Graphics();
  const bars = 3;
  const step = w / bars;
  const P = 19;
  // Lattice X between the bars.
  for (let i = 0; i < bars; i++) {
    const x0 = i * step, x1 = x0 + step;
    for (let y = 3; y < h - 6; y += P) {
      const y1 = Math.min(h - 5, y + P);
      g.moveTo(x0, y).lineTo(x1, y1).moveTo(x1, y).lineTo(x0, y1);
    }
  }
  g.stroke({ color: 0x141513, width: 0.9, alpha: 0.8 });
  for (let i = 0; i < bars; i++) {
    const x0 = i * step, x1 = x0 + step;
    for (let y = 3; y < h - 6; y += P) {
      const y1 = Math.min(h - 5, y + P);
      g.moveTo(x0 + 0.3, y - 0.3).lineTo(x1 + 0.3, y1 - 0.3).moveTo(x1 - 0.3, y - 0.3).lineTo(x0 - 0.3, y1 - 0.3);
    }
  }
  g.stroke({ color: steel, width: 0.5, alpha: 0.5 });
  // Pivot rivets where the lattice crosses.
  for (let i = 0; i < bars; i++) for (let y = 3 + P / 2; y < h - 6; y += P) g.circle(i * step + step / 2, y, 0.7).fill({ color: steel, alpha: 0.7 });
  for (let i = 0; i <= bars; i++) {
    const x = Math.min(w - 0.8, i * step);
    g.rect(x - 0.6, 0, 1.3, h).fill(0x262724);
    g.rect(x - 0.6, 0, 0.6, h).fill({ color: steel, alpha: 0.45 });
  }
  // Top track shoe and kick rail.
  g.rect(0, 0, w, 2).fill(0x2a2b28);
  g.rect(0, h - 5, w, 5).fill(0x242522);
  g.rect(0, h - 5, w, 0.8).fill({ color: steel, alpha: 0.4 });
  return g;
}

export function buildShaft2(floors: number, era: number, onArrive?: () => void, westFloors: readonly boolean[] = [], zoneColors: readonly number[] = []): ShaftAnimated {
  const st = kitState(era);
  const S = STYLE[st];
  const root = new Container();
  root.eventMode = 'none';
  const rnd = seeded(1717 + era);
  const bottomY = floorTop(floors - 1) + ROOM_H;
  const glow = glowTexture();

  // ---------- Static back: wall, grime, risers, rails ----------
  const back = new Container();
  const wallTex = kit('wall', st);
  const colTex = kit('column', st);
  const pipeTex = kit('pipes', st);
  // The wall in floor-high bands so the depth fog can darken it level by level.
  const bands: [number, number][] = [[TOP, floorTop(0)]];
  for (let f = 0; f < floors; f++) bands.push([floorTop(f), floorTop(f) + ROOM_H + SLAB + (floorTop(f + 1) - floorTop(f) - FLOOR_H)]); // [plan4:ST-1] a gallery under the floor is part of the band: the shaft passes through it
  for (const [y0, y1] of bands) {
    if (wallTex) {
      const w = new TilingSprite({ texture: wallTex, width: SHAFT_W, height: y1 - y0 });
      w.position.set(0, y0);
      w.tileScale.set(56 / wallTex.width);
      w.tilePosition.set(-23, -y0 - 31);
      w.tint = tintAt(S.wall, (y0 + y1) / 2);
      back.addChild(w);
    } else {
      const g = new Graphics();
      for (let x = 0; x < SHAFT_W; x += 6) g.rect(x, y0, 6, y1 - y0).fill(tintAt(0x2a2a2c + ((x / 6) % 2) * 0x030303, (y0 + y1) / 2));
      back.addChild(g);
    }
  }
  const grime = new Graphics();
  // Side shadows: the shaft is a deep slot, its corners stay dark (gfx-p0 light: one smooth gradient each side).
  for (const right of [false, true]) {
    const side = new Sprite(softTexture('fadeH'));
    side.tint = 0x000000;
    side.alpha = GFX.airy ? 0.2 : 0.4; // [airy:B3] a lighter slot: the shaft is the spine, not a hole
    side.width = 12;
    side.height = bottomY - TOP;
    side.position.set(right ? SHAFT_W : 0, TOP);
    if (right) side.scale.x *= -1;
    back.addChild(side);
  }
  // Water stains and oil runs down the wall (more in the wrecked era).
  const stains = Math.round(6 + 26 * S.grime) * Math.max(1, floors / 3);
  for (let i = 0; i < stains; i++) {
    const x = 3 + rnd() * (SHAFT_W - 6), y = TOP + rnd() * (bottomY - TOP);
    const len = 8 + rnd() * 40 * (0.5 + S.grime);
    const w = 0.8 + rnd() * 2.2;
    for (let k = 0; k < 5; k++) {
      grime.rect(x + (rnd() - 0.5) * 0.8, y + (k * len) / 5, w * (1 - k * 0.12), len / 5 + 0.5).fill({ color: 0x0c0a08, alpha: (0.1 + 0.18 * S.grime) * (1 - k / 6) });
    }
  }
  for (let i = 0; i < Math.round(10 * S.grime * floors); i++) {
    const x = rnd() * SHAFT_W, y = TOP + rnd() * (bottomY - TOP);
    grime.ellipse(x, y, 3 + rnd() * 6, 2 + rnd() * 5).fill({ color: rnd() < 0.3 ? 0x2a3020 : 0x0a0908, alpha: 0.12 + rnd() * 0.12 });
  }
  back.addChild(grime);
  // [airy:B3] The spine: the shaft is lit from within (a warm lift over the whole wall, a light strip down each rail, bright jambs), the same at every
  // depth (it is not run through the fog), so from the surface to the bottom level the eye can follow one clear line that the floors hang from.
  if (GFX.airy) {
    const spine = new Graphics();
    spine.blendMode = 'add';
    spine.rect(0, TOP, SHAFT_W, bottomY - TOP).fill({ color: 0xffd9a0, alpha: 0.09 });
    spine.rect(0, TOP, SHAFT_W, bottomY - TOP).fill({ color: 0x504030, alpha: 0.1 });
    back.addChild(spine);
  }

  // Riser bundle (water, power, air) on the back wall, clamped at every level.
  const RISER_X = 8, RISER_W = 17;
  if (pipeTex) {
    const p = new TilingSprite({ texture: pipeTex, width: bottomY - TOP, height: RISER_W });
    p.tileScale.set(RISER_W / pipeTex.height);
    p.rotation = Math.PI / 2;
    p.position.set(RISER_X + RISER_W, TOP);
    p.tint = tintAt(st === 'R' ? 0xc0b4a0 : 0xffffff, (TOP + bottomY) / 2);
    back.addChild(p);
  } else {
    const g = new Graphics();
    g.rect(RISER_X, TOP, 4, bottomY - TOP).fill(0x3a4048);
    g.rect(RISER_X + 5, TOP, 5, bottomY - TOP).fill(0x4a4a46);
    back.addChild(g);
  }
  const clamps = new Graphics();
  for (let f = 0; f < floors; f++) {
    for (const cy of [floorTop(f) + 30, floorTop(f) + 78]) {
      clamps.rect(RISER_X - 1.5, cy, RISER_W + 3, 3).fill(0x1c1c1a);
      clamps.rect(RISER_X - 1.5, cy, RISER_W + 3, 0.8).fill({ color: 0x8a8a84, alpha: 0.35 });
      clamps.circle(RISER_X - 0.5, cy + 1.5, 0.7).fill(0x6a6a64);
      clamps.circle(RISER_X + RISER_W + 0.5, cy + 1.5, 0.7).fill(0x6a6a64);
    }
  }
  back.addChild(clamps);

  // [plan4:ST-1] Where a service gallery crosses the shaft: a girder pair behind the car, a hatch on the back wall and an amber lamp (the car passes in front).
  for (let g = 0; g < galleryCount(floors); g++) {
    const y0 = galleryTop(g);
    const sg = new Graphics();
    sg.rect(1, y0 + 3, SHAFT_W - 2, 5).fill(tintAt(0x24241f, y0));
    sg.rect(1, y0 + 3, SHAFT_W - 2, 1).fill({ color: 0xa09a8a, alpha: 0.3 });
    sg.rect(1, y0 + GALLERY_H - 7, SHAFT_W - 2, 5).fill(tintAt(0x24241f, y0));
    for (let x = 3; x < SHAFT_W - 4; x += 8) sg.poly([x, y0 + GALLERY_H - 7, x + 4, y0 + GALLERY_H - 7, x + 1, y0 + GALLERY_H - 2, x - 3, y0 + GALLERY_H - 2]).fill({ color: 0xd9a441, alpha: 0.5 });
    sg.rect(SHAFT_W - 22, y0 + 10, 14, 16).fill(tintAt(0x1a1b1c, y0));
    sg.rect(SHAFT_W - 22, y0 + 10, 14, 1).fill({ color: 0x9a9a92, alpha: 0.3 });
    sg.circle(SHAFT_W - 9, y0 + 18, 1.6).fill(0xffb050);
    back.addChild(sg);
    const lampHalo = new Sprite(glow);
    lampHalo.anchor.set(0.5);
    lampHalo.tint = 0xffa24a;
    lampHalo.blendMode = 'add';
    lampHalo.alpha = 0.55;
    lampHalo.width = 34;
    lampHalo.height = GALLERY_H * 1.1;
    lampHalo.position.set(SHAFT_W - 9, y0 + 18);
    back.addChild(lampHalo);
  }

  // Guide rails: steel columns in floor-long lengths joined by fishplates.
  const rails = new Container();
  for (const rx of RAILS) {
    for (const [y0, y1] of bands) {
      if (colTex) {
        const r = new TilingSprite({ texture: colTex, width: RAIL_W, height: y1 - y0 });
        r.position.set(rx, y0);
        r.tileScale.set((RAIL_W * 2.2) / colTex.width);
        r.tilePosition.set(-RAIL_W * 0.6, -y0);
        r.tint = tintAt(S.steel, (y0 + y1) / 2);
        rails.addChild(r);
      } else {
        const g = new Graphics();
        g.rect(rx, y0, RAIL_W, y1 - y0).fill(tintAt(0x5a5e66, (y0 + y1) / 2));
        rails.addChild(g);
      }
    }
  }
  const plates = new Graphics();
  for (const rx of RAILS) {
    for (const [, y] of bands) {
      plates.rect(rx - 1, y - 5, RAIL_W + 2, 10).fill(0x1e1f1d);
      plates.rect(rx - 1, y - 5, RAIL_W + 2, 1).fill({ color: 0x9a9a92, alpha: 0.3 });
      for (const by of [y - 3, y + 3]) plates.circle(rx + RAIL_W / 2, by, 0.8).fill(0x7a7a72);
    }
  }
  rails.addChild(plates);

  // ---------- Moving parts ----------
  const cw = new Container();
  const cwg = new Graphics();
  for (let i = 0; i < 6; i++) {
    const y = i * (CW_H / 6);
    cwg.rect(0, y, CW_W, CW_H / 6 - 0.6).fill(i % 2 ? 0x2c2d2a : 0x343531);
    cwg.rect(0, y, CW_W, 0.7).fill({ color: 0x9a9a90, alpha: 0.25 });
  }
  cwg.rect(-1, -2, CW_W + 2, 3).fill(0x1a1a18);
  cwg.rect(-1, CW_H - 1, CW_W + 2, 3).fill(0x1a1a18);
  cwg.rect(CW_W / 2 - 0.8, -4, 1.6, 3).fill(0x4a4a46);
  cw.addChild(cwg);
  cw.x = SHEAVE_X + SHEAVE_R - CW_W / 2;

  const cables = new Graphics();

  // Light the cabin throws on the shaft walls (behind the car), its shadow, the car, and the lamp's hot core.
  const spread = new Sprite(glow);
  spread.anchor.set(0.5);
  spread.tint = 0xffc27a;
  spread.blendMode = 'add';
  spread.width = SHAFT_W * 1.9;
  spread.height = CAR_H * 1.7;
  const shadow = new Sprite(glow);
  shadow.anchor.set(0.5);
  shadow.tint = 0x000000;
  shadow.alpha = 0.55;
  shadow.width = CAR_W * 1.25;
  shadow.height = CAR_H * 1.15;

  const car = new Container();
  const carTex = ArtLibrary.get('kit/car');
  if (carTex) {
    const s = new Sprite(carTex);
    s.width = CAR_W;
    s.height = CAR_H;
    s.tint = S.car;
    car.addChild(s);
  } else {
    // Fallback: a riveted steel box with a lattice front.
    if (colTex) {
      const box = new TilingSprite({ texture: colTex, width: CAR_W, height: CAR_H });
      box.tileScale.set(CAR_W / colTex.width);
      box.tint = 0x6a6660;
      car.addChild(box);
    }
    const g = new Graphics();
    g.rect(3, 4, CAR_W - 6, CAR_H - 8).fill({ color: 0x14130f, alpha: 0.75 });
    g.rect(0, 0, CAR_W, 4).fill(0x2a2a26);
    g.rect(0, CAR_H - 4, CAR_W, 4).fill(0x2a2a26);
    car.addChild(g);
    const front = gateLeaf(CAR_W - 6, CAR_H - 8, 0x9a9a92);
    front.position.set(3, 4);
    car.addChild(front);
  }
  // Hitch on the crosshead where the cables meet the car.
  const hitch = new Graphics();
  hitch.rect(CAR_W / 2 - 4, -3, 8, 4).fill(0x1c1c1a);
  hitch.rect(CAR_W / 2 - 4, -3, 8, 1).fill({ color: 0x9a9a92, alpha: 0.35 });
  hitch.circle(CAR_W / 2, -1, 1.2).fill(0x5a5a54);
  car.addChild(hitch);
  // Guide shoes riding on the rails.
  const shoes = new Graphics();
  for (const sy of [2, CAR_H - 7]) {
    shoes.rect(-3, sy, 4, 5).fill(0x1a1a18);
    shoes.rect(CAR_W - 1, sy, 4, 5).fill(0x1a1a18);
  }
  car.addChild(shoes);
  // [plan4:ST-18] Riders: four seats, each a body and a head (white shapes tinted with the walker's colours), invisible until someone boards.
  // Shown and hidden by alpha, so boarding never rebuilds the shaft's render group.
  const seatBody: Graphics[] = [];
  const seatHead: Graphics[] = [];
  const seatLegs: Graphics[] = [];
  /** [plan4:polish] Hair and the shading of the body, drawn over the tinted shapes: the riders were flat silhouettes. Shown with their seat. */
  const seatTrim: Graphics[] = [];
  const HAIR = [0x2a2018, 0x5a3a20, 0x8a8478, 0x1c1a1a];
  for (let i = 0; i < SEATS; i++) {
    const sx = 9 + i * 10.4, sy = CAR_H - 8 - (i & 1);
    const legs = new Graphics();
    legs.rect(-3.6, -20, 3.4, 20).fill(0xffffff);
    legs.rect(0.2, -20, 3.4, 20).fill(0xffffff);
    const body = new Graphics();
    body.roundRect(-5, -37, 10, 18, 3).fill(0xffffff);
    // Arms hang at the sides, in the shirt's colour.
    body.roundRect(-6.6, -36, 2.6, 14, 1.2).fill(0xffffff);
    body.roundRect(4, -36, 2.6, 14, 1.2).fill(0xffffff);
    const head = new Graphics();
    head.circle(0, -42, 4.3).fill(0xffffff);
    const trim = new Graphics();
    trim.arc(0, -42.6, 4.5, Math.PI * 1.05, Math.PI * 1.95).fill(HAIR[i % HAIR.length]); // hair cap
    trim.rect(-1.1, -38.4, 2.2, 1.6).fill({ color: 0x000000, alpha: 0.22 }); // neck shadow
    trim.roundRect(0.4, -36, 4.4, 17, 2).fill({ color: 0x000000, alpha: 0.2 }); // the side away from the lamp
    trim.rect(-0.2, -20, 0.5, 20).fill({ color: 0x000000, alpha: 0.35 }); // gap between the legs
    trim.rect(-5, -21, 10, 1.1).fill({ color: 0x20160c, alpha: 0.55 }); // belt
    for (const g of [legs, body, head, trim]) {
      g.position.set(sx, sy);
      g.alpha = 0;
      car.addChild(g);
    }
    seatLegs.push(legs);
    seatBody.push(body);
    seatHead.push(head);
    seatTrim.push(trim);
  }
  car.x = CAR_X;
  const core = new Sprite(glow);
  core.anchor.set(0.5);
  core.tint = 0xffd9a0;
  core.blendMode = 'add';
  core.width = 20;
  core.height = 16;
  core.position.set(CAR_W * LAMP_FX, CAR_H * LAMP_FY);
  const floorPool = new Sprite(glow);
  floorPool.anchor.set(0.5);
  floorPool.tint = 0xffb868;
  floorPool.blendMode = 'add';
  floorPool.width = CAR_W * 0.9;
  floorPool.height = 10;
  floorPool.position.set(CAR_W / 2, CAR_H - 6);
  car.addChild(floorPool, core);

  // ---------- Landings: frame, gate leaves, indicator lamp ----------
  const landings = new Container();
  const lampGlows = new Container();
  lampGlows.blendMode = 'add';
  const leaves: { l: Graphics; r: Graphics }[] = [];
  const lamps: { dot: Graphics; halo: Sprite }[] = [];
  const gateW = (GATE_X1 - GATE_X0) / 2;
  const gateH = FLOOR_LIP - (HEADER_Y + HEADER_H);
  for (let f = 0; f < floors; f++) {
    const top = floorTop(f);
    const midY = top + ROOM_H / 2;
    const l = gateLeaf(gateW, gateH, S.gate);
    l.position.set(GATE_X0, top + HEADER_Y + HEADER_H);
    const r = gateLeaf(gateW, gateH, S.gate);
    r.scale.x = -1;
    r.position.set(GATE_X1, top + HEADER_Y + HEADER_H);
    l.tint = r.tint = tintAt(0xffffff, midY);
    // Wrecked era: the gates hang a little crooked on worn tracks.
    if (st === 'R') {
      l.rotation = (rnd() - 0.5) * 0.035;
      r.rotation = (rnd() - 0.5) * 0.035;
    }
    landings.addChild(l, r);
    leaves.push({ l, r });
    // Frame: two posts and a header beam from the steel kit, with a sill and soft contact shadows.
    const frame = new Container();
    if (colTex) {
      for (const px of [GATE_X0 - 4, GATE_X1]) {
        const p = new TilingSprite({ texture: colTex, width: 4, height: FLOOR_LIP - HEADER_Y });
        p.position.set(px, top + HEADER_Y);
        p.tileScale.set(8 / colTex.width);
        p.tilePosition.set(-2 - f * 3, -f * 40);
        p.tint = tintAt(S.steel, midY);
        frame.addChild(p);
      }
      const h = new TilingSprite({ texture: colTex, width: HEADER_H, height: SHAFT_W - 2 });
      h.rotation = -Math.PI / 2;
      h.position.set(1, top + HEADER_Y + HEADER_H);
      h.tileScale.set((HEADER_H * 1.6) / colTex.width);
      h.tilePosition.set(-1, -f * 57);
      h.tint = tintAt(S.steel, midY);
      frame.addChild(h);
    }
    const fg = new Graphics();
    if (!colTex) {
      fg.rect(GATE_X0 - 4, top + HEADER_Y, 4, FLOOR_LIP - HEADER_Y).fill(0x3a3c3e);
      fg.rect(GATE_X1, top + HEADER_Y, 4, FLOOR_LIP - HEADER_Y).fill(0x3a3c3e);
      fg.rect(1, top + HEADER_Y, SHAFT_W - 2, HEADER_H).fill(0x3a3c3e);
    }
    for (let i = 0; i < 4; i++) fg.rect(GATE_X0, top + HEADER_Y + HEADER_H + i, GATE_X1 - GATE_X0, 1).fill({ color: 0x000000, alpha: 0.35 * (1 - i / 4) });
    fg.rect(1, top + HEADER_Y + HEADER_H - 1, SHAFT_W - 2, 1).fill({ color: 0x000000, alpha: 0.5 });
    for (const bx of [4, 14, SHAFT_W - 15, SHAFT_W - 5]) fg.circle(bx, top + HEADER_Y + HEADER_H / 2, 0.8).fill(0x8a8a80);
    // Indicator lamp in a small cage on the landing's right post (the level plaque sits on the header).
    const lx = GATE_X1 + 2, ly = top + HEADER_Y + HEADER_H + 9;
    fg.roundRect(lx - 3, ly - 3.5, 6, 7, 1.5).fill(0x161614);
    fg.rect(lx - 3, ly - 3.5, 6, 0.8).fill({ color: 0x8a8a80, alpha: 0.4 });
    fg.rect(lx - 2.6, ly - 0.2, 5.2, 0.5).fill({ color: 0x050505, alpha: 0.8 });
    frame.addChild(fg);
    landings.addChild(frame);
    const dot = new Graphics();
    dot.circle(lx, ly, 1.9).fill(0xffffff);
    dot.circle(lx - 0.6, ly - 0.6, 0.6).fill({ color: 0xffffff, alpha: 0.9 });
    const halo = new Sprite(glow);
    halo.anchor.set(0.5);
    halo.position.set(lx, ly);
    halo.width = halo.height = 16;
    landings.addChild(dot);
    lampGlows.addChild(halo);
    lamps.push({ dot, halo });
    // [plan4:ST-4] A floor with a west wing has a second landing door: a steel doorframe in the shaft's west wall, the leaf ajar on a lit passage,
    // a lamp over it. (The east side is the lattice gate's own opening.)
    if (westFloors[f]) {
      const wy = top + HEADER_Y, wh = FLOOR_LIP - HEADER_Y;
      // The doorframe itself stands in the structure layer (structure.ts, over the room's edge); here the shaft's side of it: a threshold and the lamp.
      const wg = new Graphics();
      wg.rect(1, wy + wh - 2, 5, 2).fill(0x2a2b28);
      wg.rect(1, wy + 6, 0.8, wh - 8).fill({ color: 0xffc070, alpha: 0.35 });
      landings.addChild(wg);
      const wh2 = new Sprite(glow);
      wh2.anchor.set(0.5);
      wh2.tint = 0xffb868;
      wh2.width = 26;
      wh2.height = 34;
      wh2.alpha = 0.4;
      wh2.position.set(-1, wy + wh * 0.62);
      lampGlows.addChild(wh2);
    }
  }

  // [airy:B3] Zone beacons: at every landing the doorposts light up in the colour of the level's zone (the same colour as the level plate), and a thin
  // lit jamb runs down both edges of the whole shaft over the gates. Seen from far, the shaft reads as one bright line of coloured beads, one per level.
  const beacons = new Container();
  beacons.blendMode = 'add';
  if (GFX.airy) {
    // (One Graphics for every bar and the halos first: the additive layer stays two batches, not three per level.)
    const halos = new Container();
    const bars = new Graphics();
    bars.rect(-2.2, TOP, 2.2, bottomY - TOP).fill({ color: 0xffd890, alpha: 0.38 });
    bars.rect(SHAFT_W, TOP, 2.2, bottomY - TOP).fill({ color: 0xffd890, alpha: 0.38 });
    bars.rect(0, TOP, 1.2, bottomY - TOP).fill({ color: 0xfff0d0, alpha: 0.4 });
    bars.rect(SHAFT_W - 1.2, TOP, 1.2, bottomY - TOP).fill({ color: 0xfff0d0, alpha: 0.4 });
    for (let f = 0; f < floors; f++) {
      const col = zoneColors[f];
      if (col === undefined) continue;
      const top = floorTop(f);
      const y0 = top + HEADER_Y + HEADER_H, y1 = top + FLOOR_LIP;
      for (const x of [1.2, SHAFT_W - 4.4]) bars.rect(x, y0, 3.2, y1 - y0).fill({ color: col, alpha: 0.8 });
      bars.rect(1.2, top + HEADER_Y + HEADER_H - 1.5, SHAFT_W - 2.4, 2.4).fill({ color: col, alpha: 0.85 });
      const halo = new Sprite(glow);
      halo.anchor.set(0.5);
      halo.tint = col;
      halo.alpha = 0.4;
      halo.width = SHAFT_W * 1.5;
      halo.height = (y1 - y0) * 1.1;
      halo.position.set(SHAFT_W / 2, (y0 + y1) / 2);
      halos.addChild(halo);
    }
    beacons.addChild(halos, bars);
  }

  // ---------- Pulley housing at the head of the shaft ----------
  const head = new Container();
  const hg = new Graphics();
  // Machine beams across the shaft.
  hg.rect(0, TOP, SHAFT_W, 5).fill(0x24241f);
  hg.rect(0, TOP + 4, SHAFT_W, 1).fill({ color: 0x000000, alpha: 0.5 });
  hg.rect(0, TOP + 22, SHAFT_W, 5).fill(0x24241f);
  hg.rect(0, TOP + 22, SHAFT_W, 1).fill({ color: 0xa09a8a, alpha: 0.25 });
  for (let i = 0; i < 5; i++) hg.rect(0, TOP + 27 + i, SHAFT_W, 1).fill({ color: 0x000000, alpha: 0.3 * (1 - i / 5) });
  for (let x = 3; x < SHAFT_W; x += 9) {
    hg.circle(x, TOP + 2.5, 0.8).fill(0x7a7468);
    hg.circle(x + 4, TOP + 24.5, 0.8).fill(0x7a7468);
  }
  // Sheave bearings frame.
  hg.poly([SHEAVE_X - 6, TOP + 22, SHEAVE_X - 2, SHEAVE_Y, SHEAVE_X + 2, SHEAVE_Y, SHEAVE_X + 6, TOP + 22]).fill(0x2e2e2a);
  // Hoist motor and gearbox off to the left.
  hg.roundRect(3, TOP + 8, 16, 12, 2).fill(0x343a32);
  for (let x = 5; x < 18; x += 2.5) hg.rect(x, TOP + 9, 1, 10).fill({ color: 0x000000, alpha: 0.35 });
  hg.rect(3, TOP + 8, 16, 1).fill({ color: 0xaab0a0, alpha: 0.25 });
  hg.rect(19, TOP + 12, SHEAVE_X - 19, 3).fill(0x1c1c1a);
  hg.roundRect(SHEAVE_X + 10, TOP + 9, 8, 11, 1.5).fill(0x3a3428);
  hg.circle(SHEAVE_X + 14, TOP + 13, 1.2).fill(st === 'R' ? 0x6a2a1a : 0x2a6a2a);
  head.addChild(hg);
  const sheave = new Graphics();
  sheave.circle(0, 0, SHEAVE_R).fill(0x2a2a26);
  sheave.circle(0, 0, SHEAVE_R).stroke({ color: 0x7a786e, width: 1.2 });
  sheave.circle(0, 0, SHEAVE_R - 2).stroke({ color: 0x141412, width: 1 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    sheave.moveTo(Math.cos(a) * 2, Math.sin(a) * 2).lineTo(Math.cos(a) * (SHEAVE_R - 2), Math.sin(a) * (SHEAVE_R - 2));
  }
  sheave.stroke({ color: 0x5a5850, width: 1.4 });
  sheave.circle(0, 0, 2.2).fill(0x8a887c);
  sheave.circle(0, 0, 0.9).fill(0x1a1a18);
  sheave.position.set(SHEAVE_X, SHEAVE_Y);
  head.addChild(sheave);

  root.addChild(back, cw, rails, shadow, spread, cables, car, landings, lampGlows, beacons, head);

  // ---------- Motion ----------
  type Mode = 'idle' | 'closing' | 'moving' | 'opening';
  let mode: Mode = 'idle';
  let cur = 0, to = 0, phase = 1, wait = 2, open = 1, lastT = 0, sway = 0, drawnSway = 0, cablesY = NaN;
  const yFor = (f: number) => floorTop(f) + FLOOR_LIP - CAR_H;
  const travelTop = yFor(0);
  const travel = yFor(floors - 1) - travelTop;
  car.y = yFor(0);
  let prevY = car.y;

  // [plan4:ST-18] --- Lift service: tickets, boarding, delivery ---
  const tState = new Uint8Array(TICKETS); // 0 free, 1 waiting, 2 aboard, 3 delivered
  const tFrom = new Int16Array(TICKETS);
  const tTo = new Int16Array(TICKETS);
  const tSeat = new Int8Array(TICKETS).fill(-1);
  const tSeq = new Float64Array(TICKETS);
  const tDoneAt = new Float64Array(TICKETS);
  let seq = 0, nAboard = 0, tripTo = -1, dwell = 0, displayWait = 8, lastPower = 1, clock = 0, tickets = 0;
  const showSeat = (seat: number, on: boolean) => {
    seatLegs[seat].alpha = seatBody[seat].alpha = seatHead[seat].alpha = seatTrim[seat].alpha = on ? 1 : 0;
  };
  const clearTickets = () => {
    for (let i = 0; i < TICKETS; i++) tState[i] = 0;
    for (let i = 0; i < SEATS; i++) showSeat(i, false);
    nAboard = 0; tripTo = -1; tickets = 0;
  };
  const lift: LiftApi = {
    ready: () => GFX.walkers && lastPower > 0.3,
    request: (from, to) => {
      for (let i = 0; i < TICKETS; i++) {
        if (tState[i] !== 0) continue;
        tState[i] = 1; tFrom[i] = from; tTo[i] = to; tSeat[i] = -1; tSeq[i] = ++seq; tickets++;
        return i + 1;
      }
      return 0;
    },
    canBoard: t => {
      const i = t - 1;
      return i >= 0 && tState[i] === 1 && mode === 'idle' && open >= 1 && cur === tFrom[i] && lastPower > 0.3 && nAboard < SEATS && (nAboard === 0 || tripTo === tTo[i]);
    },
    board: (t, shirt, skin, pants) => {
      const i = t - 1;
      let seat = 0;
      const taken = (k: number) => { for (let j = 0; j < TICKETS; j++) if (tState[j] === 2 && tSeat[j] === k) return true; return false; };
      while (seat < SEATS && taken(seat)) seat++;
      if (i < 0 || tState[i] !== 1 || seat >= SEATS) return;
      tState[i] = 2; tSeat[i] = seat; nAboard++; tripTo = tTo[i]; dwell = 0;
      seatLegs[seat].tint = pants;
      seatBody[seat].tint = shirt;
      seatHead[seat].tint = skin;
      showSeat(seat, true);
    },
    arrived: t => t >= 1 && tState[t - 1] === 3,
    release: t => {
      const i = t - 1;
      if (i < 0 || i >= TICKETS || tState[i] === 0) return;
      if (tState[i] === 2) { nAboard--; if (nAboard <= 0) { nAboard = 0; tripTo = -1; } }
      if (tSeat[i] >= 0) showSeat(tSeat[i], false);
      tState[i] = 0; tSeat[i] = -1; tickets--;
    },
    carY: () => car.y + CAR_H / 2,
  };

  /** The car's idle decision when walkers are on: carry riders, fetch the oldest waiting one, or (rarely) make a display trip. */
  const serve = (dt: number): void => {
    if (lastPower <= 0.3) return;
    for (let i = 0; i < TICKETS; i++) if (tState[i] === 3 && clock - tDoneAt[i] > 3) lift.release(i + 1); // a rider nobody collected
    if (nAboard > 0) {
      dwell += dt;
      if (dwell >= BOARD_DWELL && tripTo >= 0 && tripTo !== cur) { to = tripTo; mode = 'closing'; }
      return;
    }
    let w = -1;
    for (let i = 0; i < TICKETS; i++) if (tState[i] === 1 && (w < 0 || tSeq[i] < tSeq[w])) w = i;
    if (w >= 0) {
      // The car waits here with its doors open when the rider is on this floor (walkers give up after a while, see Walkers).
      if (tFrom[w] !== cur) { to = tFrom[w]; mode = 'closing'; }
      return;
    }
    displayWait -= dt;
    if (displayWait <= 0) {
      displayWait = DISPLAY_TRIP_S;
      to = Math.floor(Math.random() * floors);
      if (to !== cur) mode = 'closing';
    }
  };

  const setLeaves = (f: number, k: number) => {
    const s = 1 - 0.82 * k;
    leaves[f].l.scale.x = s;
    leaves[f].r.scale.x = -s;
  };

  const drawCables = (sway: number) => {
    cables.clear();
    const hitchY = car.y - 3;
    const cwY = cw.y - 4;
    const left = SHEAVE_X - SHEAVE_R, right = SHEAVE_X + SHEAVE_R;
    for (const dx of [-1.5, 0, 1.5]) {
      const mid = (SHEAVE_Y + hitchY) / 2;
      cables.moveTo(left + dx * 0.6, SHEAVE_Y).quadraticCurveTo(left + dx + sway, mid, CAR_X + CAR_W / 2 + dx * 0.8, hitchY);
    }
    for (const dx of [-1, 1]) cables.moveTo(right + dx * 0.6, SHEAVE_Y).quadraticCurveTo(right + dx - sway * 0.6, (SHEAVE_Y + cwY) / 2, right + dx * 0.8, cwY);
    cables.stroke({ color: S.cable, width: 0.75, alpha: 0.9 });
    // A darker core keeps the strands from reading as one flat line.
    for (const dx of [-0.75, 0.75]) cables.moveTo(left + dx, SHEAVE_Y).quadraticCurveTo(left + dx + sway, (SHEAVE_Y + hitchY) / 2, CAR_X + CAR_W / 2 + dx, hitchY);
    cables.stroke({ color: 0x1c1c1a, width: 0.5, alpha: 0.7 });
  };

  const place = () => {
    cw.y = CW_TOP_MIN + (travel - (car.y - travelTop));
    spread.position.set(CAR_X + CAR_W / 2, car.y + CAR_H * 0.45);
    shadow.position.set(CAR_X + CAR_W / 2 + 2, car.y + CAR_H / 2 + 3);
  };
  place();
  setLeaves(cur, open);
  drawCables(0);

  return {
    container: root,
    lift,
    animate: (t, power) => {
      if (GFX.airy) beacons.alpha = 0.55 + 0.45 * labelState.clarity; // [airy:B3] brighter the further out the camera is
      const dt = lastT ? Math.max(0, Math.min(0.1, t - lastT)) : 0;
      lastT = t;
      lastPower = power;
      clock = t;
      if (!GFX.walkers && tickets > 0) clearTickets(); // [plan4:ST-18] flag switched off while riders were booked: back to the old behaviour
      if (mode === 'idle') {
        if (GFX.walkers) serve(dt); // [plan4:ST-18] walkers' lift service replaces the random trips
        else {
          wait -= dt;
          if (wait <= 0 && power > 0.3) {
            to = Math.floor(Math.random() * floors);
            wait = 2 + Math.random() * 4;
            if (to !== cur) mode = 'closing';
          }
        }
      } else if (mode === 'closing') {
        open = Math.max(0, open - dt / DOOR_T);
        setLeaves(cur, open);
        if (open <= 0) { mode = 'moving'; phase = 0; }
      } else if (mode === 'moving') {
        phase = Math.min(1, phase + dt * 0.5 * S.speed);
        const e = phase < 0.5 ? 2 * phase * phase : 1 - Math.pow(-2 * phase + 2, 2) / 2;
        car.y = yFor(cur) + (yFor(to) - yFor(cur)) * e;
        if (phase >= 1) {
          cur = to;
          mode = 'opening';
          onArrive?.();
        }
      } else {
        open = Math.min(1, open + dt / DOOR_T);
        setLeaves(cur, open);
        if (open >= 1) {
          mode = 'idle';
          // [plan4:ST-18] Whoever rode to this floor has arrived (their walker steps out of the cabin on its next update).
          for (let i = 0; i < TICKETS; i++) {
            if (tState[i] === 2 && tTo[i] === cur) { tState[i] = 3; tDoneAt[i] = t; nAboard--; }
          }
          if (nAboard <= 0) { nAboard = 0; tripTo = -1; }
        }
      }

      const v = dt > 0 ? (car.y - prevY) / dt : 0;
      prevY = car.y;
      if (v !== 0) {
        sheave.rotation -= (v * dt) / SHEAVE_R;
        place();
      }
      // The cables swing a little with acceleration and settle when the car stops.
      const targetSway = Math.max(-1.2, Math.min(1.2, v * 0.012));
      sway += (targetSway - sway) * Math.min(1, dt * 3);
      const swayNow = sway + Math.sin(t * 2.3) * 0.15 * Math.min(1, Math.abs(v) / 40);
      if (car.y !== cablesY || Math.abs(swayNow - drawnSway) > 0.02) {
        drawCables(swayNow);
        cablesY = car.y;
        drawnSway = swayNow;
      }

      // Cabin lamp: dims with power, flickers a little in the wrecked era.
      const flick = S.flicker ? 1 - S.flicker * Math.max(0, Math.sin(t * 13.7) * Math.sin(t * 5.3)) : 1;
      const lit = (0.25 + 0.75 * power) * flick;
      core.alpha = 0.85 * lit;
      spread.alpha = 0.5 * lit;
      floorPool.alpha = 0.35 * lit;

      // Indicator lamps: green where the car stands, amber while it travels (blinking at the destination).
      const moving = mode === 'moving';
      const near = moving ? floorAfterTravel(car.y - travelTop) : cur;
      const blink = Math.sin(t * 9) > 0;
      for (let f = 0; f < floors; f++) {
        const L = lamps[f];
        let color = 0x3a2a20, a = 0;
        if (!moving && f === cur) { color = 0x6cff7a; a = 1; } else if (moving && f === near) { color = 0xffb040; a = 0.9; } else if (moving && f === to && blink) { color = 0xffb040; a = 0.7; }
        a *= 0.4 + 0.6 * power;
        L.dot.tint = a > 0 ? color : 0x3a2a20;
        L.dot.alpha = a > 0 ? 0.5 + 0.5 * a : 0.8;
        L.halo.tint = color;
        L.halo.alpha = a * 0.75;
      }
    },
  };
}
