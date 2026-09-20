import type { NoteSink, PitchedNote } from './sink'
import { MODELS, type Macros, type SoundModelId } from './models'
import { safeParam } from '../core/math/util'

/**
 * SynthEngine: native Web Audio polyphonic synth.
 *
 * Signal flow per voice:
 *   carrier osc ─┐
 *   partial osc ─┼─> voiceFilter (LP) ─> ampEnv ─> panner ─> voiceBus
 *   noise (BP)  ─┘
 *   fm osc ─> fmGain ─> carrier.frequency   (glass/wood)
 *   lfo ─> pitch (cents), filter (Hz), pan
 *
 * Bus:
 *   voiceBus ─> dry ─────────────────────┐
 *   voiceBus ─> send ─> delay(fb) ─> convolver ─> wet ─┼─> master ─> compressor ─> limiter ─> destination
 *
 * Timing: every noteOn/noteOff takes an AudioContext time so the scheduler
 * can place events ahead of "now". This is the seam where an AudioWorklet
 * scheduler could later take over event placement.
 */
interface Voice {
  id: string
  startTime: number
  nodes: AudioNode[]
  sources: (OscillatorNode | AudioBufferSourceNode)[]
  amp: GainNode
  release: number
  releasing: boolean
  peak: number
}

export interface SynthOptions {
  maxVoices: number
}

export class SynthEngine implements NoteSink {
  readonly ctx: AudioContext
  modelId: SoundModelId = 'glass'
  macros: Macros
  private voices = new Map<string, Voice>()
  private order: string[] = []
  private noiseBuffer: AudioBuffer
  private voiceBus: GainNode
  private send: GainNode
  private wet: GainNode
  private master: GainNode
  private maxVoices: number
  /** analyser for level meter / visual feedback */
  readonly analyser: AnalyserNode

  constructor(ctx: AudioContext, macros: Macros, opts: SynthOptions = { maxVoices: 24 }) {
    this.ctx = ctx
    this.macros = { ...macros }
    this.maxVoices = opts.maxVoices
    this.noiseBuffer = makeNoise(ctx, 2)

    this.voiceBus = ctx.createGain()
    this.voiceBus.gain.value = 0.8

    // --- space: delay into reverb ---
    this.send = ctx.createGain()
    const delay = ctx.createDelay(2)
    delay.delayTime.value = 0.37
    const fb = ctx.createGain()
    fb.gain.value = 0.32
    const fbFilter = ctx.createBiquadFilter()
    fbFilter.type = 'lowpass'
    fbFilter.frequency.value = 3200
    const conv = ctx.createConvolver()
    conv.buffer = makeImpulse(ctx, 3.2, 2.4)
    this.wet = ctx.createGain()

    this.send.connect(delay)
    delay.connect(fbFilter)
    fbFilter.connect(fb)
    fb.connect(delay)
    this.send.connect(conv)
    delay.connect(conv)
    conv.connect(this.wet)

    // --- master protection ---
    this.master = ctx.createGain()
    this.master.gain.value = 0.7
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

    this.voiceBus.connect(this.master)
    this.voiceBus.connect(this.send)
    this.wet.connect(this.master)
    this.master.connect(comp)
    comp.connect(limiter)
    limiter.connect(this.analyser)
    this.analyser.connect(ctx.destination)

    this.setMacros(this.macros)
  }

  setModel(id: SoundModelId) {
    this.modelId = id
  }

  setMacros(m: Macros) {
    this.macros = { ...m }
    const t = this.ctx.currentTime
    // SPACE is a bus-level macro: send + wet in one gesture
    this.send.gain.setTargetAtTime(safeParam(m.space * 0.9, 0, 1, 0.3), t, 0.05)
    this.wet.gain.setTargetAtTime(safeParam(0.2 + m.space * 0.8, 0, 1.2, 0.5), t, 0.05)
  }

  get voiceCount() {
    return this.voices.size
  }

