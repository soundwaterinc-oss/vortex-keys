import {
  SourceClock,
  FixedStepRunner,
  MusicalEventQueue,
  EventBus,
  makeEvent,
  createPrng,
  deriveSeed,
  quantizeTime,
  getScale,
  noteToFrequency,
  noteToCents,
  type Prng,
  type QuantizeValue,
  type TimingMode,
  type ScaleNote,
} from '@el-systema/core'
import { OrbitModel, DEFAULT_ORBIT_PARAMS, defaultGates, DEFAULT_MACROS_GLOBAL, type PhysicsEvent } from '@el-systema/physics'
import { PhysicsFlow, ConfigurableMapper, type GeneratedEvent } from '@el-systema/mapping'
import { SynthEngine, MasterChain, type PitchedNote } from '@el-systema/audio'
import { ORBIT_MAPPINGS } from './mappings'

export const INSTRUMENT_ID = 'orbit'

/** ORBIT's own state: small, rhythm-centred. */
export interface OrbitState {
  bpm: number
  timing: TimingMode
  quantize: QuantizeValue
  scaleId: string
  rootHz: number
  eccentricity: number
  speed: number
  gateCount: number
  mappingId: string
  seed: number
  amount: number
}

export const DEFAULT_ORBIT_STATE: OrbitState = {
  bpm: 112,
  timing: 'hard',
  quantize: '1/16',
  scaleId: 'penta-minor',
  rootHz: 130.8128,
  eccentricity: 0,
  speed: 0.25,
  gateCount: 4,
  mappingId: 'orbit-pulse',
  seed: 1234,
  amount: 1,
}

export interface Hit {
  time: number
  angle: number
  radius: number
  velocity: number
  bodyId: string
}

/**
 * ORBIT prototype engine. Proves the shared core in a second instrument:
 *   clock      SourceClock on the AudioContext (tempo-synced by default)
 *   runner     FixedStepRunner (same fixed dt as VORTEX KEYS)
 *   queue      MusicalEventQueue — quantised hits wait here until due
 *   physics    OrbitModel + gates (same code as VORTEX KEYS' orbit mode)
 *   mapping    ORBIT-specific "Pulse" mapping
 *   audio      shared SynthEngine (wood voice) on the shared MasterChain
 *   seed       deriveSeed(globalSeed, 'orbit')
 */
export class OrbitEngine {
  state: OrbitState = { ...DEFAULT_ORBIT_STATE }
  private listeners = new Set<() => void>()
  ctx: AudioContext | null = null
  synth: SynthEngine | null = null
  clock = new SourceClock(() => 0, DEFAULT_ORBIT_STATE.bpm)
  private runner: FixedStepRunner | null = null
  private queue = new MusicalEventQueue<PitchedNote & { duration: number }>()
  private timer: number | null = null
  physics = new OrbitModel({ ...DEFAULT_ORBIT_PARAMS, gates: defaultGates(4, ['repeat']), eccentricity: 0, speed: 0.25, drift: 0, maxOrbiters: 8, energy: 0.985, maxAge: 120 })
  flow: PhysicsFlow
  private prng: Prng = createPrng(deriveSeed(1234, INSTRUMENT_ID))
  readonly bus: EventBus
  hits: Hit[] = []
  private counter = 0

  constructor(bus: EventBus = new EventBus()) {
    this.bus = bus
    this.flow = new PhysicsFlow(this.physics, new ConfigurableMapper(ORBIT_MAPPINGS[0]), { ...DEFAULT_MACROS_GLOBAL, chaos: 0 }, { maxEventsPerSecond: 16, maxEventsPerStep: 4 })
    this.flow.octaves = 3
    this.flow.onPhysicsEvent = (e: PhysicsEvent) => {
      if (e.type === 'gateCrossing' || e.type === 'periapsis') this.bus.emit(makeEvent(INSTRUMENT_ID, 'orbitHit', e.time, { bodyId: e.bodyId, type: e.type }))
    }
  }

