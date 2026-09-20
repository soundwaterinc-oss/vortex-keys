import type { FlowContext, FlowModel, GeneratedEvent, SeedNote } from './types'
import { clamp, TAU } from '../math/util'
import { wrapDegree } from '../tuning/tuning'

export interface WaveComponent {
  /** frequency ratio relative to base (1 = base rate) */
  ratio: number
  amplitude: number
  /** phase in turns (0..1) */
  phase: number
}

export type TriggerDirection = 'rising' | 'falling' | 'both'

export interface WaveParams {
  /** base rate in cycles per beat */
  baseRate: number
  components: WaveComponent[]
  threshold: number
  direction: TriggerDirection
  maxEventsPerSecond: number
  /** how many seed notes are kept in the pitch pool */
  poolSize: number
}

export const WAVE_RATIO_PRESETS: { name: string; ratios: number[] }[] = [
  { name: '1 : 2', ratios: [1, 2] },
  { name: '2 : 3', ratios: [2, 3] },
  { name: '3 : 4 : 5', ratios: [3, 4, 5] },
  { name: '1 : √2', ratios: [1, Math.SQRT2] },
  { name: '1 : φ', ratios: [1, (1 + Math.sqrt(5)) / 2] },
  { name: '1 : φ : φ²', ratios: [1, (1 + Math.sqrt(5)) / 2, ((1 + Math.sqrt(5)) / 2) ** 2] },
  { name: '4 : 5 : 6 : 7', ratios: [4, 5, 6, 7] },
]

export function componentsFromRatios(ratios: number[]): WaveComponent[] {
  return ratios.map((r, i) => ({ ratio: r, amplitude: 1 / (i + 1), phase: 0 }))
}

export const DEFAULT_WAVE_PARAMS: WaveParams = {
  baseRate: 0.25,
  components: componentsFromRatios([3, 4, 5]),
  threshold: 0.5,
  direction: 'rising',
  maxEventsPerSecond: 16,
  poolSize: 8,
}

/** A(t) = Σ a_i sin(2π f_i t + φ_i), normalised so |A| ≤ 1. */
export function waveSum(components: WaveComponent[], baseHz: number, t: number): number {
  let sum = 0
  let norm = 0
  for (const c of components) {
    sum += c.amplitude * Math.sin(TAU * (c.ratio * baseHz * t + c.phase))
    norm += Math.abs(c.amplitude)
  }
  return norm > 0 ? sum / norm : 0
}

/** Threshold crossing between two consecutive samples. */
export function crossedThreshold(prev: number, curr: number, threshold: number, dir: TriggerDirection): boolean {
  const rising = prev < threshold && curr >= threshold
  const falling = prev > threshold && curr <= threshold
  if (dir === 'rising') return rising
  if (dir === 'falling') return falling
  return rising || falling
}

/**
 * Wave interference model. Irrational ratios (√2, φ) never realign, which is
 * used here as an artistic mapping to non-repeating rhythm, not as a
 * physical claim. Events are emitted only on threshold *crossings*, so a
 * sustained value above threshold does not retrigger.
 *
 * Pitch: the performer's recent notes form a pool; each crossing takes the
 * next pool note (rising) or the previous one transposed down a degree
 * (falling), so the rhythm of the wave is heard on the material the player
 * chose. Slope -> brightness, |A| at crossing region -> velocity.
 */
export class WaveModel implements FlowModel<WaveParams> {
  readonly id = 'wave'
  params: WaveParams
  pool: SeedNote[] = []
  private frozen = false
  private prev = 0
  private prevSlope = 0
  private crossings = 0
  private eventWindow: number[] = []
  /** local time so freezing pauses the wave */
  private t = 0
  lastValue = 0

  constructor(params: WaveParams) {
    this.params = params
  }
  setFrozen(f: boolean) {
    this.frozen = f
  }
  clear() {
    this.pool = []
    this.crossings = 0
  }
  inject(note: SeedNote, ctx: FlowContext) {
    if (ctx.amount <= 0) return
    this.pool.push(note)
    while (this.pool.length > this.params.poolSize) this.pool.shift()
  }
  get time() {
    return this.t
  }

  update(dt: number, now: number, ctx: FlowContext): GeneratedEvent[] {
    const events: GeneratedEvent[] = []
    if (this.frozen) return events
    const p = this.params
    const baseHz = p.baseRate / ctx.beatSeconds
    this.t += dt
    const curr = waveSum(p.components, baseHz, this.t)
    const slope = (curr - this.prev) / Math.max(dt, 1e-6)
    this.lastValue = curr

    const windowStart = now - 1
    while (this.eventWindow.length && this.eventWindow[0] < windowStart) this.eventWindow.shift()

    // threshold is symmetric: a crossing of +thr (as configured) and of -thr
    // mirrored, so the wave triggers both on crests and troughs when 'both'.
    const hitPos = crossedThreshold(this.prev, curr, p.threshold, p.direction)
    const hitNeg = p.direction === 'both' && crossedThreshold(-this.prev, -curr, p.threshold, 'rising')
    if ((hitPos || hitNeg) && this.pool.length > 0 && this.eventWindow.length < p.maxEventsPerSecond) {
      const rising = curr > this.prev
      const idx = this.crossings % this.pool.length
      const seed = this.pool[idx]
      const note = rising
        ? { degree: seed.degree, octave: seed.octave }
        : wrapDegree(seed.degree - 1, seed.octave, ctx.scaleLength)
      this.crossings++
      this.eventWindow.push(now)
      // slope magnitude relative to the fastest possible slope (2π f_max)
      const maxSlope = TAU * baseHz * Math.max(...p.components.map((c) => c.ratio))
      const brightness = clamp(Math.abs(slope) / Math.max(maxSlope, 1e-6), 0, 1)
      const vel = clamp(seed.velocity * (0.4 + 0.6 * Math.abs(curr)) * (0.4 + 0.6 * ctx.amount), 0.02, 1)
      events.push({
        time: now,
        note,
        velocity: vel,
        duration: clamp(ctx.beatSeconds * 0.6, 0.08, 2),
        brightness,
        sourceId: `w${idx}`,
      })
    }
    this.prev = curr
    this.prevSlope = slope
    void this.prevSlope
    return events
  }
}
