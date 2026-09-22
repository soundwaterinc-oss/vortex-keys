import { safeParam } from '@el-systema/core'

/** White noise from a fixed LCG: identical every load, so noise-based voices are reproducible. */
export function makeNoise(ctx: BaseAudioContext, seconds: number, seed = 12345): AudioBuffer {
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

/** Synthetic reverb impulse: exponentially decaying stereo noise. */
export function makeImpulse(ctx: BaseAudioContext, seconds: number, decay: number, seed = 777): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  let s = seed
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0
      const white = (s / 4294967296) * 2 - 1
      d[i] = white * Math.pow(1 - i / len, decay)
    }
  }
  return buf
}

/** soft tanh curve; drive 1 = near-linear, 2 = noticeable warmth */
export function makeSaturation(drive: number, n = 1024): Float32Array<ArrayBuffer> {
  const c = new Float32Array(new ArrayBuffer(n * 4))
  const norm = Math.tanh(drive)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    c[i] = Math.tanh(x * drive) / norm
  }
  return c
}

export interface MasterChainOptions {
  masterGain?: number
  delaySeconds?: number
  delayFeedback?: number
  reverbSeconds?: number
  reverbDecay?: number
}

/**
 * The family's common output stage. Every instrument's voices connect to
 * `input`; SPACE-style sends go through delay → convolver; the master then
 * passes a compressor and a hard limiter before the destination. Shared so
 * that no instrument can produce a gain spike another cannot.
 *
 *   input ─▶ dry ───────────────────────────────┐
 *   input ─▶ send ─▶ delay(fb, LP) ─▶ convolver ─▶ wet ─┼▶ master ─▶ comp ─▶ limiter ─▶ analyser ─▶ out
 */
/**
 * One instrument's gain bus inside the shared chain. LEVEL and MUTE use
 * short ramps so toggling never clicks; the send to the space bus follows
 * the bus level so SPACE stays proportional.
 */
export class InstrumentBus {
  readonly input: GainNode
  private levelValue = 1
  private muted = false
  constructor(readonly ctx: AudioContext, readonly name: string, chain: MasterChain) {
    this.input = ctx.createGain()
    this.input.gain.value = 1
    this.input.connect(chain.input)
  }
  get level() {
    return this.levelValue
  }
  get isMuted() {
    return this.muted
  }
  setLevel(v: number) {
    this.levelValue = safeParam(v, 0, 1.5, 1)
    this.apply()
  }
  setMuted(m: boolean) {
    this.muted = m
    this.apply()
  }
  private apply() {
    const target = this.muted ? 0 : this.levelValue
    this.input.gain.setTargetAtTime(target, this.ctx.currentTime, 0.02)
  }
}

export class MasterChain {
  readonly input: GainNode
  readonly buses = new Map<string, InstrumentBus>()
  readonly send: GainNode
  readonly wet: GainNode
  readonly master: GainNode
  readonly analyser: AnalyserNode
  private levelBuf: Uint8Array<ArrayBuffer>

  constructor(readonly ctx: AudioContext, opts: MasterChainOptions = {}) {
    this.input = ctx.createGain()
    this.input.gain.value = 0.8
    this.send = ctx.createGain()
    const delay = ctx.createDelay(2)
    delay.delayTime.value = opts.delaySeconds ?? 0.37
    const fb = ctx.createGain()
    fb.gain.value = opts.delayFeedback ?? 0.32
    const fbFilter = ctx.createBiquadFilter()
    fbFilter.type = 'lowpass'
    fbFilter.frequency.value = 2400
    const conv = ctx.createConvolver()
    conv.buffer = makeImpulse(ctx, opts.reverbSeconds ?? 3.2, opts.reverbDecay ?? 2.4)
    this.wet = ctx.createGain()
    this.send.connect(delay)
    delay.connect(fbFilter)
    fbFilter.connect(fb)
    fb.connect(delay)
    this.send.connect(conv)
    delay.connect(conv)
    conv.connect(this.wet)

    this.master = ctx.createGain()
    this.master.gain.value = opts.masterGain ?? 0.7
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -18
    comp.knee.value = 12
    comp.ratio.value = 4
    comp.attack.value = 0.004
    comp.release.value = 0.18
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -3
    limiter.knee.value = 0
    limiter.ratio.value = 20
    limiter.attack.value = 0.001
    limiter.release.value = 0.08
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 256
    this.levelBuf = new Uint8Array(new ArrayBuffer(this.analyser.fftSize))

    // vintage colour: warm low shelf, rolled-off top, gentle tape-style saturation
    const lowShelf = ctx.createBiquadFilter()
    lowShelf.type = 'lowshelf'
    lowShelf.frequency.value = 180
    lowShelf.gain.value = 2.5
    const highShelf = ctx.createBiquadFilter()
    highShelf.type = 'highshelf'
    highShelf.frequency.value = 5200
    highShelf.gain.value = -5
    const sat = ctx.createWaveShaper()
    sat.curve = makeSaturation(1.6)
    sat.oversample = '2x'

    this.input.connect(this.master)
    this.input.connect(this.send)
    this.wet.connect(this.master)
    this.master.connect(lowShelf)
    lowShelf.connect(highShelf)
    highShelf.connect(sat)
    sat.connect(comp)
    comp.connect(limiter)
    limiter.connect(this.analyser)
    this.analyser.connect(ctx.destination)
  }

  /** SPACE macro: send + wet in one gesture. */
  setSpace(space: number) {
    const t = this.ctx.currentTime
    this.send.gain.setTargetAtTime(safeParam(space * 0.9, 0, 1, 0.3), t, 0.05)
    this.wet.gain.setTargetAtTime(safeParam(0.2 + space * 0.8, 0, 1.2, 0.5), t, 0.05)
  }

  /** Create (or fetch) a named instrument bus feeding this chain. */
  createBus(name: string): InstrumentBus {
    let b = this.buses.get(name)
    if (!b) this.buses.set(name, (b = new InstrumentBus(this.ctx, name, this)))
    return b
  }

  setMasterGain(g: number) {
    this.master.gain.setTargetAtTime(safeParam(g, 0, 1, 0.7), this.ctx.currentTime, 0.02)
  }

  /** output RMS 0..1 for meters */
  level(): number {
    this.analyser.getByteTimeDomainData(this.levelBuf)
    let sum = 0
    for (let i = 0; i < this.levelBuf.length; i++) {
      const v = (this.levelBuf[i] - 128) / 128
      sum += v * v
    }
    return Math.sqrt(sum / this.levelBuf.length)
  }
}
