import type { GameState, ProjectProgress, ResourceType, SurvivorState } from '../core/GameState';
import type { StateManager } from '../core/StateManager';
import { bus } from '../core/EventBus';
import { PROJECTS, getProject, projectDone, stagesDone, type ProjectDef, type ProjectStage } from '../data/projects';
import { masteryMultiplier } from '../data/mastery';
import { workSpeedMult } from './economy'; // [ux-wp2 S7/M7] idle labour and Systems Memory
import type { ResourceSystem } from './ResourceSystem';
import type { PopulationSystem } from './PopulationSystem';

/** Crew members of a project are stored on the survivor like ruin crews: assignedBuildingId = `p_<project id>`. */
export const crewKey = (id: string) => `p_${id}`;

/** Part of each store that a hand delivery leaves alone, so a project can never starve the bunker. */
const RESERVE: Partial<Record<ResourceType, number>> = {
  food: 0.4, water: 0.4, medicine: 0.5, materials: 0.1, knowledge: 0.1, scrap: 0.1,
};

/**
 * [LateGame B1] Big projects. Progress needs two things at once, and both keep running while the player is away:
 * the stage's resources (delivered by hand or taken from storage overflow, see `absorb`) and crew work.
 * One project is active at a time (`state.activeProjectId`, shared with the overflow code in ResourceSystem).
 */
export class ProjectSystem {
  private sm: StateManager;
  private population: PopulationSystem;

  constructor(sm: StateManager, _resources: ResourceSystem, population: PopulationSystem) {
    this.sm = sm;
    this.population = population;
  }

  // ---- reading ----

  progressOf(state: GameState, id: string): ProjectProgress {
    return state.lateGame.projects[id] ?? { stage: 0, paid: {}, work: 0 };
  }

  /** The stage in work, or undefined when the project is finished. */
  stageOf(state: GameState, id: string): ProjectStage | undefined {
    return getProject(id)?.stages[this.progressOf(state, id).stage];
  }

  isAvailable(state: GameState, def: ProjectDef): boolean {
    return (state.era ?? 0) >= def.era && (state.longGame?.meta.act ?? 99) >= (def.act ?? 0);
  }

  crew(state: GameState, id: string): SurvivorState[] {
    const key = crewKey(id);
    return state.survivors.filter(s => s.assignedBuildingId === key);
  }

  /** Crew that is actually on site (people away on an expedition don't work). */
  workers(state: GameState, id: string): SurvivorState[] {
    return this.crew(state, id).filter(s => !s.isOnMission && !s.child);
  }

  /** Work speed of the crew on the current stage (1 = a full crew at base skill). */
  speed(state: GameState, id: string): number {
    const stage = this.stageOf(state, id);
    if (!stage) return 0;
    const w = this.workers(state, id);
    if (w.length === 0) return 0;
    return Math.min(1, w.length / stage.crew) * masteryMultiplier(w) * workSpeedMult(state);
  }

  /** How much of the stage's resources has been delivered, 0..1. */
  paidFraction(state: GameState, id: string): number {
    const stage = this.stageOf(state, id);
    if (!stage) return 1;
    const paid = this.progressOf(state, id).paid;
    let have = 0;
    let need = 0;
    for (const [r, v] of Object.entries(stage.cost) as [ResourceType, number][]) {
      need += v;
      have += Math.min(v, paid[r] ?? 0);
    }
    return need > 0 ? have / need : 1;
  }

  workFraction(state: GameState, id: string): number {
    const stage = this.stageOf(state, id);
    return stage ? Math.min(1, this.progressOf(state, id).work / (stage.hours * 3600)) : 1;
  }

  /** Seconds until the crew work of the current stage is done at the current speed (Infinity with no crew). */
  workEta(state: GameState, id: string): number {
    const stage = this.stageOf(state, id);
    const sp = this.speed(state, id);
    if (!stage || sp <= 0) return Infinity;
    return Math.max(0, stage.hours * 3600 - this.progressOf(state, id).work) / sp;
  }

  // ---- choosing and staffing ----

  /** [P2-2] Picks the project's design; only until its first stage is done (afterwards it is what was built). */
  setDesign(id: string, design: 'a' | 'b'): boolean {
    const state = this.sm.state;
    const def = getProject(id);
    if (!def?.variant && design === 'b') return false;
    if (!def || stagesDone(state, id) > 0) return false;
    this.sm.applyDelta({ path: 'lateGame.designs', value: { ...(state.lateGame.designs ?? {}), [id]: design } });
    return true;
  }

