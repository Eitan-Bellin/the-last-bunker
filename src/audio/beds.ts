import { envelope, fmBell, filter, gain, metalHit, midi, noiseBuffer, noiseHit, osc, type Builder } from './dsp';
import type { BedKey } from './bedKeys';
export type { BedKey } from './bedKeys';
export { ERA_BEDS } from './bedKeys';

/** Long ambience beds: one per era, plus the city hum heard from far away. */
export const BED_SECONDS = 16;


/** Noise through a band filter whose amplitude breathes with a slow LFO. */
function breathingNoise(
  ctx: OfflineAudioContext, dest: AudioNode, color: 'white' | 'pink' | 'brown', type: BiquadFilterType,
  freq: number, q: number, level: number, lfoHz: number, depth: number, seed: number,
): void {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, BED_SECONDS + 2, color, seed);
  const f = filter(ctx, type, freq, q);
  const g = gain(ctx, level);
  const lfo = osc(ctx, 'sine', lfoHz);
  const amt = gain(ctx, level * depth);
  lfo.connect(amt).connect(g.gain);
  src.connect(f).connect(g).connect(dest);
  src.start(0);
  lfo.start(0);
}

/** Crowd murmur: voiced noise bands opening and closing at speech rate. */
function murmur(ctx: OfflineAudioContext, dest: AudioNode, level: number, seed: number, rnd: () => number): void {
  for (let i = 0; i < 5; i++) {
    breathingNoise(ctx, dest, 'pink', 'bandpass', 320 + i * 170 + rnd() * 60, 5, level, 2.5 + rnd() * 2.5, 0.9, seed + i);
  }
}

export const BEDS: Record<BedKey, Builder> = {
  // Dead bunker: wind moaning through the vents, creaking steel, water dripping in the dark.
  remnant: (ctx, out, wet, rnd) => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, BED_SECONDS + 2, 'pink', 301);
    const bp = filter(ctx, 'bandpass', 420, 6);
    for (let t = 0; t < BED_SECONDS; t += 4) {
      bp.frequency.linearRampToValueAtTime(300 + rnd() * 500, t + 2 + rnd() * 2);
    }
    const g = gain(ctx, 0.12);
    src.connect(bp).connect(g);
    g.connect(out);
    g.connect(wet);
    src.start(0);
    breathingNoise(ctx, out, 'brown', 'lowpass', 160, 0.7, 0.08, 0.07, 0.6, 302);
    for (let i = 0; i < 3; i++) metalHit(ctx, wet, 1 + rnd() * (BED_SECONDS - 3), 70 + rnd() * 50, 0.04, 2.4);
    for (let i = 0; i < 9; i++) {
      const t = rnd() * (BED_SECONDS - 0.3);
      const o = osc(ctx, 'sine', 900);
      o.frequency.setValueAtTime(650 + rnd() * 300, t);
      o.frequency.exponentialRampToValueAtTime(1500 + rnd() * 400, t + 0.05);
      const dg = gain(ctx, 0);
      envelope(dg.gain, t, 0.04, 0.002, 0.01, 0.07);
      o.connect(dg);
      dg.connect(wet);
      o.start(t);
      o.stop(t + 0.12);
    }
  },
  // Lights back on: a warm electrical hum and distant work.
  restoration: (ctx, out, wet, rnd) => {
    for (const [f, l] of [[60, 0.05], [120, 0.025], [180, 0.012]] as const) {
      const o = osc(ctx, 'sine', f);
      const g = gain(ctx, l);
      o.connect(g).connect(out);
      o.start(0);
    }
    breathingNoise(ctx, out, 'pink', 'lowpass', 600, 0.6, 0.05, 0.1, 0.4, 311);
    for (let i = 0; i < 5; i++) metalHit(ctx, wet, rnd() * (BED_SECONDS - 1), 220 + rnd() * 300, 0.03, 0.8);
  },
  // The colony: people talking in the corridors, a door, a laugh of bells.
  colony: (ctx, out, wet, rnd) => {
    murmur(ctx, out, 0.035, 321, rnd);
    breathingNoise(ctx, out, 'pink', 'lowpass', 500, 0.6, 0.035, 0.08, 0.3, 330);
    for (let i = 0; i < 3; i++) fmBell(ctx, wet, rnd() * (BED_SECONDS - 2), midi(76 + Math.floor(rnd() * 8)), 0.02, 0.8, 2.01, 0.8);
    noiseHit(ctx, wet, 6 + rnd() * 6, 0.4, 0.05, 'lowpass', 300, 1, 'brown', 331);
  },
  // The undercity: a busy crowd, machinery, a train rumbling through the far tunnels, a radio tune.
  undercity: (ctx, out, wet, rnd) => {
    murmur(ctx, out, 0.045, 341, rnd);
    for (const [f, l] of [[50, 0.04], [100, 0.02]] as const) {
      const o = osc(ctx, 'sine', f);
      const g = gain(ctx, l);
      o.connect(g).connect(out);
      o.start(0);
    }
    const rumble = ctx.createBufferSource();
    rumble.buffer = noiseBuffer(ctx, BED_SECONDS + 2, 'brown', 350);
    const lp = filter(ctx, 'lowpass', 140, 0.8);
    const rg = gain(ctx, 0);
    envelope(rg.gain, 4, 0.12, 3, 2, 4);
    rumble.connect(lp).connect(rg);
    rg.connect(out);
    rg.connect(wet);
    rumble.start(0);
    const tune = [72, 74, 76, 79, 76, 74, 72, 67];
    tune.forEach((n, i) => fmBell(ctx, wet, 1 + i * 0.6, midi(n), 0.012, 0.6, 1.0, 0.5));
  },
  // Seen from far away: the whole city as one soft hum.
  city: (ctx, out, wet) => {
    breathingNoise(ctx, out, 'brown', 'lowpass', 220, 0.7, 0.1, 0.05, 0.4, 361);
    breathingNoise(ctx, wet, 'pink', 'bandpass', 900, 1.5, 0.02, 0.13, 0.7, 362);
    const o = osc(ctx, 'sine', 55);
    const g = gain(ctx, 0.03);
    o.connect(g).connect(out);
    o.start(0);
  },
};
