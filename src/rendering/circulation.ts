import { Rectangle, Texture } from 'pixi.js';
import { CORR_BEAM, CORR_DECK, CORR_RAIL, SLOT_W } from './geom';

/**
 * [airy2:D1] Art of the front corridor of a floor (flag `airy`): a walkway deck that recedes toward the rooms, the railing on its front edge and the beam face of the
 * slab edge. All three are one slot wide (46) and tile along x, so the segments of a floor join; frontChunks.ts places them as plain sprites (they batch).
 * Pure drawing, cached, no per-frame work.
 */

const R = 4;
const cache = new Map<string, Texture>();

function canvasTex(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, W: number, H: number) => void): Texture {
  let t = cache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = Math.round(w * R);
  c.height = Math.round(h * R);
  const g = c.getContext('2d')!;
  draw(g, c.width, c.height);
  t = Texture.from(c);
  cache.set(key, t);
  return t;
}

/** The first `w` units (rounded to a quarter) of a slot-wide texture, for a segment shorter than a slot; a full slot is the texture itself. */
export function slotSlice(base: Texture, w: number): Texture {
  if (w >= SLOT_W - 0.01) return base;
  const q = Math.max(1, Math.round(w * 4));
  const key = `${base.uid}:${q}`;
  let t = cache.get(key);
  if (!t) {
    t = new Texture({ source: base.source, frame: new Rectangle(0, 0, (q / 4) * R, base.frame.height) });
    cache.set(key, t);
  }
  return t;
}

/** Depth of row k of N on the deck: dense toward the back (top), wide toward the viewer, so the planes read as foreshortened. */
const rowY = (k: number, n: number, h: number): number => h * Math.pow(k / n, 1.55);

/**
 * The deck: a floor plane seen from above and in front. Dark at the back where it meets the room's kerb, lit at the front edge; rows of grating plates that grow
 * toward the viewer, cross seams, a painted yellow edge line, and a bright lip.
 */
export function deckTexture(): Texture {
  return canvasTex('deck', SLOT_W, CORR_DECK, (g, W, H) => {
    const base = g.createLinearGradient(0, 0, 0, H);
    base.addColorStop(0, 'rgb(70,70,66)');
    base.addColorStop(0.4, 'rgb(112,110,100)');
    base.addColorStop(1, 'rgb(176,170,152)');
    g.fillStyle = base;
    g.fillRect(0, 0, W, H);
    // Rows of plates, growing toward the viewer: a dark seam and the pale lip of the next plate under it (the cross seams are drawn per cluster, converging; see seamsOf).
    const N = 6;
    for (let k = 0; k < N; k++) {
      const y0 = rowY(k, N, CORR_DECK) * R, y1 = rowY(k + 1, N, CORR_DECK) * R;
      g.fillStyle = 'rgba(8,8,10,0.5)';
      g.fillRect(0, y1 - 0.5 * R, W, 0.5 * R);
      g.fillStyle = `rgba(236,232,214,${0.1 + 0.16 * (k / N)})`;
      g.fillRect(0, y1, W, 0.4 * R);
      // grating slots, longer toward the front
      const hh = y1 - y0;
      g.fillStyle = 'rgba(10,10,12,0.28)';
      for (let c = 0; c < 8; c++) g.fillRect((c * SLOT_W / 8 + 0.9) * R, y0 + hh * 0.34, (SLOT_W / 8 - 1.8) * R, hh * 0.32);
    }
    // Back kerb shadow (where the deck meets the rooms).
    const kerb = g.createLinearGradient(0, 0, 0, 6 * R);
    kerb.addColorStop(0, 'rgba(0,0,0,0.6)');
    kerb.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = kerb;
    g.fillRect(0, 0, W, 6 * R);
    // The yellow line, a little in from the front edge.
    g.fillStyle = 'rgba(236,182,64,0.92)';
    g.fillRect(0, (CORR_DECK - 6.6) * R, W, 1.2 * R);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(0, (CORR_DECK - 5.4) * R, W, 0.5 * R);
    // Front lip catching light.
    g.fillStyle = 'rgba(240,236,220,0.55)';
    g.fillRect(0, (CORR_DECK - 1) * R, W, 1 * R);
  });
}

