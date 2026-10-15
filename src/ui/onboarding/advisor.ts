import type { GameApp } from '../../app';
import type { BuildingType, GameState, ResourceType } from '../../core/GameState';
import type { Objective, ObjectiveAction } from '../../systems/ObjectiveSystem';
import { actRequirements, upgradeCandidate } from '../../systems/Guide';
import { getDef } from '../../data/buildingDefs';
import { RESEARCH } from '../../data/research';
import { i18n } from '../../i18n/I18nManager';
import { RESOURCE_ICONS } from '../dom';
import { fmtDuration } from '../format';
import { floorTagIso } from '../floorTag';
import type { GoalView, StripView } from '../HUD';
import { adviseOrder, FTUE_STEPS, MAX_GOALS, type AdvisorInput, type AdvisorPick } from './advisorRules';

/** The stores that can starve the bunker (a power deficit with no reserve left is judged by the power ratio). */
const STORES: ResourceType[] = ['food', 'water', 'power'];
/** How often the advice is recomputed (ms): the goals read the whole Act. */
const REFRESH_MS = 250;

/** Short (at most eight words) lines for the tutorial steps; the floor comes from floorTag (he "קומה 3", en "B3"). */
const SHORT: Record<string, number | null> = {
  restoreGenerator: 2, firstNote: 0, readNote: null, pump: 1, farm: 1, staff: null, generator: null, drain: 2, workshop: 2,
  lab: null, hazmat: null, expedition: null, pop5: null, canteen: 0, upgrade: null, radio: null, research5: null,
};

/** What a goal's room makes (a crisis in one of these is the goal's job, not a second line). */
function roomOf(action: ObjectiveAction): BuildingType | undefined {
  if (!action) return undefined;
  if (action.kind === 'build') return action.type;
  if (action.kind === 'ruin') return action.restoresTo;
  if (action.kind === 'rooms') return action.type;
  return undefined;
}

function makes(type: BuildingType | undefined): string[] {
  return type ? Object.keys(getDef(type)?.production ?? {}) : [];
}

/** A countdown; an already empty store shows the warning sign instead of "0s". */
const clock = (s: number) => (s >= 1 ? fmtDuration(Math.ceil(s)) : '[[warning]]');

export interface Advice {
  pick: AdvisorPick | null;
  view: StripView | null;
  /** Routes the line (the tap on the strip). */
  go: () => void;
}

/**
 * [ux-redesign W3a] The "What now?" advisor. Reads the state (nothing here changes the game), orders it with advisorRules.ts and turns
 * the first line into what the strip shows and where its tap goes. Routes only through runAction and the HUD's own handlers.
 */
export class Advisor {
  private app: GameApp;
  private at = -Infinity;
  private last: Advice = { pick: null, view: null, go: () => {} };

  constructor(app: GameApp) {
    this.app = app;
  }

  /** The current advice (recomputed at most four times a second). */
  advice(force = false): Advice {
    const now = performance.now();
    if (!force && now - this.at < REFRESH_MS) return this.last;
    this.at = now;
    this.last = this.compute(this.app.state);
    return this.last;
  }

  /**
   * [phase1] The strip shows this store's (or the power) crisis right now, so a "running low" toast for it would be a second copy.
   * Recomputes (call it on the rare warning, not every frame).
   */
  showsStore(resource: string): boolean {
    const p = this.advice(true).pick;
    return !!p && (p.kind === 'crisis' || !!p.urgent) && p.resource === resource;
  }

  /** A crisis leads the strip (raid, incident, store about to empty, power short, or a goal standing in for one). */
  crisis(): boolean {
    const p = this.advice().pick;
    return !!p && (p.kind === 'crisis' || !!p.urgent);
  }

  private objective(state: GameState): Objective {
    return this.app.engine.objectiveSystem.current(state);
  }

