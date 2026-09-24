import { safeParam } from '@el-systema/core'

/**
 * Small DSP parts the kits share. Everything here is built per hit and
 * disposed by the scheduler, except the buffers and curves, which are made
 * once per AudioContext and cached (see KitContext).
 */

/** White noise from a fixed LCG: the same grain every load, so a seed reproduces a take. */
export function noiseBuffer(ctx: BaseAudioContext, seconds: number, seed = 991): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  let s = seed
  for (let i = 0; i < len; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    d[i] = (s / 4294967296) * 2 - 1
  }
  return buf
}

/** Pink-ish noise (Kellet): the raw material for grain clouds and vinyl air. */
export function pinkBuffer(ctx: BaseAudioContext, seconds: number, seed = 337): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  let s = seed
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
  for (let i = 0; i < len; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    const w = (s / 4294967296) * 2 - 1
    b0 = 0.99886 * b0 + w * 0.0555179
    b1 = 0.99332 * b1 + w * 0.0750759
    b2 = 0.969 * b2 + w * 0.153852
    b3 = 0.8665 * b3 + w * 0.3104856
    b4 = 0.55 * b4 + w * 0.5329522
    b5 = -0.7616 * b5 - w * 0.016898
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11
    b6 = w * 0.115926
  }
  return buf
}

/**
 * Vinyl: pink noise with sparse crackle on top. Used as the bed of the
 * hip-hop kit and as grain material for the Jelinek kit, where a record's
 * surface is the instrument rather than a defect.
 */
export function vinylBuffer(ctx: BaseAudioContext, seconds: number, seed = 5150): AudioBuffer {
  const buf = pinkBuffer(ctx, seconds, seed)
  const d = buf.getChannelData(0)
  let s = seed ^ 0x9e37
  for (let i = 0; i < d.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    const r = s / 4294967296
    if (r < 0.00018) {
      // a click: a few samples of decaying impulse
      const amp = 0.5 + 0.5 * r * 5000 - Math.floor(0.5 + 0.5 * r * 5000)
      for (let k = 0; k < 24 && i + k < d.length; k++) d[i + k] += amp * Math.pow(1 - k / 24, 3) * (k % 2 ? -1 : 1)
    }
  }
  return buf
}

/** Reverb impulse: exponentially decaying stereo noise. */
export function impulse(ctx: BaseAudioContext, seconds: number, decay: number, seed = 4242): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  let s = seed
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0
      d[i] = ((s / 4294967296) * 2 - 1) * Math.pow(1 - i / len, decay)
    }
  }
  return buf
}

/** tanh saturation; drive 1 ≈ clean, 4 ≈ hot tape. */
export function saturationCurve(drive: number, n = 1024): Float32Array<ArrayBuffer> {
  const c = new Float32Array(new ArrayBuffer(n * 4))
  const norm = Math.tanh(drive)
  for (let i = 0; i < n; i++) c[i] = Math.tanh(((i / (n - 1)) * 2 - 1) * drive) / norm
  return c
}

/**
 * Quantisation curve: rounds the signal to `bits` levels. This is the
 * SP-1200/MPC60 character — the grit is in the low bit depth, not in a
 * filter — and it costs one WaveShaper.
 */
export function bitCurve(bits: number, n = 2048): Float32Array<ArrayBuffer> {
  const c = new Float32Array(new ArrayBuffer(n * 4))
  const levels = Math.max(2, Math.pow(2, bits) / 2)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    c[i] = Math.round(x * levels) / levels
  }
  return c
}

/**
 * Wavefolder with teeth.
 *
 * `amount` folds: past unity the curve reflects instead of clipping, which
 * adds high harmonics while keeping a sense of movement as the drive changes.
 * `grit` then bites into that fold — it quantises the curve to fewer and
 * fewer levels and drives the negative half harder than the positive one.
 * Steps give the buzz, asymmetry gives the even harmonics, and together they
 * are what makes a sound gritty rather than merely loud.
 */
export function foldCurve(amount: number, grit = 0, n = 2048): Float32Array<ArrayBuffer> {
  const c = new Float32Array(new ArrayBuffer(n * 4))
  const k = 1 + amount * 3.5 + grit * 4
  const levels = grit > 0.01 ? Math.max(3, Math.round(Math.pow(2, 8 - grit * 5.5) / 2)) : 0
  for (let i = 0; i < n; i++) {
    let x = ((i / (n - 1)) * 2 - 1) * k
    // the negative half is driven harder: asymmetry = even harmonics
    if (x < 0) x *= 1 + grit * 0.55
    // triangle fold: reflect the signal back each time it passes ±1
    let y = (((x + 1) % 4) + 4) % 4
    y = y > 2 ? 4 - y : y
    y = (y - 1) * 0.85
    if (levels) y = Math.round(y * levels) / levels
    c[i] = y * (1 - grit * 0.18)
  }
  return c
}

