import type { PhysicsBody, PhysicsContext, PhysicsEvent, PhysicsModel, MusicalIdentity, PhysicsSnapshot } from './types'
import { deriveKinematics, emptySnapshot, timeScale } from './types'
import type { Gate } from './gates'
import { crossedAngle, clamp, TAU, wrapAngle } from '@el-systema/core'
import { degreeAngle, polarToXY } from './frame'

export interface OrbitState {
  semiMajorAxis: number
  eccentricity: number
  /** argument of periapsis (radians) */
  orientation: number
  /** mean anomaly (radians) */
  phase: number
  /** mean motion in revolutions per beat */
  orbitalSpeed: number
}

export interface OrbitParams {
  /** apoapsis radius in spawn-ring units */
  orbitSize: number
  eccentricity: number
  /** precession of the orientation, revolutions per beat */
  precession: number
  /** mean motion, revolutions per beat */
  speed: number
  /** slow seeded drift of a and e */
  drift: number
  /** energy multiplier per second */
  energy: number
  maxOrbiters: number
  maxAge: number
  minEnergy: number
  quadrantEvents: boolean
  gates: Gate[]
}

export const DEFAULT_ORBIT_PARAMS: OrbitParams = {
  orbitSize: 0.85,
  eccentricity: 0.6,
  precession: 0.01,
  speed: 0.2,
  drift: 0.1,
  energy: 0.93,
  maxOrbiters: 24,
  maxAge: 60,
  minEnergy: 0.05,
  quadrantEvents: false,
  gates: [],
}

export interface OrbitBody extends PhysicsBody {
  orbit: OrbitState
  vel?: { x: number; y: number }
  driftPhase: number
}

/**
 * Solve Kepler's equation M = E − e·sin E for E (Newton, 6 iterations),
 * then true anomaly ν and radius r = a(1 − e cos E). This is the textbook
 * two-body kinematic solution; no forces are integrated, so orbits are
 * exactly stable unless drift/precession is applied. Musically what
 * matters: speed near periapsis, slowness near apoapsis (Kepler's 2nd law).
 */
export function keplerPosition(a: number, e: number, M: number): { r: number; nu: number } {
  const ec = clamp(e, 0, 0.95)
  let E = M
  for (let i = 0; i < 6; i++) E -= (E - ec * Math.sin(E) - M) / (1 - ec * Math.cos(E))
  const nu = 2 * Math.atan2(Math.sqrt(1 + ec) * Math.sin(E / 2), Math.sqrt(1 - ec) * Math.cos(E / 2))
  const r = a * (1 - ec * Math.cos(E))
  return { r, nu }
}

export class OrbitModel implements PhysicsModel<OrbitParams> {
  readonly id = 'orbit'
  params: OrbitParams
  private list: OrbitBody[] = []
  private frozen = false
  private nextId = 0

  constructor(params: OrbitParams) {
    this.params = params
  }
  setFrozen(f: boolean) {
    this.frozen = f
  }
  clear() {
    this.list = []
  }
  bodies(): PhysicsBody[] {
    return this.list
  }
  globals() {
    return { orbiters: this.list.filter((b) => b.alive).length }
  }
  visual() {
    return this.list.filter((b) => b.alive)
  }

  inject(identity: MusicalIdentity, ctx: PhysicsContext, now: number) {
    if (ctx.amount <= 0) return
    if (this.list.filter((b) => b.alive).length >= this.params.maxOrbiters) return
    const p = this.params
    const m = ctx.macros
    // SPACE scales the orbit, CHAOS jitters eccentricity/size (seeded)
    const size = clamp(p.orbitSize * (0.5 + m.space) * (1 + ctx.prng.signed() * 0.3 * m.chaos), 0.15, 1)
    const e = clamp(p.eccentricity + ctx.prng.signed() * 0.3 * m.chaos, 0, 0.95)
    const a = size / (1 + e)
    const orbit: OrbitState = {
      semiMajorAxis: a,
      eccentricity: e,
      orientation: degreeAngle(identity.degree, ctx.scaleLength),
      phase: 0,
      orbitalSpeed: p.speed * (0.7 + 0.6 * ctx.prng.next()),
    }
    const snap: PhysicsSnapshot = { ...emptySnapshot(), angle: orbit.orientation, radius: a * (1 - e) }
    snap.position = polarToXY(snap.radius, snap.angle)
    this.list.push({
      id: `o${this.nextId++}`,
      identity: { ...identity },
      snapshot: snap,
      prev: { ...snap },
      alive: true,
      generation: 0,
      born: now,
      orbit,
      driftPhase: ctx.prng.next() * TAU,
    })
  }

