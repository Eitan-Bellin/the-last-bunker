import { normalize, renderLoop, renderOneShot, renderSegment, type Builder } from './dsp';
import type { Sfx } from './sfx';
import { AMBIENCE, AMBIENCE_SECONDS, type AmbienceKey } from './ambience';
import { ERA_BEDS, type BedKey } from './bedKeys';
import { isLiteMode } from '../core/crashGuard';
import { lazyChunk } from '../utils/lazy';

/**
 * Plan 4 wave 3 (perf): the effect, music-theme and era-bed recipes (audio/synth.ts, about 11 KB gzipped) are a chunk of their own.
 * It is requested at the first touch (the same moment the context is created, in `start()`), and fetched earlier when the page is idle
 * after start; nothing is composed before it has arrived.
 */
const loadSynth = lazyChunk(() => import('./synth'));
type Synth = typeof import('./synth');

export type ZoomMix = 'far' | 'mid' | 'close';

export type { Sfx } from './sfx';
export type MusicMood = 'shelter' | 'dark';

/** iPhone / iPad (iPadOS reports itself as a Mac with a touch screen). */
function isIOSDevice(): boolean {
  const ua = navigator.userAgent;
  return /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** WebKit grants audio activation on these (not on a touch's pointerdown), so all of them try to unlock until the context runs. */
const UNLOCK_EVENTS = ['pointerup', 'touchend', 'click', 'keydown'] as const;

const STORAGE_KEY = 'lastbunker_sound';
/** The player's music and effects levels (0..1, 1 = the mix as it was designed). A device preference, not part of the save. */
const VOLUME_KEY = 'lastbunker_vol';
const MUSIC_LEVEL = 0.5;
const SFX_LEVEL = 0.8;
const AMBIENCE_LEVEL = 0.55;
/** Long loops have little energy above 12 kHz, so they render at a lower rate (less work and memory). */
const LOOP_RATE = 32000;
const MUSIC_RATE = 24000;

/** One theme per era: Remnant, Restoration, Colony, Undercity. */
function eraThemes(s: Synth): { build: Builder; reverb: number }[] {
  return [
    { build: s.remnantTheme, reverb: 1.0 },
    { build: s.shelterTheme, reverb: 0.95 },
    { build: s.colonyTheme, reverb: 0.8 },
    { build: s.undercityTheme, reverb: 0.95 },
  ];
}

/** [ux-wp3] How many sounds the list had before rankUp/tick were added at its end: room and bed loops keep the seeds they always had. */
const SFX_SEED_COUNT = 60;

/** Target peaks keep UI ticks subtle and story moments big. */
const SFX_PEAK: Partial<Record<Sfx, number>> = {
  click: 0.3, open: 0.32, collect: 0.45, mission: 0.5, place: 0.6, build: 0.6, research: 0.55,
  complete: 0.6, levelup: 0.6, error: 0.45, event: 0.7, achievement: 0.75, door: 0.85, dig: 0.7,
  siren: 0.55, wind: 0.5, tape: 0.45, paper: 0.35, debris: 0.55, restore: 0.7, era: 0.85, lore: 0.6,
  fire: 0.45, splash: 0.4, powerDown: 0.55, skitter: 0.3, alarm: 0.5, extinguish: 0.4, fixed: 0.6,
  heart: 0.5, baby: 0.45, story: 0.6, radio: 0.35, choice: 0.4,
  tab: 0.22, switch: 0.3, whoosh: 0.35, modalOpen: 0.3, notify: 0.4, assign: 0.4, unassign: 0.32, coin: 0.4,
  unlock: 0.55, reveal: 0.4, depart: 0.5, elevator: 0.35, hiss: 0.35, type: 0.12, warn: 0.4, pulse: 0.45,
  thunder: 0.7, cheer: 0.45, steam: 0.35, engineStart: 0.6, powerUp: 0.5, drill: 0.5, crumble: 0.4, drip: 0.3,
  confirm: 0.45, cancel: 0.3,
  rankUp: 0.38, tick: 0.28, // [ux-wp3]
};

interface AmbienceVoice {
  gain: GainNode;
  pan: StereoPannerNode;
}

export interface AmbienceMix {
  key: AmbienceKey;
  level: number;
  pan: number;
}

/** A chain of freshly composed segments for one theme: it never plays the same 64 seconds twice. */
interface ThemeLane {
  era: number;
  gain: GainNode;
  nextStart: number;
  seed: number;
  sources: AudioBufferSourceNode[];
  timer: number;
  alive: boolean;
}

/**
 * Plays the synthesized soundtrack: everything is rendered offline (convolution reverb, dozens of
 * voices) and then scheduled cheaply. Music follows the era, darkens at night or in a crisis,
 * and gains a marching pulse while an expedition is out.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private ambBus: GainNode | null = null;
  private enabled: boolean;
  private sfx = new Map<Sfx, AudioBuffer>();
  /** The sound recipes, once fetched (see loadSynth above); the render jobs run only after it is set. */
  private synth: Synth | null = null;
  private synthLoad: Promise<void> | null = null;
  private ambience = new Map<AmbienceKey, AmbienceVoice>();
  private mood: MusicMood = 'shelter';
  private era = 0;
  private lane: ThemeLane | null = null;
  private darkGain: GainNode | null = null;
  private expeditionGain: GainNode | null = null;
  private expedition = false;
  private lastPlayed = new Map<Sfx, number>();
  /** [plan4:AC-9] Told of every cue asked for, even with the sound off: the app turns the important ones into on-screen captions. */
  onCue: ((name: Sfx) => void) | null = null;
  private seedCounter = 1000;
  // [perf] Synthesis is a queue of small jobs, run one at a time in idle moments, most urgent first (see enqueue).
  private jobs: { id: string; prio: number; run: () => Promise<void> }[] = [];
  private queued = new Set<string>();
  private pumping = false;
  /** The first sounds (interface effects, base ambience, the era's music) are there. */
  private ready = false;
  /** A device with little memory renders effects mono at 22 kHz and the loops at 16 kHz (about a third of the memory). */
  // [plan4:UX-1] Safari does not report deviceMemory at all: the old "?? 8" gave every iPhone the full ~610 MB of buffers. An iPhone
  // without the number is treated as a small device (lite audio) until the adaptive monitor says otherwise.
  private readonly light = isLiteMode() || ((navigator as unknown as { deviceMemory?: number }).deviceMemory ?? (isIOSDevice() ? 3 : 8)) <= 3;
  /** [plan4:UX-1] The context exists but is not running (autoplay block, a phone call, Siri): the HUD shows a "tap to enable sound" chip. */
  private blocked = false;
  /** Called when `blocked` changes; the app shows or hides the chip. */
  onBlockedChange: ((blocked: boolean) => void) | null = null;
  private unlockArmed = false;
  private playInSilent = false;
  private clickAfterUnlock = false;
  private beds = new Map<BedKey, GainNode>();
  private zoom: ZoomMix = 'mid';
  private musicLevel = MUSIC_LEVEL;
  private musicOut: GainNode | null = null;
  private fxOut: GainNode | null = null;
  private volumes = { music: 1, fx: 1 };

  constructor() {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      stored = null;
    }
    this.enabled = stored !== 'off';
    try {
      const v = JSON.parse(localStorage.getItem(VOLUME_KEY) ?? 'null') as { music?: number; fx?: number } | null;
      const ok = (n: unknown) => (typeof n === 'number' && n >= 0 && n <= 1 ? n : 1);
      if (v) this.volumes = { music: ok(v.music), fx: ok(v.fx) };
    } catch {
      // defaults
    }
    this.applyAudioSession();
    this.armUnlock();
    // Back from the background (app switcher, lock screen, a call): the system may have left the context suspended or "interrupted".
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else this.tryResume();
    });
    // bfcache restores and window focus do not always fire visibilitychange on iOS.
    window.addEventListener('pageshow', () => this.tryResume());
    window.addEventListener('focus', () => this.tryResume());
  }

  /**
   * [plan4:UX-1] 'ambient' follows the silent switch and mixes with the player's music; 'playback' ignores the switch.
   * Only iOS 17+ has navigator.audioSession, elsewhere this is a no-op.
   */
  private applyAudioSession(): void {
    try {
      const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
      if (session) session.type = this.playInSilent ? 'playback' : 'ambient';
    } catch {
      // not supported: the browser default
    }
  }

  /** Settings: "sound even when the phone is on silent". */
  setPlayInSilent(on: boolean): void {
    this.playInSilent = on;
    this.applyAudioSession();
  }

  private readonly onGesture = (): void => { this.gesture(); };

  private armUnlock(): void {
    if (this.unlockArmed) return;
    this.unlockArmed = true;
    for (const ev of UNLOCK_EVENTS) window.addEventListener(ev, this.onGesture, { capture: true, passive: true });
  }

  private disarmUnlock(): void {
    if (!this.unlockArmed) return;
    this.unlockArmed = false;
    for (const ev of UNLOCK_EVENTS) window.removeEventListener(ev, this.onGesture, { capture: true });
  }

  private setBlocked(blocked: boolean): void {
    if (blocked === this.blocked) return;
    this.blocked = blocked;
    this.onBlockedChange?.(blocked);
  }

  /** Runs inside the player's touch: everything that must count as "from a gesture" has to start synchronously here. */
  private gesture(): void {
    if (!this.enabled) return;
    if (!this.ctx) void this.start(); // creates the context synchronously (no await before it)
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state === 'running') {
      this.disarmUnlock();
      this.setBlocked(false);
      return;
    }
    // iOS only unlocks output once something has been started inside the gesture: a one-sample silent buffer is enough.
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      // resume() below is still tried
    }
    ctx.resume().then(() => {
      if (ctx.state !== 'running') return;
      this.disarmUnlock();
      this.setBlocked(false);
      // The very first tap's click is played only now: before this it would have been dropped by play()'s "not running" guard.
      if (!this.clickAfterUnlock) {
        this.clickAfterUnlock = true;
        this.play('click', { volume: 0.6 });
      }
    }).catch(() => this.setBlocked(true));
    // On iOS the promise can stay pending (and no statechange fires) if the system refused: after a moment, say so.
    window.setTimeout(() => {
      if (this.enabled && !document.hidden && ctx.state !== 'running') this.setBlocked(true);
    }, 700);
  }

  /** Not from a gesture, so iOS may refuse: if the context is still not running a moment later, ask for a tap. */
  private tryResume(): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || document.hidden) return;
    void ctx.resume().catch(() => undefined);
    window.setTimeout(() => {
      if (this.ctx && this.enabled && !document.hidden && this.ctx.state !== 'running') {
        this.armUnlock();
        this.setBlocked(true);
      }
    }, 600);
  }

  /** ctx.onstatechange: 'suspended' or iOS's 'interrupted' (call, Siri, alarm) while the player expects sound. */
  private onContextState(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state === 'running') {
      this.disarmUnlock();
      this.setBlocked(false);
      return;
    }
    if (!this.enabled) {
      this.setBlocked(false);
      return;
    }
    this.armUnlock(); // the next tap resumes it
    if (!document.hidden) this.setBlocked(true); // hidden = we suspended it on purpose
  }

  get isOn(): boolean {
    return this.enabled;
  }

  /** Music and effects levels (0..1). Effects include the room ambience. */
  get levels(): { music: number; fx: number } {
    return { ...this.volumes };
  }

  setLevels(music: number, fx: number): void {
    this.volumes = { music: Math.max(0, Math.min(1, music)), fx: Math.max(0, Math.min(1, fx)) };
    try {
      localStorage.setItem(VOLUME_KEY, JSON.stringify(this.volumes));
    } catch {
      // the level simply won't persist
    }
    this.applyLevels();
  }

  private applyLevels(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicOut?.gain.setTargetAtTime(this.volumes.music, t, 0.05);
    this.fxOut?.gain.setTargetAtTime(this.volumes.fx, t, 0.05);
  }

  /** For crash records. */
  get debugState(): string {
    return this.ctx ? `${this.ctx.state} sfx=${this.sfx.size} rendering=${this.pumping || this.jobs.length > 0} ready=${this.ready} queued=${this.jobs.length}${this.light ? ' light' : ''}` : 'idle';
  }

  toggle(): void {
    this.enabled = !this.enabled;
    try {
      localStorage.setItem(STORAGE_KEY, this.enabled ? 'on' : 'off');
    } catch {
      // preference simply won't persist
    }
    if (!this.ctx) {
      if (this.enabled) void this.start();
      return;
    }
    if (this.enabled) void this.ctx.resume();
    else {
      void this.ctx.suspend();
      this.setBlocked(false);
    }
  }

  private async start(): Promise<void> {
    if (this.ctx) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.applyAudioSession();
    this.synthLoad = loadSynth().then(s => { this.synth = s; }, () => undefined); // a failed fetch leaves the game silent until the next start
    const ctx = new Ctor(); // still synchronous, inside the touch
    this.ctx = ctx;
    this.ctx.onstatechange = () => this.onContextState();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    this.master.connect(limiter).connect(this.ctx.destination);
    this.musicOut = this.ctx.createGain();
    this.fxOut = this.ctx.createGain();
    this.musicOut.connect(this.master);
    this.fxOut.connect(this.master);
    this.musicOut.gain.value = this.volumes.music;
    this.fxOut.gain.value = this.volumes.fx;
    this.musicBus = this.bus(MUSIC_LEVEL, this.musicOut);
    this.sfxBus = this.bus(SFX_LEVEL, this.fxOut);
    this.ambBus = this.bus(AMBIENCE_LEVEL, this.fxOut);
    void this.synthLoad.then(() => { if (this.ctx === ctx) this.queueInitial(); });
  }

  // ───────────────────────────── [perf] staged synthesis ─────────────────────────────
  // Everything is still composed offline by the same builders (the sound is unchanged), but no longer all at once at the first
  // touch while the phone is also drawing the scene: the first sounds go first, the rest is rendered one piece at a time when the
  // page is idle, and each piece waits until it is needed (a room's ambience when that room comes into view, the dark layer at night).

  /** Lower priority number = sooner. Same id twice is ignored. */
  private enqueue(id: string, prio: number, run: () => Promise<void>): void {
    if (this.queued.has(id)) {
      const j = this.jobs.find(x => x.id === id);
      if (j && prio < j.prio) { j.prio = prio; this.jobs.sort((a, b) => a.prio - b.prio); }
      return;
    }
    this.queued.add(id);
    this.jobs.push({ id, prio, run });
    this.jobs.sort((a, b) => a.prio - b.prio);
    if (!this.pumping) void this.pump();
  }

  /** Waits for a quiet moment on the main thread (and for the page to be visible: nothing is composed in the background). */
  private async quiet(urgent: boolean): Promise<void> {
    while (document.hidden) await new Promise<void>(r => document.addEventListener('visibilitychange', () => r(), { once: true }));
    await new Promise<void>(r => {
      const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      if (urgent || !ric) window.setTimeout(r, urgent ? 0 : 40);
      else ric(() => r(), { timeout: 600 });
    });
  }

  private async pump(): Promise<void> {
    this.pumping = true;
    try {
      while (this.jobs.length && this.ctx) {
        if (!this.synth && this.synthLoad) await this.synthLoad; // the recipes are not here yet: nothing can be composed
        const job = this.jobs[0];
        await this.quiet(job.prio < 20);
        // A more urgent job may have arrived while waiting.
        const next = this.jobs.shift()!;
        try {
          await next.run();
        } catch {
          // a sound that fails to render is simply missing
        }
        this.queued.delete(next.id);
        // A breath between pieces: the memory of the last render can be collected before the next one starts.
        await new Promise<void>(r => window.setTimeout(r, job.prio < 20 ? 0 : 30));
      }
    } finally {
      this.pumping = false;
    }
  }

  /** The interface sounds a player meets in the first minute; the others follow in the background. */
  private static readonly FIRST_SFX: Sfx[] = ['click', 'open', 'tab', 'switch', 'modalOpen', 'confirm', 'cancel', 'collect', 'place', 'build', 'error', 'notify', 'assign', 'unassign', 'whoosh', 'coin', 'complete', 'type'];

  private queueInitial(): void {
    const SFX = this.synth!.SFX;
    const names = Object.keys(SFX) as Sfx[];
    for (const name of AudioEngine.FIRST_SFX) this.enqueueSfx(name, 0);
    for (const name of names) if (!AudioEngine.FIRST_SFX.includes(name)) this.enqueueSfx(name, 20);
    this.enqueueAmbience('base', 1);
    this.enqueue(`lane:${this.era}`, 2, async () => { await this.startLane(this.era); });
    this.enqueueBed(ERA_BEDS[Math.min(ERA_BEDS.length - 1, this.era)], 3);
    this.enqueue('ready', 4, async () => { this.ready = true; });
    // The rest, when the page is idle: the other eras' beds are rendered only if the era changes; the two big music layers are
    // rendered at night / on an expedition, or at the end of the queue (not at all in lite mode, as before).
    if (!isLiteMode()) {
      this.enqueue('dark', 60, () => this.renderDark());
      this.enqueue('pulse', 61, () => this.renderPulse());
    }
  }

  private enqueueSfx(name: Sfx, prio: number): void {
    if (this.sfx.has(name)) return;
    this.enqueue(`sfx:${name}`, prio, async () => {
      const SFX = this.synth!.SFX;
      const def = SFX[name];
      // The seed is the effect's place in the list (as it always was), so the sound is the same whatever order they are rendered in.
      const seed = 100 + (Object.keys(SFX) as Sfx[]).indexOf(name);
      const buffer = await renderOneShot(def.seconds, def.build, seed, def.reverb, this.light ? 22050 : undefined, this.light ? 1 : undefined);
      this.sfx.set(name, normalize(buffer, SFX_PEAK[name] ?? 0.5));
    });
  }

  private enqueueAmbience(key: AmbienceKey, prio: number): void {
    if (this.ambience.has(key)) return;
    this.enqueue(`amb:${key}`, prio, async () => {
      const keys = Object.keys(AMBIENCE);
      const buffer = await renderLoop(AMBIENCE_SECONDS, 2, AMBIENCE[key], 100 + SFX_SEED_COUNT + keys.indexOf(key), 0.7, this.light ? 16000 : LOOP_RATE);
      this.startAmbience(key, normalize(buffer, key === 'base' ? 0.18 : 0.3));
    });
  }

  private enqueueBed(key: BedKey, prio: number): void {
    if (this.beds.has(key)) return;
    this.enqueue(`bed:${key}`, prio, async () => {
      const keys: BedKey[] = [...ERA_BEDS, 'city']; // the order the seeds were first handed out in
      const { BEDS, BED_SECONDS, SFX } = this.synth!;
      const buffer = await renderLoop(BED_SECONDS, 2, BEDS[key], 100 + SFX_SEED_COUNT + Object.keys(AMBIENCE).length + keys.indexOf(key), 0.85, this.light ? 16000 : LOOP_RATE);
      this.startBed(key, normalize(buffer, key === 'city' ? 0.22 : 0.26));
    });
  }

  private async renderDark(): Promise<void> {
    if (this.darkGain || !this.ctx) return;
    const { LOOP_SECONDS, LOOP_TAIL, darkTheme } = this.synth!;
    const dark = await renderLoop(LOOP_SECONDS, LOOP_TAIL, darkTheme, 13, 1.0, MUSIC_RATE);
    this.darkGain = this.loopLayer(normalize(dark, 0.6), this.mood === 'dark' ? 1 : 0);
  }

  private async renderPulse(): Promise<void> {
    if (this.expeditionGain || !this.ctx) return;
    const { EXPEDITION_SECONDS, expeditionPulse } = this.synth!;
    const pulse = await renderLoop(EXPEDITION_SECONDS, 2, expeditionPulse, 17, 0.6, MUSIC_RATE);
    this.expeditionGain = this.loopLayer(normalize(pulse, 0.35), this.expedition ? 1 : 0);
  }

  private bus(level: number, dest: AudioNode): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = level;
    g.connect(dest);
    return g;
  }

  private loopLayer(buffer: AudioBuffer, level: number): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(g).connect(this.musicBus!);
    src.start();
    g.gain.linearRampToValueAtTime(level, ctx.currentTime + 4);
    return g;
  }

  /** Starts a theme lane for an era and fades out the previous one. */
  private async startLane(era: number): Promise<void> {
    const ctx = this.ctx!;
    const old = this.lane;
    const gainNode = ctx.createGain();
    gainNode.gain.value = 0;
    gainNode.connect(this.musicBus!);
    const lane: ThemeLane = { era, gain: gainNode, nextStart: 0, seed: this.seedCounter++, sources: [], timer: 0, alive: true };
    this.lane = lane;
    const first = await this.renderTheme(lane);
    if (!lane.alive || !this.ctx) return;
    lane.nextStart = ctx.currentTime + 0.1;
    this.schedule(lane, first);
    const t = ctx.currentTime;
    gainNode.gain.setValueAtTime(0, t);
    gainNode.gain.linearRampToValueAtTime(this.themeLevel(), t + 5);
    if (old) {
      old.alive = false;
      window.clearTimeout(old.timer);
      old.gain.gain.cancelScheduledValues(t);
      old.gain.gain.setValueAtTime(old.gain.gain.value, t);
      old.gain.gain.linearRampToValueAtTime(0, t + 5);
      setTimeout(() => {
        for (const s of old.sources) {
          try { s.stop(); } catch { /* already stopped */ }
        }
        old.gain.disconnect();
      }, 6000);
    }
  }

  private async renderTheme(lane: ThemeLane): Promise<AudioBuffer> {
    const { LOOP_SECONDS, LOOP_TAIL } = this.synth!;
    const themes = eraThemes(this.synth!);
    const theme = themes[Math.min(themes.length - 1, lane.era)];
    const buffer = await renderSegment(LOOP_SECONDS, LOOP_TAIL, theme.build, lane.seed++ * 7919, theme.reverb, MUSIC_RATE);
    return normalize(buffer, 0.6);
  }

  /** Queues a segment and composes the following one well before it is needed. */
  private schedule(lane: ThemeLane, buffer: AudioBuffer): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(lane.gain);
    src.start(lane.nextStart);
    lane.sources.push(src);
    src.onended = () => {
      lane.sources = lane.sources.filter(s => s !== src);
      src.disconnect();
    };
    const { LOOP_SECONDS } = this.synth!;
    const startsAt = lane.nextStart;
    lane.nextStart += LOOP_SECONDS;
    // Compose the next segment ~25 s before this one ends.
    const delay = Math.max(1, startsAt + LOOP_SECONDS - 25 - ctx.currentTime) * 1000;
    const compose = async (): Promise<void> => {
      if (!lane.alive || !this.ctx) return;
      // [perf] The audio clock stands still while the page is in the background (the context is suspended), so the next segment is
      // not needed yet: wait for the player to come back instead of composing it for nobody.
      if (document.hidden || this.ctx.state !== 'running') {
        lane.timer = window.setTimeout(compose, 2000);
        return;
      }
      await this.quiet(false);
      const next = await this.renderTheme(lane);
      if (lane.alive) this.schedule(lane, next);
    };
    lane.timer = window.setTimeout(compose, delay);
  }

  private themeLevel(): number {
    return this.mood === 'dark' ? 0.25 : 1;
  }

  private startAmbience(key: AmbienceKey, buffer: AudioBuffer): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = buffer.duration;
    const g = ctx.createGain();
    g.gain.value = key === 'base' ? 1 : 0;
    const p = ctx.createStereoPanner();
    src.connect(g).connect(p).connect(this.ambBus!);
    src.start(ctx.currentTime, Math.random() * buffer.duration);
    this.ambience.set(key, { gain: g, pan: p });
  }

  /** Each era has its own room tone; the city hum belongs to the far view. */
  private bedLevel(key: BedKey): number {
    if (key === 'city') return this.zoom === 'far' ? 1 : 0;
    return ERA_BEDS[Math.min(ERA_BEDS.length - 1, this.era)] === key ? (this.zoom === 'far' ? 0.4 : 1) : 0;
  }

  private startBed(key: BedKey, buffer: AudioBuffer): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(g).connect(this.ambBus!);
    src.start(ctx.currentTime, Math.random() * buffer.duration);
    g.gain.linearRampToValueAtTime(this.bedLevel(key), ctx.currentTime + 4);
    this.beds.set(key, g);
  }

  private updateBeds(seconds: number): void {
    for (const [key, g] of this.beds) this.ramp(g, this.bedLevel(key), seconds);
  }

  /** Mix follows the camera: far away the city hum and music lead, up close the rooms do. */
  setZoom(zoom: ZoomMix): void {
    if (zoom === this.zoom) return;
    this.zoom = zoom;
    this.musicLevel = MUSIC_LEVEL * (zoom === 'far' ? 1.2 : zoom === 'close' ? 0.65 : 1);
    this.ramp(this.musicBus, this.musicLevel, 1.5);
    this.ramp(this.ambBus, AMBIENCE_LEVEL * (zoom === 'far' ? 0.7 : zoom === 'close' ? 1.25 : 1), 1.5);
    if (zoom === 'far' && this.ctx) this.enqueueBed('city', 9); // the city hum is rendered the first time the far view is used
    this.updateBeds(2.5);
  }

  private ramp(g: GainNode | null | undefined, value: number, seconds: number): void {
    if (!g || !this.ctx) return;
    const t = this.ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(value, t + seconds);
  }

  /** Night and crisis bring the dark layer up and the era theme down. */
  setMood(mood: MusicMood): void {
    if (mood === this.mood) return;
    this.mood = mood;
    if (mood === 'dark' && !this.darkGain && this.ctx && !isLiteMode()) this.enqueue('dark', 9, () => this.renderDark());
    this.ramp(this.darkGain, mood === 'dark' ? 1 : 0, 6);
    this.ramp(this.lane?.gain, this.themeLevel(), 6);
  }

  /** Switches the soundtrack to an era's theme (crossfaded). */
  setEra(era: number): void {
    if (era === this.era) return;
    this.era = era;
    if (this.ctx) {
      this.enqueue(`lane:${era}`, 5, async () => { if (era === this.era) await this.startLane(era); });
      this.enqueueBed(ERA_BEDS[Math.min(ERA_BEDS.length - 1, era)], 6);
    }
    this.updateBeds(6);
  }

  setExpedition(active: boolean): void {
    if (active === this.expedition) return;
    this.expedition = active;
    if (active && !this.expeditionGain && this.ctx && !isLiteMode()) this.enqueue('pulse', 9, () => this.renderPulse());
    this.ramp(this.expeditionGain, active ? 1 : 0, 3);
  }

  /** Room sounds follow the camera: louder for rooms in view, panned to their screen position. */
  setAmbience(mix: AmbienceMix[]): void {
    if (!this.ctx) return;
    for (const m of mix) if (!this.ambience.has(m.key)) this.enqueueAmbience(m.key, 8); // rendered the first time a room of that kind is in view
    const t = this.ctx.currentTime;
    const wanted = new Map(mix.map(m => [m.key, m]));
    for (const [key, voice] of this.ambience) {
      if (key === 'base') continue;
      const m = wanted.get(key);
      voice.gain.gain.setTargetAtTime(m ? Math.min(1, m.level) : 0, t, 0.4);
      voice.pan.pan.setTargetAtTime(m ? Math.max(-1, Math.min(1, m.pan)) : 0, t, 0.4);
    }
  }

  /** Briefly lowers the music under an important sound. */
  duck(seconds = 2): void {
    if (!this.ctx || !this.musicBus) return;
    const t = this.ctx.currentTime;
    const g = this.musicBus.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(this.musicLevel * 0.35, t + 0.15);
    g.linearRampToValueAtTime(this.musicLevel, t + seconds);
  }

  /** [ux-wp3 D2/F4] Says which sounds to skip right now (the app silences the game's sounds while it catches up on time away). */
  mute: ((name: Sfx) => boolean) | null = null;

  play(name: Sfx, opts: { pan?: number; volume?: number } = {}): void {
    if (this.mute?.(name)) return;
    this.onCue?.(name);
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const buffer = this.sfx.get(name);
    if (!buffer) {
      this.enqueueSfx(name, 5); // asked for before its turn in the background queue: next in line (this one is skipped)
      return;
    }
    const now = this.ctx.currentTime;
    if ((this.lastPlayed.get(name) ?? -1) > now - 0.04) return;
    this.lastPlayed.set(name, now);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = 0.97 + Math.random() * 0.06;
    const g = this.ctx.createGain();
    g.gain.value = opts.volume ?? 1;
    const p = this.ctx.createStereoPanner();
    p.pan.value = opts.pan ?? 0;
    src.connect(g).connect(p).connect(this.sfxBus!);
    src.start();
    // [ux-wp3 F3] A quiet reminder alarm (volume under one half) does not push the music down: only the real announcement does.
    if (name === 'alarm' && (opts.volume ?? 1) < 0.5) return;
    if (name === 'event' || name === 'achievement' || name === 'door' || name === 'lore' || name === 'restore' || name === 'alarm'
      || name === 'heart' || name === 'baby' || name === 'unlock' || name === 'cheer' || name === 'engineStart') this.duck(2.5);
    if (name === 'thunder') this.duck(4);
    if (name === 'story') this.duck(4);
    if (name === 'era' || name === 'siren') this.duck(5);
  }
}
