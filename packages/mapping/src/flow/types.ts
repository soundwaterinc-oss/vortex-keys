import type { ScaleNote } from '@el-systema/core'
import type { Prng } from '@el-systema/core'

/** A note the performer has sent into the generative system. */
export interface SeedNote extends ScaleNote {
  velocity: number
  /** simulation time when it was sent */
  time: number
}

/**
 * Event emitted by a FlowModel. `time` is in simulation seconds (the same
 * clock the model was stepped with); the scheduler converts to audio time
 * and applies quantization. `brightness` is an optional timbral hint in
 * [0,1] (wave slope, particle energy...).
 */
export interface GeneratedEvent {
  time: number
  note: ScaleNote
  velocity: number
  /** seconds; the scheduler issues noteOff after this */
  duration: number
  brightness?: number
  /** 0..1 stereo width hint */
  width?: number
  /** origin id (particle id, wave component) for visual linking */
  sourceId?: string
}

export interface FlowContext {
  scaleLength: number
  /** current beat duration in seconds (60 / bpm) */
  beatSeconds: number
  /** 0..1 generative amount */
  amount: number
  prng: Prng
}

export interface FlowModel<P = unknown> {
  readonly id: string
  params: P
  /** Advance the model by dt seconds (fixed step) and return events. */
  update(dt: number, now: number, ctx: FlowContext): GeneratedEvent[]
  /** A performed note enters the system. */
  inject(note: SeedNote, ctx: FlowContext): void
  /** Stop time without clearing state. */
  setFrozen(frozen: boolean): void
  /** Drop all generated state. */
  clear(): void
}
