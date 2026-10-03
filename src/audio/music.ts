import { envelope, fmBell, filter, gain, metalHit, midi, noiseBuffer, osc, pan, saturator, type Builder } from './dsp';

export const LOOP_SECONDS = 64;
export const LOOP_TAIL = 8;

/** Detuned supersaw pad voice with slow attack, gently filtered. */
function padChord(ctx: OfflineAudioContext, dest: AudioNode, wet: AudioNode, notes: number[], t: number, dur: number, level: number, cutoff: number): void {
  for (const n of notes) {
    const f = midi(n);
    const lp = filter(ctx, 'lowpass', cutoff, 0.6);
    lp.frequency.setValueAtTime(cutoff * 0.6, t);
    lp.frequency.linearRampToValueAtTime(cutoff * 1.3, t + dur * 0.5);
    lp.frequency.linearRampToValueAtTime(cutoff * 0.7, t + dur + 2);
    const g = gain(ctx, 0);
    envelope(g.gain, t, level / notes.length, 2.4, Math.max(0.1, dur - 2.4), 3.2);
    const p = pan(ctx, (n % 5) / 5 - 0.4);
    for (const det of [-9, -3, 4, 10]) {
      const o = osc(ctx, 'sawtooth', f, det);
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 3.4);
    }
    lp.connect(g).connect(p);
    p.connect(dest);
    p.connect(wet);
  }
}

function drone(ctx: OfflineAudioContext, dest: AudioNode, notes: number[], level: number, cutoff: number): void {
  const lp = filter(ctx, 'lowpass', cutoff, 1.2);
  const lfo = osc(ctx, 'sine', 0.045);
  const lfoAmt = gain(ctx, cutoff * 0.45);
  lfo.connect(lfoAmt).connect(lp.frequency);
  lfo.start(0);
  const g = gain(ctx, level);
  for (const n of notes) {
    for (const det of [-6, 6]) {
      const o = osc(ctx, 'sawtooth', midi(n), det);
      o.connect(lp);
      o.start(0);
    }
  }
  lp.connect(saturator(ctx, 1.5)).connect(g).connect(dest);
}

function wind(ctx: OfflineAudioContext, dest: AudioNode, wet: AudioNode, level: number): void {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, 8, 'pink', 21);
  src.loop = true;
  const bp = filter(ctx, 'bandpass', 500, 0.8);
  const lfo = osc(ctx, 'sine', 0.07);
  const amt = gain(ctx, 280);
  lfo.connect(amt).connect(bp.frequency);
  const g = gain(ctx, level);
  src.connect(bp).connect(g);
  g.connect(dest);
  g.connect(wet);
  src.start(0);
  lfo.start(0);
}

function subPulse(ctx: OfflineAudioContext, dest: AudioNode, t: number, note: number, level: number): void {
  const o = osc(ctx, 'sine', midi(note));
  o.frequency.setValueAtTime(midi(note) * 1.6, t);
  o.frequency.exponentialRampToValueAtTime(midi(note), t + 0.12);
  const g = gain(ctx, 0);
  envelope(g.gain, t, level, 0.01, 0.05, 1.2);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + 1.4);
}

function pluck(ctx: OfflineAudioContext, dest: AudioNode, wet: AudioNode, t: number, note: number, level: number, bright: number): void {
  const o = osc(ctx, 'triangle', midi(note));
  const o2 = osc(ctx, 'sawtooth', midi(note), 5);
  const lp = filter(ctx, 'lowpass', bright, 2);
  lp.frequency.setValueAtTime(bright, t);
  lp.frequency.exponentialRampToValueAtTime(bright * 0.25, t + 0.9);
  const g = gain(ctx, 0);
  envelope(g.gain, t, level, 0.005, 0.02, 1.4);
  const mix2 = gain(ctx, 0.25);
  o.connect(lp);
  o2.connect(mix2).connect(lp);
  const p = pan(ctx, (note % 7) / 7 - 0.45);
  lp.connect(g).connect(p);
  p.connect(dest);
  p.connect(wet);
  o.start(t);
  o2.start(t);
  o.stop(t + 1.6);
  o2.stop(t + 1.6);
}

