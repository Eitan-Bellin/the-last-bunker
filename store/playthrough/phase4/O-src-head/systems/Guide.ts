import type { GameEngine } from '../core/GameEngine';
import type { BuildingInstance, BuildingType, GameState, ResourceType } from '../core/GameState';
import { ACTS, actOf, type ActDef, type ActGoal } from '../data/acts';
import { ERAS, eraOf, type EraGoal } from '../data/eras';
import { getProject, projectDone, stagesDone, type ProjectDef } from '../data/projects';
import { RESEARCH } from '../data/research';
import { i18n } from '../i18n/I18nManager';
import { RESOURCE_ICONS } from '../ui/dom';
import type { Objective, ObjectiveAction } from './ObjectiveSystem';
import { wingOptions } from '../data/wings';
import { bedCap, bedsBuilt } from './BuildingSystem';
import { isBuildingUnlocked } from './ResearchSystem';

/**
 * [Q2] The guide: what blocks the run right now, in plain words, and where to tap to deal with it.
 * After the tutorial the HUD's objective line is this (not a generic "add 5 levels" task), and the Command panel lists
 * every requirement of the Act with its own next step. Pure reading of the state: nothing here changes the game.
 * [ux-wp1] Only steps the player can take are offered as "do it now"; every step has a tap that leads somewhere; saving up says how long;
 * work already under way is counted; during the tutorial everyone (HUD, Command, check-in) shows the tutorial's step first (nowStep).
 */
export interface Requirement {
  id: string;
  icon: string;
  /** What is left to do about this requirement, in the current language. */
  text: string;
  /** Short name of the requirement itself (the goal's text, or the project's name). */
  title: string;
  progress: [number, number];
  /** [ux-wp1 A4] The counter that belongs to `text` when it differs from `progress` (the era's current step). */
  lineProgress?: [number, number];
  /** 0..1 */
  fraction: number;
  action: ObjectiveAction;
  done: boolean;
  /** The player can act on it right now at no cost (start a project, put a crew on it). Shown before slow things. */
  immediate: boolean;
  project?: string;
  /** [ux-wp1 A3] Not open yet (a charter project waiting for its era): never "the step", never a check-in suggestion. */
  locked?: boolean;
  /** [ux-wp1 P15] Work toward it already running (rooms upgrading into the level, a floor being dug, a research under way). */
  pending?: number;
  /** [ux-wp1 M2] Seconds until it is done at today's rates (0 = done, Infinity = can't tell). */
  eta: number;
  /** [ux-wp1 C1] The era goal's own steps, in plain words (shown under the requirement in the Command panel). */
  subs?: { text: string; done: boolean; count: string }[];
}

const ICONS: Record<ActGoal['kind'], string> = {
  era: '[[flag]]', ruins: '[[broom]]', research: '[[research]]', dig: '[[pick]]', levels: '[[up]]',
  pop: '[[people]]', outposts: '[[surface]]', influence: '[[books]]', seedVault: '[[research]]',
};

const list = (o: Partial<Record<ResourceType, number>>): string => Object.entries(o)
  .map(([r, v]) => `${RESOURCE_ICONS[r] ?? ''}${i18n.formatCompact(v ?? 0)}`).join(' ');

const net = (state: GameState, r: ResourceType): number => {
  const res = state.resources[r];
  return res ? res.productionRate - res.consumptionRate : 0;
};

/** [ux-wp1 M2] Seconds until the stores hold `cost` at today's rates: 0 when they already do, Infinity when storage is too small or nothing comes in. */
export function costEta(state: GameState, cost: Partial<Record<string, number>>): number {
  let t = 0;
  for (const [r, v] of Object.entries(cost)) {
    const res = state.resources[r as ResourceType];
    if (!res || !v) continue;
    if (v > res.cap) return Infinity;
    const short = v - res.amount;
    if (short <= 0) continue;
    const n = net(state, r as ResourceType);
    if (n <= 1e-6) return Infinity;
    t = Math.max(t, short / n);
  }
  return t;
}

