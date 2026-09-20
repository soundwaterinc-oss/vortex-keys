import type { PhysicsBody, PhysicsContext, PhysicsEvent, PhysicsModel, MusicalIdentity, PhysicsSnapshot } from './types'
import { emptySnapshot, timeScale } from './types'
import { crossedAngle, clamp, TAU, wrapAngle } from '../math/util'
import { polarToXY } from './frame'

export interface CoupledParams {
  count: number
  /** coupling strength K */
  coupling: number
  /** intrinsic frequency spread (fraction of base) */
  spread: number
  /** initial phase spread in turns (0 = all aligned, 1 = uniform) */
  phaseSpread: number
  /** seeded random walk of intrinsic frequencies per second */
  drift: number
  /** R above which a 'sync' event fires (and below which it fires again) */
  syncThreshold: number
  /** base intrinsic rate, revolutions per beat */
  baseRate: number
  maxCount: number
}

export const DEFAULT_COUPLED_PARAMS: CoupledParams = {
  count: 8,
  coupling: 0.6,
  spread: 0.25,
  phaseSpread: 1,
  drift: 0.05,
  syncThreshold: 0.8,
  baseRate: 0.25,
  maxCount: 16,
}

interface Osc extends PhysicsBody {
  theta: number
  omega: number
  omegaBase: number
  /** slot index (stable, used for placement) */
  index: number
}

/** Kuramoto order parameter R·e^{iψ} = (1/N) Σ e^{iθ_j}. */
export function orderParameter(thetas: number[]): { R: number; psi: number } {
  if (thetas.length === 0) return { R: 0, psi: 0 }
  let re = 0
  let im = 0
  for (const t of thetas) {
    re += Math.cos(t)
    im += Math.sin(t)
  }
  re /= thetas.length
  im /= thetas.length
  return { R: Math.hypot(re, im), psi: Math.atan2(im, re) }
}

/**
 * Kuramoto-style coupled phases:
 *   dθ_i/dt = ω_i + (K/N) Σ_j sin(θ_j − θ_i)
 * O(N²) per step; N ≤ 16 so this is negligible. Events: phaseCrossing when
 * θ_i wraps 0, sync when R crosses syncThreshold. Bodies keep a musical
 * identity taken from performed notes (pool rotation); until anything is
 * played, oscillator i sounds degree i.
 * Macros: CHAOS lowers K and widens spread, ENERGY raises the base rate,
 * TIME scales everything, SPACE only affects width via the mapper.
 */
export class CoupledModel implements PhysicsModel<CoupledParams> {
  readonly id = 'coupled'
  params: CoupledParams
  private oscs: Osc[] = []
  private frozen = false
  private R = 0
  private psi = 0
  private prevR = 0
  private pool: MusicalIdentity[] = []
  private poolCursor = 0
  private initialised = false

  constructor(params: CoupledParams) {
    this.params = params
  }
  setFrozen(f: boolean) {
    this.frozen = f
  }
  clear() {
    this.pool = []
    this.oscs = []
    this.initialised = false
  }
  bodies(): PhysicsBody[] {
    return this.oscs
  }
  globals() {
    return { R: this.R, psi: this.psi, N: this.oscs.length }
  }
  visual() {
    return { oscs: this.oscs, R: this.R, psi: this.psi, threshold: this.params.syncThreshold }
  }

  reset(ctx: PhysicsContext) {
    this.initialised = false
    this.ensure(ctx, 0)
  }

  private ensure(ctx: PhysicsContext, now: number) {
    const p = this.params
    const N = clamp(Math.round(p.count), 1, p.maxCount)
    if (this.initialised && this.oscs.length === N) return
    const prev = this.oscs
    this.oscs = []
    for (let i = 0; i < N; i++) {
      const keep = prev[i]
      const theta = keep ? keep.theta : wrapAngle(ctx.prng.next() * TAU * p.phaseSpread)
      const spreadFactor = 1 + (ctx.prng.next() * 2 - 1) * p.spread
      const identity = keep?.identity ?? this.identityFor(i, ctx)
      const snap: PhysicsSnapshot = { ...emptySnapshot(), radius: 0.62, angle: theta, phase: theta / TAU }
      this.oscs.push({
        id: `k${i}`,
        index: i,
        identity,
        snapshot: snap,
        prev: { ...snap },
        alive: true,
        generation: 0,
        born: now,
        theta,
        omega: spreadFactor,
        omegaBase: spreadFactor,
      })
    }
    this.initialised = true
  }