  /** Makes a project the active one (the crew of the previous one goes back to idle). */
  setActive(id: string | null): boolean {
    const state = this.sm.state;
    if (id !== null) {
      const def = getProject(id);
      if (!def || !this.isAvailable(state, def) || projectDone(state, id)) return false;
    }
    // "Stop" must stick: without this flag update() would pick the first open project again on the next tick.
    if (!!state.lateGame.projectsPaused !== (id === null)) this.sm.applyDelta({ path: 'lateGame.projectsPaused', value: id === null });
    if (state.activeProjectId === id) return true;
    if (state.activeProjectId) this.releaseCrew(state.activeProjectId);
    this.sm.applyDelta({ path: 'activeProjectId', value: id });
    return true;
  }

  private releaseCrew(id: string): void {
    const key = crewKey(id);
    const state = this.sm.state;
    if (!state.survivors.some(s => s.assignedBuildingId === key)) return;
    this.sm.applyDelta({ path: 'survivors', value: state.survivors.map(s => (s.assignedBuildingId === key ? { ...s, assignedBuildingId: null } : s)) });
  }

  canAssign(state: GameState, id: string): boolean {
    const stage = this.stageOf(state, id);
    return !!stage && this.crew(state, id).length < stage.crew;
  }

  /** Puts a survivor on the project's crew, taking them off whatever they were doing. */
  assign(id: string, survivorId: string): boolean {
    const state = this.sm.state;
    const s = state.survivors.find(x => x.id === survivorId);
    if (!s || s.child || s.isOnMission || !this.canAssign(state, id) || state.activeProjectId !== id) return false;
    if (s.assignedBuildingId === crewKey(id)) return true;
    this.population.assignSurvivorToBuilding(this.sm, survivorId, null);
    this.sm.applyDelta({
      path: 'survivors',
      value: this.sm.state.survivors.map(x => (x.id === survivorId ? { ...x, assignedBuildingId: crewKey(id) } : x)),
    });
    return true;
  }

  unassign(survivorId: string): void {
    this.population.assignSurvivorToBuilding(this.sm, survivorId, null);
  }

  /** Fills the crew: idle people first, then the most experienced from the rooms with the most workers. */
  autoStaff(id: string): number {
    let added = 0;
    for (let guard = 0; guard < 6; guard++) {
      const state = this.sm.state;
      if (!this.canAssign(state, id)) break;
      const crewCount = (jobId: string | null) => state.buildings.find(b => b.id === jobId)?.assignedSurvivorIds.length ?? 0;
      const pick = state.survivors
        .filter(s => !s.child && !s.isOnMission && s.health > 30 && !(s.assignedBuildingId ?? '').startsWith('p_') && !(s.assignedBuildingId ?? '').startsWith('r_'))
        .sort((a, b) => Number(!!a.assignedBuildingId) - Number(!!b.assignedBuildingId)
          || crewCount(b.assignedBuildingId) - crewCount(a.assignedBuildingId) || (b.mxp ?? 0) - (a.mxp ?? 0))[0];
      if (!pick || !this.assign(id, pick.id)) break;
      added++;
    }
    return added;
  }

  // ---- delivering resources ----

  /** Takes up to `amount` of a resource into the active project's current stage; returns what it took. */
  absorb(state: GameState, resource: ResourceType, amount: number): number {
    const id = state.activeProjectId;
    if (!id || amount <= 0) return 0;
    const stage = this.stageOf(state, id);
    const cost = stage?.cost[resource];
    if (!stage || !cost) return 0;
    const prog = this.progressOf(state, id);
    const need = cost - (prog.paid[resource] ?? 0);
    if (need <= 0) return 0;
    const take = Math.min(need, amount);
    // Written straight into the state: this runs in the middle of the resource tick.
    const projects = state.lateGame.projects;
    projects[id] = { ...prog, paid: { ...prog.paid, [resource]: (prog.paid[resource] ?? 0) + take } };
    return take;
  }

  /** What is still missing for the current stage of a project. */
  missing(state: GameState, id: string): Partial<Record<ResourceType, number>> {
    const stage = this.stageOf(state, id);
    const out: Partial<Record<ResourceType, number>> = {};
    if (!stage) return out;
    const paid = this.progressOf(state, id).paid;
    for (const [r, v] of Object.entries(stage.cost) as [ResourceType, number][]) {
      const left = v - (paid[r] ?? 0);
      if (left > 0.5) out[r] = left;
    }
    return out;
  }

  /** How much of a missing resource can be delivered by hand now (storage keeps its reserve). */
  deliverable(state: GameState, resource: ResourceType, missing: number): number {
    const res = state.resources[resource];
    if (!res) return 0;
    const reserve = Number.isFinite(res.cap) ? (RESERVE[resource] ?? 0) * res.cap : 0;
    return Math.max(0, Math.min(missing, res.amount - reserve));
  }

