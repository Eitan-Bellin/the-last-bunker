import { load } from './load.mjs';
import { readFileSync } from 'node:fs';
export const SAVES = '/home/user/last-bunker-qa/store/sim/saves-v6/';
let M;
export async function mod() { return (M ??= await load()); }
export async function mkEngine(file, opts = {}) {
  const m = await mod();
  const det = m.installDeterminism(opts.seed ?? 1);
  const e = new m.GameEngine();
  let stored = null;
  e.saveManager = { saveJson: async j => { stored = j; }, snapshotPrev: async () => true, loadSafe: async () => ({ status: 'missing', state: null }) };
  if (file) {
    const raw = JSON.parse(readFileSync(SAVES + file, 'utf8'));
    e.adoptState(raw);
  } else {
    e.setupNewGame();
    e.stateManager.applyDelta({ path: 'storyFlags', value: [...e.stateManager.state.storyFlags, 'intro:done'] });
  }
  return { e, m, det, sm: e.stateManager };
}
export function scan(obj, path = '', out = [], depth = 0) {
  if (depth > 12 || out.length > 40) return out;
  if (typeof obj === 'number') { if (!Number.isFinite(obj)) out.push(`${path}=${obj}`); return out; }
  if (Array.isArray(obj)) { obj.forEach((v, i) => scan(v, `${path}[${i}]`, out, depth + 1)); return out; }
  if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) scan(v, path ? `${path}.${k}` : k, out, depth + 1);
  return out;
}
export function negatives(s) {
  const out = [];
  for (const [k, r] of Object.entries(s.resources)) if (r.amount < 0 || r.amount > r.cap + 1e-6 && !['credits','isotope7','blueprints'].includes(k)) out.push(`res ${k} amt ${r.amount} cap ${r.cap}`);
  for (const p of s.survivors) { if (p.health < 0 || p.health > 100) out.push(`health ${p.id} ${p.health}`); if (p.happiness < 0 || p.happiness > 100) out.push(`happy ${p.id} ${p.happiness}`); }
  return out.slice(0, 20);
}
export function crashlog() {
  try { const l = JSON.parse(localStorage.getItem('lastbunker_crashlog') || '[]'); return l.map(x => `${x.kind}: ${x.msg} x${x.count}`); } catch { return ['?']; }
}
export function clearCrash() { localStorage.removeItem('lastbunker_crashlog'); }
export function run(e, seconds, dt = 1, mode = 'online') { for (let t = 0; t < seconds; t += dt) e.advance(dt, mode, 0.8); }
export function summary(s) {
  return { pop: s.survivors.length, maxPop: s.maxPopulation, bld: s.buildings.length, food: +s.resources.food.amount.toFixed(1), water: +s.resources.water.amount.toFixed(1), power: +s.resources.power.amount.toFixed(1), act: s.longGame?.meta.act, t: Math.round(s.stats.totalPlayTime) };
}
