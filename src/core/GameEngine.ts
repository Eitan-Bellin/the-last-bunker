import { MUTATORS } from '../data/mutators';
import { LAWS, lawCost, lawSlots } from '../data/laws';
import { StateManager } from './StateManager';
import { SaveManager, type BackupKind } from './SaveManager';
import { stillOwner } from './singleInstance';
import { bus } from './EventBus';
import { SeededRandom } from './Random';
import { createInitialState, migrateState, type GameState, type ResourceType } from './GameState';
import { ResourceSystem, type OverflowAbsorber } from '../systems/ResourceSystem';
import { BuildingSystem } from '../systems/BuildingSystem';
import { PopulationSystem } from '../systems/PopulationSystem';
import { EventSystem, arrivalGap } from '../systems/EventSystem';
import { ResearchSystem } from '../systems/ResearchSystem';
import { ExplorationSystem } from '../systems/ExplorationSystem';
import { MetaSystem } from '../systems/MetaSystem';
import { ObjectiveSystem } from '../systems/ObjectiveSystem';
import { guideObjective } from '../systems/Guide';
import { ChronicleSystem } from '../systems/ChronicleSystem';
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
import { InboxSystem } from '../systems/InboxSystem';
import { DigSystem } from '../systems/DigSystem';
import { ActSystem } from '../systems/ActSystem';
import { ForemanSystem } from '../systems/ForemanSystem';
import { ThreatSystem } from '../systems/ThreatSystem';
import { ContractSystem } from '../systems/ContractSystem';
import { OutpostSystem } from '../systems/OutpostSystem';
import { difficultyOf, easier } from '../data/difficulty';
import type { Difficulty } from './state/longGame';
import { logCrash } from './crashGuard';
import { WASTE_TRACKED } from '../data/resources';

const TICK_RATE = 10;
const TICK_INTERVAL = 1000 / TICK_RATE;
const TICK_SECONDS = 1 / TICK_RATE;
const AUTO_SAVE_INTERVAL = 30_000;
/**
 * Picture rate governor (battery and heat). The graphics level sets three rates (`frameRates`): while the player is touching
 * the bunker (and a moment after), while they only watch, and once they stopped touching it for a while. High draws at full
 * speed throughout; medium and low save heat. Phones with 90/120 Hz screens used to draw 120 frames a second of a mostly
 * still scene. The simulation is not affected.
 */
const FRAME_ACTIVE_MS = 1000 / 60;
/** How long after the last touch the picture stays at full speed (camera glides and flicks need it). */
const ACTIVE_HOLD_MS = 1800;
const IDLE_AFTER_S = 30;
const OFFLINE_EFFICIENCY = 0.8;
/** Frames this far apart on the wall clock mean the device was asleep (not just slow). */
const SLEEP_GAP_MS = 20_000;
const OFFLINE_MAX_SECONDS = 86_400;
const OFFLINE_STEP_SECONDS = 60;
/** [P2] Seconds of play after a return during which hunger cannot kill (see graceUntil). */
const RETURN_GRACE = 600;

/** Most newcomers who gather at the door while the player is away. */
const AWAY_DOOR_MAX = 3;
/** Away from home, word travels slower: newcomers come at half the usual pace. */
const AWAY_ARRIVAL_SLOWDOWN = 2;
/** Resources whose overflow the welcome-back report counts (power is meant to be spent at once). */

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

/**
 * One system in the engine's step list. `online` runs while the game is open; `offline` runs while catching up on time away
 * (with the away efficiency); a system without `offline` deliberately does nothing away (its policy is "online only").
 * `slow` systems run about once a second of game time rather than on every tick.
 */
