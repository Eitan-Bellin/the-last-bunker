import type { V3 } from './math';

/**
 * The walk graph: every node a point people stand on (x, floor y, lane z). Stair and ramp flights are single straight edges, so a
 * walker on them climbs or descends at the flight's slope. Destinations are the nodes people choose to go to.
 */
export const NODES: Record<string, V3> = {
  // surface and ramp
  sFar: [47, 0, -4], sFire: [42.2, 0, -8.2], sDoor: [40.7, 0, -4], rTop: [38, 0, -4], rBot: [24, -6, -4],
  // atrium L2 (the ramp arrives here)
  l2R: [21.5, -6, -4], l2Front: [22, -6, -1.2], l2B: [21.5, -6, -10.5], aPre: [17, -6, -10.5], aTop: [17, -6, -8.25], l2Crates: [8.5, -6, -10.5],
  // stair A down to L1
  aBot: [9, -11, -8.25], l1Corner: [7.6, -11, -10.4], l1Front: [6.5, -11, -1.3], bPre: [14.6, -11, -10.4], bTop: [14.6, -11, -8.25],
  // stair B down to the floor
  bBot: [22, -16, -8.25], f1: [22.5, -16, -5.5], fC: [9.5, -16, -1.6], fFront: [19.5, -16, -1.4], fTable: [16.6, -16, -6.9], fGen: [19.5, -16, -9], fL: [5.5, -16, -4],
  // corridor
  c1: [0, -16, -3], c2: [-8, -16, -3], c3: [-13.5, -16, -3],
  // district floor
  d0: [-16, -16, -3.6], dShack1: [-18.3, -16, -4.3], dWork: [-22.6, -16, -5.4], dMid: [-26.8, -16, -3.6], dGarden: [-30, -16, -3.3],
  dShack3: [-38.2, -16, -3.9], dW: [-41.2, -16, -3.2],
  // stair C up to the platform, the platform, the bridge and the lookout
  cBot: [-27, -16, -8.75], cTop: [-34, -11.5, -8.75], p1: [-34, -11.5, -10.3], pH4: [-38, -11.5, -10.3], pH5: [-31.8, -11.5, -10.3],
  pBr: [-29, -11.5, -10.3], br: [-24, -11.85, -10.3], lk0: [-19, -11.5, -10.3], lk: [-17.3, -11.5, -11.2],
  // the dark edge
  e1: [-44, -16, -3], dig: [-48.2, -16, -3.2],
};

const EDGES: [string, string][] = [
  ['sFar', 'sDoor'], ['sFire', 'sDoor'], ['sFar', 'sFire'], ['sDoor', 'rTop'], ['rTop', 'rBot'], ['rBot', 'l2R'],
  ['l2R', 'l2Front'], ['l2R', 'l2B'], ['l2B', 'aPre'], ['aPre', 'aTop'], ['aPre', 'l2Crates'],
  ['aTop', 'aBot'], ['aBot', 'l1Corner'], ['aBot', 'l1Front'], ['l1Corner', 'bPre'], ['bPre', 'bTop'], ['bTop', 'bBot'],
  ['bBot', 'f1'], ['bBot', 'fGen'], ['f1', 'fTable'], ['f1', 'fFront'], ['fFront', 'fC'], ['fC', 'fL'], ['fL', 'c1'],
  ['c1', 'c2'], ['c2', 'c3'], ['c3', 'd0'],
  ['d0', 'dShack1'], ['dShack1', 'dWork'], ['d0', 'dWork'], ['dWork', 'dMid'], ['dMid', 'dGarden'], ['dMid', 'cBot'],
  ['dGarden', 'dShack3'], ['dShack3', 'dW'], ['dW', 'e1'], ['e1', 'dig'],
  ['cBot', 'cTop'], ['cTop', 'p1'], ['p1', 'pH4'], ['p1', 'pH5'], ['pH5', 'pBr'], ['pBr', 'br'], ['br', 'lk0'], ['lk0', 'lk'],
];

/** Places people go to, with how often. */
export const DESTINATIONS: [string, number][] = [
  ['sFire', 1], ['sFar', 0.6], ['l2Front', 1], ['l2Crates', 0.7], ['l1Front', 1], ['fTable', 2], ['fGen', 1], ['fC', 1], ['c2', 0.5],
  ['dShack1', 1.4], ['dWork', 1.6], ['dGarden', 1.4], ['dShack3', 1.2], ['pH4', 1.2], ['pH5', 1], ['lk', 1.2], ['dig', 1.3],
];

/** Which edges are stairs or ramps (people slow down on them). */
export function isClimb(a: string, b: string): boolean {
  return Math.abs(NODES[a][1] - NODES[b][1]) > 0.4;
}

const adj = new Map<string, string[]>();
for (const [a, b] of EDGES) {
  if (!adj.has(a)) adj.set(a, []);
  if (!adj.has(b)) adj.set(b, []);
  adj.get(a)!.push(b);
  adj.get(b)!.push(a);
}

const dist = (a: string, b: string) => Math.hypot(NODES[a][0] - NODES[b][0], NODES[a][1] - NODES[b][1], NODES[a][2] - NODES[b][2]);

/** Shortest path (Dijkstra on a tiny graph). */
export function findPath(from: string, to: string): string[] {
  const d = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const open = new Set<string>([from]);
  while (open.size) {
    let cur = '';
    let best = Infinity;
    for (const n of open) if ((d.get(n) ?? Infinity) < best) { best = d.get(n)!; cur = n; }
    open.delete(cur);
    if (cur === to) break;
    for (const nb of adj.get(cur) ?? []) {
      const nd = best + dist(cur, nb);
      if (nd < (d.get(nb) ?? Infinity)) { d.set(nb, nd); prev.set(nb, cur); open.add(nb); }
    }
  }
  const path = [to];
  while (path[0] !== from) {
    const p = prev.get(path[0]);
    if (!p) return [from];
    path.unshift(p);
  }
  return path;
}
