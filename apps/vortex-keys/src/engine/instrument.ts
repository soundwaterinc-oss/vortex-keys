import type { InstrumentState, Preset } from '../preset/types'
import { defaultState, sanitizePreset } from '../preset/presets'
import { getScale } from '@el-systema/core'
import { indexToNote, noteToCents, noteToFrequency, noteToIndex, wrapDegree } from '@el-systema/core'
import type { Scale, ScaleNote } from '@el-systema/core'
import type { FlowContext, FlowModel, GeneratedEvent } from '@el-systema/mapping'
import { ManualModel } from '@el-systema/mapping'
import { PhysicsFlow, type FlowStats, type MonitorSample } from '@el-systema/mapping'
import { GravityModel } from '@el-systema/physics'
import { OrbitModel } from '@el-systema/physics'
import { WaveFieldModel } from '@el-systema/physics'
import { CoupledModel } from '@el-systema/physics'
import { ChaosModel } from '@el-systema/physics'
import type { PhysicsBody, PhysicsEvent, PhysicsModel } from '@el-systema/physics'
import { ConfigurableMapper } from '@el-systema/mapping'
import { getMapping } from '@el-systema/mapping'
import { createPrng, type Prng } from '@el-systema/core'
import { quantizeTime } from '@el-systema/core'
import { SynthEngine } from '@el-systema/audio'
import { MultiSink, type NoteSink, type PitchedNote } from '@el-systema/audio'
import { clamp } from '@el-systema/core'

/** Visual-facing record of a note currently sounding. */
export interface ActiveNote {
  id: string
  index: number
  note: ScaleNote
  velocity: number
  start: number
  end: number
  generated: boolean
  sourceId?: string
}

export interface Snapshot {
  now: number
  modelId: string
  bodies: PhysicsBody[]
  /** model-specific visual payload (see each model's visual()) */
  visual: unknown
  globals: Record<string, number>
  recentEvents: PhysicsEvent[]
  stats: FlowStats | null
  monitor: MonitorSample | null
  active: ActiveNote[]
  level: number
  voices: number
  running: boolean
}

type Listener = () => void

const SIM_DT = 1 / 120 // fixed simulation step (s)
const LOOKAHEAD = 0.12 // how far ahead of the audio clock we simulate (s)
const TICK_MS = 25

/**
 * Instrument: owns state, the flow model, the audio sinks and the scheduler.
 * React only reads state via `subscribe`/`getState` and calls the action
 * methods; all musical decisions live here or in core/.
 */
export class Instrument {
  private state: InstrumentState = defaultState()
  private listeners = new Set<Listener>()
  private ctx: AudioContext | null = null
  private synth: SynthEngine | null = null
  private sink: MultiSink = new MultiSink([])
  private flow: FlowModel = new ManualModel()
  private prng: Prng = createPrng(1234)
  private simTime = 0
  private timer: number | null = null
  private active = new Map<string, ActiveNote>()
  private held = new Set<number>()
  private sustained = new Set<number>()
  private latched = new Set<number>()
  private clockOrigin = 0
  private genCounter = 0

  constructor() {
    this.rebuildFlow()
  }