export interface EngineSystem {
  name: string;
  online?: (dt: number) => void;
  offline?: (dt: number, efficiency: number) => void;
  slow?: boolean;
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
  /** [Long game] The Decision Inbox's own cards. */
  inboxSystem: InboxSystem;
  /** [Long game] Timed digs with a crew, and the Acts. */
  digSystem: DigSystem;
  actSystem: ActSystem;
  foremanSystem: ForemanSystem;
  threatSystem: ThreatSystem;
  contractSystem: ContractSystem;
  outpostSystem: OutpostSystem;
  /** [Q14] The run's milestones. */
  chronicleSystem: ChronicleSystem;
  /** The step list, in order (see registerSystems). New systems add themselves with register(). */
  private systems: EngineSystem[] = [];
  /** Game seconds gathered toward the next run of the slow systems. */
  private slowClock = 0;
  /**
   * [P2] Play time until which hunger and thirst cannot take anyone below the away floor: coming back to an empty
   * larder gives the player time to fix it before anyone dies (no hostile returns).
   */
  private graceUntil = 0;
  /** Set by simulate() while catching up: what the rooms made beyond full storage, per resource. */
  private offlineWaste: Partial<Record<ResourceType, number>> | null = null;

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
  /** Pictures per second while touching / watching / idle; the app sets it from the graphics level every frame. */
  frameRates: [number, number, number] = [60, 30, 15];

