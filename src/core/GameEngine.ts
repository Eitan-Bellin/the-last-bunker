import { StateManager } from './StateManager';
import { SaveManager } from './SaveManager';
import { bus } from './EventBus';
import { SeededRandom } from './Random';
import { createInitialState, migrateState, type ResourceType } from './GameState';
import { ResourceSystem, type OverflowAbsorber } from '../systems/ResourceSystem';
import { BuildingSystem } from '../systems/BuildingSystem';
import { PopulationSystem } from '../systems/PopulationSystem';
import { EventSystem, arrivalGap } from '../systems/EventSystem';
import { ResearchSystem } from '../systems/ResearchSystem';
import { ExplorationSystem } from '../systems/ExplorationSystem';
import { MetaSystem } from '../systems/MetaSystem';
import { ObjectiveSystem } from '../systems/ObjectiveSystem';
import { RestorationSystem } from '../systems/RestorationSystem';
import { EraSystem } from '../systems/EraSystem';
import { IncidentSystem } from '../systems/IncidentSystem';
import { FamilySystem } from '../systems/FamilySystem';
import { StorySystem } from '../systems/StorySystem';
import { SupplySystem } from '../systems/SupplySystem';
import { RushSystem } from '../systems/RushSystem';
import { ShopSystem, type ProjectBooster } from '../systems/ShopSystem';
import { ProjectSystem } from '../systems/ProjectSystem'; // [LateGame B1]
import { snapshot } from '../data/challenges'; // [LateGame B4]
import { DeathSystem } from '../systems/DeathSystem'; // [Danger]
import { MaintenanceSystem } from '../systems/MaintenanceSystem';
import { AwayDanger, type AwayDangerReport } from '../systems/AwayDanger';
import { DIG_LORE, seedRuins } from '../data/ruins';
import { logCrash } from './crashGuard';

const TICK_RATE = 10;
const TICK_INTERVAL = 1000 / TICK_RATE;
const TICK_SECONDS = 1 / TICK_RATE;
const AUTO_SAVE_INTERVAL = 30_000;
/**
 * Picture rate governor (battery and heat): the bunker is a slow place, so the picture is drawn at full speed only while
 * the player is touching it (and a moment after), at 30 fps while they watch, and at 15 fps once they stopped touching it.
 * Phones with 90/120 Hz screens used to draw 120 frames a second of a mostly still scene. The simulation is not affected.
 */
const FRAME_ACTIVE_MS = 1000 / 60;
const FRAME_CALM_MS = 1000 / 30;
const FRAME_IDLE_MS = 1000 / 15;
/** How long after the last touch the picture stays at full speed (camera glides and flicks need it). */
const ACTIVE_HOLD_MS = 1800;
const IDLE_AFTER_S = 30;
const OFFLINE_EFFICIENCY = 0.8;
const OFFLINE_MAX_SECONDS = 86_400;
const OFFLINE_STEP_SECONDS = 60;
/** [Danger C4] Away, hunger can hurt but never takes a resident below this health. */
const OFFLINE_HEALTH_FLOOR = 15;

/** Most newcomers who gather at the door while the player is away. */
const AWAY_DOOR_MAX = 3;
/** Away from home, word travels slower: newcomers come at half the usual pace. */
const AWAY_ARRIVAL_SLOWDOWN = 2;
/** Resources whose overflow the welcome-back report counts (power is meant to be spent at once). */
const WASTE_TRACKED: ResourceType[] = ['food', 'water', 'materials', 'medicine', 'knowledge', 'scrap'];

