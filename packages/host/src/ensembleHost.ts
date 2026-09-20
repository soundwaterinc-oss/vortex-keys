import {
  SourceClock,
  EventBus,
  MusicalEventQueue,
  makeEvent,
  deriveSeed,
  getScale,
  DEFAULT_GLOBAL_STATE,
  type GlobalState,
  type MusicalClock,
  type TuningContext,
} from '@el-systema/core'
import { MasterChain, type InstrumentBus } from '@el-systema/audio'

export interface EnsembleLimits {
  maxQueueSize: number
  maxGeneration: number
}

export const DEFAULT_ENSEMBLE_LIMITS: EnsembleLimits = { maxQueueSize: 512, maxGeneration: 2 }

/**
 * EnsembleHost: the shared runtime.
 *
 *   standalone instrument → creates its own host (one instrument in it)
 *   ENSEMBLE              → creates one host and hands it to every instrument
 *
 * Owns: AudioContext, MasterChain (with per-instrument buses), MusicalClock,
 * EventBus, a shared MusicalEventQueue, the GlobalState (tempo, tuning,
 * root, seed, master gain). Changing a global value publishes an
 * `ensemble.*` event so every hosted instrument follows.
 */
export class EnsembleHost {
  readonly audio: AudioContext
  readonly master: MasterChain
  readonly clock: SourceClock
  readonly bus: EventBus
  readonly queue = new MusicalEventQueue()
  global: GlobalState
  limits: EnsembleLimits
  private listeners = new Set<() => void>()

  constructor(audio: AudioContext, global: Partial<GlobalState> = {}, bus = new EventBus(), limits = DEFAULT_ENSEMBLE_LIMITS) {
    this.audio = audio
    this.global = { ...DEFAULT_GLOBAL_STATE, ...global }
    this.master = new MasterChain(audio, { masterGain: this.global.masterGain })
    this.clock = new SourceClock(() => audio.currentTime, this.global.tempo)
    this.bus = bus
    this.limits = limits
  }

  /** Browser entry point: must be called from a user gesture. */
  static create(global: Partial<GlobalState> = {}, bus?: EventBus): EnsembleHost {
    return new EnsembleHost(new AudioContext({ latencyHint: 'interactive' }), global, bus)
  }

  async resume() {
    if (this.audio.state !== 'running') await this.audio.resume()
  }

  get musicalClock(): MusicalClock {
    return this.clock
  }

  /** The instrument's own gain bus inside the master chain. */
  instrumentBus(name: string): InstrumentBus {
    return this.master.createBus(name)
  }

  /** Shared tuning context resolved from GlobalState. */
  tuning(): TuningContext {
    return { scale: getScale(this.global.tuningId), rootHz: this.global.rootFrequency }
  }

  /** Per-instrument deterministic seed from the global seed. */
  seedFor(instrumentId: string): number {
    return deriveSeed(this.global.seed, instrumentId)
  }

  subscribe(l: () => void) {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  private notify() {
    for (const l of this.listeners) l()
  }

  setTempo(bpm: number) {
    const v = Math.max(20, Math.min(300, Number.isFinite(bpm) ? bpm : this.global.tempo))
    this.global = { ...this.global, tempo: v }
    this.clock.bpm = v
    this.bus.emit(makeEvent('ensemble', 'ensemble.tempoChanged', this.audio.currentTime, { bpm: v }))
    this.notify()
  }

  setTuning(tuningId: string, rootFrequency = this.global.rootFrequency) {
    this.global = { ...this.global, tuningId, rootFrequency }
    this.bus.emit(makeEvent('ensemble', 'ensemble.tuningChanged', this.audio.currentTime, { tuningId, rootFrequency }))
    this.notify()
  }

  setSeed(seed: number) {
    const v = Number.isFinite(seed) ? seed >>> 0 : this.global.seed
    this.global = { ...this.global, seed: v }
    this.bus.emit(makeEvent('ensemble', 'ensemble.seedChanged', this.audio.currentTime, { seed: v }))
    this.notify()
  }

  setMasterGain(g: number) {
    this.global = { ...this.global, masterGain: g }
    this.master.setMasterGain(g)
    this.notify()
  }

  /** Transport reset: beat 0 is now; instruments clear generated state. */
  reset() {
    this.clock.reset()
    this.queue.clear()
    this.bus.emit(makeEvent('ensemble', 'ensemble.reset', this.audio.currentTime, {}))
    this.notify()
  }

  dispose() {
    this.bus.clear()
    void this.audio.close()
  }
}
