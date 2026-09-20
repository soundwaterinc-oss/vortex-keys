import type { MappingConfig, MappingContext, MusicalMapper, PitchInstruction, TimbreInstruction } from './types'
import type { PhysicsSnapshot } from '@el-systema/physics'
import { applyCurve, clamp01, normalize } from '@el-systema/core'
import { angleToDegree } from '@el-systema/physics'
import { applyGate } from '@el-systema/physics'
import { wrapDegree } from '@el-systema/core'
import { clamp, mod, TAU } from '@el-systema/core'

/** Reference scales for normalising raw physical magnitudes. */
const OMEGA_MAX = TAU * 3 // rad/s that counts as "fast"
const SPEED_MAX = 3 // radius units / s
const ACCEL_MAX = 30
const SLOPE_MAX = 8

/**
 * The one configurable mapper. Every rule is a small pure function of the
 * snapshot + context so the physics monitor can show exactly what happened.
 */
export class ConfigurableMapper implements MusicalMapper {
  constructor(public config: MappingConfig) {}

  shouldTrigger(_prev: PhysicsSnapshot, _cur: PhysicsSnapshot, ctx: MappingContext): boolean {
    return this.config.triggerOn.includes(ctx.event.type)
  }

  mapPitch(s: PhysicsSnapshot, ctx: MappingContext): PitchInstruction | null {
    const n = ctx.scaleLength
    const c = this.config
    const id = ctx.identity
    let degree: number
    let octave = id.octave

    switch (c.pitchSource) {
      case 'angle':
        degree = angleToDegree(s.angle, n)
        break
      case 'radius':
        // centre = highest degree of the octave, edge = tonic
        degree = mod(Math.floor((1 - clamp01(s.radius)) * n), n)
        break
      case 'value':
        degree = mod(Math.floor(clamp01(s.value ?? 0) * n), n)
        break
      case 'gate': {
        const g = ctx.event.gate
        if (g) {
          const res = applyGate(g, { degree: id.degree, octave: id.octave }, id.velocity, n)
          const w = wrapDegree(res.note.degree, res.note.octave, n)
          id.degree = w.degree
          id.octave = w.octave
          id.velocity = clamp(res.velocity, 0.05, 1)
          if (res.spawnChild) ctx.requestChild = true
        }
        degree = id.degree
        octave = id.octave
        break
      }
      case 'identity':
      default:
        degree = id.degree
    }

    // sync narrows the degree range toward the tonic axis
    if (c.pitchRangeFromSync) {
      const R = clamp01(ctx.globals.R ?? 0)
      const span = Math.max(1, Math.round(n * (1 - 0.8 * R)))
      degree = mod(degree, span)
    }

    // register offset from a physical quantity
    const span = c.registerSource === 'none' ? 0 : c.registerSpan
    let off = 0
    switch (c.registerSource) {
      case 'radius':
        off = Math.round(clamp01(s.radius) * span) // outer = higher
        break
      case 'radiusInverse':
        off = Math.round((1 - clamp01(s.radius)) * span) // inner = higher
        break
      case 'speed':
        off = Math.round(normalize(s.speed, 0, SPEED_MAX) * span)
        break
      case 'slope':
        off = Math.round(normalize(Math.abs(s.slope ?? 0), 0, SLOPE_MAX) * span)
        break
      case 'sync':
        off = Math.round(clamp01(ctx.globals.R ?? 0) * span)
        break
      case 'valueDelta':
        off = Math.round(clamp01(Math.abs(s.slope ?? 0) * 2) * span)
        break
    }
    const w = wrapDegree(degree, octave + off - Math.floor(span / 2), n)
    return { degree: w.degree, octave: clamp(w.octave, 0, ctx.octaves - 1) }
  }

  mapVelocity(s: PhysicsSnapshot, ctx: MappingContext): number {
    const c = this.config
    let v: number
    switch (c.velocitySource) {
      case 'energy':
        v = clamp01(s.energy)
        break
      case 'angularVelocity':
        v = normalize(Math.abs(s.angularVelocity), 0, OMEGA_MAX)
        break
      case 'amplitude':
        v = clamp01(Math.abs(s.value ?? 0))
        break
      case 'distanceFromHalf':
        v = clamp01(Math.abs((s.value ?? 0.5) - 0.5) * 2)
        break
      case 'phaseVelocity':
        v = normalize(Math.abs(s.angularVelocity), 0, OMEGA_MAX * 0.5)
        break
      case 'constant':
      default:
        v = 1
    }
    v = applyCurve(v, c.velocityCurve)
    // the performer's velocity and the FLOW amount always scale the result
    const base = 0.3 + 0.7 * v
    const accent = c.accentOn.includes(ctx.event.type) ? 1.3 : 1
    return clamp(ctx.identity.velocity * base * accent * (0.4 + 0.6 * ctx.amount), 0.02, 1)
  }

  mapTimbre(s: PhysicsSnapshot, ctx: MappingContext): TimbreInstruction {
    const c = this.config
    let b: number
    switch (c.timbreSource) {
      case 'radius':
        b = clamp01(s.radius)
        break
      case 'radiusInverse':
        b = 1 - clamp01(s.radius)
        break
      case 'energy':
        b = clamp01(s.energy)
        break
      case 'acceleration':
        b = normalize(s.acceleration, 0, ACCEL_MAX)
        break
      case 'sync':
        b = clamp01(ctx.globals.R ?? 0)
        break
      case 'slope':
        b = normalize(Math.abs(s.slope ?? 0), 0, SLOPE_MAX)
        break
      case 'constant':
      default:
        b = 0.5
    }
    let w: number
    switch (c.widthSource) {
      case 'syncInverse':
        w = 1 - 0.8 * clamp01(ctx.globals.R ?? 0)
        break
      case 'radius':
        w = 0.3 + 0.7 * clamp01(s.radius)
        break
      default:
        w = 1
    }
    return { brightness: b, width: w }
  }
}
