import { envelope, fmBell, filter, gain, metalHit, midi, noiseBuffer, noiseHit, osc, saturator, type Builder } from './dsp';

export type Sfx =
  | 'click' | 'open' | 'build' | 'place' | 'complete' | 'event' | 'levelup' | 'error'
  | 'research' | 'mission' | 'achievement' | 'collect' | 'door' | 'dig'
  | 'siren' | 'wind' | 'tape' | 'paper' | 'debris' | 'restore' | 'era' | 'lore'
  | 'fire' | 'splash' | 'powerDown' | 'skitter' | 'alarm' | 'extinguish' | 'fixed'
  | 'heart' | 'baby' | 'story' | 'radio' | 'choice'
  | 'tab' | 'switch' | 'whoosh' | 'modalOpen' | 'notify' | 'assign' | 'unassign' | 'coin' | 'unlock' | 'reveal'
  | 'depart' | 'elevator' | 'hiss' | 'type' | 'warn' | 'pulse' | 'thunder' | 'cheer' | 'steam' | 'engineStart'
  | 'powerUp' | 'drill' | 'crumble' | 'drip' | 'confirm' | 'cancel';

/** Air-raid siren: a detuned saw/sine pair gliding up, holding, and sinking, with a slow wobble. */
const siren: Builder = (ctx, out, wet) => {
  for (const [type, det] of [['sawtooth', -6], ['sine', 6]] as const) {
    const o = osc(ctx, type, 180, det);
    o.frequency.setValueAtTime(180, 0);
    o.frequency.linearRampToValueAtTime(560, 1.8);
    o.frequency.setValueAtTime(560, 3.2);
    o.frequency.linearRampToValueAtTime(220, 5.2);
    const lp = filter(ctx, 'lowpass', 1600, 0.8);
    const g = gain(ctx, 0);
    envelope(g.gain, 0, 0.08, 0.6, 3.4, 1.4);
    const trem = osc(ctx, 'sine', 5.5);
    const tremAmt = gain(ctx, 0.015);
    trem.connect(tremAmt).connect(g.gain);
    o.connect(lp).connect(g);
    g.connect(out);
    g.connect(wet);
    o.start(0);
    trem.start(0);
    o.stop(5.6);
    trem.stop(5.6);
  }
};

export interface SfxDef {
  seconds: number;
  reverb: number;
  build: Builder;
}

