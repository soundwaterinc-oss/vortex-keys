import type { Gate } from './gates'
import type { Prng } from '@el-systema/core'

/**
 * Physical state of one body (particle, orbiter, oscillator, probe, chaos
 * state) at one simulation step. Everything is normalised where practical:
 * radius 1 = the spawn ring / field edge, energy in [0,1], phase in [0,1).
 * The angular frame is shared with the spiral: 0 = +x, degree-0 axis at −π/2.
 */
export interface PhysicsSnapshot {
  position?: { x: number; y: number }
  radius: number
  angle: number
  angularVelocity: number
  radialVelocity: number
  /** |v| in radius-units per second */
  speed: number
  /** |a| in radius-units per second² */
  acceleration: number
  energy: number
  phase?: number
  curvature?: number
  /** model scalar: field amplitude, logistic x, sync order… */
  value?: number
  /** d value / dt */
  slope?: number
  normalizedAge: number
}

export type PhysicsEventType =
  | 'gateCrossing'
  | 'phaseCrossing'
  | 'thresholdCrossing'
  | 'periapsis'
  | 'apoapsis'
  | 'quadrant'
  | 'sync'
  | 'extrema'
  | 'centerEntry'
  | 'nullCrossing'

export const PHYSICS_EVENT_TYPES: PhysicsEventType[] = [
  'gateCrossing',
  'phaseCrossing',
  'thresholdCrossing',
  'periapsis',
  'apoapsis',
  'quadrant',
  'sync',
  'extrema',
  'centerEntry',
  'nullCrossing',
]

/** Semantic event extracted from the simulation; the mapper interprets it. */
export interface PhysicsEvent {
  type: PhysicsEventType
  time: number
  bodyId: string
  prev: PhysicsSnapshot
  current: PhysicsSnapshot
  gate?: Gate
  /** +1 rising / up / positive, −1 falling / down / negative */
  direction?: 1 | -1
  kind?: 'max' | 'min'
  value?: number
}

/** Musical identity a body carries (from the performer or a gate). */
export interface MusicalIdentity {
  degree: number
  octave: number
  velocity: number
}

export interface PhysicsBody {
  id: string
  identity: MusicalIdentity
  snapshot: PhysicsSnapshot
  prev: PhysicsSnapshot
  alive: boolean
  generation: number
  born: number
}

/** Global performance macros; each model interprets them at a high level. */
export interface GlobalMacros {
  /** amount of activity */
  energy: number
  /** 0 = ORDER, 1 = CHAOS */
  chaos: number
  /** temporal scale: 0.5 = nominal, 0 = half speed, 1 = double */
  time: number
  /** spatial spread */
  space: number
}

export const DEFAULT_MACROS_GLOBAL: GlobalMacros = { energy: 0.5, chaos: 0.25, time: 0.5, space: 0.5 }

/** TIME macro -> rate multiplier in [0.5, 2]. */
export const timeScale = (m: GlobalMacros) => Math.pow(2, (m.time - 0.5) * 2)

export interface PhysicsContext {
  scaleLength: number
  octaves: number
  beatSeconds: number
  amount: number
  prng: Prng
  macros: GlobalMacros
}

export interface PhysicsModel<P = unknown> {
  readonly id: string
  params: P
  /** Advance by a fixed dt and return the semantic events of this step. */
  step(dt: number, now: number, ctx: PhysicsContext): PhysicsEvent[]
  bodies(): PhysicsBody[]
  /** A performed note enters the system. */
  inject(identity: MusicalIdentity, ctx: PhysicsContext, now: number): void
  /** Optional: a mapper asked for a child of this body (gate action). */
  spawnChild?(bodyId: string, ctx: PhysicsContext, now: number): void
  /** Optional: re-initialise phases/state deterministically from the prng. */
  reset?(ctx: PhysicsContext): void
  setFrozen(f: boolean): void
  clear(): void
  /** Global scalars (sync order R, chaos x, …) for mapping and monitoring. */
  globals(): Record<string, number>
  /** Model-specific visual data; the renderer draws exactly this. */
  visual(): unknown
}

export function emptySnapshot(): PhysicsSnapshot {
  return { radius: 1, angle: 0, angularVelocity: 0, radialVelocity: 0, speed: 0, acceleration: 0, energy: 1, normalizedAge: 0 }
}

/**
 * Derive speed / acceleration / curvature from consecutive positions.
 * Curvature κ = |v × a| / |v|³ (2D). Cheap and model-agnostic.
 */
export function deriveKinematics(
  prevPos: { x: number; y: number } | undefined,
  prevVel: { x: number; y: number } | undefined,
  pos: { x: number; y: number },
  dt: number,
): { vel: { x: number; y: number }; speed: number; acceleration: number; curvature: number } {
  if (!prevPos || dt <= 0) return { vel: { x: 0, y: 0 }, speed: 0, acceleration: 0, curvature: 0 }
  const vel = { x: (pos.x - prevPos.x) / dt, y: (pos.y - prevPos.y) / dt }
  const speed = Math.hypot(vel.x, vel.y)
  if (!prevVel) return { vel, speed, acceleration: 0, curvature: 0 }
  const ax = (vel.x - prevVel.x) / dt
  const ay = (vel.y - prevVel.y) / dt
  const acceleration = Math.hypot(ax, ay)
  const cross = Math.abs(vel.x * ay - vel.y * ax)
  const curvature = speed > 1e-6 ? cross / (speed * speed * speed) : 0
  return { vel, speed, acceleration, curvature }
}
