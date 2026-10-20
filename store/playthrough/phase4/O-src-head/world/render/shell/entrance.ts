/**
 * [world:M1] The entrance beat (style guide 12 beats 1-2): the way down from the surface into Bell Square.
 *
 * A blast hatch in the ground east of the spine, its leaf propped open with sandbags and a red beacon on the coaming; the shaft under
 * it is cut through the soil into the vault crown (cityLayout `c:hatch`), and the sky spills down it as a warm pool (a `civic` light, so
 * it dims at night). From the hatch landing a companionway of steel flights, hazard-yellow handrail and stringers, zig-zags down the east
 * stair column to floor 0's east balcony: two caged lamps make overlapping pools on the way, and the red emergency lamp at the bottom
 * marks the threshold. The geometry is `entranceGeom()` (pure), so routes can walk the same flights.
 */
import { Container, FillGradient, Graphics } from 'pixi.js';
import { FLIGHT_RISE } from '../../../rendering/geom';
import { CITY, PROPS, type StratumId } from '../../tokens';
import { entranceGeom } from '../../model/cityLayout';
import type { HubGeom } from '../layoutTypes';
import type { LightDef, ShellPiece } from './types';
import { OUTLINE, contactShadow, lamp, palette, rod, shade, sprite, vfill } from './kit';

const E = CITY.entrance;
const C = PROPS.entrance;
const HALF = 19;

let ray: FillGradient | null = null;
/** The sky's shaft of light falling through the hatch (top bright, fading to nothing at the balcony). */
function rayFill(y0: number, y1: number): FillGradient {
  if (ray) return ray;
  ray = new FillGradient({ type: 'linear', start: { x: 0, y: y0 }, end: { x: 0, y: y1 }, textureSpace: 'global' });
  ray.addColorStop(0, C.sky);
  ray.addColorStop(1, 0x000000);
  return ray;
}

