import type { ExplorationHex, GameState, MissionReport, ResourceType, SurvivorState } from '../core/GameState';
import type { StateManager } from '../core/StateManager';
import type { SeededRandom } from '../core/Random';
import type { ResourceSystem } from './ResourceSystem';
import type { PopulationSystem } from './PopulationSystem';
import { bus } from '../core/EventBus';
import { SeededRandom as Rng } from '../core/Random';
import {
  BIOMES, FOOT_RADIUS, HEX_NEIGHBORS, LONG_TRIP_LOOT, LONG_TRIP_TIME, MAP_RADIUS, POIS, baseTripSeconds, distanceLootMult, hexDistance,
  type BiomeId,
} from '../data/surface';
import { hasFeature } from './ResearchSystem';
import { eventsFor, expeditionEvent } from '../data/expeditionEvents';
import { specTotal } from '../data/specializations';
import { metroSpeedup } from '../data/districts';
import type { ActiveMission, JournalEntry } from '../core/GameState';
import { projectExpeditionSpeed } from '../data/projects'; // [LateGame B1]
import { CARAVAN_CREW, CARGO_TIERS, TRADE_VALUE, ambushChance, cargoValue, getPartner, partnerOpen, relationLevel, tradeRate, specialKey, type CargoTier } from '../data/trade'; // [LateGame B2]
import { MASTERY_STEPS } from '../data/mastery'; // [LateGame B3]

/** Seconds the team waits for an answer before taking the cautious option. */
export const ANSWER_TIMEOUT = 180;

export const MAX_TEAM = 3;

export function hexKey(q: number, r: number): string {
  return `${q},${r}`;
}

/** Teams that can be out at once: two from the start, one more per "Scout teams" Genesis upgrade. */
export function maxTeams(state: GameState): number {
  return 2 + (state.prestige.upgrades['scoutTeams'] ?? 0);
}

const POI_POOL = ['supermarket', 'pharmacy', 'hardware', 'junkyard', 'library', 'survivorCamp', 'militaryDepot', 'abandonedLab', 'crashSite'];

/** One map cell: the wilder biomes and richer finds lie farther out. */
function makeHex(rnd: Rng, q: number, r: number): ExplorationHex {
  const d = hexDistance(q, r);
  let biome: BiomeId;
  if (d === 0) biome = 'bunker';
  else if (d <= 2) biome = rnd.chance(0.8) ? 'ruins' : 'wasteland';
  else if (d <= 4) biome = rnd.pick(['wasteland', 'wasteland', 'toxicForest', 'ruins', 'caves'] as BiomeId[]);
  else if (d <= 6) biome = rnd.pick(['shatteredCity', 'toxicForest', 'caves', 'wasteland'] as BiomeId[]);
  else if (d <= FOOT_RADIUS) biome = rnd.chance(0.6) ? 'militaryZone' : 'shatteredCity';
  else biome = rnd.pick(['militaryZone', 'militaryZone', 'shatteredCity', 'toxicForest', 'caves'] as BiomeId[]);

  let poi: string | null = null;
  if (d >= 1 && rnd.chance(d > FOOT_RADIUS ? 0.3 : 0.22)) {
    const tier = d <= 2 ? POI_POOL.slice(0, 6) : d <= 4 ? POI_POOL.slice(0, 8) : POI_POOL;
    poi = rnd.pick(tier);
  }
  return { x: q, y: r, revealed: d <= 1, biome, poi, explored: d === 0 };
}

export class ExplorationSystem {
  private sm: StateManager;
  private rng: SeededRandom;
  private resources: ResourceSystem;
  private population: PopulationSystem;
  private nextMissionId = 1;

  constructor(sm: StateManager, rng: SeededRandom, resources: ResourceSystem, population: PopulationSystem) {
    this.sm = sm;
    this.rng = rng;
    this.resources = resources;
    this.population = population;
  }

  isUnlocked(state: GameState): boolean {
    return hasFeature(state, 'surface');
  }

