import { describe, it, expect } from 'vitest'
import { GravityModel, DEFAULT_GRAVITY_PARAMS } from '../src/gravity'
import { OrbitModel, DEFAULT_ORBIT_PARAMS, keplerPosition } from '../src/orbit'
import { WaveFieldModel, DEFAULT_WAVEFIELD_PARAMS, fieldAt, buildSources } from '../src/wavefield'
import { CoupledModel, DEFAULT_COUPLED_PARAMS, orderParameter } from '../src/coupled'
import { ChaosModel, DEFAULT_CHAOS_PARAMS, logisticStep } from '../src/chaos'
import { defaultGates, applyGate, type Gate } from '../src/gates'
import { createPrng } from '@el-systema/core'
import type { PhysicsContext, PhysicsModel, PhysicsEvent } from '../src/types'
import { DEFAULT_MACROS_GLOBAL } from '../src/types'
import { degreeAngle, angleToDegree } from '../src/frame'
import { normalize, mapRange, applyCurve, curve } from '@el-systema/core'

const ctx = (seed = 1, over: Partial<PhysicsContext> = {}): PhysicsContext => ({
  scaleLength: 5,
  octaves: 4,
  beatSeconds: 0.5,
  amount: 1,
  prng: createPrng(seed),
  macros: { ...DEFAULT_MACROS_GLOBAL },
  ...over,
})

function run(model: PhysicsModel, seconds: number, c: PhysicsContext, dt = 1 / 120): PhysicsEvent[] {
  const events: PhysicsEvent[] = []
  for (let t = 0; t < seconds; t += dt) events.push(...model.step(dt, t, c))
  return events
}

describe('normalize', () => {
  it('normalize / mapRange / curves', () => {
    expect(normalize(5, 0, 10)).toBe(0.5)
    expect(normalize(-1, 0, 10)).toBe(0)
    expect(mapRange(0.5, 0, 1, 10, 20)).toBe(15)
    expect(curve(0.5, 2)).toBe(0.25)
    expect(applyCurve(0.5, 'exp')).toBe(0.25)
    expect(applyCurve(0.5, 'invExp')).toBe(0.75)
    expect(applyCurve(0.5, 'scurve')).toBe(0.5)
    expect(applyCurve(NaN, 'linear')).toBe(0)
  })
  it('frame: degree axis round trip', () => {
    for (let d = 0; d < 7; d++) expect(angleToDegree(degreeAngle(d, 7), 7)).toBe(d)
  })
})

describe('gates', () => {
  it('transposes by scale degree', () => {
    const g = (action: Gate['action']): Gate => ({ id: 'x', angle: 0, action, probability: 1, enabled: true })
    expect(applyGate(g('degreeUp'), { degree: 4, octave: 0 }, 0.5, 5).note).toEqual({ degree: 0, octave: 1 })
    expect(applyGate(g('degreeDown'), { degree: 0, octave: 1 }, 0.5, 5).note).toEqual({ degree: 4, octave: 0 })
    expect(applyGate(g('spawnChild'), { degree: 2, octave: 0 }, 1, 5).spawnChild).toBe(true)
  })
})

