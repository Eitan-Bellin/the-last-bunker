import { mod } from './lib.mjs';
const m = await mod();
const { GameEngine } = m;
let acc = 0, firstR = null, firstPop = null; const orig = GameEngine.prototype.advance;
GameEngine.prototype.advance = function (dt, md, eff) {
  orig.call(this, dt, md, eff); acc += dt; if (acc < 30) return; acc = 0;
  const s = this.stateManager.state;
  if (!firstR) { const g = s.survivors.filter(p => p.assignedBuildingId?.startsWith('r_') && !s.ruins.some(r => r.id === p.assignedBuildingId)); if (g.length) { firstR = { play: Math.round(s.stats.totalPlayTime), ids: g.map(p => p.assignedBuildingId + ' onMission=' + p.isOnMission + ' hp=' + Math.round(p.health) + ' child=' + !!p.child), ruinsNow: s.ruins.map(r => r.id + (r.started ? 's' : '')), cleared: s.ruinsCleared, buildings: s.buildings.length, mode: md }; } }
  if (!firstPop && s.survivors.length > s.maxPopulation) firstPop = { play: Math.round(s.stats.totalPlayTime), pop: s.survivors.length, max: s.maxPopulation, floors: s.currentFloors, kids: s.survivors.filter(p => p.child).length, beds: m.Buildings ? null : null, act: s.longGame.meta.act, door: s.doorWaiting.length };
  this.__last = s;
};
let engineRef; const O = GameEngine.prototype.advance;
const res = await m.runSim({ mode: 'casual', days: 0.15, seed: 1, difficulty: 'warden', daily: 'half' });
console.log('firstGhostRuin', JSON.stringify(firstR)); console.log('firstPopOver', JSON.stringify(firstPop));