  /** Builds the map on first use; deterministic from the save's seed. */
  ensureMap(): void {
    const state = this.sm.state;
    if (state.explorationMap.length > 0) {
      this.nextMissionId = state.activeMissions.reduce((m, a) => Math.max(m, parseInt(a.id.slice(2), 10) + 1), this.nextMissionId);
      this.extendMap();
      return;
    }
    const rnd = new Rng((state.createdAt % 2147483647) || 12345);
    const hexes: ExplorationHex[] = [];
    for (let q = -MAP_RADIUS; q <= MAP_RADIUS; q++) {
      for (let r = -MAP_RADIUS; r <= MAP_RADIUS; r++) {
        if (hexDistance(q, r) > MAP_RADIUS) continue;
        hexes.push(makeHex(rnd, q, r));
      }
    }
    this.sm.applyDelta({ path: 'explorationMap', value: hexes });
  }

  /** Older saves keep their map; the new outer rings are added around it (their own seed, so nothing inside changes). */
  private extendMap(): void {
    const map = this.sm.state.explorationMap;
    const radius = map.reduce((m, h) => Math.max(m, hexDistance(h.x, h.y)), 0);
    if (radius >= MAP_RADIUS) return;
    const rnd = new Rng(((this.sm.state.createdAt + 7919) % 2147483647) || 54321);
    const added: ExplorationHex[] = [];
    for (let q = -MAP_RADIUS; q <= MAP_RADIUS; q++) {
      for (let r = -MAP_RADIUS; r <= MAP_RADIUS; r++) {
        const d = hexDistance(q, r);
        if (d <= radius || d > MAP_RADIUS) continue;
        const hex = makeHex(rnd, q, r);
        // Cells next to an explored edge hex are already in sight.
        const seen = d === radius + 1 && HEX_NEIGHBORS.some(([dq, dr]) => map.some(h => h.x === q + dq && h.y === r + dr && h.explored));
        added.push(seen ? { ...hex, revealed: true } : hex);
      }
    }
    this.sm.applyDelta({ path: 'explorationMap', value: [...map, ...added] });
  }

  getHex(state: GameState, q: number, r: number): ExplorationHex | undefined {
    return state.explorationMap.find(h => h.x === q && h.y === r);
  }

  /** Trips are long enough to matter while the player is away (S5); a long haul takes six times as long. */
  missionDuration(state: GameState, hex: ExplorationHex, long = false): number {
    const danger = BIOMES[hex.biome as BiomeId]?.danger ?? 1;
    let t = baseTripSeconds(hexDistance(hex.x, hex.y), danger);
    if (long) t *= LONG_TRIP_TIME;
    if (hasFeature(state, 'vehicles')) t *= 0.5;
    t *= metroSpeedup(state);
    t /= projectExpeditionSpeed(state); // [LateGame B1] the metro tunnel project
    return Math.round(t);
  }

  teamPower(team: SurvivorState[]): number {
    return team.reduce((sum, s) => sum + (s.stats.strength + s.stats.agility + s.stats.endurance) / 3 + s.level * 0.5 + (s.traits.includes('scavenger') ? 2 : 0), 0);
  }

  successChance(state: GameState, hex: ExplorationHex, team: SurvivorState[]): number {
    if (team.length === 0) return 0;
    const danger = BIOMES[hex.biome as BiomeId]?.danger ?? 1;
    const required = danger * 6 + hexDistance(hex.x, hex.y);
    let chance = 0.55 + (this.teamPower(team) - required) * 0.035;
    if (hasFeature(state, 'geiger')) chance += 0.08;
    chance += specTotal(state, 'expeditionChance');
    return Math.max(0.1, Math.min(0.95, chance));
  }

  /** The outer rings are too far to walk. */
  inReach(state: GameState, hex: ExplorationHex): boolean {
    return hexDistance(hex.x, hex.y) <= FOOT_RADIUS || hasFeature(state, 'vehicles');
  }