/** [ux-wp1 M2] Seconds until the bunker has made `need` in total (spent bit by bit, so storage size does not matter). */
function flowEta(state: GameState, need: Partial<Record<string, number>>): number {
  let t = 0;
  for (const [r, v] of Object.entries(need)) {
    if (!v || v <= 0) continue;
    const res = state.resources[r as ResourceType];
    if (!res) return Infinity;
    const short = v - Math.max(0, res.amount);
    if (short <= 0) continue;
    const n = net(state, r as ResourceType);
    if (n <= 1e-6) return Infinity;
    t = Math.max(t, short / n);
  }
  return t;
}

const add = (into: Record<string, number>, cost: Partial<Record<string, number>>) => {
  for (const [r, v] of Object.entries(cost)) into[r] = (into[r] ?? 0) + (v ?? 0);
};

/** [ux-wp1 M2] " (~3h at today's rates)" when the wait is known and real, '' otherwise. */
export function etaSuffix(seconds: number): string {
  return isFinite(seconds) && seconds >= 1 ? ` ${i18n.t('wp1.eta', { t: i18n.formatDuration(seconds) })}` : '';
}

/** [ux-wp1 P15] " · 2 in progress" when work toward the requirement is already running. */
const pendingSuffix = (n: number) => (n > 0 ? ` · ${i18n.t('wp1.inProgress', { n })}` : '');

/** [plan4:ST-5] True when even the smallest rooms have no free slot on any floor: only a wider (or deeper) floor makes space. */
export function noSpace(engine: GameEngine, state: GameState): boolean {
  const bs = engine.buildingSystem;
  for (const type of ['generator', 'quarters', 'storage', 'farm', 'workshop'] as const) {
    for (let f = 0; f < state.currentFloors; f++) if (bs.findFreeSpot(type, f, state)) return false;
  }
  return true;
}

/** The Act's share done, 0..1 (goals and charter projects weigh the same). */
export function actFraction(engine: GameEngine, state: GameState, act: ActDef = actOf(state)): number {
  const reqs = actRequirements(engine, state, act);
  if (reqs.length === 0) return 1;
  return reqs.reduce((s, r) => s + r.fraction, 0) / reqs.length;
}

/** [ux-wp1 A3] Why a project is closed, in words: the era it waits for, else the Act. */
export function projectLockText(state: GameState, def: ProjectDef): string {
  if ((state.era ?? 0) < def.era) {
    const era = ERAS[Math.min(ERAS.length - 1, def.era)];
    const name = era.name[i18n.currentLocale] ?? era.name.en;
    return i18n.t('wp1.lockedEra', { era: i18n.currentLocale === 'en' ? name.replace(/^The /, '') : name });
  }
  return def.act ? i18n.t('proj.lockedAct', { n: def.act }) : i18n.t('proj.locked');
}

/** [ux-wp1 B2] Where an era step is dealt with. The era data has no kind, so this reads the (English) wording. */
function eraStepAction(state: GameState, g: EraGoal): ObjectiveAction {
  const t = (g.text.en ?? '').toLowerCase();
  if (t.includes('generator')) return { kind: 'ruin', restoresTo: 'generator' };
  if (t.includes('water pump')) return { kind: 'ruin', restoresTo: state.buildings.some(b => b.type === 'waterPump') ? 'farm' : 'waterPump' };
  if (t.includes('survivors')) return { kind: 'people' };
  if (t.includes('dig')) return { kind: 'dig' };
  if (t.includes('research')) return { kind: 'research' };
  if (t.includes('explore') || t.includes('surface')) return { kind: 'surface' };
  if (t.includes('power')) return { kind: 'build', type: 'generator' };
  if (t.includes('clear') || t.includes('areas')) return { kind: 'ruins' };
  if (t.includes('district') || t.includes('hall')) return { kind: 'dig' };
  return { kind: 'projects' };
}

/**
 * [ux-wp1 P16] The room most worth upgrading now: one of `type` when given; quarters only while their beds are still under the Act's limit;
 * rooms that count toward the Act's "N rooms at level X" goal first (closest to it first); then what the stores can pay now; then the cheapest.
 */
