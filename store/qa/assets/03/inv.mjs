// Invariant checker wrapped around the real bot simulation. usage: node inv.mjs <mode> <days> <seed> <difficulty> [rebirths]
import { mod } from './lib.mjs';
const [mode = 'casual', days = '30', seed = '1', difficulty = 'warden', rebirths = '0'] = process.argv.slice(2);
const m = await mod();
const { GameEngine, Doors, Buildings, GS, Wings } = m;
const found = new Map();
const note = (key, detail, state) => {
  const e = found.get(key) ?? { n: 0, first: null };
  e.n++;
  if (!e.first) e.first = `${detail} @play=${Math.round(state.stats.totalPlayTime)}s act=${state.longGame?.meta.act} floors=${state.currentFloors} pop=${state.survivors.length}`;
  found.set(key, e);
};
const stuck = { event: new Map(), dig: new Map(), door: 0, mission: new Map(), proj: new Map() };
let acc = 0, calls = 0;
const orig = GameEngine.prototype.advance;
GameEngine.prototype.advance = function (dt, mode_, eff) {
  orig.call(this, dt, mode_, eff);
  acc += dt;
  if (acc < 120) return;
  const dtAcc = acc; acc = 0; calls++;
  const s = this.stateManager.state;
  try { check(this, s, mode_, dtAcc); } catch (e) { note('CHECKER-THROW', String(e), s); }
};
function check(e, s, md, dtAcc) {
  // I1 finite
  const bad = [];
  (function walk(o, p, d) { if (d > 9 || bad.length > 3) return; if (typeof o === 'number') { if (!Number.isFinite(o) && !/\.cap$/.test(p)) bad.push(p); return; } if (Array.isArray(o)) { o.forEach((v, i) => walk(v, p + '[' + i + ']', d + 1)); return; } if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, p + '.' + k, d + 1); })(s, '', 0);
  if (bad.length) note('I1 non-finite number', bad.join(','), s);
  // I2 resources
  for (const [k, r] of Object.entries(s.resources)) {
    if (r.amount < -1e-6) note('I2 negative resource ' + k, String(r.amount), s);
    if (Number.isFinite(r.cap) && r.cap > 0 && r.amount > r.cap + 1 && !['credits', 'isotope7', 'blueprints', 'vaultCoins'].includes(k)) note('I2 resource over cap ' + k, `${r.amount}>${r.cap}`, s);
  }
  // I3/I4 assignments
  const bById = new Map(s.buildings.map(b => [b.id, b]));
  const sById = new Map(s.survivors.map(p => [p.id, p]));
  const prefixes = new Set();
  for (const p of s.survivors) {
    const a = p.assignedBuildingId;
    if (!a) continue;
    if (bById.has(a)) { if (!bById.get(a).assignedSurvivorIds.includes(p.id)) note('I3 survivor->room but room does not list survivor', `${p.id}->${a}`, s); continue; }
    if (a.startsWith('r_')) { if (!s.ruins.some(r => r.id === a)) note('I3 survivor on missing ruin', a, s); continue; }
    if (a === 'p_dig' || a === 'p_dig2') { const slot = a === 'p_dig' ? 0 : 1; const dg = slot ? s.longGame.dig2 : s.longGame.dig; if (!dg || dg.floor == null) note('I3 survivor on dig crew but no dig running', a, s); continue; }
    if (a.startsWith('p_')) { prefixes.add('p_'); continue; }
    prefixes.add(a.slice(0, 3));
    note('I3 unknown assignment id', a, s);
  }
  for (const b of s.buildings) {
    const seen = new Set();
    for (const id of b.assignedSurvivorIds) {
      const p = sById.get(id);
      if (!p) { note('I4 room lists missing survivor', `${b.id}:${id}`, s); continue; }
      if (p.assignedBuildingId !== b.id) note('I4 room lists survivor whose assignment differs', `${b.id}:${id}->${p.assignedBuildingId}`, s);
      if (seen.has(id)) note('I4 duplicate in room', `${b.id}:${id}`, s);
      seen.add(id);
    }
    const def = Buildings.getDef(b.type);
    if (def && b.assignedSurvivorIds.filter(id => !sById.get(id)?.child).length > (def.maxWorkers ?? 0)) note('I4 over maxWorkers', `${b.type} ${b.assignedSurvivorIds.length}>${def.maxWorkers}`, s);
  }
  // I5 geometry
  for (let i = 0; i < s.buildings.length; i++) {
    const a = s.buildings[i];
    const fa = a.position.floor, fh = Buildings.roomFloors(a.type), wa = Buildings.roomSlots(a.type);
    if (!Buildings.isDistrict(a.type)) {
      for (let f = fa; f < fa + fh; f++) { const ext = GS.floorExtent(s, f); if (a.position.x < -ext.w || a.position.x + wa > ext.e) note('I5 room outside floor extent', `${a.type}@${f}:${a.position.x}`, s); }
      if (fa + fh > s.currentFloors && fa >= 0) note('I5 room beyond currentFloors', `${a.type}@${fa}`, s);
    }
    for (let j = i + 1; j < s.buildings.length; j++) {
      const b = s.buildings[j];
      if (b.position.floor + Buildings.roomFloors(b.type) - 1 < fa || b.position.floor > fa + fh - 1) continue;
      if (a.position.x < b.position.x + Buildings.roomSlots(b.type) && a.position.x + wa > b.position.x) note('I5 overlapping rooms', `${a.type}/${b.type}@${fa}`, s);
    }
    for (const r of s.ruins ?? []) if (r.floor >= fa && r.floor < fa + fh && a.position.x < r.x + r.w && a.position.x + wa > r.x) note('I5 room overlaps ruin', `${a.type}`, s);
    if (Doors.infraOccupies(s, fa, a.position.x, wa) && !Buildings.isDistrict(a.type)) note('I5 room overlaps infra column', a.type, s);
  }
  // I6 doors
  const orph = Doors.orphanDoorKeys(s);
  if (orph.length) note('I6 orphan doors', orph.join(','), s);
  // I7 pop
  if (s.survivors.length > s.maxPopulation + 0.5 && !s.survivors.some(x => false)) note('I7 pop > maxPopulation', `${s.survivors.length}>${s.maxPopulation}`, s);
  // I8 incidents
  for (const inc of s.incidents ?? []) if (inc.buildingId && !bById.has(inc.buildingId)) note('I8 incident on missing room', inc.kind, s);
  for (const d of s.danger.disasters ?? []) if (d.buildingId && !bById.has(d.buildingId)) note('I8 disaster on missing room', d.kind, s);
  // I9 event stuck (online only)
  if (md === 'online' && s.activeEvent) { const k = s.activeEvent.id; const t0 = stuck.event.get(k) ?? s.stats.totalPlayTime; stuck.event.set(k, t0); if (s.stats.totalPlayTime - t0 > 1800) note('I9 activeEvent open >30min play', k, s); } else stuck.event.clear();
  // I11 research
  for (const [id, n] of Object.entries(s.research)) if (n.completed && n.isResearching) note('I11 completed node still researching', id, s);
  for (const id of s.researchQueue ?? []) if (s.research[id]?.completed) note('I11 completed node in queue', id, s);
  // I12 dig without crew
  for (const slot of [0, 1]) { const dg = slot ? s.longGame.dig2 : s.longGame.dig; const key = 'dig' + slot; if (dg && dg.floor != null) { const crew = s.survivors.filter(p => p.assignedBuildingId === (slot ? 'p_dig2' : 'p_dig')).length; const t0 = stuck.dig.get(key + dg.floor + (dg.side ?? '')) ?? s.stats.totalPlayTime; stuck.dig.set(key + dg.floor + (dg.side ?? ''), t0); if (crew === 0 && s.stats.totalPlayTime - t0 > 7200 && md === 'online') note('I12 dig crewless >2h play', `${key} floor ${dg.floor} ${dg.kind}`, s); } }
  // I13 doors frozen
  const shut = Doors.shutDoorCount(s);
  if (shut > 0 && md === 'online') { if (!e.constructor.name) {} }
  // I14 maxPopulation vs beds
  if (s.maxPopulation < 0) note('I14 negative maxPop', String(s.maxPopulation), s);
  // I15 children in non-child slots
  for (const p of s.survivors) if (p.child && p.assignedBuildingId && bById.has(p.assignedBuildingId)) { const t = bById.get(p.assignedBuildingId).type; if (!['nursery', 'school'].includes(t) && !Buildings.getDef(t)?.effects) note('I15 child assigned to ' + t, p.id, s); }
  // I16 survivors with NaN-able fields
  for (const p of s.survivors) if (p.health > 100.0001 || p.happiness > 100.0001 || p.happiness < -0.0001) { note('I16 survivor stat out of range', `${p.health}/${p.happiness}`, s); break; }
  // I17 duplicate survivor ids / building ids
  if (new Set(s.survivors.map(p => p.id)).size !== s.survivors.length) note('I17 duplicate survivor ids', '', s);
  if (new Set(s.buildings.map(b => b.id)).size !== s.buildings.length) note('I17 duplicate building ids', '', s);
  // I18 power: doors drain
  const pr = s.powerRatio;
  if (pr < 0.3) note('I18 powerRatio < 0.3 (deep blackout)', `${pr} shutDoors=${shut}`, s);
}
const t0 = Date.now();
const res = await m.runSim({ mode, days: +days, seed: +seed, difficulty, rebirths: +rebirths, daily: 'half' });
console.log(`RUN ${mode} ${days}d seed ${seed} ${difficulty} rebirths ${rebirths}: ${((Date.now() - t0) / 1000).toFixed(0)}s wall, play ${(res.playSeconds / 3600).toFixed(1)}h, checks ${calls}`);
console.log('milestones', JSON.stringify(Object.fromEntries(Object.entries(res.milestones).slice(0, 40).map(([k, v]) => [k, +(v.wall / 86400).toFixed(1)]))));
console.log('deaths', JSON.stringify(res.deaths), 'idle', JSON.stringify(res.idle?.share), 'warnings', JSON.stringify(res.warnings));
console.log('final', JSON.stringify(res.final).slice(0, 600));
for (const [k, v] of found) console.log(`INV ${k} x${v.n} first: ${v.first}`);
if (!found.size) console.log('INV none violated');