export interface OfflineReport {
  seconds: number;
  gained: Partial<Record<ResourceType, number>>;
  /** Production thrown away because storage was full (S6: points the player at Storage). */
  wasted: Partial<Record<ResourceType, number>>;
  /** [Economy A1] Overflow turned into Trade credits instead of being thrown away, by source resource. */
  converted: Partial<Record<ResourceType, number>>;
  /** [Economy A1] Credits earned from that overflow. */
  credits: number;
  /** [Economy A3] Overflow the active project took before conversion, by resource. */
  absorbed: Partial<Record<ResourceType, number>>;
  /** Newcomers who arrived while away and now wait at the door. */
  arrivals: number;
  /** Expedition teams that came home meanwhile. */
  missions: number;
  /** Research finished meanwhile. */
  research: string[];
  /** [Danger C4] Raids and disasters that struck while away (soft version). */
  danger?: AwayDangerReport;
}

export class GameEngine {
  stateManager: StateManager;
  saveManager: SaveManager;
  rng: SeededRandom;

  resourceSystem: ResourceSystem;
  buildingSystem: BuildingSystem;
  populationSystem: PopulationSystem;
  deathSystem: DeathSystem; // [Danger]
  maintenanceSystem: MaintenanceSystem;
  private awayDanger: AwayDanger;
  eventSystem: EventSystem;
  researchSystem: ResearchSystem;
  explorationSystem: ExplorationSystem;
  metaSystem: MetaSystem;
  objectiveSystem: ObjectiveSystem;
  restorationSystem: RestorationSystem;
  eraSystem: EraSystem;
  incidentSystem: IncidentSystem;
  familySystem: FamilySystem;
  storySystem: StorySystem;
  supplySystem: SupplySystem;
  rushSystem: RushSystem;
  shopSystem: ShopSystem;
  projectSystem: ProjectSystem; // [LateGame B1]
  private tickCount = 0;

  private lastTickTime = 0;
  private tickAccumulator = 0;
  private lastSaveTime = 0;
  private running = false;
  private rafId = 0;
  private idleSeconds = 0;
  private lastRenderAt = 0;
  private lastInteraction = 0;
  /** Milliseconds the picture currently aims to take per frame (the performance monitor judges against it). */
  frameTargetMs = FRAME_ACTIVE_MS;

  offlineReport: OfflineReport | null = null;
  paused = false;
  onRender: ((dt: number, alpha: number) => void) | null = null;

  constructor() {
    this.stateManager = new StateManager();
    this.saveManager = new SaveManager();
    this.rng = new SeededRandom(this.stateManager.state.randomSeed);

    this.resourceSystem = new ResourceSystem();
    this.buildingSystem = new BuildingSystem();
    this.populationSystem = new PopulationSystem();
    this.eventSystem = new EventSystem(this.stateManager, this.rng, this.resourceSystem, this.populationSystem);
    this.researchSystem = new ResearchSystem(this.resourceSystem);
    this.explorationSystem = new ExplorationSystem(this.stateManager, this.rng, this.resourceSystem, this.populationSystem);
    this.eventSystem.setExploration(this.explorationSystem);
    this.metaSystem = new MetaSystem(this.stateManager, this.resourceSystem);
    this.objectiveSystem = new ObjectiveSystem(this.stateManager, this.resourceSystem);
    this.restorationSystem = new RestorationSystem(this.stateManager, this.rng, this.resourceSystem, this.buildingSystem);
    this.eraSystem = new EraSystem(this.stateManager);
    this.incidentSystem = new IncidentSystem(this.stateManager, this.rng, this.resourceSystem);
    // A lost raid leaves raiders inside: the event system starts the breach.
    this.eventSystem.setIncidents(this.incidentSystem);
    this.supplySystem = new SupplySystem(this.stateManager, this.resourceSystem);
    this.rushSystem = new RushSystem(this.stateManager, this.researchSystem);
    // [Economy A3] The big-projects system (Late-game agent) may feed on overflow; resolved lazily so build order doesn't matter.
    // [Economy A2] Credits shop; its project-boost item shows up once the Projects system offers boostStage().
    this.shopSystem = new ShopSystem(this.stateManager, this.resourceSystem, this.researchSystem, this.supplySystem);
    this.shopSystem.getProjects = () => (this as unknown as { projectSystem?: ProjectBooster }).projectSystem;
    this.resourceSystem.getAbsorber = () => (this as unknown as { projectSystem?: OverflowAbsorber }).projectSystem;
    this.familySystem = new FamilySystem(this.stateManager, this.rng, this.populationSystem);
    // [LateGame B1] Big projects: crew work and mastery tick online and in simulate(); overflow and the shop boost reach it through the lazy getters above.
    this.projectSystem = new ProjectSystem(this.stateManager, this.resourceSystem, this.populationSystem);
    this.storySystem = new StorySystem(this.stateManager, this.rng, this.resourceSystem, this.populationSystem);
    // [Danger] Deaths, mourning, maintenance and away danger. Registered before the family listener so the memorial still sees who was related.
    this.deathSystem = new DeathSystem(this.stateManager);
    this.maintenanceSystem = new MaintenanceSystem(this.stateManager, this.resourceSystem, this.buildingSystem);
    this.eventSystem.setDeath(this.deathSystem);
    this.incidentSystem.setDeath(this.deathSystem);
    this.incidentSystem.setBuildings(this.buildingSystem);
    this.awayDanger = new AwayDanger(this.stateManager, this.rng, this.eventSystem, this.incidentSystem, this.deathSystem);
    bus.on('survivor:died', (s: unknown) => this.deathSystem.onDeath(s as import('./GameState').SurvivorState));
    bus.on('survivor:died', (s: unknown) => this.familySystem.forget((s as { id: string }).id));
    // Digging deeper turns up more of the previous residents' story.
    bus.on('floor:dug', (floor: unknown) => {
      const lore = DIG_LORE[floor as number];
      if (lore) this.restorationSystem.addLore(lore);
    });
  }

