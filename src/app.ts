import { GameEngine, type OfflineReport } from './core/GameEngine';
import { ProjectsPanel } from './ui/components/ProjectsPanel'; // [LateGame B1]
import { doneProjects, getProject } from './data/projects'; // [LateGame B1]
import { getPartner } from './data/trade'; // [LateGame B2]
import { WEEKLY_CREDITS } from './data/challenges'; // [LateGame B4]
import { setSurfaceProjects } from './rendering/surface2'; // [LateGame B1]
import { BunkerRenderer } from './rendering/BunkerRenderer';
import { BRIGHTNESS_LEVELS } from './rendering/postfx';
import { clearLiteMode, crashReport, installCrashGuard, isLiteMode, logCrash } from './core/crashGuard';
import { HUD, type NavKey } from './ui/HUD';
import { BuildMenu } from './ui/components/BuildMenu';
import { BuildingPanel } from './ui/components/BuildingPanel';
import { PeoplePanel } from './ui/components/PeoplePanel';
import { ResearchPanel } from './ui/components/ResearchPanel';
import { SurfacePanel } from './ui/components/SurfacePanel';
import { MenuPanel } from './ui/components/MenuPanel';
import { Modal } from './ui/components/Modal';
import { Toasts } from './ui/components/Toast';
import { NumberPopupManager } from './ui/components/NumberPopup';
import { AudioEngine } from './audio/AudioEngine';
import { setUiSound } from './audio/uiSound';
import { timeOfDay } from './ui/HUD';
import { i18n } from './i18n/I18nManager';
import { bus } from './core/EventBus';
import { getDef } from './data/buildingDefs';
import { allowedFloors } from './data/zones';
import { getResearch, RESEARCH } from './data/research';
import { ACHIEVEMENTS } from './data/achievements';
import { BIOMES, POIS, type BiomeId } from './data/surface';
import { BUILDING_ICONS, RESOURCE_ICONS, costRow, el } from './ui/dom';
import { isBuildingUnlocked } from './systems/ResearchSystem';
import type { Objective } from './systems/ObjectiveSystem';
import type { BuildingType, GameState, MissionReport, Position, ResourceType, SurvivorState, SurvivorStats } from './core/GameState';
import { preloadIcons } from './rendering/richText';
import { ArtLibrary } from './art/ArtLibrary';
import { buildingArtKey, roomTier } from './art/registry';
import { districtDef, nextDistrict } from './data/districts';
import { isDistrict, roomFloors } from './data/buildingDefs';
import type { IconName } from './ui/icons';
import { RuinPanel } from './ui/components/RuinPanel';
import { JournalPanel, LoreReader } from './ui/components/JournalPanel';
import { EraPanel, showEraBanner } from './ui/components/EraPanel';
import { playIntro } from './ui/components/Intro';
import { ERAS, eraOf } from './data/eras';
import { getLore } from './data/lore';
import { portraitFor, portraitUrl } from './data/portraits';
import { RUIN_KINDS } from './data/ruins';
import type { RuinClearedInfo } from './systems/RestorationSystem';
import { StoryDialog } from './ui/components/StoryDialog';
import { biomeImage, journalTimeline } from './ui/expeditionText';
import { INCIDENTS, DISASTERS, disasterCost } from './data/incidents';
import { CEREMONY_COST } from './systems/DeathSystem'; // [Danger]
import { getChapter } from './data/story';
import { expeditionEvent } from './data/expeditionEvents';
import { specOf } from './data/specializations';
import type { IncidentResolved } from './systems/IncidentSystem';
import type { ChildBorn, CoupleFormed } from './systems/FamilySystem';
import type { ActiveMission, Incident } from './core/GameState';
import { Notifier, type NotifyItem } from './ui/notifications';
import { arrivalGap, bunkerDefense, raidTribute, type RaidResult } from './systems/EventSystem';
import './style.css';
import './styles/story.css';
import './styles/bunker-os.css';
import './styles/depth.css';

/** Icons drawn inside the Pixi scene (plaques, signs, popups); rasterized once at startup. */
const SCENE_ICONS: IconName[] = [
  'food', 'water', 'power', 'materials', 'medicine', 'knowledge', 'scrap', 'blueprints', 'isotope7',
  'star', 'check', 'close', 'pick', 'vault', 'quarters', 'farm', 'settings', 'heart', 'happy', 'sad', 'warning',
];

const PANEL_REFRESH_MS = 250;
const BUBBLE_CHECK_MS = 9000;
/** A bubble is worth two minutes of the room's output (NICE1), so a tap still matters after the first hour. */
const BUBBLE_SECONDS = 120;
/** Now and then a bubble holds a surprise instead: salvage or a bit of know-how (share of that store's cap). */
const BUBBLE_SURPRISE_CHANCE = 0.15;
const BUBBLE_SURPRISE_SHARE = 0.04;
const PRODUCTION_POPUP_MS = 4000;
const MAX_PRODUCTION_POPUPS = 8;

const EVENT_ICONS: Record<string, string> = {
  wanderer: '[[door]]',
  group: '[[people]]',
  stash: '[[storage]]',
  refugees: '[[people]]',
  pipeLeak: '[[waterPurifier]]',
  argument: '[[chat]]',
  trader: '[[cart]]',
  powerSurge: '[[power]]',
  sickness: '[[thermometer]]',
  radioSignal: '[[radioTower]]',
  radioSignal2: '[[dish]]',
  radioSignal3: '[[map]]',
  raiders: '[[skull]]',
};

const RESOURCE_COLORS: Partial<Record<ResourceType, number>> = {
  food: 0x7dff6a, water: 0x6ab8ff, power: 0xffdd44, materials: 0xff9a5a, medicine: 0xff7a9a, knowledge: 0xb48cff,
};

export class GameApp {
  private engine: GameEngine;
  private renderer: BunkerRenderer;
  private hud: HUD;
  private buildMenu: BuildMenu;
  private buildingPanel: BuildingPanel;
  private peoplePanel: PeoplePanel;
  private researchPanel: ResearchPanel;
  private surfacePanel: SurfacePanel;
  private menuPanel: MenuPanel;
  private modal: Modal;
  private toasts: Toasts;
  private audio: AudioEngine;
  private popups!: NumberPopupManager;
  private ruinPanel: RuinPanel;
  private journal = new JournalPanel();
  private loreReader = new LoreReader();
  private eraPanel = new EraPanel();
  private projectsPanel: ProjectsPanel; // [LateGame B1]
  private projectMarks = ''; // [LateGame B1] surface markers already drawn
  private introPlaying = false;
  private gradedEra = -1;
  /** Finds wait their turn so two discoveries never fight over the same dialog. */
  private loreQueue: string[] = [];
  private storyOpen = false;
  private storyDialog = new StoryDialog();
  private pendingChapter: string | null = null;
  private lastIncidentAlarm = 0;
  /** [Danger] a fresh warning opens its decision window once; a raid result waits for a free moment. */
  private dangerPrompt = false;
  private raidResult: RaidResult | null = null;
  private notifier = new Notifier();

  private placementMode: BuildingType | null = null;
  private lastPanelRefresh = 0;
  private lastProductionPopup = 0;
  private lastBubbleCheck = 0;
  private welcomeOpen = false;
  private shortages = new Set<ResourceType>();
  private lowWarned = new Set<ResourceType>();
  private hurtWarned = new Set<string>();
  private powerOk = true;
  private ruinBuckets = new Map<string, number>();

  constructor() {
    i18n.loadStoredLocale('he');
    document.body.appendChild(el('div', 'vignette'));
    this.engine = new GameEngine();
    this.renderer = new BunkerRenderer();
    this.hud = new HUD();
    this.audio = new AudioEngine();
    setUiSound((name, volume) => this.audio.play(name, { volume }));
    this.buildMenu = new BuildMenu(this.engine.resourceSystem, this.engine.buildingSystem);
    this.buildingPanel = new BuildingPanel(this.engine);
    this.peoplePanel = new PeoplePanel(this.engine);
    this.researchPanel = new ResearchPanel(this.engine);
    this.surfacePanel = new SurfacePanel(this.engine);
    this.projectsPanel = new ProjectsPanel(this.engine); // [LateGame B1]
    this.menuPanel = new MenuPanel(this.engine, {
      toggleLanguage: () => void this.toggleLanguage(),
      toggleSound: () => this.audio.toggle(),
      isSoundOn: () => this.audio.isOn,
      newGame: () => this.confirmNewGame(),
      rebirth: () => this.confirmRebirth(),
      importSave: (raw) => void this.importSave(raw),
      graphics: () => {
        const fx = this.renderer.postfx;
        const forced = fx?.forcedQuality ?? null;
        return i18n.t(`settings.gfx.${forced ?? 'auto'}`) + (forced ? '' : ` (${i18n.t(`settings.gfx.${fx?.quality ?? 'high'}`)})`);
      },
      cycleGraphics: () => {
        const order = [null, 'high', 'medium', 'low'] as const;
        const cur = this.renderer.postfx?.forcedQuality ?? null;
        const next = order[(order.indexOf(cur) + 1) % order.length];
        this.renderer.postfx?.setQuality(next);
        clearLiteMode(); // a hand-picked level ends the automatic lite mode
      },
      copyDiagnostics: () => this.copyDiagnostics(),
      brightness: () => i18n.t(`settings.bright.${this.renderer.postfx?.brightness ?? 'bright'}`),
      cycleBrightness: () => {
        const fx = this.renderer.postfx;
        if (fx) fx.setBrightness(BRIGHTNESS_LEVELS[(BRIGHTNESS_LEVELS.indexOf(fx.brightness) + 1) % BRIGHTNESS_LEVELS.length]);
      },
      notifications: () => {
        const perm = this.notifier.permission;
        if (perm === 'unsupported') return i18n.t('settings.notifyUnsupported');
        if (perm === 'denied') return i18n.t('settings.notifyBlocked');
        return i18n.t(this.notifier.isOn(this.state.settings.notificationsEnabled) ? 'settings.on' : 'settings.off');
      },
      toggleNotifications: () => this.toggleNotifications(),
    });
    this.ruinPanel = new RuinPanel(this.engine);
    this.modal = new Modal();
    this.toasts = new Toasts();
  }

  async start(): Promise<void> {
    const guard = installCrashGuard(() => this.diagnostics());
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    await Promise.all([this.renderer.init(canvas), preloadIcons(SCENE_ICONS).catch(() => undefined)]);
    await this.engine.init();
    // Decode the paintings of the rooms already built so the first frame shows art, not placeholders.
    const keys = this.state.buildings.map(b => buildingArtKey(b.type, roomTier(b.level))).filter((k): k is string => !!k);
    await Promise.all([ArtLibrary.preload([...new Set([...keys, 'backdrops/rock'])]), ArtLibrary.loadMeta(), ArtLibrary.loadBalance()]).catch(() => undefined);

    this.popups = new NumberPopupManager(this.renderer.worldContainer);
    this.setupEventHandlers();

    this.engine.onRender = (dt, alpha) => this.frame(dt, alpha);

    (window as unknown as Record<string, unknown>).__engine = this.engine;
    (window as unknown as Record<string, unknown>).__renderer = this.renderer;
    (window as unknown as Record<string, unknown>).__audio = this.audio;
    if (import.meta.env.DEV) void import('./dev/storeShots').then(m => m.installStoreShots(this.renderer.app));
    if (import.meta.env.DEV) void import('./dev/camShots').then(m => m.installCamShots(this.renderer, () => this.state));

    this.engine.onRenderStuck = fails => this.recoverRender(fails);
    this.engine.start();
    if (guard.liteJustEnabled) this.toasts.show(`[[sparkle]] ${i18n.t('toast.liteMode')}`, 'info');
    if (!this.state.storyFlags.includes('intro:done')) this.playIntroSequence();
    // Back from a break, or people still waiting at the door from last time: the welcome screen comes first.
    else if (this.engine.offlineReport || (this.state.doorWaiting?.length ?? 0) > 0) this.showWelcome(this.engine.offlineReport);
    this.setupNotifications();
  }