  /** Hand delivery: moves stock into the active project's stage. Returns the delivered amounts. */
  deposit(id: string): Partial<Record<ResourceType, number>> {
    const state = this.sm.state;
    const given: Partial<Record<ResourceType, number>> = {};
    if (state.activeProjectId !== id) return given;
    for (const [r, left] of Object.entries(this.missing(state, id)) as [ResourceType, number][]) {
      const amount = Math.floor(this.deliverable(this.sm.state, r, left));
      if (amount < 1) continue;
      this.sm.applyDelta({ path: `resources.${r}.amount`, value: this.sm.state.resources[r].amount - amount });
      this.absorb(this.sm.state, r, amount);
      given[r] = amount;
    }
    return given;
  }

  /** Shop hook: gives the active stage a share of what it needs, in work and in resources. */
  boostStage(_state: GameState, frac: number): boolean {
    const state = this.sm.state;
    const id = state.activeProjectId;
    const stage = id ? this.stageOf(state, id) : undefined;
    if (!id || !stage) return false;
    const prog = this.progressOf(state, id);
    const paid = { ...prog.paid };
    for (const [r, v] of Object.entries(stage.cost) as [ResourceType, number][]) paid[r] = Math.min(v, (paid[r] ?? 0) + v * frac);
    this.sm.applyDelta({
      path: `lateGame.projects.${id}`,
      value: { ...prog, paid, work: Math.min(stage.hours * 3600, prog.work + stage.hours * 3600 * frac) },
    });
    return true;
  }

  // ---- ticking ----

  /** Crew work on the active project, and mastery for everyone at work. Runs online and in the offline simulation. */
  update(dt: number): void {
    this.population.accrueMastery(this.sm, dt);
    const state = this.sm.state;
    const id = state.activeProjectId;
    if (!id) {
      // Nothing chosen yet: the first open project becomes active so overflow and crews have somewhere to go.
      if ((state.era ?? 0) >= 2 && !state.lateGame.projectsPaused) this.advance(null);
      return;
    }
    const def = getProject(id);
    if (!def || projectDone(state, id)) {
      this.advance(null);
      return;
    }
    const stage = def.stages[this.progressOf(state, id).stage];
    if (!stage) return;
    const need = stage.hours * 3600;
    let prog = this.progressOf(state, id);
    const sp = this.speed(state, id);
    if (sp > 0 && prog.work < need) {
      prog = { ...prog, work: Math.min(need, prog.work + dt * sp) };
      this.sm.applyDelta({ path: `lateGame.projects.${id}`, value: prog });
    }
    if (prog.work >= need - 1e-6 && this.paidFraction(this.sm.state, id) >= 0.999999) this.finishStage(def);
  }

  private finishStage(def: ProjectDef): void {
    const state = this.sm.state;
    const prog = this.progressOf(state, def.id);
    const stage = prog.stage + 1;
    this.sm.applyDelta({ path: `lateGame.projects.${def.id}`, value: { stage, paid: {}, work: 0 } });
    this.sm.applyDelta({ path: 'lateGame.stagesDone', value: state.lateGame.stagesDone + 1 });
    bus.emit('project:stage', def.id, stage);
    if (stage >= def.stages.length) {
      if (!state.storyFlags.includes(def.flag)) this.sm.applyDelta({ path: 'storyFlags', value: [...state.storyFlags, def.flag] });
      this.releaseCrew(def.id);
      bus.emit('project:done', def.id);
      this.advance(def.id);
    }
  }

  /** After a finished project the next unfinished one in the list becomes active, so the work (and overflow) flows on. */
  private advance(from: string | null): void {
    const state = this.sm.state;
    const open = PROJECTS.filter(p => p.id !== from && this.isAvailable(state, p) && !projectDone(state, p.id));
    // The current Act's charter first (it is what opens the next Act), then the oldest open project.
    const act = state.longGame?.meta.act;
    const next = open.find(p => p.act === act) ?? open[0];
    if (state.activeProjectId !== (next?.id ?? null)) {
      if (state.activeProjectId) this.releaseCrew(state.activeProjectId);
      this.sm.applyDelta({ path: 'activeProjectId', value: next?.id ?? null });
    }
  }

  /** Total stages in all projects, and how many are done (for panels and the weekly challenge). */
  totals(state: GameState): { done: number; all: number } {
    let done = 0;
    let all = 0;
    for (const p of PROJECTS) {
      all += p.stages.length;
      done += stagesDone(state, p.id);
    }
    return { done, all };
  }

  /** Whether the bunker can afford a hand delivery of anything right now. */
  canDeposit(state: GameState, id: string): boolean {
    if (state.activeProjectId !== id) return false;
    return Object.entries(this.missing(state, id)).some(([r, left]) => this.deliverable(state, r as ResourceType, left as number) >= 1);
  }
}