  teamsFull(state: GameState): boolean {
    return state.activeMissions.length >= maxTeams(state);
  }

  canSend(state: GameState, hex: ExplorationHex, ids: string[]): boolean {
    if (!this.isUnlocked(state) || !hex.revealed || hex.biome === 'bunker') return false;
    if (ids.length === 0 || ids.length > MAX_TEAM) return false;
    if (this.teamsFull(state) || !this.inReach(state, hex)) return false;
    if (state.activeMissions.some(m => m.hexX === hex.x && m.hexY === hex.y)) return false;
    return ids.every(id => {
      const s = state.survivors.find(x => x.id === id);
      return !!s && !s.isOnMission && !s.child && s.health > 25;
    });
  }

  send(hex: ExplorationHex, ids: string[], long = false): boolean {
    const state = this.sm.state;
    if (!this.canSend(state, hex, ids)) return false;
    const options = eventsFor(hex.biome);
    const mission: ActiveMission = {
      id: `m_${this.nextMissionId++}`,
      hexX: hex.x,
      hexY: hex.y,
      survivorIds: ids,
      type: hex.explored ? 'scavenge' : 'explore',
      progress: 0,
      total: this.missionDuration(state, hex, long),
      journal: [{ t: 0, key: 'depart', vars: { n: ids.length } }],
      lootMult: long ? LONG_TRIP_LOOT : 1,
      long: long || undefined,
      injuryMod: 0,
      // Most trips bring one decision on the road.
      event: options.length && this.rng.chance(0.8) ? { id: this.rng.pick(options).id, at: 0.35 + this.rng.next() * 0.3 } : undefined,
    };
    this.sm.applyDelta({ path: 'activeMissions', value: [...state.activeMissions, mission] });
    this.sm.applyDelta({
      path: 'survivors',
      value: state.survivors.map(s => (ids.includes(s.id) ? { ...s, isOnMission: true } : s)),
    });
    bus.emit('mission:start', mission);
    return true;
  }

  recall(missionId: string): void {
    const state = this.sm.state;
    const m = state.activeMissions.find(x => x.id === missionId);
    if (!m) return;
    this.sm.applyDelta({ path: 'activeMissions', value: state.activeMissions.filter(x => x.id !== missionId) });
    this.sm.applyDelta({
      path: 'survivors',
      value: state.survivors.map(s => (m.survivorIds.includes(s.id) ? { ...s, isOnMission: false } : s)),
    });
    bus.emit('mission:recall', missionId);
  }

  update(dt: number): void {
    const state = this.sm.state;
    if (state.activeMissions.length === 0) return;
    const finished: string[] = [];
    const asking: string[] = [];
    const timedOut: string[] = [];
    const updated = state.activeMissions.map(m => {
      if (m.waiting) {
        const waited = (m.waited ?? 0) + dt;
        if (waited >= ANSWER_TIMEOUT) timedOut.push(m.id);
        return { ...m, waited };
      }
      const progress = Math.min(m.total, m.progress + dt);
      if (m.event && !m.event.choice && progress >= m.total * m.event.at) {
        asking.push(m.id);
        const journal = [...(m.journal ?? []), { t: Math.round(m.total * m.event.at), key: `event:${m.event.id}` }];
        return { ...m, progress: m.total * m.event.at, waiting: true, waited: 0, journal };
      }
      if (progress >= m.total) finished.push(m.id);
      return { ...m, progress };
    });
    this.sm.applyDelta({ path: 'activeMissions', value: updated });
    for (const id of asking) bus.emit('mission:choice', id);
    for (const id of timedOut) {
      const m = this.sm.state.activeMissions.find(x => x.id === id);
      const ev = m?.event ? expeditionEvent(m.event.id) : undefined;
      if (ev) this.choose(id, ev.options[0].key, true);
    }
    for (const id of finished) this.complete(id);
  }