  subscribe(l: () => void) {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  setState(patch: Partial<OrbitState>) {
    const prev = this.state
    this.state = { ...prev, ...patch }
    if (prev.bpm !== this.state.bpm) this.clock.bpm = this.state.bpm
    if (prev.seed !== this.state.seed) this.prng = createPrng(deriveSeed(this.state.seed, INSTRUMENT_ID))
    if (prev.eccentricity !== this.state.eccentricity) this.physics.params.eccentricity = this.state.eccentricity
    if (prev.speed !== this.state.speed) this.physics.params.speed = this.state.speed
    if (prev.gateCount !== this.state.gateCount) this.physics.params.gates = defaultGates(this.state.gateCount, ['repeat'])
    if (prev.mappingId !== this.state.mappingId) this.flow.mapper = new ConfigurableMapper(ORBIT_MAPPINGS.find((m) => m.id === this.state.mappingId) ?? ORBIT_MAPPINGS[0])
    for (const l of this.listeners) l()
  }

  get audioReady() {
    return this.ctx !== null
  }

  async start() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' })
      const chain = new MasterChain(this.ctx, { masterGain: 0.7 })
      this.synth = new SynthEngine(this.ctx, { body: 0.7, air: 0.35, color: 0.5, decay: 0.25, space: 0.2, motion: 0 }, { maxVoices: 12, chain })
      this.synth.setModel('wood')
      const ctx = this.ctx
      this.clock = new SourceClock(() => ctx.currentTime, this.state.bpm)
      this.runner = new FixedStepRunner(this.clock, (dt, t) => this.step(dt, t))
      this.timer = window.setInterval(() => this.tick(), 25)
    }
    if (this.ctx.state !== 'running') await this.ctx.resume()
    this.setState({}) // new state object -> React re-renders (audioReady changed)
  }

  private flowCtx() {
    return { scaleLength: getScale(this.state.scaleId).cents.length, beatSeconds: 60 / this.state.bpm, amount: this.state.amount, prng: this.prng }
  }

  /** Performer action: launch a body on an orbit. `degree` from the click angle, size from the click radius. */
  launch(degree: number, radius: number) {
    const size = Math.max(0.2, Math.min(1, radius))
    const base = this.physics.params.orbitSize
    this.physics.params.orbitSize = size
    this.flow.inject({ degree, octave: 1, velocity: 0.9, time: this.runner?.simTime ?? 0 }, this.flowCtx())
    this.physics.params.orbitSize = base
    this.bus.emit(makeEvent(INSTRUMENT_ID, 'particleSpawned', this.clock.nowSeconds(), { degree, size }))
  }

  dispose() {
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = null
    this.ctx?.close()
    this.ctx = null
  }

  clear() {
    this.flow.clear()
    this.queue.clear()
    this.hits = []
  }

  private tick() {
    if (!this.ctx || !this.runner || !this.synth) return
    this.runner.tick()
    // drain everything due within the lookahead window and sound it
    for (const ev of this.queue.drain(this.ctx.currentTime + 0.15)) {
      this.synth.noteOn(ev.payload, ev.time)
      this.synth.noteOff(ev.payload.id, ev.time + ev.payload.duration)
    }
    const now = this.ctx.currentTime
    this.hits = this.hits.filter((h) => now - h.time < 0.6)
  }

  private step(dt: number, simTime: number) {
    const s = this.state
    const scale = getScale(s.scaleId)
    const events: GeneratedEvent[] = this.flow.update(dt, simTime, this.flowCtx())
    for (const e of events) {
      // ORBIT is tempo-synced by default: HARD quantize on the shared clock
      const t = quantizeTime(e.time, s.timing, s.quantize, s.bpm, this.clock.origin)
      const note: ScaleNote = e.note
      const id = `o${this.counter++}`
      const body = this.physics.bodies().find((b) => b.id === e.sourceId)
      this.queue.push({
        time: t,
        type: 'noteOn',
        payload: {
          id,
          note,
          frequencyHz: noteToFrequency(scale, s.rootHz, note),
          cents: noteToCents(scale, note),
          rootHz: s.rootHz,
          velocity: e.velocity,
          brightness: e.brightness,
          width: e.width,
          generated: true,
          duration: e.duration,
        },
      })
      if (body) this.hits.push({ time: t, angle: body.snapshot.angle, radius: body.snapshot.radius, velocity: e.velocity, bodyId: body.id })
    }
  }

  snapshot() {
    return {
      now: this.ctx?.currentTime ?? 0,
      beat: this.clock.nowBeats(),
      bodies: this.physics.visual() as ReturnType<OrbitModel['visual']>,
      gates: this.physics.params.gates,
      hits: this.hits,
      level: this.synth?.level() ?? 0,
      stats: this.flow.stats(this.runner?.simTime ?? 0),
    }
  }
}
