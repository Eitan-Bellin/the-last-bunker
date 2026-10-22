// v2 sound: the game's synthesized SFX (src/audio/sfx.ts), rendered once per name and played through one AudioContext.
import { SFX, type Sfx } from '../audio/sfx.ts';
import { envelope, filter, gain, noiseHit, osc, renderLoop, renderOneShot, type Builder } from '../audio/dsp.ts';
import { BEDS, BED_SECONDS } from '../audio/beds.ts';

/** Battle sounds made here (the shared library has none): a rifle shot, an artillery whistle, an explosion. */
const CUSTOM: Record<string, { seconds: number; reverb: number; build: Builder }> = {
  shot: {
    seconds: 0.5, reverb: 0.25,
    build: (ctx, out) => {
      noiseHit(ctx, out, 0, 0.08, 0.9, 'bandpass', 1800, 0.8, 'white', 5);
      noiseHit(ctx, out, 0, 0.25, 0.6, 'lowpass', 500, 0.7, 'brown', 9);
      const o = osc(ctx, 'sine', 140);
      o.frequency.exponentialRampToValueAtTime(50, 0.12);
      const g = gain(ctx, 0);
      envelope(g.gain, 0, 0.7, 0.003, 0, 0.12);
      o.connect(g).connect(out);
      o.start(0);
      o.stop(0.2);
    },
  },
  whistle: {
    seconds: 0.9, reverb: 0.4,
    build: (ctx, out) => {
      const o = osc(ctx, 'sine', 1800);
      o.frequency.exponentialRampToValueAtTime(600, 0.8);
      const g = gain(ctx, 0);
      envelope(g.gain, 0, 0.18, 0.05, 0.55, 0.2);
      o.connect(g).connect(out);
      o.start(0);
      o.stop(0.85);
    },
  },
  boom: {
    seconds: 2.2, reverb: 0.7,
    build: (ctx, out) => {
      noiseHit(ctx, out, 0, 1.6, 1.0, 'lowpass', 380, 0.7, 'brown', 11);
      noiseHit(ctx, out, 0, 0.3, 0.7, 'bandpass', 1200, 0.6, 'white', 13);
      const o = osc(ctx, 'sine', 70);
      o.frequency.exponentialRampToValueAtTime(28, 0.9);
      const lp = filter(ctx, 'lowpass', 200);
      const g = gain(ctx, 0);
      envelope(g.gain, 0, 1.0, 0.005, 0.1, 0.9);
      o.connect(lp).connect(g).connect(out);
      o.start(0);
      o.stop(1.2);
    },
  },
};

const NAMES = Object.keys(SFX) as Sfx[];
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
type Name = Sfx | keyof typeof CUSTOM;
const buffers = new Map<Name, AudioBuffer>();
const rendering = new Set<Name>();
const lastAt = new Map<Name, number>();
let muted = false;

try { muted = localStorage.getItem('lastbunker_v2_mute') === '1'; } catch { /* private mode */ }