  /** Seconds until the first team is home (a question on the road waits out its timeout), or null with nobody out. */
  nextReturnIn(state: GameState): number | null {
    let best: number | null = null;
    for (const m of state.activeMissions) {
      let t = m.total - m.progress;
      if (m.waiting) t += ANSWER_TIMEOUT - (m.waited ?? 0);
      else if (m.event && !m.event.choice) t += ANSWER_TIMEOUT;
      if (best === null || t < best) best = t;
    }
    return best;
  }

  /** The first mission waiting for an answer, if any. */
  waitingMission(): ActiveMission | undefined {
    return this.sm.state.activeMissions.find(m => m.waiting);
  }

  /** The player's answer (or the team's own cautious call after a long silence). */
  choose(missionId: string, key: string, auto = false): boolean {
    const state = this.sm.state;
    const m = state.activeMissions.find(x => x.id === missionId);
    const ev = m?.event ? expeditionEvent(m.event.id) : undefined;
    const opt = ev?.options.find(o => o.key === key);
    if (!m || !ev || !opt || !m.waiting) return false;
    const journal: JournalEntry[] = [...(m.journal ?? []), { t: Math.round(m.progress), key: `choice:${ev.id}:${opt.key}`, vars: auto ? { auto: 1 } : undefined }];
    const remaining = m.total - m.progress;
    const total = m.progress + remaining * (opt.timeMult ?? 1);
    const bonusLoot = { ...(m.bonusLoot ?? {}) };
    for (const [r, v] of Object.entries(opt.loot ?? {}) as [ResourceType, number][]) bonusLoot[r] = (bonusLoot[r] ?? 0) + v;
    const recruit = !!m.recruit || (!!opt.recruit && this.rng.chance(opt.recruit));
    if (opt.reveal) this.revealAround(m.hexX, m.hexY, 2);
    const next: ActiveMission = {
      ...m, waiting: false, waited: 0, total, journal, bonusLoot, recruit,
      event: { ...m.event!, choice: opt.key },
      lootMult: (m.lootMult ?? 1) * (opt.lootMult ?? 1),
      injuryMod: (m.injuryMod ?? 0) + (opt.injury ?? 0),
    };
    this.sm.applyDelta({ path: 'activeMissions', value: state.activeMissions.map(x => (x.id === missionId ? next : x)) });
    return true;
  }

  private revealAround(q: number, r: number, radius: number): void {
    this.sm.applyDelta({
      path: 'explorationMap',
      value: this.sm.state.explorationMap.map(h => (hexDistance(h.x - q, h.y - r) <= radius ? { ...h, revealed: true } : h)),
    });
  }

