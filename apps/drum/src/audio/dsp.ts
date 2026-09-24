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
