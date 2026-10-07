import { VIEW } from './rendering/perfFx'; // [perf]
import { floorTag } from './ui/floorTag'; // plan4:ST-16
import { GameEngine, type OfflineReport } from './core/GameEngine';
import { ProjectsPanel } from './ui/components/ProjectsPanel'; // [LateGame B1]
import { PROJECTS, projectDone, stagesDone } from './data/projects'; // [LateGame B1]
import type { SiteInfo } from './rendering/projectSites'; // [LateGame B1]
import { CouponPanel, couponValid } from './ui/components/CouponPanel';
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
import { DepthRuler } from './ui/components/DepthRuler'; // [plan4:ST-12]
import { AudioEngine } from './audio/AudioEngine';
import { setUiSound } from './audio/uiSound';
import { timeOfDay } from './ui/HUD';
import { i18n } from './i18n/I18nManager';
import { bus } from './core/EventBus';
import { getDef } from './data/buildingDefs';
import { RESEARCH } from './data/research';
import { RESOURCE_ICONS, el } from './ui/dom';
import { isBuildingUnlocked } from './systems/ResearchSystem';
import type { BuildingType, GameState, Position, ResourceType, SurvivorState } from './core/GameState';
import { preloadIcons } from './rendering/richText';
import { ArtLibrary } from './art/ArtLibrary';
import { buildingArtKey, roomTier } from './art/registry';
import type { IconName } from './ui/icons';
import { RuinPanel } from './ui/components/RuinPanel';
import { ResourceSheet } from './ui/components/ResourceSheet';
import { JournalPanel, LoreReader } from './ui/components/JournalPanel';
import { EraPanel } from './ui/components/EraPanel';
import { HelpPanel } from './ui/components/HelpPanel';
import { ChroniclePanel } from './ui/components/ChroniclePanel';
import { Sheet } from './ui/components/Sheet';
import { eraOf } from './data/eras';
import { actOf } from './data/acts';
import type { ObjectiveAction } from './systems/ObjectiveSystem';
import { actFraction } from './systems/Guide';
import { genderOf, genderOfName } from './data/portraits';
import { ensurePersistentStorage, getPersistStatus } from './core/SaveManager';
import { claimOwnership, onSuperseded } from './core/singleInstance';
import { currentTextSize, cycleTextSize } from './ui/textSize';
import { getA11y, hydrateA11y, subscribeA11y } from './utils/a11y';
import { showCaption } from './ui/a11yDom';
import { StructurePanel } from './ui/components/StructurePanel'; // [plan4:AC-11]
import { KeyboardShortcuts } from './ui/controllers/keyboard'; // [plan4:AC-10]
import { setSoundChip } from './ui/soundChip';
import { hideSplash } from './ui/splash';
import { StoryDialog } from './ui/components/StoryDialog';
import { DISASTERS } from './data/incidents';
import { Notifier, type NotifyItem } from './ui/notifications';
import { arrivalGap, type RaidResult } from './systems/EventSystem';
import { DialogQueue, type DialogSource } from './ui/dialogQueue'; // [plan4:UX-10]
import { getChapter } from './data/story';
import { districtDef } from './data/districts';
import { haptic } from './utils/haptics'; // [plan4:UX-20]
import './style.css';
import './styles/story.css';
import './styles/bunker-os.css';
import './styles/depth.css';
import './styles/command.css';
import './styles/buildmenu.css'; // [plan4:BL-39] before touch.css so its 44px rules still win
import './styles/checkin.css'; // [plan4:Gameplay] dialog queue card, gesture tips, check-in screen
import './styles/daily.css'; // [plan4:GP-1] daily orders
import './styles/touch.css'; // [plan4:UX-5] last again (its header says so): its 44px targets must beat the older sheet-help sizes in command.css
import './styles/placement.css'; // [plan4:ST-19] the confirm bar and the chips over the ghost room
import './styles/a11y.css'; // [plan4:AC-2] the accessibility layer, last of all: reduced motion, colour modes, focus rings
import { FeedbackController } from './ui/controllers/feedback';
import { InboxController } from './ui/controllers/inbox';
import { SaveController } from './ui/controllers/saves';
import { LoreController } from './ui/controllers/lore';
import { DigController } from './ui/controllers/dig';
import { DangerController } from './ui/controllers/danger';
import { EventController } from './ui/controllers/events';
import { StoryController } from './ui/controllers/story';
import { SystemsController } from './ui/controllers/systems';
import { WhatsNewController } from './ui/controllers/whatsnew'; // [plan4:ST-9]
import { WelcomeController } from './ui/controllers/welcome';
import { TipsController } from './ui/controllers/tips'; // [plan4:UX-11]
import { PRODUCTION_POPUP_MS, WorldController } from './ui/controllers/world';
import { DailyController } from './ui/controllers/daily'; // [plan4:GP-1]

/** Icons drawn inside the Pixi scene (plaques, signs, popups); rasterized once at startup. */
const SCENE_ICONS: IconName[] = [
  'food', 'water', 'power', 'materials', 'medicine', 'knowledge', 'scrap', 'blueprints', 'isotope7',
  'star', 'check', 'close', 'pick', 'vault', 'quarters', 'farm', 'settings', 'heart', 'happy', 'sad', 'warning',
];

const PANEL_REFRESH_MS = 250;
const BUBBLE_CHECK_MS = 9000;