export function upgradeCandidate(engine: GameEngine, state: GameState, type?: BuildingType): BuildingInstance | null {
  const bs = engine.buildingSystem;
  const rs = engine.resourceSystem;
  const longRun = !!state.longGame && !state.longGame.meta.legacy;
  const goal = longRun ? actOf(state).goals.find(g => g.kind === 'levels' && g.progress(state)[0] < g.progress(state)[1])?.level : undefined;
  const bedsFull = longRun && bedsBuilt(state) >= bedCap(state);
  const total = (b: BuildingInstance) => Object.values(bs.getUpgradeCost(b)).reduce((s, v) => s + v, 0);
  const score = (b: BuildingInstance) => ({
    useless: b.type === 'quarters' && bedsFull ? 1 : 0,
    helps: goal !== undefined && b.level < goal ? 0 : 1,
    afford: rs.canAfford(state, bs.getUpgradeCost(b)) ? 0 : 1,
  });
  const pool = state.buildings.filter(b => !b.isConstructing && bs.canUpgrade(b, state) && (!type || b.type === type));
  const ranked = pool.map(b => ({ b, s: score(b), cost: total(b) })).sort((x, y) =>
    x.s.useless - y.s.useless || x.s.helps - y.s.helps
    || (x.s.helps === 0 ? y.b.level - x.b.level : 0)
    || x.s.afford - y.s.afford || x.cost - y.cost || y.b.level - x.b.level);
  return ranked[0]?.b ?? null;
}

/** [ux-wp1 M2] Seconds of crew-free waiting for `n` more rooms to reach level `lv`: their upgrade prices at today's income, and the longest chain of upgrades. */
function levelsEta(engine: GameEngine, state: GameState, lv: number, n: number): number {
  const bs = engine.buildingSystem;
  const running = state.buildings.filter(b => b.isConstructing && b.level >= lv && b.level > 1);
  let longest = Math.max(0, ...running.map(b => b.constructionTotal - b.constructionProgress));
  let want = n - running.length;
  if (want <= 0) return longest;
  const pool = state.buildings.filter(b => !b.isConstructing && b.level < lv && bs.canUpgrade(b, state)).sort((a, b) => b.level - a.level);
  if (pool.length < want) return Infinity;
  const cost: Record<string, number> = {};
  for (const b of pool) {
    if (want <= 0) break;
    want--;
    let chain = 0;
    for (let k = b.level; k < lv; k++) {
      const probe = { ...b, level: k };
      add(cost, bs.getUpgradeCost(probe));
      chain += bs.getUpgradeTime(probe);
    }
    longest = Math.max(longest, chain);
  }
  return Math.max(longest, flowEta(state, cost));
}

/** [ux-wp1 M2] Seconds until the bunker is `n` floors deeper: the running dig, then each next floor's price and dig time at full crew. */
function digEta(engine: GameEngine, state: GameState, n: number): number {
  const bs = engine.buildingSystem;
  const ds = engine.digSystem;
  if (n <= 0) return 0;
  if (state.currentFloors + n > actOf(state).floorCap) return Infinity;
  const floorSlot = ds.slots(state).find(i => ds.dig(state, i)?.kind !== 'wing');
  let time = 0;
  let from = state.currentFloors;
  if (floorSlot !== undefined) {
    const d = ds.dig(state, floorSlot)!;
    const eta = ds.eta(state, floorSlot);
    time += isFinite(eta) ? eta : d.total - d.progress;
    from++;
    n--;
  }
  const cost: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const probe = { ...state, currentFloors: from + i } as GameState;
    add(cost, bs.digCost(probe));
    time += bs.digTime(probe);
  }
  return Math.max(time, flowEta(state, cost));
}

/** [ux-wp1 M2] Seconds until `n` more researches are done: the cheapest open ones, their knowledge at today's rate and their time at today's speed. */
function researchEta(engine: GameEngine, state: GameState, n: number): number {
  const rs = engine.researchSystem;
  if (n <= 0) return 0;
  const speed = Math.max(1e-6, rs.speed(state));
  const active = rs.activeId(state);
  let time = 0;
  if (active) {
    const node = state.research[active];
    time += Math.max(0, node.total - node.progress) / speed;
    n--;
  }
  const open = RESEARCH.filter(r => r.id !== active && !state.research[r.id]?.completed && rs.blockReason(state, r.id) !== 'act')
    .map(r => rs.defOf(state, r.id) ?? r)
    .sort((a, b) => (a.cost.knowledge ?? 0) - (b.cost.knowledge ?? 0));
  if (open.length < n) return Infinity;
  const cost: Record<string, number> = {};
  for (const d of open.slice(0, n)) {
    add(cost, d.cost);
    time += d.time / speed;
  }
  return Math.max(time, flowEta(state, cost));
}

