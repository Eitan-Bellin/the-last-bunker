/**
 * gfx-p0 rooms: dev page that lays out every room painting (all tiers) and both halls with their live layers,
 * so FX spots can be checked against the painted props without a save. `?type=canteen` filters, `?z=3` zooms,
 * `?power=0.4` dims, `?nofx` hides the FX spots (lamp glows only), `?q=low|medium|high` sets the quality tier.
 */
import { Application, Container, Text } from 'pixi.js';
import { ArtLibrary } from '../src/art/ArtLibrary';
import { HALL_KEYS, PAINTED_TYPES, artEntry, composedKey } from '../src/art/registry';
import { composedDistrictTypes, composedMeta, composedTypes } from '../src/rendering/roomComposer';
import { roomSlots } from '../src/data/buildingDefs';
import { buildPaintedRoom, setRoomFxQuality, type RoomFxQuality } from '../src/rendering/paintedRoom';
import { ROOM_H, SLAB, SLOT_W } from '../src/rendering/layout';
import { buildRoomVisual, type RoomVisual } from '../src/rendering/roomArt';
import { seeded } from '../src/rendering/draw';

const q = new URLSearchParams(location.search);
const zoom = Number(q.get('z') ?? 2);
const power = Number(q.get('power') ?? 1);
const only = q.get('type')?.split(',') ?? null;
const noFx = q.has('nofx');
setRoomFxQuality((q.get('q') as RoomFxQuality) ?? 'high');

async function main(): Promise<void> {
  const app = new Application();
  await app.init({ resizeTo: window, background: 0x111111, antialias: true, resolution: devicePixelRatio, autoDensity: true });
  document.body.appendChild(app.canvas);
  await Promise.all([ArtLibrary.loadMeta(), ArtLibrary.loadBalance()]);
  const keys: { key: string; W: number; H: number }[] = [];
  // [plan4:BL-6] composed rooms (drawn in code) are listed after the painted ones; `?type=` filters both, `?tier=1` shows one tier.
  const tiers = q.has('tier') ? [Number(q.get('tier'))] : [0, 1, 2];
  for (const t of [...PAINTED_TYPES as string[], ...composedTypes().filter(c => !(PAINTED_TYPES as string[]).includes(c))]) {
    if (only && !only.includes(t)) continue;
    for (const tier of tiers) keys.push({ key: `rooms/${t}-${tier}`, W: (composedKey(`rooms/${t}-${tier}`)?.slots ?? roomSlots(t as never)) * SLOT_W, H: ROOM_H });
  }
  // [plan4:BL-7] composed districts (`?type=geothermal`): four slots wide, three looks.
  for (const t of composedDistrictTypes()) {
    if (only && !only.includes(t)) continue;
    for (const tier of tiers) keys.push({ key: `districts/${t}-${tier}`, W: (composedKey(`districts/${t}-${tier}`)?.slots ?? 4) * SLOT_W, H: ROOM_H });
  }
  if (!only || only.includes('halls')) for (const h of HALL_KEYS) keys.push({ key: `halls/${h}`, W: 3 * SLOT_W, H: 2 * ROOM_H + SLAB });
  // [plan4:BL-6] bake time of every composed room (ms, first request), and the lights / effects / spots / set data of each, for the brief and the perf table.
  const bake: [string, number][] = [];
  const metas: Record<string, unknown> = {};
  for (const k of keys) {
    const ck = composedKey(k.key);
    if (ck?.painted !== false) continue;
    const t0 = performance.now();
    ArtLibrary.get(k.key);
    bake.push([k.key, +(performance.now() - t0).toFixed(1)]);
    metas[k.key] = composedMeta(ck.type, ck.tier, ck.slots);
  }
  (window as unknown as { __bake: [string, number][]; __meta: Record<string, unknown> }).__bake = bake;
  (window as unknown as { __meta: Record<string, unknown> }).__meta = metas;
  await ArtLibrary.preload(keys.map(k => k.key));
  const world = new Container();
  world.scale.set(zoom);
  app.stage.addChild(world);
  const visuals: RoomVisual[] = [];
  let x = 4, y = 4, rowH = 0;
  const maxW = window.innerWidth / zoom;
  // [plan4:BL-6] ?code=type,type: the live-drawn stand-in look (buildRoomVisual), to compare against the composed one.
  const codeTypes = q.get('code')?.split(',') ?? [];
  for (const t of codeTypes) {
    const W = roomSlots(t as never) * SLOT_W;
    if (x + W > maxW && x > 4) { x = 4; y += ROOM_H + 12; }
    const v = buildRoomVisual(t as never, W, false, false, seeded(7));
    v.container.position.set(x, y);
    world.addChild(v.container);
    visuals.push(v);
    x += W + 6;
    rowH = ROOM_H;
  }
  for (const k of codeTypes.length ? [] : keys) {
    const tex = ArtLibrary.get(k.key);
    const entry = artEntry(k.key);
    if (!tex || !entry) continue;
    if (x + k.W > maxW && x > 4) {
      x = 4;
      y += rowH + 12;
      rowH = 0;
    }
    const v = buildPaintedRoom(tex, noFx ? { ...entry, fx: [] } : entry, k.W, false, false, q.has('mirror'), seeded(7), k.H, ArtLibrary.balanceFor(k.key));
    v.container.position.set(x, y);
    const label = new Text({ text: k.key.split('/')[1], style: { fill: 0xffff00, fontSize: 7 } });
    label.position.set(x + 2, y + 1);
    world.addChild(v.container, label);
    visuals.push(v);
    x += k.W + 6;
    rowH = Math.max(rowH, k.H);
  }
  // [plan4:BL-6] measured brightness of every shown picture (composed rooms report their own), for the style gate.
  (window as unknown as { __lums: [string, number | null][] }).__lums = keys.map(k => [k.key, ArtLibrary.lumOf(k.key)]);
  (window as unknown as { __ready: boolean }).__ready = true;
  const log = document.getElementById('log')!;
  let t = 0, cost = 0, n = 0;
  app.ticker.add(tk => {
    t += tk.deltaMS / 1000;
    const t0 = performance.now();
    for (const v of visuals) v.animate(t, power);
    cost += performance.now() - t0;
    if (++n % 60 === 0) {
      log.textContent = `${visuals.length} rooms, animate ${(cost / 60).toFixed(3)} ms/frame`;
      (window as unknown as { __fxCost: number }).__fxCost = cost / 60;
      cost = 0;
    }
  });
}
void main();
