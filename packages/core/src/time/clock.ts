/**
 * One clock for the whole family. Instruments read seconds or beats from
 * it; whether they quantize to the beat is their own decision (see
 * quantize.ts). The audio implementation wraps an AudioContext so scheduled
 * events land on the audio clock, not on animation frames.
 */
export interface MusicalClock {
  bpm: number
  nowSeconds(): number
  nowBeats(): number
  /** audio time of beat 0 */
  readonly origin: number
}

export const beatsToSeconds = (beats: number, bpm: number) => (beats * 60) / bpm
export const secondsToBeats = (seconds: number, bpm: number) => (seconds * bpm) / 60

/** Clock driven by any monotonic seconds source (AudioContext.currentTime, performance.now()/1000, a test counter). */
export class SourceClock implements MusicalClock {
  origin: number
  constructor(private source: () => number, public bpm = 120) {
    this.origin = source()
  }
  nowSeconds() {
    return this.source()
  }
  nowBeats() {
    return secondsToBeats(this.nowSeconds() - this.origin, this.bpm)
  }
  /** Restart beat counting at the current time (transport reset). */
  reset() {
    this.origin = this.source()
  }
}

/** Test/offline clock advanced by hand. */
export class ManualClock implements MusicalClock {
  private t = 0
  origin = 0
  constructor(public bpm = 120) {}
  nowSeconds() {
    return this.t
  }
  nowBeats() {
    return secondsToBeats(this.t - this.origin, this.bpm)
  }
  advance(dt: number) {
    this.t += dt
  }
}