  private identityFor(i: number, ctx: PhysicsContext): MusicalIdentity {
    if (this.pool.length) return { ...this.pool[i % this.pool.length] }
    return { degree: i % ctx.scaleLength, octave: 1 + Math.floor(i / ctx.scaleLength) % 2, velocity: 0.7 }
  }

  /** A performed note assigns its identity to the next oscillator and kicks its phase to 0. */
  inject(identity: MusicalIdentity, ctx: PhysicsContext, now: number) {
    if (ctx.amount <= 0) return
    this.ensure(ctx, now)
    this.pool.push({ ...identity })
    while (this.pool.length > this.oscs.length) this.pool.shift()
    const o = this.oscs[this.poolCursor % this.oscs.length]
    this.poolCursor++
    o.identity = { ...identity }
    o.theta = 0
  }

  step(dt: number, now: number, ctx: PhysicsContext): PhysicsEvent[] {
    const events: PhysicsEvent[] = []
    this.ensure(ctx, now)
    if (this.frozen) return events
    const p = this.params
    const m = ctx.macros
    const N = this.oscs.length
    const K = clamp(p.coupling * (1.3 - 1.2 * m.chaos), 0, 4)
    const base = (TAU * p.baseRate * timeScale(m) * (0.6 + 0.8 * m.energy)) / ctx.beatSeconds
    const spreadBoost = 1 + m.chaos

    const thetas = this.oscs.map((o) => o.theta)
    for (let i = 0; i < N; i++) {
      const o = this.oscs[i]
      let coupling = 0
      for (let j = 0; j < N; j++) if (j !== i) coupling += Math.sin(thetas[j] - thetas[i])
      coupling *= K / N
      if (p.drift > 0) o.omegaBase = clamp(o.omegaBase + ctx.prng.signed() * p.drift * dt, 1 - p.spread * 2, 1 + p.spread * 2)
      const omegaI = base * (1 + (o.omegaBase - 1) * spreadBoost)
      const dTheta = (omegaI + coupling * base) * dt
      const s = o.snapshot
      o.prev = { ...s }
      const prevTheta = o.theta
      o.theta = wrapAngle(o.theta + dTheta)
      s.angle = o.theta
      s.phase = o.theta / TAU
      s.angularVelocity = dTheta / dt
      s.speed = Math.abs(s.angularVelocity) * s.radius
      s.acceleration = Math.abs(s.angularVelocity - o.prev.angularVelocity) / dt
      s.position = polarToXY(s.radius, s.angle)
      s.energy = 1
      s.value = this.R
      if (crossedAngle(prevTheta, o.theta, 0) && dTheta > 0) {
        events.push({ type: 'phaseCrossing', time: now, bodyId: o.id, prev: o.prev, current: { ...s }, direction: 1 })
      }
    }
    const { R, psi } = orderParameter(this.oscs.map((o) => o.theta))
    this.prevR = this.R
    this.R = R
    this.psi = psi
    if (this.prevR < p.syncThreshold && R >= p.syncThreshold) {
      const o = this.oscs[0]
      events.push({ type: 'sync', time: now, bodyId: o.id, prev: o.prev, current: { ...o.snapshot }, direction: 1, value: R })
    } else if (this.prevR > p.syncThreshold && R <= p.syncThreshold) {
      const o = this.oscs[0]
      events.push({ type: 'sync', time: now, bodyId: o.id, prev: o.prev, current: { ...o.snapshot }, direction: -1, value: R })
    }
    return events
  }
}