  /** The short line of an objective (tutorial steps have one; the Act's steps from Guide.ts are already short). */
  objectiveText(o: Objective): string {
    const key = `ux3a.obj.${o.id}`;
    if (i18n.has(key)) {
      const floor = SHORT[o.id];
      return i18n.t(key, floor === null || floor === undefined ? {} : { f: floorTagIso(floor) });
    }
    return o.text[i18n.currentLocale] ?? o.text.en;
  }

  rewardText(o: Objective): string {
    return (Object.entries(o.reward) as [ResourceType, number][]).map(([r, v]) => `${RESOURCE_ICONS[r] ?? ''}${v}`).join(' ');
  }

  private input(state: GameState, o: Objective): AdvisorInput {
    const engine = this.app.engine;
    const os = engine.objectiveSystem;
    const step = state.tutorialStep ?? 0;
    // The goal's own room; in the first steps also the rooms the next tutorial steps restore (the tutorial is the way out of the
    // opening shortage, so the strip keeps leading it, with the countdown).
    const fixes = new Set(makes(roomOf(o.action)));
    if (os.inTutorial(state) && step < FTUE_STEPS) {
      const probe = { ...state } as GameState;
      for (let s = step + 1; s < FTUE_STEPS; s++) {
        probe.tutorialStep = s;
        for (const r of makes(roomOf(os.current(probe).action))) fixes.add(r);
      }
    }
    const net = (r: ResourceType) => (state.resources[r]?.productionRate ?? 0) - (state.resources[r]?.consumptionRate ?? 0);
    // [phase2] Waiting cards are counted on the bell (Messages), never as the strip's line: the strip keeps the goal.
    const inbox = 0;
    const ds = engine.dailySystem;
    const rs = engine.researchSystem;
    const hasLab = state.buildings.some(b => b.type === 'laboratory');
    return {
      stores: STORES.map(id => ({ id, amount: state.resources[id]?.amount ?? 0, net: net(id) })),
      powerRatio: state.powerRatio ?? 1,
      powerUsed: (state.resources.power?.consumptionRate ?? 0) > 0,
      raid: !!state.danger?.raid,
      incidents: state.incidents?.length ?? 0,
      collect: {
        inbox,
        supply: engine.supplySystem.isReady(state),
        daily: ds.active(state) ? ds.summary(state).claimable : 0,
      },
      goal: { id: o.id, fixes: [...fixes] },
      idleResearch: hasLab && !rs.activeId(state) && RESEARCH.some(r => rs.canStart(state, r.id)),
      upgrade: this.affordableUpgrade(state) !== null,
      // [phase1] Tutorial or Act I (a legacy save has no Acts to speak of): collect items are a bell badge only.
      early: os.inTutorial(state) || (!!state.longGame && !state.longGame.meta.legacy && state.longGame.meta.act <= 1),
    };
  }

  private affordableUpgrade(state: GameState) {
    const engine = this.app.engine;
    const b = upgradeCandidate(engine, state);
    return b && engine.resourceSystem.canAfford(state, engine.buildingSystem.getUpgradeCost(b)) ? b : null;
  }

