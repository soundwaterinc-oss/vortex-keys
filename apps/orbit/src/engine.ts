import {
  FixedStepRunner,
  MusicalEventQueue,
  EventBus,
  makeEvent,
  continueEvent,
  createPrng,
  deriveSeed,
  quantizeTime,
  getScale,
  resolvePitch,
  clamp,
  type Prng,
  type QuantizeValue,
  type TimingMode,
  type SystemEvent,
  type EventMeta,
  type MusicalClock,
} from '@el-systema/core'
import { OrbitModel, DEFAULT_ORBIT_PARAMS, defaultGates, DEFAULT_MACROS_GLOBAL, type PhysicsEvent, type OrbitBody, type MusicalIdentity } from '@el-systema/physics'
import { PhysicsFlow, ConfigurableMapper, type GeneratedEvent } from '@el-systema/mapping'
import { SynthEngine, type PitchedNote } from '@el-systema/audio'
import { EnsembleHost, type HostedInstrument } from '@el-systema/host'
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
  maxBodies: number
  /** seconds a body lives at most */
  bodyLifetime: number
  /** energy multiplier per second */
  energyDecay: number
  /** sound model used for hits */
  sound: 'wood' | 'glass' | 'pluck' | 'breath'
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
  maxBodies: 12,
  bodyLifetime: 90,
  energyDecay: 0.985,
  sound: 'wood',
}

export interface Hit {
  time: number
  angle: number
  radius: number
  velocity: number
  bodyId: string
}

/** What a bridge hands ORBIT: semantic pitch identity + energy + physical hints. */
export interface OrbitSpawnRequest {
  scaleDegree: number
  octave: number
  velocity: number
  /** 0..1, from VELOCITY → ENERGY */
  energy: number
  orbitSize?: number
  eccentricity?: number
  sourceId?: string
}

/**
 * ORBIT engine. Standalone it creates its own EnsembleHost; in ENSEMBLE it
 * receives the shared one. Pipeline: OrbitModel (physics) → PhysicsFlow +
 * Pulse mapping (music) → quantize on the shared clock → MusicalEventQueue →
 * SynthEngine on this instrument's bus. Physics never touches the synth.
 */
export class OrbitEngine implements HostedInstrument<OrbitState> {
  readonly id = INSTRUMENT_ID
  state: OrbitState = { ...DEFAULT_ORBIT_STATE }
  private listeners = new Set<() => void>()
  host: EnsembleHost | null = null
  private ownsHost = false
  ctx: AudioContext | null = null
  synth: SynthEngine | null = null
  clock: MusicalClock & { bpm: number } = { bpm: DEFAULT_ORBIT_STATE.bpm, nowSeconds: () => 0, nowBeats: () => 0, origin: 0 }
  private runner: FixedStepRunner | null = null
  private queue = new MusicalEventQueue<PitchedNote & { duration: number }>()
  private timer: number | null = null
  physics: OrbitModel
  flow: PhysicsFlow
  private prng: Prng = createPrng(deriveSeed(DEFAULT_ORBIT_STATE.seed, INSTRUMENT_ID))
  bus: EventBus
  hits: Hit[] = []
  /** recent spawns for the transfer pulse visual */
  spawns: { time: number; bodyId: string }[] = []
  private counter = 0
  /** provenance of every body: which event chain created it */
  private bodyMeta = new Map<string, EventMeta>()
  private unsubs: (() => void)[] = []
  private notesGenerated = 0

