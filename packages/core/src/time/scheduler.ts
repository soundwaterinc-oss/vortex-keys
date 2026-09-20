import type { MusicalClock } from './clock'

/** A musical event with an absolute clock time. */
export interface ScheduledMusicalEvent<T = unknown> {
  time: number
  type: string
  payload: T
}

/**
 * Deterministic priority queue: events come out ordered by time, ties by
 * insertion order. Instruments push future events here and drain what is
 * due up to a horizon; the same pushes always produce the same order.
 */
export class MusicalEventQueue<T = unknown> {
  private items: { seq: number; ev: ScheduledMusicalEvent<T> }[] = []
  private seq = 0
  get size() {
    return this.items.length
  }
  push(ev: ScheduledMusicalEvent<T>) {
    const item = { seq: this.seq++, ev }
    // binary insert keeps drain O(1) and ordering stable
    let lo = 0
    let hi = this.items.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      const m = this.items[mid]
      if (m.ev.time < ev.time || (m.ev.time === ev.time && m.seq < item.seq)) lo = mid + 1
      else hi = mid
    }
    this.items.splice(lo, 0, item)
  }
  /** Remove and return all events with time <= horizon, in order. */
  drain(horizon: number): ScheduledMusicalEvent<T>[] {
    let n = 0
    while (n < this.items.length && this.items[n].ev.time <= horizon) n++
    return this.items.splice(0, n).map((i) => i.ev)
  }
  clear() {
    this.items = []
  }
}

export interface FixedStepOptions {
  /** simulation step in seconds */
  dt: number
  /** how far ahead of the clock the simulation runs */
  lookahead: number
  /** if the simulation falls further behind than this, skip instead of bursting */
  maxCatchUp: number
}

export const DEFAULT_FIXED_STEP: FixedStepOptions = { dt: 1 / 120, lookahead: 0.12, maxCatchUp: 1 }

/**
 * Runs a fixed-step simulation ahead of a clock. Call `tick()` from any
 * timer (setInterval, worklet message, test loop): it advances `step` in
 * exact dt increments until simTime >= now + lookahead. Frame rate never
 * enters the equation, so the musical result of a given state is
 * reproducible.
 */
export class FixedStepRunner {
  simTime: number
  constructor(
    private clock: MusicalClock,
    private step: (dt: number, simTime: number) => void,
    public options: FixedStepOptions = DEFAULT_FIXED_STEP,
  ) {
    this.simTime = clock.nowSeconds()
  }
  tick(): number {
    const { dt, lookahead, maxCatchUp } = this.options
    const target = this.clock.nowSeconds() + lookahead
    if (target - this.simTime > maxCatchUp) this.simTime = target - lookahead
    let steps = 0
    while (this.simTime < target && steps < 400) {
      this.step(dt, this.simTime)
      this.simTime += dt
      steps++
    }
    return steps
  }
  resync() {
    this.simTime = Math.max(this.simTime, this.clock.nowSeconds() - 0.25)
  }
}