export function unlockAudio(): void {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.7;
    master.connect(ctx.destination);
    for (const n of ['click', 'coin', 'collect', 'levelup', 'elevator', 'unlock', 'cheer', 'dig', 'powerUp', 'error', 'tab', 'open', 'shot', 'boom', 'whistle', 'reveal', 'achievement', 'rankUp', 'whoosh'] as Name[]) prepare(n);
    startAmbience();
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

function prepare(name: Name): void {
  if (buffers.has(name) || rendering.has(name)) return;
  rendering.add(name);
  const def = CUSTOM[name] ?? SFX[name as Sfx];
  void renderOneShot(def.seconds, def.build, NAMES.indexOf(name as Sfx) + 1, def.reverb, 44100)
    .then(b => buffers.set(name, b))
    .catch(() => { /* no sound is fine */ })
    .finally(() => rendering.delete(name));
}

export function play(name: Name, opts: { volume?: number; rate?: number; minGapMs?: number } = {}): void {
  if (!ctx || !master || muted) return;
  const now = performance.now();
  if (opts.minGapMs && now - (lastAt.get(name) ?? -1e9) < opts.minGapMs) return;
  lastAt.set(name, now);
  const b = buffers.get(name);
  if (!b) { prepare(name); return; }
  const src = ctx.createBufferSource();
  src.buffer = b;
  src.playbackRate.value = opts.rate ?? 1;
  const g = ctx.createGain();
  g.gain.value = opts.volume ?? 1;
  src.connect(g).connect(master);
  src.start();
}

/** A quiet working-bunker bed under everything (machines, ventilation, distant voices), looped. */
function startAmbience(): void {
  const c = ctx;
  if (!c || !master) return;
  const out = master;
  setTimeout(() => {
    void renderLoop(BED_SECONDS, 2, BEDS.undercity, 41, 0.8, 32000).then(buf => {
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = c.createGain();
      g.gain.value = 0;
      g.gain.linearRampToValueAtTime(0.22, c.currentTime + 4);
      src.connect(g).connect(out);
      src.start();
    }).catch(() => { /* silence is fine */ });
  }, 1200);
}

/** Battle music: 8 s loop at 120 bpm (D minor) - war drums, a pulsing low ostinato, a dark drone and string stabs. */
const battleMusic: Builder = (c, out, wet) => {
  const beat = 0.5;
  const drum = (t: number, f0: number, peak: number) => {
    const o = osc(c, 'sine', f0);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.45, t + 0.35);
    const g = gain(c, 0);
    envelope(g.gain, t, peak, 0.004, 0.02, 0.45);
    o.connect(g).connect(out);
    g.connect(wet);
    o.start(t);
    o.stop(t + 0.6);
    noiseHit(c, out, t, 0.12, peak * 0.35, 'lowpass', 900, 0.7, 'brown', 17);
  };
  for (let bar = 0; bar < 4; bar++) {
    const b0 = bar * 4 * beat;
    // taiko pattern: 1 . 3 4& , accent on the last bar
    drum(b0, 95, 0.9);
    drum(b0 + 2 * beat, 85, 0.75);
    drum(b0 + 3 * beat, 95, 0.6);
    drum(b0 + 3.5 * beat, 110, bar === 3 ? 0.8 : 0.45);
    // snare-like rim on 2 and 4
    noiseHit(c, out, b0 + beat, 0.09, 0.22, 'bandpass', 2400, 1.2, 'white', 19 + bar);
    noiseHit(c, out, b0 + 3 * beat, 0.09, 0.26, 'bandpass', 2200, 1.2, 'white', 23 + bar);
    // hats on the off-beats
    for (let k = 0; k < 8; k++) noiseHit(c, out, b0 + k * beat / 2 + beat / 4, 0.03, 0.06, 'highpass', 7000, 0.7, 'white', 29 + k);
  }
  // low ostinato (8ths): D D F D | D D A# A
  const notes = [38, 38, 41, 38, 38, 38, 46, 45];
  for (let i = 0; i < 32; i++) {
    const t = i * beat / 2;
    const f = 440 * 2 ** ((notes[i % 8] - (Math.floor(i / 16) ? 2 : 0) - 69) / 12);
    const o = osc(c, 'sawtooth', f);
    const lp = filter(c, 'lowpass', 520, 3);
    const g = gain(c, 0);
    envelope(g.gain, t, 0.11, 0.008, 0.06, 0.14);
    o.connect(lp).connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.3);
  }
  // drone (D2 + A2) breathing over the loop
  for (const n of [38, 45]) {
    const o = osc(c, 'sawtooth', 440 * 2 ** ((n - 12 - 69) / 12), n === 45 ? 7 : -7);
    const lp = filter(c, 'lowpass', 300, 0.8);
    const g = gain(c, 0.05);
    o.connect(lp).connect(g).connect(out);
    g.connect(wet);
    o.start(0);
    o.stop(8.5);
  }
  // string stabs on bars 2 and 4 (D minor triad, then Bb)
  for (const [t, chord] of [[2, [62, 65, 69]], [6, [58, 62, 65]]] as [number, number[]][]) {
    for (const n of chord) {
      const o = osc(c, 'sawtooth', 440 * 2 ** ((n - 69) / 12));
      const lp = filter(c, 'lowpass', 1800, 0.7);
      const g = gain(c, 0);
      envelope(g.gain, t, 0.05, 0.02, 0.15, 0.6);
      o.connect(lp).connect(g).connect(out);
      g.connect(wet);
      o.start(t);
      o.stop(t + 1);
    }
  }
};

let battleSrc: { src: AudioBufferSourceNode; g: GainNode } | null = null;
let battleBuf: Promise<AudioBuffer> | null = null;

/** The rendered battle loop (dev check: resolves to the buffer). */
export function battleMusicBuffer(): Promise<AudioBuffer> {
  battleBuf ??= renderLoop(8, 2, battleMusic, 61, 0.35, 32000);
  return battleBuf;
}

/** Starts the battle loop (fades in); renders it on first use. */
export function startBattleMusic(): void {
  const c = ctx;
  if (!c || !master || battleSrc) return;
  const out = master;
  void battleMusicBuffer().then(buf => {
    if (battleSrc) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = c.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(0.5, c.currentTime + 1.2);
    src.connect(g).connect(out);
    src.start();
    battleSrc = { src, g };
  }).catch(() => { /* no music is fine */ });
}

/** Fades the battle loop out. */
export function stopBattleMusic(): void {
  const c = ctx;
  const b = battleSrc;
  battleSrc = null;
  if (!c || !b) return;
  b.g.gain.cancelScheduledValues(c.currentTime);
  b.g.gain.setValueAtTime(b.g.gain.value, c.currentTime);
  b.g.gain.linearRampToValueAtTime(0, c.currentTime + 1.5);
  b.src.stop(c.currentTime + 1.6);
}

export function isMuted(): boolean { return muted; }

export function setMuted(m: boolean): void {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.7;
  try { localStorage.setItem('lastbunker_v2_mute', m ? '1' : '0'); } catch { /* ignore */ }
}
