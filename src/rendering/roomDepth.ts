import { Container, MeshSimple, Sprite, Texture } from 'pixi.js';
import { glowTexture } from '../art/ArtLibrary';

/**
 * [airy2:C1/C2/C3] A room as a deep alcove instead of a flat painting.
 *
 * The painting is the BACK WALL of a box seen from the front: the box is a front opening (the room's rectangle) joined to a smaller back rectangle by
 * four faces (ceiling, floor, left wall, right wall). The faces are ONE small mesh (40 vertices) with a cached, procedurally painted texture that already
 * holds the perspective (plates, ribs, seams converge on the vanishing point), so a room costs no Graphics at all. People stand on the floor face, in
 * front of the back wall, which is what makes them read as inside the room.
 *
 * Parallax: the back rectangle slides toward the middle of the screen as the room moves off-centre (a window box: a room left of the camera shows its
 * right wall). Only the mesh vertices and the back container's position/scale change, and only when the camera moved; hit areas live on the room root
 * and never move. `depthCam` is fed by BunkerRenderer once a picture.
 */

/** Perspective of the alcove (room units; ROOM_H is 100). The back wall ends up ~70% of the front opening. */
export const DEPTH = {
  /** Side inset per closed side, as a fraction of the room width (clamped to ixMin..ixMax). */
  ix: 0.19,
  ixMin: 7,
  ixMax: 30,
  /** Ceiling and floor depth for a one-floor room (two-storey halls get a little more). */
  top: 15,
  bottom: 21,
};

/** The camera in world units, written by BunkerRenderer.updateView every picture. `on` is false at far zoom and on Low quality (no parallax then). */
export const depthCam = { cx: 0, cy: 0, hw: 215, hh: 450, on: true };

export interface Box {
  ixL: number;
  ixR: number;
  it: number;
  ib: number;
}

/** Inset of the back rectangle for a room of this size; an open side (a same-kind neighbour) has no wall, so the back wall runs to the edge. */
export function boxFor(W: number, H: number, openL: boolean, openR: boolean): Box {
  const ix = Math.max(DEPTH.ixMin, Math.min(DEPTH.ixMax, W * DEPTH.ix));
  const tall = H > 150;
  return { ixL: openL ? 0 : ix, ixR: openR ? 0 : ix, it: DEPTH.top + (tall ? 3 : 0), ib: DEPTH.bottom + (tall ? 4 : 0) };
}

// ---------------------------------------------------------------- textures

const R = 2; // texture pixels per room unit
const texCache = new Map<string, Texture>();

type Ctx = CanvasRenderingContext2D;