export class GameApp {
  // Controllers: each owns one part of the game screen's behaviour (src/ui/controllers/).
  readonly feedback = new FeedbackController(this);
  readonly inbox = new InboxController(this);
  /** [Long game UX] Opened by tapping a resource in the HUD. */
  resourceSheet!: ResourceSheet;
  readonly saves = new SaveController(this);
  readonly lore = new LoreController(this);
  readonly dig = new DigController(this);
  readonly danger = new DangerController(this);
  readonly events = new EventController(this);
  readonly story = new StoryController(this);
  readonly welcome = new WelcomeController(this);
  /** [plan4:GP-1] Daily orders: HUD chip, sheet, day chest. */
  readonly daily = new DailyController(this);
  /** [plan4:UX-11] Gesture tips. */
  readonly tips = new TipsController(this);
  readonly world = new WorldController(this);
  /** [Q7] "A new system" cards. */
  readonly systems = new SystemsController(this);
  /** [plan4:ST-9] The one-time "the bunker can grow sideways" card for saves from v6. */
  readonly whatsNew = new WhatsNewController(this);
  engine: GameEngine;
  renderer: BunkerRenderer;
  hud: HUD;
  private buildMenu: BuildMenu;
  buildingPanel: BuildingPanel;
  private peoplePanel: PeoplePanel;
  private researchPanel: ResearchPanel;
  private structurePanel!: StructurePanel; // [plan4:AC-11] the list view
  private surfacePanel: SurfacePanel;
  menuPanel: MenuPanel;
  modal: Modal;
  toasts: Toasts;
  audio: AudioEngine;
  popups!: NumberPopupManager;
  ruler!: DepthRuler;
  private ruinPanel: RuinPanel;
  journal = new JournalPanel();
  loreReader = new LoreReader();
  private eraPanel = new EraPanel();
  private helpPanel = new HelpPanel(); // [Q6]
  private chroniclePanel = new ChroniclePanel(); // [Q14]
  private projectsPanel: ProjectsPanel; // [LateGame B1]
  private couponPanel: CouponPanel;
  introPlaying = false;
  private gradedEra = -1;
  /** Districts that broke through and still await their "discovered" dialog. */
  districtFoundQueue: string[] = [];
  storyOpen = false;
  storyDialog = new StoryDialog();
  pendingChapter: string | null = null;
  /** [Danger] a fresh warning opens its decision window once; a raid result waits for a free moment. */
  dangerPrompt = false;
  raidResult: RaidResult | null = null;
  private notifier = new Notifier();

