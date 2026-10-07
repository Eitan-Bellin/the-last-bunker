import type { GameEngine } from '../core/GameEngine';
import type { GameState, ResourceType } from '../core/GameState';
import { ACTS, actOf, type ActDef, type ActGoal } from '../data/acts';
import { eraOf } from '../data/eras';
import { getProject, projectDone, stagesDone } from '../data/projects';
import { RESEARCH } from '../data/research';
import { i18n } from '../i18n/I18nManager';
import { RESOURCE_ICONS } from '../ui/dom';
import type { Objective, ObjectiveAction } from './ObjectiveSystem';
import { wingOptions } from '../data/wings';

/**
 * [Q2] The guide: what blocks the run right now, in plain words, and where to tap to deal with it.
 * After the tutorial the HUD's objective line is this (not a generic "add 5 levels" task), and the Command panel lists
 * every requirement of the Act with its own next step. Pure reading of the state: nothing here changes the game.
 */
export interface Requirement {
  id: string;
  icon: string;
  /** What is left to do about this requirement, in the current language. */
  text: string;
  /** Short name of the requirement itself (the goal's text, or the project's name). */
  title: string;
  progress: [number, number];
  /** 0..1 */
  fraction: number;
  action: ObjectiveAction;
  done: boolean;
  /** The player can act on it right now at no cost (start a project, put a crew on it). Shown before slow things. */
  immediate: boolean;
  project?: string;
}

const ICONS: Record<ActGoal['kind'], string> = {
  era: '[[flag]]', ruins: '[[broom]]', research: '[[research]]', dig: '[[pick]]', levels: '[[up]]',
  pop: '[[people]]', outposts: '[[surface]]', influence: '[[books]]', seedVault: '[[research]]',
};

const list = (o: Partial<Record<ResourceType, number>>): string => Object.entries(o)
  .map(([r, v]) => `${RESOURCE_ICONS[r] ?? ''}${i18n.formatCompact(v ?? 0)}`).join(' ');

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

