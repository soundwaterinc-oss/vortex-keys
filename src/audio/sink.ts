import type { ScaleNote } from '../core/tuning/types'

/**
 * A fully-resolved note ready to be sounded by *some* output. Frequency and
 * cents are both carried so that:
 *  - the WebAudio synth uses `frequencyHz`
 *  - a future MIDI/MPE sink can derive note number + pitch bend from `cents`
 *  - an OSC sink can send the whole record as-is.
 */
export interface PitchedNote {
  id: string
  note: ScaleNote
  frequencyHz: number
  /** cents above the root frequency */
  cents: number
  rootHz: number
  velocity: number
  /** 0..1 timbral hint (particle energy, wave slope) */
  brightness?: number
  /** true when produced by the FlowEngine rather than the performer */
  generated?: boolean
}

/**
 * Anything that can sound notes. `time` is in AudioContext seconds; sinks
 * that do not have an audio clock (MIDI, OSC) map it to their own timeline.
 */
export interface NoteSink {
  noteOn(note: PitchedNote, time: number): void
  noteOff(id: string, time: number): void
  allNotesOff(time?: number): void
}

/** Fan-out to multiple sinks (synth + MIDI + OSC). */
export class MultiSink implements NoteSink {
  constructor(public sinks: NoteSink[]) {}
  noteOn(n: PitchedNote, t: number) {
    for (const s of this.sinks) s.noteOn(n, t)
  }
  noteOff(id: string, t: number) {
    for (const s of this.sinks) s.noteOff(id, t)
  }
  allNotesOff(t?: number) {
    for (const s of this.sinks) s.allNotesOff(t)
  }
}
