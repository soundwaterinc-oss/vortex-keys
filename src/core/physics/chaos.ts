import type { PhysicsBody, PhysicsContext, PhysicsEvent, PhysicsModel, MusicalIdentity, PhysicsSnapshot } from './types'
import { emptySnapshot, timeScale } from './types'
import { clamp, TAU } from '../math/util'
import { polarToXY } from './frame'

export interface ChaosParams {
  /** logistic growth rate r ∈ [2.5, 4] */
  r: number
  /** initial x ∈ (0,1) */
  x0: number
  /** iterations per beat */
  updateRate: number
  /** 0 = follow x instantly, 1 = very slow */
  smoothing: number
  /** scales Δx before mapping (and the extrema detection floor) */
  sensitivity: number
  threshold: number
  historyLength: number
}

export const DEFAULT_CHAOS_PARAMS: ChaosParams = {
  r: 3.7,
  x0: 0.31,
  updateRate: 2,
  smoothing: 0.5,
  sensitivity: 1,
  threshold: 0.5,
  historyLength: 256,
}

/** One logistic iteration, kept strictly inside (0,1). */
export function logisticStep(x: number, r: number): number {
  const rr = clamp(r, 0, 4)
  const y = rr * x * (1 - x)
  return clamp(Number.isFinite(y) ? y : 0.5, 1e-6, 1 - 1e-6)
}

/**
 * Logistic map x[n+1] = r·x[n]·(1 − x[n]) iterated at updateRate per beat.
 * The raw sequence is *not* the note stream: a smoothed value xs follows x
 * (xs += (x − xs)·(1 − smoothing) per iteration), and events are extracted
 * from xs: thresholdCrossing (either direction) and extrema (local max/min
 * of xs, fired only when the accumulated travel of xs since the last
 * extrema event exceeds 0.15/sensitivity, so density is graded). Deterministic by
 * construction: seed → x0 offset, no randomness inside the map.
 * Macros: CHAOS pushes r from ~3.2 (stable cycle) toward 4 (full chaos),
 * ENERGY/TIME scale the iteration rate.
 */
export class ChaosModel implements PhysicsModel<ChaosParams> {
  readonly id = 'chaos'
  params: ChaosParams
  private x: number
  private xs: number
  private travel = 0
  private prevDelta = 0
  private acc = 0
  private histTick = 0
  private frozen = false
  private body: PhysicsBody
  private pool: MusicalIdentity[] = []
  private cursor = 0
  history: Float32Array
  historyHead = 0
  /** raw (x[n], x[n+1]) pairs for the return-map visual */
  private lastRaw: number[] = []
  private seeded = false

  constructor(params: ChaosParams) {
    this.params = params
    this.x = params.x0
    this.xs = params.x0
    this.history = new Float32Array(params.historyLength).fill(params.x0)
    const snap: PhysicsSnapshot = { ...emptySnapshot(), radius: params.x0, value: params.x0, slope: 0 }
    this.body = { id: 'x', identity: { degree: 0, octave: 1, velocity: 0.7 }, snapshot: snap, prev: { ...snap }, alive: true, generation: 0, born: 0 }
  }
  setFrozen(f: boolean) {
    this.frozen = f
  }
  clear() {
    this.pool = []
    this.cursor = 0
  }
  reset() {
    this.x = this.params.x0
    this.xs = this.params.x0
    this.seeded = true
  }
  bodies(): PhysicsBody[] {
    return [this.body]
  }
  globals() {
    return { x: this.x, xs: this.xs, r: this.effectiveR }
  }
  private effectiveR = 3.7
  visual() {
    return { history: this.history, head: this.historyHead, raw: this.lastRaw, r: this.effectiveR, threshold: this.params.threshold, x: this.x, xs: this.xs }
  }

  inject(identity: MusicalIdentity, ctx: PhysicsContext) {
    if (ctx.amount <= 0) return
    this.pool.push({ ...identity })
    while (this.pool.length > 8) this.pool.shift()
    this.body.identity = { ...identity }
  }

