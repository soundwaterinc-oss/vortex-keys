import type { FlowContext, FlowModel, GeneratedEvent, SeedNote } from './types'
import type { Gate } from './gates'
import { applyGate } from './gates'
import { crossedAngle, clamp, TAU, wrapAngle } from '../math/util'
import { wrapDegree } from '../tuning/tuning'

export interface VortexParticle {
  id: string
  angle: number
  radius: number
  angularVelocity: number
  radialVelocity: number
  energy: number

  scaleDegree: number
  octave: number
  velocity: number

  age: number
  alive: boolean
  /** generation depth (0 = performed note) */
  generation: number
  /** last few positions for trails (visual only) */
  trail: Float32Array
  trailHead: number
}

export interface VortexParams {
  /** base angular velocity in revolutions per beat at the reference radius */
  spin: number
  /** inward radial pull, in reference radii per second (0..1) */
  pull: number
  /** energy multiplier per second (0..1) — 1 = no decay */
  decay: number
  /** magnitude of seeded random perturbation (0..1) */
  turbulence: number
  /** probability that a performed note spawns a particle (scaled by FLOW amount) */
  density: number
  /** how strongly SPIN follows tempo: 0 = seconds-based, 1 = fully beat-relative */
  tempoInfluence: number
  /** exponent of the (refRadius / radius)^alpha speed-up */
  alpha: number
  maxParticles: number
  maxEventsPerSecond: number
  /** particle lifetime in seconds */
  maxAge: number
  /** energy below which a particle dies */
  minEnergy: number
  /** particles below this radius (fraction of ref) are absorbed */
  coreRadius: number
  gates: Gate[]
}

export const DEFAULT_VORTEX_PARAMS: VortexParams = {
  spin: 0.25,
  pull: 0.05,
  decay: 0.85,
  turbulence: 0.1,
  density: 1,
  tempoInfluence: 0.7,
  alpha: 1,
  maxParticles: 48,
  maxEventsPerSecond: 24,
  maxAge: 40,
  minEnergy: 0.06,
  coreRadius: 0.08,
  gates: [],
}

const TRAIL_LEN = 24
const MAX_GENERATION = 3
const REF_RADIUS = 1 // simulation space: radius 1 = spawn ring

/**
 * Vortex flow model.
 *
 *   dθ/dt = ω0 · (R / r)^α          (faster near the centre, like a drain)
 *   dr/dt = −pull · R               (constant inward drift)
 *   E     = E · decay^dt            (exponential energy loss)
 *
 * ω0 is derived from SPIN either per second or per beat, blended by
 * tempoInfluence. Turbulence adds a seeded random kick to ω and r each step.
 * When a particle's angle crosses a gate, the gate transforms its note and
 * an event is emitted with velocity = performed velocity × energy.
 */
export class VortexModel implements FlowModel<VortexParams> {
  readonly id = 'vortex'
  params: VortexParams
  particles: VortexParticle[] = []
  private frozen = false
  private nextId = 0
  private eventWindow: number[] = []
  /** last angle at which each particle crossed a gate (avoid double fire) */

  constructor(params: VortexParams) {
    this.params = params
  }

  setFrozen(f: boolean) {
    this.frozen = f
  }

  clear() {
    this.particles = []
    this.eventWindow = []
  }

  inject(note: SeedNote, ctx: FlowContext) {
    const p = this.params
    if (ctx.amount <= 0) return
    const chance = p.density * ctx.amount
    if (ctx.prng.next() > chance) return
    // spawn on the outer ring at the note's spiral angle so the visual
    // connection between key and particle is literal
    const angle = wrapAngle((TAU * note.degree) / ctx.scaleLength - Math.PI / 2)
    this.spawn(angle, REF_RADIUS, note.degree, note.octave, note.velocity, 1, 0)
  }

  private spawn(
    angle: number,
    radius: number,
    degree: number,
    octave: number,
    velocity: number,
    energy: number,
    generation: number,
  ): VortexParticle | null {
    if (this.particles.filter((q) => q.alive).length >= this.params.maxParticles) return null
    const p: VortexParticle = {
      id: `p${this.nextId++}`,
      angle,
      radius,
      angularVelocity: 0,
      radialVelocity: 0,
      energy,
      scaleDegree: degree,
      octave,
      velocity,
      age: 0,
      alive: true,
      generation,
      trail: new Float32Array(TRAIL_LEN * 2).fill(NaN),
      trailHead: 0,
    }
    this.particles.push(p)
    return p
  }