function goalRequirement(engine: GameEngine, state: GameState, act: ActDef, g: ActGoal, idx: number): Requirement {
  const locale = i18n.currentLocale;
  const [c, t] = g.progress(state);
  const done = c >= t;
  const base = { id: `goal${idx}`, icon: ICONS[g.kind], title: g.text[locale], progress: [Math.min(c, t), t] as [number, number], fraction: Math.min(1, c / Math.max(1, t)), done, immediate: false, eta: done ? 0 : Infinity };
  if (done) return { ...base, text: g.text[locale], action: null };
  const left = t - c;
  switch (g.kind) {
    case 'era': {
      // [ux-wp1 C1/A4/B2] The era is a sub-goal: its own steps under the Act goal, the line counts the current step, the tap goes to that step.
      const era = eraOf(state);
      const steps = era.next.map(x => { const [a, b] = x.progress(state); return { g: x, a: Math.min(a, b), b, done: a >= b }; });
      const subs = steps.map(s => ({ text: s.g.text[locale] ?? s.g.text.en, done: s.done, count: s.done ? '✓' : s.b > 1 ? `${s.a}/${s.b}` : '' }));
      const sub = steps.find(s => !s.done);
      const share = steps.length ? steps.reduce((sum, s) => sum + (s.done ? 1 : s.a / Math.max(1, s.b)), 0) / steps.length : 0;
      const fraction = Math.min(1, (c + share) / Math.max(1, t));
      if (!sub) return { ...base, fraction, subs, text: g.text[locale], action: { kind: 'command' } };
      const text = i18n.t('wp1.eraStep', { goal: sub.g.text[locale] ?? sub.g.text.en });
      return { ...base, fraction, subs, text, lineProgress: [sub.a, sub.b], action: eraStepAction(state, sub.g) };
    }
    case 'ruins': {
      // [ux-wp1 A2] "Do it now" only when a ruin can actually be started; otherwise what it waits for.
      const rs = engine.restorationSystem;
      const working = state.ruins.filter(r => r.started).length;
      const startable = state.ruins.filter(r => rs.canStart(state, r));
      if (working > 0) return { ...base, pending: working, text: i18n.t('guide.ruins', { n: left }) + pendingSuffix(working), action: { kind: 'ruins' } };
      if (startable.length > 0) return { ...base, text: i18n.t('guide.ruins', { n: left }), action: { kind: 'ruins' }, immediate: true };
      const next = state.ruins.filter(r => !rs.blockReason(state, r)).map(r => ({ r, eta: costEta(state, rs.cost(r)) })).sort((a, b) => a.eta - b.eta)[0];
      if (next) return { ...base, text: i18n.t('wp1.ruinsSave', { n: left, cost: list(rs.cost(next.r)) }) + etaSuffix(next.eta), action: { kind: 'ruins' } };
      return { ...base, text: i18n.t('guide.ruins', { n: left }), action: { kind: 'ruins' } };
    }
    case 'research': {
      const rs = engine.researchSystem;
      const active = rs.activeId(state);
      const eta = researchEta(engine, state, left);
      if (active) {
        const next = rs.etaSeconds(state, active);
        return { ...base, eta, pending: 1, text: i18n.t('guide.researchBusy', { c, t, t2: isFinite(next) ? i18n.formatDuration(next) : '…' }), action: { kind: 'research' } };
      }
      // [ux-wp1 A2] "Start a research" only when one can start; no lab means no knowledge, so the lab comes first.
      if (RESEARCH.some(r => rs.canStart(state, r.id))) return { ...base, eta, text: i18n.t('guide.researchIdle', { c, t }), action: { kind: 'research' }, immediate: true };
      if (!state.buildings.some(b => b.type === 'laboratory')) {
        const cost = engine.buildingSystem.getBuildCost('laboratory', state);
        const can = isBuildingUnlocked(state, 'laboratory') && engine.resourceSystem.canAfford(state, cost);
        return { ...base, eta, text: i18n.t('wp1.researchLab', { c, t }) + (can ? '' : etaSuffix(costEta(state, cost))), action: { kind: 'build', type: 'laboratory' }, immediate: can };
      }
      const cheapest = RESEARCH.filter(r => rs.status(state, r.id) === 'available').map(r => rs.defOf(state, r.id) ?? r)
        .sort((a, b) => costEta(state, a.cost) - costEta(state, b.cost))[0];
      if (cheapest) return { ...base, eta, text: i18n.t('wp1.researchSave', { c, t, cost: list(cheapest.cost) }) + etaSuffix(costEta(state, cheapest.cost)), action: { kind: 'research' } };
      return { ...base, eta, text: i18n.t('wp1.researchNone', { c, t }), action: { kind: 'research' } };
    }
    case 'dig': {
      const bs = engine.buildingSystem;
      const ds = engine.digSystem;
      const block = bs.digBlock(state);
      const eta = digEta(engine, state, left);
      if (block === 'digging') {
        const floorSlot = ds.slots(state).find(i => ds.dig(state, i)?.kind !== 'wing');
        if (floorSlot === undefined) {
          // [ux-wp1 B4] Both dig slots hold wing steps: the next floor waits for the first of them.
          const etas = ds.slots(state).map(i => ds.eta(state, i)).filter(x => isFinite(x));
          const first = etas.length ? Math.min(...etas) : Infinity;
          return { ...base, eta, text: i18n.t('wp1.digSlots', { t2: isFinite(first) ? i18n.formatDuration(first) : '…' }), action: { kind: 'dig' } };
        }
        const t2 = ds.eta(state, floorSlot);
        const crew = ds.crew(state, floorSlot).length;
        const want = ds.wanted(state, floorSlot);
        const text = crew < want ? i18n.t('guide.digCrew', { n: want - crew }) : i18n.t('guide.digBusy', { t2: isFinite(t2) ? i18n.formatDuration(t2) : '…' });
        return { ...base, eta, pending: 1, text, action: { kind: 'dig' }, immediate: crew < want };
      }
      // [plan4:ST-5] No deeper floor allowed and no room left on the floors there are: widen a wing.
      if ((block === 'act' || block === 'max') && noSpace(engine, state)) {
        const o = wingOptions(state).filter(w => w.block === null || w.block === 'cost').sort((a, b) => (a.block === null ? 0 : 1) - (b.block === null ? 0 : 1) || a.floor - b.floor)[0];
        // [ux-wp1 B1] The tap opens that wing's dig.
        if (o) return { ...base, eta, text: i18n.t('guide.wing', { cost: list(o.cost) }) + (o.block === null ? '' : etaSuffix(costEta(state, o.cost))), action: { kind: 'wing', floor: o.floor, side: o.side }, immediate: o.block === null };
      }
      const over = bs.digOverCap(state);
      // [ux-wp1 B3] Straight to a Storage room (upgrade one, or build one).
      if (over) return { ...base, eta, text: i18n.t('guide.digStorage', { res: i18n.t(`resources.${over.resource}`) }), action: { kind: 'rooms', type: 'storage' } };
      const cost = bs.digCost(state);
      const can = engine.resourceSystem.canAfford(state, cost);
      return { ...base, eta, text: can ? i18n.t('guide.digReady', { cost: list(cost) }) : i18n.t('guide.digSave', { cost: list(cost) }) + etaSuffix(costEta(state, cost)), action: { kind: 'dig' }, immediate: can };
    }
    case 'levels': {
      const lv = g.level ?? 0;
      // [ux-wp1 P15] Rooms already upgrading into the level count as "in progress".
      const pending = state.buildings.filter(b => b.isConstructing && b.level >= lv && b.level > 1).length;
      const eta = levelsEta(engine, state, lv, left);
      const pick = upgradeCandidate(engine, state);
      const save = pick && pick.level < lv && !engine.resourceSystem.canAfford(state, engine.buildingSystem.getUpgradeCost(pick))
        ? etaSuffix(costEta(state, engine.buildingSystem.getUpgradeCost(pick))) : '';
      return { ...base, eta, pending, text: i18n.t('guide.levels', { n: left, lv }) + pendingSuffix(pending) + save, action: state.buildings.length > 0 ? { kind: 'rooms' } : { kind: 'build', type: 'quarters' } };
    }
    case 'pop': {
      if (state.survivors.length >= state.maxPopulation) return { ...base, text: i18n.t('guide.popBeds'), action: { kind: 'build', type: 'quarters' }, immediate: true };
      return { ...base, text: i18n.t('guide.pop', { n: left }), action: { kind: 'people' } };
    }
    case 'outposts':
      return { ...base, text: i18n.t('guide.outposts', { n: left }), action: { kind: 'surface' } };
    case 'influence': {
      // [ux-wp1 B3] The Council Hall is a canteen specialty: open a canteen.
      const eta = costEta(state, { influence: t });
      return { ...base, eta, text: i18n.t('guide.influence') + etaSuffix(eta), action: { kind: 'rooms', type: 'canteen', open: true } };
    }
    case 'seedVault': {
      const rs = engine.researchSystem;
      const eta = rs.activeId(state) === 'seedVault' ? rs.etaSeconds(state, 'seedVault') : Infinity;
      return { ...base, eta, pending: rs.activeId(state) === 'seedVault' ? 1 : 0, text: i18n.t('guide.seedVault'), action: { kind: 'research' } };
    }
  }
}

