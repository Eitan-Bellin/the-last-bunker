/** Offline-rendering building blocks for the synthesized soundtrack and effects. */

export const SAMPLE_RATE = 44100;

export type Builder = (ctx: OfflineAudioContext, out: AudioNode, wet: AudioNode, rnd: () => number) => void;

/** How long building each sound's node graph blocked the page (the synchronous part of a render); read by the perf probe. */
export const audioStats = { builds: [] as number[], max: 0 };
function timedBuild(build: Builder, ctx: OfflineAudioContext, dry: AudioNode, wet: AudioNode, rnd: () => number): void {
  const t = performance.now();
  build(ctx, dry, wet, rnd);
  const ms = performance.now() - t;
  audioStats.builds.push(Math.round(ms));
  if (audioStats.builds.length > 400) audioStats.builds.shift();
  audioStats.max = Math.max(audioStats.max, ms);
}

export function midi(n: number): number {
  return 440 * Math.pow(2, (n - 69) / 12);
}

export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function noiseBuffer(ctx: BaseAudioContext, seconds: number, color: 'white' | 'pink' | 'brown' = 'white', seed = 7): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const rnd = seeded(seed);
  let b0 = 0, b1 = 0, b2 = 0, last = 0;
  for (let i = 0; i < len; i++) {
    const w = rnd() * 2 - 1;
    if (color === 'white') d[i] = w;
    else if (color === 'pink') {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    } else {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  }
  return buf;
}

/** The computed impulse responses by sample rate and shape: every render used to regenerate the same ~280k samples. */
const impulseCache = new Map<string, Float32Array<ArrayBuffer>[]>();

/** Synthetic impulse response of a large concrete room: early slap-backs plus a dark diffuse tail. */
export function concreteImpulse(ctx: BaseAudioContext, seconds = 3.2, decay = 0.9, seed = 11): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const key = `${ctx.sampleRate}|${seconds}|${decay}|${seed}`;
  let channels = impulseCache.get(key);
  if (!channels) {
    channels = [new Float32Array(len), new Float32Array(len)];
    const rnd = seeded(seed);
    for (let ch = 0; ch < 2; ch++) {
      const d = channels[ch];
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / ctx.sampleRate;
        const env = Math.exp(-t / decay) * (t < 0.012 ? t / 0.012 : 1);
        const n = rnd() * 2 - 1;
        const cutoff = 0.55 - 0.45 * Math.min(1, t / seconds);
        lp += (n - lp) * cutoff;
        d[i] = lp * env * 0.6;
      }
      for (const [time, amp] of [[0.023, 0.5], [0.041, 0.38], [0.067, 0.3], [0.089, 0.22], [0.131, 0.16]]) {
        const idx = Math.floor((time + (ch ? 0.004 : 0)) * ctx.sampleRate);
        if (idx < len) d[idx] += amp * (ch ? -1 : 1);
      }
    }
    impulseCache.set(key, channels);
  }
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  buf.copyToChannel(channels[0], 0);
  buf.copyToChannel(channels[1], 1);
  return buf;
}

/** The gain a ConvolverNode applies to its response when `normalize` is on (the Web Audio spec's calibration: -58 dB at 44.1 kHz). */
function convolverScale(channels: Float32Array[], rate: number): number {
  let power = 0;
  for (const c of channels) for (let i = 0; i < c.length; i++) power += c[i] * c[i];
  power = Math.sqrt(power / (channels.length * channels[0].length));
  if (!Number.isFinite(power) || power < 0.000125) power = 0.000125;
  return (1 / power) * Math.pow(10, -58 * 0.05) * (44100 / rate);
}

const scaleCache = new Map<string, number>();

/** Shared graph: dry bus and a reverb bus, both into a gentle master compressor. */
function chain(ctx: OfflineAudioContext, reverbMix: number): { dry: GainNode; wet: GainNode } {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 12;
  comp.ratio.value = 3;
  comp.attack.value = 0.01;
  comp.release.value = 0.25;
  comp.connect(ctx.destination);
  const dry = ctx.createGain();
  dry.connect(comp);
  const verb = ctx.createConvolver();
  const full = concreteImpulse(ctx);
  // [perf] Setting a 3.2 s response on a convolver costs ~55 ms of main-thread time, and a 0.3 s click can never use more than its
  // own length of it. Cut the response to what the render can reach, and keep the loudness exactly as it was: with the response cut,
  // "normalize" would measure a different power, so the full response's gain is applied by hand (matches to 1e-6 in a test).
  const reach = Math.min(full.length, Math.ceil(ctx.length) + 8);
  let wetScale = 1;
  if (reach < full.length) {
    const key = `${ctx.sampleRate}`;
    let scale = scaleCache.get(key);
    if (scale === undefined) {
      scale = convolverScale([full.getChannelData(0), full.getChannelData(1)], ctx.sampleRate);
      scaleCache.set(key, scale);
    }
    const cut = ctx.createBuffer(2, reach, ctx.sampleRate);
    cut.copyToChannel(full.getChannelData(0).subarray(0, reach), 0);
    cut.copyToChannel(full.getChannelData(1).subarray(0, reach), 1);
    verb.normalize = false;
    verb.buffer = cut;
    wetScale = scale;
  } else verb.buffer = full;
  const wetOut = ctx.createGain();
  wetOut.gain.value = reverbMix * wetScale;
  verb.connect(wetOut).connect(comp);
  const wet = ctx.createGain();
  wet.connect(verb);
  return { dry, wet };
}