  private rotateIdentity() {
    if (!this.pool.length) return
    this.cursor = (this.cursor + 1) % this.pool.length
    this.body.identity = { ...this.pool[this.cursor] }
  }

  step(dt: number, now: number, ctx: PhysicsContext): PhysicsEvent[] {
    const events: PhysicsEvent[] = []
    if (this.frozen) return events
    const p = this.params
    const m = ctx.macros
    if (!this.seeded) {
      // seed-dependent but deterministic initial condition
      this.x = clamp(p.x0 + (ctx.prng.next() - 0.5) * 0.02, 0.01, 0.99)
      this.xs = this.x
      this.seeded = true
    }
    // ORDER↔CHAOS macro moves r between a stable region and full chaos
    this.effectiveR = clamp(p.r + (m.chaos - 0.5) * 0.8, 2.5, 4)
    const rate = (p.updateRate * timeScale(m) * (0.5 + m.energy)) / ctx.beatSeconds
    this.acc += rate * dt
    const s = this.body.snapshot
    this.body.prev = { ...s }
    const before = this.xs
    while (this.acc >= 1) {
      this.acc -= 1
      const nx = logisticStep(this.x, this.effectiveR)
      this.lastRaw.push(this.x, nx)
      if (this.lastRaw.length > 400) this.lastRaw.splice(0, 2)
      this.x = nx
      this.xs += (this.x - this.xs) * (1 - clamp(p.smoothing, 0, 0.97))
    }
    // history is sampled at 30 Hz (every 4th sim step) so the trace shows ~8 s
    if (++this.histTick % 4 === 0) {
      this.history[this.historyHead] = this.xs
      this.historyHead = (this.historyHead + 1) % this.history.length
    }
    // rates are expressed per iteration × iteration rate (units/s of the
    // smoothed signal) rather than per sim step, so they sit in the same
    // magnitude range the mapper normalises for the other models
    const delta = (this.xs - before) * rate
    s.value = this.xs
    s.slope = delta * p.sensitivity
    s.radius = clamp(this.xs, 0, 1)
    s.angle = this.xs * TAU - Math.PI / 2
    s.position = polarToXY(s.radius, s.angle)
    s.angularVelocity = delta * TAU * p.sensitivity
    s.radialVelocity = delta
    s.energy = clamp(Math.abs(this.xs - 0.5) * 2, 0, 1)
    s.speed = Math.abs(delta)
    s.acceleration = Math.abs(delta - (this.body.prev.slope ?? 0)) * rate
    s.normalizedAge = 0
    const base = { time: now, bodyId: this.body.id, prev: this.body.prev, current: { ...s } }
    if (before < p.threshold && this.xs >= p.threshold) {
      events.push({ ...base, type: 'thresholdCrossing', direction: 1, value: this.xs })
    } else if (before > p.threshold && this.xs <= p.threshold) {
      events.push({ ...base, type: 'thresholdCrossing', direction: -1, value: this.xs })
    }
    // extrema fire only once the signal has travelled far enough since the
    // last event: small chaotic jitter accumulates into occasional notes,
    // large excursions fire immediately. SENSITIVITY sets the distance.
    this.travel += Math.abs(this.xs - before)
    const floor = 0.15 / clamp(p.sensitivity, 0.1, 4)
    if (this.prevDelta > 0 && delta <= 0 && this.travel > floor) {
      events.push({ ...base, type: 'extrema', kind: 'max', value: this.xs })
      this.travel = 0
    } else if (this.prevDelta < 0 && delta >= 0 && this.travel > floor) {
      events.push({ ...base, type: 'extrema', kind: 'min', value: this.xs })
      this.travel = 0
    }
    if (delta !== 0) this.prevDelta = delta
    if (events.length) this.rotateIdentity()
    return events
  }
}