/**
 * Cross seams of the deck as thin quads (x of the front end, and the vanishing x of the cluster): from the front edge they lean toward it at the back, which is
 * the one-point perspective of a corridor seen along its width. Appends [x0 back, x1 front] pairs into `out` (reused).
 */
export function seamBack(xFront: number, vpx: number): number {
  return vpx + (xFront - vpx) * 0.9;
}

/**
 * The railing on the deck's front edge (46 x CORR_RAIL): kick plate, balusters, a mid rail and a top rail with a lit arris, posts at the slot edge and the middle.
 * Transparent between the bars, so the corridor and the walkers behind it show through.
 */
export function railTexture(): Texture {
  return canvasTex('rail', SLOT_W, CORR_RAIL, (g, W, H) => {
    const H0 = H / R;
    // balusters
    g.fillStyle = 'rgba(30,32,34,0.9)';
    for (let x = 1.9; x < SLOT_W; x += 3.83) g.fillRect(x * R, 1.4 * R, 0.8 * R, (H0 - 3.6) * R);
    g.fillStyle = 'rgba(190,192,184,0.32)';
    for (let x = 1.9; x < SLOT_W; x += 3.83) g.fillRect(x * R, 1.4 * R, 0.25 * R, (H0 - 3.6) * R);
    // mid rail
    g.fillStyle = 'rgba(46,48,50,0.96)';
    g.fillRect(0, 6.2 * R, W, 1.1 * R);
    // kick plate
    g.fillStyle = 'rgba(40,42,44,0.97)';
    g.fillRect(0, (H0 - 2.4) * R, W, 2.4 * R);
    g.fillStyle = 'rgba(210,208,196,0.3)';
    g.fillRect(0, (H0 - 2.4) * R, W, 0.5 * R);
    // top rail
    g.fillStyle = 'rgba(58,60,62,0.98)';
    g.fillRect(0, 0, W, 1.8 * R);
    g.fillStyle = 'rgba(226,224,210,0.72)';
    g.fillRect(0, 0, W, 0.6 * R);
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.fillRect(0, 1.8 * R, W, 0.5 * R);
    // posts
    for (const px of [0.9, SLOT_W / 2, SLOT_W - 0.9]) {
      g.fillStyle = 'rgba(44,46,48,0.99)';
      g.fillRect((px - 1.1) * R, 0, 2.2 * R, H);
      g.fillStyle = 'rgba(214,212,198,0.38)';
      g.fillRect((px - 1.1) * R, 0, 0.5 * R, H);
    }
  });
}

/** The beam face of the slab edge under the deck (46 x CORR_BEAM): a hazard-striped nosing, dark steel with rivets, a shadow edge. */
export function beamTexture(): Texture {
  return canvasTex('beam', SLOT_W, CORR_BEAM, (g, W, H) => {
    const P = 2.875;
    for (let x = 0, k = 0; x < SLOT_W - 0.01; x += P, k++) {
      g.fillStyle = k % 2 ? 'rgba(26,24,20,0.98)' : 'rgba(217,164,65,0.97)';
      g.fillRect(x * R, 0, P * R, 1.5 * R);
    }
    const face = g.createLinearGradient(0, 1.5 * R, 0, H);
    face.addColorStop(0, 'rgba(92,94,92,0.98)');
    face.addColorStop(0.18, 'rgba(66,68,68,0.98)');
    face.addColorStop(1, 'rgba(24,24,26,0.98)');
    g.fillStyle = face;
    g.fillRect(0, 1.5 * R, W, H - 1.5 * R);
    g.fillStyle = 'rgba(230,228,214,0.3)';
    g.fillRect(0, 1.5 * R, W, 0.5 * R);
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(0, H - 0.9 * R, W, 0.9 * R);
    g.fillStyle = 'rgba(160,162,156,0.55)';
    for (let x = 2; x < SLOT_W; x += 5.75) {
      g.beginPath();
      g.arc(x * R, 3.7 * R, 0.5 * R, 0, Math.PI * 2);
      g.fill();
    }
    // splice plates at the slot edge
    g.fillStyle = 'rgba(20,20,22,0.55)';
    g.fillRect(0, 1.5 * R, 0.5 * R, H);
  });
}