describe('gravity', () => {
  it('spawns, decays, and accelerates inward', () => {
    const m = new GravityModel({ ...DEFAULT_GRAVITY_PARAMS, gates: [], turbulence: 0 })
    const c = ctx()
    m.inject({ degree: 2, octave: 1, velocity: 0.8 }, c, 0)
    expect(m.bodies().length).toBe(1)
    const b = m.bodies()[0]
    run(m, 0.5, c)
    const w1 = b.snapshot.angularVelocity
    const e1 = b.snapshot.energy
    run(m, 2, c)
    expect(b.snapshot.radius).toBeLessThan(1)
    expect(b.snapshot.angularVelocity).toBeGreaterThan(w1)
    expect(b.snapshot.energy).toBeLessThan(e1)
  })
  it('emits gate crossings at the right times and centre entry at the end', () => {
    const gates = defaultGates(1, ['repeat'])
    const m = new GravityModel({ ...DEFAULT_GRAVITY_PARAMS, gates, turbulence: 0, spin: 1, tempoInfluence: 0, pull: 0, decay: 1, alpha: 0 })
    const c = ctx()
    m.inject({ degree: 0, octave: 0, velocity: 1 }, c, 0) // spawns at -π/2 on the 0.9 ring (space 0.5)
    const ev = run(m, 1.5, c)
    const gc = ev.filter((e) => e.type === 'gateCrossing')
    expect(gc.length).toBe(2)
    expect(gc[0].time).toBeCloseTo(0.25, 1)
    expect(gc[1].time).toBeCloseTo(1.25, 1)
    const m2 = new GravityModel({ ...DEFAULT_GRAVITY_PARAMS, gates: [], turbulence: 0, pull: 0.5, decay: 1 })
    m2.inject({ degree: 0, octave: 0, velocity: 1 }, c, 0)
    const ev2 = run(m2, 3, c)
    expect(ev2.some((e) => e.type === 'centerEntry')).toBe(true)
    expect(m2.bodies().filter((b) => b.alive).length).toBe(0)
  })
  it('is deterministic with turbulence for the same seed', () => {
    const mk = () => new GravityModel({ ...DEFAULT_GRAVITY_PARAMS, gates: defaultGates(4), turbulence: 0.5 })
    const a = mk(), b = mk()
    const ca = ctx(7), cb = ctx(7)
    a.inject({ degree: 1, octave: 1, velocity: 0.9 }, ca, 0)
    b.inject({ degree: 1, octave: 1, velocity: 0.9 }, cb, 0)
    const ea = run(a, 4, ca), eb = run(b, 4, cb)
    expect(ea.length).toBeGreaterThan(0)
    expect(ea.map((e) => [e.time, e.type, e.current.angle])).toEqual(eb.map((e) => [e.time, e.type, e.current.angle]))
  })
  it('caps particles and children', () => {
    const m = new GravityModel({ ...DEFAULT_GRAVITY_PARAMS, gates: [], maxParticles: 5, maxChildrenPerParent: 1, maxGeneration: 1 })
    const c = ctx(1, { macros: { ...DEFAULT_MACROS_GLOBAL, energy: 1 } })
    for (let i = 0; i < 20; i++) m.inject({ degree: i % 5, octave: 0, velocity: 1 }, c, 0)
    expect(m.bodies().length).toBe(5)
    const m2 = new GravityModel({ ...DEFAULT_GRAVITY_PARAMS, gates: [], maxChildrenPerParent: 1, maxGeneration: 1 })
    m2.inject({ degree: 0, octave: 0, velocity: 1 }, c, 0)
    const id = m2.bodies()[0].id
    m2.spawnChild(id, c, 0)
    m2.spawnChild(id, c, 0)
    expect(m2.bodies().length).toBe(2)
    m2.spawnChild(m2.bodies()[1].id, c, 0) // generation limit
    expect(m2.bodies().length).toBe(2)
  })
})

describe('orbit', () => {
  it('kepler: periapsis at M=0, apoapsis at M=π', () => {
    expect(keplerPosition(1, 0.5, 0).r).toBeCloseTo(0.5)
    expect(keplerPosition(1, 0.5, Math.PI).r).toBeCloseTo(1.5)
    expect(keplerPosition(1, 0, 1).nu).toBeCloseTo(1)
  })
  it('moves faster at periapsis than apoapsis and emits periapsis/apoapsis events', () => {
    const m = new OrbitModel({ ...DEFAULT_ORBIT_PARAMS, gates: [], drift: 0, precession: 0, speed: 0.5, eccentricity: 0.7 })
    const c = ctx(3, { macros: { ...DEFAULT_MACROS_GLOBAL, chaos: 0 } })
    m.inject({ degree: 0, octave: 1, velocity: 0.8 }, c, 0)
    const b = m.bodies()[0]
    let maxAtPeri = 0
    let minAtApo = Infinity
    const ev: PhysicsEvent[] = []
    for (let t = 0; t < 4; t += 1 / 120) {
      ev.push(...m.step(1 / 120, t, c))
      const ph = b.snapshot.phase ?? 0
      if (t > 0.1 && (ph < 0.05 || ph > 0.95)) maxAtPeri = Math.max(maxAtPeri, b.snapshot.speed)
      if (t > 0.1 && Math.abs(ph - 0.5) < 0.05) minAtApo = Math.min(minAtApo, b.snapshot.speed)
    }
    expect(maxAtPeri).toBeGreaterThan(minAtApo * 3)
    expect(ev.filter((e) => e.type === 'periapsis').length).toBeGreaterThanOrEqual(3)
    expect(ev.filter((e) => e.type === 'apoapsis').length).toBeGreaterThanOrEqual(3)
  })
})

describe('wave field', () => {
  it('field is normalised and sources are placed on a ring', () => {
    const src = buildSources(DEFAULT_WAVEFIELD_PARAMS, 0.5)
    expect(src.length).toBe(3)
    for (let t = 0; t < 5; t += 0.05) expect(Math.abs(fieldAt(src, 0.3, 0.2, t, 1))).toBeLessThanOrEqual(1 + 1e-9)
  })
  it('one source, single probe: rising crossings once per period; no retrigger while above', () => {
    const m = new WaveFieldModel({ ...DEFAULT_WAVEFIELD_PARAMS, sourceCount: 1, ratios: [1], sourceRadius: 0, baseRate: 1, threshold: 0.5 })
    const c = ctx(1, { beatSeconds: 1, macros: { ...DEFAULT_MACROS_GLOBAL, chaos: 0, energy: 0.5, time: 0.5 } })
    m.inject({ degree: 0, octave: 1, velocity: 1 }, c, 0)
    const ev = run(m, 4.2, c)
    const up = ev.filter((e) => e.type === 'thresholdCrossing' && e.direction === 1)
    expect(up.length).toBe(4)
    for (let i = 1; i < up.length; i++) expect(up[i].time - up[i - 1].time).toBeCloseTo(1, 1)
    expect(ev.filter((e) => e.type === 'extrema' && e.kind === 'max').length).toBe(4)
    expect(ev.filter((e) => e.type === 'nullCrossing').length).toBeGreaterThan(0)
  })
})

