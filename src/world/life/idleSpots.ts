/**
 * [world:C1-Li] Where off-duty people loiter in the city: the hub's balcony rails and bridge, the fire barrel and the bench on the plaza,
 * the pair of places beside the spine, the vestibules and the corridor in front of the rooms (style guide 7, architecture 6.2 "life").
 *
 * Presentation only: nothing here is read by the simulation. Who is idle is the game's decision; this only says where an idle person
 * stands for a while instead of waiting in the quarters. Node-safe and pure: the spots are a function of the layout, the choice and the
 * schedule are functions of the person's id and the clock, so the same person goes to the same places at the same times on every load.
 *
 * Built once per layout (flat typed arrays, no per-frame allocation); `pickSpot` and `outAt` allocate nothing.
 */
import { CITY as CITY_TOKENS, LIFE, type IdleSpotKind } from '../tokens';
import { laneY } from '../model/cityLayout';
import { polyBounds } from '../model/outline';
import { SHAFT_W } from '../../rendering/geom';
import type { CityLayout } from '../render/layoutTypes';

const KINDS: readonly IdleSpotKind[] = ['rail', 'barrel', 'bench', 'plaza', 'corridor'];
const MAX_SPOTS = 320;

/** The loiter places of one layout (struct of arrays). `taken` holds the slot index using a spot, or -1. */
export class IdleSpots {
  n = 0;
  sig = '';
  readonly x = new Float32Array(MAX_SPOTS);
  readonly y = new Float32Array(MAX_SPOTS);
  readonly floor = new Int16Array(MAX_SPOTS);
  readonly s = new Int8Array(MAX_SPOTS);
  /** Index into KINDS. */
  readonly kind = new Uint8Array(MAX_SPOTS);
  /** Facing while standing there: -1 west, 1 east. */
  readonly face = new Int8Array(MAX_SPOTS);
  /** 1 = sit (bench) when the set poses are in, else stand. */
  readonly sit = new Uint8Array(MAX_SPOTS);
  readonly taken = new Int16Array(MAX_SPOTS).fill(-1);

  kindOf(i: number): IdleSpotKind {
    return KINDS[this.kind[i]];
  }

  private add(x: number, y: number, floor: number, s: number, kind: IdleSpotKind, face: number, sit = false): void {
    if (this.n >= MAX_SPOTS) return;
    const i = this.n++;
    this.x[i] = x;
    this.y[i] = y;
    this.floor[i] = floor;
    this.s[i] = s;
    this.kind[i] = KINDS.indexOf(kind);
    this.face[i] = face < 0 ? -1 : 1;
    this.sit[i] = sit ? 1 : 0;
    this.taken[i] = -1;
  }

  /** Rebuilds the places from a layout (only when its signature changed). Spots in use keep nothing: the caller sends their people home. */
  build(layout: CityLayout): void {
    this.sig = layout.sig;
    this.n = 0;
    this.taken.fill(-1);
    const I = LIFE.idle, H = CITY_TOKENS.hub;
    for (const h of layout.hubs) {
      const fz = h.floors[h.floors.length - 1];
      const x0 = h.rect.x, x1 = h.rect.x + h.rect.w;
      // Balcony rails (every storey but the bottom one, whose balcony is the plaza): looking out over the atrium, toward the spine.
      for (const b of h.balconies) {
        if (b.floor === fz) continue;
        const face = b.side === 'w' ? 1 : -1;
        for (let x = b.x0 + I.railInset; x <= b.x1 - I.railInset; x += I.railStep) this.add(x, b.y, b.floor, h.s, 'rail', face);
      }
      if (h.bridge) {
        const br = h.bridge;
        let k = 0;
        for (let x = br.x0 + I.railInset; x <= br.x1 - I.railInset; x += I.railStep) this.add(x, br.y, br.floor, h.s, 'rail', k++ & 1 ? -1 : 1);
      }
      // The plaza of the bottom storey: the props are only drawn in the shelter hub (shell/hub.ts, stratum 1).
      const py = laneY(fz);
      if (h.s === 1) {
        const fx = x1 - H.wallW - 18;
        for (const dx of I.barrelRing) this.add(fx + dx, py, fz, h.s, 'barrel', dx < 0 ? 1 : -1);
        const bx = x0 + H.wallW + 28;
        for (const dx of I.benchSeats) this.add(bx + dx, py, fz, h.s, 'bench', dx < 18 ? 1 : -1, true);
      }
      // Two people chatting either side of the lift landing (facing each other across it).
      this.add(-I.plazaGap, py, fz, h.s, 'plaza', 1);
      this.add(SHAFT_W + I.plazaGap, py, fz, h.s, 'plaza', -1);
    }
    // Corridors: the vestibules, and the walkway in front of the rooms on each floor strip (from the hub end outward).
    for (const c of layout.cavities) {
      const id = c.id;
      if (id.startsWith('c:vest:')) {
        const f = +id.split(':')[2];
        const b = polyBounds(c.poly);
        const west = id.endsWith(':w');
        this.add(west ? b.x0 + I.vestInset : b.x1 - I.vestInset, laneY(f), f, c.s, 'corridor', west ? 1 : -1);
      } else if (id.startsWith('c:strip:')) {
        const f = +id.split(':')[2];
        const b = polyBounds(c.poly);
        const east = id.endsWith(':e');
        for (let k = 0; k < I.stripMax; k++) {
          const d = I.stripFirst + k * I.stripStep;
          const x = east ? b.x0 + d : b.x1 - d;
          if (east ? x > b.x1 - 30 : x < b.x0 + 30) break;
          this.add(x, laneY(f), f, c.s, 'corridor', (f + k) & 1 ? -1 : 1);
        }
      }
    }
  }

