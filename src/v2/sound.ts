// v2 sound: the game's synthesized SFX (src/audio/sfx.ts), rendered once per name and played through one AudioContext.
import { SFX, type Sfx } from '../audio/sfx.ts';
import { envelope, filter, gain, noiseHit, osc, renderOneShot, type Builder } from '../audio/dsp.ts';

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
    for (const n of ['click', 'coin', 'collect', 'levelup', 'elevator', 'unlock', 'cheer', 'dig', 'powerUp', 'error', 'tab', 'open', 'shot', 'boom', 'whistle'] as Name[]) prepare(n);
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

export function isMuted(): boolean { return muted; }

export function setMuted(m: boolean): void {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.7;
  try { localStorage.setItem('lastbunker_v2_mute', m ? '1' : '0'); } catch { /* ignore */ }
}