  async init(): Promise<void> {
    const saved = await this.saveManager.load('auto');
    if (saved) {
      const oldVersion = saved.version ?? 1;
      const state = migrateState(saved);
      this.stateManager.loadState(state);
      this.rng.seed = state.randomSeed;
      this.buildingSystem.syncNextId(state);
      this.populationSystem.syncNextId(state);
      if (oldVersion < 3) this.buildingSystem.repackAll(this.stateManager);
      if (oldVersion < 4) this.stateManager.applyDelta({ path: 'tutorialStep', value: ObjectiveSystem.migrateStep(state.tutorialStep ?? 0) });
      this.buildingSystem.recalculateMaxPopulation(this.stateManager);
      this.explorationSystem.ensureMap();
      this.incidentSystem.sync(state);
      this.incidentSystem.prune();
      this.handleOfflineProgression();
      this.eraSystem.catchUp();
    } else {
      this.setupNewGame();
    }
    bus.emit('engine:ready');
  }

  private setupNewGame(): void {
    const up = this.stateManager.state.prestige.upgrades;
    // [Progression hook] Quick Start stock and Pre-dug levels (MetaSystem.applyStartBonuses).
    this.metaSystem.applyStartBonuses(this.stateManager);
    for (let i = 0; i < 3 + (up['veteranSurvivors'] ?? 0); i++) {
      this.populationSystem.addSurvivor(this.stateManager, this.populationSystem.createSurvivor(this.rng));
    }

    // The Remnant: one dry dormitory where the newcomers camp; the rest of Bunker 17 must be won back.
    this.stateManager.applyDelta({ path: 'ruins', value: seedRuins() });
    this.buildingSystem.placeBuilding('quarters', { x: 0, y: 0, floor: 0 }, this.stateManager);
    const done = this.stateManager.state.buildings.flatMap((b, i) => [
      { path: `buildings.${i}.isConstructing`, value: false },
      { path: `buildings.${i}.constructionProgress`, value: b.constructionTotal },
    ]);
    this.stateManager.applyDeltas(done);
    this.buildingSystem.recalculateMaxPopulation(this.stateManager);
    this.explorationSystem.ensureMap();
  }