export const SFX: Record<Sfx, SfxDef> = {
  click: {
    seconds: 0.35, reverb: 0.25,
    build: (ctx, out) => {
      noiseHit(ctx, out, 0, 0.025, 0.25, 'highpass', 3500, 0.7);
      const o = osc(ctx, 'square', 1500);
      const lp = filter(ctx, 'lowpass', 3000);
      const g = gain(ctx, 0);
      envelope(g.gain, 0, 0.06, 0.002, 0, 0.05);
      o.connect(lp).connect(g).connect(out);
      o.start(0);
      o.stop(0.1);
    },
  },
  open: {
    seconds: 0.6, reverb: 0.35,
    build: (ctx, out) => {
      noiseHit(ctx, out, 0, 0.18, 0.12, 'bandpass', 1800, 2);
      const o = osc(ctx, 'sine', 600);
      o.frequency.exponentialRampToValueAtTime(1100, 0.12);
      const g = gain(ctx, 0);
      envelope(g.gain, 0, 0.08, 0.01, 0.04, 0.2);
      o.connect(g).connect(out);
      o.start(0);
      o.stop(0.4);
    },
  },
  place: {
    seconds: 1.2, reverb: 0.5,
    build: (ctx, out, wet) => {
      noiseHit(ctx, out, 0, 0.35, 0.5, 'lowpass', 400, 1, 'brown');
      metalHit(ctx, out, 0.02, 180, 0.18, 0.7);
      metalHit(ctx, wet, 0.02, 180, 0.08, 0.9);
    },
  },
  build: {
    seconds: 1.8, reverb: 0.6,
    build: (ctx, out, wet, rnd) => {
      for (let i = 0; i < 3; i++) {
        const t = i * 0.28 + rnd() * 0.03;
        metalHit(ctx, out, t, 240 + rnd() * 60, 0.22, 0.45);
        metalHit(ctx, wet, t, 240 + rnd() * 60, 0.08, 0.6);
        noiseHit(ctx, out, t, 0.06, 0.3, 'bandpass', 2600, 1.5);
      }
      noiseHit(ctx, out, 0.9, 0.5, 0.2, 'lowpass', 300, 1, 'brown');
    },
  },
  complete: {
    seconds: 2.4, reverb: 0.8,
    build: (ctx, out, wet) => {
      [67, 71, 74, 79].forEach((n, i) => {
        fmBell(ctx, out, i * 0.09, midi(n), 0.12, 1.4, 2.01, 1.2);
        fmBell(ctx, wet, i * 0.09, midi(n), 0.06, 1.8, 2.01, 1.2);
      });
    },
  },
  event: {
    seconds: 2.2, reverb: 0.7,
    build: (ctx, out, wet) => {
      for (let i = 0; i < 2; i++) {
        const t = i * 0.55;
        const o = osc(ctx, 'sawtooth', 620);
        o.frequency.setValueAtTime(620, t);
        o.frequency.linearRampToValueAtTime(820, t + 0.4);
        const lp = filter(ctx, 'lowpass', 2200, 3);
        const g = gain(ctx, 0);
        envelope(g.gain, t, 0.12, 0.02, 0.3, 0.12);
        o.connect(saturator(ctx, 3)).connect(lp).connect(g);
        g.connect(out);
        g.connect(wet);
        o.start(t);
        o.stop(t + 0.5);
      }
    },
  },
  levelup: {
    seconds: 2.4, reverb: 0.8,
    build: (ctx, out, wet) => {
      noiseHit(ctx, wet, 0, 0.9, 0.12, 'bandpass', 900, 1.2, 'pink');
      [60, 64, 67, 72, 76].forEach((n, i) => fmBell(ctx, out, 0.15 + i * 0.07, midi(n), 0.08, 1.6, 1.01, 0.8));
    },
  },
  error: {
    seconds: 0.8, reverb: 0.3,
    build: (ctx, out) => {
      const o = osc(ctx, 'square', 110);
      const o2 = osc(ctx, 'square', 116);
      const lp = filter(ctx, 'lowpass', 900);
      const g = gain(ctx, 0);
      envelope(g.gain, 0, 0.12, 0.01, 0.18, 0.15);
      o.connect(lp);
      o2.connect(lp);
      lp.connect(g).connect(out);
      o.start(0);
      o2.start(0);
      o.stop(0.5);
      o2.stop(0.5);
    },
  },
  research: {
    seconds: 2.6, reverb: 0.9,
    build: (ctx, out, wet) => {
      [72, 79, 84, 88, 91].forEach((n, i) => {
        fmBell(ctx, out, i * 0.06, midi(n), 0.06, 1.2, 4.0, 2);
        fmBell(ctx, wet, i * 0.06, midi(n), 0.04, 2, 4.0, 2);
      });
    },
  },
  mission: {
    seconds: 1.4, reverb: 0.4,
    build: (ctx, out) => {
      noiseHit(ctx, out, 0, 0.12, 0.2, 'bandpass', 2400, 4);
      [0, 0.16, 0.32].forEach((t, i) => {
        const o = osc(ctx, 'square', i === 1 ? 900 : 1200);
        const bp = filter(ctx, 'bandpass', 1200, 3);
        const g = gain(ctx, 0);
        envelope(g.gain, t + 0.12, 0.05, 0.005, 0.06, 0.04);
        o.connect(bp).connect(g).connect(out);
        o.start(t + 0.12);
        o.stop(t + 0.3);
      });
      noiseHit(ctx, out, 0.62, 0.2, 0.12, 'bandpass', 2400, 4);
    },
  },
  achievement: {
    seconds: 3.2, reverb: 0.9,
    build: (ctx, out, wet) => {
      const chord = [60, 64, 67, 72];
      chord.forEach((n, i) => {
        for (const det of [-7, 7]) {
          const o = osc(ctx, 'sawtooth', midi(n), det);
          const lp = filter(ctx, 'lowpass', 600, 1);
          lp.frequency.setValueAtTime(600, i * 0.08);
          lp.frequency.exponentialRampToValueAtTime(3200, i * 0.08 + 0.25);
          lp.frequency.exponentialRampToValueAtTime(900, 2);
          const g = gain(ctx, 0);
          envelope(g.gain, i * 0.08, 0.05, 0.05, 0.8, 1.2);
          o.connect(lp).connect(g);
          g.connect(out);
          g.connect(wet);
          o.start(i * 0.08);
          o.stop(2.4);
        }
      });
    },
  },
  collect: {
    seconds: 1, reverb: 0.5,
    build: (ctx, out, wet) => {
      fmBell(ctx, out, 0, midi(84), 0.1, 0.6, 2.0, 1.5);
      fmBell(ctx, out, 0.07, midi(91), 0.08, 0.7, 2.0, 1.5);
      fmBell(ctx, wet, 0.07, midi(91), 0.04, 0.9, 2.0, 1.5);
    },
  },
  door: {
    seconds: 3.5, reverb: 0.8,
    build: (ctx, out, wet) => {
      noiseHit(ctx, out, 0, 1.6, 0.25, 'lowpass', 220, 1, 'brown');
      metalHit(ctx, out, 1.4, 70, 0.4, 2);
      metalHit(ctx, wet, 1.4, 70, 0.2, 2.5);
      noiseHit(ctx, out, 1.5, 1.2, 0.08, 'highpass', 4000, 0.7);
    },
  },
  dig: {
    seconds: 3, reverb: 0.7,
    build: (ctx, out, wet, rnd) => {
      const o = osc(ctx, 'sawtooth', 55);
      const lp = filter(ctx, 'lowpass', 300);
      const g = gain(ctx, 0);
      envelope(g.gain, 0, 0.15, 0.2, 1.2, 0.6);
      o.connect(saturator(ctx, 4)).connect(lp).connect(g).connect(out);
      o.start(0);
      o.stop(2.2);
      for (let i = 0; i < 10; i++) noiseHit(ctx, rnd() < 0.5 ? out : wet, 0.3 + rnd() * 2, 0.15, 0.2, 'lowpass', 900 + rnd() * 900, 1, 'brown', 30 + i);
    },
  },
  siren: { seconds: 6.5, reverb: 1, build: siren },
  wind: {
    seconds: 5, reverb: 0.6,
    build: (ctx, out, wet) => {
      for (const [f, q, lvl, seed] of [[500, 1.5, 0.25, 61], [1400, 3, 0.1, 62]] as const) {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer(ctx, 5.2, 'pink', seed);
        const bp = filter(ctx, 'bandpass', f, q);
        bp.frequency.setValueAtTime(f * 0.6, 0);
        bp.frequency.linearRampToValueAtTime(f * 1.4, 2.2);
        bp.frequency.linearRampToValueAtTime(f * 0.8, 4.8);
        const g = gain(ctx, 0);
        envelope(g.gain, 0, lvl, 1.4, 1.8, 1.6);
        src.connect(bp).connect(g);
        g.connect(out);
        g.connect(wet);
        src.start(0);
      }
    },
  },
  tape: {
    seconds: 1.6, reverb: 0.2,
    build: (ctx, out) => {
      noiseHit(ctx, out, 0, 0.03, 0.4, 'bandpass', 2500, 2);
      noiseHit(ctx, out, 0.05, 0.04, 0.25, 'lowpass', 900, 1, 'brown');
      const motor = osc(ctx, 'sawtooth', 50);
      motor.frequency.setValueAtTime(30, 0.06);
      motor.frequency.exponentialRampToValueAtTime(110, 0.5);
      const lp = filter(ctx, 'lowpass', 500);
      const g = gain(ctx, 0);
      envelope(g.gain, 0.06, 0.06, 0.1, 0.7, 0.5);
      motor.connect(saturator(ctx, 3)).connect(lp).connect(g).connect(out);
      motor.start(0.06);
      motor.stop(1.5);
      noiseHit(ctx, out, 0.3, 1.2, 0.05, 'highpass', 5000, 0.7);
    },
  },
  paper: {
    seconds: 0.9, reverb: 0.2,
    build: (ctx, out, _wet, rnd) => {
      for (let i = 0; i < 7; i++) noiseHit(ctx, out, i * 0.07 + rnd() * 0.05, 0.05 + rnd() * 0.06, 0.12 + rnd() * 0.1, 'bandpass', 2500 + rnd() * 3500, 1.5, 'white', 70 + i);
    },
  },
  debris: {
    seconds: 1.4, reverb: 0.5,
    build: (ctx, out, wet, rnd) => {
      noiseHit(ctx, out, 0, 0.4, 0.4, 'lowpass', 500, 1, 'brown', 80);
      for (let i = 0; i < 9; i++) {
        const t = 0.05 + rnd() * 0.8;
        noiseHit(ctx, out, t, 0.05 + rnd() * 0.08, 0.2 + rnd() * 0.2, 'bandpass', 600 + rnd() * 1800, 2, 'pink', 81 + i);
        if (rnd() < 0.4) metalHit(ctx, rnd() < 0.5 ? out : wet, t, 300 + rnd() * 600, 0.06, 0.3);
      }
    },
  },
  restore: {
    seconds: 3.4, reverb: 0.7,
    build: (ctx, out, wet) => {
      const o = osc(ctx, 'sawtooth', 28);
      o.frequency.setValueAtTime(22, 0);
      o.frequency.exponentialRampToValueAtTime(55, 1.6);
      const lp = filter(ctx, 'lowpass', 120, 2);
      lp.frequency.setValueAtTime(120, 0);
      lp.frequency.exponentialRampToValueAtTime(900, 1.6);
      const g = gain(ctx, 0);
      envelope(g.gain, 0, 0.22, 0.6, 1.2, 0.9);
      o.connect(saturator(ctx, 3)).connect(lp).connect(g).connect(out);
      o.start(0);
      o.stop(3);
      metalHit(ctx, out, 0.05, 90, 0.25, 0.8);
      metalHit(ctx, wet, 1.65, 140, 0.18, 1.2);
      [72, 79].forEach((n, i) => fmBell(ctx, wet, 1.7 + i * 0.12, midi(n), 0.08, 1.2, 2.01, 1));
    },
  },
  era: {
    seconds: 6, reverb: 1,
    build: (ctx, out, wet) => {
      const boom = osc(ctx, 'sine', 70);
      boom.frequency.exponentialRampToValueAtTime(32, 1.6);
      const bg = gain(ctx, 0);
      envelope(bg.gain, 0, 0.5, 0.01, 0.2, 2.2);
      boom.connect(bg).connect(out);
      boom.start(0);
      boom.stop(3);
      noiseHit(ctx, wet, 0, 2, 0.15, 'lowpass', 400, 1, 'brown', 90);
      // A brass-like swell: detuned saws behind a filter that blooms open.
      [50, 57, 62, 66, 69].forEach((n, i) => {
        for (const det of [-9, 9]) {
          const o = osc(ctx, 'sawtooth', midi(n), det);
          const lp = filter(ctx, 'lowpass', 300, 1.2);
          lp.frequency.setValueAtTime(300, 0.2);
          lp.frequency.exponentialRampToValueAtTime(2400, 1.8);
          lp.frequency.exponentialRampToValueAtTime(700, 5);
          const g = gain(ctx, 0);
          envelope(g.gain, 0.2 + i * 0.04, 0.035, 1.2, 1.8, 2);
          o.connect(lp).connect(g);
          g.connect(out);
          g.connect(wet);
          o.start(0.2);
          o.stop(5.6);
        }
      });
      [74, 78, 81, 86].forEach((n, i) => fmBell(ctx, wet, 1.4 + i * 0.18, midi(n), 0.06, 2.4, 3.01, 1.5));
    },
  },
  lore: {
    seconds: 3, reverb: 0.9,
    build: (ctx, out, wet) => {
      fmBell(ctx, out, 0, midi(69), 0.1, 2.2, 1.41, 2);
      fmBell(ctx, wet, 0.35, midi(72), 0.08, 2.4, 1.41, 2);
      fmBell(ctx, wet, 0.7, midi(76), 0.06, 2.4, 1.41, 2);
      const pad = osc(ctx, 'triangle', midi(57));
      const g = gain(ctx, 0);
      envelope(g.gain, 0, 0.05, 0.8, 0.6, 1.4);
      pad.connect(g).connect(wet);
      pad.start(0);
      pad.stop(3);
    },
  },
  // ---- Sprint 6: crises, families, story ----
  fire: {
    seconds: 2.4, reverb: 0.4,
    build: (ctx, out, wet, rnd) => {
      noiseHit(ctx, out, 0, 2.2, 0.22, 'lowpass', 480, 0.8, 'brown', 101);
      for (let i = 0; i < 28; i++) {
        noiseHit(ctx, rnd() < 0.8 ? out : wet, rnd() * 2.1, 0.006 + rnd() * 0.02, 0.12 + rnd() * 0.3, 'highpass', 1800 + rnd() * 3000, 0.8, 'white', 102 + i);
      }
    },
  },
  splash: {
    seconds: 1.2, reverb: 0.5,
    build: (ctx, out, wet, rnd) => {
      noiseHit(ctx, out, 0, 0.32, 0.35, 'bandpass', 1400, 0.9, 'white', 130);
      noiseHit(ctx, wet, 0.05, 0.6, 0.12, 'lowpass', 800, 1, 'pink', 131);
      for (let i = 0; i < 6; i++) {
        const t = 0.1 + rnd() * 0.6;
        const o = osc(ctx, 'sine', 500);
        o.frequency.setValueAtTime(380 + rnd() * 400, t);
        o.frequency.exponentialRampToValueAtTime(900 + rnd() * 900, t + 0.06);
        const g = gain(ctx, 0);
        envelope(g.gain, t, 0.06, 0.005, 0.01, 0.05);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + 0.12);
      }
    },
  },
  powerDown: {
    seconds: 2.2, reverb: 0.6,
    build: (ctx, out, wet) => {
      const o = osc(ctx, 'sawtooth', 420);
      o.frequency.exponentialRampToValueAtTime(40, 1.6);
      const lp = filter(ctx, 'lowpass', 1800);
      lp.frequency.exponentialRampToValueAtTime(200, 1.6);
      const g = gain(ctx, 0);
      envelope(g.gain, 0, 0.16, 0.02, 1.2, 0.4);
      o.connect(lp).connect(g);
      g.connect(out);
      g.connect(wet);
      o.start(0);
      o.stop(1.9);
      metalHit(ctx, out, 0, 120, 0.25, 0.4);
      noiseHit(ctx, out, 0, 0.05, 0.3, 'highpass', 3000, 0.7);
    },
  },
  skitter: {
    seconds: 1.6, reverb: 0.2,
    build: (ctx, out, _wet, rnd) => {
      for (let i = 0; i < 40; i++) noiseHit(ctx, out, rnd() * 1.4, 0.004 + rnd() * 0.006, 0.08 + rnd() * 0.14, 'bandpass', 3500 + rnd() * 4000, 4, 'white', 140 + i);
    },
  },
  alarm: {
    seconds: 2.2, reverb: 0.7,
    build: (ctx, out, wet) => {
      for (let i = 0; i < 4; i++) {
        const t = i * 0.45;
        const o = osc(ctx, 'square', i % 2 ? 660 : 880);
        const lp = filter(ctx, 'lowpass', 2600, 2);
        const g = gain(ctx, 0);
        envelope(g.gain, t, 0.09, 0.01, 0.34, 0.06);
        o.connect(saturator(ctx, 2)).connect(lp).connect(g);
        g.connect(out);
        g.connect(wet);
        o.start(t);
        o.stop(t + 0.44);
      }
    },
  },
  extinguish: {
    seconds: 2, reverb: 0.5,
    build: (ctx, out, wet) => {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, 1.8, 'white', 150);
      const hp = filter(ctx, 'highpass', 5000, 0.7);
      hp.frequency.setValueAtTime(6000, 0);
      hp.frequency.exponentialRampToValueAtTime(1200, 1.6);
      const g = gain(ctx, 0);
      envelope(g.gain, 0, 0.22, 0.02, 0.9, 0.8);
      src.connect(hp).connect(g);
      g.connect(out);
      g.connect(wet);
      src.start(0);
    },
  },
  fixed: {
    seconds: 2.2, reverb: 0.8,
    build: (ctx, out, wet) => {
      [62, 66, 69, 74].forEach((n, i) => {
        fmBell(ctx, out, i * 0.08, midi(n), 0.09, 1.2, 2.01, 1.1);
        fmBell(ctx, wet, i * 0.08, midi(n), 0.05, 1.6, 2.01, 1.1);
      });
      metalHit(ctx, out, 0, 220, 0.12, 0.5);
    },
  },
  heart: {
    seconds: 2.8, reverb: 0.9,
    build: (ctx, out, wet) => {
      fmBell(ctx, out, 0, midi(76), 0.08, 1.8, 1.0, 0.6);
      fmBell(ctx, out, 0.22, midi(80), 0.07, 1.8, 1.0, 0.6);
      fmBell(ctx, wet, 0.44, midi(83), 0.06, 2.2, 1.0, 0.6);
      const pad = osc(ctx, 'triangle', midi(64));
      const g = gain(ctx, 0);
      envelope(g.gain, 0, 0.05, 0.6, 0.8, 1.2);
      pad.connect(g).connect(wet);
      pad.start(0);
      pad.stop(2.8);
    },
  },
  baby: {
    seconds: 3, reverb: 0.9,
    build: (ctx, out, wet) => {
      // A little music-box tune.
      [79, 76, 79, 84, 83, 79].forEach((n, i) => {
        fmBell(ctx, out, i * 0.2, midi(n), 0.07, 0.9, 3.5, 1.4);
        fmBell(ctx, wet, i * 0.2, midi(n), 0.03, 1.2, 3.5, 1.4);
      });
    },
  },
  story: {
    seconds: 4.5, reverb: 1,
    build: (ctx, out, wet) => {
      for (const det of [-5, 5]) {
        const o = osc(ctx, 'sawtooth', midi(38), det);
        const lp = filter(ctx, 'lowpass', 260, 1);
        const g = gain(ctx, 0);
        envelope(g.gain, 0, 0.06, 1, 1.6, 1.8);
        o.connect(lp).connect(g);
        g.connect(out);
        g.connect(wet);
        o.start(0);
        o.stop(4.4);
      }
      fmBell(ctx, wet, 0.6, midi(62), 0.08, 3, 1.41, 2);
      fmBell(ctx, wet, 1.4, midi(69), 0.06, 3, 1.41, 2);
    },
  },
  radio: {
    seconds: 0.9, reverb: 0.2,
    build: (ctx, out) => {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, 0.5, 'white', 160);
      const bp = filter(ctx, 'bandpass', 1800, 1.5);
      const g = gain(ctx, 0);
      envelope(g.gain, 0, 0.12, 0.01, 0.25, 0.12);
      const trem = osc(ctx, 'square', 31);
      const tAmt = gain(ctx, 0.05);
      trem.connect(tAmt).connect(g.gain);
      src.connect(bp).connect(g).connect(out);
      src.start(0);
      trem.start(0);
      trem.stop(0.5);
      const beep = osc(ctx, 'sine', 1320);
      const bg = gain(ctx, 0);
      envelope(bg.gain, 0.42, 0.05, 0.005, 0.08, 0.03);
      beep.connect(bg).connect(out);
      beep.start(0.42);
      beep.stop(0.6);
    },
  },
  choice: {
    seconds: 1.2, reverb: 0.6,
    build: (ctx, out, wet) => {
      noiseHit(ctx, out, 0, 0.03, 0.2, 'highpass', 3000, 0.7);
      fmBell(ctx, out, 0.02, midi(74), 0.08, 0.8, 2.01, 1);
      fmBell(ctx, wet, 0.1, midi(81), 0.05, 1, 2.01, 1);
    },
  },
  // ---- Sprint 8: the second sound pass ----
  tab: {
    seconds: 0.3, reverb: 0.2,
    build: (ctx, out) => {
      noiseHit(ctx, out, 0, 0.02, 0.2, 'bandpass', 2600, 2);
      const o = osc(ctx, 'triangle', 880);
      o.frequency.exponentialRampToValueAtTime(1320, 0.05);
      const g = gain(ctx, 0);
      envelope(g.gain, 0, 0.05, 0.003, 0.02, 0.06);
      o.connect(g).connect(out);
      o.start(0);
      o.stop(0.15);
    },
  },
  switch: {
    seconds: 0.4, reverb: 0.25,
    build: (ctx, out) => {
      metalHit(ctx, out, 0, 1900, 0.12, 0.05);
      noiseHit(ctx, out, 0.035, 0.015, 0.25, 'highpass', 3000, 0.7);
      metalHit(ctx, out, 0.04, 1300, 0.08, 0.06);
    },
  },
  whoosh: {
    seconds: 1, reverb: 0.4,
    build: (ctx, out, wet) => {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, 0.9, 'pink', 201);
      const bp = filter(ctx, 'bandpass', 400, 1.2);
      bp.frequency.setValueAtTime(300, 0);
      bp.frequency.exponentialRampToValueAtTime(2400, 0.45);
      bp.frequency.exponentialRampToValueAtTime(600, 0.85);
      const g = gain(ctx, 0);
      envelope(g.gain, 0, 0.25, 0.3, 0.05, 0.45);
      src.connect(bp).connect(g);
      g.connect(out);
      g.connect(wet);
      src.start(0);
    },
  },
  modalOpen: {
    seconds: 0.9, reverb: 0.5,
    build: (ctx, out, wet) => {
      // CRT power-on: a rising whine and a soft thump.
      const o = osc(ctx, 'sine', 3000);
      o.frequency.exponentialRampToValueAtTime(9000, 0.25);
      const g = gain(ctx, 0);
      envelope(g.gain, 0, 0.025, 0.02, 0.1, 0.2);
      o.connect(g).connect(out);
      o.start(0);
      o.stop(0.5);
      noiseHit(ctx, out, 0, 0.12, 0.2, 'lowpass', 300, 1, 'brown', 202);
      fmBell(ctx, wet, 0.05, midi(81), 0.03, 0.5, 2.01, 1);
    },
  },
  notify: {
    seconds: 1.2, reverb: 0.6,
    build: (ctx, out, wet) => {
      fmBell(ctx, out, 0, midi(76), 0.08, 0.6, 3.01, 1.2);
      fmBell(ctx, out, 0.12, midi(83), 0.07, 0.8, 3.01, 1.2);
      fmBell(ctx, wet, 0.12, midi(83), 0.04, 1, 3.01, 1.2);
    },
  },
  assign: {
    seconds: 0.8, reverb: 0.35,
    build: (ctx, out) => {
      metalHit(ctx, out, 0, 520, 0.12, 0.15);
      fmBell(ctx, out, 0.06, midi(72), 0.06, 0.4, 2.01, 0.8);
      fmBell(ctx, out, 0.13, midi(79), 0.06, 0.5, 2.01, 0.8);
    },
  },
  unassign: {
    seconds: 0.7, reverb: 0.3,
    build: (ctx, out) => {
      fmBell(ctx, out, 0, midi(79), 0.05, 0.4, 2.01, 0.8);
      fmBell(ctx, out, 0.08, midi(72), 0.05, 0.4, 2.01, 0.8);
      noiseHit(ctx, out, 0.1, 0.05, 0.1, 'lowpass', 600, 1, 'brown', 203);
    },
  },
  coin: {
    seconds: 0.9, reverb: 0.5,
    build: (ctx, out, wet) => {
      metalHit(ctx, out, 0, 2600, 0.12, 0.35);
      metalHit(ctx, wet, 0.07, 3400, 0.08, 0.5);
      fmBell(ctx, out, 0.07, midi(96), 0.04, 0.4, 2.76, 1.5);
    },
  },
  unlock: {
    seconds: 1.8, reverb: 0.8,
    build: (ctx, out, wet) => {
      metalHit(ctx, out, 0, 380, 0.15, 0.2);
      metalHit(ctx, out, 0.12, 620, 0.12, 0.2);
      [64, 71, 76, 83].forEach((n, i) => fmBell(ctx, wet, 0.2 + i * 0.07, midi(n), 0.06, 1.2, 2.01, 1));
    },
  },
  reveal: {
    seconds: 1.6, reverb: 0.9,
    build: (ctx, out, wet) => {
      const pad = osc(ctx, 'triangle', midi(69));
      const g = gain(ctx, 0);
      envelope(g.gain, 0, 0.05, 0.3, 0.3, 0.8);
      pad.connect(g);
      g.connect(out);
      g.connect(wet);
      pad.start(0);
      pad.stop(1.5);
      fmBell(ctx, wet, 0.15, midi(88), 0.04, 1, 1.41, 1.5);
    },
  },
  depart: {
    seconds: 2.2, reverb: 0.6,
    build: (ctx, out, wet, rnd) => {
      // Boots on gravel heading out, and the door grinding shut behind them.
      for (let i = 0; i < 8; i++) noiseHit(ctx, out, i * 0.17 + rnd() * 0.03, 0.06, 0.18 * (1 - i / 10), 'bandpass', 900 + rnd() * 300, 2, 'pink', 204 + i);
      noiseHit(ctx, out, 1.3, 0.6, 0.12, 'lowpass', 220, 1, 'brown', 215);
      metalHit(ctx, wet, 1.85, 80, 0.2, 1);
    },
  },
  elevator: {
    seconds: 1.4, reverb: 0.6,
    build: (ctx, out, wet) => {
      fmBell(ctx, out, 0, midi(81), 0.08, 1.1, 1.0, 0.4);
      fmBell(ctx, wet, 0.18, midi(76), 0.07, 1.2, 1.0, 0.4);
    },
  },
  hiss: {
    seconds: 1, reverb: 0.4,
    build: (ctx, out) => {
      noiseHit(ctx, out, 0, 0.6, 0.18, 'highpass', 4500, 0.7, 'white', 216);
      metalHit(ctx, out, 0.55, 160, 0.12, 0.25);
    },
  },
  type: {
    seconds: 0.12, reverb: 0.1,
    build: (ctx, out) => noiseHit(ctx, out, 0, 0.012, 0.15, 'bandpass', 3800, 3, 'white', 217),
  },
  warn: {
    seconds: 1.2, reverb: 0.4,
    build: (ctx, out) => {
      for (let i = 0; i < 2; i++) {
        const o = osc(ctx, 'square', 440);
        const lp = filter(ctx, 'lowpass', 1500);
        const g = gain(ctx, 0);
        envelope(g.gain, i * 0.3, 0.06, 0.005, 0.16, 0.04);
        o.connect(lp).connect(g).connect(out);
        o.start(i * 0.3);
        o.stop(i * 0.3 + 0.25);
      }
    },
  },
  pulse: {
    seconds: 1.4, reverb: 0.3,
    build: (ctx, out) => {
      for (const t of [0, 0.28]) {
        const o = osc(ctx, 'sine', 62);
        o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
        const g = gain(ctx, 0);
        envelope(g.gain, t, t ? 0.18 : 0.25, 0.01, 0.03, 0.15);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + 0.3);
      }
    },
  },
  thunder: {
    seconds: 5, reverb: 1,
    build: (ctx, out, wet) => {
      noiseHit(ctx, out, 0, 0.25, 0.4, 'lowpass', 2000, 0.7, 'white', 218);
      noiseHit(ctx, out, 0.1, 3.8, 0.35, 'lowpass', 180, 0.9, 'brown', 219);
      noiseHit(ctx, wet, 0.2, 4, 0.2, 'lowpass', 400, 0.8, 'brown', 220);
    },
  },
  cheer: {
    seconds: 2.4, reverb: 0.7,
    build: (ctx, out, wet, rnd) => {
      // A small crowd: many short voiced bursts through vowel-like band filters.
      for (let i = 0; i < 16; i++) {
        const t = rnd() * 1.2;
        const o = osc(ctx, 'sawtooth', 180 + rnd() * 160);
        o.frequency.linearRampToValueAtTime(260 + rnd() * 200, t + 0.4);
        const bp = filter(ctx, 'bandpass', 700 + rnd() * 900, 4);
        const g = gain(ctx, 0);
        envelope(g.gain, t, 0.03, 0.05, 0.3 + rnd() * 0.4, 0.3);
        o.connect(bp).connect(g);
        g.connect(out);
        g.connect(wet);
        o.start(t);
        o.stop(t + 1.2);
      }
      for (let i = 0; i < 10; i++) noiseHit(ctx, out, 0.3 + rnd() * 1.2, 0.02, 0.15, 'bandpass', 1500, 1, 'white', 221 + i);
    },
  },
  steam: {
    seconds: 1.8, reverb: 0.4,
    build: (ctx, out, wet) => {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, 1.6, 'white', 232);
      const bp = filter(ctx, 'bandpass', 3500, 0.8);
      const g = gain(ctx, 0);
      envelope(g.gain, 0, 0.18, 0.05, 0.9, 0.6);
      src.connect(bp).connect(g);
      g.connect(out);
      g.connect(wet);
      src.start(0);
    },
  },
  engineStart: {
    seconds: 2.6, reverb: 0.6,
    build: (ctx, out, wet) => {
      const o = osc(ctx, 'sawtooth', 20);
      o.frequency.setValueAtTime(18, 0);
      o.frequency.linearRampToValueAtTime(14, 0.35);
      o.frequency.exponentialRampToValueAtTime(48, 1.6);
      const lp = filter(ctx, 'lowpass', 260, 2);
      const g = gain(ctx, 0);
      envelope(g.gain, 0, 0.26, 0.1, 1.6, 0.8);
      o.connect(saturator(ctx, 5)).connect(lp).connect(g);
      g.connect(out);
      g.connect(wet);
      o.start(0);
      o.stop(2.5);
      for (const t of [0.05, 0.2, 0.42]) metalHit(ctx, out, t, 110, 0.12, 0.2);
    },
  },
  powerUp: {
    seconds: 2, reverb: 0.6,
    build: (ctx, out, wet) => {
      const o = osc(ctx, 'sawtooth', 60);
      o.frequency.exponentialRampToValueAtTime(480, 1.2);
      const lp = filter(ctx, 'lowpass', 300);
      lp.frequency.exponentialRampToValueAtTime(2600, 1.2);
      const g = gain(ctx, 0);
      envelope(g.gain, 0, 0.12, 0.6, 0.4, 0.6);
      o.connect(lp).connect(g);
      g.connect(out);
      g.connect(wet);
      o.start(0);
      o.stop(1.9);
      fmBell(ctx, wet, 1.1, midi(84), 0.05, 0.8, 2.01, 1);
    },
  },
  drill: {
    seconds: 2.4, reverb: 0.5,
    build: (ctx, out, _wet, rnd) => {
      const o = osc(ctx, 'square', 95);
      const lp = filter(ctx, 'lowpass', 1400, 2);
      const g = gain(ctx, 0);
      envelope(g.gain, 0, 0.12, 0.05, 1.9, 0.3);
      const trem = osc(ctx, 'square', 22);
      const tAmt = gain(ctx, 0.05);
      trem.connect(tAmt).connect(g.gain);
      o.connect(saturator(ctx, 3)).connect(lp).connect(g).connect(out);
      o.start(0);
      trem.start(0);
      o.stop(2.3);
      trem.stop(2.3);
      for (let i = 0; i < 12; i++) noiseHit(ctx, out, rnd() * 2.2, 0.04, 0.08, 'bandpass', 1800 + rnd() * 1500, 2, 'white', 240 + i);
    },
  },
  crumble: {
    seconds: 1.6, reverb: 0.5,
    build: (ctx, out, wet, rnd) => {
      for (let i = 0; i < 14; i++) noiseHit(ctx, rnd() < 0.7 ? out : wet, rnd() * 1.2, 0.05 + rnd() * 0.1, 0.12 + rnd() * 0.12, 'lowpass', 500 + rnd() * 1200, 1, 'brown', 260 + i);
    },
  },
  drip: {
    seconds: 1.2, reverb: 0.9,
    build: (ctx, out, wet) => {
      const o = osc(ctx, 'sine', 900);
      o.frequency.setValueAtTime(700, 0);
      o.frequency.exponentialRampToValueAtTime(1700, 0.05);
      const g = gain(ctx, 0);
      envelope(g.gain, 0, 0.1, 0.002, 0.01, 0.08);
      o.connect(g);
      g.connect(out);
      g.connect(wet);
      o.start(0);
      o.stop(0.15);
    },
  },
  confirm: {
    seconds: 1.4, reverb: 0.6,
    build: (ctx, out, wet) => {
      metalHit(ctx, out, 0, 300, 0.15, 0.25);
      [67, 74, 79].forEach((n, i) => fmBell(ctx, i ? wet : out, 0.04 + i * 0.06, midi(n), 0.07, 1, 2.01, 1));
    },
  },
  cancel: {
    seconds: 0.6, reverb: 0.3,
    build: (ctx, out) => {
      const o = osc(ctx, 'triangle', 660);
      o.frequency.exponentialRampToValueAtTime(330, 0.18);
      const g = gain(ctx, 0);
      envelope(g.gain, 0, 0.07, 0.005, 0.08, 0.1);
      o.connect(g).connect(out);
      o.start(0);
      o.stop(0.3);
    },
  },
};