export function buildEntrance(hub: HubGeom): ShellPiece {
  const s = hub.s as StratumId;
  const P = palette(s);
  const back = new Container();
  const front = new Container();
  const glow = new Container();
  back.label = 'entrance:back';
  front.label = 'entrance:front';
  const lights: LightDef[] = [];
  const g = entranceGeom();
  const h = g.hatch, st = g.stair;
  const area = `f:${hub.floors[0]}`;

  // ------------------------------------------------------------------------------------------------ the shaft lining (behind)
  const lining = new Graphics();
  // Hazard bands painted round the shaft mouth, and the rungs of an old ladder on its west wall.
  for (let y = h.y0 + 6; y < h.y0 + 18; y += 6) lining.rect(h.x0, y, h.x1 - h.x0, 3).fill({ color: P.hazard, alpha: 0.55 });
  for (let y = h.y0 + 24; y < h.y1 - 4; y += 7) rod(lining, h.x0 + 4, y, h.x0 + 12, y, 1.2, shade(P.metal, 0.8));
  rod(lining, h.x0 + 4, h.y0 + 20, h.x0 + 4, h.y1, 1.4, shade(P.metal, 0.7));
  rod(lining, h.x0 + 12, h.y0 + 20, h.x0 + 12, h.y1, 1.4, shade(P.metal, 0.7));
  back.addChild(lining);

  // ------------------------------------------------------------------------------------------------ the sky spill
  const shaft = new Graphics();
  const cx = (h.x0 + h.x1) / 2;
  shaft.poly([h.x0 + 2, h.y0, h.x1 - 2, h.y0, st.x + HALF + 24, st.bottom, st.x - HALF - 30, st.bottom]).fill(rayFill(h.y0, st.bottom));
  shaft.alpha = 0.16;
  shaft.blendMode = 'add';
  glow.addChild(shaft);
  lights.push({ x: cx, y: h.y1 + 6, preset: 'streetLamp', color: C.sky, radius: 190, intensity: 0.9, cone: 170, kind: 'civic', area });

  // ------------------------------------------------------------------------------------------------ the companionway
  const flights = new Container();
  const rails = new Graphics();
  const posts = new Graphics();
  const top = st.top, bottom = st.bottom;
  // Stringer posts carry on the hub's stair column up to the hatch landing.
  posts.rect(st.x - 23, top - 6, 3, bottom - top + 6).fill(vfill(C.stringer, top, bottom)).stroke({ ...OUTLINE, width: 1 });
  posts.rect(st.x + 20, top - 6, 3, bottom - top + 6).fill(vfill(shade(C.stringer, 0.85), top, bottom)).stroke({ ...OUTLINE, width: 1 });
  for (const f of g.flights) {
    const odd = f.odd;
    const fl = sprite('stair-flight', odd ? st.x + HALF : st.x - HALF, f.y + FLIGHT_RISE, { flip: odd });
    fl.tint = shade(0xffffff, 0.92);
    flights.addChild(fl);
    // The handrail in hazard yellow (the hub's own stairs keep the stratum's enamel), with its stanchions.
    const xa = odd ? st.x - HALF : st.x + HALF, xb = odd ? st.x + HALF : st.x - HALF;
    rod(rails, xa, f.y - 14, xb, f.y + FLIGHT_RISE - 14, 1.8, C.rail);
    for (let t = 0.15; t < 1; t += 0.35) {
      const px = xa + (xb - xa) * t, py = f.y + FLIGHT_RISE * t;
      rod(rails, px, py - 14, px, py, 1, shade(C.rail, 0.7));
    }
    // The landing at the turn, a hazard edge on it.
    const lx = odd ? st.x - HALF - 6 : st.x + HALF - 6;
    posts.rect(lx, f.y, 12, 3.5).fill(shade(P.metal, 1.05)).stroke({ ...OUTLINE, width: 1 });
    posts.rect(lx, f.y, 12, 1.2).fill({ color: C.rail, alpha: 0.85 });
  }
  // The hatch landing: a short steel platform right under the shaft.
  posts.rect(Math.min(h.x0, st.x - HALF) - 2, top - 2, Math.max(h.x1, st.x + HALF) - Math.min(h.x0, st.x - HALF) + 4, 4).fill(vfill(shade(P.metal, 1.1), top - 2, top + 2)).stroke({ ...OUTLINE, width: 1 });
  front.addChild(posts, flights, rails);
  // Two caged lamps on the vault's east springing: overlapping pools with dark between them; the red threshold lamp at the balcony.
  const wallX = hub.rect.x + hub.rect.w - CITY.hub.wallW;
  for (const k of [0.22, 0.68]) lights.push(...lamp(front, glow, 'lamp-cage', wallX, top + (bottom - top) * k, { area, kind: 'shell' }, { flip: true }));
  lights.push(...lamp(front, glow, 'lamp-beacon', wallX - 8, bottom - 46, { area, kind: 'shell' }));

  // ------------------------------------------------------------------------------------------------ the hatch on the ground
  const gnd = new Graphics();
  // Coaming: a heavy steel frame round the hole, rust at its foot.
  gnd.rect(h.x0 - 5, -5, h.x1 - h.x0 + 10, 6).fill(vfill(C.coaming, -5, 1)).stroke(OUTLINE);
  gnd.rect(h.x0 - 5, -1, h.x1 - h.x0 + 10, 2).fill({ color: C.leafRust, alpha: 0.6 });
  // The leaf, hinged on the east side of the coaming, propped open leaning back east; a prop bar holds it.
  const hx = h.x1 + 3, hy = -4;
  const ex = hx + Math.cos(E.leafAngle) * E.leafLen, ey = hy - Math.sin(E.leafAngle) * E.leafLen;
  const nx = -Math.sin(E.leafAngle) * 7, ny = -Math.cos(E.leafAngle) * 7;
  gnd.poly([hx, hy, ex, ey, ex + nx, ey + ny, hx + nx, hy + ny]).fill(vfill(C.leaf, ey, hy)).stroke(OUTLINE);
  gnd.poly([hx + nx * 0.2, hy + ny * 0.2, ex + nx * 0.2, ey + ny * 0.2, (hx + ex) / 2 + nx * 0.2, (hy + ey) / 2 + ny * 0.2], false).stroke({ width: 2, color: C.leafRust, alpha: 0.55 });
  gnd.circle((hx + ex) / 2 + nx * 0.5, (hy + ey) / 2 + ny * 0.5, 3.4).stroke({ width: 1.4, color: shade(P.metal, 0.9) });
  rod(gnd, hx + 26, -1, (hx + ex) / 2 + 2, (hy + ey) / 2, 1.4, shade(P.metal, 0.75));
  // The hinge block and the dogs (locking lugs) along the leaf's edge.
  gnd.rect(hx - 4, hy - 4, 8, 6).fill(shade(C.coaming, 1.2)).stroke({ ...OUTLINE, width: 0.8 });
  for (let t = 0.25; t < 1; t += 0.25) gnd.rect(hx + (ex - hx) * t + nx - 1.5, hy + (ey - hy) * t + ny - 1.5, 3, 3).fill(shade(C.leafRust, 1.1));
  // Sandbags banked east of the leaf, three courses.
  const sx0 = h.x1 + E.sandbagsDx + 14;
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 4 - row; i++) {
      const bx = sx0 + i * 11 + row * 5.5, by = -1 - row * 6;
      gnd.roundRect(bx, by - 6, 11.5, 6.5, 2.6).fill(vfill(shade(C.sandbag, 0.9 + ((i + row) % 3) * 0.06), by - 6, by)).stroke({ ...OUTLINE, width: 0.9 });
    }
  }
  // The barrel fire on the ground: the warm first pool of the descent.
  const bx = h.x1 + E.barrelDx + 14;
  contactShadow(gnd, bx, 0, 14);
  gnd.roundRect(bx - 7, -18, 14, 18, 2).fill(vfill(PROPS.hub.fireBarrel, -18, 0)).stroke(OUTLINE);
  gnd.rect(bx - 7, -12, 14, 1.6).fill({ color: 0x000000, alpha: 0.4 });
  const flame = new Graphics();
  flame.poly([bx - 6, -18, bx - 2, -29, bx + 1, -22, bx + 4, -31, bx + 6, -18]).fill({ color: PROPS.hub.flame, alpha: 0.85 });
  flame.poly([bx - 3, -18, bx, -25, bx + 3, -18]).fill({ color: PROPS.hub.flameCore, alpha: 0.9 });
  flame.blendMode = 'add';
  glow.addChild(flame);
  lights.push({ x: bx, y: -24, preset: 'fireBarrel', kind: 'shell', area: 'surface' });
  front.addChild(gnd);
  // The red beacon on the coaming's west post.
  lights.push(...lamp(front, glow, 'lamp-beacon', h.x0 - 2, -5, { area: 'surface', kind: 'shell' }));

  front.addChild(glow);
  return { back, front, lights };
}
