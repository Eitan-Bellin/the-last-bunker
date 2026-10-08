import { mod, SAVES, crashlog, clearCrash } from './lib.mjs';
import { readFileSync } from 'node:fs';
const m = await mod();
const base = JSON.parse(readFileSync(SAVES + 'e30-seed1.json', 'utf8'));
const muts = {
  unknownBuildingType: r => { r.buildings[3].type = 'removedRoom'; },
  unknownBuildingTypeWithWorkers: r => { r.buildings[3].type = 'removedRoom'; r.buildings[3].assignedSurvivorIds = [r.survivors[0].id]; r.survivors[0].assignedBuildingId = r.buildings[3].id; },
  unknownResearch: r => { r.research.ghost = { id: 'ghost', completed: false, progress: 3, total: 10, isResearching: true }; },
  unknownResearchQueue: r => { r.researchQueue = ['ghostA', 'ghostB']; },
  unknownActiveEvent: r => { r.activeEvent = { id: 'zzz', data: {}, at: 1 }; },
  unknownProject: r => { r.activeProjectId = 'zzz'; },
  unknownLaw: r => { r.longGame.policy.laws = ['ghostLaw']; },
  unknownMutator: r => { r.longGame.meta.mutators = ['ghostMut']; },
  unknownScenario: r => { r.longGame.meta.scenario = 'ghost'; },
  unknownDifficulty: r => { r.longGame.meta.difficulty = 'ghost'; r.longGame.meta.diffLowest = 'ghost'; },
  actOutOfRange: r => { r.longGame.meta.act = 99; },
  act0: r => { r.longGame.meta.act = 0; },
  era9: r => { r.era = 9; },
  floorsHuge: r => { r.currentFloors = 500; },
  floors0: r => { r.currentFloors = 0; },
  noLongGame: r => { delete r.longGame; },
  noStats: r => { delete r.stats; },
  noPrestige: r => { delete r.prestige; },
  prestigeNoUpgrades: r => { r.prestige = { rebirthCount: 1 }; },
  noResearchObj: r => { delete r.research; },
  nullSurvivorFields: r => { r.survivors[0].traits = undefined; },
  survivorNoStats: r => { delete r.survivors[0].stats; },
  buildingNoPosition: r => { delete r.buildings[2].position; },
  buildingMissingAssigned: r => { delete r.buildings[2].assignedSurvivorIds; },
  dailyUnknownOrder: r => { r.daily = { day: 99999, orders: [{ id: 'ghost', p: 0, need: 3, done: false, claimed: false }], spare: ['ghost'], swapped: false, chest: false, streak: 0, lastClaim: -1, graceUsed: false, frag: 0 }; },
  layoutBadDoor: r => { r.layout = { v: 1, ext: {}, doors: { '3:7': 'weird', 'x:y': 'open' }, infra: [{ id: 'inf_1', kind: 'ghostKind', floor: 2, x: 4 }], surfaceOpen: true }; },
  layoutNull: r => { r.layout = null; },
  mapEmpty: r => { r.explorationMap = []; },
  missionGhost: r => { r.activeMissions = [{ id: 'm1', hexQ: 99, hexR: 99, survivorIds: ['ghost'], startedAt: 0, duration: 10, eta: 10 }]; },
  incidentGhostRoom: r => { r.incidents = [{ id: 'i1', kind: 'fire', buildingId: 'nope', severity: 1, progress: 0, startedAt: 0 }]; },
  incidentUnknownKind: r => { r.incidents = [{ id: 'i1', kind: 'ghost', buildingId: r.buildings[0].id, severity: 1, progress: 0, startedAt: 0 }]; },
  disasterUnknownKind: r => { r.danger.disasters = [{ id: 'd1', kind: 'ghost', buildingId: null, startedAt: 0, deadline: 1 }]; },
  doorWaitingGarbage: r => { r.doorWaiting = [{ id: 's_1', name: 'x' }]; },
  ruinUnknownRestore: r => { r.ruins = [{ id: 'r_1', floor: 1, x: 1, w: 2, kind: 'wreck', restoresTo: 'removedRoom', flooded: false, progress: 0, total: 10, started: true, lore: null }]; },
  storyUnknownFlag: r => { r.storyFlags.push('story:ghost', 'ending:ghost', 'project:ghost', 'sys:ghost'); },
  achievementsGhost: r => { r.achievements.push('ghost'); },
  timestampFuture: r => { r.timestamp = Date.now() + 1e10; },
  timestampNull: r => { r.timestamp = null; },
  timestamp0: r => { r.timestamp = 0; },
  timestampStr: r => { r.timestamp = 'x'; },
  randomSeedNaN: r => { r.randomSeed = null; },
  resourcesPartial: r => { r.resources = { food: { amount: 5 } }; },
  resourceNullAmount: r => { r.resources.food.amount = null; r.resources.water.cap = null; },
  maxPopNull: r => { r.maxPopulation = null; },
  survivorsDupId: r => { r.survivors[1].id = r.survivors[0].id; },
  buildingsDupId: r => { r.buildings[1].id = r.buildings[0].id; },
  twoBuildingsSameSlot: r => { r.buildings[1].position = { ...r.buildings[0].position }; },
};
const results = [];
for (const [name, fn] of Object.entries(muts)) {
  const raw = JSON.parse(JSON.stringify(base));
  raw.timestamp = Date.now() - 7200_000;
  try { fn(raw); } catch (e) { results.push([name, 'MUTATOR-ERR ' + e.message]); continue; }
  const det = m.installDeterminism(5);
  const e = new m.GameEngine();
  let stored = JSON.stringify(raw);
  e.saveManager = { loadSafe: async () => ({ status: 'ok', state: JSON.parse(stored) }), saveJson: async j => { stored = j; }, snapshotPrev: async () => true };
  clearCrash();
  let initErr = null, tickErr = null;
  try { await e.init(); } catch (x) { initErr = String(x.stack ?? x).split('\n').slice(0, 2).join(' | '); }
  if (!initErr) { try { for (let i = 0; i < 300; i++) e.advance(1, 'online'); e.simulate(3600, 0.8); } catch (x) { tickErr = String(x.stack ?? x).split('\n').slice(0, 2).join(' | '); } }
  const log = crashlog();
  let ser = null; try { ser = JSON.stringify(e.stateManager.state).length; } catch (x) { ser = 'SERIALIZE-FAIL'; }
  results.push([name, initErr ? 'INIT-THROW ' + initErr : tickErr ? 'TICK-THROW ' + tickErr : log.length ? 'logged: ' + [...new Set(log)].slice(0, 3).join(' || ') : 'ok']);
  det.restore();
}
for (const [n, r] of results) console.log(n.padEnd(30), r.slice(0, 330));