  /** Replaces the current game with a brand-new one (player-confirmed in the menu). */
  async newGame(): Promise<void> {
    const fresh = createInitialState();
    this.stateManager.loadState(fresh);
    this.rng.seed = fresh.randomSeed;
    this.buildingSystem.syncNextId(fresh);
    this.populationSystem.syncNextId(fresh);
    this.setupNewGame();
    await this.autoSave();
  }

  async importState(raw: string): Promise<boolean> {
    const parsed = this.saveManager.importSave(raw);
    if (!parsed) return false;
    const oldVersion = parsed.version ?? 1;
    const state = migrateState(parsed);
    this.stateManager.loadState(state);
    this.rng.seed = state.randomSeed;
    this.buildingSystem.syncNextId(state);
    this.populationSystem.syncNextId(state);
    if (oldVersion < 3) this.buildingSystem.repackAll(this.stateManager);
    if (oldVersion < 4) this.stateManager.applyDelta({ path: 'tutorialStep', value: ObjectiveSystem.migrateStep(state.tutorialStep ?? 0) });
    this.buildingSystem.recalculateMaxPopulation(this.stateManager);
    this.explorationSystem.ensureMap();
    this.incidentSystem.sync(state);
    this.incidentSystem.prune();
    this.eraSystem.catchUp();
    await this.autoSave();
    return true;
  }

  exportState(): string {
    return this.saveManager.exportSave(this.stateManager.getSnapshot());
  }

  /** Project Genesis: start over, keeping isotope-7, prestige upgrades, achievements and the story. */
  async rebirth(): Promise<void> {
    const old = this.stateManager.state;
    if (!this.metaSystem.canRebirth(old)) return;
    const gain = this.metaSystem.rebirthGain(old);
    const fresh = createInitialState();
    fresh.prestige = {
      ...old.prestige,
      rebirthCount: old.prestige.rebirthCount + 1,
      totalIsotope7Earned: old.prestige.totalIsotope7Earned + gain,
    };
    fresh.resources.isotope7.amount = old.resources.isotope7.amount + gain;
    fresh.achievements = [...old.achievements];
    fresh.storyFlags = old.storyFlags.filter(f => f.startsWith('event:radio') || f === 'intro:done');
    // What was learned from the previous residents carries into the new timeline.
    fresh.lore = [...(old.lore ?? [])];
    fresh.settings = { ...old.settings };
    // The daily supply drop streak counts real days, not timelines.
    fresh.supplyDrop = { ...(old.supplyDrop ?? fresh.supplyDrop) };
    // [LateGame B4] the weekly challenge (and its cosmetics) runs on real weeks, not timelines.
    fresh.lateGame.weekly = { ...(old.lateGame?.weekly ?? fresh.lateGame.weekly), base: snapshot(fresh) };
    fresh.stats = { ...old.stats, totalPrestigeResets: old.stats.totalPrestigeResets + 1 };
    fresh.nextEventAt = fresh.stats.totalPlayTime + 120;
    fresh.nextArrivalAt = fresh.stats.totalPlayTime + 60;
    fresh.createdAt = Date.now();
    this.stateManager.loadState(fresh);
    this.rng.seed = fresh.randomSeed;
    this.buildingSystem.syncNextId(fresh);
    this.populationSystem.syncNextId(fresh);
    this.setupNewGame();
    await this.autoSave();
    bus.emit('rebirth', gain);
  }

  private handleOfflineProgression(): void {
    const state = this.stateManager.state;
    const now = Date.now();
    const offlineMs = now - state.timestamp;
    if (offlineMs < 60_000) return;

    const offlineSeconds = Math.min(offlineMs / 1000, OFFLINE_MAX_SECONDS);
    this.offlineReport = this.simulate(offlineSeconds, this.offlineEfficiency());
    this.stateManager.applyDelta({ path: 'timestamp', value: now });
    bus.emit('offline:processed', this.offlineReport);
  }