function poly(ctx: Ctx, pts: number[][]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

function seg(ctx: Ctx, a: number[], b: number[], w: number, style: string): void {
  ctx.strokeStyle = style;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();
}

/** The neutral (front-on) picture of the four faces; the mesh warps it a little when the back wall slides. */
function paintShell(ctx: Ctx, W: number, H: number, b: Box): void {
  const x0 = b.ixL, x1 = W - b.ixR, y0 = b.it, y1 = H - b.ib;
  const sx = (x1 - x0) / W, sy = (y1 - y0) / H, s = (sx + sy) / 2;
  const k = 1 / s - 1;
  /** Fraction of the way from the front opening to the back wall of a point `z` (0..1) of the depth, with foreshortening. */
  const tz = (z: number): number => (1 - 1 / (1 + z * k)) / (1 - s);
  /** The point of the front plane (fx, fy) after going `t` of the way to its counterpart on the back wall. */
  const P = (fx: number, fy: number, t: number): number[] => [fx + (x0 + fx * sx - fx) * t, fy + (y0 + fy * sy - fy) * t];
  const roomy = W >= 92;

  // ---- ceiling: dark steel, ribs across, a tube light down the middle
  ctx.save();
  poly(ctx, [[0, 0], [W, 0], [x1, y0], [x0, y0]]);
  ctx.clip();
  let g = ctx.createLinearGradient(0, 0, 0, y0);
  g.addColorStop(0, '#5d636e');
  g.addColorStop(1, '#1b1d22');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, y0);
  for (let j = 1; j <= 6; j++) {
    const t = tz(j / 7), t2 = Math.min(1, t + 0.04);
    const a = P(0, 0, t), b2 = P(W, 0, t), c = P(W, 0, t2), d = P(0, 0, t2);
    poly(ctx, [a, b2, c, d]);
    ctx.fillStyle = 'rgba(6,7,9,0.55)';
    ctx.fill();
    seg(ctx, [a[0], a[1] + 0.2], [b2[0], b2[1] + 0.2], 0.5, 'rgba(255,255,255,0.14)');
  }
  const wl = Math.max(5, W * 0.1);
  const tl = 0.94;
  const fa = P(W / 2 - wl / 2, 0, 0), fb = P(W / 2 + wl / 2, 0, 0), ba = P(W / 2 - wl / 2, 0, tl), bb = P(W / 2 + wl / 2, 0, tl);
  g = ctx.createLinearGradient(0, 0, 0, y0);
  g.addColorStop(0, 'rgba(255,238,196,0.98)');
  g.addColorStop(1, 'rgba(255,214,150,0.45)');
  poly(ctx, [fa, fb, bb, ba]);
  ctx.fillStyle = g;
  ctx.fill();
  if (roomy) for (const u of [0.13, 0.87]) seg(ctx, P(W * u, 0, 0), P(W * u, 0, 0.96), 2.4, 'rgba(20,22,26,0.8)');
  ctx.restore();

  // ---- floor: warm plates receding, safety lines, a lit front lip
  ctx.save();
  poly(ctx, [[0, H], [W, H], [x1, y1], [x0, y1]]);
  ctx.clip();
  g = ctx.createLinearGradient(0, H, 0, y1);
  g.addColorStop(0, '#a09278');
  g.addColorStop(0.5, '#62594a');
  g.addColorStop(1, '#2a251c');
  ctx.fillStyle = g;
  ctx.fillRect(0, y1, W, H - y1);
  const cols = Math.max(3, Math.round(W / 23));
  for (let j = 1; j <= 9; j++) {
    const t = tz(j / 10);
    const a = P(0, H, t), b2 = P(W, H, t);
    seg(ctx, a, b2, 0.55, 'rgba(0,0,0,0.5)');
    seg(ctx, [a[0], a[1] - 0.45], [b2[0], b2[1] - 0.45], 0.4, 'rgba(255,240,210,0.13)');
  }
  for (let i = 0; i <= cols; i++) {
    const u = (i / cols) * W;
    seg(ctx, P(u, H, 0), P(u, H, 1), 0.55, 'rgba(0,0,0,0.42)');
    seg(ctx, [P(u, H, 0)[0] + 0.5, P(u, H, 0)[1]], [P(u, H, 1)[0] + 0.5, P(u, H, 1)[1]], 0.4, 'rgba(255,240,210,0.1)');
  }
  // Checker: every other plate a touch lighter (one polygon per plate would be too many; strips of the second row only).
  for (let i = 0; i < cols; i += 2) {
    const ua = (i / cols) * W, ub = ((i + 1) / cols) * W;
    poly(ctx, [P(ua, H, 0), P(ub, H, 0), P(ub, H, 1), P(ua, H, 1)]);
    ctx.fillStyle = 'rgba(255,236,200,0.045)';
    ctx.fill();
  }
  for (const u of [0.05, 0.95]) {
    if ((u < 0.5 && b.ixL === 0) || (u > 0.5 && b.ixR === 0)) continue;
    const w0 = 2.2;
    poly(ctx, [P(W * u - w0, H, 0), P(W * u + w0, H, 0), P(W * u + w0, H, 0.97), P(W * u - w0, H, 0.97)]);
    ctx.fillStyle = 'rgba(214,170,40,0.5)';
    ctx.fill();
  }
  // Lamp-lit sheen toward the middle, darkness in the corners where floor meets wall.
  g = ctx.createRadialGradient(W / 2, H, 2, W / 2, H, W * 0.6);
  g.addColorStop(0, 'rgba(255,230,180,0.34)');
  g.addColorStop(1, 'rgba(255,230,180,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, y1, W, H - y1);
  ctx.restore();
  // Front lip: a bright rim, then the shadow under it.
  ctx.fillStyle = 'rgba(255,228,168,0.75)';
  ctx.fillRect(0, H - 1.6, W, 0.9);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, H - 0.7, W, 0.7);

  // ---- side walls: panelled steel, a kick plate, cable trays; every line runs to the vanishing point
  const wall = (left: boolean): void => {
    const fx = left ? 0 : W, bx = left ? x0 : x1;
    ctx.save();
    poly(ctx, [[fx, 0], [fx, H], [bx, y1], [bx, y0]]);
    ctx.clip();
    const gx = ctx.createLinearGradient(fx, 0, bx, 0);
    gx.addColorStop(0, '#8e8d8a');
    gx.addColorStop(0.5, '#605f5e');
    gx.addColorStop(1, '#2a2a2b');
    ctx.fillStyle = gx;
    ctx.fillRect(Math.min(fx, bx), 0, Math.abs(bx - fx), H);
    // Horizontal bands along the depth (converging): upper trim, tray, kick plate.
    const along = (f0: number, f1: number, fill: string): void => {
      poly(ctx, [P(fx, H * f0, 0), P(fx, H * f0, 1), P(fx, H * f1, 1), P(fx, H * f1, 0)]);
      ctx.fillStyle = fill;
      ctx.fill();
    };
    along(0.0, 0.09, 'rgba(0,0,0,0.42)');
    along(0.1, 0.125, 'rgba(255,226,160,0.62)'); // a tube light running down the wall
    along(0.18, 0.205, 'rgba(15,16,19,0.7)');
    along(0.205, 0.215, 'rgba(255,255,255,0.12)');
    along(0.6, 0.64, 'rgba(176,152,88,0.55)');
    along(0.64, 1.0, 'rgba(0,0,0,0.3)');
    // Panel seams across, evenly spaced in depth.
    for (let j = 1; j <= 5; j++) {
      const t = tz(j / 6);
      const a = P(fx, 0, t), c = P(fx, H, t);
      seg(ctx, a, c, 0.7, 'rgba(0,0,0,0.5)');
      seg(ctx, [a[0] + (left ? 0.5 : -0.5), a[1]], [c[0] + (left ? 0.5 : -0.5), c[1]], 0.4, 'rgba(255,255,255,0.1)');
    }
    // Floor contact darkness.
    const gb = ctx.createLinearGradient(0, y1 - 4, 0, H);
    gb.addColorStop(0, 'rgba(0,0,0,0)');
    gb.addColorStop(1, 'rgba(0,0,0,0.4)');
    ctx.fillStyle = gb;
    ctx.fillRect(Math.min(fx, bx), y1 - 4, Math.abs(bx - fx), H);
    ctx.restore();
  };
  if (b.ixL > 0) wall(true);
  if (b.ixR > 0) wall(false);
}