  private complete(missionId: string): void {
    const state = this.sm.state;
    const mission = state.activeMissions.find(m => m.id === missionId);
    if (!mission) return;
    if (mission.type === 'caravan') { this.completeCaravan(mission); return; } // [LateGame B2]
    const hex = this.getHex(state, mission.hexX, mission.hexY);
    const team = state.survivors.filter(s => mission.survivorIds.includes(s.id));
    if (!hex) {
      this.recall(missionId);
      return;
    }

    const biome = BIOMES[hex.biome as BiomeId];
    const success = this.rng.next() < this.successChance(state, hex, team);
    const firstVisit = !hex.explored;
    let mult = (1 + 0.25 * (team.length - 1)) * (firstVisit ? 1 : 0.5) * (success ? 1 : 0.3);
    if (hasFeature(state, 'lootBonus')) mult *= 1.4;
    mult *= 1 + 0.1 * (state.prestige.upgrades['lootLuck'] ?? 0);
    mult *= (mission.lootMult ?? 1) * (1 + specTotal(state, 'expeditionLoot'));
    mult *= distanceLootMult(hexDistance(hex.x, hex.y));

    const loot: Partial<Record<ResourceType, number>> = {};
    for (const [r, range] of Object.entries(biome.loot) as [ResourceType, [number, number]][]) {
      loot[r] = Math.round(this.rng.nextInt(range[0], range[1]) * mult);
    }
    const poi = firstVisit && success && hex.poi ? POIS[hex.poi] : undefined;
    if (poi) {
      for (const [r, v] of Object.entries(poi.loot) as [ResourceType, number][]) loot[r] = (loot[r] ?? 0) + v;
    }
    for (const [r, v] of Object.entries(mission.bonusLoot ?? {}) as [ResourceType, number][]) loot[r] = (loot[r] ?? 0) + v;

    let recruitName: string | null = null;
    if ((poi?.recruit || mission.recruit) && state.survivors.length < state.maxPopulation) {
      const s = this.population.createSurvivor(this.rng);
      this.population.addSurvivor(this.sm, s);
      recruitName = s.name;
    }

    const injuries: MissionReport['injuries'] = [];
    const geiger = hasFeature(state, 'geiger') ? 0.7 : 1;
    const injuryChance = (success ? biome.danger * 0.08 : 0.6 + biome.danger * 0.08) + (mission.injuryMod ?? 0);
    const xpGain = 40 * Math.max(1, biome.danger);
    const survivors = this.sm.state.survivors.map(s => {
      if (!mission.survivorIds.includes(s.id)) return s;
      let health = s.health;
      if (this.rng.next() < injuryChance) {
        const damage = Math.round(this.rng.nextInt(10, 20 + biome.danger * 8) * geiger);
        health = Math.max(0, health - damage);
        injuries.push({ id: s.id, name: s.name, damage });
      }
      return { ...s, isOnMission: false, health, xp: s.xp + xpGain };
    });
    this.sm.applyDelta({ path: 'survivors', value: survivors });

    this.resources.gain(this.sm, loot);

    const revealed = new Set(HEX_NEIGHBORS.map(([dq, dr]) => hexKey(hex.x + dq, hex.y + dr)));
    this.sm.applyDelta({
      path: 'explorationMap',
      value: this.sm.state.explorationMap.map(h => {
        if (h.x === hex.x && h.y === hex.y) return { ...h, explored: true, revealed: true, poi: success && h.poi ? null : h.poi };
        if (revealed.has(hexKey(h.x, h.y))) return { ...h, revealed: true };
        return h;
      }),
    });

    this.sm.applyDelta({ path: 'activeMissions', value: this.sm.state.activeMissions.filter(m => m.id !== missionId) });
    this.sm.applyDelta({ path: 'stats.totalMissionsCompleted', value: this.sm.state.stats.totalMissionsCompleted + 1 });

    const journal: JournalEntry[] = [...(mission.journal ?? [])];
    journal.push({ t: Math.round(mission.total * 0.5), key: success ? 'arrive' : 'trouble' });
    if (poi) journal.push({ t: Math.round(mission.total * 0.55), key: 'poi', vars: { poi: poi.id } });
    if (recruitName) journal.push({ t: Math.round(mission.total * 0.6), key: 'recruit', vars: { name: recruitName } });
    for (const inj of injuries) journal.push({ t: Math.round(mission.total * 0.7), key: 'injury', vars: { name: inj.name } });
    journal.push({ t: Math.round(mission.total), key: 'return' });
    journal.sort((a, b) => a.t - b.t);
    const report: MissionReport = {
      id: missionId, hexX: hex.x, hexY: hex.y, success, firstVisit, loot, injuries, recruitName, poi: poi ? poi.id : null,
      biome: hex.biome, journal,
    };
    this.sm.applyDelta({ path: 'missionReports', value: [...this.sm.state.missionReports, report] });
    if (poi?.story) this.sm.applyDelta({ path: 'storyFlags', value: [...this.sm.state.storyFlags, 'vaultFound'] });
    bus.emit('mission:complete', report);
  }

  // ---- [LateGame B2] trade caravans ----

  /** Part of each store a caravan leaves at home. */
  private static readonly CARGO_RESERVE: Partial<Record<ResourceType, number>> = { food: 0.4, water: 0.4, medicine: 0.5, materials: 0.15, knowledge: 0.1, scrap: 0.1 };