  /** output RMS level 0..1 (for meter) */
  level(): number {
    const buf = new Uint8Array(this.analyser.fftSize)
    this.analyser.getByteTimeDomainData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128
      sum += v * v
    }
    return Math.sqrt(sum / buf.length)
  }

  noteOn(n: PitchedNote, time: number): void {
    const ctx = this.ctx
    const t = Math.max(time, ctx.currentTime)
    const f = safeParam(n.frequencyHz, 16, 16000, 440)
    if (this.voices.has(n.id)) this.noteOff(n.id, t)
    while (this.voices.size >= this.maxVoices) this.steal(t)

    const model = MODELS[this.modelId]
    const vel = safeParam(n.velocity, 0, 1, 0.5)
    const bright = safeParam(n.brightness ?? 0.5, 0, 1, 0.5)
    const p = model.voice(this.macros, f, vel, bright)

    const nodes: AudioNode[] = []
    const sources: (OscillatorNode | AudioBufferSourceNode)[] = []

    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.Q.value = safeParam(p.filterQ, 0.1, 20, 1)
    const cutoff = safeParam(p.cutoffHz, 40, 18000, 2000)
    filter.frequency.setValueAtTime(cutoff, t)
    // filter envelope: opens instantly with velocity, closes over the decay
    const peakCut = safeParam(cutoff + p.cutoffEnvHz, 40, 18000, cutoff)
    filter.frequency.setValueAtTime(peakCut, t)
    filter.frequency.setTargetAtTime(cutoff, t + 0.005, Math.max(0.02, p.decay * 0.4))

    const amp = ctx.createGain()
    amp.gain.setValueAtTime(0, t)
    const pan = ctx.createStereoPanner()
    // spread voices around the stereo field by pitch class (subtle)
    pan.pan.value = safeParam(Math.sin((n.cents / 1200) * Math.PI * 2) * 0.35 * (n.width ?? 1), -1, 1, 0)

    // carrier
    const car = ctx.createOscillator()
    car.type = p.carrierType
    car.frequency.setValueAtTime(f, t)
    const carGain = ctx.createGain()
    carGain.gain.value = 1
    car.connect(carGain).connect(filter)
    sources.push(car)
    nodes.push(carGain)

    // partial / detuned second oscillator
    if (p.partialGain > 0) {
      const part = ctx.createOscillator()
      part.type = p.partialType
      part.frequency.setValueAtTime(safeParam(f * p.partialRatio, 16, 18000, f * 2), t)
      const pg = ctx.createGain()
      pg.gain.value = safeParam(p.partialGain, 0, 1, 0.3)
      part.connect(pg).connect(filter)
      sources.push(part)
      nodes.push(pg)
      // partial decays faster than fundamental -> natural "brightness fades" behaviour
      pg.gain.setTargetAtTime(p.partialGain * 0.25, t + 0.01, Math.max(0.05, p.decay * 0.35))
    }

    // FM modulator
    if (p.fmIndex > 0) {
      const mod = ctx.createOscillator()
      mod.type = 'sine'
      mod.frequency.setValueAtTime(safeParam(f * p.fmRatio, 1, 18000, f * 2), t)
      const mg = ctx.createGain()
      // modulation index scales with frequency (Hz deviation = index * f)
      const dev = safeParam(p.fmIndex * f, 0, 12000, 0)
      mg.gain.setValueAtTime(dev, t)
      mg.gain.setTargetAtTime(dev * 0.15, t + 0.01, Math.max(0.05, p.decay * 0.3))
      mod.connect(mg).connect(car.frequency)
      sources.push(mod)
      nodes.push(mg)
    }

    // noise
    if (p.noiseGain > 0) {
      const noise = ctx.createBufferSource()
      noise.buffer = this.noiseBuffer
      noise.loop = true
      const nf = ctx.createBiquadFilter()
      nf.type = 'bandpass'
      nf.frequency.value = safeParam(p.noiseFilterHz, 40, 18000, 2000)
      nf.Q.value = safeParam(p.noiseQ, 0.1, 30, 1)
      const ng = ctx.createGain()
      const ngv = safeParam(p.noiseGain, 0, 1, 0.1)
      ng.gain.setValueAtTime(ngv, t)
      // percussive models: noise is only the transient
      if (p.sustain < 0.5) ng.gain.setTargetAtTime(0, t + 0.005, 0.04 + p.decay * 0.05)
      noise.connect(nf).connect(ng).connect(filter)
      sources.push(noise)
      nodes.push(nf, ng)
    }

    // LFO
    if (p.lfoPitchCents > 0 || p.lfoFilterHz > 0 || p.lfoPan > 0) {
      const lfo = ctx.createOscillator()
      lfo.type = 'sine'
      lfo.frequency.value = safeParam(p.lfoHz, 0.01, 20, 1)
      if (p.lfoPitchCents > 0) {
        const g = ctx.createGain()
        g.gain.value = p.lfoPitchCents
        lfo.connect(g).connect(car.detune)
        nodes.push(g)
      }
      if (p.lfoFilterHz > 0) {
        const g = ctx.createGain()
        g.gain.value = p.lfoFilterHz
        lfo.connect(g).connect(filter.frequency)
        nodes.push(g)
      }
      if (p.lfoPan > 0) {
        const g = ctx.createGain()
        g.gain.value = p.lfoPan
        lfo.connect(g).connect(pan.pan)
        nodes.push(g)
      }
      sources.push(lfo)
    }

    filter.connect(amp).connect(pan).connect(this.voiceBus)
    nodes.push(filter, amp, pan)

    // amplitude envelope: velocity to level is a gentle curve so soft
    // generated notes stay audible; peak is conservative (< 0.5 per voice)
    const peak = safeParam(p.level * (0.25 + 0.75 * Math.pow(vel, 1.4)), 0, 0.6, 0.2)
    const atk = Math.max(0.002, p.attack)
    amp.gain.linearRampToValueAtTime(peak, t + atk)
    const sus = peak * p.sustain
    // exponential-ish decay toward sustain via setTargetAtTime (click-free)
    amp.gain.setTargetAtTime(Math.max(sus, 0.0001), t + atk, Math.max(0.01, p.decay / 3))

    for (const s of sources) s.start(t)

    const v: Voice = { id: n.id, startTime: t, nodes, sources, amp, release: p.release, releasing: false, peak }
    this.voices.set(n.id, v)
    this.order.push(n.id)
    // a voice leaves the pool only when its last source has actually ended,
    // so releasing tails still count toward polyphony (and can be stolen)
    const last = sources[sources.length - 1]
    last.onended = () => this.cleanup(v)

    // percussive voices (sustain 0) end themselves once the envelope has
    // decayed to ~5%, so they never wait for a noteOff
    if (p.sustain === 0) {
      const auto = t + atk + p.decay * 3
      this.stopSources(v, auto)
    }
  }

  noteOff(id: string, time: number): void {
    const v = this.voices.get(id)
    if (!v) return
    const t = Math.max(time, this.ctx.currentTime)
    this.release(v, t, v.release)
  }

  allNotesOff(time?: number): void {
    const t = time ?? this.ctx.currentTime
    for (const v of Array.from(this.voices.values())) this.release(v, t, 0.05)
  }

  /** Steal: prefer a voice already releasing, else the oldest. Fast fade. */
  private steal(t: number) {
    let victim: Voice | undefined
    for (const id of this.order) {
      const v = this.voices.get(id)
      if (v?.releasing) {
        victim = v
        break
      }
    }
    if (!victim) victim = this.voices.get(this.order[0])
    if (!victim) return
    victim.releasing = false // allow re-release with the fast curve
    this.release(victim, t, 0.03)
    // remove immediately so the caller's while-loop terminates
    this.cleanup(victim, t + 0.1)
  }

  private release(v: Voice, t: number, release: number) {
    if (v.releasing) return
    v.releasing = true
    const rel = Math.max(0.01, release)
    v.amp.gain.cancelScheduledValues(t)
    v.amp.gain.setTargetAtTime(0, t, rel / 3)
    this.stopSources(v, t + rel * 2 + 0.05)
  }

  private stopSources(v: Voice, stopAt: number) {
    for (const s of v.sources) {
      try {
        s.stop(stopAt)
      } catch {
        /* already stopped */
      }
    }
  }

  private cleanup(v: Voice, disconnectAt?: number) {
    this.voices.delete(v.id)
    const k = this.order.indexOf(v.id)
    if (k >= 0) this.order.splice(k, 1)
    const doIt = () => {
      for (const n of v.nodes) n.disconnect()
      for (const s of v.sources) s.disconnect()
    }
    if (disconnectAt === undefined) doIt()
    else window.setTimeout(doIt, Math.max(0, (disconnectAt - this.ctx.currentTime) * 1000 + 50))
  }
}

function makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  // white noise from a fixed LCG so the buffer is identical every load
  let s = 12345
  for (let i = 0; i < len; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    d[i] = (s / 4294967296) * 2 - 1
  }
  return buf
}

/** Synthetic reverb impulse: exponentially decaying stereo noise. */
function makeImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  let s = 777
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