/** "Shelter": warm, hopeful, slow. F major / D dorian with a soft arpeggio. */
export const shelterTheme: Builder = (ctx, out, wet, rnd) => {
  const chords = [
    [53, 57, 60, 64],
    [57, 60, 64, 67],
    [50, 57, 60, 65],
    [46, 53, 57, 62],
  ];
  const bars = 8;
  const barLen = LOOP_SECONDS / bars;
  for (let b = 0; b < bars; b++) {
    const ch = chords[b % chords.length];
    const t = b * barLen;
    padChord(ctx, out, wet, ch, t, barLen, 0.16, 1500);
    subPulse(ctx, out, t, ch[0] - 24, 0.12);
    const step = barLen / 12;
    for (let i = 0; i < 12; i++) {
      if (rnd() < 0.28) continue;
      const note = ch[Math.floor(rnd() * ch.length)] + (rnd() < 0.5 ? 12 : 24);
      pluck(ctx, out, wet, t + i * step + rnd() * 0.03, note, 0.05 + rnd() * 0.03, 2200 + rnd() * 1400);
    }
  }
  drone(ctx, out, [29, 41], 0.035, 300);
  for (let i = 0; i < 6; i++) {
    const t = 4 + rnd() * (LOOP_SECONDS - 6);
    fmBell(ctx, wet, t, midi([72, 76, 77, 81, 84][Math.floor(rnd() * 5)]), 0.035, 4, 3.01, 1.6);
  }
};

/** "Dark": the dead bunker, night and crisis. D minor drones, wind and ghostly metallic bells. */
export const darkTheme: Builder = (ctx, out, wet, rnd) => {
  drone(ctx, out, [26, 33, 38], 0.07, 220);
  wind(ctx, out, wet, 0.05);
  const chords = [
    [50, 53, 57, 62],
    [46, 50, 53, 58],
    [43, 50, 55, 58],
    [45, 49, 52, 57],
  ];
  const barLen = LOOP_SECONDS / 4;
  chords.forEach((ch, b) => padChord(ctx, out, wet, ch, b * barLen, barLen, 0.1, 700));
  const scale = [62, 65, 67, 69, 72, 74, 77];
  let t = 2;
  while (t < LOOP_SECONDS - 3) {
    const note = scale[Math.floor(rnd() * scale.length)] + (rnd() < 0.3 ? 12 : 0);
    fmBell(ctx, wet, t, midi(note), 0.05 + rnd() * 0.03, 5, 3.5 + rnd() * 0.4, 3);
    t += 3.5 + rnd() * 5;
  }
  for (let i = 0; i < 4; i++) subPulse(ctx, out, i * 16 + 8 + rnd() * 2, 26, 0.18);
};

/** Soft electric-piano note (low-index FM), for sparse melodic fragments. */
function epiano(ctx: OfflineAudioContext, dest: AudioNode, wet: AudioNode, t: number, note: number, level: number): void {
  const f = midi(note);
  const car = osc(ctx, 'sine', f);
  const mod = osc(ctx, 'sine', f);
  const modAmt = gain(ctx, 0);
  modAmt.gain.setValueAtTime(f * 1.8, t);
  modAmt.gain.exponentialRampToValueAtTime(f * 0.1, t + 1.6);
  mod.connect(modAmt).connect(car.frequency);
  const g = gain(ctx, 0);
  envelope(g.gain, t, level, 0.006, 0.05, 3.2);
  const p = pan(ctx, ((note * 7) % 11) / 11 - 0.5);
  car.connect(g).connect(p);
  p.connect(dest);
  p.connect(wet);
  car.start(t);
  mod.start(t);
  car.stop(t + 3.5);
  mod.stop(t + 3.5);
}

/** Soft noise tick (shaker / hi-hat) for gentle rhythm. */
function tick(ctx: OfflineAudioContext, dest: AudioNode, t: number, level: number, seed: number): void {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, 0.12, 'white', seed);
  const hp = filter(ctx, 'highpass', 7000, 0.8);
  const g = gain(ctx, 0);
  envelope(g.gain, t, level, 0.002, 0.01, 0.06);
  src.connect(hp).connect(g).connect(dest);
  src.start(t);
}

