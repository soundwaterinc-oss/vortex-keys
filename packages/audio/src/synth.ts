import type { NoteSink, PitchedNote } from './sink'
import { MODELS, type Macros, type SoundModel, type SoundModelId } from './voices'
import { safeParam } from '@el-systema/core'
import { makeNoise, MasterChain } from './dsp'

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
 * Bus: see MasterChain in dsp.ts (shared by every instrument engine).
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
  /** share an existing output stage instead of creating one */
  chain?: MasterChain
  /** connect voices here instead of directly to the chain input (an instrument bus) */
  output?: AudioNode
}

export class SynthEngine implements NoteSink {
  readonly ctx: AudioContext
  /**
   * Sound layers: every note sounds once through each model here, so
   * switching timbres stacks rather than replaces. `modelId` is the newest.
   */
  layers: SoundModelId[] = ['glass']
  modelId: SoundModelId = 'glass'
  macros: Macros
  private voices = new Map<string, Voice>()
  private order: string[] = []
  private noiseBuffer: AudioBuffer
  private voiceBus: GainNode
  private maxVoices: number
  /** shared output stage (may be handed in so several engines share one) */
  readonly chain: MasterChain

  constructor(ctx: AudioContext, macros: Macros, opts: SynthOptions = { maxVoices: 24 }) {
    this.ctx = ctx
    this.macros = { ...macros }
    this.maxVoices = opts.maxVoices
    this.noiseBuffer = makeNoise(ctx, 2)
    this.chain = opts.chain ?? new MasterChain(ctx)
    this.voiceBus = ctx.createGain()
    this.voiceBus.gain.value = 1
    this.voiceBus.connect(opts.output ?? this.chain.input)
    this.setMacros(this.macros)
  }

  /** single model (replaces all layers) */
  setModel(id: SoundModelId) {
    this.setLayers([id])
  }

  /** stack of models; the last one is the "current" model. Empty falls back to glass. */
  setLayers(ids: SoundModelId[]) {
    const list = ids.filter((id) => id in MODELS)
    this.layers = list.length ? list : ['glass']
    this.modelId = this.layers[this.layers.length - 1]
  }

  setMacros(m: Macros) {
    this.macros = { ...m }
    // SPACE is a bus-level macro handled by the shared output stage
    this.chain.setSpace(m.space)
  }

  get voiceCount() {
    return this.voices.size
  }

  /** output RMS level 0..1 (for meter) */
  level(): number {
    return this.chain.level()
  }

  noteOn(n: PitchedNote, time: number): void {
    const t = Math.max(time, this.ctx.currentTime)
    // one voice per layer; the same note id retriggered releases every layer
    this.noteOff(n.id, t)
    // loudness is shared across the stack so adding a layer doesn't clip
    const scale = 1 / Math.sqrt(this.layers.length)
    this.layers.forEach((id, k) => this.startVoice(MODELS[id], `${n.id}#${k}`, n, t, scale))
  }

  private startVoice(model: SoundModel, key: string, n: PitchedNote, t: number, scale: number): void {
    const ctx = this.ctx
    const f = safeParam(n.frequencyHz, 16, 16000, 440)
    while (this.voices.size >= this.maxVoices) this.steal(t)

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
      if (p.noiseDecay !== undefined) ng.gain.setTargetAtTime(0, t + 0.003, Math.max(0.004, p.noiseDecay))
      else if (p.sustain < 0.5) ng.gain.setTargetAtTime(0, t + 0.005, 0.04 + p.decay * 0.05)
      noise.connect(nf).connect(ng).connect(filter)
      sources.push(noise)
      nodes.push(nf, ng)
    }

    // additive partials (drawbars / ranks): steady, no auto-fade
    for (const d of p.additive ?? []) {
      if (d.gain <= 0) continue
      const o = ctx.createOscillator()
      o.type = d.type ?? 'sine'
      o.frequency.setValueAtTime(safeParam(f * d.ratio, 16, 18000, f), t)
      if (d.detuneCents) o.detune.value = d.detuneCents
      const g = ctx.createGain()
      g.gain.value = safeParam(d.gain, 0, 1, 0.2)
      o.connect(g).connect(filter)
      sources.push(o)
      nodes.push(g)
    }

    // formant bank: filter -> parallel band-passes -> amp
    let ampIn: AudioNode = filter
    if (p.formants && p.formants.length > 0) {
      const sum = ctx.createGain()
      sum.gain.value = 1
      for (const fm of p.formants) {
        const bp = ctx.createBiquadFilter()
        bp.type = 'bandpass'
        bp.frequency.value = safeParam(fm.hz, 60, 8000, 800)
        bp.Q.value = safeParam(fm.q, 0.5, 30, 8)
        const g = ctx.createGain()
        g.gain.value = safeParam(fm.gain, 0, 2, 0.5)
        filter.connect(bp).connect(g).connect(sum)
        nodes.push(bp, g)
      }
      ampIn = sum
      nodes.push(sum)
    }

    // LFO
    if (p.lfoPitchCents > 0 || p.lfoFilterHz > 0 || p.lfoPan > 0 || (p.lfoAmp ?? 0) > 0) {
      const lfo = ctx.createOscillator()
      lfo.type = 'sine'
      lfo.frequency.value = safeParam(p.lfoHz, 0.01, 20, 1)
      if (p.lfoPitchCents > 0) {
        const g = ctx.createGain()
        g.gain.value = p.lfoPitchCents
        // vibrato on every pitched oscillator so additive ranks stay locked
        for (const s of sources) if (s instanceof OscillatorNode) g.connect(s.detune)
        nodes.push(g)
        lfo.connect(g)
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
      if ((p.lfoAmp ?? 0) > 0) {
        // tremolo: gain node sits at 1 - depth/2 and the LFO swings it ±depth/2
        const depth = safeParam(p.lfoAmp!, 0, 1, 0) * 0.5
        const trem = ctx.createGain()
        trem.gain.value = 1 - depth
        const g = ctx.createGain()
        g.gain.value = depth
        lfo.connect(g).connect(trem.gain)
        ampIn.connect(trem)
        ampIn = trem
        nodes.push(g, trem)
      }
      sources.push(lfo)
    }

    ampIn.connect(amp).connect(pan).connect(this.voiceBus)
    nodes.push(filter, amp, pan)

    // amplitude envelope: velocity to level is a gentle curve so soft
    // generated notes stay audible; peak is conservative (< 0.5 per voice)
    const peak = safeParam(p.level * scale * (0.25 + 0.75 * Math.pow(vel, 1.4)), 0, 0.6, 0.2)
    const atk = Math.max(0.002, p.attack)
    amp.gain.linearRampToValueAtTime(peak, t + atk)
    const sus = peak * p.sustain
    // exponential-ish decay toward sustain via setTargetAtTime (click-free)
    amp.gain.setTargetAtTime(Math.max(sus, 0.0001), t + atk, Math.max(0.01, p.decay / 3))

    for (const s of sources) s.start(t)

    const v: Voice = { id: key, startTime: t, nodes, sources, amp, release: p.release, releasing: false, peak }
    this.voices.set(key, v)
    this.order.push(key)
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
    const t = Math.max(time, this.ctx.currentTime)
    const prefix = `${id}#`
    for (const v of this.voices.values()) if (v.id.startsWith(prefix)) this.release(v, t, v.release)
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