function goalRequirement(engine: GameEngine, state: GameState, act: ActDef, g: ActGoal, idx: number): Requirement {
  const locale = i18n.currentLocale;
  const [c, t] = g.progress(state);
  const done = c >= t;
  const base = { id: `goal${idx}`, icon: ICONS[g.kind], title: g.text[locale], progress: [Math.min(c, t), t] as [number, number], fraction: Math.min(1, c / Math.max(1, t)), done, immediate: false };
  if (done) return { ...base, text: g.text[locale], action: null };
  const left = t - c;
  switch (g.kind) {
    case 'era': {
      const era = eraOf(state);
      const sub = era.next.find(x => { const [a, b] = x.progress(state); return a < b; });
      const text = sub ? i18n.t('guide.era', { goal: sub.text[locale] ?? sub.text.en }) : g.text[locale];
      return { ...base, text, action: { kind: 'command' } };
    }
    case 'ruins':
      return { ...base, text: i18n.t('guide.ruins', { n: left }), action: { kind: 'ruins' }, immediate: true };
    case 'research': {
      const rs = engine.researchSystem;
      const active = rs.activeId(state);
      if (!active) return { ...base, text: i18n.t('guide.researchIdle', { c, t }), action: { kind: 'research' }, immediate: true };
      const eta = rs.etaSeconds(state, active);
      return { ...base, text: i18n.t('guide.researchBusy', { c, t, t2: isFinite(eta) ? i18n.formatDuration(eta) : '…' }), action: { kind: 'research' } };
    }
    case 'dig': {
      const bs = engine.buildingSystem;
      const block = bs.digBlock(state);
      if (block === 'digging') {
        const eta = engine.digSystem.eta(state);
        const crew = engine.digSystem.crew(state).length;
        const want = engine.digSystem.wanted(state);
        const text = crew < want ? i18n.t('guide.digCrew', { n: want - crew }) : i18n.t('guide.digBusy', { t2: isFinite(eta) ? i18n.formatDuration(eta) : '…' });
        return { ...base, text, action: { kind: 'dig' }, immediate: crew < want };
      }
      // [plan4:ST-5] No deeper floor allowed and no room left on the floors there are: widen a wing.
      if ((block === 'act' || block === 'max') && noSpace(engine, state)) {
        const o = wingOptions(state).filter(w => w.block === null || w.block === 'cost').sort((a, b) => (a.block === null ? 0 : 1) - (b.block === null ? 0 : 1) || a.floor - b.floor)[0];
        if (o) return { ...base, text: i18n.t('guide.wing', { cost: list(o.cost) }), action: null, immediate: o.block === null };
      }
      const over = bs.digOverCap(state);
      if (over) return { ...base, text: i18n.t('guide.digStorage', { res: i18n.t(`resources.${over.resource}`) }), action: { kind: 'rooms' } };
      const cost = bs.digCost(state);
      const can = engine.resourceSystem.canAfford(state, cost);
      return { ...base, text: can ? i18n.t('guide.digReady', { cost: list(cost) }) : i18n.t('guide.digSave', { cost: list(cost) }), action: { kind: 'dig' }, immediate: can };
    }
    case 'levels': {
      const lv = g.level ?? 0;
      const below = state.buildings.filter(b => b.level === lv - 1).length;
      return { ...base, text: i18n.t('guide.levels', { n: left, lv }), action: below > 0 || state.buildings.length > 0 ? { kind: 'rooms' } : null };
    }
    case 'pop': {
      if (state.survivors.length >= state.maxPopulation) return { ...base, text: i18n.t('guide.popBeds'), action: { kind: 'build', type: 'quarters' }, immediate: true };
      return { ...base, text: i18n.t('guide.pop', { n: left }), action: { kind: 'people' } };
    }
    case 'outposts':
      return { ...base, text: i18n.t('guide.outposts', { n: left }), action: { kind: 'surface' } };
    case 'influence':
      return { ...base, text: i18n.t('guide.influence'), action: { kind: 'rooms' } };
    case 'seedVault':
      return { ...base, text: i18n.t('guide.seedVault'), action: { kind: 'research' } };
  }
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
    fraction: finished ? 1 : Math.min(1, (done + part) / n), done: finished, immediate: false, project: id,
  };
  const action: ObjectiveAction = { kind: 'projects' };
  if (finished) return { ...base, text: def.name[locale], action: null };
  const stageNo = i18n.t('next.stage', { n: Math.min(n, done + 1), all: n });
  const name = def.name[locale];
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
    return { ...base, text: i18n.t(handy ? 'guide.projDeliver' : 'guide.projNeed', { name, stage: stageNo, what: list(missing) }), action, immediate: handy };
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

/** The one requirement to put in front of the player: a free action first, otherwise the furthest-behind one. */
export function pickRequirement(reqs: Requirement[]): Requirement | null {
  const open = reqs.filter(r => !r.done);
  if (open.length === 0) return null;
  const quick = open.filter(r => r.immediate);
  const pool = quick.length > 0 ? quick : open;
  return pool.reduce((a, b) => (b.fraction < a.fraction ? b : a));
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
      return again ? again.progress : pick.progress;
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
 * [plan4:GP-3] Up to `max` suggestions for the "Now" part of the check-in screen: free actions first (a project to start, a crew to put on it),
 * then idle research, then full storage (spend it on a project), then the Act's slower requirements. Pure reading of the state.
 */
export function checkinSuggestions(engine: GameEngine, state: GameState, max = 3): Suggestion[] {
  const out: Suggestion[] = [];
  const lg = state.longGame;
  const reqs = lg && !lg.meta.legacy ? actRequirements(engine, state).filter(r => !r.done && r.action) : [];
  const push = (s: Suggestion) => {
    if (!s.action || out.some(o => o.id === s.id || (o.action?.kind === s.action?.kind && o.text === s.text))) return;
    out.push(s);
  };
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
