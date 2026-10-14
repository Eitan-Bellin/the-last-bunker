/** Survivors walking the path graph — they take stairs and ramps, never teleport. */
import { Container, Graphics } from 'pixi.js';
import { T } from './tokens';
import { edges, nodes, pois, type EdgeKind } from './scene';
import { pick, rng, scale } from './util';
import type { Dyn } from './lighting';

type Adj = Record<string, { to: string; d: number; kind: EdgeKind }[]>;

const adj: Adj = {};
for (const [a, b, kind] of edges) {
  const [ax, ay] = nodes[a], [bx, by] = nodes[b];
  const d = Math.hypot(bx - ax, by - ay);
  (adj[a] ??= []).push({ to: b, d, kind });
  (adj[b] ??= []).push({ to: a, d, kind });
}

function path(from: string, to: string): { id: string; kind: EdgeKind }[] {
  const dist: Record<string, number> = { [from]: 0 };
  const prev: Record<string, { id: string; kind: EdgeKind }> = {};
  const open = new Set([from]);
  while (open.size) {
    let cur = '', best = Infinity;
    for (const n of open) if (dist[n] < best) { best = dist[n]; cur = n; }
    open.delete(cur);
    if (cur === to) break;
    for (const e of adj[cur] ?? []) {
      const nd = best + e.d * (e.kind === 'walk' ? 1 : 1.4);
      if (nd < (dist[e.to] ?? Infinity)) { dist[e.to] = nd; prev[e.to] = { id: cur, kind: e.kind }; open.add(e.to); }
    }
  }
  const out: { id: string; kind: EdgeKind }[] = [];
  let n = to;
  while (n !== from && prev[n]) { out.unshift({ id: n, kind: prev[n].kind }); n = prev[n].id; }
  return out;
}

interface Walker {
  c: Container;
  legL: Graphics; legR: Graphics; arm: Graphics; body: Container;
  at: string;
  route: { id: string; kind: EdgeKind }[];
  x: number; y: number;
  wait: number;
  phase: number;
  speed: number;
  lantern?: Dyn;
  lanternG?: Graphics;
}

export function buildPeople(addLight: (x: number, y: number) => Dyn) {
  const r = rng(701);
  const layer = new Container();
  const list: Walker[] = [];
  const P = T.palette;
  const Hh = T.people.height;
  const k = Hh / 46;
  const poiTotal = pois.reduce((s, p) => s + p[1], 0);
  const pickPoi = () => {
    let v = r() * poiTotal;
    for (const [id, w] of pois) { v -= w; if (v <= 0) return id; }
    return pois[0][0];
  };

  for (let i = 0; i < T.people.count; i++) {
    const coat = pick(P.coat, r), skin = pick(P.skin, r), pants = scale(pick(P.coat, r), 0.6);
    const c = new Container();
    const shadow = new Graphics().ellipse(0, 0, 11 * k, 2.6 * k).fill({ color: 0x000000, alpha: 0.4 });
    const body = new Container();
    const legL = new Graphics().roundRect(-2.6 * k, 0, 5.2 * k, 19 * k, 2 * k).fill(pants);
    const legR = new Graphics().roundRect(-2.6 * k, 0, 5.2 * k, 19 * k, 2 * k).fill(scale(pants, 0.8));
    legL.y = legR.y = -19 * k;
    const arm = new Graphics().roundRect(-2 * k, 0, 4 * k, 15 * k, 2 * k).fill(scale(coat, 0.75));
    arm.y = -36 * k;
    const torso = new Graphics()
      .roundRect(-7 * k, -38 * k, 14 * k, 21 * k, 4 * k).fill(coat)
      .rect(-7 * k, -22 * k, 14 * k, 2.5 * k).fill(scale(coat, 0.6));
    if (r() < 0.5) torso.roundRect(-11 * k, -36 * k, 6 * k, 14 * k, 2 * k).fill(scale(coat, 0.55)); // backpack
    const head = new Graphics().circle(0.5 * k, -43 * k, 5.6 * k).fill(skin);
    head.arc(0.5 * k, -43 * k, 5.9 * k, Math.PI * 1.05, Math.PI * 1.95).fill(scale(skin, 0.35)); // hair/cap
    // a faint warm rim on the face side so figures separate from dark walls
    const rimG = new Graphics().rect(5.6 * k, -37 * k, 1.4 * k, 19 * k).fill({ color: 0xffd0a0, alpha: 0.25 });
    body.addChild(legR, arm, torso, legL, head, rimG);
    c.addChild(shadow, body);
    const at = pickPoi();
    const [x, y] = nodes[at];
    const w: Walker = {
      c, legL, legR, arm, body, at, route: [], x, y, wait: r() * 3,
      phase: r() * 10, speed: T.people.speed * (0.8 + r() * 0.4),
    };
    if (i < T.people.lanternCarriers) {
      const lg = new Graphics()
        .moveTo(0, 0).lineTo(0, 5 * k).stroke({ width: 1, color: 0x222222 })
        .roundRect(-2.5 * k, 5 * k, 5 * k, 7 * k, 1.5).fill(0xffd890);
      lg.x = 8 * k; lg.y = -24 * k;
      body.addChild(lg);
      w.lanternG = lg;
      w.lantern = addLight(x, y);
    }
    c.x = x; c.y = y;
    layer.addChild(c);
    list.push(w);
  }

  return {
    layer,
    update(t: number, dt: number) {
      for (const w of list) {
        let moving = false;
        if (w.wait > 0) {
          w.wait -= dt;
          if (w.wait <= 0) w.route = path(w.at, pickPoi());
        } else if (w.route.length) {
          const step = w.route[0];
          const [tx, ty] = nodes[step.id];
          const dx = tx - w.x, dy = ty - w.y;
          const d = Math.hypot(dx, dy);
          const sp = w.speed * (step.kind === 'walk' ? 1 : T.people.stairSpeed) * dt;
          if (d <= sp) {
            w.x = tx; w.y = ty; w.at = step.id; w.route.shift();
            if (!w.route.length) w.wait = T.people.idleMin + r() * (T.people.idleMax - T.people.idleMin);
          } else {
            w.x += (dx / d) * sp; w.y += (dy / d) * sp;
            if (Math.abs(dx) > 0.5) w.c.scale.x = dx < 0 ? -1 : 1;
          }
          moving = true;
        } else {
          w.wait = 0.5;
        }
        const kind = w.route[0]?.kind;
        if (moving) w.phase += dt * T.people.stepHz * Math.PI * 2 * (kind && kind !== 'walk' ? 0.8 : 1);
        const s = moving ? Math.sin(w.phase) : 0;
        w.legL.rotation = s * 0.5;
        w.legR.rotation = -s * 0.5;
        w.arm.rotation = -s * 0.45 + (moving ? 0 : 0.05 * Math.sin(t + w.phase));
        w.body.y = moving ? -Math.abs(Math.cos(w.phase)) * 1.6 : Math.sin(t * 1.4 + w.phase) * 0.4;
        w.c.x = w.x; w.c.y = w.y;
        if (w.lantern) {
          w.lantern.x = w.x + 8 * w.c.scale.x;
          w.lantern.y = w.y - 16;
          w.lantern.on = true;
          if (w.lanternG) w.lanternG.rotation = s * 0.25;
        }
      }
    },
  };
}
