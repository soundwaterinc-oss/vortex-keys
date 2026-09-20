import type { InstrumentState, Preset } from '../preset/types'
import { defaultState, sanitizePreset } from '../preset/presets'
import { getScale } from '@el-systema/core'
import { indexToNote, noteToCents, noteToFrequency, noteToIndex, wrapDegree } from '@el-systema/core'
import type { Scale, ScaleNote } from '@el-systema/core'
import type { FlowContext, FlowModel, GeneratedEvent } from '@el-systema/mapping'
import { ManualModel, PhysicsFlow, type FlowStats, type MonitorSample } from '@el-systema/mapping'
import type { PhysicsBody, PhysicsEvent } from '@el-systema/physics'
import { createPrng, type Prng, quantizeTime, clamp, deriveSeed } from '@el-systema/core'
import { SourceClock, FixedStepRunner, EventBus, makeEvent, type MusicalClock } from '@el-systema/core'
import { SynthEngine, MultiSink, type NoteSink, type PitchedNote } from '@el-systema/audio'
import { createFlow, pushFlowParams } from './flowFactory'

export const INSTRUMENT_ID = 'vortex-keys'

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
  private timer: number | null = null
  /** shared-family clock (audio-driven once started) and fixed-step runner */
  clock: MusicalClock & { bpm: number } = new SourceClock(() => 0, 84)
  private runner: FixedStepRunner | null = null
  /** internal communication: other instruments / bridges subscribe here */
  readonly bus: EventBus
  private active = new Map<string, ActiveNote>()
  private held = new Set<number>()
  private sustained = new Set<number>()
  private latched = new Set<number>()
  private genCounter = 0

  constructor(bus: EventBus = new EventBus()) {
    this.bus = bus
    this.rebuildFlow()
  }

  private get simTime() {
    return this.runner ? this.runner.simTime : this.clock.nowSeconds()
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
      this.synth.setLayers(next.sound.layers)
      this.synth.setMacros(next.sound.macros)
    }
    if (prev.flow !== next.flow) {
      if (prev.flow.mode !== next.flow.mode || prev.flow.seed !== next.flow.seed) this.rebuildFlow()
      else this.pushFlowParams()
    }
    if (prev.time.bpm !== next.time.bpm) this.clock.bpm = next.time.bpm
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
      this.synth = new SynthEngine(this.ctx, this.state.sound.macros, { maxVoices: 40 })
      this.synth.setLayers(this.state.sound.layers)
      this.sink = new MultiSink([this.synth])
      const ctx = this.ctx
      this.clock = new SourceClock(() => ctx.currentTime, this.state.time.bpm)
      this.runner = new FixedStepRunner(this.clock, (dt, t) => this.step(dt, t))
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
    if (!document.hidden) this.runner?.resync()
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
    this.bus.emit(makeEvent(INSTRUMENT_ID, 'notePlayed', t, { index, note, velocity, frequencyHz: noteToFrequency(this.scale(), s.tuning.rootHz, note) }))
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
    this.bus.emit(makeEvent(INSTRUMENT_ID, 'noteReleased', this.ctx.currentTime, { index }))
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
    // instrument-specific stream derived from the (global) seed
    this.prng = createPrng(deriveSeed(f.seed, INSTRUMENT_ID))
    this.flow.clear()
    this.flow = createFlow(f, this.state.tuning.octaves, this.state.perf.frozen)
    if (this.flow instanceof PhysicsFlow) this.flow.onPhysicsEvent = (e) => this.publishPhysicsEvent(e)
  }

  /** Push parameter edits into the live model without resetting its state. */
  private pushFlowParams() {
    pushFlowParams(this.flow, this.state.flow, this.state.tuning.octaves)
  }

  /** Semantic physics events go out on the bus so other instruments can react. */
  private publishPhysicsEvent(e: PhysicsEvent) {
    const type = e.type === 'gateCrossing' ? 'gateCrossed' : e.type === 'sync' ? 'syncChanged' : e.type === 'extrema' ? 'wavePeak' : e.type
    this.bus.emit(makeEvent(INSTRUMENT_ID, type, e.time, { bodyId: e.bodyId, snapshot: e.current, direction: e.direction, gate: e.gate?.action }))
  }

  /** Re-initialise the model's internal state deterministically (coupled phases, chaos x0). */
  resetFlow() {
    if (this.flow instanceof PhysicsFlow) this.flow.reset(this.flowContext())
  }

  // ---------- scheduler ----------
  private tick() {
    if (!this.ctx || !this.runner) return
    this.runner.tick()
    const now = this.ctx.currentTime
    for (const [id, a] of this.active) if (a.end < now - 0.05) this.active.delete(id)
  }

  /** One fixed simulation step: advance the flow and schedule what it generated. */
  private step(dt: number, simTime: number) {
    const events = this.flow.update(dt, simTime, this.flowContext())
    for (const e of events) this.scheduleEvent(e)
  }

  private scheduleEvent(e: GeneratedEvent) {
    if (!this.ctx) return
    const s = this.state
    if (s.flow.amount <= 0) return
    const t = quantizeTime(e.time, s.time.mode, s.time.quantize, s.time.bpm, this.clock.origin)
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