  /**
   * Runs the bunker forward while the player is away (also used by the balance simulator).
   * Besides production it counts what overflowed full storage, gathers newcomers at the door,
   * and notes the teams and research that finished, so the welcome-back screen has a story to tell.
   */
  simulate(seconds: number, efficiency: number): OfflineReport {
    const sm = this.stateManager;
    const before: Partial<Record<ResourceType, number>> = {};
    for (const [k, v] of Object.entries(sm.state.resources)) before[k as ResourceType] = v.amount;
    const arrivals = this.gatherAtDoor(seconds);

    let missions = 0;
    const research: string[] = [];
    const offMission = bus.on('mission:complete', () => { missions++; });
    const offResearch = bus.on('research:complete', (id: unknown) => { research.push(id as string); });
    const wastedRaw: Partial<Record<ResourceType, number>> = {};
    // [Economy A1] overflow is now converted/absorbed by ResourceSystem; count only this run's share.
    this.resourceSystem.overflowLog = {};
    const creditsBefore = this.resourceSystem.creditsMade;

    const stepSize = seconds > 300 ? OFFLINE_STEP_SECONDS : 1;
    let remaining = seconds;
    try {
      while (remaining > 0) {
        const step = Math.min(stepSize, remaining);
        const pre = WASTE_TRACKED.map(r => sm.state.resources[r].amount);
        this.resourceSystem.update(sm, step * efficiency);
        // Whatever the rooms made beyond the cap this step was thrown away.
        WASTE_TRACKED.forEach((r, i) => {
          const res = sm.state.resources[r];
          const lost = pre[i] + (res.productionRate - res.consumptionRate) * step * efficiency - res.amount;
          if (lost > 0.001 && res.amount >= res.cap - 0.001) wastedRaw[r] = (wastedRaw[r] ?? 0) + lost;
        });
        this.buildingSystem.update(sm, step);
        this.researchSystem.update(sm, step);
        this.explorationSystem.update(step);
        this.restorationSystem.update(step);
        this.familySystem.update(step);
        this.projectSystem.update(step); // [LateGame B1]
        // [Danger C3/C4] Rooms wear while away, and hunger hurts people but never below 15 health.
        this.maintenanceSystem.update(step * efficiency);
        this.populationSystem.update(sm, step, OFFLINE_HEALTH_FLOOR);
        remaining -= step;
      }
    } finally {
      offMission();
      offResearch();
    }

    const gained: Partial<Record<ResourceType, number>> = {};
    for (const [k, v] of Object.entries(sm.state.resources)) {
      if (k === 'credits') continue; // reported separately as converted overflow
      const diff = v.amount - (before[k as ResourceType] ?? 0);
      if (Math.abs(diff) >= 1) gained[k as ResourceType] = diff;
    }
    const wasted: Partial<Record<ResourceType, number>> = {};
    const converted: Partial<Record<ResourceType, number>> = {};
    const absorbed: Partial<Record<ResourceType, number>> = {};
    for (const [r, o] of Object.entries(this.resourceSystem.overflowLog) as [ResourceType, { converted: number; absorbed: number }][]) {
      if (o.converted >= 1) converted[r] = Math.round(o.converted);
      if (o.absorbed >= 1) absorbed[r] = Math.round(o.absorbed);
    }
    // Only what neither became credits nor fed a project is truly wasted (e.g. scrap, which has no rate).
    for (const [r, v] of Object.entries(wastedRaw) as [ResourceType, number][]) {
      const o = this.resourceSystem.overflowLog[r];
      const left = v - (o ? o.converted + o.absorbed : 0);
      if (left >= 1) wasted[r] = Math.round(left);
    }
    const credits = Math.round(this.resourceSystem.creditsMade - creditsBefore);
    // [Danger C4] The soft version of raids and disasters, with the 24-hour safety net.
    const danger = this.awayDanger.run(seconds);
    if (danger.raids + danger.disasters.length > 0) bus.emit('danger:away', danger);
    return { seconds, gained, wasted, converted, credits, absorbed, arrivals, missions, research, danger };
  }