  offlineReport: OfflineReport | null = null;
  paused = false;
  /** Nothing is written to storage while true: a save we could not read must never be overwritten, and a second open copy must not clobber this one. */
  saveBlocked = false;
  /** Why the main save could not be used at start ('error' = storage failed, 'corrupt' = unreadable); null = all fine. */
  loadProblem: 'error' | 'corrupt' | null = null;
  /** Set when the main save was unreadable and this game came from a backup. */
  recoveredFrom: BackupKind | null = null;
  /** When the game restored from a backup was last saved (wall-clock ms). */
  recoveredAt: number | null = null;
  private saveFailures = 0;
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
    this.objectiveSystem.guide = s => guideObjective(this, s); // [Q2]
    this.chronicleSystem = new ChronicleSystem(this.stateManager); // [Q14]
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
    this.inboxSystem = new InboxSystem(this.stateManager);
    this.digSystem = new DigSystem(this.stateManager, this.buildingSystem, this.populationSystem);
    this.actSystem = new ActSystem(this.stateManager, this.buildingSystem);
    this.threatSystem = new ThreatSystem(this.stateManager);
    this.outpostSystem = new OutpostSystem(this.stateManager, this.resourceSystem, this.explorationSystem);
    this.contractSystem = new ContractSystem(this.stateManager, this.inboxSystem, this.resourceSystem, this.populationSystem);
    this.foremanSystem = new ForemanSystem(this.stateManager, this.maintenanceSystem, this.projectSystem, this.populationSystem, this.digSystem, this.contractSystem, this.resourceSystem);
    this.awayDanger = new AwayDanger(this.stateManager, this.rng, this.eventSystem, this.incidentSystem, this.deathSystem);
    bus.on('survivor:died', (s: unknown) => this.deathSystem.onDeath(s as import('./GameState').SurvivorState));
    bus.on('survivor:died', (s: unknown) => this.familySystem.forget((s as { id: string }).id));
    // Digging deeper turns up more of the previous residents' story.
    bus.on('floor:dug', (floor: unknown) => {
      const lore = DIG_LORE[floor as number];
      if (lore) this.restorationSystem.addLore(lore);
    });
    this.registerSystems();
  }

  /** Adds a system to the end of the step list (or replaces the one with the same name, keeping its place). */
  register(sys: EngineSystem): void {
    const at = this.systems.findIndex(s => s.name === sys.name);
    if (at >= 0) this.systems[at] = sys;
    else this.systems.push(sys);
  }

  /** The step list's names, in order (the simulator records it). */
  systemNames(): string[] {
    return this.systems.map(s => `${s.name}${s.slow ? '(slow)' : ''}${s.offline ? '' : '(online only)'}`);
  }

  /**
   * The engine's step list. Order matters (production before consumption checks, events after population).
   * Away policy: anything that needs the player (events, story, objectives, eras, achievements, incidents) stays online only;
   * the welcome-back path handles the door, away danger and era catch-up itself.
   */
  private registerSystems(): void {
    const sm = this.stateManager;
    const sys: EngineSystem[] = [
      {
        name: 'resource',
        online: dt => this.resourceSystem.update(sm, dt),
        offline: (dt, eff) => {
          const waste = this.offlineWaste;
          const pre = waste ? WASTE_TRACKED.map(r => sm.state.resources[r].amount) : null;
          this.resourceSystem.update(sm, dt * eff);
          // Whatever the rooms made beyond the cap this step was thrown away.
          if (waste && pre) WASTE_TRACKED.forEach((r, i) => {
            const res = sm.state.resources[r];
            const lost = pre[i] + (res.productionRate - res.consumptionRate) * dt * eff - res.amount;
            if (lost > 0.001 && res.amount >= res.cap - 0.001) waste[r] = (waste[r] ?? 0) + lost;
          });
        },
      },
      { name: 'building', online: dt => this.buildingSystem.update(sm, dt), offline: dt => this.buildingSystem.update(sm, dt) },
      // [Danger C4] Away, hunger can hurt but never takes a resident below the difficulty's health floor.
      { name: 'population', online: dt => this.populationSystem.update(sm, dt, Math.max(difficultyOf(sm.state).onlineHealthFloor,
        sm.state.stats.totalPlayTime < this.graceUntil ? difficultyOf(sm.state).awayHealthFloor : 0)), offline: dt => this.populationSystem.update(sm, dt, difficultyOf(sm.state).awayHealthFloor) },
      { name: 'event', online: () => this.eventSystem.update() },
      { name: 'research', online: dt => this.researchSystem.update(sm, dt), offline: dt => this.researchSystem.update(sm, dt) },
      { name: 'exploration', online: dt => this.explorationSystem.update(dt), offline: dt => this.explorationSystem.update(dt) },
      { name: 'restoration', online: dt => this.restorationSystem.update(dt), offline: dt => this.restorationSystem.update(dt) },
      { name: 'incident', online: dt => this.incidentSystem.update(dt) },
      { name: 'family', online: dt => this.familySystem.update(dt), offline: dt => this.familySystem.update(dt) },
      { name: 'project', online: dt => this.projectSystem.update(dt), offline: dt => this.projectSystem.update(dt) }, // [LateGame B1]
      // [Danger C3] Rooms wear while away too (at the away efficiency).
      // [Long game] The dig crew works away too; Acts advance only while the game is open (the player sees it happen).
      { name: 'dig', online: dt => this.digSystem.update(dt), offline: dt => this.digSystem.update(dt) },
      { name: 'act', slow: true, online: () => this.actSystem.update() },
      // The Foreman's standing orders run away too (that is the point of them).
      // [P2] The threat meter, breathers and the turn of the seasons run on world time, online and away.
      { name: 'threat', online: dt => this.threatSystem.update(dt), offline: dt => this.threatSystem.update(dt) },
      // [P4] Contract offers and crews on jobs run on world time, online and away (offers lapse while nobody answers).
      { name: 'contracts', slow: true, online: () => this.contractSystem.update(), offline: () => this.contractSystem.update() },
      { name: 'outposts', online: dt => this.outpostSystem.update(dt), offline: (dt, eff) => this.outpostSystem.update(dt * eff) },
      { name: 'foreman', online: dt => this.foremanSystem.update(dt), offline: dt => this.foremanSystem.update(dt) },
      { name: 'maintenance', online: dt => this.maintenanceSystem.update(dt), offline: (dt, eff) => this.maintenanceSystem.update(dt * eff) },
      // Card deadlines run on world time, so a safe default can be taken while the player is away.
      { name: 'inbox', slow: true, online: () => this.inboxSystem.update(), offline: () => this.inboxSystem.update() },
      { name: 'achievements', slow: true, online: () => this.metaSystem.checkAchievements() },
      { name: 'objective', slow: true, online: () => this.objectiveSystem.update() },
      { name: 'era', slow: true, online: () => this.eraSystem.update() },
      { name: 'story', slow: true, online: () => this.storySystem.update() },
    ];
    for (const s of sys) this.register(s);
  }

  /**
   * Moves the world forward by `dt` game seconds: the one entry point for the open game (tick), time away (simulate)
   * and the balance simulator. Online it also advances the play clock. A throwing system is logged and skipped.
   */
  advance(dt: number, mode: 'online' | 'offline', efficiency = 1): void {
    let slowDue = false;
    if (mode === 'online') {
      this.slowClock += dt;
      // A hair under a second, so ten 0.1 s ticks (with float drift) still make one slow round.
      if (this.slowClock >= 0.999) {
        slowDue = true;
        this.slowClock = 0;
      }
    }
    for (const s of this.systems) {
      if (mode === 'online') {
        if (!s.online || (s.slow && !slowDue)) continue;
        const f = s.online;
        this.step(s.name, () => f(dt));
      } else if (s.offline) {
        const f = s.offline;
        this.step(s.name, () => f(dt, efficiency));
      }
    }
    const sm = this.stateManager;
    if (mode === 'online') this.step('clock', () => sm.applyDelta({ path: 'stats.totalPlayTime', value: sm.state.stats.totalPlayTime + dt }));
    // World time runs both online and away (seasons, contracts and the threat director live on it).
    const lg = sm.state.longGame;
    if (lg) sm.applyDelta({ path: 'longGame.meta.worldT', value: lg.meta.worldT + dt });
  }

  async init(): Promise<void> {
    const loaded = await this.saveManager.loadSafe();
    if (loaded.state) {
      this.recoveredFrom = loaded.recoveredFrom ?? null;
      this.recoveredAt = loaded.recoveredFrom ? (loaded.state.timestamp ?? null) : null;
      this.adoptState(loaded.state);
      this.handleOfflineProgression();
      this.eraSystem.catchUp();
    } else {
      // A storage error or an unreadable save is not "no save": show something to look at, but never write over what may still be there.
      if (loaded.status === 'error' || loaded.status === 'corrupt') {
        this.loadProblem = loaded.status;
        this.saveBlocked = true;
      }
      this.setupNewGame();
    }
    bus.emit('engine:ready');
  }

  private setupNewGame(): void {
    const up = this.stateManager.state.prestige.upgrades;
    // [Progression hook] Quick Start stock and Pre-dug levels (MetaSystem.applyStartBonuses).
    this.metaSystem.applyStartBonuses(this.stateManager);
    for (let i = 0; i < 3 + (up['veteranSurvivors'] ?? 0) + (up['ksFounders'] ? 2 : 0); i++) {
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
    await this.keepPrevious();
    const fresh = createInitialState();
    this.stateManager.loadState(fresh);
    this.rng.seed = fresh.randomSeed;
    this.buildingSystem.syncNextId(fresh);
    this.populationSystem.syncNextId(fresh);
    this.setupNewGame();
    await this.autoSave();
  }

  /** Makes a loaded save the running game (the same steps for the autosave, an import and a restored backup). */
  private adoptState(saved: GameState): void {
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
  }

  /** The game as it runs now, exactly as it would be saved. */
  private currentJson(): string {
    this.stateManager.applyDelta({ path: 'timestamp', value: Date.now() });
    this.stateManager.applyDelta({ path: 'randomSeed', value: this.rng.seed });
    return JSON.stringify(this.stateManager.state);
  }

  /** Keeps the current game as the "previous" backup before something replaces it (new game, import, Genesis, restore). */
  private async keepPrevious(): Promise<void> {
    if (this.saveBlocked) return;
    await this.saveManager.snapshotPrev(this.currentJson());
  }

  /** The player chose to carry on after a save problem (a new game, or playing without saving). */
  allowSaving(): void {
    this.loadProblem = null;
    this.saveBlocked = false;
  }

  async importState(raw: string): Promise<boolean> {
    const parsed = this.saveManager.importSave(raw);
    if (!parsed) return false;
    await this.keepPrevious();
    this.adoptState(parsed);
    this.eraSystem.catchUp();
    await this.autoSave();
    return true;
  }

  /** Puts a backup back as the running game. The game it replaces is kept as the "previous" backup. */
  async restoreBackup(kind: BackupKind): Promise<boolean> {
    const state = await this.saveManager.readBackup(kind);
    if (!state) return false;
    await this.keepPrevious();
    this.adoptState(state);
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
    await this.keepPrevious();
    const gain = this.metaSystem.rebirthGain(old);
    const fresh = createInitialState();
    fresh.prestige = {
      ...old.prestige,
      rebirthCount: old.prestige.rebirthCount + 1,
      totalIsotope7Earned: old.prestige.totalIsotope7Earned + gain,
      // Remember which chapters this timeline told (chapters finished before this field existed are in storyFlags).
      storySeen: [...new Set([...(old.prestige.storySeen ?? []), ...old.storyFlags.filter(f => f.startsWith('story:')).map(f => f.slice(6))])],
    };
    fresh.resources.isotope7.amount = old.resources.isotope7.amount + gain;
    fresh.achievements = [...old.achievements];
    // The "new system" cards (sys:*) were seen once: they are tips, not part of the timeline.
    fresh.storyFlags = old.storyFlags.filter(f => f.startsWith('event:radio') || f === 'intro:done' || f.startsWith('sys:'));
    // What was learned from the previous residents carries into the new timeline.
    fresh.lore = [...(old.lore ?? [])];
    fresh.settings = { ...old.settings };
    // The daily supply drop streak counts real days, not timelines.
    fresh.supplyDrop = { ...(old.supplyDrop ?? fresh.supplyDrop) };
    // [LateGame B4] the weekly challenge (and its cosmetics) runs on real weeks, not timelines.
    fresh.lateGame.weekly = { ...(old.lateGame?.weekly ?? fresh.lateGame.weekly), base: snapshot(fresh) };
    fresh.stats = { ...old.stats, totalPrestigeResets: old.stats.totalPrestigeResets + 1 };
    // Every clock below counts play-seconds, and the play clock carries over, so each is set relative to now (not to zero).
    fresh.nextEventAt = fresh.stats.totalPlayTime + 120;
    fresh.nextArrivalAt = fresh.stats.totalPlayTime + 60;
    fresh.nextIncidentAt = fresh.stats.totalPlayTime + 900;
    // Unspent rush charges are a gift from the daily crates: Genesis does not take them.
    fresh.rush = Math.max(old.rush ?? 0, fresh.rush);
    fresh.createdAt = Date.now();
    // [Long game] The world clock, difficulty and scenario carry into the next timeline; the Act starts over.
    if (old.longGame) {
      const m = old.longGame.meta;
      fresh.longGame.meta = { ...fresh.longGame.meta, difficulty: m.difficulty, diffLowest: m.difficulty, scenario: m.scenario, mutators: [...m.mutators], runIndex: m.runIndex + 1, worldT: m.worldT, actSince: m.worldT };
      // [Q14] The Chronicle outlives the timeline: the earlier runs stay in the book.
      fresh.longGame.chronicle = [...(old.longGame.chronicle ?? [])];
    }
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

    // Short absences are simulated finely, long ones coarsely: the cost grows with the number of steps (and with the crowd).
    const stepSize = seconds > 300 ? OFFLINE_STEP_SECONDS : seconds > 60 ? 5 : 1;
    let remaining = seconds;
    this.offlineWaste = wastedRaw;
    try {
      while (remaining > 0) {
        const step = Math.min(stepSize, remaining);
        this.advance(step, 'offline', efficiency);
        remaining -= step;
      }
    } finally {
      this.offlineWaste = null;
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
    // [P2] The player is back: the "danger ignored" streak ends (a day of neglect is a day away, not any day since).
    if (difficultyOf(sm.state).id !== 'last' && sm.state.danger.ignoredSince !== null) sm.applyDelta({ path: 'danger', value: { ...sm.state.danger, ignoredSince: null } });
    // A real absence (not a short tab switch): the return grace starts now.
    if (seconds > 300) this.graceUntil = sm.state.stats.totalPlayTime + RETURN_GRACE;
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

  /**
   * [Long game] Sets the difficulty. At the very start of a game it also adjusts the starting stock; the run remembers the
   * easiest difficulty it was ever played on.
   */
  setDifficulty(d: Difficulty): void {
    const sm = this.stateManager;
    const lg = sm.state.longGame;
    if (!lg) return;
    const fresh = sm.state.stats.totalPlayTime < 60 && !sm.state.storyFlags.includes('difficulty:chosen');
    sm.applyDeltas([
      { path: 'longGame.meta.difficulty', value: d },
      { path: 'longGame.meta.diffLowest', value: fresh ? d : easier(lg.meta.diffLowest, d) },
      { path: 'storyFlags', value: [...new Set([...sm.state.storyFlags, 'difficulty:chosen'])] },
    ]);
    if (fresh) {
      const extra = difficultyOf(sm.state).startStock;
      for (const r of ['food', 'water', 'materials'] as const) {
        const res = sm.state.resources[r];
        sm.applyDelta({ path: `resources.${r}.amount`, value: Math.min(res.cap, Math.max(0, Math.round(res.amount * (1 + extra)))) });
      }
    }
    this.requestSave();
  }

  /** [P5] The run's mutators (only while it has just begun). */
  setMutators(ids: string[]): void {
    const sm = this.stateManager;
    if (!sm.state.longGame || sm.state.longGame.meta.act > 1) return;
    sm.applyDelta({ path: 'longGame.meta.mutators', value: ids.filter(id => MUTATORS.some(m => m.id === id)) });
    this.requestSave();
  }

  /** [P3] Passes a law (if a slot is free and it can be paid). */
  enactLaw(id: string): boolean {
    const sm = this.stateManager;
    const lg = sm.state.longGame;
    if (!lg || lg.policy.laws.includes(id) || lg.policy.laws.length >= lawSlots(sm.state) || !LAWS.some(l => l.id === id)) return false;
    if (!this.resourceSystem.spend(sm, lawCost(sm.state))) return false;
    sm.applyDelta({ path: 'longGame.policy.laws', value: [...lg.policy.laws, id] });
    this.chronicleSystem.note('law', id);
    this.buildingSystem.recalculateMaxPopulation(sm);
    this.requestSave();
    return true;
  }

  repealLaw(id: string): void {
    const sm = this.stateManager;
    const lg = sm.state.longGame;
    if (!lg) return;
    sm.applyDelta({ path: 'longGame.policy.laws', value: lg.policy.laws.filter(x => x !== id) });
    this.requestSave();
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

    this.lastWall = Date.now();
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
      // The frame loop may already have noticed the gap (a frame can run before this event): do not count it twice.
      if (Date.now() - this.lastWall < away * 1000 - 2000) return;
      this.comeBack(away);
    });
  }

  /** Wall-clock time of the previous frame: a long gap while the page believes it is visible means the device slept (no visibility event). */
  private lastWall = 0;

  /** The player is back after `away` seconds: the bunker works through the gap, and the new "last seen" time is saved right away. */
  private comeBack(away: number): void {
    const report = this.simulate(Math.min(away, OFFLINE_MAX_SECONDS), away > 60 ? this.offlineEfficiency() : 1);
    this.lastTickTime = performance.now();
    this.tickAccumulator = 0;
    this.lastWall = Date.now();
    // Without this a game closed in the next half minute would count the same absence again on the next start.
    this.stateManager.applyDelta({ path: 'timestamp', value: Date.now() });
    this.requestSave();
    if (away > 60) bus.emit('offline:processed', report);
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

    // A laptop that slept or a phone that froze the page without telling it: the wall clock jumped, the frame clock did not.
    const wall = Date.now();
    const slept = this.lastWall > 0 && wall - this.lastWall > SLEEP_GAP_MS && !document.hidden;
    const sleptFor = (wall - this.lastWall) / 1000;
    this.lastWall = wall;
    if (slept) this.comeBack(sleptFor);

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
      void this.autoSave();
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
    this.advance(TICK_SECONDS, 'online');
  }

  /** Writes the game to storage. Never throws: a failed write is counted, logged, and reported to the player after the second miss. */
  private async autoSave(): Promise<void> {
    if (this.saveBlocked) return;
    // Another copy of the game started after this one: it owns the save now, and this one must not write over it.
    if (!stillOwner()) {
      this.saveBlocked = true;
      bus.emit('save:superseded');
      return;
    }
    try {
      await this.saveManager.saveJson(this.currentJson());
      if (this.saveFailures > 0) bus.emit('save:recovered');
      this.saveFailures = 0;
    } catch (err) {
      logCrash('save', err);
      this.saveFailures++;
      if (this.saveFailures === 2 || this.saveFailures % 20 === 0) bus.emit('save:failed', this.saveFailures);
    }
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
    const [active, calm, idle] = this.frameRates;
    return 1000 / (since < ACTIVE_HOLD_MS ? active : this.isIdle ? idle : calm);
  }

  async forceSave(): Promise<void> {
    await this.autoSave();
  }
}
