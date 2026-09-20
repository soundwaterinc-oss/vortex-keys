import type { EventBus } from '../communication/eventBus'
import type { MusicalClock } from '../time/clock'
import type { GlobalState } from '../state/types'

/** A musical event another instrument (or a bridge) can hand to an instrument. */
export interface MusicalEvent<T = unknown> {
  type: 'noteOn' | 'noteOff' | 'impulse' | 'control' | (string & {})
  time: number
  payload: T
}

/** What the ensemble host hands each instrument. */
export interface InstrumentHost {
  clock: MusicalClock
  bus: EventBus
  global: GlobalState
  audio: AudioContext
}

/**
 * The family contract. Deliberately small: an instrument owns its state,
 * accepts musical events, and can be serialised. A future ENSEMBLE app
 * hosts several of these on one clock, one bus and one tuning.
 */
export interface InstrumentDefinition<S = unknown> {
  id: string
  name: string
  role: 'melody' | 'rhythm' | 'harmony' | 'structure'
  createState(): S
  attach(host: InstrumentHost): void
  detach(): void
  handleMusicalEvent(event: MusicalEvent): void
  serializeState(): S
  loadState(data: unknown): void
}