/** [ux-wp1 M2] Seconds for one project's remaining stages: the larger of all their crew work and all their resources at today's income. */
function projectEta(engine: GameEngine, state: GameState, def: ProjectDef): number {
  const ps = engine.projectSystem;
  if (projectDone(state, def.id)) return 0;
  if (!ps.isAvailable(state, def)) return Infinity;
  const prog = ps.progressOf(state, def.id);
  const active = state.activeProjectId === def.id;
  const speed = active ? ps.speed(state, def.id) : 0;
  let work = 0;
  const need: Record<string, number> = {};
  for (let i = prog.stage; i < def.stages.length; i++) {
    const st = def.stages[i];
    const first = i === prog.stage;
    work += first && active && speed > 0 ? ps.workEta(state, def.id) : (st.hours * 3600 - (first ? prog.work : 0));
    for (const [r, v] of Object.entries(st.cost)) need[r] = (need[r] ?? 0) + (v ?? 0) - (first ? prog.paid[r as ResourceType] ?? 0 : 0);
  }
  return Math.max(work, flowEta(state, need));
}

function projectRequirement(engine: GameEngine, state: GameState, id: string): Requirement {
  const locale = i18n.currentLocale;
  const def = getProject(id)!;
  const ps = engine.projectSystem;
  const n = def.stages.length;
  const done = stagesDone(state, id);
  const finished = projectDone(state, id);
  const active = state.activeProjectId === id;
  const part = active && !finished ? (ps.paidFraction(state, id) + ps.workFraction(state, id)) / 2 : 0;
  const base = {
    id: `project:${id}`, icon: def.icon, title: i18n.t('act.charter', { name: def.name[locale] }), progress: [done, n] as [number, number],
    fraction: finished ? 1 : Math.min(1, (done + part) / n), done: finished, immediate: false, project: id, eta: projectEta(engine, state, def),
  };
  const action: ObjectiveAction = { kind: 'projects' };
  if (finished) return { ...base, text: def.name[locale], action: null };
  const stageNo = i18n.t('next.stage', { n: Math.min(n, done + 1), all: n });
  const name = def.name[locale];
  // [ux-wp1 A3] A project that is still closed is never "start it now": say what it waits for.
  if (!ps.isAvailable(state, def)) return { ...base, locked: true, text: i18n.t('wp1.projLocked', { name, when: projectLockText(state, def) }), action };
  if (!active) {
    // Someone else holds the lot: say so, switching is one tap in the Projects panel.
    const key = state.activeProjectId ? 'guide.projSwitch' : def.variant && done === 0 ? 'guide.projStartDesign' : 'guide.projStart';
    return { ...base, text: i18n.t(key, { name }), action, immediate: true };
  }
  const stage = ps.stageOf(state, id);
  const workers = ps.workers(state, id).length;
  if (stage && workers < Math.min(stage.crew, 2)) return { ...base, text: i18n.t('guide.projCrew', { name, n: stage.crew - workers }), action, immediate: true };
  const missing = ps.missing(state, id);
  if (Object.keys(missing).length > 0) {
    // Goods the bunker could hand over right now beat goods it has to produce first.
    const handy = Object.entries(missing).some(([r, v]) => ps.deliverable(state, r as ResourceType, v as number) >= 1);
    return { ...base, text: i18n.t(handy ? 'guide.projDeliver' : 'guide.projNeed', { name, stage: stageNo, what: list(missing) }) + (handy ? '' : etaSuffix(flowEta(state, missing))), action, immediate: handy };
  }
  const eta = ps.workEta(state, id);
  return { ...base, text: i18n.t('guide.projWork', { name, stage: stageNo, t2: isFinite(eta) ? i18n.formatDuration(eta) : '…' }), action };
}