  step(dt: number, now: number, ctx: PhysicsContext): PhysicsEvent[] {
    const events: PhysicsEvent[] = []
    if (this.frozen) return events
    const p = this.params
    const m = ctx.macros
    const ts = timeScale(m)
    const decay = clamp(p.energy + (m.energy - 0.5) * 0.08, 0.3, 1)
    const decayStep = Math.pow(decay, dt)
    const drift = p.drift * (0.3 + 1.4 * m.chaos)

    for (const b of this.list) {
      if (!b.alive) continue
      const s = b.snapshot
      b.prev = { ...s }
      const o = b.orbit
      const prevM = o.phase
      const nDot = (TAU * o.orbitalSpeed * ts) / ctx.beatSeconds
      o.phase += nDot * dt
      o.orientation = wrapAngle(o.orientation + (TAU * p.precession * ts * dt) / ctx.beatSeconds)
      // slow deterministic drift of the ellipse (sinusoidal, seeded phase)
      if (drift > 0) {
        b.driftPhase += dt * 0.15 * ts
        o.eccentricity = clamp(o.eccentricity + Math.sin(b.driftPhase) * drift * 0.002, 0, 0.95)
        o.semiMajorAxis = clamp(o.semiMajorAxis * (1 + Math.cos(b.driftPhase * 0.7) * drift * 0.001), 0.05, 1)
      }
      const M = o.phase % TAU
      const { r, nu } = keplerPosition(o.semiMajorAxis, o.eccentricity, M)
      s.radius = r
      s.angle = wrapAngle(o.orientation + nu)
      s.phase = M / TAU
      s.energy *= decayStep
      s.normalizedAge = clamp((now - b.born) / p.maxAge, 0, 1)
      const pos = polarToXY(s.radius, s.angle)
      const k = deriveKinematics(b.prev.position, b.vel, pos, dt)
      s.position = pos
      s.speed = k.speed
      s.acceleration = k.acceleration
      s.curvature = k.curvature
      b.vel = k.vel
      let dA = s.angle - b.prev.angle
      if (dA > Math.PI) dA -= TAU
      if (dA < -Math.PI) dA += TAU
      s.angularVelocity = dA / dt
      s.radialVelocity = (s.radius - b.prev.radius) / dt

      if (s.energy < p.minEnergy || s.normalizedAge >= 1) {
        b.alive = false
        continue
      }
      // periapsis: mean anomaly wrapped past 2π; apoapsis: crossed π
      const wrapped = Math.floor(o.phase / TAU) > Math.floor(prevM / TAU)
      if (wrapped) events.push({ type: 'periapsis', time: now, bodyId: b.id, prev: b.prev, current: { ...s } })
      const pm = prevM % TAU
      if (pm < Math.PI && M >= Math.PI) events.push({ type: 'apoapsis', time: now, bodyId: b.id, prev: b.prev, current: { ...s } })
      if (p.quadrantEvents) {
        for (let q = 0; q < 4; q++) {
          if (crossedAngle(b.prev.angle, s.angle, (q * Math.PI) / 2))
            events.push({ type: 'quadrant', time: now, bodyId: b.id, prev: b.prev, current: { ...s }, value: q })
        }
      }
      for (const g of p.gates) {
        if (!g.enabled) continue
        if (!crossedAngle(b.prev.angle, s.angle, g.angle)) continue
        if (g.probability < 1 && ctx.prng.next() > g.probability) continue
        events.push({ type: 'gateCrossing', time: now, bodyId: b.id, prev: b.prev, current: { ...s }, gate: g })
      }
    }
    if (this.list.length > p.maxOrbiters * 2) this.list = this.list.filter((b) => b.alive)
    return events
  }
}
