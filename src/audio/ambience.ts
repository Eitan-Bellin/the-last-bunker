import { envelope, fmBell, filter, gain, metalHit, noiseBuffer, noiseHit, osc, type Builder } from './dsp';
import type { BuildingType } from '../core/GameState';

export const AMBIENCE_SECONDS = 8;

export type AmbienceKey = 'base' | 'machine' | 'water' | 'air' | 'workshop' | 'medical' | 'kitchen' | 'electronics' | 'radio' | 'reactor';

export const AMBIENCE_FOR: Partial<Record<BuildingType, AmbienceKey>> = {
  generator: 'machine',
  reactor: 'reactor',
  waterPump: 'water',
  waterPurifier: 'water',
  farm: 'air',
  hydroponics: 'air',
  quarters: 'air',
  storage: 'air',
  trainingRoom: 'air',
  workshop: 'workshop',
  armory: 'workshop',
  medbay: 'medical',
  canteen: 'kitchen',
  laboratory: 'electronics',
  radioTower: 'radio',
  cave: 'water',
  lake: 'water',
  metro: 'air',
  atrium: 'air',
  reactorHall: 'reactor',
  // [plan4:BL-9..14,19,33]
  batteryBank: 'machine',
  commons: 'kitchen',
  library: 'air',
  recycler: 'workshop',
  condenser: 'water',
  mushroomFarm: 'air',
  gatePost: 'base',
  barracks: 'base',
  // [plan4:BL-15..32]
  quarantineWard: 'medical', solarArray: 'air', windTurbine: 'air', watchtower: 'air', garage: 'workshop', decon: 'water',
  aquaculture: 'water', market: 'kitchen', nursery: 'base', school: 'base', bathhouse: 'water', memorialHall: 'air',
};

function loopNoise(ctx: OfflineAudioContext, dest: AudioNode, color: 'white' | 'pink' | 'brown', type: BiquadFilterType, freq: number, q: number, level: number, seed: number): void {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, AMBIENCE_SECONDS + 2, color, seed);
  const f = filter(ctx, type, freq, q);
  const g = gain(ctx, level);
  src.connect(f).connect(g).connect(dest);
  src.start(0);
}

function hum(ctx: OfflineAudioContext, dest: AudioNode, base: number, level: number, wobble: number): void {
  const g = gain(ctx, level);
  const trem = osc(ctx, 'sine', wobble);
  const tremAmt = gain(ctx, level * 0.35);
  trem.connect(tremAmt).connect(g.gain);
  trem.start(0);
  const lp = filter(ctx, 'lowpass', base * 6, 0.8);
  for (const [mult, type] of [[1, 'sawtooth'], [2, 'sine'], [3, 'triangle']] as const) {
    const o = osc(ctx, type, base * mult);
    o.connect(lp);
    o.start(0);
  }
  lp.connect(g).connect(dest);
}