describe('coupled oscillators', () => {
  it('order parameter', () => {
    expect(orderParameter([0, 0, 0]).R).toBeCloseTo(1)
    expect(orderParameter([0, Math.PI]).R).toBeCloseTo(0)
  })
  it('strong coupling increases synchronisation; zero coupling does not', () => {
    const sim = (K: number) => {
      const m = new CoupledModel({ ...DEFAULT_COUPLED_PARAMS, count: 8, coupling: K, spread: 0.3, drift: 0, phaseSpread: 1 })
      const c = ctx(5, { macros: { ...DEFAULT_MACROS_GLOBAL, chaos: 0 } })
      m.step(1 / 120, 0, c)
      const r0 = m.globals().R
      run(m, 12, c)
      return { r0, r1: m.globals().R }
    }
    const strong = sim(2.0)
    const none = sim(0)
    expect(strong.r1).toBeGreaterThan(0.85)
    expect(strong.r1).toBeGreaterThan(strong.r0)
    expect(none.r1).toBeLessThan(0.85)
  })
  it('emits phase crossings and a sync event', () => {
    const m = new CoupledModel({ ...DEFAULT_COUPLED_PARAMS, count: 6, coupling: 2, spread: 0.2, drift: 0, syncThreshold: 0.8 })
    const c = ctx(9, { macros: { ...DEFAULT_MACROS_GLOBAL, chaos: 0 } })
    const ev = run(m, 10, c)
    expect(ev.filter((e) => e.type === 'phaseCrossing').length).toBeGreaterThan(6)
    expect(ev.some((e) => e.type === 'sync' && e.direction === 1)).toBe(true)
  })
  it('is deterministic', () => {
    const mk = () => new CoupledModel({ ...DEFAULT_COUPLED_PARAMS, drift: 0.2 })
    const a = mk(), b = mk()
    const ea = run(a, 5, ctx(11)), eb = run(b, 5, ctx(11))
    expect(ea.map((e) => [e.time, e.bodyId])).toEqual(eb.map((e) => [e.time, e.bodyId]))
  })
})

describe('chaos', () => {
  it('logistic step stays in (0,1)', () => {
    let x = 0.3
    for (let i = 0; i < 1000; i++) {
      x = logisticStep(x, 4)
      expect(x).toBeGreaterThan(0)
      expect(x).toBeLessThan(1)
    }
    expect(logisticStep(NaN, 3.7)).toBe(0.5)
  })
  it('does not emit one event per iteration and is deterministic', () => {
    const mk = () => new ChaosModel({ ...DEFAULT_CHAOS_PARAMS, updateRate: 8, smoothing: 0.5 })
    const a = mk(), b = mk()
    const ca = ctx(2, { beatSeconds: 1 }), cb = ctx(2, { beatSeconds: 1 })
    a.inject({ degree: 0, octave: 1, velocity: 1 }, ca)
    b.inject({ degree: 0, octave: 1, velocity: 1 }, cb)
    const ea = run(a, 10, ca), eb = run(b, 10, cb)
    // 8 iterations/beat × 10 s ≈ 80 iterations; events must be fewer
    expect(ea.length).toBeGreaterThan(4)
    expect(ea.length).toBeLessThan(80)
    expect(ea.map((e) => [e.time, e.type, e.value])).toEqual(eb.map((e) => [e.time, e.type, e.value]))
    for (const e of ea) {
      expect(e.current.value).toBeGreaterThanOrEqual(0)
      expect(e.current.value).toBeLessThanOrEqual(1)
    }
  })
  it('stable r=2.8 converges: no extrema after settling', () => {
    const m = new ChaosModel({ ...DEFAULT_CHAOS_PARAMS, r: 2.8, updateRate: 8, smoothing: 0 })
    const c = ctx(2, { beatSeconds: 1, macros: { ...DEFAULT_MACROS_GLOBAL, chaos: 0.5 } })
    m.inject({ degree: 0, octave: 1, velocity: 1 }, c)
    run(m, 10, c)
    const late = run(m, 5, c).filter((e) => e.type === 'extrema' && e.time > 12)
    expect(late.length).toBe(0)
  })
})
