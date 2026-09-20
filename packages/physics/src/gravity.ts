import type { PhysicsBody, PhysicsContext, PhysicsEvent, PhysicsModel, MusicalIdentity, PhysicsSnapshot } from './types'
import { deriveKinematics, emptySnapshot, timeScale } from './types'
import type { Gate } from './gates'
import { crossedAngle, clamp, TAU, wrapAngle } from '@el-systema/core'
import { degreeAngle, polarToXY } from './frame'

export interface GravityParams {
  /** revolutions per beat at the reference radius */
  spin: number
  /** inward drift, reference radii per second */
  pull: number
  /** exponent of (R / r)^alpha */
  alpha: number
  /** energy multiplier per second */
  decay: number
  /** radius at which a particle is absorbed (centre entry) */
  minRadius: number
  /** energy lost per gate crossing (0..1) */
  energyLoss: number
  /** seeded random perturbation amount (scaled by CHAOS macro) */
  turbulence: number
  /** probability that a performed note spawns a particle */
  density: number
  /** how strongly SPIN follows tempo: 0 = per second, 1 = per beat */
  tempoInfluence: number
  maxParticles: number
  maxAge: number
  minEnergy: number
  maxChildrenPerParent: number
  maxGeneration: number
  gates: Gate[]
}

export const DEFAULT_GRAVITY_PARAMS: GravityParams = {
  spin: 0.25,
  pull: 0.05,
  alpha: 1,
  decay: 0.85,
  minRadius: 0.08,
  energyLoss: 0.04,
  turbulence: 0.1,
  density: 1,
  tempoInfluence: 0.7,
  maxParticles: 48,
  maxAge: 40,
  minEnergy: 0.06,
  maxChildrenPerParent: 3,
  maxGeneration: 3,
  gates: [],
}

const TRAIL_LEN = 24

export interface GravityBody extends PhysicsBody {
  vel?: { x: number; y: number }
  children: number
  trail: Float32Array
  trailHead: number
}

/**
 * Gravity Vortex.
 *   dθ/dt = ω0 · (R / max(r, rmin))^α · (1 + turb·ξ)
 *   dr/dt = −pull · R + turb·ξ′
 *   E     = E · decay^dt, and E ·= (1 − energyLoss) per gate crossing
 * The (R/r)^α term is the "drain" behaviour: sparse → accelerating → dense
 * → absorbed at rmin (centreEntry event, particle dies).
 * Macros: ENERGY scales density and decay, CHAOS scales turbulence, TIME
 * scales ω0 and pull, SPACE scales the spawn radius.
 */
export class GravityModel implements PhysicsModel<GravityParams> {
  readonly id = 'vortex'
  params: GravityParams
  private list: GravityBody[] = []
  private frozen = false
  private nextId = 0

  constructor(params: GravityParams) {
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
    return { particles: this.list.filter((b) => b.alive).length }
  }
  visual() {
    return this.list.filter((b) => b.alive)
  }

  inject(identity: MusicalIdentity, ctx: PhysicsContext, now: number) {
    if (ctx.amount <= 0) return
    const chance = this.params.density * ctx.amount * (0.5 + ctx.macros.energy)
    if (ctx.prng.next() > chance) return
    const spawnR = 0.6 + 0.4 * ctx.macros.space
    this.spawn(degreeAngle(identity.degree, ctx.scaleLength), spawnR, { ...identity }, 1, 0, now)
  }

  spawnChild(bodyId: string, ctx: PhysicsContext, now: number) {
    const parent = this.list.find((b) => b.id === bodyId)
    if (!parent || !parent.alive) return
    if (parent.children >= this.params.maxChildrenPerParent) return
    if (parent.generation >= this.params.maxGeneration) return
    parent.children++
    const s = parent.snapshot
    const child = this.spawn(
      s.angle,
      s.radius,
      { ...parent.identity, velocity: parent.identity.velocity * 0.8 },
      s.energy * 0.6,
      parent.generation + 1,
      now,
    )
    // seeded angular offset so children do not sit exactly on the parent
    if (child) child.snapshot.angle = wrapAngle(child.snapshot.angle + ctx.prng.signed() * 0.2)
  }