  update(dt: number, now: number, ctx: FlowContext): GeneratedEvent[] {
    const events: GeneratedEvent[] = []
    if (this.frozen) return events
    const p = this.params
    const n = ctx.scaleLength

    // ω0: revolutions per second. SPIN is expressed in rev/beat; blend with rev/sec.
    const perBeat = p.spin / ctx.beatSeconds
    const perSec = p.spin
    const omega0 = TAU * (perSec + (perBeat - perSec) * p.tempoInfluence)
    const decayStep = Math.pow(clamp(p.decay, 0, 1), dt)

    // events-per-second window
    const windowStart = now - 1
    while (this.eventWindow.length && this.eventWindow[0] < windowStart) this.eventWindow.shift()

    const spawnQueue: VortexParticle[] = []

    for (const q of this.particles) {
      if (!q.alive) continue
      const r = Math.max(q.radius, p.coreRadius)
      const speedUp = Math.pow(REF_RADIUS / r, p.alpha)
      let omega = omega0 * speedUp
      let vr = -p.pull * REF_RADIUS
      if (p.turbulence > 0) {
        omega *= 1 + ctx.prng.signed() * p.turbulence * 0.6
        vr += ctx.prng.signed() * p.turbulence * 0.15
      }
      // clamp angular step to < PI so crossing detection stays unambiguous
      const dTheta = clamp(omega * dt, -Math.PI * 0.9, Math.PI * 0.9)
      q.angularVelocity = omega
      q.radialVelocity = vr
      const prevAngle = q.angle
      q.angle = wrapAngle(q.angle + dTheta)
      q.radius = Math.max(0, q.radius + vr * dt)
      q.energy *= decayStep
      q.age += dt

      // trail ring buffer
      q.trail[q.trailHead * 2] = q.angle
      q.trail[q.trailHead * 2 + 1] = q.radius
      q.trailHead = (q.trailHead + 1) % TRAIL_LEN

      if (q.energy < p.minEnergy || q.age > p.maxAge || q.radius <= p.coreRadius) {
        q.alive = false
        continue
      }

      for (const g of p.gates) {
        if (!g.enabled) continue
        if (!crossedAngle(prevAngle, q.angle, g.angle)) continue
        if (g.probability < 1 && ctx.prng.next() > g.probability) continue
        const res = applyGate(g, { degree: q.scaleDegree, octave: q.octave }, q.velocity, n)
        const wrapped = wrapDegree(res.note.degree, res.note.octave, n)
        q.scaleDegree = wrapped.degree
        q.octave = wrapped.octave
        q.velocity = clamp(res.velocity, 0.05, 1)
        if (res.spawnChild && q.generation < MAX_GENERATION) {
          // child inherits note and position with less energy; generations
          // are capped so spawn gates cannot sustain an immortal population
          const child = this.spawn(
            q.angle,
            q.radius,
            q.scaleDegree,
            q.octave,
            q.velocity * 0.8,
            q.energy * 0.6,
            q.generation + 1,
          )
          if (child) spawnQueue.push(child)
        }
        if (this.eventWindow.length >= p.maxEventsPerSecond) continue
        this.eventWindow.push(now)
        // generated velocity scales with energy and FLOW amount
        const vel = clamp(q.velocity * (0.35 + 0.65 * q.energy) * (0.4 + 0.6 * ctx.amount), 0.02, 1)
        events.push({
          time: now,
          note: { degree: q.scaleDegree, octave: q.octave },
          velocity: vel,
          duration: clamp(ctx.beatSeconds * (0.3 + 0.8 * q.energy), 0.08, 2.5),
          brightness: clamp(1 - q.radius, 0, 1),
          sourceId: q.id,
        })
        // each crossing costs a little energy: prevents immortal loops
        q.energy *= 0.96
      }
    }

    // prune dead particles occasionally
    if (this.particles.length > p.maxParticles * 2) {
      this.particles = this.particles.filter((q) => q.alive)
    }
    return events
  }
}