export const AMBIENCE: Record<AmbienceKey, Builder> = {
  base: (ctx, out, wet, rnd) => {
    hum(ctx, out, 49, 0.02, 0.2);
    loopNoise(ctx, out, 'brown', 'lowpass', 160, 0.7, 0.05, 41);
    for (let i = 0; i < 3; i++) {
      const t = 0.5 + rnd() * (AMBIENCE_SECONDS - 1);
      fmBell(ctx, wet, t, 1800 + rnd() * 900, 0.03, 0.25, 1.0, 0.6);
    }
    metalHit(ctx, wet, 2 + rnd() * 4, 95 + rnd() * 40, 0.03, 1.6);
  },
  machine: (ctx, out, _wet, rnd) => {
    hum(ctx, out, 50, 0.08, 6.5);
    loopNoise(ctx, out, 'pink', 'bandpass', 900, 1.5, 0.04, 43);
    for (let t = 0; t < AMBIENCE_SECONDS; t += 0.25) noiseHit(ctx, out, t + rnd() * 0.02, 0.05, 0.05, 'bandpass', 2400, 3, 'white', 44);
  },
  reactor: (ctx, out, wet) => {
    hum(ctx, out, 36.7, 0.09, 0.5);
    hum(ctx, wet, 73.4, 0.03, 0.25);
    loopNoise(ctx, out, 'pink', 'highpass', 5000, 0.7, 0.012, 45);
  },
  water: (ctx, out, wet, rnd) => {
    loopNoise(ctx, out, 'pink', 'bandpass', 600, 0.9, 0.05, 46);
    for (let i = 0; i < 26; i++) {
      const t = rnd() * (AMBIENCE_SECONDS - 0.2);
      const o = osc(ctx, 'sine', 400 + rnd() * 700);
      o.frequency.setValueAtTime(400 + rnd() * 700, t);
      o.frequency.exponentialRampToValueAtTime(900 + rnd() * 900, t + 0.06);
      const g = gain(ctx, 0);
      envelope(g.gain, t, 0.025, 0.003, 0, 0.06);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.1);
    }
    for (let i = 0; i < 3; i++) fmBell(ctx, wet, rnd() * AMBIENCE_SECONDS, 1400 + rnd() * 600, 0.04, 0.2, 1.0, 0.4);
  },
  air: (ctx, out) => {
    loopNoise(ctx, out, 'pink', 'lowpass', 700, 0.6, 0.06, 47);
    hum(ctx, out, 120, 0.008, 0.3);
  },
  workshop: (ctx, out, wet, rnd) => {
    loopNoise(ctx, out, 'brown', 'lowpass', 300, 0.7, 0.03, 48);
    for (let i = 0; i < 4; i++) {
      const t = rnd() * (AMBIENCE_SECONDS - 1);
      metalHit(ctx, out, t, 300 + rnd() * 400, 0.08, 0.4);
      metalHit(ctx, wet, t, 300 + rnd() * 400, 0.03, 0.6);
    }
    const t = 2 + rnd() * 3;
    noiseHit(ctx, out, t, 1.2, 0.05, 'bandpass', 3200, 6, 'white', 49);
  },
  medical: (ctx, out) => {
    loopNoise(ctx, out, 'pink', 'lowpass', 500, 0.6, 0.025, 50);
    for (let t = 0.3; t < AMBIENCE_SECONDS; t += 1) {
      const o = osc(ctx, 'sine', 1046);
      const g = gain(ctx, 0);
      envelope(g.gain, t, 0.03, 0.005, 0.07, 0.05);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.2);
    }
  },
  kitchen: (ctx, out, wet, rnd) => {
    loopNoise(ctx, out, 'pink', 'bandpass', 350, 1.2, 0.05, 51);
    for (let i = 0; i < 18; i++) noiseHit(ctx, out, rnd() * AMBIENCE_SECONDS, 0.04, 0.05, 'bandpass', 500 + rnd() * 400, 4, 'white', 52 + i);
    for (let i = 0; i < 3; i++) metalHit(ctx, wet, rnd() * AMBIENCE_SECONDS, 900 + rnd() * 500, 0.03, 0.3);
  },
  electronics: (ctx, out, _wet, rnd) => {
    hum(ctx, out, 60, 0.012, 0.1);
    loopNoise(ctx, out, 'white', 'highpass', 6000, 0.7, 0.01, 53);
    for (let i = 0; i < 6; i++) {
      const t = rnd() * (AMBIENCE_SECONDS - 0.3);
      const o = osc(ctx, 'square', [1320, 1760, 2093][Math.floor(rnd() * 3)]);
      const lp = filter(ctx, 'lowpass', 3000);
      const g = gain(ctx, 0);
      envelope(g.gain, t, 0.015, 0.002, 0.04, 0.02);
      o.connect(lp).connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.1);
    }
  },
  radio: (ctx, out, _wet, rnd) => {
    loopNoise(ctx, out, 'white', 'bandpass', 2200, 0.6, 0.035, 54);
    let t = 1 + rnd();
    while (t < AMBIENCE_SECONDS - 1) {
      const long = rnd() < 0.4;
      const o = osc(ctx, 'sine', 700);
      const g = gain(ctx, 0);
      envelope(g.gain, t, 0.03, 0.005, long ? 0.18 : 0.06, 0.01);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.3);
      t += long ? 0.32 : 0.16;
      if (rnd() < 0.15) t += 0.6;
    }
  },
};