/** Choir-like pad: saws through vowel formants with a little vibrato. */
function choir(ctx: OfflineAudioContext, dest: AudioNode, wet: AudioNode, notes: number[], t: number, dur: number, level: number): void {
  for (const n of notes) {
    const g = gain(ctx, 0);
    envelope(g.gain, t, level / notes.length, 2.8, Math.max(0.1, dur - 2.8), 3.5);
    for (const [fc, q, amt] of [[700, 6, 1], [1150, 8, 0.6], [2600, 10, 0.25]] as const) {
      const bp = filter(ctx, 'bandpass', fc, q);
      const a = gain(ctx, amt);
      for (const det of [-11, 0, 12]) {
        const o = osc(ctx, 'sawtooth', midi(n), det);
        const vib = osc(ctx, 'sine', 4.8 + (det % 3) * 0.3);
        const vibAmt = gain(ctx, 3);
        vib.connect(vibAmt).connect(o.detune);
        o.connect(bp);
        o.start(t);
        vib.start(t);
        o.stop(t + dur + 4);
        vib.stop(t + dur + 4);
      }
      bp.connect(a).connect(g);
    }
    g.connect(dest);
    g.connect(wet);
  }
}

const pick = <T>(rnd: () => number, list: T[]): T => list[Math.floor(rnd() * list.length)];

/** "Remnant": the dead bunker before anyone came back. Cold drones, creaking metal, drips, a lonely piano. */
export const remnantTheme: Builder = (ctx, out, wet, rnd) => {
  drone(ctx, out, [26, 33], 0.06, 180);
  wind(ctx, out, wet, 0.04);
  const progression = pick(rnd, [
    [[50, 53, 57], [46, 50, 53], [48, 51, 55], [45, 48, 52]],
    [[50, 53, 57], [48, 52, 55], [46, 50, 53], [43, 46, 50]],
  ]);
  const barLen = LOOP_SECONDS / 4;
  progression.forEach((ch, b) => padChord(ctx, out, wet, ch, b * barLen, barLen, 0.07, 520));
  const scale = [62, 65, 67, 69, 72, 74];
  let t = 3 + rnd() * 3;
  while (t < LOOP_SECONDS - 4) {
    const phrase = 1 + Math.floor(rnd() * 3);
    let note = pick(rnd, scale);
    for (let i = 0; i < phrase; i++) {
      epiano(ctx, out, wet, t + i * 0.9, note, 0.06 + rnd() * 0.03);
      note = scale[Math.max(0, Math.min(scale.length - 1, scale.indexOf(note) + (rnd() < 0.6 ? -1 : 1)))];
    }
    t += 6 + rnd() * 7;
  }
  for (let i = 0; i < 5; i++) metalHit(ctx, wet, 2 + rnd() * (LOOP_SECONDS - 5), 55 + rnd() * 40, 0.05, 3.5);
  for (let i = 0; i < 14; i++) {
    const dt = rnd() * (LOOP_SECONDS - 1);
    const o = osc(ctx, 'sine', 1600 + rnd() * 900);
    o.frequency.exponentialRampToValueAtTime(700, dt + 0.08);
    const g = gain(ctx, 0);
    envelope(g.gain, dt, 0.02, 0.002, 0, 0.09);
    o.connect(g).connect(wet);
    o.start(dt);
    o.stop(dt + 0.15);
  }
  for (let i = 0; i < 4; i++) subPulse(ctx, out, i * 16 + 4 + rnd() * 3, 26, 0.12);
};

/** "Colony": a living community. Warm major-seventh chords, a pluck bass, shaker, bright arpeggios. */
export const colonyTheme: Builder = (ctx, out, wet, rnd) => {
  const progression = pick(rnd, [
    [[48, 52, 55, 59], [45, 48, 52, 55], [41, 45, 48, 52, 54], [43, 47, 50, 52]],
    [[45, 48, 52, 55], [41, 45, 48, 52], [48, 52, 55, 59], [43, 47, 50, 55]],
    [[41, 45, 48, 52], [43, 47, 50, 55], [45, 48, 52, 55], [48, 52, 55, 59]],
  ]);
  const bars = 8;
  const barLen = LOOP_SECONDS / bars;
  for (let b = 0; b < bars; b++) {
    const ch = progression[b % progression.length];
    const t = b * barLen;
    padChord(ctx, out, wet, ch, t, barLen, 0.13, 2000);
    for (let beat = 0; beat < 4; beat++) {
      const bt = t + beat * (barLen / 4);
      pluck(ctx, out, wet, bt, ch[0] - 12 + (beat === 2 ? 7 : 0), 0.09, 900);
      for (let s = 0; s < 2; s++) tick(ctx, out, bt + s * (barLen / 8) + rnd() * 0.01, s ? 0.025 : 0.04, 200 + b * 8 + beat * 2 + s);
    }
    const step = barLen / 16;
    for (let i = 0; i < 16; i++) {
      if (rnd() < 0.35) continue;
      pluck(ctx, out, wet, t + i * step, ch[(i + b) % ch.length] + 24, 0.035 + rnd() * 0.02, 3200);
    }
  }
  for (let i = 0; i < 5; i++) fmBell(ctx, wet, 3 + rnd() * (LOOP_SECONDS - 6), midi(pick(rnd, [76, 79, 81, 84, 88])), 0.03, 3.5, 3.01, 1.4);
};