  /** While the game is in the background, schedule a few notices for what will happen meanwhile (S6). */
  private setupNotifications(): void {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.notifier.cancel();
        return;
      }
      if (this.notifier.isOn(this.state.settings.notificationsEnabled)) {
        this.engine.incidentSystem.spawnOnLeave(); // [Danger C4] now and then trouble starts just as you leave: the phone warns you
        this.notifier.plan(this.notifyPlan());
      }
    });
  }

  /** When each notable thing is expected while away, worded for a notification. */
  private notifyPlan(): NotifyItem[] {
    const state = this.state;
    const items: NotifyItem[] = [];
    const ret = this.engine.explorationSystem.nextReturnIn(state);
    if (ret !== null) items.push({ kind: 'expedition', inSeconds: ret, title: i18n.t('notify.expedition.title'), body: i18n.t('notify.expedition.body') });
    const rs = this.engine.researchSystem;
    const active = rs.activeId(state);
    const node = active ? state.research[active] : undefined;
    if (node && active) {
      const def = rs.defOf(state, active);
      items.push({
        kind: 'research', inSeconds: (node.total - node.progress) / Math.max(0.01, rs.speed(state)),
        title: i18n.t('notify.research.title'), body: i18n.t('notify.research.body', { name: def?.name[i18n.currentLocale] ?? '' }),
      });
    }
    // Offline production runs at about 80%: the first store to fill up.
    let full: { r: ResourceType; t: number } | null = null;
    for (const r of ['materials', 'food', 'water', 'knowledge'] as ResourceType[]) {
      const res = state.resources[r];
      const net = (res.productionRate - res.consumptionRate) * 0.8;
      if (net <= 0 || res.amount >= res.cap * 0.98) continue;
      const t = (res.cap - res.amount) / net;
      if (!full || t < full.t) full = { r, t };
    }
    if (full) items.push({ kind: 'storage', inSeconds: full.t, title: i18n.t('notify.storage.title'), body: i18n.t('notify.storage.body', { res: i18n.t(`resources.${full.r}`) }) });
    const free = Math.min(3, state.maxPopulation - state.survivors.length) - (state.doorWaiting?.length ?? 0);
    if (free > 0 && state.survivors.length > 0) {
      items.push({ kind: 'door', inSeconds: arrivalGap(state) * 2 - (state.awayDoorClock ?? 0), title: i18n.t('notify.door.title'), body: i18n.t('notify.door.body') });
    }
    // [Danger C4] a raid or disaster already on the clock: the warning reaches the phone while the countdown runs.
    const dng = state.danger;
    const now = state.stats.totalPlayTime;
    if (dng?.raid) items.push({ kind: 'danger', inSeconds: Math.max(0, dng.raid.hitAt - now) * 0.6 + 20, title: i18n.t('notify.raid.title'), body: i18n.t('notify.raid.body') });
    for (const dz of dng?.disasters ?? []) {
      const def = DISASTERS[dz.kind];
      items.push({ kind: 'danger', inSeconds: Math.max(0, dz.deadline - now) * 0.5 + 20, title: i18n.t('notify.disaster.title', { name: def.name[i18n.currentLocale] }), body: i18n.t('notify.disaster.body') });
    }
    return items;
  }

  private async toggleNotifications(): Promise<void> {
    const sm = this.engine.stateManager;
    if (this.notifier.isOn(this.state.settings.notificationsEnabled)) {
      sm.applyDelta({ path: 'settings.notificationsEnabled', value: false });
      this.engine.requestSave();
      return;
    }
    const perm = this.notifier.permission;
    if (perm === 'unsupported' || perm === 'denied') {
      this.toasts.show(`[[bell]] ${i18n.t(perm === 'denied' ? 'settings.notifyBlockedHint' : 'settings.notifyUnsupported')}`, 'bad');
      return;
    }
    const ok = perm === 'granted' || await this.notifier.request();
    sm.applyDelta({ path: 'settings.notificationsEnabled', value: ok });
    this.engine.requestSave();
    this.toasts.show(`[[bell]] ${i18n.t(ok ? 'settings.notifyOn' : 'settings.notifyBlockedHint')}`, ok ? 'good' : 'bad');
  }

  private get state() {
    return this.engine.stateManager.state;
  }

  /** Memory and GPU numbers saved with every crash record and heartbeat. */
  private diagnostics(): Record<string, unknown> {
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const s = this.engine?.stateManager?.state;
    return {
      uptimeMin: Math.round(performance.now() / 60000),
      heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
      ...this.renderer.gpuStats(),
      quality: this.renderer.postfx?.quality ?? null,
      bright: this.renderer.postfx?.brightness ?? null,
      lite: isLiteMode(),
      audio: this.audio.debugState,
      era: s?.era ?? null,
      rooms: s?.buildings.length ?? null,
      people: s?.survivors.length ?? null,
    };
  }

  private copyDiagnostics(): void {
    const text = crashReport();
    const done = () => this.toasts.show(`[[save]] ${i18n.t('toast.diagnosticsCopied')}`, 'good');
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => window.prompt('Diagnostics', text));
    else window.prompt('Diagnostics', text);
  }

  /** The picture keeps failing: rebuild the scene first; if it still fails, save and reload (at most twice in 5 minutes). */
  private recoverRender(fails: number): void {
    if (fails <= 240) {
      this.renderer.recoverGraphics();
      return;
    }
    let stamps: number[] = [];
    try { stamps = JSON.parse(sessionStorage.getItem('lastbunker_reloads') ?? '[]') as number[]; } catch { stamps = []; }
    stamps = stamps.filter(x => Date.now() - x < 300_000);
    if (stamps.length >= 2) return;
    stamps.push(Date.now());
    try { sessionStorage.setItem('lastbunker_reloads', JSON.stringify(stamps)); } catch { /* still reload */ }
    logCrash('auto-reload', 'render kept failing');
    void this.engine.forceSave().finally(() => location.reload());
  }

  private frame(dt: number, alpha: number): void {
    const state = this.state;
    // Each part is guarded on its own: a throwing panel must not stop the picture or the dialogs behind it.
    this.renderer.frameTarget = this.engine.frameTargetMs;
    try { this.renderer.render(state, dt, alpha); } catch (err) { logCrash('render', err); throw err; }
    this.guarded('hud', () => { this.hud.update(state); this.popups.update(); });
    this.guarded('ui', () => this.frameUi(state));
  }

  private guarded(name: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      logCrash(`ui:${name}`, err);
    }
  }

  private frameUi(state: GameState): void {
    const now = performance.now();
    if (now - this.lastPanelRefresh > PANEL_REFRESH_MS) {
      this.lastPanelRefresh = now;
      if (this.buildMenu.isVisible) this.buildMenu.refresh(state);
      if (this.buildingPanel.isVisible) this.buildingPanel.refresh(state);
      if (this.peoplePanel.isVisible) this.peoplePanel.refresh(state);
      if (this.researchPanel.isVisible) this.researchPanel.refresh(state);
      if (this.surfacePanel.isVisible) this.surfacePanel.refresh(state);
      if (this.menuPanel.isVisible) this.menuPanel.refresh(state);
      if (this.ruinPanel.isVisible) this.ruinPanel.refresh(state);
      if (this.journal.isVisible) this.journal.refresh(state);
      if (this.eraPanel.isVisible) this.eraPanel.refresh(state);
      if (this.projectsPanel.isVisible) this.projectsPanel.refresh(state); // [LateGame B1]
      const marks = doneProjects(state).join(',');
      if (marks !== this.projectMarks) { this.projectMarks = marks; setSurfaceProjects(marks ? marks.split(',') : []); } // [LateGame B1] surface markers
      this.updateBadges();
    }
    if (now - this.lastProductionPopup > PRODUCTION_POPUP_MS) {
      this.lastProductionPopup = now;
      this.spawnProductionPopups();
    }
    if (now - this.lastBubbleCheck > BUBBLE_CHECK_MS) {
      this.lastBubbleCheck = now;
      this.spawnBubbles();
    }
    this.renderer.setNight(timeOfDay(state.stats.totalPlayTime).night);
    if (!this.modal.isVisible && !this.welcomeOpen && !this.introPlaying && !this.storyOpen && !this.loreReader.isVisible && !this.storyDialog.isVisible) {
      const asking = this.engine.explorationSystem.waitingMission();
      // People who gathered at the door during a short absence get their answer first, too.
      if ((state.doorWaiting?.length ?? 0) > 0) this.showWelcome(null);
      else if ((state.danger?.memorialQueue?.length ?? 0) > 0) this.showMemorial(); // [Danger C5]
      else if (this.raidResult) { const r = this.raidResult; this.raidResult = null; this.showRaidResult(r); } // [Danger C1]
      else if (this.dangerPrompt) { this.dangerPrompt = false; if (this.dangerBanner()) this.showDanger(); } // [Danger C1/C2]
      else if (state.activeEvent) this.showEvent();
      else if (asking) this.showMissionChoice(asking);
      else if (state.missionReports.length > 0) this.showMissionReport(state.missionReports[0]);
      else if (this.pendingChapter && !document.querySelector('.era-banner')) this.playChapter(this.pendingChapter);
    }
    this.checkShortages();
    this.flushLoreQueue();
  }

  private updateBadges(): void {
    const state = this.state;
    const rs = this.engine.researchSystem;
    const canResearch = !rs.activeId(state) && RESEARCH.some(r => rs.canStart(state, r.id));
    this.hud.setBadge('research', canResearch ? '!' : null);
    const missions = state.activeMissions.length;
    this.hud.setBadge('surface', missions > 0 ? String(missions) : null);

    this.updateDigSign();
    this.updateAudio();
    const era = eraOf(state);
    this.hud.setEra(era.key, era.name[i18n.currentLocale]);
    if (document.body.dataset.era !== era.key) document.body.dataset.era = era.key;
    if (era.id !== this.gradedEra) {
      this.renderer.setEra(era, this.gradedEra < 0);
      this.gradedEra = era.id;
    }
    this.hud.setJournalUnread(state.loreUnread?.length ?? 0);
    this.hud.setSupply(this.engine.supplySystem.isReady(state), i18n.t('supply.title'));
    this.updateIncidentBanner();
    // One-time tip once the player has done their first restoration.
    if (!this.introPlaying && (state.ruinsCleared ?? 0) >= 1 && !state.storyFlags.includes('tip:drag') && !this.modal.isVisible) {
      this.engine.stateManager.applyDelta({ path: 'storyFlags', value: [...state.storyFlags, 'tip:drag'] });
      this.toasts.show(`[[hand]] ${i18n.t('tip.drag')}`, 'info');
    }
    const obj = this.engine.objectiveSystem.current(state);
    const reward = (Object.entries(obj.reward) as [ResourceType, number][]).map(([r, v]) => `${RESOURCE_ICONS[r] ?? ''}${v}`).join(' ');
    this.hud.setObjective(obj.icon, obj.text[i18n.currentLocale] ?? obj.text.en, obj.progress(state), reward);
  }

  private updateAudio(): void {
    const state = this.state;
    // Thunder rolls over the dead city now and then in the first eras.
    if ((state.era ?? 0) <= 1 && Math.random() < 1 / 900) this.audio.play('thunder', { volume: 0.35 });
    const night = timeOfDay(state.stats.totalPlayTime).night > 0.6;
    const crisis = state.activeEvent?.id === 'raiders' || (state.powerRatio ?? 1) < 0.6 || (state.incidents?.length ?? 0) > 0;
    this.audio.setMood(night || crisis ? 'dark' : 'shelter');
    this.audio.setEra(state.era ?? 0);
    this.audio.setExpedition(state.activeMissions.length > 0);
    this.audio.setAmbience(this.renderer.getAmbienceMix(state));
  }

  private updateDigSign(): void {
    const state = this.state;
    const bs = this.engine.buildingSystem;
    const cost = bs.digCost(state);
    // [Economy] M2: when the price is bigger than storage can hold, the sign says so instead of showing an unreachable cost.
    const over = bs.digOverCap(state);
    const costText = over
      ? `[[storage]] ${i18n.t('dig.needStorage', { cap: over.cap, cost: over.cost })}`
      : (Object.entries(cost) as [ResourceType, number][]).map(([r, v]) => `${RESOURCE_ICONS[r] ?? ''} ${v}`).join('   ');
    this.renderer.setDigSign(bs.canDig(state), i18n.t('dig.title', { n: state.currentFloors + 1 }), costText);
    const next = nextDistrict(state);
    this.renderer.setDistrictSign(next ? {
      floor: next.floor,
      text: i18n.t('district.dig', { name: next.name[i18n.currentLocale] }),
      cost: (Object.entries(next.cost) as [ResourceType, number][]).map(([r, v]) => `${RESOURCE_ICONS[r] ?? ''} ${v}`).join('   '),
    } : null);
  }

  /** Tunnel sideways into the next natural cavern. */
  private confirmDistrictDig(): void {
    const state = this.state;
    const next = nextDistrict(state);
    if (!next) return;
    const affordable = this.engine.resourceSystem.canAfford(state, next.cost as Record<string, number>);
    this.modal.show({
      icon: '[[pick]]',
      title: i18n.t('district.title'),
      body: i18n.t('district.body', { floor: next.floor + 1 }),
      actions: [
        {
          label: i18n.t('district.yes'),
          className: 'btn-primary',
          disabled: !affordable,
          detail: costRow(state, next.cost as Record<string, number>),
          onClick: () => {
            this.modal.hide();
            if (!this.engine.resourceSystem.spend(this.engine.stateManager, next.cost as Record<string, number>)) return;
            const b = this.engine.buildingSystem.digDistrict(this.engine.stateManager, next.kind);
            this.engine.requestSave();
            this.audio.play('drill');
            if (b) {
              const c = this.renderer.roomCenter(b);
              this.renderer.focusOn(c.x, c.y + 26, 1.3);
            }
          },
        },
        { label: i18n.t('placement.cancel'), className: 'btn-secondary', onClick: () => this.modal.hide() },
      ],
    });
  }

  /** The tunnel broke through: reveal the cavern with its painting. */
  private showDistrictFound(kind: string): void {
    const d = districtDef(kind);
    if (!d) return;
    const locale = i18n.currentLocale;
    const body = el('div', 'modal-result');
    const img = el('img', 'biome-art');
    img.src = `${import.meta.env.BASE_URL}art/districts/${kind}.webp`;
    img.alt = '';
    body.append(img, el('p', 'modal-body', d.find[locale]));
    this.audio.play('era');
    this.modal.show({
      icon: `[[${d.icon}]]`,
      title: i18n.t('district.found', { name: d.name[locale] }),
      body,
      actions: [{ label: i18n.t('event.ok'), onClick: () => this.modal.hide() }],
    });
  }

  private confirmDig(): void {
    const state = this.state;
    const bs = this.engine.buildingSystem;
    if (!bs.canDig(state)) return;
    const cost = bs.digCost(state);
    const affordable = this.engine.resourceSystem.canAfford(state, cost);
    // [Economy] M2: explain a dig that storage is too small for.
    const over = bs.digOverCap(state);
    let body: string | HTMLElement = i18n.t('dig.body');
    if (over) {
      body = el('div', 'modal-result');
      body.append(el('p', 'modal-body', i18n.t('dig.body')),
        el('p', 'modal-body negative-text', i18n.t('dig.needStorageBody', { cap: over.cap, cost: over.cost, res: i18n.t(`resources.${over.resource}`) })));
    }
    this.modal.show({
      icon: '[[pick]]',
      title: i18n.t('dig.title', { n: state.currentFloors + 1 }),
      body,
      actions: [
        {
          label: i18n.t('dig.yes'),
          className: 'btn-primary',
          disabled: !affordable,
          detail: costRow(state, cost),
          onClick: () => {
            this.modal.hide();
            if (!this.engine.resourceSystem.spend(this.engine.stateManager, cost)) return;
            bs.dig(this.engine.stateManager);
            this.engine.requestSave();
            this.audio.play('drill');
            setTimeout(() => this.audio.play('dig'), 700);
            this.renderer.shake(3, 2.2);
          },
        },
        { label: i18n.t('placement.cancel'), className: 'btn-secondary', onClick: () => this.modal.hide() },
      ],
    });
  }

  private onObjectiveTap(): void {
    const state = this.state;
    const action = this.engine.objectiveSystem.current(state).action;
    this.audio.play('click');
    this.closeSheets();
    if (!action) return;
    if (action.kind === 'build') {
      const cost = this.engine.buildingSystem.getBuildCost(action.type, state);
      if (isBuildingUnlocked(state, action.type) && this.engine.resourceSystem.canAfford(state, cost)) this.startPlacement(action.type);
      else this.buildMenu.show(state);
    } else if (action.kind === 'ruin') {
      const target = state.ruins.find(r => (action.restoresTo && r.restoresTo === action.restoresTo)
        || (action.ruinKind && r.kind === action.ruinKind && !this.engine.restorationSystem.blockReason(state, r))
        || (action.lore && r.lore === action.lore))
        ?? (action.ruinKind ? state.ruins.find(r => r.kind === action.ruinKind) : undefined);
      if (target) this.openRuin(target.id, true);
      else if (action.restoresTo) this.buildMenu.show(state);
    } else if (action.kind === 'journal') this.journal.show(state);
    else if (action.kind === 'people') this.peoplePanel.show();
    else if (action.kind === 'research') this.researchPanel.show();
    else this.surfacePanel.show();
  }

  private openRuin(ruinId: string, focus = false): void {
    const r = this.state.ruins.find(x => x.id === ruinId);
    if (!r) return;
    this.closeSheets();
    if (focus) {
      const c = this.renderer.ruinCenter(r);
      this.renderer.focusOn(c.x, c.y, 1.4);
    }
    this.ruinPanel.show(ruinId);
  }

  private startRuin(ruinId: string): void {
    const rs = this.engine.restorationSystem;
    const state = this.state;
    const r = state.ruins.find(x => x.id === ruinId);
    if (!r) return;
    if (!rs.canStart(state, r)) {
      this.audio.play('error');
      this.toasts.show(rs.blockReason(state, r) ? i18n.t('ruin.needsPump') : i18n.t('toast.notEnough'), 'bad');
      return;
    }
    const idle = rs.pickIdle(state, 2).length;
    rs.start(ruinId);
    this.engine.requestSave();
    this.audio.play('debris');
    this.toasts.show(idle > 0 ? `[[broom]] ${i18n.t('ruin.started')}` : `[[warning]] ${i18n.t('ruin.startedNoCrew')}`, idle > 0 ? 'good' : 'info');
    this.ruinPanel.refresh(this.state);
  }

  private queueLore(id: string): void {
    if (!this.loreQueue.includes(id)) this.loreQueue.push(id);
  }

  /** Shows the next queued find once nothing else is on screen. */
  private flushLoreQueue(): void {
    if (!this.loreQueue.length || this.modal.isVisible || this.storyOpen || this.introPlaying || this.loreReader.isVisible) return;
    if (document.querySelector('.era-banner')) return;
    this.showLoreFound(this.loreQueue.shift()!);
  }

  /** "You found something": offers to read a newly found note, log or tape. */
  private showLoreFound(id: string): void {
    const entry = getLore(id);
    if (!entry) return;
    this.audio.play('lore');
    const locale = i18n.currentLocale;
    this.storyOpen = true;
    this.modal.show({
      icon: entry.kind === 'tape' ? '[[tape]]' : entry.kind === 'photo' ? '[[eye]]' : '[[note]]',
      title: i18n.t('journal.found'),
      body: `${entry.title[locale]} · ${entry.author[locale]}`,
      actions: [
        { label: i18n.t('journal.readNow'), className: 'btn-primary', onClick: () => { this.modal.hide(); this.readLore(id); } },
        { label: i18n.t('journal.later'), className: 'btn-secondary', onClick: () => { this.modal.hide(); this.storyOpen = false; } },
      ],
    });
  }

  private readLore(id: string): void {
    const entry = getLore(id);
    if (!entry) return;
    this.storyOpen = true;
    this.audio.play(entry.kind === 'tape' ? 'tape' : 'paper');
    this.engine.restorationSystem.markRead(id);
    this.engine.requestSave();
    this.loreReader.onClose = () => {
      this.storyOpen = false;
      this.journal.refresh(this.state);
    };
    this.loreReader.show(entry);
  }

  private playIntroSequence(): void {
    this.introPlaying = true;
    this.engine.paused = true;
    document.body.classList.add('intro-active');
    // Start looking at the dark dormitory where the newcomers make camp.
    this.renderer.focusOn(150, 120, 1.6);
    playIntro({
      play: (sfx) => this.audio.play(sfx),
      onDone: () => {
        this.introPlaying = false;
        this.engine.paused = false;
        document.body.classList.remove('intro-active');
        this.engine.stateManager.applyDelta({ path: 'storyFlags', value: [...new Set([...this.state.storyFlags, 'intro:done'])] });
        this.engine.requestSave();
        this.toasts.show(`[[flashlight]] ${i18n.t('intro.firstHint')}`, 'info');
      },
    });
  }

  private checkShortages(): void {
    const state = this.state;
    // Early warning while there is still time to react.
    for (const r of ['food', 'water', 'power'] as ResourceType[]) {
      const res = state.resources[r];
      const falling = res.productionRate < res.consumptionRate;
      if (falling && res.amount > 0 && res.amount < res.cap * 0.1 && !this.lowWarned.has(r)) {
        this.lowWarned.add(r);
        this.audio.play('warn');
      } else if (res.amount > res.cap * 0.25) this.lowWarned.delete(r);
    }
    for (const s of state.survivors) {
      if (s.health < 30 && !this.hurtWarned.has(s.id)) {
        this.hurtWarned.add(s.id);
        this.audio.play('pulse');
      } else if (s.health > 60) this.hurtWarned.delete(s.id);
    }
    const ok = (state.powerRatio ?? 1) >= 0.99;
    if (ok && !this.powerOk) this.audio.play('powerUp');
    this.powerOk = ok;
    // Rubble shifting as crews dig through a ruin.
    for (const ruin of state.ruins ?? []) {
      if (!ruin.started) continue;
      const bucket = Math.floor((ruin.progress / Math.max(1, ruin.total)) * 4);
      if (bucket > (this.ruinBuckets.get(ruin.id) ?? 0)) this.audio.play('crumble', { volume: 0.7 });
      this.ruinBuckets.set(ruin.id, bucket);
    }
    for (const r of ['food', 'water'] as ResourceType[]) {
      const res = this.state.resources[r];
      if (res.amount <= 0 && res.consumptionRate > 0 && !this.shortages.has(r)) {
        this.shortages.add(r);
        this.toasts.show(`[[warning]] ${i18n.t(`toast.no_${r}`)}`, 'bad');
        this.audio.play('error');
      } else if (res.amount > 5) {
        this.shortages.delete(r);
      }
    }
  }

  private setupEventHandlers(): void {
    this.hud.onNav = (key: NavKey) => {
      this.engine.notifyInteraction();
      this.audio.play('click');
      this.cancelPlacement();
      const panels = { build: this.buildMenu, people: this.peoplePanel, research: this.researchPanel } as const;
      if (key === 'surface') {
        this.closeSheets();
        this.surfacePanel.show();
        return;
      }
      const panel = panels[key];
      const wasOpen = panel.isVisible;
      this.closeSheets();
      if (wasOpen) return;
      if (key === 'build') this.buildMenu.show(this.state);
      else if (key === 'people') this.peoplePanel.show();
      else this.researchPanel.show();
    };

    this.hud.onMenu = () => {
      this.audio.play('click');
      const wasOpen = this.menuPanel.isVisible;
      this.closeSheets();
      if (!wasOpen) this.menuPanel.show();
    };

    this.hud.onResourceTap = (r: ResourceType) => {
      const res = this.state.resources[r];
      const net = res.productionRate - res.consumptionRate;
      this.toasts.show(
        `${RESOURCE_ICONS[r] ?? ''} ${i18n.t(`resources.${r}`)}: ${Math.floor(res.amount)}/${res.cap} · ${i18n.formatRate(net)} ${i18n.t('resources.perSecond')}`,
      );
    };

    this.hud.onPlacementCancel = () => this.cancelPlacement();
    this.hud.onPopulation = () => {
      const s = this.state;
      if (s.survivors.length >= s.maxPopulation) {
        this.toasts.show(`[[quarters]] ${i18n.t('hud.bunkerFull')}`, 'bad');
      } else {
        const left = Math.max(0, Math.ceil(s.nextArrivalAt - s.stats.totalPlayTime));
        this.toasts.show(`[[door]] ${i18n.t('hud.nextArrival', { t: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` })}`);
      }
    };
    this.hud.onJournal = () => {
      this.audio.play('paper');
      const wasOpen = this.journal.isVisible;
      this.closeSheets();
      if (!wasOpen) this.journal.show(this.state);
    };
    this.eraPanel.onOpenProjects = () => { this.closeSheets(); this.projectsPanel.show(); }; // [LateGame B1]
    this.hud.onEra = () => {
      this.audio.play('click');
      const wasOpen = this.eraPanel.isVisible;
      this.closeSheets();
      if (!wasOpen) this.eraPanel.show(this.state);
    };
    this.hud.onSupply = () => this.openSupplyDrop();
    this.journal.onRead = (id: string) => this.readLore(id);
    this.journal.onReplay = (id: string) => this.replayChapter(id);
    // [Economy A2] credits shop tab in the journal
    this.journal.shop = this.engine.shopSystem;
    this.journal.onBuy = (id) => {
      if (this.engine.shopSystem.buy(id)) {
        this.audio.play('achievement');
        this.engine.requestSave();
        this.journal.refresh(this.state);
      } else this.toasts.show(i18n.t('shop.cantBuy'), 'bad');
    };
    this.renderer.incidents.onTap = (id: string) => this.tapIncident(id);
    this.buildingPanel.onIncidentTap = (id: string) => this.tapIncident(id);
    this.buildingPanel.onQuickFix = (id: string) => this.quickFixIncident(id);
    this.buildingPanel.onSpecialize = (bid: string, spec: string) => this.specialize(bid, spec);
    this.hud.onIncident = () => {
      if (this.dangerBanner()) { this.audio.play('click'); this.showDanger(); return; } // [Danger]
      const inc = this.state.incidents?.[0];
      const r = inc ? this.renderer.roomRect(inc.buildingId) : null;
      if (!r) return;
      this.audio.play('click');
      this.closeSheets();
      this.renderer.focusOn(r.x + r.w / 2, r.y + 50, 1.6);
    };
    this.ruinPanel.onStart = (id: string) => this.startRuin(id);
    this.renderer.onRuinClick = (ruinId: string) => {
      this.engine.notifyInteraction();
      if (this.placementMode) {
        this.audio.play('error');
        const r = this.state.ruins.find(x => x.id === ruinId);
        if (r) this.rejectAt({ x: r.x, y: 0, floor: r.floor });
        return;
      }
      this.audio.play('click');
      this.openRuin(ruinId);
    };
    this.hud.onObjectiveTap = () => this.onObjectiveTap();
    this.renderer.onDigClick = () => this.confirmDig();
    this.renderer.onElevator = () => {
      if (this.renderer.zoomLevel !== 'far' && Math.random() < 0.6) this.audio.play('elevator', { volume: 0.35 });
    };
    this.renderer.onLodChange = (lod) => {
      this.audio.setZoom(lod);
      if (lod === 'far' || this.renderer.zoomLevel === 'far') this.audio.play('whoosh', { volume: 0.7 });
    };
    this.renderer.onDistrictDig = () => {
      this.audio.play('click');
      this.confirmDistrictDig();
    };
    this.renderer.nameOf = (s: { name: string }) => this.localName(s.name);
    this.renderer.onBubbleTap = (id: string) => this.collectBubble(id);
    this.renderer.onPersonDrop = (sid: string, target: string | null) => this.dropSurvivor(sid, target);
    this.renderer.onPersonTap = (sid: string) => {
      this.audio.play('click');
      this.closeSheets();
      this.peoplePanel.show(sid);
    };

    this.buildMenu.onSelectBuilding = (type: BuildingType) => {
      this.audio.play('click');
      this.startPlacement(type);
    };

    this.researchPanel.onOpenGenesis = () => {
      this.closeSheets();
      this.menuPanel.show('genesis');
    };
    this.surfacePanel.onOpenResearch = () => {
      this.surfacePanel.hide();
      this.closeSheets();
      this.researchPanel.show();
    };

    this.buildingPanel.onUpgrade = (id: string) => {
      const b = this.state.buildings.find(x => x.id === id);
      if (!b) return;
      const cost = this.engine.buildingSystem.getUpgradeCost(b);
      if (!this.engine.resourceSystem.spend(this.engine.stateManager, cost)) {
        this.toasts.show(i18n.t('toast.notEnough'), 'bad');
        this.audio.play('error');
        return;
      }
      this.engine.buildingSystem.upgradeBuilding(id, this.engine.stateManager);
      this.engine.requestSave();
      this.audio.play('build');
      this.toasts.show(`[[up]] ${i18n.t('toast.upgradeStarted')}`, 'good');
      this.buildingPanel.refresh(this.state);
    };

    this.buildingPanel.onClose = () => this.renderer.setSelected(null);

    this.renderer.onTileClick = (pos: Position) => {
      this.engine.notifyInteraction();
      if (!this.placementMode) return;
      if (this.tryPlaceBuilding(this.placementMode, pos)) {
        this.audio.play('place');
        const c = this.renderer.slotCenter(pos);
        this.renderer.burstAt(c.x, c.y + 30, 80);
        this.renderer.shake(2, 0.25);
        this.cancelPlacement();
      } else {
        this.audio.play('error');
        this.rejectAt(pos);
      }
    };

    this.renderer.onBuildingClick = (buildingId: string) => {
      this.engine.notifyInteraction();
      const building = this.state.buildings.find(b => b.id === buildingId);
      if (!building) return;
      if (this.placementMode) {
        this.audio.play('error');
        this.rejectAt(building.position);
        return;
      }
      this.audio.play('click');
      this.closeSheets();
      this.renderer.setSelected(buildingId);
      this.buildingPanel.show(buildingId);
    };

    bus.on('building:complete', (id: unknown) => {
      const b = this.state.buildings.find(x => x.id === id);
      if (!b) return;
      if (isDistrict(b.type)) {
        const c = this.renderer.roomCenter(b);
        this.renderer.burstAt(c.x, c.y + 30, 200);
        setTimeout(() => this.showDistrictFound(b.type), 600);
      }
      const name = getDef(b.type)?.name[i18n.currentLocale] ?? b.type;
      this.toasts.show(`[[check]] ${i18n.t('toast.buildingComplete', { name })}`, 'good');
      if (b.type === 'generator' || b.type === 'reactor' || b.type === 'reactorHall') this.audio.play('engineStart');
      else {
        this.audio.play('complete');
        setTimeout(() => this.audio.play('hiss', { volume: 0.6 }), 260);
      }
      const c = this.renderer.roomCenter(b);
      this.popups.spawn(c.x, c.y, '[[check]]', 0x44ff88);
    });

    bus.on('survivor:levelup', (s: unknown, stat: unknown) => {
      const survivor = s as SurvivorState;
      this.audio.play('levelup');
      const p = this.renderer.personPos(survivor.id);
      if (p) this.renderer.floatIcons(p.x, p.y, 'star', 5, '#ffe27a');
      this.toasts.show(`[[star]] ${i18n.t('toast.levelUp', {
        name: this.localName(survivor.name),
        level: survivor.level,
        stat: i18n.t(`stats.${stat as keyof SurvivorStats}`),
      })}`, 'good');
    });

    bus.on('survivor:died', (s: unknown) => {
      this.audio.play('error');
      this.toasts.show(`[[skull]] ${i18n.t('toast.died', { name: this.localName((s as SurvivorState).name) })}`, 'bad');
    });

    bus.on('research:complete', (id: unknown) => {
      const def = getResearch(id as string);
      if (!def) return;
      this.audio.play(def.effects.some(e => e.type === 'unlock' || e.type === 'feature') ? 'unlock' : 'research');
      this.toasts.show(`[[research]] ${i18n.t('toast.researchDone', { name: def.name[i18n.currentLocale] ?? def.name.en })}`, 'good');
      this.engine.requestSave();
    });

    bus.on('achievement', (id: unknown) => {
      const a = ACHIEVEMENTS.find(x => x.id === id);
      if (!a) return;
      this.audio.play('achievement');
      this.toasts.show(`[[trophy]] ${i18n.t('toast.achievement', { name: a.name[i18n.currentLocale] ?? a.name.en })}`, 'good');
      this.engine.requestSave();
    });

    bus.on('mission:complete', () => {
      this.audio.play('mission');
      this.engine.requestSave();
    });

    bus.on('event:triggered', () => this.audio.play('event'));

    bus.on('incident:start', (i: unknown) => {
      const inc = i as Incident;
      const def = INCIDENTS[inc.kind];
      const sound: Record<string, 'fire' | 'splash' | 'powerDown' | 'skitter' | 'alarm'> = {
        fire: 'fire', flood: 'splash', blackout: 'powerDown', roaches: 'skitter', breach: 'alarm',
      };
      this.audio.play(sound[inc.kind]);
      if (inc.kind !== 'breach') setTimeout(() => this.audio.play('alarm'), 400);
      this.renderer.shake(inc.kind === 'breach' ? 6 : 4, 0.5);
      navigator.vibrate?.([40, 60, 40]);
      this.toasts.show(`[[${def.icon}]] ${i18n.t('incident.started', { name: def.name[i18n.currentLocale], room: this.roomName(inc.buildingId) })}`, 'bad');
    });
    bus.on('incident:burnout', (i: unknown) => {
      const inc = i as Incident;
      this.toasts.show(`[[${INCIDENTS[inc.kind].icon}]] ${i18n.t('incident.burnout', { name: INCIDENTS[inc.kind].name[i18n.currentLocale], room: this.roomName(inc.buildingId) })}`, 'bad');
    });
    bus.on('incident:spread', (id: unknown) => {
      this.toasts.show(`[[fire]] ${i18n.t('incident.spread', { room: this.roomName(id as string) })}`, 'bad');
    });
    bus.on('incident:resolved', (r: unknown) => {
      const { incident, quick } = r as IncidentResolved;
      const def = INCIDENTS[incident.kind];
      this.audio.play(incident.kind === 'fire' ? 'extinguish' : incident.kind === 'blackout' ? 'powerUp' : 'fixed');
      if (incident.kind === 'fire') {
        setTimeout(() => this.audio.play('steam', { volume: 0.7 }), 300);
        setTimeout(() => this.audio.play('fixed'), 700);
      }
      const rect = this.renderer.roomRect(incident.buildingId);
      if (rect) {
        this.renderer.floatIcons(rect.x + rect.w / 2, rect.y + 40, 'star', 5, '#ffd27a');
        this.popups.spawn(rect.x + rect.w / 2, rect.y + 30, `[[check]] ${def.name[i18n.currentLocale]}`, 0x7affb0);
      }
      this.toasts.show(`[[check]] ${i18n.t(quick ? 'incident.fixedQuick' : 'incident.fixed', { name: def.name[i18n.currentLocale] })}`, 'good');
      this.engine.requestSave();
    });

    // [Danger] raid warnings, disasters and their outcomes
    bus.on('raid:warning', (r: unknown) => {
      const raid = r as { hitAt: number };
      this.audio.play('alarm');
      this.dangerPrompt = true;
      this.toasts.show(`[[armory]] ${i18n.t('danger.toast.raid', { time: i18n.formatDuration(raid.hitAt - this.state.stats.totalPlayTime) })}`, 'bad');
    });
    bus.on('raid:resolved', (r: unknown) => { this.raidResult = r as RaidResult; });
    bus.on('disaster:start', (d: unknown) => {
      const def = DISASTERS[(d as { kind: keyof typeof DISASTERS }).kind];
      this.audio.play('alarm');
      this.dangerPrompt = true;
      this.toasts.show(`[[${def.icon}]] ${i18n.t('danger.toast.disaster', { name: def.name[i18n.currentLocale], time: i18n.formatDuration(def.countdown) })}`, 'bad');
    });
    bus.on('disaster:handled', (d: unknown) => {
      const def = DISASTERS[(d as { kind: keyof typeof DISASTERS }).kind];
      this.toasts.show(`[[check]] ${def.saved[i18n.currentLocale]}`, 'good');
    });
    bus.on('disaster:struck', (r: unknown) => {
      const res = r as { kind: keyof typeof DISASTERS };
      const def = DISASTERS[res.kind];
      this.audio.play('error');
      this.toasts.show(`[[${def.icon}]] ${i18n.t('danger.toast.struck', { name: def.name[i18n.currentLocale], text: def.struck[i18n.currentLocale] })}`, 'bad');
    });
    bus.on('family:couple', (c: unknown) => {
      const { a, b } = c as CoupleFormed;
      this.audio.play('heart');
      for (const s of [a, b]) {
        const p = this.renderer.personPos(s.id);
        if (p) this.renderer.floatIcons(p.x, p.y, 'heart', 6, '#ff7a9a');
      }
      this.toasts.show(`[[heart]] ${i18n.t('family.couple', { a: this.localName(a.name), b: this.localName(b.name) })}`, 'good');
      this.engine.requestSave();
    });
    bus.on('family:child', (c: unknown) => {
      const { child, parents } = c as ChildBorn;
      this.audio.play('baby');
      const p = this.renderer.personPos(parents[0].id);
      if (p) this.renderer.floatIcons(p.x, p.y, 'baby', 4, '#ffe2a0');
      this.toasts.show(`[[baby]] ${i18n.t('family.born', { a: this.localName(parents[0].name), b: this.localName(parents[1].name), name: this.localName(child.name) })}`, 'good');
      this.engine.requestSave();
    });
    bus.on('family:grownUp', (s: unknown) => {
      const sv = s as SurvivorState | undefined;
      if (!sv) return;
      this.audio.play('levelup');
      this.toasts.show(`[[star]] ${i18n.t('family.grownUp', { name: this.localName(sv.name) })}`, 'good');
    });
    bus.on('story:chapter', (id: unknown) => { this.pendingChapter = id as string; });
    bus.on('mission:choice', () => this.audio.play('radio'));
    bus.on('building:specialized', (id: unknown) => {
      const b = this.state.buildings.find(x => x.id === id);
      const spec = b ? specOf(b) : undefined;
      if (!b || !spec) return;
      this.audio.play('achievement');
      const c = this.renderer.roomCenter(b);
      this.renderer.burstAt(c.x, c.y + 30, 120);
      this.renderer.floatIcons(c.x, c.y + 10, 'crown', 5, '#ffd27a');
      this.toasts.show(`[[crown]] ${i18n.t('spec.done', { room: this.roomName(b.id), spec: spec.name[i18n.currentLocale] })}`, 'good');
      this.engine.requestSave();
    });

    bus.on('floor:dug', (floor: unknown) => {
      this.toasts.show(`[[pick]] ${i18n.t('dig.done', { n: (floor as number) + 1 })}`, 'good');
      this.renderer.focusFloor(floor as number);
    });

    // [LateGame B1-B4] big projects, caravans, mastery, weekly challenge
    bus.on('project:stage', (id: unknown, stage: unknown) => {
      const def = getProject(id as string);
      this.audio.play('complete');
      this.toasts.show(`[[build]] ${i18n.t('proj.stageDone', { name: def?.name[i18n.currentLocale] ?? '', n: stage as number, all: def?.stages.length ?? 0 })}`, 'good');
      this.engine.requestSave();
    });
    bus.on('project:done', (id: unknown) => {
      const def = getProject(id as string);
      this.toasts.show(`[[trophy]] ${i18n.t('proj.done', { name: def?.name[i18n.currentLocale] ?? '' })}`, 'good');
    });
    bus.on('caravan:complete', (r: unknown) => {
      const c = r as { partner: string; ok: boolean; levelUp: boolean; recruitName: string | null };
      const name = getPartner(c.partner)?.name[i18n.currentLocale] ?? '';
      this.toasts.show(c.ok ? `[[cart]] ${i18n.t('trade.home', { name })}${c.levelUp ? ` · ${i18n.t('trade.levelUp')}` : ''}${c.recruitName ? ` · ${i18n.t('mission.recruit', { name: this.localName(c.recruitName) })}` : ''}` : `[[skull]] ${i18n.t('trade.ambush', { name })}`, c.ok ? 'good' : 'bad');
      this.engine.requestSave();
    });
    bus.on('survivor:rank', (s: unknown, rank: unknown) => {
      this.toasts.show(`[[medal]] ${i18n.t('mastery.up', { name: this.localName((s as SurvivorState).name), n: rank as number })}`);
    });
    bus.on('weekly:done', () => {
      this.audio.play('complete');
      this.toasts.show(`[[trophy]] ${i18n.t('weekly.won', { n: WEEKLY_CREDITS })}`, 'good');
      this.engine.requestSave();
    });

    bus.on('objective:complete', (o: unknown) => {
      const obj = o as Objective;
      this.audio.play('complete');
      this.toasts.show(`[[target]] ${i18n.t('toast.objective', { name: obj.text[i18n.currentLocale] ?? obj.text.en })}`, 'good');
      this.engine.requestSave();
    });

    bus.on('ruin:cleared', (info: unknown) => {
      const { ruin, loot, buildingId, lore } = info as RuinClearedInfo;
      const c = this.renderer.ruinCenter(ruin);
      this.audio.play('debris');
      const lootText = (Object.entries(loot) as [ResourceType, number][]).map(([r, v]) => `+${v} ${RESOURCE_ICONS[r] ?? ''}`);
      lootText.forEach((t, i) => setTimeout(() => this.popups.spawn(c.x + (i - (lootText.length - 1) / 2) * 30, c.y, t, 0xffd27a), i * 160));
      if (buildingId) {
        const b = this.state.buildings.find(x => x.id === buildingId);
        const name = b ? getDef(b.type)?.name[i18n.currentLocale] ?? '' : '';
        setTimeout(() => this.audio.play('restore'), 300);
        this.toasts.show(`[[workshop]] ${i18n.t('ruin.restored', { name })}`, 'good');
      } else {
        this.toasts.show(`[[broom]] ${i18n.t('ruin.cleared', { name: RUIN_KINDS[ruin.kind].name[i18n.currentLocale] })}`, 'good');
      }
      this.engine.requestSave();
      if (lore) setTimeout(() => this.queueLore(lore), 900);
    });

    bus.on('lore:found', (id: unknown) => {
      // Ruins announce their own finds after the dust settles; other finds (digging) announce here.
      if (this.state.ruins.some(r => r.lore === id)) return;
      setTimeout(() => this.queueLore(id as string), 1200);
    });

    bus.on('era:advance', (era: unknown) => {
      const def = ERAS[era as number];
      if (!def) return;
      this.audio.play('era');
      this.audio.setEra(def.id);
      this.renderer.shake(5, 1.2);
      this.storyOpen = true;
      this.closeSheets();
      this.engine.requestSave();
      showEraBanner(def, () => { this.storyOpen = false; });
    });

    bus.on('state:loaded', () => {
      this.closeSheets();
      this.surfacePanel.hide();
      this.cancelPlacement();
      this.renderer.resetScene();
    });

    bus.on('offline:processed', (report: unknown) => {
      if (this.engine.offlineReport === report) return;
      this.showWelcome(report as OfflineReport);
    });

    // Any touch, drag, wheel or key counts: the picture draws at full speed while the player is handling the bunker.
    for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown'] as const) {
      document.addEventListener(type, () => this.engine.notifyInteraction(), { passive: true });
    }
  }

  private async toggleLanguage(): Promise<void> {
    i18n.storeLocale(i18n.currentLocale === 'he' ? 'en' : 'he');
    await this.engine.forceSave();
    location.reload();
  }

  private confirmNewGame(): void {
    this.modal.show({
      icon: '[[warning]]',
      title: i18n.t('settings.newGame'),
      body: i18n.t('settings.newGameConfirm'),
      actions: [
        {
          label: i18n.t('settings.newGameYes'),
          className: 'btn-danger',
          onClick: async () => {
            this.modal.hide();
            await this.engine.newGame();
            this.toasts.show(i18n.t('settings.newGameDone'), 'good');
            this.playIntroSequence();
          },
        },
        { label: i18n.t('placement.cancel'), className: 'btn-secondary', onClick: () => this.modal.hide() },
      ],
    });
  }

  private confirmRebirth(): void {
    const gain = this.engine.metaSystem.rebirthGain(this.state);
    this.modal.show({
      icon: '[[isotope7]]',
      title: i18n.t('genesis.confirmTitle'),
      body: i18n.t('genesis.confirmBody', { n: gain }),
      actions: [
        {
          label: i18n.t('genesis.confirmYes'),
          className: 'btn-primary',
          onClick: async () => {
            this.modal.hide();
            await this.engine.rebirth();
            this.audio.play('achievement');
            this.toasts.show(`[[isotope7]] ${i18n.t('genesis.done', { n: gain })}`, 'good');
          },
        },
        { label: i18n.t('placement.cancel'), className: 'btn-secondary', onClick: () => this.modal.hide() },
      ],
    });
  }

  private async importSave(raw: string): Promise<void> {
    const ok = await this.engine.importState(raw);
    this.toasts.show(ok ? i18n.t('settings.importOk') : i18n.t('settings.importBad'), ok ? 'good' : 'bad');
    if (!ok) this.audio.play('error');
  }

  private localName(name: string): string {
    return this.engine.populationSystem.getLocalizedName({ name } as SurvivorState, i18n.currentLocale);
  }

  private closeSheets(): void {
    this.buildMenu.hide();
    this.buildingPanel.hide();
    this.peoplePanel.hide();
    this.researchPanel.hide();
    this.menuPanel.hide();
    this.ruinPanel.hide();
    this.journal.hide();
    this.eraPanel.hide();
    this.projectsPanel.hide(); // [LateGame B1]
  }

  private highlightPlacement(type: BuildingType): void {
    this.renderer.setPlacementHighlight(pos => this.engine.buildingSystem.canPlaceBuilding(type, pos, this.state), roomFloors(type));
  }

  private startPlacement(type: BuildingType): void {
    const state = this.state;
    const floors = allowedFloors(type, state.currentFloors);
    const target = floors.find(f => this.engine.buildingSystem.findFreeSpot(type, f, state)) ?? floors[0];
    this.renderer.focusFloor(target);
    this.placementMode = type;
    document.body.classList.add('placement-mode');
    const name = getDef(type)?.name[i18n.currentLocale] ?? type;
    this.hud.showPlacement(name);
    this.highlightPlacement(type);
  }

  private cancelPlacement(): void {
    if (!this.placementMode) return;
    this.placementMode = null;
    document.body.classList.remove('placement-mode');
    this.hud.hidePlacement();
    this.renderer.setPlacementHighlight(null);
  }

  private rejectAt(pos: Position): void {
    const c = this.renderer.slotCenter(pos);
    this.popups.spawn(c.x, c.y, '[[close]]', 0xff4444);
  }

  private tryPlaceBuilding(type: BuildingType, pos: Position): boolean {
    const state = this.state;
    if (!this.engine.buildingSystem.canPlaceBuilding(type, pos, state)) return false;
    const cost = this.engine.buildingSystem.getBuildCost(type, state);
    if (!this.engine.resourceSystem.spend(this.engine.stateManager, cost)) {
      this.toasts.show(i18n.t('toast.notEnough'), 'bad');
      return false;
    }
    this.engine.buildingSystem.placeBuilding(type, pos, this.engine.stateManager);
    this.engine.requestSave();
    return true;
  }

  /** Working rooms now and then offer a bonus to tap: about half a minute of their output. */
  private spawnBubbles(): void {
    if (document.hidden || this.introPlaying) return;
    const state = this.state;
    for (const b of state.buildings) {
      if (this.renderer.hasBubble(b.id) || b.assignedSurvivorIds.length === 0 || Math.random() > 0.28) continue;
      const out = this.engine.resourceSystem.getBuildingOutput(state, b);
      const entry = (Object.entries(out) as [ResourceType, number][]).find(([, v]) => v > 0);
      if (!entry) continue;
      this.renderer.showBubble(b.id, entry[0] as IconName);
    }
  }

  private collectBubble(buildingId: string): void {
    const state = this.state;
    const b = state.buildings.find(x => x.id === buildingId);
    const pos = this.renderer.popBubble(buildingId);
    if (!b || !pos) return;
    const out = this.engine.resourceSystem.getBuildingOutput(state, b);
    const entry = (Object.entries(out) as [ResourceType, number][]).find(([, v]) => v > 0);
    if (!entry) return;
    const [made, rate] = entry;
    let r: ResourceType = made;
    let amount = Math.max(1, Math.round(rate * BUBBLE_SECONDS));
    if (Math.random() < BUBBLE_SURPRISE_CHANCE) {
      r = Math.random() < 0.5 ? 'scrap' : 'knowledge';
      amount = Math.max(3, Math.round(state.resources[r].cap * BUBBLE_SURPRISE_SHARE));
    }
    this.engine.resourceSystem.gain(this.engine.stateManager, { [r]: amount });
    this.audio.play(r === 'water' ? 'drip' : r === 'materials' || r === 'scrap' ? 'coin' : 'collect');
    if (r === 'water') this.audio.play('collect', { volume: 0.6 });
    navigator.vibrate?.(12);
    this.flyToHud(r, pos.x, pos.y, `+${amount}`);
    this.engine.notifyInteraction();
  }

  /** A collected resource icon arcs up into its HUD counter, which then pulses. */
  private flyToHud(r: ResourceType, x: number, y: number, label: string): void {
    const target = this.hud.resourceRect(r);
    const fly = el('div', 'fly-icon', `${RESOURCE_ICONS[r] ?? ''} ${label}`);
    fly.style.left = `${x}px`;
    fly.style.top = `${y}px`;
    document.body.appendChild(fly);
    requestAnimationFrame(() => {
      fly.classList.add('go');
      if (target) {
        fly.style.left = `${target.left + target.width / 2}px`;
        fly.style.top = `${target.top + target.height / 2}px`;
      }
    });
    setTimeout(() => {
      fly.remove();
      this.hud.pulseResource(r);
    }, 650);
  }

  /** Dropping a carried survivor on a room puts them to work there. */
  private dropSurvivor(survivorId: string, targetId: string | null): void {
    const state = this.state;
    const s = state.survivors.find(x => x.id === survivorId);
    if (!s || !targetId || targetId === s.assignedBuildingId) return;
    const ps = this.engine.populationSystem;
    const name = this.localName(s.name);
    if (targetId.startsWith('r_')) {
      const ruin = state.ruins.find(r => r.id === targetId);
      if (!ruin) return;
      if (!ruin.started) {
        this.openRuin(targetId);
        return;
      }
      if (!this.engine.restorationSystem.assign(targetId, survivorId)) {
        this.audio.play('error');
        this.toasts.show(`[[warning]] ${i18n.t('people.full')}`, 'bad');
        return;
      }
      this.toasts.show(`[[pick]] ${i18n.t('drag.toRuin', { name })}`, 'good');
    } else {
      const b = state.buildings.find(x => x.id === targetId);
      if (!b) return;
      const def = getDef(b.type);
      if (!def || def.maxWorkers === 0) {
        this.audio.play('error');
        this.toasts.show(`[[warning]] ${i18n.t('drag.noJobs')}`, 'bad');
        return;
      }
      if (!ps.assignSurvivorToBuilding(this.engine.stateManager, survivorId, targetId)) {
        this.audio.play('error');
        this.toasts.show(`[[warning]] ${i18n.t('drag.full', { room: def.name[i18n.currentLocale] ?? def.name.en })}`, 'bad');
        return;
      }
      this.toasts.show(`${BUILDING_ICONS[b.type] ?? ''} ${i18n.t('drag.assigned', { name, room: def.name[i18n.currentLocale] ?? def.name.en })}`, 'good');
    }
    this.audio.play('assign');
    navigator.vibrate?.(18);
    this.engine.requestSave();
  }

  private spawnProductionPopups(): void {
    if (document.hidden) return;
    const state = this.state;
    let shown = 0;
    for (const b of state.buildings) {
      if (shown >= MAX_PRODUCTION_POPUPS) break;
      const out = this.engine.resourceSystem.getBuildingOutput(state, b);
      const entry = (Object.entries(out) as [ResourceType, number][]).find(([r, v]) => v > 0 && r !== 'power');
      if (!entry) continue;
      const [r, rate] = entry;
      const amount = rate * (PRODUCTION_POPUP_MS / 1000);
      const c = this.renderer.roomCenter(b);
      const delay = Math.random() * 1500;
      setTimeout(() => this.popups.spawn(c.x, c.y + 10, `+${amount >= 10 ? Math.round(amount) : amount.toFixed(1)} ${RESOURCE_ICONS[r] ?? ''}`, RESOURCE_COLORS[r]), delay);
      shown++;
    }
  }

  private showEvent(): void {
    const ev = this.state.activeEvent;
    if (!ev) return;
    const params = this.eventParams(ev.data);
    const choices = this.engine.eventSystem.getChoices();

    this.modal.show({
      icon: EVENT_ICONS[ev.id] ?? '[[warning]]',
      title: i18n.t(`event.${ev.id}.title`, params),
      body: this.eventBody(ev.data, i18n.t(`event.${ev.id}.desc`, params)),
      actions: choices.map((c, i) => ({
        label: i18n.t(`event.${ev.id}.choice.${c.key}`, params),
        className: i === 0 ? 'btn-primary' : 'btn-secondary',
        disabled: !this.engine.eventSystem.isChoiceAvailable(c),
        detail: c.cost ? costRow(this.state, c.cost as Record<string, number>) : undefined,
        onClick: () => this.resolveEvent(ev.id, c.key, params),
      })),
    });
  }

  /** Events about a person (a wanderer at the door) show their painted portrait. */
  private eventBody(data: Record<string, unknown>, text: string): string | HTMLElement {
    const people = ((data.group as SurvivorState[] | undefined) ?? (data.survivor ? [data.survivor as SurvivorState] : []))
      .filter(p => p?.name);
    if (people.length === 0) return text;
    const wrap = el('div');
    const row = el('div', 'modal-portraits');
    for (const p of people) {
      const img = el('img', 'modal-portrait');
      img.src = portraitUrl(portraitFor(p));
      img.alt = '';
      row.appendChild(img);
    }
    wrap.append(row, el('p', 'modal-body', text));
    return wrap;
  }

  private resolveEvent(eventId: string, choiceKey: string, params: Record<string, string>): void {
    const result = this.engine.eventSystem.resolve(choiceKey);
    if (!result) {
      this.modal.hide();
      return;
    }
    this.engine.notifyInteraction();
    this.engine.requestSave();
    this.audio.play(eventId === 'trader' && result.gains ? 'coin' : 'click');
    const body = el('div', 'modal-result');
    body.appendChild(el('p', 'modal-body', i18n.t(`event.${eventId}.result.${result.key}`, params)));
    if (result.gains) body.appendChild(this.gainsList(result.gains));
    for (const inj of result.injured ?? []) {
      body.appendChild(el('p', 'modal-sub negative-text', `[[bandage]] ${i18n.t('mission.injury', { name: this.localName(inj.name), n: inj.damage })}`));
    }

    this.modal.show({
      icon: EVENT_ICONS[eventId] ?? '[[warning]]',
      title: i18n.t(`event.${eventId}.title`, params),
      body,
      actions: [{ label: i18n.t('event.ok'), onClick: () => this.modal.hide() }],
    });
  }

  // ---- [Danger] raid warnings, disasters, memorials (LATEGAME-PLAN part C) ----

  /** The banner for the most urgent danger on the clock (null = calm). */
  private dangerBanner(): { text: string; kind: string } | null {
    const d = this.state.danger;
    if (!d) return null;
    const now = this.state.stats.totalPlayTime;
    const locale = i18n.currentLocale;
    const dz = [...d.disasters].sort((a, b) => a.deadline - b.deadline)[0];
    const raidLeft = d.raid ? Math.max(0, d.raid.hitAt - now) : Infinity;
    if (dz && dz.deadline - now <= raidLeft) {
      const def = DISASTERS[dz.kind];
      const room = dz.buildingId ? ` · ${this.roomName(dz.buildingId)}` : '';
      return {
        text: `[[${def.icon}]] ${i18n.t('danger.banner.disaster', { name: def.name[locale], time: i18n.formatDuration(dz.deadline - now) })}${room} · ${i18n.t('danger.tapHint')}`,
        kind: 'danger',
      };
    }
    if (d.raid) return { text: `[[armory]] ${i18n.t('danger.banner.raid', { time: i18n.formatDuration(raidLeft) })} · ${i18n.t('danger.tapHint')}`, kind: 'raid' };
    return null;
  }

  /** The decision window for the most urgent danger: the raid (pay or fight) or a disaster (handle it). */
  private showDanger(): void {
    const state = this.state;
    const d = state.danger;
    const now = state.stats.totalPlayTime;
    const locale = i18n.currentLocale;
    const dz = [...d.disasters].sort((a, b) => a.deadline - b.deadline)[0];
    const raidLeft = d.raid ? Math.max(0, d.raid.hitAt - now) : Infinity;
    const body = el('div', 'modal-result');
    const later = { label: i18n.t('danger.disaster.later'), className: 'btn-secondary', onClick: () => this.modal.hide() };
    const more = d.disasters.length + (d.raid ? 1 : 0) - 1;
    const note = more > 0 ? el('p', 'bp-hint', i18n.t('danger.more', { n: more })) : null;
    if (dz && dz.deadline - now <= raidLeft) {
      const def = DISASTERS[dz.kind];
      const cost = disasterCost(state, dz.kind);
      const block = this.engine.incidentSystem.handleBlock(dz.id);
      body.append(
        el('p', 'modal-body', def.desc[locale]),
        el('p', 'modal-sub negative-text', `[[clock]] ${i18n.t('danger.disaster.eta', { time: i18n.formatDuration(dz.deadline - now) })}`),
        el('p', 'bp-hint', `[[worker]] ${i18n.t('danger.disaster.crew', { n: def.crew })}`),
      );
      if (block === 'cost') body.appendChild(el('p', 'bp-hint negative-text', i18n.t('danger.disaster.noCost')));
      if (block === 'crew') body.appendChild(el('p', 'bp-hint negative-text', i18n.t('danger.disaster.noCrew')));
      if (note) body.appendChild(note);
      this.modal.show({
        icon: `[[${def.icon}]]`,
        title: def.name[locale],
        body,
        actions: [
          {
            label: def.handleLabel[locale], disabled: !!block, detail: costRow(state, cost),
            onClick: () => {
              if (this.engine.incidentSystem.handle(dz.id)) {
                this.engine.notifyInteraction();
                this.engine.requestSave();
                this.audio.play('fixed');
              } else this.toasts.show(i18n.t('toast.notEnough'), 'bad');
              this.modal.hide();
            },
          },
          later,
        ],
      });
      return;
    }
    if (!d.raid) return;
    const tribute = raidTribute(state) as Record<string, number>;
    const weak = bunkerDefense(state) < d.raid.strength;
    body.append(
      el('p', 'modal-body', i18n.t('danger.raid.body', { strength: d.raid.strength, defense: bunkerDefense(state), time: i18n.formatDuration(raidLeft) })),
      el('p', `bp-hint ${weak ? 'negative-text' : ''}`, i18n.t(weak ? 'danger.raid.hintWeak' : 'danger.raid.hintOk')),
    );
    if (note) body.appendChild(note);
    this.modal.show({
      icon: '[[armory]]',
      title: i18n.t('danger.raid.title'),
      body,
      actions: [
        {
          label: i18n.t('danger.raid.pay'), className: weak ? 'btn-primary' : 'btn-secondary', disabled: !this.engine.eventSystem.canPayTribute(),
          detail: costRow(state, tribute),
          onClick: () => {
            this.engine.eventSystem.payTribute();
            this.engine.notifyInteraction();
            this.engine.requestSave();
            this.modal.hide();
          },
        },
        { label: i18n.t('danger.raid.hold'), className: weak ? 'btn-secondary' : 'btn-primary', onClick: () => this.modal.hide() },
      ],
    });
  }

  /** What happened when the raiders reached the door. */
  private showRaidResult(r: RaidResult): void {
    const body = el('div', 'modal-result');
    body.appendChild(el('p', 'modal-body', i18n.t(`raid.result.${r.key}`, { captive: r.captive ? this.localName(r.captive) : '' })));
    if (r.gains) body.appendChild(this.gainsList(r.gains));
    for (const inj of r.injured) {
      body.appendChild(el('p', 'modal-sub negative-text', `[[bandage]] ${i18n.t('mission.injury', { name: this.localName(inj.name), n: inj.damage })}`));
    }
    if (r.died) body.appendChild(el('p', 'modal-sub negative-text', `[[skull]] ${i18n.t('raid.result.died', { name: this.localName(r.died) })}`));
    this.audio.play(r.key === 'win' || r.key === 'winCaptive' ? 'achievement' : 'error');
    this.modal.show({
      icon: '[[armory]]',
      title: i18n.t('raid.title'),
      body,
      actions: [{ label: i18n.t('event.ok'), onClick: () => this.modal.hide() }],
    });
  }

  /** Meaningful death: the portrait, the name, one line about who they were, and the choice of how to say goodbye. */
  private showMemorial(): void {
    const f = this.state.danger.memorialQueue[0];
    if (!f) return;
    const name = this.localName(f.name);
    const lineKey = f.job && i18n.has(`memorial.line.${f.job}`) ? `memorial.line.${f.job}` : 'memorial.line.generic';
    const body = el('div', 'modal-result memorial');
    const row = el('div', 'modal-portraits');
    const img = el('img', 'modal-portrait');
    img.src = portraitUrl(portraitFor(f));
    img.alt = '';
    row.appendChild(img);
    body.append(
      row,
      el('p', 'modal-sub', i18n.t('memorial.sub', { level: f.level })),
      el('p', 'modal-body', `"${i18n.t(lineKey)}"`),
      el('p', 'bp-hint', `[[heart]] ${i18n.t('memorial.ceremonyHint')}`),
      el('p', 'bp-hint', `[[hourglass]] ${i18n.t('memorial.carryOnHint')}`),
    );
    this.audio.play('error');
    const answer = (choice: 'ceremony' | 'carryOn') => {
      if (!this.engine.deathSystem.answerMemorial(choice, this.engine.resourceSystem)) {
        this.toasts.show(i18n.t('toast.notEnough'), 'bad');
        return;
      }
      this.engine.requestSave();
      this.modal.hide();
    };
    this.modal.show({
      icon: '[[skull]]',
      title: i18n.t('memorial.title', { name }),
      body,
      actions: [
        {
          label: i18n.t('memorial.ceremony'), disabled: !this.engine.resourceSystem.canAfford(this.state, CEREMONY_COST),
          detail: costRow(this.state, CEREMONY_COST), onClick: () => answer('ceremony'),
        },
        { label: i18n.t('memorial.carryOn'), className: 'btn-secondary', onClick: () => answer('carryOn') },
      ],
    });
  }

  private roomName(buildingId: string): string {
    const b = this.state.buildings.find(x => x.id === buildingId);
    if (!b) return '';
    return `${getDef(b.type)?.name[i18n.currentLocale] ?? b.type} · B${b.position.floor + 1}`;
  }

  private updateIncidentBanner(): void {
    // [Danger] a raid warning or disaster countdown takes the banner (and its alarm) over a room crisis.
    const danger = this.dangerBanner();
    if (danger) {
      this.hud.setIncident(danger.text, danger.kind);
      const t = performance.now();
      if (t - this.lastIncidentAlarm > 25000) {
        if (this.lastIncidentAlarm) this.audio.play('alarm');
        this.lastIncidentAlarm = t;
      }
      return;
    }
    const list = this.state.incidents ?? [];
    if (!list.length) {
      this.hud.setIncident(null);
      return;
    }
    const inc = list[0];
    const def = INCIDENTS[inc.kind];
    const more = list.length > 1 ? ` +${list.length - 1}` : '';
    this.hud.setIncident(`[[${def.icon}]] ${def.name[i18n.currentLocale]} · ${this.roomName(inc.buildingId)}${more} · ${i18n.t('incident.tapAlarm')}`, inc.kind);
    // A reminder sound every so often while it burns.
    const now = performance.now();
    if (now - this.lastIncidentAlarm > 25000) {
      if (this.lastIncidentAlarm) this.audio.play('alarm');
      this.lastIncidentAlarm = now;
    }
  }

  /** The player's helping hand against a crisis. */
  private tapIncident(id: string): void {
    const inc = this.state.incidents?.find(i => i.id === id);
    if (!inc) return;
    this.engine.notifyInteraction();
    const sound: Record<string, 'splash' | 'click' | 'place'> = { fire: 'splash', flood: 'splash', blackout: 'click', roaches: 'place', breach: 'place' };
    this.audio.play(sound[inc.kind]);
    navigator.vibrate?.(14);
    this.renderer.incidents.hit(id);
    this.engine.incidentSystem.tap(id);
    if (this.buildingPanel.isVisible) this.buildingPanel.refresh(this.state);
  }

  private quickFixIncident(id: string): void {
    if (!this.engine.incidentSystem.quickFix(id)) {
      this.audio.play('error');
      this.toasts.show(i18n.t('toast.notEnough'), 'bad');
      return;
    }
    this.renderer.incidents.hit(id);
    this.buildingPanel.refresh(this.state);
  }

  private specialize(buildingId: string, specId: string): void {
    const bs = this.engine.buildingSystem;
    const cost = bs.specCost();
    if (!bs.canSpecialize(this.state, buildingId) || !this.engine.resourceSystem.spend(this.engine.stateManager, cost)) {
      this.audio.play('error');
      this.toasts.show(i18n.t('toast.notEnough'), 'bad');
      return;
    }
    bs.specialize(this.engine.stateManager, buildingId, specId);
    this.buildingPanel.refresh(this.state);
  }

  /** The strongest adult on the crew speaks for the dig team in the story. */
  private crewVoice(): { url: string; name: string } | null {
    const s = [...this.state.survivors].filter(x => !x.child).sort((a, b) => b.stats.strength - a.stats.strength)[0];
    return s ? { url: portraitUrl(portraitFor(s)), name: this.localName(s.name) } : null;
  }

  private chapterOptions(id: string) {
    const ch = getChapter(id)!;
    return {
      chapter: ch,
      crew: this.crewVoice(),
      portraitUrl: (file: string) => `${import.meta.env.BASE_URL}art/portraits/${file}.webp`,
      canChoose: (key: string) => this.engine.storySystem.canChoose(id, key),
      costLabel: (cost: Partial<Record<ResourceType, number>>) => (Object.entries(cost) as [ResourceType, number][]).map(([r, v]) => `${i18n.t(`resources.${r}`)} −${v}`).join(' · '),
      sfx: (name: string) => this.audio.play(name as Parameters<AudioEngine['play']>[0]),
      joinedName: (n: string) => this.localName(n),
    };
  }

  private playChapter(id: string): void {
    this.pendingChapter = null;
    if (!getChapter(id) || this.state.storyFlags.includes(`story:${id}`)) {
      this.engine.storySystem.release();
      return;
    }
    this.closeSheets();
    this.engine.paused = true;
    this.storyDialog.play({
      ...this.chapterOptions(id),
      finish: (key: string | null) => {
        const out = this.engine.storySystem.finish(id, key);
        this.engine.requestSave();
        return out;
      },
      onDone: () => {
        this.engine.paused = false;
        this.journal.refresh(this.state);
      },
    });
  }

  private replayChapter(id: string): void {
    const ch = getChapter(id);
    if (!ch) return;
    const choice = ch.choices?.find(c => this.state.storyFlags.includes(`choice:${id}:${c.key}`))?.key ?? null;
    this.closeSheets();
    this.storyDialog.play({
      ...this.chapterOptions(id),
      replay: { choice },
      finish: () => ({ lines: [], gains: {}, joined: null }),
      onDone: () => this.journal.show(this.state),
    });
  }

  /** The team on the surface radios home with a decision. */
  private showMissionChoice(m: ActiveMission): void {
    const ev = m.event ? expeditionEvent(m.event.id) : undefined;
    if (!ev) return;
    if (ev.id === 'storm') this.audio.play('thunder');
    const locale = i18n.currentLocale;
    const hex = this.engine.explorationSystem.getHex(this.state, m.hexX, m.hexY);
    const body = el('div', 'modal-result exp-choice');
    const art = biomeImage(hex?.biome);
    if (art) body.appendChild(art);
    const team = m.survivorIds.map(id => this.state.survivors.find(s => s.id === id)).filter((s): s is SurvivorState => !!s);
    const faces = el('div', 'exp-team');
    for (const s of team) {
      const img = el('img', 'worker-face');
      img.src = portraitUrl(portraitFor(s));
      img.alt = '';
      faces.appendChild(img);
    }
    body.append(faces, el('p', 'modal-sub', `[[signal]] ${i18n.t('exp.radio', { place: hex ? BIOMES[hex.biome as BiomeId].name[locale] : '' })}`), el('p', 'modal-body', ev.text[locale]));
    const hints = (o: typeof ev.options[number]) => {
      const parts: string[] = [];
      if ((o.lootMult ?? 1) > 1 || o.loot) parts.push(`[[backpack]] ${i18n.t('exp.moreLoot')}`);
      if ((o.lootMult ?? 1) < 1) parts.push(`[[backpack]] ${i18n.t('exp.lessLoot')}`);
      if (o.injury) parts.push(`[[bandage]] ${i18n.t('exp.risk')}`);
      if ((o.timeMult ?? 1) > 1) parts.push(`[[clock]] ${i18n.t('exp.slower')}`);
      if ((o.timeMult ?? 1) < 1) parts.push(`[[clock]] ${i18n.t('exp.faster')}`);
      if (o.recruit) parts.push(`[[person]] ${i18n.t('exp.maybeRecruit')}`);
      if (o.reveal) parts.push(`[[map]] ${i18n.t('exp.reveal')}`);
      return parts.length ? el('span', 'exp-hints', parts.join('  ')) : undefined;
    };
    this.modal.show({
      icon: `[[${ev.icon}]]`,
      title: ev.title[locale],
      body,
      actions: ev.options.map((o, i) => ({
        label: o.label[locale],
        className: i === 0 ? 'btn-secondary' : 'btn-primary',
        detail: hints(o),
        onClick: () => {
          this.engine.explorationSystem.choose(m.id, o.key);
          this.audio.play('choice');
          this.engine.requestSave();
          this.modal.hide();
          this.toasts.show(`[[chat]] ${o.result[locale]}`, 'info');
        },
      })),
    });
  }

  private showMissionReport(report: MissionReport): void {
    const locale = i18n.currentLocale;
    const hex = this.engine.explorationSystem.getHex(this.state, report.hexX, report.hexY);
    const biome = hex ? BIOMES[hex.biome as BiomeId].name[locale] : '';
    const body = el('div', 'modal-result');
    const art = biomeImage(report.biome ?? hex?.biome);
    if (art) body.appendChild(art);
    if (report.success) setTimeout(() => this.audio.play('cheer', { volume: 0.8 }), 300);
    if (report.firstVisit) setTimeout(() => this.audio.play('reveal'), 900);
    body.appendChild(el('p', 'modal-body', i18n.t(report.success ? 'mission.success' : 'mission.failure', { place: biome })));
    if (report.poi) {
      const poi = POIS[report.poi];
      body.appendChild(el('p', 'modal-sub', `${poi.icon} ${i18n.t('mission.foundPoi', { name: poi.name[locale] ?? poi.name.en })}`));
    }
    body.appendChild(this.gainsList(report.loot));
    if (report.recruitName) {
      body.appendChild(el('p', 'modal-sub positive-text', `[[person]] ${i18n.t('mission.recruit', { name: this.localName(report.recruitName) })}`));
    }
    for (const inj of report.injuries) {
      body.appendChild(el('p', 'modal-sub negative-text', `[[bandage]] ${i18n.t('mission.injury', { name: this.localName(inj.name), n: inj.damage })}`));
    }
    if (report.journal?.length) {
      const details = el('details', 'exp-log');
      details.appendChild(el('summary', '', `[[journal]] ${i18n.t('exp.log')}`));
      details.appendChild(journalTimeline(report.journal, biome, (n: string) => this.localName(n)));
      body.appendChild(details);
    }
    this.modal.show({
      icon: report.success ? '[[backpack]]' : '[[bandage]]',
      title: i18n.t('mission.title'),
      body,
      actions: [{
        label: i18n.t('event.ok'),
        onClick: () => {
          this.engine.explorationSystem.dismissReport();
          this.engine.requestSave();
          this.modal.hide();
        },
      }],
    });
  }

  private eventParams(data: Record<string, unknown>): Record<string, string> {
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === 'string') params[k] = k.startsWith('name') ? this.localName(v) : v;
      else if (typeof v === 'number') params[k] = String(v);
    }
    return params;
  }

  private gainsList(gains: Partial<Record<ResourceType, number>>): HTMLElement {
    const list = el('div', 'gains-list');
    for (const [r, v] of Object.entries(gains) as [ResourceType, number][]) {
      if (!v) continue;
      list.appendChild(el('span', `gain-chip ${v > 0 ? 'positive' : 'negative'}`, `${RESOURCE_ICONS[r] ?? ''} ${v > 0 ? '+' : '−'}${Math.abs(Math.round(v))}`));
    }
    return list;
  }

  /**
   * Welcome back (S6): what was made, what overflowed full storage, who came home, what research finished,
   * and the people waiting at the door, whose answer is the first thing the player does this session.
   */
  private showWelcome(report: OfflineReport | null): void {
    this.welcomeOpen = true;
    this.audio.play('event');
    const state = this.state;
    const locale = i18n.currentLocale;
    const body = el('div', 'modal-result');
    if (report) {
      body.appendChild(el('p', 'modal-body', i18n.t('welcome.away', { time: i18n.formatDuration(report.seconds) })));
      if (Object.keys(report.gained).length > 0) {
        body.appendChild(el('p', 'modal-sub', i18n.t('welcome.produced')));
        body.appendChild(this.gainsList(report.gained));
      }
      // [Economy A1/A3] Overflow became credits (and fed the active project) instead of being lost.
      const converted = report.converted ?? {};
      if ((report.credits ?? 0) > 0 || Object.keys(report.absorbed ?? {}).length > 0) {
        if (report.credits > 0) {
          body.appendChild(el('p', 'modal-sub', `[[storage]] ${i18n.t('welcome.converted', { credits: report.credits })}`));
          body.appendChild(this.gainsList(converted));
        }
        if (Object.keys(report.absorbed ?? {}).length > 0) {
          body.appendChild(el('p', 'modal-sub', i18n.t('welcome.absorbed')));
          body.appendChild(this.gainsList(report.absorbed));
        }
        body.appendChild(el('p', 'bp-hint', i18n.t('welcome.convertedHint')));
      }
      const wasted = report.wasted ?? {};
      if (Object.keys(wasted).length > 0) {
        body.appendChild(el('p', 'modal-sub negative-text', `[[storage]] ${i18n.t('welcome.wasted')}`));
        body.appendChild(this.gainsList(Object.fromEntries(Object.entries(wasted).map(([r, v]) => [r, -(v ?? 0)]))));
        body.appendChild(el('p', 'bp-hint', i18n.t('welcome.wastedHint')));
      }
      if (report.missions > 0) body.appendChild(el('p', 'modal-sub', `[[backpack]] ${i18n.t('welcome.missions', { n: report.missions })}`));
      if (report.research?.length) {
        const names = report.research.map(id => (getResearch(id) ?? this.engine.researchSystem.defOf(state, id))?.name[locale] ?? id).join(', ');
        body.appendChild(el('p', 'modal-sub', `[[research]] ${i18n.t('welcome.research', { names })}`));
      }
      // [Danger C4] the soft version of what struck while away
      const dg = report.danger;
      if (dg && (dg.raids > 0 || dg.disasters.length > 0)) {
        const parts: string[] = [];
        if (dg.raids > 0) parts.push(i18n.t('welcome.danger.raids', { n: dg.raids, lost: dg.raidsLost }));
        if (dg.disasters.length > 0) parts.push(i18n.t('welcome.danger.disasters', { n: dg.disasters.length }));
        if (dg.hurt > 0) parts.push(i18n.t('welcome.danger.hurt', { n: dg.hurt }));
        body.appendChild(el('p', 'modal-sub negative-text', `[[warning]] ${i18n.t('welcome.danger.title')} ${parts.join(' · ')}`));
        if (dg.died.length > 0) body.appendChild(el('p', 'modal-sub negative-text', `[[skull]] ${i18n.t('welcome.danger.died', { names: dg.died.map(n => this.localName(n)).join(', ') })}`));
        else body.appendChild(el('p', 'bp-hint', i18n.t('welcome.danger.hint')));
      }
    }
    const waiting = state.doorWaiting ?? [];
    const close = () => {
      this.welcomeOpen = false;
      this.modal.hide();
    };
    if (waiting.length === 0) {
      const actions = [{ label: i18n.t('welcome.ok'), onClick: close }] as { label: string; className?: string; onClick: () => void }[];
      // [Economy A1] a shortcut to spend the credits the overflow earned.
      if ((report?.credits ?? 0) > 0) actions.unshift({ label: i18n.t('welcome.toShop'), className: 'btn-secondary', onClick: () => { close(); this.journal.showShop(this.state); } });
      this.modal.show({ icon: '[[vault]]', title: i18n.t('welcome.title'), body, actions });
      return;
    }
    // The doorstep: faces and names of who waited through the night.
    const door = el('div', 'welcome-door');
    const row = el('div', 'modal-portraits');
    for (const p of waiting) {
      const img = el('img', 'modal-portrait');
      img.src = portraitUrl(portraitFor(p));
      img.alt = '';
      row.appendChild(img);
    }
    const names = waiting.map(p => this.localName(p.name)).join(', ');
    door.append(row, el('p', 'modal-body', `[[door]] ${i18n.t(waiting.length === 1 ? 'welcome.doorOne' : 'welcome.door', { n: waiting.length, names })}`));
    const beds = state.maxPopulation - state.survivors.length;
    if (beds < waiting.length) door.appendChild(el('p', 'bp-hint negative-text', i18n.t('welcome.doorBeds', { n: Math.max(0, beds) })));
    body.appendChild(door);
    const answer = (accept: boolean) => {
      const n = this.engine.answerDoor(accept);
      close();
      this.audio.play(accept && n > 0 ? 'cheer' : 'click');
      this.toasts.show(accept && n > 0 ? `[[people]] ${i18n.t('welcome.doorIn', { n })}` : `[[door]] ${i18n.t('welcome.doorAway')}`, accept && n > 0 ? 'good' : 'info');
    };
    this.modal.show({
      icon: '[[door]]',
      title: i18n.t('welcome.title'),
      body,
      actions: [
        { label: i18n.t('welcome.doorAccept'), className: 'btn-primary', disabled: beds <= 0, onClick: () => answer(true) },
        { label: i18n.t('welcome.doorRefuse'), className: 'btn-secondary', onClick: () => answer(false) },
      ],
    });
  }

  /** The daily supply drop: open today's crate (NICE3). */
  private openSupplyDrop(): void {
    const claim = this.engine.supplySystem.claim();
    if (!claim) return;
    this.engine.requestSave();
    this.audio.play('achievement');
    const body = el('div', 'modal-result');
    body.appendChild(el('p', 'modal-body', i18n.t('supply.desc')));
    body.appendChild(this.gainsList(claim.gains));
    body.appendChild(el('p', 'modal-sub', `[[hourglass]] ${i18n.t('rush.gift', { n: claim.rush })}`));
    if (Object.keys(claim.gains).length === 0) body.appendChild(el('p', 'bp-hint', i18n.t('supply.full')));
    body.appendChild(el('p', 'modal-sub', `[[fire]] ${i18n.t('supply.streak', { n: claim.streak })}`));
    body.appendChild(el('p', 'bp-hint', i18n.t('supply.tomorrow')));
    this.modal.show({ icon: '[[gift]]', title: i18n.t('supply.title'), body, actions: [{ label: i18n.t('event.ok'), onClick: () => this.modal.hide() }] });
  }
}
