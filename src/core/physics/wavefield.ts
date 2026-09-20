import type { PhysicsBody, PhysicsContext, PhysicsEvent, PhysicsModel, MusicalIdentity, PhysicsSnapshot } from './types'
import { emptySnapshot, timeScale } from './types'
import { clamp, TAU } from '../math/util'
import { degreeAngle, polarToXY } from './frame'

export interface WaveSource {
  x: number
  y: number
  /** frequency ratio to the base rate */
  ratio: number
  /** wavelength in spawn-ring units */
  wavelength: number
  amplitude: number
  /** phase in turns */
  phase: number
}

export interface WaveFieldParams {
  sourceCount: number
  /** cycles per beat for ratio 1 */
  baseRate: number
  /** frequency ratios; cycled if fewer than sources */
  ratios: number[]
  wavelength: number
  /** ring radius where sources sit (0 = all at centre) */
  sourceRadius: number
  /** rotation of the source ring in turns */
  sourceRotation: number
  phaseSpread: number
  amplitude: number
  threshold: number
  /** −1: waves travel inward, +1: outward */
  expanding: 1 | -1
  maxProbes: number
  /** |field| below this counts as destructive interference */
  nullLevel: number
}

export const DEFAULT_WAVEFIELD_PARAMS: WaveFieldParams = {
  sourceCount: 3,
  baseRate: 0.25,
  ratios: [3, 4, 5],
  wavelength: 0.8,
  sourceRadius: 0.7,
  sourceRotation: 0,
  phaseSpread: 0,
  amplitude: 1,
  threshold: 0.5,
  expanding: 1,
  maxProbes: 8,
  nullLevel: 0.06,
}

/**
 * wave_i(x, y, t) = A_i sin(k_i · |p − s_i| − ω_i t + φ_i)
 * field(x, y, t)  = Σ wave_i / Σ |A_i|     (normalised to [−1, 1])
 * This is a scalar interference pattern of point sources, an artistic
 * approximation (no dispersion, no attenuation with distance).
 */
export function fieldAt(sources: WaveSource[], x: number, y: number, t: number, baseHz: number): number {
  let sum = 0
  let norm = 0
  for (const s of sources) {
    const d = Math.hypot(x - s.x, y - s.y)
    const k = TAU / Math.max(0.05, s.wavelength)
    sum += s.amplitude * Math.sin(k * d - TAU * (s.ratio * baseHz * t + s.phase))
    norm += Math.abs(s.amplitude)
  }
  return norm > 0 ? sum / norm : 0
}

export function buildSources(p: WaveFieldParams, space: number): WaveSource[] {
  const out: WaveSource[] = []
  const R = p.sourceRadius * (0.4 + 1.2 * space)
  for (let i = 0; i < p.sourceCount; i++) {
    const a = TAU * (i / p.sourceCount + p.sourceRotation)
    out.push({
      x: R * Math.cos(a),
      y: R * Math.sin(a),
      ratio: p.ratios[i % p.ratios.length],
      wavelength: p.wavelength,
      amplitude: p.amplitude,
      phase: (p.phaseSpread * i) / Math.max(1, p.sourceCount),
    })
  }
  return out
}

interface Probe extends PhysicsBody {
  prevSlope: number
}

/**
 * Probes are the bodies: a performed note places a probe on its own spiral
 * position (degree axis, octave radius). Events per probe:
 *   thresholdCrossing ±   field crosses ±threshold (direction = sign)
 *   extrema             local max/min of the field with |f| > threshold/2
 *   nullCrossing        |f| falls below nullLevel (destructive interference)
 * Only crossings fire — a value staying above threshold never retriggers.
 */
export class WaveFieldModel implements PhysicsModel<WaveFieldParams> {
  readonly id = 'wave'
  params: WaveFieldParams
  private probes: Probe[] = []
  private frozen = false
  private t = 0
  private nextId = 0
  sources: WaveSource[] = []
  baseHz = 1

  constructor(params: WaveFieldParams) {
    this.params = params
  }
  setFrozen(f: boolean) {
    this.frozen = f
  }
  clear() {
    this.probes = []
  }
  bodies(): PhysicsBody[] {
    return this.probes
  }
  globals() {
    return { t: this.t, probes: this.probes.length }
  }
  get time() {
    return this.t
  }
  visual() {
    return { sources: this.sources, probes: this.probes, t: this.t, baseHz: this.baseHz, threshold: this.params.threshold }
  }

  inject(identity: MusicalIdentity, ctx: PhysicsContext, now: number) {
    if (ctx.amount <= 0) return
    const angle = degreeAngle(identity.degree, ctx.scaleLength)
    const radius = 0.3 + 0.65 * (identity.octave / Math.max(1, ctx.octaves - 1))
    const snap: PhysicsSnapshot = { ...emptySnapshot(), angle, radius, position: polarToXY(radius, angle), value: 0, slope: 0 }
    this.probes.push({ id: `w${this.nextId++}`, identity: { ...identity }, snapshot: snap, prev: { ...snap }, alive: true, generation: 0, born: now, prevSlope: 0 })
    while (this.probes.length > this.params.maxProbes) this.probes.shift()
  }

  step(dt: number, now: number, ctx: PhysicsContext): PhysicsEvent[] {
    const events: PhysicsEvent[] = []
    if (this.frozen) return events
    const p = this.params
    const m = ctx.macros
    this.t += dt * timeScale(m)
    this.sources = buildSources(p, m.space)
    // CHAOS detunes the ratios toward irrational relationships (artistic)
    if (m.chaos > 0) for (let i = 0; i < this.sources.length; i++) this.sources[i].ratio *= 1 + m.chaos * 0.2 * Math.sin(1 + i * 2.399)
    this.baseHz = p.baseRate / ctx.beatSeconds
    const thr = clamp(p.threshold * (1.2 - 0.6 * m.energy), 0.05, 0.98) // ENERGY lowers the threshold
    const sign = p.expanding

    for (const b of this.probes) {
      const s = b.snapshot
      b.prev = { ...s }
      const pos = s.position!
      const f = fieldAt(this.sources, pos.x * sign, pos.y * sign, this.t, this.baseHz)
      const prev = s.value ?? 0
      const slope = (f - prev) / dt
      s.value = f
      s.slope = slope
      s.energy = Math.abs(f)
      s.angularVelocity = slope // reuse: rate of change drives "phase velocity" mappings
      s.normalizedAge = clamp((now - b.born) / 120, 0, 1)
      const base = { time: now, bodyId: b.id, prev: b.prev, current: { ...s } }
      if (prev < thr && f >= thr) events.push({ ...base, type: 'thresholdCrossing', direction: 1, value: f })
      if (prev > -thr && f <= -thr) events.push({ ...base, type: 'thresholdCrossing', direction: -1, value: f })
      if (b.prevSlope > 0 && slope <= 0 && f > thr * 0.5) events.push({ ...base, type: 'extrema', kind: 'max', value: f })
      if (b.prevSlope < 0 && slope >= 0 && f < -thr * 0.5) events.push({ ...base, type: 'extrema', kind: 'min', value: f })
      if (Math.abs(prev) >= p.nullLevel && Math.abs(f) < p.nullLevel) events.push({ ...base, type: 'nullCrossing', value: f })
      b.prevSlope = slope
    }
    return events
  }
}