  /**
   * The away clock (S6): while nobody is home, newcomers still find the door, at half the usual pace,
   * and wait there (at most 3, and never more than the free beds) for the player to let them in.
   */
  private gatherAtDoor(seconds: number): number {
    const sm = this.stateManager;
    const state = sm.state;
    if (state.survivors.length === 0 || !state.storyFlags.includes('intro:done')) return 0;
    const knocking = state.activeEvent?.data?.knock ? (state.activeEvent.id === 'group' ? 2 : 1) : 0;
    const waiting = [...(state.doorWaiting ?? [])];
    const room = () => Math.min(AWAY_DOOR_MAX, state.maxPopulation - state.survivors.length - knocking) - waiting.length;
    let clock = (state.awayDoorClock ?? 0) + seconds;
    let arrived = 0;
    while (room() > 0) {
      const gap = arrivalGap(state, this.rng.next()) * AWAY_ARRIVAL_SLOWDOWN;
      if (clock < gap) break;
      clock -= gap;
      waiting.push(this.populationSystem.createSurvivor(this.rng));
      arrived++;
    }
    // A full doorstep doesn't bank time for later.
    if (room() <= 0) clock = 0;
    sm.applyDelta({ path: 'awayDoorClock', value: clock });
    if (arrived > 0) sm.applyDelta({ path: 'doorWaiting', value: waiting });
    return arrived;
  }