  private spawn(angle: number, radius: number, identity: MusicalIdentity, energy: number, generation: number, now: number) {
    if (this.list.filter((b) => b.alive).length >= this.params.maxParticles) return null
    const snap: PhysicsSnapshot = { ...emptySnapshot(), angle, radius, energy, position: polarToXY(radius, angle) }
    const b: GravityBody = {
      id: `p${this.nextId++}`,
      identity,
      snapshot: snap,
      prev: { ...snap },
      alive: true,
      generation,
      born: now,
      children: 0,
      trail: new Float32Array(TRAIL_LEN * 2).fill(NaN),
      trailHead: 0,
    }
    this.list.push(b)
    return b
  }

  step(dt: number, now: number, ctx: PhysicsContext): PhysicsEvent[] {
    const events: PhysicsEvent[] = []
    if (this.frozen) return events
    const p = this.params
    const m = ctx.macros
    const ts = timeScale(m)
    const perBeat = p.spin / ctx.beatSeconds
    const omega0 = TAU * (p.spin + (perBeat - p.spin) * p.tempoInfluence) * ts
    const pull = p.pull * ts
    const decay = clamp(p.decay - (m.energy - 0.5) * 0.1, 0.3, 1) // more ENERGY = slower decay
    const decayStep = Math.pow(decay, dt)
    const turb = p.turbulence * (0.2 + 1.6 * m.chaos)

    for (const b of this.list) {
      if (!b.alive) continue
      const s = b.snapshot
      b.prev = { ...s }
      const r = Math.max(s.radius, p.minRadius)
      let omega = omega0 * Math.pow(1 / r, p.alpha)
      let vr = -pull
      if (turb > 0) {
        omega *= 1 + ctx.prng.signed() * turb * 0.6
        vr += ctx.prng.signed() * turb * 0.15
      }
      const dTheta = clamp(omega * dt, -Math.PI * 0.9, Math.PI * 0.9)
      s.angle = wrapAngle(s.angle + dTheta)
      s.radius = Math.max(0, s.radius + vr * dt)
      s.angularVelocity = omega
      s.radialVelocity = vr
      s.energy *= decayStep
      s.normalizedAge = clamp((now - b.born) / p.maxAge, 0, 1)
      s.phase = wrapAngle(s.angle + Math.PI / 2) / TAU
      const pos = polarToXY(s.radius, s.angle)
      const k = deriveKinematics(b.prev.position, b.vel, pos, dt)
      s.position = pos
      s.speed = k.speed
      s.acceleration = k.acceleration
      s.curvature = k.curvature
      b.vel = k.vel

      b.trail[b.trailHead * 2] = s.angle
      b.trail[b.trailHead * 2 + 1] = s.radius
      b.trailHead = (b.trailHead + 1) % TRAIL_LEN

      if (s.radius <= p.minRadius) {
        b.alive = false
        events.push({ type: 'centerEntry', time: now, bodyId: b.id, prev: b.prev, current: { ...s } })
        continue
      }
      if (s.energy < p.minEnergy || s.normalizedAge >= 1) {
        b.alive = false
        continue
      }
      for (const g of p.gates) {
        if (!g.enabled) continue
        if (!crossedAngle(b.prev.angle, s.angle, g.angle)) continue
        if (g.probability < 1 && ctx.prng.next() > g.probability) continue
        events.push({ type: 'gateCrossing', time: now, bodyId: b.id, prev: b.prev, current: { ...s }, gate: g })
        s.energy *= 1 - p.energyLoss
      }
    }
    if (this.list.length > p.maxParticles * 2) this.list = this.list.filter((b) => b.alive)
    return events
  }
}