/** Scales a buffer so its loudest sample hits `target` (keeps the mix consistent across sounds). */
export function normalize(buffer: AudioBuffer, target: number): AudioBuffer {
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  if (peak < 1e-5) return buffer;
  const k = target / peak;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] *= k;
  }
  return buffer;
}

/**
 * Renders `seconds` of audio and folds the trailing `tail` back onto the start,
 * so the buffer loops without a seam.
 */
export async function renderLoop(seconds: number, tail: number, build: Builder, seed = 1, reverbMix = 0.9, rate = SAMPLE_RATE): Promise<AudioBuffer> {
  const total = seconds + tail;
  const ctx = new OfflineAudioContext(2, Math.ceil(rate * total), rate);
  const { dry, wet } = chain(ctx, reverbMix);
  timedBuild(build, ctx, dry, wet, seeded(seed));
  const rendered = await ctx.startRendering();
  const len = Math.floor(rate * seconds);
  const tailLen = rendered.length - len;
  const out = new AudioBuffer({ numberOfChannels: 2, length: len, sampleRate: rate });
  for (let ch = 0; ch < 2; ch++) {
    const src = rendered.getChannelData(ch);
    const dst = out.getChannelData(ch);
    dst.set(src.subarray(0, len));
    for (let i = 0; i < tailLen && i < len; i++) dst[i] += src[len + i];
  }
  return out;
}

/**
 * Renders `seconds` of music plus a free-running `tail` (reverb, releases). Segments are chained by
 * starting the next one `seconds` after the previous, so each tail overlaps the next start naturally.
 */
export async function renderSegment(seconds: number, tail: number, build: Builder, seed: number, reverbMix: number, rate: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(rate * (seconds + tail)), rate);
  const { dry, wet } = chain(ctx, reverbMix);
  timedBuild(build, ctx, dry, wet, seeded(seed));
  return ctx.startRendering();
}

/** Renders a one-shot effect (a lighter rate and a single channel for devices with little memory). */
export async function renderOneShot(seconds: number, build: Builder, seed = 1, reverbMix = 0.6, rate = SAMPLE_RATE, channels = 2): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(channels, Math.ceil(rate * seconds), rate);
  const { dry, wet } = chain(ctx, reverbMix);
  timedBuild(build, ctx, dry, wet, seeded(seed));
  return ctx.startRendering();
}

/** ADSR-ish envelope on a gain param. */
export function envelope(p: AudioParam, t: number, peak: number, attack: number, hold: number, release: number): void {
  p.setValueAtTime(0.0001, t);
  p.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  p.setValueAtTime(Math.max(0.0002, peak), t + attack + hold);
  p.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
}

export function osc(ctx: BaseAudioContext, type: OscillatorType, freq: number, detuneCents = 0): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = Math.min(freq, ctx.sampleRate * 0.49);
  o.detune.value = detuneCents;
  return o;
}

export function filter(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

export function gain(ctx: BaseAudioContext, value: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

export function pan(ctx: BaseAudioContext, value: number): StereoPannerNode {
  const p = ctx.createStereoPanner();
  p.pan.value = value;
  return p;
}

/** Soft-clipping curve for warmth and grit. */
export function saturator(ctx: BaseAudioContext, amount = 2): WaveShaperNode {
  const ws = ctx.createWaveShaper();
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  ws.curve = curve;
  ws.oversample = '2x';
  return ws;
}

/** Noise burst through a filter, e.g. for impacts, hiss and steam. */
export function noiseHit(
  ctx: BaseAudioContext, dest: AudioNode, t: number, dur: number, peak: number,
  type: BiquadFilterType, freq: number, q = 1, color: 'white' | 'pink' | 'brown' = 'white', seed = 3,
): void {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, Math.max(0.05, dur + 0.05), color, seed);
  const f = filter(ctx, type, freq, q);
  const g = gain(ctx, 0);
  envelope(g.gain, t, peak, 0.004, 0, dur);
  src.connect(f).connect(g).connect(dest);
  src.start(t);
  src.stop(t + dur + 0.05);
}

/** Inharmonic struck-metal tone (modal synthesis): pipes, girders, hatches. */
export function metalHit(ctx: BaseAudioContext, dest: AudioNode, t: number, base: number, peak: number, decay: number): void {
  const ratios = [1, 2.76, 5.4, 8.93, 13.34];
  ratios.forEach((r, i) => {
    // Partials above the Nyquist limit would only alias; leave them out.
    if (base * r >= ctx.sampleRate * 0.48) return;
    const o = osc(ctx, 'sine', base * r);
    const g = gain(ctx, 0);
    envelope(g.gain, t, peak / (i + 1), 0.002, 0, decay / (1 + i * 0.6));
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + decay + 0.1);
  });
}

/** FM bell / chime voice. */
export function fmBell(ctx: BaseAudioContext, dest: AudioNode, t: number, freq: number, peak: number, decay: number, ratio = 3.5, index = 3): void {
  const car = osc(ctx, 'sine', freq);
  const mod = osc(ctx, 'sine', freq * ratio);
  const modGain = gain(ctx, 0);
  modGain.gain.setValueAtTime(freq * index, t);
  modGain.gain.exponentialRampToValueAtTime(freq * 0.05, t + decay);
  mod.connect(modGain).connect(car.frequency);
  const g = gain(ctx, 0);
  envelope(g.gain, t, peak, 0.004, 0, decay);
  car.connect(g).connect(dest);
  car.start(t);
  mod.start(t);
  car.stop(t + decay + 0.1);
  mod.stop(t + decay + 0.1);
}