  constructor(bus: EventBus = new EventBus()) {
    this.bus = bus
    const s = this.state
    this.physics = new OrbitModel({
      ...DEFAULT_ORBIT_PARAMS,
      gates: defaultGates(s.gateCount, ['repeat']),
      eccentricity: s.eccentricity,
      speed: s.speed,
      drift: 0,
      maxOrbiters: s.maxBodies,
      energy: s.energyDecay,
      maxAge: s.bodyLifetime,
      keplerian: true,
      referenceAxis: 0.5,
      evictWhenFull: true,
    })
    this.flow = new PhysicsFlow(this.physics, new ConfigurableMapper(ORBIT_MAPPINGS[0]), { ...DEFAULT_MACROS_GLOBAL, chaos: 0 }, { maxEventsPerSecond: 16, maxEventsPerStep: 4 })
    this.flow.octaves = 3
    this.flow.onPhysicsEvent = (e: PhysicsEvent) => this.publishPhysicsEvent(e)
  }

  // ---------- state ----------
  subscribe(l: () => void) {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  getState() {
    return this.state
  }
  setState(patch: Partial<OrbitState>) {
    const prev = this.state
    this.state = { ...prev, ...patch }
    const s = this.state
    if (prev.bpm !== s.bpm) {
      if (this.ownsHost) this.host?.setTempo(s.bpm)
      else this.clock.bpm = s.bpm
    }
    if (prev.seed !== s.seed) this.prng = createPrng(deriveSeed(s.seed, INSTRUMENT_ID))
    const p = this.physics.params
    if (prev.eccentricity !== s.eccentricity) p.eccentricity = s.eccentricity
    if (prev.speed !== s.speed) p.speed = s.speed
    if (prev.gateCount !== s.gateCount) p.gates = defaultGates(s.gateCount, ['repeat'])
    if (prev.maxBodies !== s.maxBodies) p.maxOrbiters = s.maxBodies
    if (prev.bodyLifetime !== s.bodyLifetime) p.maxAge = s.bodyLifetime
    if (prev.energyDecay !== s.energyDecay) p.energy = s.energyDecay
    if (prev.mappingId !== s.mappingId) this.flow.mapper = new ConfigurableMapper(ORBIT_MAPPINGS.find((m) => m.id === s.mappingId) ?? ORBIT_MAPPINGS[0])
    if (prev.sound !== s.sound && this.synth) this.synth.setModel(s.sound)
    for (const l of this.listeners) l()
  }

  get audioReady() {
    return this.ctx !== null
  }

  // ---------- lifecycle ----------
  async start(host?: EnsembleHost) {
    if (!this.ctx) {
      const s = this.state
      if (host) {
        this.host = host
        this.ownsHost = false
        this.bus = host.bus
        this.state = { ...s, bpm: host.global.tempo, scaleId: host.global.tuningId, rootHz: host.global.rootFrequency, seed: host.global.seed }
        this.prng = createPrng(deriveSeed(this.state.seed, INSTRUMENT_ID))
      } else {
        this.host = EnsembleHost.create({ tempo: s.bpm, tuningId: s.scaleId, rootFrequency: s.rootHz, seed: s.seed }, this.bus)
        this.ownsHost = true
      }
      const h = this.host
      this.ctx = h.audio
      this.synth = new SynthEngine(this.ctx, { body: 0.7, air: 0.35, color: 0.5, decay: 0.25, space: 0.2, motion: 0 }, { maxVoices: 12, chain: h.master, output: h.instrumentBus(INSTRUMENT_ID).input })
      this.synth.setModel(this.state.sound)
      this.clock = h.clock
      this.runner = new FixedStepRunner(this.clock, (dt, t) => this.step(dt, t))
      this.timer = window.setInterval(() => this.tick(), 25)
      this.unsubs.push(h.bus.onNamespace('ensemble.', (e) => this.handleSystemEvent(e)))
    }
    await this.host!.resume()
    this.setState({}) // new state object -> React re-renders (audioReady changed)
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = null
    for (const u of this.unsubs) u()
    this.unsubs = []
    this.synth?.allNotesOff()
    if (this.ownsHost) this.host?.dispose()
    this.host = null
    this.ctx = null
    this.synth = null
  }
  dispose() {
    this.stop()
  }

  // ---------- events in ----------
  /**
   * ENSEMBLE-level changes and routed requests. Note the absence of any
   * rule for `orbit.noteGenerated`: ORBIT never feeds itself.
   */
  handleSystemEvent(e: SystemEvent) {
    switch (e.type) {
      case 'ensemble.tempoChanged':
        this.setState({ bpm: (e.payload as { bpm: number }).bpm })
        break
      case 'ensemble.tuningChanged': {
        const p = e.payload as { tuningId: string; rootFrequency: number }
        this.setState({ scaleId: p.tuningId, rootHz: p.rootFrequency })
        break
      }
      case 'ensemble.seedChanged':
        this.setState({ seed: (e.payload as { seed: number }).seed })
        break
      case 'ensemble.reset':
        this.clear()
        break
      case 'ensemble.orbitSpawnRequested':
        this.spawnFromRequest(e.payload as OrbitSpawnRequest, e.meta)
        break
    }
  }

  private flowCtx() {
    return { scaleLength: getScale(this.state.scaleId).cents.length, beatSeconds: 60 / this.state.bpm, amount: this.state.amount, prng: this.prng }
  }
  private pctx() {
    const f = this.flowCtx()
    return { ...f, octaves: this.flow.octaves, macros: this.flow.macros }
  }

  /** Performer action (standalone dial): launch a body; pitch from the click angle, size from the radius. */
  launch(degree: number, radius: number) {
    const size = clamp(radius, 0.2, 1)
    const body = this.physics.inject({ degree, octave: 1, velocity: 0.9 }, this.pctx(), this.runner?.simTime ?? 0, { orbitSize: size })
    if (!body) return
    const ev = makeEvent(INSTRUMENT_ID, 'orbit.bodySpawned', this.clock.nowSeconds(), { bodyId: body.id, scaleDegree: degree, octave: 1, orbitSize: size })
    this.bodyMeta.set(body.id, ev.meta)
    this.spawns.push({ time: this.clock.nowSeconds(), bodyId: body.id })
    this.bus.emit(ev)
  }

  /**
   * Bridge entry: a note from another instrument becomes a body. Identity
   * (degree, octave, velocity) is kept verbatim; energy shapes the physics
   * within clamped ranges: higher energy → slightly more eccentric, faster,
   * longer-lived. Octave → orbit size (higher = smaller = faster recurrence)
   * unless the request fixes a size.
   */
  spawnFromRequest(req: OrbitSpawnRequest, meta: EventMeta): OrbitBody | null {
    const energy = clamp(req.energy, 0.05, 1)
    const identity: MusicalIdentity = { degree: req.scaleDegree, octave: req.octave, velocity: clamp(req.velocity, 0.05, 1) }
    const octaves = this.flow.octaves
    const size = req.orbitSize ?? clamp(0.95 - (0.6 * req.octave) / Math.max(1, octaves - 1), 0.25, 0.95)
    const ecc = req.eccentricity ?? clamp(this.state.eccentricity + 0.35 * energy, 0, 0.9)
    const body = this.physics.inject(identity, this.pctx(), this.runner?.simTime ?? 0, {
      orbitSize: size,
      eccentricity: ecc,
      energy: 0.5 + 0.5 * energy,
      speed: this.state.speed * (0.85 + 0.3 * energy),
    })
    if (!body) return null
    this.bodyMeta.set(body.id, meta)
    const t = this.clock.nowSeconds()
    this.spawns.push({ time: t, bodyId: body.id })
    this.bus.emit(continueEvent(meta, INSTRUMENT_ID, 'orbit.bodySpawned', t, { bodyId: body.id, scaleDegree: identity.degree, octave: identity.octave, orbitSize: size, eccentricity: ecc, sourceId: req.sourceId }))
    return body
  }

  clear() {
    this.flow.clear()
    this.queue.clear()
    this.hits = []
    this.spawns = []
    this.bodyMeta.clear()
  }

  // ---------- events out ----------
  private publishPhysicsEvent(e: PhysicsEvent) {
    const meta = this.bodyMeta.get(e.bodyId)
    const type = e.type === 'gateCrossing' ? 'orbit.gateCrossed' : e.type === 'periapsis' ? 'orbit.periapsis' : e.type === 'apoapsis' ? 'orbit.apoapsis' : null
    if (!type) return
    const payload = { bodyId: e.bodyId, radius: e.current.radius, angle: e.current.angle, energy: e.current.energy, gate: e.gate?.action }
    this.bus.emit(meta ? continueEvent(meta, INSTRUMENT_ID, type, e.time, payload) : makeEvent(INSTRUMENT_ID, type, e.time, payload))
  }

  // ---------- scheduling ----------
  private tick() {
    if (!this.ctx || !this.runner || !this.synth) return
    this.runner.tick()
    for (const ev of this.queue.drain(this.ctx.currentTime + 0.15)) {
      this.synth.noteOn(ev.payload, ev.time)
      this.synth.noteOff(ev.payload.id, ev.time + ev.payload.duration)
    }
    const now = this.ctx.currentTime
    this.hits = this.hits.filter((h) => now - h.time < 0.6)
    this.spawns = this.spawns.filter((h) => now - h.time < 0.8)
    for (const id of Array.from(this.bodyMeta.keys())) if (!this.physics.bodies().some((b) => b.id === id && b.alive)) this.bodyMeta.delete(id)
  }

  private step(dt: number, simTime: number) {
    const s = this.state
    const tuning = { scale: getScale(s.scaleId), rootHz: s.rootHz }
    const events: GeneratedEvent[] = this.flow.update(dt, simTime, this.flowCtx())
    const maxQueue = this.host?.limits.maxQueueSize ?? 512
    for (const e of events) {
      if (this.queue.size >= maxQueue) break // drop generated events, never block the loop
      // ORBIT is tempo-synced by default: quantize on the shared clock
      const t = quantizeTime(e.time, s.timing, s.quantize, s.bpm, this.clock.origin)
      // semantic pitch → Hz through the *current* tuning, so tuning changes re-resolve bodies
      const pitch = resolvePitch({ scaleDegree: e.note.degree, octave: e.note.octave }, tuning)
      const id = `o${this.counter++}`
      const body = this.physics.bodies().find((b) => b.id === e.sourceId)
      this.queue.push({
        time: t,
        type: 'noteOn',
        payload: {
          id,
          note: e.note,
          frequencyHz: pitch.frequency,
          cents: pitch.cents,
          rootHz: pitch.rootHz,
          velocity: e.velocity,
          brightness: e.brightness,
          width: e.width,
          generated: true,
          duration: e.duration,
        },
      })
      this.notesGenerated++
      if (body) this.hits.push({ time: t, angle: body.snapshot.angle, radius: body.snapshot.radius, velocity: e.velocity, bodyId: body.id })
      const meta = body ? this.bodyMeta.get(body.id) : undefined
      const payload = { bodyId: e.sourceId, scaleDegree: e.note.degree, octave: e.note.octave, frequency: pitch.frequency, velocity: e.velocity, time: t }
      this.bus.emit(meta ? continueEvent(meta, INSTRUMENT_ID, 'orbit.noteGenerated', t, payload) : makeEvent(INSTRUMENT_ID, 'orbit.noteGenerated', t, payload))
    }
  }

  snapshot() {
    return {
      now: this.ctx?.currentTime ?? 0,
      beat: this.clock.nowBeats(),
      bodies: this.physics.visual() as OrbitBody[],
      gates: this.physics.params.gates,
      hits: this.hits,
      spawns: this.spawns,
      level: this.synth?.level() ?? 0,
      stats: this.flow.stats(this.runner?.simTime ?? 0),
      queueSize: this.queue.size,
      notesGenerated: this.notesGenerated,
    }
  }
}