  /** Frees whatever spot slot `slot` held. */
  release(slot: number): void {
    for (let i = 0; i < this.n; i++) if (this.taken[i] === slot) this.taken[i] = -1;
  }

  /**
   * A free spot for a person, chosen by weight among the places within LIFE.idle.maxFloors of `homeFloor` in the same stratum
   * (`roll` 0..1 is the person's own deterministic roll for this cycle). -1 when none is free.
   */
  pick(homeFloor: number, homeX: number, stratum: number, roll: number, maxF: number = LIFE.idle.maxFloors): number {
    let total = 0;
    for (let i = 0; i < this.n; i++) total += this.weight(i, homeFloor, homeX, stratum, maxF);
    if (total <= 0) return -1;
    let r = roll * total;
    for (let i = 0; i < this.n; i++) {
      const w = this.weight(i, homeFloor, homeX, stratum, maxF);
      if (w <= 0) continue;
      r -= w;
      if (r < 0) return i;
    }
    return -1;
  }

  /** How much spot i draws a person from (homeFloor, homeX): its kind's weight, less the further it is; 0 when taken or out of reach. */
  private weight(i: number, homeFloor: number, homeX: number, stratum: number, maxF: number): number {
    const df = Math.abs(this.floor[i] - homeFloor);
    if (this.taken[i] >= 0 || this.s[i] !== stratum || df > maxF) return 0;
    return LIFE.idle.weights[KINDS[this.kind[i]]] / (1 + Math.abs(this.x[i] - homeX) / LIFE.idle.near + df);
  }

}

/** 32-bit hash of a string (FNV-1a), for the per-person schedule. */
export function idHash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Hash of a 32-bit value and a salt to [0, 1). */
export function roll01(h: number, salt: number): number {
  let x = Math.imul(h ^ Math.imul(salt + 0x9e3779b9, 0x85ebca6b), 0xc2b2ae35);
  x ^= x >>> 16;
  x = Math.imul(x, 0x27d4eb2f);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

/**
 * The loiter schedule: is a person (id hash `h`) out at clock time `t` (s)? Each person has their own cycle length (±20% of
 * LIFE.idle.cycle) and phase, and is out for `outShare` of it. `cycleIndex` gives which cycle it is (a new spot each cycle).
 */
export function outAt(h: number, t: number, cycle: number = LIFE.idle.cycle, share: number = LIFE.idle.outShare): boolean {
  const len = cycle * (0.8 + 0.4 * roll01(h, 1));
  const u = t / len + roll01(h, 2);
  return u - Math.floor(u) < share;
}

/** A worker's break schedule (LIFE.idle.breakCycle / breakShare), on a phase of its own. */
export function onBreakAt(h: number, t: number): boolean {
  return outAt(h ^ 0x5bd1e995, t, LIFE.idle.breakCycle, LIFE.idle.breakShare);
}

export function cycleIndex(h: number, t: number, cycle: number = LIFE.idle.cycle): number {
  const len = cycle * (0.8 + 0.4 * roll01(h, 1));
  return Math.floor(t / len + roll01(h, 2));
}