  /** What a caravan of this size would carry from the stock right now, or null when the stores can't fill it. */
  cargoFor(state: GameState, partnerId: string, tier: CargoTier): Partial<Record<ResourceType, number>> | null {
    const p = getPartner(partnerId);
    const want = CARGO_TIERS.find(t => t.id === tier)?.value ?? 0;
    if (!p || want <= 0) return null;
    const cargo: Partial<Record<ResourceType, number>> = {};
    let value = 0;
    for (const r of p.accepts) {
      const res = state.resources[r];
      const unit = TRADE_VALUE[r] ?? 0;
      if (!res || unit <= 0) continue;
      const reserve = Number.isFinite(res.cap) ? (ExplorationSystem.CARGO_RESERVE[r] ?? 0) * res.cap : 0;
      const take = Math.min(Math.floor(res.amount - reserve), Math.ceil((want - value) / unit));
      if (take < 1) continue;
      cargo[r] = take;
      value += take * unit;
      if (value >= want) break;
    }
    return value >= want * 0.9 ? cargo : null;
  }

  caravanDuration(state: GameState, partnerId: string): number {
    const p = getPartner(partnerId);
    let t = p?.seconds ?? 7200;
    if (hasFeature(state, 'vehicles')) t *= 0.75;
    t /= projectExpeditionSpeed(state);
    return Math.round(t);
  }

  canSendCaravan(state: GameState, partnerId: string, ids: string[], tier: CargoTier): boolean {
    const p = getPartner(partnerId);
    if (!p || !partnerOpen(state, p) || this.teamsFull(state) || ids.length !== CARAVAN_CREW) return false;
    if (state.activeMissions.some(m => m.type === 'caravan' && m.partner === partnerId)) return false;
    if (!ids.every(id => {
      const s = state.survivors.find(x => x.id === id);
      return !!s && !s.isOnMission && !s.child && s.health > 40;
    })) return false;
    return this.cargoFor(state, partnerId, tier) !== null;
  }

  sendCaravan(partnerId: string, ids: string[], tier: CargoTier): boolean {
    const state = this.sm.state;
    if (!this.canSendCaravan(state, partnerId, ids, tier)) return false;
    const cargo = this.cargoFor(state, partnerId, tier)!;
    for (const [r, n] of Object.entries(cargo) as [ResourceType, number][]) {
      this.sm.applyDelta({ path: `resources.${r}.amount`, value: this.sm.state.resources[r].amount - n });
    }
    const mission: ActiveMission = {
      id: `m_${this.nextMissionId++}`, hexX: 0, hexY: 0, survivorIds: ids, type: 'caravan', progress: 0,
      total: this.caravanDuration(state, partnerId), partner: partnerId, cargo,
    };
    this.sm.applyDelta({ path: 'activeMissions', value: [...this.sm.state.activeMissions, mission] });
    this.sm.applyDelta({ path: 'survivors', value: this.sm.state.survivors.map(s => (ids.includes(s.id) ? { ...s, isOnMission: true } : s)) });
    bus.emit('caravan:start', mission);
    return true;
  }

