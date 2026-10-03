import { normalize, renderLoop, renderOneShot, renderSegment, type Builder } from './dsp';
import {
  EXPEDITION_SECONDS, LOOP_SECONDS, LOOP_TAIL, colonyTheme, darkTheme, expeditionPulse, remnantTheme, shelterTheme, undercityTheme,
} from './music';
import { SFX, type Sfx } from './sfx';
import { AMBIENCE, AMBIENCE_SECONDS, type AmbienceKey } from './ambience';
import { BEDS, BED_SECONDS, ERA_BEDS, type BedKey } from './beds';

export type ZoomMix = 'far' | 'mid' | 'close';

export type { Sfx } from './sfx';
export type MusicMood = 'shelter' | 'dark';

const STORAGE_KEY = 'lastbunker_sound';
const MUSIC_LEVEL = 0.5;
const SFX_LEVEL = 0.8;
const AMBIENCE_LEVEL = 0.55;
/** Long loops have little energy above 12 kHz, so they render at a lower rate (less work and memory). */
const LOOP_RATE = 32000;
const MUSIC_RATE = 24000;

/** One theme per era: Remnant, Restoration, Colony, Undercity. */
const ERA_THEMES: { build: Builder; reverb: number }[] = [
  { build: remnantTheme, reverb: 1.0 },
  { build: shelterTheme, reverb: 0.95 },
  { build: colonyTheme, reverb: 0.8 },
  { build: undercityTheme, reverb: 0.95 },
];

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
  private ambience = new Map<AmbienceKey, AmbienceVoice>();
  private mood: MusicMood = 'shelter';
  private era = 0;
  private lane: ThemeLane | null = null;
  private darkGain: GainNode | null = null;
  private expeditionGain: GainNode | null = null;
  private expedition = false;
  private lastPlayed = new Map<Sfx, number>();
  private rendering = false;
  private seedCounter = 1000;
  private beds = new Map<BedKey, GainNode>();
  private zoom: ZoomMix = 'mid';
  private musicLevel = MUSIC_LEVEL;

  constructor() {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      stored = null;
    }
    this.enabled = stored !== 'off';
    const unlock = () => {
      window.removeEventListener('pointerdown', unlock);
      if (this.enabled) void this.start();
    };
    window.addEventListener('pointerdown', unlock);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else if (this.enabled) void this.ctx.resume();
    });
  }

  get isOn(): boolean {
    return this.enabled;
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
    else void this.ctx.suspend();
  }

  private async start(): Promise<void> {
    if (this.ctx || this.rendering) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    this.master.connect(limiter).connect(this.ctx.destination);
    this.musicBus = this.bus(MUSIC_LEVEL);
    this.sfxBus = this.bus(SFX_LEVEL);
    this.ambBus = this.bus(AMBIENCE_LEVEL);
    this.rendering = true;
    try {
      await this.renderAll();
    } finally {
      this.rendering = false;
    }
  }

  private bus(level: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = level;
    g.connect(this.master!);
    return g;
  }

  /** Short effects first so the UI has sound immediately, then ambience, then the music layers. */
  private async renderAll(): Promise<void> {
    let seed = 100;
    for (const [name, def] of Object.entries(SFX) as [Sfx, typeof SFX[Sfx]][]) {
      const buffer = await renderOneShot(def.seconds, def.build, seed++, def.reverb);
      this.sfx.set(name, normalize(buffer, SFX_PEAK[name] ?? 0.5));
    }
    for (const [key, build] of Object.entries(AMBIENCE) as [AmbienceKey, typeof AMBIENCE[AmbienceKey]][]) {
      const buffer = await renderLoop(AMBIENCE_SECONDS, 2, build, seed++, 0.7, LOOP_RATE);
      this.startAmbience(key, normalize(buffer, key === 'base' ? 0.18 : 0.3));
    }
    await this.startLane(this.era);
    for (const key of [...ERA_BEDS, 'city'] as BedKey[]) {
      const buffer = await renderLoop(BED_SECONDS, 2, BEDS[key], seed++, 0.85, LOOP_RATE);
      this.startBed(key, normalize(buffer, key === 'city' ? 0.22 : 0.26));
    }
    const dark = await renderLoop(LOOP_SECONDS, LOOP_TAIL, darkTheme, 13, 1.0, MUSIC_RATE);
    this.darkGain = this.loopLayer(normalize(dark, 0.6), this.mood === 'dark' ? 1 : 0);
    const pulse = await renderLoop(EXPEDITION_SECONDS, 2, expeditionPulse, 17, 0.6, MUSIC_RATE);
    this.expeditionGain = this.loopLayer(normalize(pulse, 0.35), this.expedition ? 1 : 0);
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
    const theme = ERA_THEMES[Math.min(ERA_THEMES.length - 1, lane.era)];
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
    const startsAt = lane.nextStart;
    lane.nextStart += LOOP_SECONDS;
    // Compose the next segment ~25 s before this one ends.
    const delay = Math.max(1, startsAt + LOOP_SECONDS - 25 - ctx.currentTime) * 1000;
    lane.timer = window.setTimeout(async () => {
      if (!lane.alive || !this.ctx) return;
      const next = await this.renderTheme(lane);
      if (lane.alive) this.schedule(lane, next);
    }, delay);
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
    this.ramp(this.darkGain, mood === 'dark' ? 1 : 0, 6);
    this.ramp(this.lane?.gain, this.themeLevel(), 6);
  }

  /** Switches the soundtrack to an era's theme (crossfaded). */
  setEra(era: number): void {
    if (era === this.era) return;
    this.era = era;
    if (this.ctx && !this.rendering) void this.startLane(era);
    this.updateBeds(6);
  }

  setExpedition(active: boolean): void {
    if (active === this.expedition) return;
    this.expedition = active;
    this.ramp(this.expeditionGain, active ? 1 : 0, 3);
  }

  /** Room sounds follow the camera: louder for rooms in view, panned to their screen position. */
  setAmbience(mix: AmbienceMix[]): void {
    if (!this.ctx) return;
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

  play(name: Sfx, opts: { pan?: number; volume?: number } = {}): void {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const buffer = this.sfx.get(name);
    if (!buffer) return;
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
    if (name === 'event' || name === 'achievement' || name === 'door' || name === 'lore' || name === 'restore' || name === 'alarm'
      || name === 'heart' || name === 'baby' || name === 'unlock' || name === 'cheer' || name === 'engineStart') this.duck(2.5);
    if (name === 'thunder') this.duck(4);
    if (name === 'story') this.duck(4);
    if (name === 'era' || name === 'siren') this.duck(5);
  }
}