  /** The player's answer to the people waiting at the door: let in as many as there are beds, or turn them away. */
  answerDoor(accept: boolean): number {
    const sm = this.stateManager;
    const waiting = sm.state.doorWaiting ?? [];
    let admitted = 0;
    if (accept) {
      for (const w of waiting) {
        if (sm.state.survivors.length >= sm.state.maxPopulation) break;
        // A fresh id: the waiting person's id may have been reused after a reload.
        this.populationSystem.addSurvivor(sm, { ...w, id: this.populationSystem.createSurvivor(this.rng).id });
        admitted++;
      }
    }
    sm.applyDelta({ path: 'doorWaiting', value: [] });
    this.requestSave();
    return admitted;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTickTime = performance.now();
    this.lastSaveTime = Date.now();
    this.lastInteraction = Date.now();
    this.loop(performance.now());

    window.addEventListener('pagehide', () => void this.autoSave());

    let hiddenAt = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        void this.autoSave();
        return;
      }
      const away = hiddenAt ? (Date.now() - hiddenAt) / 1000 : 0;
      hiddenAt = 0;
      if (away < 2) return;
      const report = this.simulate(Math.min(away, OFFLINE_MAX_SECONDS), away > 60 ? this.offlineEfficiency() : 1);
      this.lastTickTime = performance.now();
      this.tickAccumulator = 0;
      if (away > 60) bus.emit('offline:processed', report);
    });
  }

  stop(): void {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  /** Frames in a row whose picture threw; a long run means the renderer is wedged (lost GPU, broken scene). */
  private renderFails = 0;
  /** Called once when the picture has failed for a while: the app can rebuild the scene. Returns true if it tried. */
  onRenderStuck: ((fails: number) => void) | null = null;

  private loop = (timestamp: number): void => {
    if (!this.running) return;
    // One bad frame must never stop the game: whatever happens, the next frame is already booked.
    this.rafId = requestAnimationFrame(this.loop);

    const elapsed = Math.min(timestamp - this.lastTickTime, 1000);
    this.lastTickTime = timestamp;
    this.tickAccumulator += elapsed;

    this.idleSeconds = (Date.now() - this.lastInteraction) / 1000;

    // While a cinematic plays the world holds its breath: no ticks, no events.
    if (this.paused) this.tickAccumulator = 0;
    while (this.tickAccumulator >= TICK_INTERVAL) {
      this.tickAccumulator -= TICK_INTERVAL;
      this.tick();
    }

    const alpha = this.tickAccumulator / TICK_INTERVAL;
    // Picture rate governor: skip animation frames the player would not notice (see FRAME_* above).
    const target = this.pictureInterval();
    // A little slack so a 60 Hz screen draws every other frame for 30 fps instead of jittering around the limit.
    if (timestamp - this.lastRenderAt >= target - 4) {
      const since = this.lastRenderAt ? timestamp - this.lastRenderAt : elapsed;
      this.lastRenderAt = timestamp;
      this.frameTargetMs = target;
      try {
        this.onRender?.(Math.min(since, 1000), alpha);
        this.renderFails = 0;
      } catch (err) {
        logCrash('render', err);
        if (++this.renderFails % 120 === 0) this.onRenderStuck?.(this.renderFails);
      }
    }

    if (Date.now() - this.lastSaveTime > AUTO_SAVE_INTERVAL) {
      this.lastSaveTime = Date.now();
      this.autoSave().catch(err => logCrash('save', err));
    }
  };

  /** Runs one system step; a throwing system is logged and skipped so the others keep the bunker alive. */
  private step(name: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      logCrash(`system:${name}`, err);
    }
  }

  private tick(): void {
    const sm = this.stateManager;
    this.step('resource', () => this.resourceSystem.update(sm, TICK_SECONDS));
    this.step('building', () => this.buildingSystem.update(sm, TICK_SECONDS));
    this.step('population', () => this.populationSystem.update(sm, TICK_SECONDS));
    this.step('event', () => this.eventSystem.update());
    this.step('research', () => this.researchSystem.update(sm, TICK_SECONDS));
    this.step('exploration', () => this.explorationSystem.update(TICK_SECONDS));
    this.step('restoration', () => this.restorationSystem.update(TICK_SECONDS));
    this.step('incident', () => this.incidentSystem.update(TICK_SECONDS));
    this.step('family', () => this.familySystem.update(TICK_SECONDS));
    this.step('project', () => this.projectSystem.update(TICK_SECONDS)); // [LateGame B1]
    this.step('maintenance', () => this.maintenanceSystem.update(TICK_SECONDS)); // [Danger C3]
    if (++this.tickCount % 10 === 0) {
      this.step('achievements', () => this.metaSystem.checkAchievements());
      this.step('objective', () => this.objectiveSystem.update());
      this.step('era', () => this.eraSystem.update());
      this.step('story', () => this.storySystem.update());
    }

    this.step('clock', () => sm.applyDelta({
      path: 'stats.totalPlayTime',
      value: sm.state.stats.totalPlayTime + TICK_SECONDS,
    }));
  }

  private async autoSave(): Promise<void> {
    this.stateManager.applyDelta({ path: 'timestamp', value: Date.now() });
    this.stateManager.applyDelta({ path: 'randomSeed', value: this.rng.seed });
    await this.saveManager.save(this.stateManager.getSnapshot());
  }

  private offlineEfficiency(): number {
    return Math.min(1, OFFLINE_EFFICIENCY + 0.05 * (this.stateManager.state.prestige.upgrades['offlineEfficiency'] ?? 0));
  }

  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** Debounced save after a meaningful player action, so closing the app right after doesn't lose it. */
  requestSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.lastSaveTime = Date.now();
      void this.autoSave();
    }, 400);
  }

  notifyInteraction(): void {
    this.lastInteraction = Date.now();
    this.idleSeconds = 0;
  }

  get isIdle(): boolean {
    return this.idleSeconds > IDLE_AFTER_S;
  }

  /** Wanted time between pictures right now. */
  private pictureInterval(): number {
    const since = Date.now() - this.lastInteraction;
    if (since < ACTIVE_HOLD_MS) return FRAME_ACTIVE_MS;
    return this.isIdle ? FRAME_IDLE_MS : FRAME_CALM_MS;
  }

  async forceSave(): Promise<void> {
    await this.autoSave();
  }
}