/** "Undercity": a whole city underground. Grand and hopeful: choir, broad pads and a slow melody. */
export const undercityTheme: Builder = (ctx, out, wet, rnd) => {
  const progression = pick(rnd, [
    [[51, 55, 58, 63], [46, 50, 53, 58], [48, 51, 55, 60], [44, 48, 51, 56]],
    [[44, 48, 51, 56], [51, 55, 58, 63], [46, 50, 53, 58], [48, 51, 55, 60]],
  ]);
  const bars = 8;
  const barLen = LOOP_SECONDS / bars;
  for (let b = 0; b < bars; b++) {
    const ch = progression[b % progression.length];
    const t = b * barLen;
    padChord(ctx, out, wet, ch, t, barLen, 0.12, 2600);
    if (b % 2 === 0) choir(ctx, out, wet, ch.slice(1).map(n => n + 12), t, barLen * 2, 0.05);
    subPulse(ctx, out, t, ch[0] - 24, 0.14);
    subPulse(ctx, out, t + barLen / 2, ch[0] - 24, 0.08);
  }
  // Melody: a stepwise line, one note per half bar, played by a soft lead with vibrato.
  const scale = [63, 65, 67, 68, 70, 72, 74, 75];
  let idx = 3;
  for (let i = 0; i < bars * 2; i++) {
    if (rnd() < 0.2) continue;
    idx = Math.max(0, Math.min(scale.length - 1, idx + pick(rnd, [-2, -1, 1, 1, 2])));
    const t = i * (barLen / 2);
    const o = osc(ctx, 'triangle', midi(scale[idx]));
    const vib = osc(ctx, 'sine', 5);
    const vibAmt = gain(ctx, 6);
    vib.connect(vibAmt).connect(o.detune);
    const lp = filter(ctx, 'lowpass', 2400);
    const g = gain(ctx, 0);
    envelope(g.gain, t, 0.07, 0.25, barLen / 2 - 0.5, 1.2);
    o.connect(lp).connect(g);
    g.connect(out);
    g.connect(wet);
    o.start(t);
    vib.start(t);
    o.stop(t + barLen / 2 + 1.6);
    vib.stop(t + barLen / 2 + 1.6);
  }
  for (let i = 0; i < 6; i++) fmBell(ctx, wet, 2 + rnd() * (LOOP_SECONDS - 4), midi(pick(rnd, [79, 82, 84, 87, 91])), 0.03, 4, 3.01, 1.5);
};

export const EXPEDITION_SECONDS = 8;

/** Expedition layer: a low march pulse and a ticking clock while survivors are out on the surface. */
export const expeditionPulse: Builder = (ctx, out, wet) => {
  const beat = EXPEDITION_SECONDS / 16;
  for (let i = 0; i < 16; i++) {
    const t = i * beat;
    if (i % 4 === 0 || i % 8 === 6) {
      const o = osc(ctx, 'sine', 110);
      o.frequency.exponentialRampToValueAtTime(48, t + 0.25);
      const g = gain(ctx, 0);
      envelope(g.gain, t, i % 4 === 0 ? 0.3 : 0.18, 0.004, 0.02, 0.45);
      o.connect(g);
      g.connect(out);
      g.connect(wet);
      o.start(t);
      o.stop(t + 0.6);
    }
    tick(ctx, out, t, i % 2 ? 0.02 : 0.035, 300 + i);
  }
  drone(ctx, out, [38, 45], 0.02, 260);
};