/** Every requirement of the Act (goals, then charter projects) with its own next step. */
export function actRequirements(engine: GameEngine, state: GameState, act: ActDef = actOf(state)): Requirement[] {
  const out: Requirement[] = act.goals.map((g, i) => goalRequirement(engine, state, act, g, i));
  for (const id of act.charter) if (getProject(id)) out.push(projectRequirement(engine, state, id));
  return out;
}

/**
 * [ux-wp1 M2] When the Act should end at today's rates: goals run side by side, charter projects one after another (one is active at a time).
 * `known` is false when some open requirement has no estimate (people arriving, outposts, an era step): then `seconds` is only a lower bound.
 */
export function actEta(reqs: Requirement[]): { seconds: number; known: boolean; slowest: Requirement | null } {
  const open = reqs.filter(r => !r.done);
  if (open.length === 0) return { seconds: 0, known: true, slowest: null };
  const known = open.every(r => isFinite(r.eta));
  const goals = open.filter(r => !r.project && isFinite(r.eta));
  const projects = open.filter(r => r.project && isFinite(r.eta));
  const projSum = projects.reduce((s, r) => s + r.eta, 0);
  const slowGoal = goals.reduce<Requirement | null>((a, b) => (!a || b.eta > a.eta ? b : a), null);
  const slowProj = projects.reduce<Requirement | null>((a, b) => (!a || b.eta > a.eta ? b : a), null);
  const goalMax = slowGoal?.eta ?? 0;
  const seconds = Math.max(goalMax, projSum);
  const slowest = projSum > goalMax ? slowProj : slowGoal;
  return { seconds, known, slowest };
}

