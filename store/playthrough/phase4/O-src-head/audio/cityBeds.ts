import { envelope, filter, gain, metalHit, noiseBuffer, noiseHit, osc, type Builder } from './dsp';
import { AUDIO, type AmbienceLayer } from '../world/tokens';

/**
 * [world:C1-Li] The city's ambience beds, one per stratum (style guide 2 "sound", tokens AUDIO.strata): wind over the ash on the surface,
 * the shelter's murmur and mains hum, the works' ventilation roar and pipe knocks, the metro's tunnel wind and a far train, the mines'
 * machinery and blasts, the caves' drips and resonance, the core's rumble and slow machine pulse. Each bed mixes the synthesized
 * layers at the stratum's AUDIO gains under its low-pass; the crowd murmur is a loop of its own (`cityCrowd`), scaled live by the
 * people in view. Rendered offline like the era beds (AudioEngine, only for the strata the camera visits) and looped.
 *
 * Part of the lazily fetched synth chunk (src/audio/synth.ts): nothing else may import it statically.
 */
export const CITY_BED_SECONDS = 16;
const LEN = CITY_BED_SECONDS + 2;

/** Noise through a filter, its level breathing with a slow LFO. */
function breath(ctx: OfflineAudioContext, dest: AudioNode, color: 'white' | 'pink' | 'brown', type: BiquadFilterType, freq: number, q: number, level: number, lfoHz: number, depth: number, seed: number): BiquadFilterNode {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, LEN, color, seed);
  const f = filter(ctx, type, freq, q);
  const g = gain(ctx, level);
  const lfo = osc(ctx, 'sine', lfoHz);
  const amt = gain(ctx, level * depth);
  lfo.connect(amt).connect(g.gain);
  src.connect(f).connect(g).connect(dest);
  src.start(0);
  lfo.start(0);
  return f;
}

type Layer = (ctx: OfflineAudioContext, out: AudioNode, wet: AudioNode, rnd: () => number, level: number, seed: number) => void;

const LAYERS: Record<AmbienceLayer, Layer> = {
  // Wind over the ash: a band of pink noise sweeping slowly, gusting.
  wind: (ctx, out, wet, rnd, level, seed) => {
    const f = breath(ctx, out, 'pink', 'bandpass', 380, 2.2, 0.09 * level, 0.09, 0.7, seed);
    for (let t = 0; t < CITY_BED_SECONDS; t += 4) f.frequency.linearRampToValueAtTime(240 + rnd() * 520, t + 2 + rnd() * 2);
    breath(ctx, wet, 'brown', 'lowpass', 180, 0.7, 0.05 * level, 0.13, 0.5, seed + 1);
  },
  // Mains hum: 50 Hz and its harmonics, a slow tremolo.
  hum: (ctx, out, _wet, _rnd, level) => {
    const g = gain(ctx, 0.05 * level);
    const trem = osc(ctx, 'sine', 0.3);
    const ta = gain(ctx, 0.012 * level);
    trem.connect(ta).connect(g.gain);
    trem.start(0);
    const lp = filter(ctx, 'lowpass', 360, 0.8);
    for (const [m, type, l] of [[1, 'sine', 1], [2, 'sine', 0.5], [3, 'triangle', 0.25], [6, 'sawtooth', 0.06]] as const) {
      const o = osc(ctx, type, 50 * m);
      const og = gain(ctx, l);
      o.connect(og).connect(lp);
      o.start(0);
    }
    lp.connect(g).connect(out);
  },
  // Crowd (only in `cityCrowd`, where it is scaled by the people in view).
  crowd: () => undefined,
  // Ventilation: a broad air roar and the fan's blade beat.
  vent: (ctx, out, _wet, _rnd, level, seed) => {
    breath(ctx, out, 'pink', 'lowpass', 520, 0.6, 0.08 * level, 0.05, 0.25, seed);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, LEN, 'white', seed + 1);
    const bp = filter(ctx, 'bandpass', 900, 1.4);
    const g = gain(ctx, 0.012 * level);
    const blade = osc(ctx, 'sine', 11.5);
    const ba = gain(ctx, 0.01 * level);
    blade.connect(ba).connect(g.gain);
    blade.start(0);
    src.connect(bp).connect(g).connect(out);
    src.start(0);
  },
  // Distant drips with long echoes, and now and then a pipe knock.
  drip: (ctx, out, wet, rnd, level) => {
    const n = Math.round(6 + 10 * level);
    for (let i = 0; i < n; i++) {
      const t = rnd() * (CITY_BED_SECONDS - 0.3);
      const f0 = 500 + rnd() * 700;
      const o = osc(ctx, 'sine', f0);
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * (1.8 + rnd() * 0.6), t + 0.05);
      const g = gain(ctx, 0);
      envelope(g.gain, t, 0.05 * level, 0.003, 0, 0.07);
      o.connect(g);
      g.connect(wet);
      if (rnd() < 0.4) g.connect(out);
      o.start(t);
      o.stop(t + 0.12);
    }
    for (let i = 0; i < 2; i++) metalHit(ctx, wet, 1 + rnd() * (CITY_BED_SECONDS - 3), 90 + rnd() * 60, 0.03 * level, 1.8);
  },
  // Machinery: a slow pulse like a heartbeat (two low thumps) with a metallic tick.
  machine: (ctx, out, wet, rnd, level, seed) => {
    const beat = 1.6;
    for (let t = 0.2; t < CITY_BED_SECONDS - 0.3; t += beat) {
      for (const [dt, pk] of [[0, 0.16], [0.28, 0.1]] as const) {
        const o = osc(ctx, 'sine', 46);
        o.frequency.setValueAtTime(62, t + dt);
        o.frequency.exponentialRampToValueAtTime(38, t + dt + 0.2);
        const g = gain(ctx, 0);
        envelope(g.gain, t + dt, pk * level, 0.008, 0.02, 0.24);
        o.connect(g).connect(out);
        o.start(t + dt);
        o.stop(t + dt + 0.4);
      }
      if (rnd() < 0.5) noiseHit(ctx, wet, t + 0.8, 0.04, 0.03 * level, 'bandpass', 2600, 4, 'white', seed);
    }
  },
  // Deep rumble: brown noise far below 100 Hz, swelling slowly; a distant blast in the mines.
  rumble: (ctx, out, wet, rnd, level, seed) => {
    breath(ctx, out, 'brown', 'lowpass', 85, 0.9, 0.16 * level, 0.07, 0.6, seed);
    const t = 3 + rnd() * (CITY_BED_SECONDS - 8);
    noiseHit(ctx, wet, t, 2.6, 0.18 * level, 'lowpass', 140, 0.8, 'brown', seed + 3);
  },
  // Running water and a far waterfall.
  water: (ctx, out, wet, _rnd, level, seed) => {
    breath(ctx, out, 'pink', 'bandpass', 900, 0.8, 0.05 * level, 0.21, 0.35, seed);
    breath(ctx, wet, 'brown', 'lowpass', 260, 0.7, 0.07 * level, 0.04, 0.2, seed + 1);
  },
  // A low resonant tone that comes and goes (the caverns ringing).
  resonance: (ctx, _out, wet, _rnd, level) => {
    for (const [f, d] of [[55, 0], [82.4, 7], [110.3, -5]] as const) {
      const o = osc(ctx, 'sine', f, d);
      const g = gain(ctx, 0);
      g.gain.setValueAtTime(0, 0);
      g.gain.linearRampToValueAtTime(0.035 * level, CITY_BED_SECONDS * 0.35);
      g.gain.linearRampToValueAtTime(0.012 * level, CITY_BED_SECONDS * 0.7);
      g.gain.linearRampToValueAtTime(0, CITY_BED_SECONDS);
      o.connect(g).connect(wet);
      o.start(0);
    }
  },
  // A fire: crackle over a soft roar.
  fire: (ctx, out, _wet, rnd, level, seed) => {
    breath(ctx, out, 'brown', 'lowpass', 300, 0.7, 0.05 * level, 0.6, 0.4, seed);
    const n = Math.round(20 + 30 * level);
    for (let i = 0; i < n; i++) noiseHit(ctx, out, rnd() * CITY_BED_SECONDS, 0.012 + rnd() * 0.02, 0.06 * level, 'highpass', 1800 + rnd() * 2000, 0.8, 'white', seed + 10 + i);
  },
  // A ghost train in the far tunnels: a swell of rumble and the clack of rail joints passing.
  train: (ctx, out, wet, rnd, level, seed) => {
    const t0 = 2 + rnd() * 4, dur = 7;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, LEN, 'brown', seed);
    const lp = filter(ctx, 'lowpass', 160, 0.9);
    const g = gain(ctx, 0);
    g.gain.setValueAtTime(0, 0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.22 * level, t0 + dur * 0.5);
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    src.connect(lp).connect(g);
    g.connect(out);
    g.connect(wet);
    src.start(0);
    for (let t = t0 + 0.8; t < t0 + dur - 0.8; t += 0.42) {
      const near = 1 - Math.abs((t - t0) / dur - 0.5) * 2;
      noiseHit(ctx, wet, t, 0.05, 0.05 * level * near, 'bandpass', 700, 3, 'white', seed + 1);
      noiseHit(ctx, wet, t + 0.11, 0.05, 0.04 * level * near, 'bandpass', 640, 3, 'white', seed + 2);
    }
  },
};