/**
 * The grind stage: a parallel path of hard shaping and ring modulation,
 * crossfaded against the clean signal. Ring modulation is the part that
 * reads as metal — it adds partials belonging to no harmonic series, so the
 * result sounds bitten rather than merely saturated. The high-pass keeps the
 * teeth above the weight instead of eating it.
 */
export interface GrindStage {
  input: GainNode
  output: GainNode
  /** distorted path level, 0..1 */
  wet: GainNode
  /** clean path level; drop it as `wet` rises to hold the stage level */
  dry: GainNode
  /**
   * Gain into the shaper. A folder only folds what reaches ±1, and a bus
   * sits well below that, so without drive the stage does nothing but lose
   * level. Raise this with the mix and compensate with `trim`.
   */
  drive: GainNode
  /** post-shaper compensation, lowered as `drive` rises */
  trim: GainNode
}

export function grindStage(
  ctx: AudioContext,
  curve: Float32Array<ArrayBuffer>,
  o: { mix: number; ringHz: number; ringDepth: number; tilt: number },
): GrindStage {
  const input = ctx.createGain()
  const output = ctx.createGain()

  const dry = ctx.createGain()
  dry.gain.value = 1 - 0.45 * o.mix
  input.connect(dry).connect(output)

  const wet = ctx.createGain()
  wet.gain.value = o.mix
  const drive = ctx.createGain()
  drive.gain.value = 1
  const shaper = ctx.createWaveShaper()
  shaper.curve = curve
  shaper.oversample = '4x'
  const trim = ctx.createGain()
  trim.gain.value = 1
  const tilt = ctx.createBiquadFilter()
  tilt.type = 'highpass'
  tilt.frequency.value = safeParam(o.tilt, 40, 2000, 160)
  tilt.Q.value = 0.7
  input.connect(drive).connect(shaper).connect(trim).connect(tilt)

  if (o.ringDepth > 0.001) {
    // part of the shaped signal passes straight, part is ring modulated
    const straight = ctx.createGain()
    straight.gain.value = 1 - o.ringDepth
    tilt.connect(straight).connect(wet)
    const ring = ctx.createGain()
    ring.gain.value = 0
    const osc = ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.value = safeParam(o.ringHz, 20, 4000, 120)
    const depth = ctx.createGain()
    depth.gain.value = o.ringDepth
    osc.connect(depth).connect(ring.gain)
    tilt.connect(ring).connect(wet)
    osc.start()
  } else {
    tilt.connect(wet)
  }
  wet.connect(output)
  return { input, output, wet, dry, drive, trim }
}

export interface EnvOptions {
  attack: number
  decay: number
  peak: number
  /** exponential-ish tail; higher = snappier */
  curve?: number
}

/** Percussive gain envelope. Returns the node; the caller connects it on. */
export function percEnv(ctx: BaseAudioContext, t: number, o: EnvOptions): GainNode {
  const g = ctx.createGain()
  const peak = safeParam(o.peak, 0, 1.5, 0.5)
  const atk = Math.max(0.0004, o.attack)
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(peak, t + atk)
  g.gain.setTargetAtTime(0, t + atk, Math.max(0.004, o.decay / (o.curve ?? 3)))
  return g
}

/**
 * The knock: a few milliseconds of filtered noise plus a short mid "beater"
 * tone. This is what makes a kick land in the chest rather than just move
 * air — the body gives weight, the transient gives the hit a location.
 */
export function knock(
  ctx: AudioContext,
  t: number,
  dest: AudioNode,
  noise: AudioBuffer,
  o: { level: number; tone: number; decay: number; cutoff: number; offset?: number },
) {
  if (o.level <= 0.001) return
  const s = ctx.createBufferSource()
  s.buffer = noise
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = safeParam(o.cutoff, 200, 12000, 3000)
  const g = percEnv(ctx, t, { attack: 0.0004, decay: o.decay, peak: o.level, curve: 5 })
  s.connect(lp).connect(g).connect(dest)
  s.start(t, o.offset ?? 0.02)
  s.stop(t + 0.08)

  const beat = ctx.createOscillator()
  beat.type = 'triangle'
  beat.frequency.setValueAtTime(safeParam(o.tone, 100, 6000, 1200), t)
  beat.frequency.exponentialRampToValueAtTime(safeParam(o.tone * 0.45, 60, 6000, 500), t + 0.012)
  const bg = percEnv(ctx, t, { attack: 0.0004, decay: 0.012, peak: o.level * 0.6, curve: 5 })
  beat.connect(bg).connect(dest)
  beat.start(t)
  beat.stop(t + 0.06)
}

/** Band-pass with a frequency sweep, the backbone of noise-based drums. */
export function sweptBand(ctx: BaseAudioContext, t: number, from: number, to: number, q: number, time: number): BiquadFilterNode {
  const f = ctx.createBiquadFilter()
  f.type = 'bandpass'
  f.Q.value = safeParam(q, 0.1, 30, 2)
  f.frequency.setValueAtTime(safeParam(from, 20, 18000, 1000), t)
  f.frequency.exponentialRampToValueAtTime(safeParam(to, 20, 18000, 800), t + Math.max(0.01, time))
  return f
}