function shellTexture(W: number, H: number, b: Box): Texture {
  const key = `${W}|${H}|${b.ixL}|${b.ixR}|${b.it}|${b.ib}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = Math.ceil(W * R);
  c.height = Math.ceil(H * R);
  const ctx = c.getContext('2d')!;
  ctx.scale(R, R);
  paintShell(ctx, W, H, b);
  const tex = Texture.from(c);
  texCache.set(key, tex);
  return tex;
}

let aoTex: Texture | null = null;
/** Soft dark rim for the back wall (depth fog: where it meets the ceiling, floor and side walls it sinks into shadow). White-on-black alpha, stretched per room. */
function aoTexture(): Texture {
  if (aoTex) return aoTex;
  const n = 64;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, v = (y + 0.5) / n;
      const d = Math.min(u, 1 - u, v * 1.4, (1 - v) * 1.1); // the ceiling and the wall's side edges sink deepest
      const t = Math.max(0, 1 - d / 0.3);
      const a = t * t * (3 - 2 * t);
      const i = (y * n + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 0;
      img.data[i + 3] = Math.round(255 * Math.min(1, a * 0.78));
    }
  }
  ctx.putImageData(img, 0, 0);
  aoTex = Texture.from(c);
  return aoTex;
}

// ---------------------------------------------------------------- the shell

export interface ShellLamp {
  /** x of the lamp as a fraction of the back wall's width. */
  fx: number;
  /** Width of the pool on the floor, in room units. */
  w: number;
  color: number;
  strength: number;
}

export interface RoomShell {
  /** The four faces (tinted by the room's light level). Goes under the back wall. */
  layer: Container;
  /** Lamp pools on the floor face (additive, own alpha). Above the faces, under the back wall. */
  pools: Container;
  /** Soft shadow over the back wall's rim. Above the back wall. */
  ao: Sprite;
  /** Parallax: nx, ny in -1..1 = where the room sits against the middle of the screen. Moves the back wall (`back`) and the faces to match. */
  place(back: Container, nx: number, ny: number): void;
  readonly box: Box;
}

const COLS = 4;

export function buildShell(W: number, H: number, openL: boolean, openR: boolean, lamps: ShellLamp[]): RoomShell {
  const box = boxFor(W, H, openL, openR);
  const layer = new Container();
  const pools = new Container();
  pools.eventMode = layer.eventMode = 'none';
  const n = 4 * (COLS + 1) * 2;
  const verts = new Float32Array(n * 2);
  const uvs = new Float32Array(n * 2);
  const idx = new Uint32Array(4 * COLS * 6);
  // Quad q: outer edge OA->OB (the front opening), inner edge IA->IB (the back wall); vertex rows i = 0..COLS along the edge.
  // Neutral inner corners per quad (ceiling, floor, left wall, right wall).
  const outer = [[0, 0, W, 0], [0, H, W, H], [0, 0, 0, H], [W, 0, W, H]];
  const inner = (x0: number, x1: number, y0: number, y1: number): number[][] => [[x0, y0, x1, y0], [x0, y1, x1, y1], [x0, y0, x0, y1], [x1, y0, x1, y1]];
  const writeInner = (x0: number, x1: number, y0: number, y1: number): void => {
    const inn = inner(x0, x1, y0, y1);
    for (let q = 0; q < 4; q++) {
      const o = outer[q], e = inn[q];
      for (let i = 0; i <= COLS; i++) {
        const f = i / COLS;
        const v = (q * (COLS + 1) + i) * 2 * 2;
        verts[v] = o[0] + (o[2] - o[0]) * f;
        verts[v + 1] = o[1] + (o[3] - o[1]) * f;
        verts[v + 2] = e[0] + (e[2] - e[0]) * f;
        verts[v + 3] = e[1] + (e[3] - e[1]) * f;
      }
    }
  };
  const nx0 = box.ixL, nx1 = W - box.ixR, ny0 = box.it, ny1 = H - box.ib;
  writeInner(nx0, nx1, ny0, ny1);
  for (let i = 0; i < verts.length; i += 2) {
    uvs[i] = verts[i] / W;
    uvs[i + 1] = verts[i + 1] / H;
  }
  let p = 0;
  for (let q = 0; q < 4; q++) {
    for (let i = 0; i < COLS; i++) {
      const a = (q * (COLS + 1) + i) * 2, b = a + 2, c = a + 1, d = a + 3; // a,b: front row; c,d: back row
      idx[p++] = a; idx[p++] = b; idx[p++] = c;
      idx[p++] = b; idx[p++] = d; idx[p++] = c;
    }
  }
  const mesh = new MeshSimple({ texture: shellTexture(W, H, box), vertices: verts, uvs, indices: idx });
  mesh.autoUpdate = false;
  layer.addChild(mesh);

  const pool = lamps.map(l => {
    const s = new Sprite(glowTexture());
    s.anchor.set(0.5);
    s.tint = l.color;
    s.blendMode = 'add';
    s.width = l.w;
    s.height = Math.max(8, l.w * 0.2);
    s.alpha = l.strength;
    pools.addChild(s);
    return { s, fx: l.fx };
  });

  const ao = new Sprite(aoTexture());
  ao.eventMode = 'none';
  ao.alpha = 0.9;

  const kx = Math.max(box.ixL, box.ixR) * 0.8;
  const ky = Math.min(box.it, box.ib) * 0.5;
  let lastX = 9, lastY = 9;
  const place = (back: Container, nx: number, ny: number): void => {
    if (Math.abs(nx - lastX) < 0.004 && Math.abs(ny - lastY) < 0.004) return;
    lastX = nx;
    lastY = ny;
    // Toward the middle of the screen: a room right of centre shows its left wall, so its back wall slides left (and the other way).
    const dx = -nx * kx, dy = -ny * ky;
    const x0 = nx0 + (box.ixL > 0 ? dx : 0), x1 = nx1 + (box.ixR > 0 ? dx : 0);
    const y0 = ny0 + dy, y1 = ny1 + dy;
    writeInner(x0, x1, y0, y1);
    mesh.geometry.getBuffer('aPosition').update();
    back.position.set(x0, y0);
    back.scale.set((x1 - x0) / W, (y1 - y0) / H);
    ao.position.set(x0 - 1, y0 - 1);
    ao.width = x1 - x0 + 2;
    ao.height = y1 - y0 + 2;
    const fy = y1 + (H - y1) * 0.45;
    for (const l of pool) l.s.position.set(x0 + l.fx * (x1 - x0), fy);
  };
  return { layer, pools, ao, place, box };
}
