import { Texture } from 'pixi.js';
import { rgba, seeded } from './draw';

/**
 * [plan4:ST-14/ST-15] The overlay paintings of the bulkhead doors, the stairwell and the ventilation stack: Canvas 2D, made once, 4 canvas pixels per world
 * unit. Painted surfaces only (gradients, fills, specks; no outlines), lit from above left like the rest of the kit, nothing above 0.6 saturation except the
 * red emergency lens and the hazard stripes (style rules 1-4). They are neutral-light: infra.ts tints them with the depth fog and the era's ambient.
 */

const R = 4;
const cache = new Map<string, Texture>();

function tex(key: string, w: number, h: number, paint: (g: CanvasRenderingContext2D, W: number, H: number) => void): Texture {
  let t = cache.get(key);
  if (!t || t.destroyed) {
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

/** The dark concrete back wall of a one-slot shaft section: speckled, darker into both sides and under the ceiling. */
function backWall(g: CanvasRenderingContext2D, W: number, H: number, wallH: number, seed: number): void {
  const wall = g.createLinearGradient(0, 0, 0, wallH * R);
  wall.addColorStop(0, '#3a362f');
  wall.addColorStop(1, '#27241f');
  g.fillStyle = wall;
  g.fillRect(0, 0, W, wallH * R);
  const rnd = seeded(seed);
  for (let i = 0; i < 160; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(255,244,226,0.05)' : 'rgba(0,0,0,0.16)';
    g.fillRect(rnd() * W, rnd() * wallH * R, (0.4 + rnd() * 1.2) * R, (0.3 + rnd() * 0.9) * R);
  }
  // Pour joints and a stain.
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.fillRect(0, 34 * R, W, 0.5 * R);
  g.fillRect(0, 68 * R, W, 0.5 * R);
  g.fillStyle = 'rgba(86,60,34,0.12)';
  g.fillRect(31 * R, 6 * R, 3 * R, 40 * R);
  // Side occlusion and the shadow under the ceiling.
  for (const left of [true, false]) {
    const s = g.createLinearGradient(left ? 0 : W, 0, left ? 7 * R : W - 7 * R, 0);
    s.addColorStop(0, 'rgba(0,0,0,0.55)');
    s.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = s;
    g.fillRect(left ? 0 : W - 7 * R, 0, 7 * R, wallH * R);
  }
  const top = g.createLinearGradient(0, 0, 0, 14 * R);
  top.addColorStop(0, 'rgba(0,0,0,0.6)');
  top.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = top;
  g.fillRect(0, 0, W, 14 * R);
}

/** Steel posts down both sides of a one-slot section (the room next door ends in a frame, not in a cut): lit on the left, with cap and foot plates. */
function sideFrames(g: CanvasRenderingContext2D, W: number, wallH: number): void {
  for (const left of [true, false]) {
    const x = left ? 0 : W - 2.6 * R;
    const gr = g.createLinearGradient(x, 0, x + 2.6 * R, 0);
    gr.addColorStop(0, left ? '#9a9ea0' : '#6a6e70');
    gr.addColorStop(0.5, left ? '#767a7c' : '#555a5c');
    gr.addColorStop(1, left ? '#4a4e50' : '#33383a');
    g.fillStyle = gr;
    g.fillRect(x, 0, 2.6 * R, wallH * R);
    g.fillStyle = 'rgba(255,255,248,0.18)';
    g.fillRect(left ? x : x + 2 * R, 0, 0.5 * R, wallH * R);
  }
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(2.6 * R, 0, 0.8 * R, wallH * R);
  g.fillRect(W - 3.4 * R, 0, 0.8 * R, wallH * R);
}

/** One flight of steel stairs: open treads with a lit top, dark risers, a stringer, and a handrail on posts. (x0, y0) is the foot, (x1, y1) the top. */
function flight(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, steps: number): void {
  const dx = (x1 - x0) / steps, dy = (y1 - y0) / steps;
  const dir = Math.sign(dx);
  // The stringer, a slanted steel flat under the treads.
  g.fillStyle = 'rgba(0,0,0,0.38)';
  g.beginPath();
  g.moveTo((x0 + dir * 1.2) * R, (y0 + 3.4) * R);
  g.lineTo((x1 + dir * 1.2) * R, (y1 + 3.4) * R);
  g.lineTo((x1 + dir * 1.2) * R, (y1 + 8.4) * R);
  g.lineTo((x0 + dir * 1.2) * R, (y0 + 8.4) * R);
  g.fill();
  const st = g.createLinearGradient(0, y1 * R, 0, (y0 + 6) * R);
  st.addColorStop(0, '#8c9294');
  st.addColorStop(1, '#5e6466');
  g.fillStyle = st;
  g.beginPath();
  g.moveTo(x0 * R, (y0 + 1.6) * R);
  g.lineTo(x1 * R, (y1 + 1.6) * R);
  g.lineTo(x1 * R, (y1 + 4.4) * R);
  g.lineTo(x0 * R, (y0 + 4.4) * R);
  g.fill();
  for (let i = 0; i < steps; i++) {
    const tx = Math.min(x0 + i * dx, x0 + (i + 1) * dx), ty = y0 + (i + 1) * dy;
    const tw = Math.abs(dx) + 0.6;
    // Shadow of the tread on the wall, then the tread: a dark front edge and a lit top.
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect((tx + dir * 0.8) * R, (ty + 1.2) * R, tw * R, 1.6 * R);
    g.fillStyle = '#aab0ae';
    g.fillRect(tx * R, ty * R, tw * R, 1.3 * R);
    g.fillStyle = 'rgba(246,246,236,0.62)';
    g.fillRect(tx * R, ty * R, tw * R, 0.4 * R);
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(tx * R, (ty + 1) * R, tw * R, 0.3 * R);
  }
  // Rail: posts on every other tread and a bar along the slope.
  for (let i = 0; i <= steps; i += 2) {
    const px = x0 + i * dx + dx * 0.5, py = y0 + (i + 1) * dy;
    g.fillStyle = '#70767a';
    g.fillRect((px - 0.35) * R, (py - 10.6) * R, 0.7 * R, 10.6 * R);
  }
  g.fillStyle = '#9a9ea0';
  g.beginPath();
  g.moveTo(x0 * R, (y0 - 9.6) * R);
  g.lineTo((x1 + dx) * R, (y1 + dy - 9.6) * R);
  g.lineTo((x1 + dx) * R, (y1 + dy - 8.4) * R);
  g.lineTo(x0 * R, (y0 - 8.4) * R);
  g.fill();
  g.fillStyle = 'rgba(255,255,248,0.3)';
  g.beginPath();
  g.moveTo(x0 * R, (y0 - 9.6) * R);
  g.lineTo((x1 + dx) * R, (y1 + dy - 9.6) * R);
  g.lineTo((x1 + dx) * R, (y1 + dy - 9.2) * R);
  g.lineTo(x0 * R, (y0 - 9.2) * R);
  g.fill();
}

/**
 * Stairwell section (46 x 116 = one level and the slab under it): a switchback of two steep steel flights with a landing between them, the handrail, a red
 * emergency lamp on the wall. The second flight climbs out through the top of the section; its arrival is wrapped into the slab zone at the bottom, so
 * sections stacked on each other read as one continuous stair.
 */
export function stairsTexture(): Texture {
  return tex('stairs', 46, 116, (g, W, H) => {
    backWall(g, W, H, 100, 5101);
    // The red lamp washes the wall around it (a painted cast; the breathing glow is a separate additive sprite).
    const wash = g.createRadialGradient(9.4 * R, 19.3 * R, 0, 9.4 * R, 19.3 * R, 38 * R);
    wash.addColorStop(0, 'rgba(206,52,38,0.34)');
    wash.addColorStop(0.55, 'rgba(160,36,26,0.12)');
    wash.addColorStop(1, 'rgba(120,20,16,0)');
    g.fillStyle = wash;
    g.fillRect(0, 0, W, 100 * R);
    // Landing between the flights, lit on its top, and the floor slab the section stands on.
    const slab = g.createLinearGradient(0, 97 * R, 0, 116 * R);
    slab.addColorStop(0, '#5c5a56');
    slab.addColorStop(1, '#2c2b29');
    g.fillStyle = slab;
    g.fillRect(0, 97 * R, W, 19 * R);
    g.fillStyle = 'rgba(232,226,208,0.42)';
    g.fillRect(0, 97 * R, W, 0.9 * R);
    g.fillStyle = '#6a6c6c';
    g.fillRect(31 * R, 40 * R, 15 * R, 2.6 * R);
    g.fillStyle = 'rgba(236,236,226,0.4)';
    g.fillRect(31 * R, 40 * R, 15 * R, 0.5 * R);
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.fillRect(31 * R, 42.6 * R, 15 * R, 1.4 * R);
    // Flight 1 climbs from the floor (left) to the landing (right); flight 2 turns back to the level above, its last steps wrapped into the slab zone.
    flight(g, 3.5, 96, 31, 40, 11);
    flight(g, 44, 39, 5, -19, 15);
    g.save();
    g.translate(0, 116 * R);
    flight(g, 44, 39, 5, -19, 15);
    g.restore();
    sideFrames(g, W, 100);
    // Red emergency lamp: a caged housing on the wall with its lens; the glow is a separate additive sprite.
    g.fillStyle = '#16130f';
    g.fillRect(6.4 * R, 17 * R, 6 * R, 4.6 * R);
    const lens = g.createRadialGradient(9.4 * R, 19.3 * R, 0, 9.4 * R, 19.3 * R, 2.6 * R);
    lens.addColorStop(0, '#ff9a86');
    lens.addColorStop(0.5, '#d83024');
    lens.addColorStop(1, '#781410');
    g.fillStyle = lens;
    g.beginPath(); g.ellipse(9.4 * R, 19.3 * R, 2.2 * R, 1.8 * R, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(138,138,128,0.4)';
    g.fillRect(6.4 * R, 17 * R, 6 * R, 0.6 * R);
    // Stencilled level marker on the wall (a short bar and an arrow up): no letters, readable in both languages.
    g.fillStyle = 'rgba(214,206,186,0.16)';
    g.fillRect(34 * R, 20 * R, 8 * R, 1.4 * R);
    g.beginPath();
    g.moveTo(38 * R, 12 * R); g.lineTo(41.2 * R, 17 * R); g.lineTo(34.8 * R, 17 * R); g.fill();
  });
}

/** A round steel duct standing in the slot: cylinder shading, flange collars with bolts, a louvred inlet, rust under the collars. Passes through the slab zone. */
function duct(g: CanvasRenderingContext2D, x: number, w: number, y0: number, y1: number): void {
  const body = g.createLinearGradient((x - w / 2) * R, 0, (x + w / 2) * R, 0);
  body.addColorStop(0, '#2c3234');
  body.addColorStop(0.2, '#8e969a');
  body.addColorStop(0.38, '#a4acae');
  body.addColorStop(0.7, '#5a6264');
  body.addColorStop(1, '#22282a');
  g.fillStyle = body;
  g.fillRect((x - w / 2) * R, y0 * R, w * R, (y1 - y0) * R);
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect((x + w * 0.22) * R, y0 * R, 0.6 * R, (y1 - y0) * R);
  g.fillStyle = 'rgba(244,246,240,0.3)';
  g.fillRect((x - w * 0.32) * R, y0 * R, 1.1 * R, (y1 - y0) * R);
  for (const y of [10, 48, 84, 101, 114]) {
    if (y < y0 || y > y1) continue;
    const col = g.createLinearGradient((x - w / 2 - 1.4) * R, 0, (x + w / 2 + 1.4) * R, 0);
    col.addColorStop(0, '#3e4446');
    col.addColorStop(0.3, '#b2b8b8');
    col.addColorStop(1, '#2a3032');
    g.fillStyle = col;
    g.fillRect((x - w / 2 - 1.4) * R, (y - 1.8) * R, (w + 2.8) * R, 3.6 * R);
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.fillRect((x - w / 2 - 1.4) * R, (y + 1.3) * R, (w + 2.8) * R, 0.6 * R);
    for (const bx of [-w / 2 - 0.4, -w / 6, w / 6, w / 2 + 0.4]) {
      g.fillStyle = 'rgba(24,26,26,0.9)';
      g.beginPath(); g.arc((x + bx) * R, y * R, 0.5 * R, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = 'rgba(122,64,28,0.2)';
    g.fillRect((x - w / 4) * R, (y + 2) * R, 1.2 * R, 8 * R);
  }
}

/** A ventilation stack section (46 x 116): the duct in front of the dark back wall, a louvred inlet low on the wall. */
export function ventTexture(top: boolean): Texture {
  return tex(top ? 'vent-top' : 'vent', 46, 116, (g, W, H) => {
    backWall(g, W, H, 100, 5202);
    // Louvred inlet on the wall, beside the duct.
    g.fillStyle = '#0c0b0a';
    g.fillRect(6 * R, 58 * R, 9 * R, 12 * R);
    for (let i = 0; i < 6; i++) {
      g.fillStyle = '#6a6e6c';
      g.fillRect(6 * R, (59 + i * 1.9) * R, 9 * R, 0.9 * R);
      g.fillStyle = 'rgba(232,230,216,0.3)';
      g.fillRect(6 * R, (59 + i * 1.9) * R, 9 * R, 0.3 * R);
    }
    g.fillStyle = '#4a4e4c';
    g.fillRect(5.2 * R, 57.2 * R, 10.6 * R, 0.8 * R);
    g.fillRect(5.2 * R, 70 * R, 10.6 * R, 0.8 * R);
    sideFrames(g, W, 100);
    // The slab zone below the floor line: concrete with the duct going through it.
    const slab = g.createLinearGradient(0, 97 * R, 0, 116 * R);
    slab.addColorStop(0, '#5c5a56');
    slab.addColorStop(1, '#2c2b29');
    g.fillStyle = slab;
    g.fillRect(0, 97 * R, W, 19 * R);
    g.fillStyle = 'rgba(232,226,208,0.42)';
    g.fillRect(0, 97 * R, W, 0.9 * R);
    if (top) {
      // The fan housing: a round cowl with a bolted ring and a dark well (the blades are a separate rotating sprite), a cable up into the ceiling.
      const ring = g.createRadialGradient(23 * R, 24 * R, 8 * R, 23 * R, 24 * R, 15 * R);
      ring.addColorStop(0, '#2e3436');
      ring.addColorStop(0.55, '#90989a');
      ring.addColorStop(1, '#3a4042');
      g.fillStyle = ring;
      g.beginPath(); g.arc(23 * R, 24 * R, 14.6 * R, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#0a0c0c';
      g.beginPath(); g.arc(23 * R, 24 * R, 10.6 * R, 0, Math.PI * 2); g.fill();
      for (let a = 0; a < 8; a++) {
        g.fillStyle = 'rgba(22,24,24,0.9)';
        g.beginPath(); g.arc((23 + Math.cos(a * Math.PI / 4) * 12.6) * R, (24 + Math.sin(a * Math.PI / 4) * 12.6) * R, 0.55 * R, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = 'rgba(244,246,240,0.3)';
      g.beginPath(); g.arc(23 * R, 24 * R, 14.6 * R, Math.PI * 1.05, Math.PI * 1.55); g.arc(23 * R, 24 * R, 13.6 * R, Math.PI * 1.55, Math.PI * 1.05, true); g.fill();
      duct(g, 23, 15, 38, 116);
    } else duct(g, 23, 15, 0, 116);
  });
}

/** The fan: five curved blades round a hub (22 x 22), rotated by infra.ts. */
export function fanTexture(): Texture {
  return tex('fan', 22, 22, (g, W) => {
    const c = W / 2;
    for (let i = 0; i < 5; i++) {
      g.save();
      g.translate(c, c);
      g.rotate((i / 5) * Math.PI * 2);
      const bl = g.createLinearGradient(0, 0, 0, -9.4 * R);
      bl.addColorStop(0, '#6c7274');
      bl.addColorStop(1, '#2a3032');
      g.fillStyle = bl;
      g.beginPath();
      g.moveTo(-1.1 * R, -1.6 * R);
      g.bezierCurveTo(-4.6 * R, -4 * R, -4.2 * R, -8.4 * R, -0.8 * R, -9.6 * R);
      g.bezierCurveTo(1.8 * R, -8.2 * R, 2.6 * R, -4 * R, 1.4 * R, -1.6 * R);
      g.fill();
      g.fillStyle = 'rgba(236,238,230,0.3)';
      g.beginPath();
      g.moveTo(-1.1 * R, -1.8 * R);
      g.bezierCurveTo(-3.6 * R, -4.4 * R, -3.4 * R, -7.8 * R, -0.8 * R, -9 * R);
      g.bezierCurveTo(-2.8 * R, -6.4 * R, -2.4 * R, -3.6 * R, -0.4 * R, -1.8 * R);
      g.fill();
      g.restore();
    }
    const hub = g.createRadialGradient(c - R, c - R, 0, c, c, 2.8 * R);
    hub.addColorStop(0, '#b0b6b6');
    hub.addColorStop(1, '#2c3234');
    g.fillStyle = hub;
    g.beginPath(); g.arc(c, c, 2.6 * R, 0, Math.PI * 2); g.fill();
  });
}

/** The bulkhead leaf (13.6 x 57, the size of the doorway), hinged on its left edge: a heavy steel slab with a hazard stripe, a locking wheel and bolts along the closing edge. */
export function bulkheadLeafTexture(): Texture {
  return tex('bulkhead-leaf', 13.6, 57, (g, W, H) => {
    const body = g.createLinearGradient(0, 0, W, 0);
    body.addColorStop(0, '#9a9ea0');
    body.addColorStop(0.1, '#767b7e');
    body.addColorStop(0.7, '#5a6064');
    body.addColorStop(1, '#40464a');
    g.fillStyle = body;
    g.fillRect(0, 0, W, H);
    const shine = g.createLinearGradient(0, 0, 0, H);
    shine.addColorStop(0, 'rgba(255,255,248,0.16)');
    shine.addColorStop(0.5, 'rgba(255,255,248,0)');
    shine.addColorStop(1, 'rgba(0,0,0,0.3)');
    g.fillStyle = shine;
    g.fillRect(0, 0, W, H);
    // Hazard stripe across the head.
    g.fillStyle = '#c99a2e';
    g.fillRect(0, 3 * R, W, 5 * R);
    g.fillStyle = '#1c1a16';
    for (let x = -5; x < 16; x += 3.6) {
      g.beginPath();
      g.moveTo(x * R, 8 * R); g.lineTo((x + 1.8) * R, 8 * R); g.lineTo((x + 4) * R, 3 * R); g.lineTo((x + 2.2) * R, 3 * R);
      g.fill();
    }
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, 8 * R, W, 0.5 * R);
    // Panel seams, the locking wheel (rim, four spokes, hub) and the bolts on the closing edge.
    g.fillStyle = 'rgba(0,0,0,0.34)';
    g.fillRect(0, 15 * R, W, 0.5 * R);
    g.fillRect(0, 49 * R, W, 0.5 * R);
    g.fillStyle = 'rgba(255,255,248,0.16)';
    g.fillRect(0, 15.5 * R, W, 0.3 * R);
    const cx = W * 0.5, cy = 32 * R;
    g.fillStyle = '#25292b';
    g.beginPath(); g.arc(cx, cy, 4.8 * R, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#8a9092';
    g.beginPath(); g.arc(cx, cy, 4.1 * R, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#3a4042';
    g.beginPath(); g.arc(cx, cy, 3.1 * R, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#9ca2a4';
    for (let i = 0; i < 4; i++) {
      g.save();
      g.translate(cx, cy);
      g.rotate((i * Math.PI) / 4);
      g.fillRect(-0.5 * R, -4 * R, 1 * R, 8 * R);
      g.restore();
    }
    g.fillStyle = '#22282a';
    g.beginPath(); g.arc(cx, cy, 1.3 * R, 0, Math.PI * 2); g.fill();
    for (const y of [12, 24, 42, 52]) {
      g.fillStyle = 'rgba(26,28,28,0.9)';
      g.beginPath(); g.arc((W / R - 1.5) * R, y * R, 0.75 * R, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(214,218,208,0.3)';
      g.beginPath(); g.arc((W / R - 1.7) * R, (y - 0.25) * R, 0.3 * R, 0, Math.PI * 2); g.fill();
    }
    // Rust and chipped paint.
    g.fillStyle = 'rgba(122,64,28,0.22)';
    g.fillRect(2.4 * R, 40 * R, 1.4 * R, 10 * R);
    g.fillRect(9 * R, 17 * R, 1.2 * R, 7 * R);
    g.fillStyle = 'rgba(0,0,0,0.2)';
    g.fillRect(0, H - 1.8 * R, W, 1.8 * R);
  });
}

/** Two welded steel straps crossed over a sealed door (13.6 x 57), with weld spatter. */
export function strapsTexture(): Texture {
  return tex('bulkhead-straps', 13.6, 57, g => {
    const bar = (x0: number, y0: number, x1: number, y1: number) => {
      g.fillStyle = '#2e3234';
      g.beginPath();
      g.moveTo((x0 - 1.4) * R, y0 * R); g.lineTo((x0 + 1.4) * R, y0 * R); g.lineTo((x1 + 1.4) * R, y1 * R); g.lineTo((x1 - 1.4) * R, y1 * R);
      g.fill();
      g.fillStyle = 'rgba(190,196,192,0.34)';
      g.beginPath();
      g.moveTo((x0 - 1.4) * R, y0 * R); g.lineTo((x0 - 0.6) * R, y0 * R); g.lineTo((x1 - 0.6) * R, y1 * R); g.lineTo((x1 - 1.4) * R, y1 * R);
      g.fill();
    };
    bar(2, 8, 11.6, 53);
    bar(11.6, 8, 2, 53);
    for (const [x, y] of [[2, 8], [11.6, 8], [2, 53], [11.6, 53], [6.8, 30.5]]) {
      g.fillStyle = 'rgba(255,170,70,0.5)';
      g.beginPath(); g.arc(x * R, y * R, 1.2 * R, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#1c1e1e';
      g.beginPath(); g.arc(x * R, y * R, 0.85 * R, 0, Math.PI * 2); g.fill();
    }
  });
}

/** The sign hung on a sealed door (15 x 5.6): the word on a red-bordered enamel plate. Cached per text. */
export function sealedSignTexture(text: string): Texture {
  return tex(`sealed|${text}`, 15, 5.6, (g, W, H) => {
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(0.4 * R, 0.6 * R, W - 0.4 * R, H - 0.6 * R);
    g.fillStyle = '#c8bca2';
    g.fillRect(0, 0, W - 0.4 * R, H - 0.6 * R);
    g.fillStyle = rgba(0xb02a20, 1);
    g.fillRect(0.4 * R, 0.4 * R, W - 1.2 * R, H - 1.4 * R);
    g.fillStyle = '#e8dcc0';
    g.fillRect(0.9 * R, 0.9 * R, W - 2.2 * R, H - 2.4 * R);
    g.fillStyle = '#a02018';
    g.font = `800 ${3.1 * R}px Rubik, "Arial Black", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, (W - 0.4 * R) / 2, (H - 0.6 * R) / 2 + 0.15 * R, W - 3 * R);
  });
}