/** The one requirement to put in front of the player: a free action first, otherwise the furthest-behind one. */
export function pickRequirement(reqs: Requirement[]): Requirement | null {
  const all = reqs.filter(r => !r.done);
  if (all.length === 0) return null;
  const ready = all.filter(r => !r.locked);
  const open = ready.length > 0 ? ready : all;
  const quick = open.filter(r => r.immediate);
  const pool = quick.length > 0 ? quick : open;
  return pool.reduce((a, b) => (b.fraction < a.fraction ? b : a));
}

/** [ux-wp1 A1] The one step every screen shows as "what to do now": the tutorial's step while it lasts, then the Act's. */
export interface NowStep {
  id: string;
  icon: string;
  text: string;
  /** What the step belongs to (the requirement's name, or "First steps"). */
  title: string;
  action: ObjectiveAction;
  tutorial: boolean;
}

export function nowStep(engine: GameEngine, state: GameState): NowStep | null {
  const os = engine.objectiveSystem;
  if (os.inTutorial(state)) {
    const o = os.current(state);
    const [c, t] = o.progress(state);
    const count = t > 1 ? ` (${Math.min(c, t)}/${t})` : '';
    return { id: `obj:${o.id}`, icon: o.icon, text: (o.text[i18n.currentLocale] ?? o.text.en) + count, title: i18n.t('wp1.tutorialTitle'), action: o.action, tutorial: true };
  }
  const lg = state.longGame;
  if (!lg || lg.meta.legacy) return null;
  const pick = pickRequirement(actRequirements(engine, state));
  return pick ? { id: pick.id, icon: pick.icon, text: pick.text, title: pick.title, action: pick.action, tutorial: false } : null;
}