  private completeCaravan(mission: ActiveMission): void {
    const state = this.sm.state;
    const p = getPartner(mission.partner);
    const cargo = mission.cargo ?? {};
    const trade = state.lateGame.trade;
    const levelBefore = p ? relationLevel(state, p.id) : 0;
    const ambushed = !p || this.rng.next() < ambushChance(state, p.id);
    const goods: Partial<Record<ResourceType, number>> = {};
    let recruitName: string | null = null;
    const injured: string[] = [];
    if (!ambushed && p) {
      const back = cargoValue(cargo) * tradeRate(levelBefore);
      for (const [r, share] of Object.entries(p.goods) as [ResourceType, number][]) {
        const unit = TRADE_VALUE[r] ?? 1;
        const exact = (back * share) / unit;
        // Blueprints are rare: the fraction becomes a chance.
        goods[r] = r === 'blueprints' ? Math.floor(exact) + (this.rng.next() < exact % 1 ? 1 : 0) : Math.round(exact);
      }
      this.resources.gain(this.sm, goods);
      // A skilled newcomer (Noa's people): bigger cargo, better odds.
      const tierBoost = Math.min(2, cargoValue(cargo) / 2000);
      if (p.recruit && state.survivors.length < state.maxPopulation && this.rng.chance(p.recruit * tierBoost)) {
        const s = this.population.createSurvivor(this.rng);
        s.mxp = MASTERY_STEPS[0];
        s.stats = { ...s.stats, intelligence: Math.min(20, s.stats.intelligence + 2), endurance: Math.min(20, s.stats.endurance + 2) };
        this.population.addSurvivor(this.sm, s);
        recruitName = s.name;
      }
    } else if (this.rng.chance(0.4)) {
      // The ambush: the cargo is gone and one of the pair is hurt.
      injured.push(this.rng.pick(mission.survivorIds));
    }
    this.sm.applyDelta({
      path: 'survivors',
      value: this.sm.state.survivors.map(s => {
        if (!mission.survivorIds.includes(s.id)) return s;
        return { ...s, isOnMission: false, health: injured.includes(s.id) ? Math.max(1, s.health - this.rng.nextInt(12, 28)) : s.health };
      }),
    });
    this.sm.applyDelta({ path: 'activeMissions', value: this.sm.state.activeMissions.filter(m => m.id !== mission.id) });
    const now = this.sm.state.lateGame.trade;
    if (!ambushed && p) {
      this.sm.applyDelta({ path: 'lateGame.trade', value: { ...now, deals: { ...now.deals, [p.id]: (now.deals[p.id] ?? 0) + 1 }, caravans: now.caravans + 1 } });
    } else {
      this.sm.applyDelta({ path: 'lateGame.trade', value: { ...now, lost: now.lost + 1 } });
    }
    const levelAfter = p ? relationLevel(this.sm.state, p.id) : 0;
    bus.emit('caravan:complete', { partner: p?.id ?? '', ok: !ambushed, goods, injured, recruitName, level: levelAfter, levelUp: levelAfter > levelBefore });
  }

  /** A relation level's special deal: unlocked by the level, paid for on the spot, once. */
  canSpecial(state: GameState, partnerId: string, n: number): boolean {
    const p = getPartner(partnerId);
    const deal = p?.specials[n - 1];
    if (!p || !deal || !partnerOpen(state, p) || relationLevel(state, p.id) < n) return false;
    if (state.lateGame.trade.specials.includes(specialKey(p.id, n))) return false;
    return this.resources.canAfford(state, deal.cost as Record<string, number>);
  }

  doSpecial(partnerId: string, n: number): boolean {
    const p = getPartner(partnerId);
    if (!p || !this.canSpecial(this.sm.state, partnerId, n)) return false;
    const deal = p.specials[n - 1];
    if (!this.resources.spend(this.sm, deal.cost as Record<string, number>)) return false;
    this.resources.gain(this.sm, deal.gain);
    const t = this.sm.state.lateGame.trade;
    this.sm.applyDelta({ path: 'lateGame.trade', value: { ...t, specials: [...t.specials, specialKey(p.id, n)] } });
    bus.emit('trade:special', partnerId, n);
    return true;
  }

  dismissReport(): void {
    this.sm.applyDelta({ path: 'missionReports', value: this.sm.state.missionReports.slice(1) });
  }

  /** Places a story location on the map (used by the radio story chain). */
  revealPoi(poiId: string, distance: number): void {
    this.ensureMap();
    const state = this.sm.state;
    const candidates = state.explorationMap.filter(h => hexDistance(h.x, h.y) === distance && !h.explored);
    if (candidates.length === 0) return;
    const target = candidates[Math.floor(this.rng.next() * candidates.length)];
    this.sm.applyDelta({
      path: 'explorationMap',
      value: state.explorationMap.map(h => (h === target ? { ...h, poi: poiId, revealed: true } : h)),
    });
  }
}