  private compute(state: GameState): Advice {
    if (!state) return { pick: null, view: null, go: () => {} };
    const o = this.objective(state);
    const pick = adviseOrder(this.input(state, o))[0] ?? null;
    if (!pick) return { pick, view: null, go: () => {} };
    const app = this.app;
    const hud = app.hud;
    const click = () => app.audio.play('click');
    const view = (icon: string, text: string, go: () => void, extra: Partial<StripView> = {}): Advice => ({
      pick, go,
      // [phase1] The store / power this line is about: the HUD then leaves its countdown and its banner to the strip.
      view: { key: pick.key, kind: pick.kind, icon, text, progress: null, reward: '', resource: pick.resource, ...extra },
    });
    switch (pick.kind) {
      case 'crisis': {
        if (pick.key === 'raid') {
          const d = app.danger.dangerBanner();
          return view('[[warning]]', i18n.t('ux3a.crisis.raid'), () => { click(); if (app.danger.dangerBanner()) app.danger.showDanger(); },
            d ? { urgent: `[[clock]] ${clock(d.left)}` } : {});
        }
        if (pick.key === 'incident') return view('[[fire]]', i18n.t('ux3a.crisis.incident'), () => { click(); hud.onIncident?.(); });
        // [phase1] The strip is the one place for the power shortage (the banner is gone while it shows): it carries the level.
        if (pick.key === 'power') return view('[[power]]', i18n.t('ux3a.crisis.power'), () => { click(); hud.onPowerTap?.(); },
          { urgent: `[[power]] ${Math.round((state.powerRatio ?? 1) * 100)}%` });
        const r = pick.resource as ResourceType;
        return view(RESOURCE_ICONS[r] ?? '[[warning]]', i18n.t('ux3a.crisis.store', { res: i18n.t(`resources.${r}`) }),
          () => { click(); hud.onResourceTap?.(r); }, { urgent: `[[clock]] ${clock(pick.seconds ?? 0)}` });
      }
      case 'collect': {
        if (pick.key === 'inbox') {
          const n = this.input(state, o).collect.inbox;
          return view('[[inbox]]', i18n.t('ux3a.collect.inbox', { n }), () => { click(); hud.onInbox?.(); });
        }
        if (pick.key === 'supply') return view('[[gift]]', i18n.t('ux3a.collect.supply'), () => { click(); hud.onSupply?.(); });
        return view('[[target]]', i18n.t('ux3a.collect.daily'), () => { click(); hud.onDaily?.(); });
      }
      case 'goal': {
        const urgent = pick.urgent
          ? `${pick.resource === 'power' ? '[[power]]' : RESOURCE_ICONS[pick.resource as ResourceType] ?? '[[warning]]'} ${pick.seconds !== undefined ? clock(pick.seconds) : '!'}`
          : undefined;
        return view(o.icon, this.objectiveText(o), () => { click(); app.runAction(this.objective(app.state).action); },
          { progress: o.progress(state), reward: this.rewardText(o), urgent });
      }
      default: {
        if (pick.key === 'research') return view('[[research]]', i18n.t('ux3a.rec.research'), () => { click(); app.runAction({ kind: 'research' }); });
        const b = this.affordableUpgrade(state);
        const name = b ? getDef(b.type)?.name[i18n.currentLocale] ?? '' : '';
        return view('[[up]]', i18n.t('ux3a.rec.upgrade', { name }), () => { click(); app.runAction({ kind: 'rooms' }); });
      }
    }
  }

  /** Up to three active goals for the unfolded strip: the objective (with its reward), then the Act's other open requirements. */
  goals(): GoalView[] {
    const app = this.app;
    const state = app.state;
    if (!state) return [];
    const o = this.objective(state);
    const out: GoalView[] = [{
      icon: o.icon, text: this.objectiveText(o), progress: o.progress(state), reward: this.rewardText(o),
      onPress: () => { app.audio.play('click'); app.runAction(this.objective(app.state).action); },
    }];
    // During the tutorial the list stays one line (no "goals" key): one thing at a time.
    if (app.engine.objectiveSystem.inTutorial(state) || !state.longGame || state.longGame.meta.legacy) return out;
    const lead = o.id.startsWith('guide:') ? o.id.slice('guide:'.length) : '';
    const reqs = actRequirements(app.engine, state).filter(r => !r.done && r.id !== lead && r.action)
      .sort((a, b) => Number(!!a.locked) - Number(!!b.locked) || b.fraction - a.fraction);
    for (const r of reqs) {
      if (out.length >= MAX_GOALS) break;
      out.push({
        icon: r.icon, text: r.title, progress: r.progress, reward: '',
        onPress: () => { app.audio.play('click'); app.runAction(r.action); },
      });
    }
    return out;
  }
}