/** The HUD objective for a long-game run after the tutorial; null when there is nothing to guide (then the old tasks show). */
export function guideObjective(engine: GameEngine, state: GameState): Objective | null {
  const lg = state.longGame;
  if (!lg || lg.meta.legacy) return null;
  const act = actOf(state);
  const reqs = actRequirements(engine, state, act);
  const pick = pickRequirement(reqs);
  if (!pick) {
    // The last Act is done: Genesis is the next step.
    if (act.id >= ACTS.length) {
      const t = i18n.t('guide.genesis');
      return { id: 'guide:genesis', icon: '[[isotope7]]', text: { he: t, en: t }, progress: () => [1, 1], reward: {}, action: { kind: 'genesis' } };
    }
    return null;
  }
  const t = pick.text;
  return {
    id: `guide:${pick.id}`, icon: pick.icon, text: { he: t, en: t }, reward: {}, action: pick.action,
    // Re-read each time: the line must follow the live state, not the moment it was picked.
    progress: s => {
      const again = actRequirements(engine, s, actOf(s)).find(r => r.id === pick.id);
      const r = again ?? pick;
      return r.lineProgress ?? r.progress;
    },
  };
}

/** [plan4:GP-3] One thing the check-in screen suggests doing now: a line and where one tap leads. */
export interface Suggestion {
  id: string;
  icon: string;
  text: string;
  action: ObjectiveAction;
}

/**
 * [plan4:GP-3] Up to `max` suggestions for the "Now" part of the check-in screen: the tutorial's step while it lasts [ux-wp1 A1], then free actions
 * (a project to start, a crew to put on it), then idle research, then full storage (spend it on a project), then the Act's slower requirements.
 */
export function checkinSuggestions(engine: GameEngine, state: GameState, max = 3): Suggestion[] {
  const out: Suggestion[] = [];
  const lg = state.longGame;
  const reqs = lg && !lg.meta.legacy ? actRequirements(engine, state).filter(r => !r.done && !r.locked && r.action) : [];
  const push = (s: Suggestion) => {
    if (!s.action || out.some(o => o.id === s.id || (o.action?.kind === s.action?.kind && o.text === s.text))) return;
    out.push(s);
  };
  const now = nowStep(engine, state);
  if (now?.tutorial) push({ id: now.id, icon: now.icon, text: now.text, action: now.action });
  for (const r of reqs.filter(q => q.immediate)) push({ id: r.id, icon: r.icon, text: r.text, action: r.action });
  const rs = engine.researchSystem;
  if (!rs.activeId(state) && RESEARCH.some(r => rs.canStart(state, r.id))) {
    push({ id: 'research', icon: '[[research]]', text: i18n.t('checkin.sugResearch'), action: { kind: 'research' } });
  }
  const full = (['materials', 'food', 'water', 'knowledge'] as ResourceType[]).find(r => {
    const res = state.resources[r];
    return res.cap > 0 && res.amount >= res.cap * 0.95 && res.productionRate > res.consumptionRate;
  });
  if (full) push({ id: 'storage', icon: '[[storage]]', text: i18n.t('checkin.sugStorage', { res: i18n.t(`resources.${full}`) }), action: { kind: lg ? 'projects' : 'rooms' } });
  // [plan4:GP-1] Daily orders still open: one tap to the sheet (after the free actions, before the slow requirements).
  const dsum = engine.dailySystem.summary(state);
  if (dsum.n > dsum.done) push({ id: 'daily', icon: '[[target]]', text: i18n.t('checkin.sugDaily', { n: dsum.n - dsum.done }), action: { kind: 'daily' } });
  for (const r of reqs.filter(q => !q.immediate).sort((a, b) => a.fraction - b.fraction)) push({ id: r.id, icon: r.icon, text: r.text, action: r.action });
  if (out.length === 0) {
    const o = engine.objectiveSystem.current(state);
    push({ id: `obj:${o.id}`, icon: o.icon, text: o.text[i18n.currentLocale] ?? o.text.en, action: o.action });
  }
  return out.slice(0, max);
}