  // ---------- state ----------
  getState() {
    return this.state
  }
  subscribe(l: Listener) {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  private emit() {
    for (const l of this.listeners) l()
  }

  /** Shallow-merge a slice of state and apply side effects. */
  setState(patch: Partial<InstrumentState> | ((s: InstrumentState) => Partial<InstrumentState>)) {
    const p = typeof patch === 'function' ? patch(this.state) : patch
    const prev = this.state
    this.state = { ...prev, ...p }
    this.applyStateDiff(prev, this.state)
    this.emit()
  }

  private applyStateDiff(prev: InstrumentState, next: InstrumentState) {
    if (prev.sound !== next.sound && this.synth) {
      this.synth.setModel(next.sound.model)
      this.synth.setMacros(next.sound.macros)
    }
    if (prev.flow !== next.flow) {
      if (prev.flow.mode !== next.flow.mode || prev.flow.seed !== next.flow.seed) this.rebuildFlow()
      else this.pushFlowParams()
    }
    if (prev.perf.frozen !== next.perf.frozen) this.flow.setFrozen(next.perf.frozen)
    if (prev.perf.sustain && !next.perf.sustain) this.releaseSustained()
    if (prev.perf.latch && !next.perf.latch) this.releaseLatched()
    if (prev.tuning !== next.tuning) {
      // tuning changes only while nothing is sounding: stop everything cleanly
      this.panic()
      this.pushFlowParams()
    }
  }

  loadPreset(raw: unknown) {
    const p = sanitizePreset(raw)
    this.panic()
    this.setState((s) => ({ ...p, perf: { ...s.perf, frozen: false } }))
  }

  exportPreset(): Preset {
    const { perf: _p, ...preset } = this.state
    void _p
    return JSON.parse(JSON.stringify(preset))
  }

  // ---------- audio lifecycle ----------
  get audioReady() {
    return this.ctx !== null
  }

  /** Must be called from a user gesture. */
  async start() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' })
      this.synth = new SynthEngine(this.ctx, this.state.sound.macros, { maxVoices: 24 })
      this.synth.setModel(this.state.sound.model)
      this.sink = new MultiSink([this.synth])
      this.simTime = this.ctx.currentTime
      this.clockOrigin = this.ctx.currentTime
      this.timer = window.setInterval(() => this.tick(), TICK_MS)
      document.addEventListener('visibilitychange', this.onVisibility)
    }
    if (this.ctx.state !== 'running') await this.ctx.resume()
    // new state object so React subscribers re-render (audioReady changed)
    this.setState({})
  }

  /** Stop the scheduler and close audio (e.g. on unmount). */
  dispose() {
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = null
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.panic()
    this.ctx?.close()
    this.ctx = null
    this.synth = null
  }

  /** Add an extra output (MIDI, OSC) alongside the synth. */
  addSink(s: NoteSink) {
    this.sink.sinks.push(s)
  }

  private onVisibility = () => {
    // when hidden, browsers throttle timers; audio keeps running but we let
    // the simulation catch up in larger chunks (capped) rather than burst.
    if (!document.hidden && this.ctx) this.simTime = Math.max(this.simTime, this.ctx.currentTime - 0.25)
  }

  // ---------- pitch resolution ----------
  private scale(): Scale {
    return getScale(this.state.tuning.scaleId)
  }

  private resolve(note: ScaleNote, velocity: number, id: string, generated: boolean, brightness?: number): PitchedNote {
    const scale = this.scale()
    const rootHz = this.state.tuning.rootHz
    return {
      id,
      note,
      frequencyHz: noteToFrequency(scale, rootHz, note),
      cents: noteToCents(scale, note),
      rootHz,
      velocity,
      brightness,
      generated,
    }
  }

  private flowContext(): FlowContext {
    return {
      scaleLength: this.scale().cents.length,
      beatSeconds: 60 / this.state.time.bpm,
      amount: this.state.flow.amount,
      prng: this.prng,
    }
  }

  // ---------- performer actions ----------
  noteOn(index: number, velocity = 0.8) {
    if (!this.ctx) return
    const s = this.state
    if (s.perf.latch) {
      if (this.latched.has(index)) {
        this.latched.delete(index)
        this.sink.noteOff(`k${index}`, this.ctx.currentTime)
        this.active.delete(`k${index}`)
        return
      }
      this.latched.add(index)
    }
    const n = this.scale().cents.length
    const note = indexToNote(index, n)
    const id = `k${index}`
    const t = this.ctx.currentTime
    this.sink.noteOn(this.resolve(note, velocity, id, false), t)
    this.held.add(index)
    this.active.set(id, { id, index, note, velocity, start: t, end: Infinity, generated: false })
    this.flow.inject({ ...note, velocity, time: this.simTime }, this.flowContext())
  }

  noteOff(index: number) {
    if (!this.ctx) return
    this.held.delete(index)
    if (this.state.perf.latch && this.latched.has(index)) return
    if (this.state.perf.sustain) {
      this.sustained.add(index)
      return
    }
    this.sink.noteOff(`k${index}`, this.ctx.currentTime)
    this.active.delete(`k${index}`)
  }

  private releaseSustained() {
    if (!this.ctx) return
    for (const i of this.sustained) {
      if (this.held.has(i)) continue
      this.sink.noteOff(`k${i}`, this.ctx.currentTime)
      this.active.delete(`k${i}`)
    }
    this.sustained.clear()
  }

  private releaseLatched() {
    if (!this.ctx) return
    for (const i of this.latched) {
      this.sink.noteOff(`k${i}`, this.ctx.currentTime)
      this.active.delete(`k${i}`)
    }
    this.latched.clear()
  }

  /** Stop all sound and generated material. */
  panic() {
    this.sink.allNotesOff()
    this.active.clear()
    this.held.clear()
    this.sustained.clear()
    this.latched.clear()
    this.flow.clear()
  }

  clearFlow() {
    this.flow.clear()
    for (const [id, a] of this.active) if (a.generated) this.active.delete(id)
    if (this.ctx) for (const a of Array.from(this.active.values())) if (a.generated) this.sink.noteOff(a.id, this.ctx.currentTime)
  }

  /** Re-seed and randomise the current model's parameters (deterministic from the new seed). */
  randomize() {
    const seed = (Math.random() * 4294967295) >>> 0
    const r = createPrng(seed)
    this.setState((s) => ({
      flow: {
        ...s.flow,
        seed,
        macros: { energy: 0.3 + r.next() * 0.5, chaos: r.next(), time: 0.35 + r.next() * 0.3, space: r.next() },
        vortex: { ...s.flow.vortex, spin: 0.05 + r.next() * 0.5, pull: 0.01 + r.next() * 0.08, decay: 0.8 + r.next() * 0.18, alpha: 0.5 + r.next() * 1.2 },
        orbit: { ...s.flow.orbit, eccentricity: r.next() * 0.85, speed: 0.05 + r.next() * 0.3, precession: (r.next() - 0.5) * 0.08, drift: r.next() * 0.4 },
        wave: { ...s.flow.wave, baseRate: 0.08 + r.next() * 0.4, threshold: 0.2 + r.next() * 0.6, wavelength: 0.3 + r.next() * 1.2, sourceRotation: r.next() },
        coupled: { ...s.flow.coupled, coupling: r.next() * 1.5, spread: r.next() * 0.5, drift: r.next() * 0.2 },
        chaos: { ...s.flow.chaos, r: 3.3 + r.next() * 0.7, updateRate: 1 + r.next() * 5, smoothing: r.next() * 0.8 },
        gates: s.flow.gates.map((g) => ({
          ...g,
          action: (['repeat', 'degreeUp', 'degreeDown', 'octaveUp', 'octaveDown', 'velocityDown', 'spawnChild'] as const)[r.int(7)],
        })),
      },
    }))
  }

  // ---------- flow ----------
  /**
   * Build the physics model for the current mode and wrap it with the
   * selected mapper. Switching modes never touches the synth: sounding
   * voices finish naturally, only generated state is dropped.
   */
  private rebuildFlow() {
    const f = this.state.flow
    this.prng = createPrng(f.seed)
    this.flow.clear()
    let physics: PhysicsModel | null = null
    switch (f.mode) {
      case 'vortex':
        physics = new GravityModel({ ...f.vortex, gates: f.gates })
        break
      case 'orbit':
        physics = new OrbitModel({ ...f.orbit, gates: f.gates })
        break
      case 'wave':
        physics = new WaveFieldModel({ ...f.wave, ratios: [...f.wave.ratios] })
        break
      case 'coupled':
        physics = new CoupledModel({ ...f.coupled })
        break
      case 'chaos':
        physics = new ChaosModel({ ...f.chaos })
        break
    }
    if (physics) {
      const pf = new PhysicsFlow(physics, new ConfigurableMapper(getMapping(f.mappingId)), { ...f.macros }, { ...f.limits })
      pf.octaves = this.state.tuning.octaves
      this.flow = pf
    } else {
      this.flow = new ManualModel()
    }
    this.flow.setFrozen(this.state.perf.frozen)
  }

  /** Push parameter edits into the live model without resetting its state. */
  private pushFlowParams() {
    const f = this.state.flow
    if (!(this.flow instanceof PhysicsFlow)) return
    const pf = this.flow
    pf.macros = { ...f.macros }
    pf.limits = { ...f.limits }
    pf.octaves = this.state.tuning.octaves
    if (pf.mapper.config.id !== f.mappingId) pf.mapper = new ConfigurableMapper(getMapping(f.mappingId))
    const ph = pf.physics
    if (ph instanceof GravityModel) Object.assign(ph.params, f.vortex, { gates: f.gates })
    else if (ph instanceof OrbitModel) Object.assign(ph.params, f.orbit, { gates: f.gates })
    else if (ph instanceof WaveFieldModel) Object.assign(ph.params, f.wave, { ratios: [...f.wave.ratios] })
    else if (ph instanceof CoupledModel) Object.assign(ph.params, f.coupled)
    else if (ph instanceof ChaosModel) Object.assign(ph.params, f.chaos)
  }

  /** Re-initialise the model's internal state deterministically (coupled phases, chaos x0). */
  resetFlow() {
    if (this.flow instanceof PhysicsFlow) this.flow.reset(this.flowContext())
  }

  // ---------- scheduler ----------
  private tick() {
    if (!this.ctx || !this.synth) return
    const target = this.ctx.currentTime + LOOKAHEAD
    // if we fell far behind (tab hidden), skip rather than burst events
    if (target - this.simTime > 1) this.simTime = target - LOOKAHEAD
    const ctx = this.flowContext()
    let guard = 0
    while (this.simTime < target && guard++ < 400) {
      const events = this.flow.update(SIM_DT, this.simTime, ctx)
      for (const e of events) this.scheduleEvent(e)
      this.simTime += SIM_DT
    }
    // drop finished visual records
    const now = this.ctx.currentTime
    for (const [id, a] of this.active) if (a.end < now - 0.05) this.active.delete(id)
  }

  private scheduleEvent(e: GeneratedEvent) {
    if (!this.ctx) return
    const s = this.state
    if (s.flow.amount <= 0) return
    const t = quantizeTime(e.time, s.time.mode, s.time.quantize, s.time.bpm, this.clockOrigin)
    const n = this.scale().cents.length
    // keep generated notes inside the visible spiral: fold octaves
    const w = wrapDegree(e.note.degree, e.note.octave, n)
    const oct = clamp(w.octave, 0, s.tuning.octaves - 1)
    const note = { degree: w.degree, octave: oct }
    const id = `g${this.genCounter++}`
    const pn = this.resolve(note, e.velocity, id, true, e.brightness)
    pn.width = e.width
    this.sink.noteOn(pn, t)
    this.sink.noteOff(id, t + e.duration)
    this.active.set(id, {
      id,
      index: noteToIndex(note, n),
      note,
      velocity: e.velocity,
      start: t,
      end: t + e.duration,
      generated: true,
      sourceId: e.sourceId,
    })
  }

  // ---------- visual snapshot ----------
  snapshot(): Snapshot {
    const now = this.ctx?.currentTime ?? 0
    const pf = this.flow instanceof PhysicsFlow ? this.flow : null
    return {
      now,
      modelId: this.flow.id,
      bodies: pf ? pf.physics.bodies() : [],
      visual: pf ? pf.physics.visual() : null,
      globals: pf ? pf.physics.globals() : {},
      recentEvents: pf ? pf.recent : [],
      stats: pf ? pf.stats(this.simTime) : null,
      monitor: pf ? pf.lastSample : null,
      active: Array.from(this.active.values()).filter((a) => a.start <= now + 0.001),
      level: this.synth?.level() ?? 0,
      voices: this.synth?.voiceCount ?? 0,
      running: this.ctx?.state === 'running',
    }
  }
}
