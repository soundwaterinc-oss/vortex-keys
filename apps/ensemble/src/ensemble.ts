import { EventBus, type SystemEvent } from '@el-systema/core'
import { EnsembleHost } from '@el-systema/host'
import { Instrument as VortexInstrument } from '@el-systema/vortex-keys'
import { OrbitEngine } from '@el-systema/orbit'
import { Router, type RoutingState } from './routing'
import { defaultGates } from '@el-systema/physics'

export interface MixState {
  vortexLevel: number
  vortexMute: boolean
  orbitLevel: number
  orbitMute: boolean
  master: number
}

export interface EnsembleUiState {
  started: boolean
  playing: boolean
  routing: RoutingState
  mix: MixState
  diagnostics: boolean
  advanced: boolean
  /** ring buffer of recent bus events for the diagnostics view */
  log: { t: number; type: string; gen: number }[]
}

/**
 * The ENSEMBLE: one host, two instruments, one router. The instruments are
 * the very same classes the standalone apps run; here they simply receive
 * the host instead of creating one.
 */
export class Ensemble {
  readonly bus = new EventBus()
  host: EnsembleHost | null = null
  readonly vortex = new VortexInstrument(this.bus)
  readonly orbit = new OrbitEngine(this.bus)
  router: Router | null = null
  ui: EnsembleUiState = {
    started: false,
    playing: false,
    routing: { vortexToOrbit: true, spawnAmount: 1, pitchFollow: true, velocityToEnergy: 0.7 },
    mix: { vortexLevel: 0.9, vortexMute: false, orbitLevel: 0.8, orbitMute: false, master: 0.7 },
    diagnostics: false,
    advanced: false,
    log: [],
  }
  private listeners = new Set<() => void>()
  /** transfer pulses: a VORTEX note travelling to ORBIT (for the causality visual) */
  transfers: { t: number; degree: number; octave: number }[] = []

  constructor() {
    // curated ENSEMBLE defaults: VORTEX free timing + gentle vortex, ORBIT hard 1/16
    this.vortex.setState((s) => ({
      flow: { ...s.flow, amount: 0.3, gates: defaultGates(3, ['repeat', 'degreeUp', 'repeat']), vortex: { ...s.flow.vortex, spin: 0.18 } },
      time: { ...s.time, mode: 'free' },
    }))
    this.orbit.setState({ timing: 'hard', quantize: '1/16', maxBodies: 12 })
    this.bus.onAny((e) => this.onBusEvent(e))
  }

  subscribe(l: () => void) {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  private notify() {
    for (const l of this.listeners) l()
  }
  setUi(patch: Partial<EnsembleUiState>) {
    this.ui = { ...this.ui, ...patch }
    this.notify()
  }

  /** User gesture entry: one AudioContext for everything. */
  async start() {
    if (!this.host) {
      const v = this.vortex.getState()
      this.host = new EnsembleHost(new AudioContext({ latencyHint: 'interactive' }), { tempo: 112, tuningId: v.tuning.scaleId, rootFrequency: v.tuning.rootHz, seed: v.flow.seed, masterGain: this.ui.mix.master }, this.bus)
      this.router = new Router(this.bus, this.host.global.seed, () => this.host!.audio.currentTime, this.host.limits.maxGeneration)
      this.router.state = this.ui.routing
      this.router.attach()
      await this.vortex.start(this.host)
      await this.orbit.start(this.host)
      this.applyMix()
      this.bus.on('ensemble.seedChanged', (e) => this.router?.reseed((e.payload as { seed: number }).seed))
    }
    await this.host.resume()
    this.setUi({ started: true, playing: true })
  }

  /** PLAY/PAUSE: suspends the shared AudioContext (both instruments stop together). */
  async togglePlay() {
    if (!this.host) return this.start()
    if (this.host.audio.state === 'running') {
      await this.host.audio.suspend()
      this.setUi({ playing: false })
    } else {
      await this.host.audio.resume()
      this.setUi({ playing: true })
    }
  }

  reset() {
    this.host?.reset()
    this.transfers = []
    this.setUi({ log: [] })
  }

  setRouting(patch: Partial<RoutingState>) {
    const routing = { ...this.ui.routing, ...patch }
    if (this.router) this.router.state = routing
    this.setUi({ routing })
  }

  setMix(patch: Partial<MixState>) {
    this.setUi({ mix: { ...this.ui.mix, ...patch } })
    this.applyMix()
  }
  private applyMix() {
    if (!this.host) return
    const m = this.ui.mix
    const vb = this.host.instrumentBus('vortex-keys')
    vb.setLevel(m.vortexLevel)
    vb.setMuted(m.vortexMute)
    const ob = this.host.instrumentBus('orbit')
    ob.setLevel(m.orbitLevel)
    ob.setMuted(m.orbitMute)
    this.host.setMasterGain(m.master)
  }

  private onBusEvent(e: SystemEvent) {
    if (e.type === 'ensemble.orbitSpawnRequested') {
      const p = e.payload as { scaleDegree: number; octave: number }
      this.transfers.push({ t: e.timestamp, degree: p.scaleDegree, octave: p.octave })
      if (this.transfers.length > 16) this.transfers.shift()
    }
    if (this.ui.diagnostics) {
      const log = [...this.ui.log, { t: e.timestamp, type: e.type, gen: e.meta.generation }].slice(-12)
      this.ui = { ...this.ui, log }
      this.notify()
    }
  }

  diagnostics() {
    const h = this.host
    const vs = this.vortex.snapshot()
    const os = this.orbit.snapshot()
    return {
      audioState: h?.audio.state ?? 'none',
      contexts: h ? 1 : 0,
      voices: vs.voices + (this.orbit.synth?.voiceCount ?? 0),
      vortexParticles: vs.bodies.filter((b) => b.alive).length,
      orbitBodies: os.bodies.length,
      physicsPerSec: (vs.stats?.physicsEventsPerSecond ?? 0) + os.stats.physicsEventsPerSecond,
      notesPerSec: (vs.stats?.notesPerSecond ?? 0) + os.stats.notesPerSecond,
      queue: os.queueSize,
      seed: h?.global.seed ?? this.vortex.getState().flow.seed,
      bpm: h?.global.tempo ?? 0,
      routed: this.router?.routed ?? 0,
      droppedByGeneration: this.router?.dropped ?? 0,
      tuning: h?.global.tuningId ?? '',
      level: h?.master.level() ?? 0,
    }
  }
}
