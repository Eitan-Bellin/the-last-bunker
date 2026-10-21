// v2 sound: the game's synthesized SFX (src/audio/sfx.ts), rendered once per name and played through one AudioContext.
import { SFX, type Sfx } from '../audio/sfx.ts';
import { renderOneShot } from '../audio/dsp.ts';

const NAMES = Object.keys(SFX) as Sfx[];
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const buffers = new Map<Sfx, AudioBuffer>();
const rendering = new Set<Sfx>();
const lastAt = new Map<Sfx, number>();
let muted = false;

try { muted = localStorage.getItem('lastbunker_v2_mute') === '1'; } catch { /* private mode */ }

export function unlockAudio(): void {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.7;
    master.connect(ctx.destination);
    for (const n of ['click', 'coin', 'collect', 'levelup', 'elevator', 'unlock', 'cheer', 'dig', 'powerUp', 'error', 'tab', 'open'] as Sfx[]) prepare(n);
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

function prepare(name: Sfx): void {
  if (buffers.has(name) || rendering.has(name)) return;
  rendering.add(name);
  const def = SFX[name];
  void renderOneShot(def.seconds, def.build, NAMES.indexOf(name) + 1, def.reverb, 44100)
    .then(b => buffers.set(name, b))
    .catch(() => { /* no sound is fine */ })
    .finally(() => rendering.delete(name));
}

export function play(name: Sfx, opts: { volume?: number; rate?: number; minGapMs?: number } = {}): void {
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