/** Run and rise of one stair flight in the towers (a flight is 38 across and 36 high: 43 degrees), and how many flights make a floor. */
export const FLIGHT_RUN = 38;
export const FLIGHT_RISE = 36;
export const FLIGHTS_PER_FLOOR = 4;
/** Half the distance between the left and the right landing: where a person climbing zig-zags to. */
export const TOWER_AMP = FLIGHT_RUN / 2;

/**
 * One storey of a stair tower (54 x 144, from the lane of a floor down to the lane of the next one): four flights that switch back, landings at both ends, steel
 * stringers with treads, handrails with posts, a corner post on each side and a caged lamp. A person climbing it (walkers.ts) zig-zags between u = 8 and u = 46.
 * Open steel: the rock shaft behind shows between the bars.
 */
export function towerTexture(): Texture {
  return canvasTex('tower', 54, 144, (g, W, H) => {
    const P = 144;
    const uL = 8, uR = 46;
    const tread = (x0: number, y0: number, x1: number, y1: number) => {
      // a flight from (x0, y0) up to (x1, y1) (y1 < y0): stringer, treads, rail
      const n = 10;
      const dx = (x1 - x0) / n, dy = (y1 - y0) / n;
      // stringer (a thick dark diagonal under the treads)
      g.fillStyle = 'rgba(30,32,34,0.97)';
      g.beginPath();
      g.moveTo(x0 * R, (y0 + 1) * R); g.lineTo(x1 * R, (y1 + 1) * R); g.lineTo(x1 * R, (y1 + 6.5) * R); g.lineTo(x0 * R, (y0 + 6.5) * R);
      g.closePath(); g.fill();
      g.fillStyle = 'rgba(150,152,146,0.45)';
      g.beginPath();
      g.moveTo(x0 * R, (y0 + 1) * R); g.lineTo(x1 * R, (y1 + 1) * R); g.lineTo(x1 * R, (y1 + 1.8) * R); g.lineTo(x0 * R, (y0 + 1.8) * R);
      g.closePath(); g.fill();
      for (let i = 0; i < n; i++) {
        const tx = x0 + dx * i, ty = y0 + dy * i;
        // riser (dark) and tread (lit top, dark slot below)
        g.fillStyle = 'rgba(18,18,20,0.95)';
        g.fillRect(Math.min(tx, tx + dx) * R, (ty + dy) * R, Math.abs(dx) * R, (-dy + 0.2) * R);
        g.fillStyle = 'rgba(176,176,164,0.97)';
        g.fillRect(Math.min(tx, tx + dx) * R, (ty + dy - 0.5) * R, Math.abs(dx) * R, 1.0 * R);
        g.fillStyle = 'rgba(60,62,62,0.95)';
        g.fillRect(Math.min(tx, tx + dx) * R, (ty + dy + 0.5) * R, Math.abs(dx) * R, 0.7 * R);
      }
      // handrail: posts every third tread and a sloped rail, 13 above the treads
      g.strokeStyle = 'rgba(214,170,64,0.96)';
      g.lineWidth = 1.05 * R;
      g.beginPath(); g.moveTo(x0 * R, (y0 - 13) * R); g.lineTo(x1 * R, (y1 - 13) * R); g.stroke();
      g.strokeStyle = 'rgba(36,38,40,0.92)';
      g.lineWidth = 0.55 * R;
      for (let i = 0; i <= n; i += 3) {
        const px = x0 + dx * i, py = y0 + dy * i;
        g.beginPath(); g.moveTo(px * R, (py - 13) * R); g.lineTo(px * R, py * R); g.stroke();
      }
      g.beginPath(); g.moveTo(x0 * R, (y0 - 6) * R); g.lineTo(x1 * R, (y1 - 6) * R); g.stroke();
    };
    const landing = (cx: number, y: number) => {
      // a grated platform 12 wide with a lit nosing and a beam face under it
      g.fillStyle = 'rgba(88,90,88,0.98)';
      g.fillRect((cx - 6.5) * R, (y - 1) * R, 13 * R, 2.2 * R);
      g.fillStyle = 'rgba(226,222,206,0.7)';
      g.fillRect((cx - 6.5) * R, (y - 1) * R, 13 * R, 0.6 * R);
      g.fillStyle = 'rgba(26,28,30,0.97)';
      g.fillRect((cx - 6.5) * R, (y + 1.2) * R, 13 * R, 4 * R);
      g.fillStyle = 'rgba(216,168,60,0.95)';
      g.fillRect((cx - 6.5) * R, (y + 1.2) * R, 13 * R, 0.9 * R);
    };
    // Flights from the bottom (floor f+1 lane at v = P) up to the top (v = 0); the landings sit at v = 108, 72, 36 and at both ends.
    const ys = [P, P - 36, P - 72, P - 108, 0];
    // Back wall panel of steel lattice between the posts (very faint), so the tower has a body against the rock.
    g.strokeStyle = 'rgba(70,74,76,0.35)';
    g.lineWidth = 0.5 * R;
    for (let k = 0; k < 8; k++) {
      const y = k * 18;
      g.beginPath(); g.moveTo(3 * R, y * R); g.lineTo(51 * R, (y + 18) * R); g.moveTo(51 * R, y * R); g.lineTo(3 * R, (y + 18) * R); g.stroke();
    }
    for (let i = 0; i < 4; i++) {
      const up = i % 2 === 0; // flight 0 climbs left to right
      tread(up ? uL : uR, ys[i], up ? uR : uL, ys[i + 1]);
    }
    for (let i = 0; i <= 4; i++) landing(i % 2 === 0 ? uL - 1 : uR + 1, ys[i]);
    // corner posts
    for (const px of [2.2, 51.8]) {
      const gr = g.createLinearGradient((px - 1.4) * R, 0, (px + 1.4) * R, 0);
      gr.addColorStop(0, '#8a8e90');
      gr.addColorStop(0.4, '#4a4e50');
      gr.addColorStop(1, '#1e2022');
      g.fillStyle = gr;
      g.fillRect((px - 1.4) * R, 0, 2.8 * R, H);
      for (let y = 6; y < P; y += 12) {
        g.fillStyle = 'rgba(0,0,0,0.5)';
        g.fillRect((px - 1.4) * R, y * R, 2.8 * R, 0.6 * R);
      }
    }
    // Caged lamp on the left post at the middle landing level.
    g.fillStyle = 'rgba(20,18,14,0.95)';
    g.fillRect(3.4 * R, 56 * R, 4.6 * R, 4.4 * R);
    g.fillStyle = 'rgba(255,196,110,0.98)';
    g.fillRect(4.1 * R, 57 * R, 3.2 * R, 2.8 * R);
    // level stripe: the tower's floor is painted on the post (an arrow up)
    g.fillStyle = 'rgba(224,172,60,0.9)';
    g.beginPath();
    g.moveTo(51.8 * R, 88 * R); g.lineTo(54 * R, 92 * R); g.lineTo(49.6 * R, 92 * R); g.fill();
  });
}