  placementMode: BuildingType | null = null;
  private lastPanelRefresh = 0;
  private lastProductionPopup = 0;
  private lastBubbleCheck = 0;
  welcomeOpen = false;
  /** [plan4:UX-10] A welcome-back report waiting for the gate (the report, or null for people only at the door). */
  pendingWelcome: { report: OfflineReport | null } | null = null;
  /** [plan4:UX-10] Every auto-opening dialog is a source in this queue; dialogGate decides when one may land. */
  dialogs!: DialogQueue;
  private lastDialogCheck = 0;
  /** [plan4:UX-10] Pointers that are down right now (id -> last event time) and the time of the last touch gesture. */
  private pointersDown = new Map<number, number>();
  private lastGestureAt = -Infinity;
  /** [plan4:UX-10] A ceremony (GP-2) holds every dialog back until this time (performance.now() ms). */
  ceremonyUntil = 0;
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
    // [plan4:UX-1] "tap to enable sound" chip while the context is suspended/interrupted; [plan4:AC-1] audio and the save follow the a11y source.
    this.audio.onBlockedChange = setSoundChip;
    this.audio.setPlayInSilent(getA11y().playInSilent);
    subscribeA11y(a => {
      this.audio.setPlayInSilent(a.playInSilent);
      if (this.engine.stateManager.state) this.state.settings.a11y = { ...a }; // mirrored into the save (device preference stays primary)
    });
    this.buildMenu = new BuildMenu(this.engine.resourceSystem, this.engine.buildingSystem);
    this.buildingPanel = new BuildingPanel(this.engine);
    this.peoplePanel = new PeoplePanel(this.engine);
    this.researchPanel = new ResearchPanel(this.engine);
    this.structurePanel = new StructurePanel(() => this.state);
    this.structurePanel.onOpenRoom = id => {
      const room = this.renderer.roomRect(id);
      this.closeSheets();
      if (room) this.renderer.focusOn(room.x + room.w / 2, room.y + 50, 1.6);
      this.renderer.setSelected(id);
      this.buildingPanel.show(id);
    };
    this.surfacePanel = new SurfacePanel(this.engine);
    this.projectsPanel = new ProjectsPanel(this.engine); // [LateGame B1]
    this.couponPanel = new CouponPanel(this.engine, (text, good) => this.toasts.show(text, good ? 'good' : 'bad'));
    this.menuPanel = new MenuPanel(this.engine, {
      toggleLanguage: () => void this.toggleLanguage(),
      openStructure: () => this.toggleStructure(),
      toggleSound: () => this.audio.toggle(),
      isSoundOn: () => this.audio.isOn,
      newGame: () => this.saves.confirmNewGame(),
      rebirth: () => this.saves.confirmRebirth(),
      importSave: (raw) => void this.saves.importSave(raw),
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
      exportFile: () => this.saves.exportFile(),
      importFile: () => this.saves.importFile(),
      listBackups: () => this.engine.saveManager.listBackups(),
      restoreBackup: (kind) => this.saves.confirmRestore(kind),
      getLevels: () => this.audio.levels,
      setLevels: (music, fx) => this.audio.setLevels(music, fx),
      textSize: () => i18n.t(`settings.text.${currentTextSize()}`),
      cycleTextSize: () => { cycleTextSize(); },
      persistLabel: () => i18n.t(`settings.persist.${getPersistStatus()}`),
      openBook: () => this.helpPanel.show(),
      openChronicle: () => this.chroniclePanel.show(this.state),
      showTipsAgain: () => { this.tips.reset(); this.toasts.show(`[[hand]] ${i18n.t('settings.tipsReset')}`, 'good'); }, // [plan4:UX-11]
      replayIntro: () => { this.closeSheets(); this.story.replayIntro(); },
      redeemCoupon: (code: string) => { // the coupon sheet: pick how much to skip or add
        if (!couponValid(code)) return false;
        this.closeSheets();
        this.couponPanel.show();
        return true;
      },
    });
    this.ruinPanel = new RuinPanel(this.engine);
    this.resourceSheet = new ResourceSheet(this.engine);
    this.modal = new Modal();
    this.toasts = new Toasts();
    this.dialogs = new DialogQueue(this.dialogSources(), this.modal, c => this.dialogGate(c), () => this.engine.stateManager.state?.stats.totalPlayTime ?? 0);
  }

  async start(): Promise<void> {
    // This copy of the game owns the save from now on; an older copy that is still open will stop writing (see singleInstance.ts).
    claimOwnership();
    onSuperseded(() => this.saves.showSuperseded());
    const guard = installCrashGuard(() => this.diagnostics());
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    // [plan4:AC-8] The picture is not readable by a screen reader: say what it is and where the list view is (key L, Accessibility tab).
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-label', i18n.t('a11y.canvas'));
    canvas.setAttribute('aria-keyshortcuts', 'B P R L');
    canvas.setAttribute('aria-description', i18n.t('a11y.keys'));
    new KeyboardShortcuts(this).install();
    // [plan4:AC-9] Captions for the sounds that carry information (only when the player turned them on).
    const CAPTIONED = new Set(['warn', 'pulse', 'alarm', 'siren', 'door', 'thunder']);
    this.audio.onCue = name => { if (CAPTIONED.has(name)) showCaption(i18n.t(`caption.${name}`)); };
    await Promise.all([this.renderer.init(canvas), preloadIcons(SCENE_ICONS).catch(() => undefined)]);
    await this.engine.init();
    hydrateA11y(this.state.settings?.a11y); // [plan4:AC-1] a device with no preference of its own takes the save's
    this.state.settings.a11y = { ...getA11y() };
    // Decode the paintings of the rooms already built so the first frame shows art, not placeholders.
    // [perf] Only the rooms the first picture can show (the top of the bunker): the rest load when the camera comes near (renderRooms).
    const keys = this.state.buildings.filter(b => b.position.floor < 10).map(b => buildingArtKey(b.type, roomTier(b.level))).filter((k): k is string => !!k);
    await Promise.all([ArtLibrary.preload([...new Set([...keys, 'backdrops/rock'])]), ArtLibrary.loadMeta(), ArtLibrary.loadBalance()]).catch(() => undefined);

    this.popups = new NumberPopupManager(this.renderer.worldContainer);
    this.ruler = new DepthRuler(this.renderer); // [plan4:ST-12 #5]
    this.setupEventHandlers();

    this.engine.onRender = (dt, alpha) => this.frame(dt, alpha);

    // Debug handles: only in development, or on request (?debug), so the live game can't be poked from the console by accident.
    if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
      (window as unknown as Record<string, unknown>).__engine = this.engine;
      (window as unknown as Record<string, unknown>).__renderer = this.renderer;
      (window as unknown as Record<string, unknown>).__audio = this.audio;
      (window as unknown as Record<string, unknown>).__app = this; // [plan4:UX-10] tests poke dialogGate / the dialog queue

    }
    // [perf] ?perf shows the overlay, ?debug/?perf expose __perf2() and __perfFixture(); nothing loads otherwise.
    { const q = new URLSearchParams(location.search); if (import.meta.env.DEV || q.has('perf') || q.has('debug')) void import('./dev/perf').then(m => m.installPerf(this.renderer, this.engine, this.audio)); }
    if (import.meta.env.DEV) void import('./dev/storeShots').then(m => m.installStoreShots(this.renderer.app));
    if (import.meta.env.DEV) void import('./dev/camShots').then(m => m.installCamShots(this.renderer, () => this.state));
    if (import.meta.env.DEV) void import('./dev/structureDev').then(m => m.installStructureDev(this.renderer, () => this.state)); // plan4:ST-14

    this.engine.onRenderStuck = fails => this.recoverRender(fails);
    this.saves.watchSaving();
    // A save that could not be read, or one restored from a backup, is explained before the game moves a step.
    if (this.engine.loadProblem) await this.saves.resolveLoadProblem();
    else if (this.engine.recoveredFrom) await this.saves.noticeRecovered();
    // Back from a break, or people still waiting at the door from last time: the welcome screen comes first. [plan4:UX-10] It waits in the
    // dialog queue (top priority) so a gesture or placement under way is not interrupted; it is set before the loop starts, or the first
    // frame would open the door-only welcome without the report.
    if (this.state.storyFlags.includes('intro:done') && (this.engine.offlineReport || (this.state.doorWaiting?.length ?? 0) > 0)) this.pendingWelcome = { report: this.engine.offlineReport };
    this.engine.start();
    this.installBackNavigation();
    // Ask the browser to keep the save safe (it may clear site data when the phone runs low on space): after the first tap, and once more later.
    window.addEventListener('pointerdown', () => void ensurePersistentStorage(), { once: true });
    setTimeout(() => void ensurePersistentStorage(), 10 * 60_000);
    if (guard.liteJustEnabled) this.toasts.show(`[[sparkle]] ${i18n.t('toast.liteMode')}`, 'info');
    if (!this.state.storyFlags.includes('intro:done')) this.story.playIntroSequence();
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

  get state() {
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
      frames: this.renderer.postfx?.health ?? null, // [perf] p50/p95 time between pictures (60-fps units), share of janky ones, level changes
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

  private splashHidden = false;

  private frame(dt: number, alpha: number): void {
    const state = this.state;
    if (!this.splashHidden) {
      this.splashHidden = true;
      hideSplash();
    }
    // Each part is guarded on its own: a throwing panel must not stop the picture or the dialogs behind it.
    this.renderer.frameTarget = this.engine.frameTargetMs;
    const fps = this.renderer.postfx?.profile.fps;
    if (fps) this.engine.frameRates = fps;
    // [perf] 60 only while the camera moves; short animations keep the watching rate.
    const prof = this.renderer.postfx?.profile;
    if (prof) this.engine.motionFps = prof.motion;
    if (this.renderer.cameraMoving) this.engine.noteCameraMotion();
    this.engine.fxBusy = this.renderer.fxActive || this.popups.anyIn(VIEW.x0, VIEW.y0, VIEW.x1, VIEW.y1);
    try { this.renderer.render(state, dt, alpha); } catch (err) { logCrash('render', err); throw err; }
    this.guarded('hud', () => { this.hud.update(state); this.popups.zoom = this.renderer.cameraZoom; this.popups.update(); this.ruler.update(state); this.hud.setNavCurrent(this.buildMenu.isVisible ? 'build' : this.peoplePanel.isVisible ? 'people' : this.researchPanel.isVisible ? 'research' : this.surfacePanel.isVisible ? 'surface' : this.menuPanel.isVisible ? 'menu' : null); });
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
      if (this.structurePanel.isVisible) this.structurePanel.refresh(state);
      if (this.surfacePanel.isVisible) this.surfacePanel.refresh(state);
      if (this.menuPanel.isVisible) this.menuPanel.refresh(state);
      if (this.ruinPanel.isVisible) this.ruinPanel.refresh(state);
      if (this.journal.isVisible) this.journal.refresh(state);
      if (this.eraPanel.isVisible) this.eraPanel.refresh(state);
      if (this.chroniclePanel.isVisible) this.chroniclePanel.refresh(state);
      if (this.projectsPanel.isVisible) this.projectsPanel.refresh(state); // [LateGame B1]
      this.inbox.refresh(state);
      if (this.resourceSheet.isVisible) this.resourceSheet.refresh(state);
      this.renderer.setProjectSites(this.projectSites(state)); // [LateGame B1] lots on the surface
      this.updateBadges();
    }
    if (now - this.lastProductionPopup > PRODUCTION_POPUP_MS) {
      this.lastProductionPopup = now;
      this.world.spawnProductionPopups();
    }
    if (now - this.lastBubbleCheck > BUBBLE_CHECK_MS) {
      this.lastBubbleCheck = now;
      this.world.spawnBubbles();
    }
    this.renderer.setNight(timeOfDay(state.stats.totalPlayTime).night);
    // [plan4:UX-10] One dialog at a time, never into a gesture: the sources and their priorities are in dialogSources().
    if (!this.modal.isVisible && !this.welcomeOpen && !this.introPlaying && !this.storyOpen && !this.loreReader.isVisible && !this.storyDialog.isVisible
      && now - this.lastDialogCheck > 100) {
      this.lastDialogCheck = now;
      this.dialogs.update(now);
    }
    this.checkShortages();
  }

  /**
   * [plan4:UX-10] May an auto-opening dialog land right now? Not while a building is being placed, a finger is down (a camera drag,
   * a pinch, a carried survivor), a gesture ended less than 1.2 s ago, a ceremony is playing, or (for anything that is not an
   * emergency) a sheet is open under the player's hands. A sheet left open and untouched for 20 s no longer holds the dialogs back.
   */
  dialogGate(critical = false): boolean {
    const now = performance.now();
    if (this.placementMode) return false;
    for (const [id, t] of this.pointersDown) if (now - t > 12000) this.pointersDown.delete(id); // a lost pointerup must not block forever
    if (this.pointersDown.size > 0) return false;
    if (now - this.lastGestureAt < 1200) return false;
    if (this.ceremonyActive(now)) return false;
    if (!critical && this.anyPanelOpen() && now - this.lastGestureAt < 20000) return false;
    return true;
  }

  /** [plan4:UX-10] A ceremony is on screen: a timed one (ceremonyUntil, set by GP-2), or a full-screen era/act banner. */
  ceremonyActive(now = performance.now()): boolean {
    return now < this.ceremonyUntil || !!document.querySelector('.era-banner, .ceremony');
  }

  /** [plan4:UX-10] Keeps dialogs out of gestures; installed once. */
  private watchGestures(): void {
    const stamp = () => { this.lastGestureAt = performance.now(); };
    document.addEventListener('pointerdown', e => { this.pointersDown.set(e.pointerId, performance.now()); stamp(); }, { capture: true, passive: true });
    document.addEventListener('pointermove', e => { if (this.pointersDown.has(e.pointerId)) { this.pointersDown.set(e.pointerId, performance.now()); stamp(); } }, { capture: true, passive: true });
    const up = (e: PointerEvent) => { this.pointersDown.delete(e.pointerId); stamp(); };
    window.addEventListener('pointerup', up, { capture: true, passive: true });
    window.addEventListener('pointercancel', up, { capture: true, passive: true });
    window.addEventListener('blur', () => this.pointersDown.clear());
    document.addEventListener('wheel', stamp, { capture: true, passive: true });
    document.addEventListener('keydown', stamp, { capture: true, passive: true });
  }

  /** [plan4:UX-10] Every dialog that opens by itself, in the order of the old fixed chain (higher priority = first). */
  private dialogSources(): DialogSource[] {
    const st = () => this.state;
    const memorialN = () => st().danger?.memorialQueue?.length ?? 0;
    const asking = () => this.engine.explorationSystem.waitingMission();
    // [Long game] After the first era events, questions and reports wait in the Decision Inbox; emergencies and the story still open by themselves.
    return [
      {
        id: 'welcome', priority: 100, snoozeMs: 60_000, critical: true, icon: '[[door]]',
        ready: () => !!this.pendingWelcome || (st().doorWaiting?.length ?? 0) > 0,
        open: () => { const p = this.pendingWelcome; this.pendingWelcome = null; this.welcome.showWelcome(p ? p.report : null); },
        label: () => i18n.t('welcome.title'),
      },
      {
        id: 'memorial', priority: 90, snoozeMs: 60_000, critical: true, icon: '[[heart]]',
        ready: () => memorialN() > 0,
        open: () => this.danger.showMemorial(), // [Danger C5]
        label: () => i18n.t('dq.memorial'),
      },
      {
        id: 'raidResult', priority: 80, snoozeMs: 60_000, critical: true, icon: '[[warning]]',
        ready: () => !!this.raidResult,
        open: () => { const r = this.raidResult!; this.raidResult = null; this.danger.showRaidResult(r); }, // [Danger C1]
        label: () => i18n.t('dq.raidResult'),
      },
      {
        id: 'danger', priority: 70, snoozeMs: 30_000, critical: true, icon: '[[warning]]',
        ready: () => this.dangerPrompt,
        open: () => { this.dangerPrompt = false; if (this.danger.dangerBanner()) this.danger.showDanger(); }, // [Danger C1/C2]
        label: () => i18n.t('dq.danger'),
      },
      {
        id: 'event', priority: 60, snoozeMs: 120_000, icon: '[[inbox]]',
        ready: () => this.inbox.autoOpenEvent(st()),
        open: () => this.events.showEvent(),
        label: () => { const ev = st().activeEvent; return ev ? i18n.t(`event.${ev.id}.title`, this.events.eventParams(ev.data)) : ''; },
      },
      {
        id: 'missionChoice', priority: 50, snoozeMs: 180_000, icon: '[[radioTower]]',
        ready: () => !!asking() && !this.inbox.defers(st()),
        open: () => { const m = asking(); if (m) this.events.showMissionChoice(m); },
        label: () => i18n.t('inbox.missionAsks'),
      },
      {
        id: 'missionReport', priority: 40, snoozeMs: 180_000, icon: '[[map]]',
        ready: () => st().missionReports.length > 0 && !this.inbox.defers(st()),
        open: () => this.events.showMissionReport(st().missionReports[0]),
        label: () => i18n.t(st().missionReports[0]?.success ? 'inbox.reportOk' : 'inbox.reportBad'),
      },
      {
        id: 'chapter', priority: 30, snoozeMs: 240_000, icon: '[[books]]',
        ready: () => !!this.pendingChapter,
        open: () => this.story.playChapter(this.pendingChapter!),
        label: () => { const c = this.pendingChapter ? getChapter(this.pendingChapter) : undefined; return c ? c.title[i18n.currentLocale] : i18n.t('dq.chapter'); },
      },
      {
        id: 'system', priority: 20, snoozeMs: 300_000, icon: '[[sparkle]]',
        ready: () => this.systems.hasDue(st()),
        open: () => this.systems.update(st()),
        label: () => this.systems.dueTitle(st()),
      },
      {
        id: 'lore', priority: 15, snoozeMs: 300_000, icon: '[[note]]',
        ready: () => this.lore.hasQueued,
        open: () => this.lore.flushLoreQueue(),
        label: () => i18n.t('journal.found'),
      },
      {
        id: 'whatsNew', priority: 5, snoozeMs: 600_000, icon: '[[build]]', // [plan4:ST-9] last in line: every other dialog goes first
        ready: () => this.whatsNew.hasDue(st()),
        open: () => this.whatsNew.open(st()),
        label: () => this.whatsNew.label(),
      },
      {
        id: 'district', priority: 10, snoozeMs: 300_000, icon: '[[pick]]',
        ready: () => this.districtFoundQueue.length > 0,
        open: () => this.dig.showDistrictFound(this.districtFoundQueue.shift()!),
        label: () => { const d = districtDef(this.districtFoundQueue[0] ?? ''); return d ? i18n.t('district.found', { name: d.name[i18n.currentLocale] }) : ''; },
      },
    ];
  }

  /** [LateGame B1] What stands on each project's lot: started or finished projects, and the active one even before its first stage. */
  private projectSites(state: GameState): SiteInfo[] {
    const ps = this.engine.projectSystem;
    const out: SiteInfo[] = [];
    for (const def of PROJECTS) {
      const n = def.stages.length;
      const done = stagesDone(state, def.id);
      const active = state.activeProjectId === def.id;
      if (projectDone(state, def.id)) {
        out.push({ id: def.id, frac: 1, building: false, label: '' });
        continue;
      }
      if (!active && done === 0) continue;
      const part = active ? (ps.paidFraction(state, def.id) + ps.workFraction(state, def.id)) / 2 : 0;
      const frac = (done + part) / n;
      out.push({ id: def.id, frac, building: true, label: `${def.name[i18n.currentLocale]} · ${done + 1}/${n}` });
    }
    return out;
  }

  private updateBadges(): void {
    const state = this.state;
    const rs = this.engine.researchSystem;
    const canResearch = !rs.activeId(state) && RESEARCH.some(r => rs.canStart(state, r.id));
    this.hud.setBadge('research', canResearch ? '!' : null);
    const missions = state.activeMissions.length;
    this.hud.setBadge('surface', missions > 0 ? String(missions) : null);

    this.dig.updateDigSign();
    this.updateAudio();
    const era = eraOf(state);
    this.updateEraChip(era);
    if (document.body.dataset.era !== era.key) document.body.dataset.era = era.key;
    if (era.id !== this.gradedEra) {
      this.renderer.setEra(era, this.gradedEra < 0);
      this.gradedEra = era.id;
    }
    this.hud.setJournalUnread(state.loreUnread?.length ?? 0);
    this.hud.setSupply(this.engine.supplySystem.isReady(state), i18n.t('supply.title'));
    this.daily.refresh(state); // [plan4:GP-1]
    this.danger.updateIncidentBanner();
    // [plan4:UX-11] The gesture tips (pinch, double tap, hold a survivor, wings), once each; the old drag toast is the "hold" tip now.
    this.tips.update(performance.now());
    const obj = this.engine.objectiveSystem.current(state);
    const reward = (Object.entries(obj.reward) as [ResourceType, number][]).map(([r, v]) => `${RESOURCE_ICONS[r] ?? ''}${v}`).join(' ');
    this.hud.setObjective(obj.icon, obj.text[i18n.currentLocale] ?? obj.text.en, obj.progress(state), reward);
  }

  /** [Q2] The chip: the Act and how far through it, with the era as the quieter second half. */
  private updateEraChip(era: ReturnType<typeof eraOf>): void {
    const state = this.state;
    const eraName = era.name[i18n.currentLocale];
    if (!state.longGame || state.longGame.meta.legacy) {
      this.hud.setEra(era.key, eraName);
      return;
    }
    const act = actOf(state);
    const pct = Math.floor(Math.min(0.99, actFraction(this.engine, state, act)) * 100);
    const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][act.id - 1] ?? String(act.id);
    this.hud.setEra(era.key, eraName, `${roman}·${pct}%`, `${act.name[i18n.currentLocale]} · ${pct}% · ${eraName}`);
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

  private onObjectiveTap(): void {
    this.audio.play('click');
    this.runAction(this.engine.objectiveSystem.current(this.state).action);
  }

  /** [plan4:ST-9] Opens the Command panel and draws the eye to its wing line. */
  showWingLine(): void {
    this.closeSheets();
    this.eraPanel.show(this.state);
    this.eraPanel.revealWings();
  }

  /** [Q2] Takes the player to where an objective or a guide step is dealt with. */
  runAction(action: ObjectiveAction): void {
    const state = this.state;
    this.closeSheets();
    if (!action) return;
    if (action.kind === 'build') {
      const cost = this.engine.buildingSystem.getBuildCost(action.type, state);
      if (isBuildingUnlocked(state, action.type) && this.engine.resourceSystem.canAfford(state, cost)) this.world.startPlacement(action.type);
      else this.buildMenu.show(state);
    } else if (action.kind === 'ruin') {
      const target = state.ruins.find(r => (action.restoresTo && r.restoresTo === action.restoresTo)
        || (action.ruinKind && r.kind === action.ruinKind && !this.engine.restorationSystem.blockReason(state, r))
        || (action.lore && r.lore === action.lore))
        ?? (action.ruinKind ? state.ruins.find(r => r.kind === action.ruinKind) : undefined);
      if (target) this.openRuin(target.id, true);
      else if (action.restoresTo) this.buildMenu.show(state);
    } else if (action.kind === 'projects') this.projectsPanel.show();
    else if (action.kind === 'dig') this.dig.confirmDig();
    else if (action.kind === 'command') this.eraPanel.show(state);
    else if (action.kind === 'genesis') this.menuPanel.show('genesis');
    else if (action.kind === 'daily') this.daily.show(); // [plan4:GP-1]
    else if (action.kind === 'ruins') {
      const rs = this.engine.restorationSystem;
      const target = state.ruins.find(r => r.started) ?? state.ruins.find(r => rs.canStart(state, r)) ?? state.ruins[0];
      if (target) this.openRuin(target.id, true);
    } else if (action.kind === 'rooms') this.focusUpgradeCandidate();
    else if (action.kind === 'journal') this.journal.show(state);
    else if (action.kind === 'people') this.peoplePanel.show();
    else if (action.kind === 'research') this.researchPanel.show();
    else this.surfacePanel.show();
  }

  /** Opens the Bunker Book at an entry (used by the "new system" cards). */
  openBook(topic?: string): void {
    this.closeSheets();
    this.helpPanel.show(topic);
  }

  /** The room most worth upgrading next (cheapest that the Act allows), opened for the player; the build menu when nothing qualifies. */
  private focusUpgradeCandidate(): void {
    const state = this.state;
    const bs = this.engine.buildingSystem;
    const total = (b: (typeof state.buildings)[number]) => Object.values(bs.getUpgradeCost(b)).reduce((s, v) => s + v, 0);
    const pick = state.buildings
      .filter(b => !b.isConstructing && bs.canUpgrade(b, state))
      .sort((a, b) => b.level - a.level || total(a) - total(b))[0];
    if (!pick) { this.buildMenu.show(state); return; }
    const r = this.renderer.roomRect(pick.id);
    if (r) this.renderer.focusOn(r.x + r.w / 2, r.y + 50, 1.6);
    this.renderer.setSelected(pick.id);
    this.buildingPanel.show(pick.id);
  }

  openRuin(ruinId: string, focus = false): void {
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

  private checkShortages(): void {
    const state = this.state;
    // Early warning while there is still time to react.
    for (const r of ['food', 'water', 'power'] as ResourceType[]) {
      const res = state.resources[r];
      const falling = res.productionRate < res.consumptionRate;
      if (falling && res.amount > 0 && res.amount < res.cap * 0.1 && !this.lowWarned.has(r)) {
        this.lowWarned.add(r);
        this.audio.play('warn');
        // [plan4:AC-9] The sound has a visual twin: a toast and a blink of the resource plate.
        this.toasts.show(`[[warning]] ${i18n.t('shortage.low', { name: i18n.t(`resources.${r}`) })}`, 'bad');
        this.hud.alertResource(r);
      } else if (res.amount > res.cap * 0.25) this.lowWarned.delete(r);
    }
    for (const s of state.survivors) {
      if (s.health < 30 && !this.hurtWarned.has(s.id)) {
        this.hurtWarned.add(s.id);
        this.audio.play('pulse');
        this.toasts.show(`[[warning]] ${i18n.t('shortage.hurt', { name: s.name })}`, 'bad');
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
      this.world.cancelPlacement();
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

    // [Long game UX] The resource drawer: sources, sinks, time to full or empty, and why.
    this.hud.onResourceTap = (r: ResourceType) => {
      this.audio.play('click');
      this.closeSheets();
      this.resourceSheet.show(r, this.state);
    };

    // [Q6] The "?" plate on a sheet opens the Bunker Book above it.
    Sheet.onHelp = (topic) => { this.audio.play('click'); this.helpPanel.show(topic); };
    this.hud.onPlacementCancel = () => this.world.cancelPlacement();
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
    this.eraPanel.foreman = this.engine.foremanSystem; // [Long game]
    this.eraPanel.engine = this.engine;
    this.eraPanel.onGo = (action) => { this.audio.play('click'); this.runAction(action); };
    this.hud.onEra = () => {
      this.audio.play('click');
      const wasOpen = this.eraPanel.isVisible;
      this.closeSheets();
      if (!wasOpen) this.eraPanel.show(this.state);
    };
    this.hud.onSupply = () => this.welcome.openSupplyDrop();
    this.journal.onRead = (id: string) => this.lore.readLore(id);
    this.journal.onReplay = (id: string) => this.story.replayChapter(id);
    // [Economy A2] credits shop tab in the journal
    this.journal.shop = this.engine.shopSystem;
    this.journal.onBuy = (id) => {
      if (this.engine.shopSystem.buy(id)) {
        this.audio.play('achievement');
        this.engine.requestSave();
        this.journal.refresh(this.state);
      } else this.toasts.show(i18n.t('shop.cantBuy'), 'bad');
    };
    this.renderer.incidents.onTap = (id: string) => this.danger.tapIncident(id);
    this.buildingPanel.onIncidentTap = (id: string) => this.danger.tapIncident(id);
    this.buildingPanel.onQuickFix = (id: string) => this.danger.quickFixIncident(id);
    this.buildingPanel.onSpecialize = (bid: string, spec: string) => this.specialize(bid, spec);
    this.buildingPanel.onRetool = (bid: string, spec: string) => this.retool(bid, spec); // [Long game]
    this.hud.onIncident = () => {
      if (this.danger.dangerBanner()) { this.audio.play('click'); this.danger.showDanger(); return; } // [Danger]
      const inc = this.state.incidents?.[0];
      const r = inc ? this.renderer.roomRect(inc.buildingId) : null;
      if (!r) return;
      this.audio.play('click');
      this.closeSheets();
      this.renderer.focusOn(r.x + r.w / 2, r.y + 50, 1.6);
    };
    this.ruinPanel.onStart = (id: string) => this.startRuin(id);
    this.renderer.onProjectClick = () => { this.closeSheets(); this.projectsPanel.show(); }; // [LateGame B1] tap a lot on the surface
    this.renderer.onRuinClick = (ruinId: string) => {
      this.engine.notifyInteraction();
      if (this.placementMode) {
        const r = this.state.ruins.find(x => x.id === ruinId);
        if (r) this.world.ghostTap({ x: r.x, y: 0, floor: r.floor }); // [plan4:ST-19]
        return;
      }
      this.audio.play('click');
      this.openRuin(ruinId);
    };
    this.hud.onObjectiveTap = () => this.onObjectiveTap();
    this.renderer.onDigClick = () => this.dig.confirmDig();
    this.renderer.onWingDig = (floor, side) => { this.audio.play('click'); this.dig.confirmWingDig(floor, side); }; // [plan4:ST-3]
    this.renderer.onElevator = () => {
      if (this.renderer.zoomLevel !== 'far' && Math.random() < 0.6) this.audio.play('elevator', { volume: 0.35 });
    };
    this.renderer.onLodChange = (lod) => {
      this.audio.setZoom(lod);
      if (lod === 'far' || this.renderer.zoomLevel === 'far') this.audio.play('whoosh', { volume: 0.7 });
    };
    this.renderer.onDistrictDig = () => {
      this.audio.play('click');
      this.dig.confirmDistrictDig();
    };
    this.renderer.nameOf = (s: { name: string }) => this.localName(s.name);
    this.renderer.onBubbleTap = (id: string) => this.world.collectBubble(id);
    this.renderer.onPersonLift = () => haptic('impact'); // [plan4:UX-20] the lift; the drop's own impact is in WorldController.dropSurvivor
    this.renderer.onPersonHover = (sid, tid, sx, sy) => this.world.hoverPerson(sid, tid, sx, sy);
    this.renderer.onPersonDrop = (sid: string, target: string | null) => { this.tips.learned('hold'); this.world.dropSurvivor(sid, target); }; // [plan4:UX-11]
    this.renderer.onPersonTap = (sid: string) => {
      if (this.placementMode) {
        // [plan4:ST-19] While choosing a spot a tap on someone is a tap on the room they stand in (the ghost shows why it cannot go there), not the people panel.
        const room = this.state.buildings.find(b => b.id === this.state.survivors.find(s => s.id === sid)?.assignedBuildingId);
        if (room) this.world.ghostTap(room.position);
        return;
      }
      this.audio.play('click');
      this.closeSheets();
      this.peoplePanel.show(sid);
    };

    this.buildMenu.onSelectBuilding = (type: BuildingType) => {
      this.audio.play('click');
      this.world.startPlacement(type);
    };

    this.buildMenu.onOpenResearch = () => { // [plan4:BL-39] a locked room's "unlocked by" line opens the research panel
      this.closeSheets();
      this.researchPanel.show();
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

    this.buildingPanel.onMove = (id: string) => { this.world.beginRelocate(id); }; // [plan4:ST-19]
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

    // [plan4:ST-19] A tap on a slot no longer builds: it puts the ghost of the room there (Build on the bar confirms, WorldController.confirmPlacement).
    this.renderer.onTileClick = (pos: Position) => {
      this.engine.notifyInteraction();
      if (!this.placementMode) return;
      this.world.ghostTap(pos);
    };
    this.renderer.onBuildingLongPress = (id: string) => this.world.roomActions(id); // [plan4:ST-19] press and hold a room: Move

    this.renderer.onBuildingClick = (buildingId: string) => {
      this.engine.notifyInteraction();
      const building = this.state.buildings.find(b => b.id === buildingId);
      if (!building) return;
      if (this.placementMode) {
        this.world.ghostTap(building.position); // [plan4:ST-19] the ghost shows there why it cannot stand on a room
        return;
      }
      this.audio.play('click');
      this.tips.noteRoomTap(); // [plan4:UX-11]
      this.closeSheets();
      this.renderer.setSelected(buildingId);
      this.buildingPanel.show(buildingId);
    };

    this.feedback.install();
    this.inbox.install();
    this.daily.install(); // [plan4:GP-1]
    this.watchGestures(); // [plan4:UX-10]
    this.tips.install(); // [plan4:UX-11]

    bus.on('state:loaded', () => {
      this.closeSheets();
      this.surfacePanel.hide();
      this.world.cancelPlacement();
      this.renderer.resetScene();
    });

    bus.on('offline:processed', (report: unknown) => {
      if (this.engine.offlineReport === report) return;
      this.pendingWelcome = { report: report as OfflineReport }; // [plan4:UX-10] through the gate, like every auto dialog
    });

    // Any touch, drag, wheel or key counts: the picture draws at full speed while the player is handling the bunker.
    // Touching a sheet (scrolling the people list) does not: the bunker behind it stays at the calm rate so the list gets the phone's power.
    for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown'] as const) {
      document.addEventListener(type, (e) => {
        if (e.target instanceof Element && e.target.closest('.sheet')) return;
        this.engine.notifyInteraction();
      }, { passive: true });
    }
  }

  private async toggleLanguage(): Promise<void> {
    i18n.storeLocale(i18n.currentLocale === 'he' ? 'en' : 'he');
    await this.engine.forceSave();
    location.reload();
  }

  // ---- save protection: problems at start, a second open copy, failed writes ----

  // ---- the phone's back button ----

  anyPanelOpen(): boolean {
    return this.buildMenu.isVisible || this.buildingPanel.isVisible || this.peoplePanel.isVisible || this.researchPanel.isVisible
      || this.surfacePanel.isVisible || this.menuPanel.isVisible || this.ruinPanel.isVisible || this.journal.isVisible
      || this.eraPanel.isVisible || this.projectsPanel.isVisible || this.helpPanel.isVisible || this.chroniclePanel.isVisible || this.loreReader.isVisible || this.inbox.isVisible || this.resourceSheet.isVisible || this.daily.isVisible;
  }

  /**
   * Back closes the open panel instead of leaving the game (an accidental swipe used to throw the player out to the previous page).
   * With nothing open, the first press asks to press again; the second leaves.
   */
  private installBackNavigation(): void {
    let lastBack = 0;
    history.pushState({ lastbunker: 1 }, '');
    window.addEventListener('popstate', () => {
      if (this.modal.isVisible) {
        history.pushState({ lastbunker: 1 }, '');
        return;
      }
      if (this.placementMode) {
        this.world.cancelPlacement();
        history.pushState({ lastbunker: 1 }, '');
        return;
      }
      if (this.anyPanelOpen()) {
        this.closeSheets();
        this.surfacePanel.hide();
        this.loreReader.hide();
        history.pushState({ lastbunker: 1 }, '');
        return;
      }
      const now = Date.now();
      if (now - lastBack < 2500) {
        history.back();
        return;
      }
      lastBack = now;
      this.toasts.show(i18n.t('nav.backAgain'), 'info');
      history.pushState({ lastbunker: 1 }, '');
    });
  }

  localName(name: string): string {
    return this.engine.populationSystem.getLocalizedName({ name } as SurvivorState, i18n.currentLocale);
  }

  /** [plan4:AC-11] The list view of the bunker (key L, and the Accessibility tab). */
  toggleStructure(): void {
    const wasOpen = this.structurePanel.isVisible;
    this.closeSheets();
    if (!wasOpen) this.structurePanel.show();
  }

  closeSheets(): void {
    this.buildMenu.hide();
    this.buildingPanel.hide();
    this.peoplePanel.hide();
    this.researchPanel.hide();
    this.structurePanel.hide();
    this.menuPanel.hide();
    this.ruinPanel.hide();
    this.journal.hide();
    this.eraPanel.hide();
    this.helpPanel.hide();
    this.chroniclePanel.hide();
    this.projectsPanel.hide(); // [LateGame B1]
    this.couponPanel.hide();
    this.inbox.hide();
    this.resourceSheet.hide();
    this.daily.hide(); // [plan4:GP-1]
  }

  // ---- [Danger] raid warnings, disasters, memorials (LATEGAME-PLAN part C) ----

  roomName(buildingId: string): string {
    const b = this.state.buildings.find(x => x.id === buildingId);
    if (!b) return '';
    return `${getDef(b.type)?.name[i18n.currentLocale] ?? b.type} · ${floorTag(b.position.floor)}`; // plan4:ST-16
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

  /** [Long game] Refit a specialized room to another role. */
  private retool(buildingId: string, specId: string): void {
    const bs = this.engine.buildingSystem;
    if (!bs.canRetool(this.state, buildingId, specId) || !this.engine.resourceSystem.spend(this.engine.stateManager, bs.retoolCost())) {
      this.audio.play('error');
      this.toasts.show(i18n.t('toast.notEnough'), 'bad');
      return;
    }
    bs.retool(this.engine.stateManager, buildingId, specId);
    this.engine.requestSave();
    this.buildingPanel.refresh(this.state);
  }

  /** i18n gender parameter for a known survivor. */
  gOf(s: { name: string; portraitIndex: number; child?: boolean; portrait?: string } | undefined | null): Record<string, string> {
    return s ? { g: genderOf(s) } : {};
  }

  /** The same for someone known by name (and, for unisex names, by id or by who is in the bunker). */
  gByName(name: string, id?: string): Record<string, string> {
    const byId = id ? this.state.survivors.find(x => x.id === id) : undefined;
    const found = byId ?? this.state.survivors.find(x => x.name === name);
    if (found) return this.gOf(found);
    const g = genderOfName(name);
    return g ? { g } : {};
  }

}