const ORDER: readonly AmbienceLayer[] = ['wind', 'hum', 'vent', 'drip', 'machine', 'rumble', 'water', 'resonance', 'fire', 'train'];

/** The bed of stratum `s`: its AUDIO layers at their gains, darkened by its low-pass (the deeper, the darker). */
export function cityBed(s: number): Builder {
  const st = AUDIO.strata[Math.max(0, Math.min(AUDIO.strata.length - 1, s))];
  return (ctx, out, wet, rnd) => {
    const lpOut = filter(ctx, 'lowpass', Math.min(st.lowpass, ctx.sampleRate * 0.45), 0.6);
    const lpWet = filter(ctx, 'lowpass', Math.min(st.lowpass, ctx.sampleRate * 0.45), 0.6);
    lpOut.connect(out);
    lpWet.connect(wet);
    ORDER.forEach((k, i) => {
      const level = st.layers[k] ?? 0;
      if (level > 0) LAYERS[k](ctx, lpOut, lpWet, rnd, level, 1100 + s * 37 + i * 7);
    });
  };
}

/** The crowd murmur of the hubs: voiced noise bands opening and closing at speech rate, a cough, a laugh. */
export const cityCrowd: Builder = (ctx, out, wet, rnd) => {
  for (let i = 0; i < 6; i++) {
    breath(ctx, i % 2 ? wet : out, 'pink', 'bandpass', 300 + i * 160 + rnd() * 60, 5, 0.04, 2.2 + rnd() * 2.8, 0.9, 1200 + i);
  }
  breath(ctx, out, 'pink', 'lowpass', 450, 0.6, 0.03, 0.07, 0.3, 1210);
  for (let i = 0; i < 4; i++) noiseHit(ctx, wet, rnd() * (CITY_BED_SECONDS - 1), 0.18, 0.03, 'bandpass', 500 + rnd() * 400, 2, 'pink', 1220 + i);
  for (let i = 0; i < 3; i++) metalHit(ctx, wet, rnd() * (CITY_BED_SECONDS - 1), 300 + rnd() * 300, 0.02, 0.4);
};
