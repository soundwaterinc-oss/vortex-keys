import { describe, it, expect } from 'vitest'
import { VortexModel, DEFAULT_VORTEX_PARAMS } from '../src/core/flow/vortex'
import { applyGate, defaultGates, type Gate } from '../src/core/flow/gates'
import { createPrng } from '../src/core/math/prng'
import type { FlowContext } from '../src/core/flow/types'

const ctx = (seed = 1, amount = 1): FlowContext => ({ scaleLength: 5, beatSeconds: 0.5, amount, prng: createPrng(seed) })

function run(model: VortexModel, seconds: number, c: FlowContext) {
  const dt = 1 / 120
  const events = []
  for (let t = 0; t < seconds; t += dt) events.push(...model.update(dt, t, c))
  return events
}

describe('gates', () => {
  it('transposes by scale degree', () => {
    const g = (action: Gate['action']): Gate => ({ id: 'x', angle: 0, action, probability: 1, enabled: true })
    expect(applyGate(g('degreeUp'), { degree: 4, octave: 0 }, 0.5, 5).note).toEqual({ degree: 0, octave: 1 })
    expect(applyGate(g('degreeDown'), { degree: 0, octave: 1 }, 0.5, 5).note).toEqual({ degree: 4, octave: 0 })
    expect(applyGate(g('octaveUp'), { degree: 2, octave: 0 }, 0.5, 5).note).toEqual({ degree: 2, octave: 1 })
    expect(applyGate(g('velocityDown'), { degree: 2, octave: 0 }, 1, 5).velocity).toBeCloseTo(0.7)
    expect(applyGate(g('spawnChild'), { degree: 2, octave: 0 }, 1, 5).spawnChild).toBe(true)
  })
  it('defaultGates spreads evenly', () => {
    const gs = defaultGates(4)
    expect(gs.map((g) => g.angle)).toEqual([0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2])
  })
})

describe('vortex', () => {
  it('spawns a particle for an injected note and it decays', () => {
    const m = new VortexModel({ ...DEFAULT_VORTEX_PARAMS, gates: [], turbulence: 0 })
    const c = ctx()
    m.inject({ degree: 2, octave: 1, velocity: 0.8, time: 0 }, c)
    expect(m.particles.length).toBe(1)
    const e0 = m.particles[0].energy
    run(m, 1, c)
    expect(m.particles[0].energy).toBeLessThan(e0)
    expect(m.particles[0].energy).toBeCloseTo(Math.pow(DEFAULT_VORTEX_PARAMS.decay, 1), 1)
  })
  it('fires gates when crossing and transposes', () => {
    const gates = defaultGates(1, ['degreeUp'])
    const m = new VortexModel({ ...DEFAULT_VORTEX_PARAMS, gates, turbulence: 0, spin: 1, tempoInfluence: 0, pull: 0, decay: 1 })
    const c = ctx()
    m.inject({ degree: 0, octave: 0, velocity: 1, time: 0 }, c) // spawns at -π/2
    const events = run(m, 1.5, c) // 1 rev/s -> crosses angle 0 at t≈0.25, 1.25
    expect(events.length).toBe(2)
    expect(events[0].note).toEqual({ degree: 1, octave: 0 })
    expect(events[1].note).toEqual({ degree: 2, octave: 0 })
    expect(events[0].time).toBeCloseTo(0.25, 1)
    expect(events[1].time).toBeCloseTo(1.25, 1)
  })
  it('is deterministic for the same seed with turbulence', () => {
    const mk = () => new VortexModel({ ...DEFAULT_VORTEX_PARAMS, gates: defaultGates(4), turbulence: 0.5 })
    const a = mk(), b = mk()
    const ca = ctx(7), cb = ctx(7)
    a.inject({ degree: 1, octave: 1, velocity: 0.9, time: 0 }, ca)
    b.inject({ degree: 1, octave: 1, velocity: 0.9, time: 0 }, cb)
    const ea = run(a, 4, ca), eb = run(b, 4, cb)
    expect(ea.length).toBeGreaterThan(0)
    expect(ea.map((e) => [e.time, e.note.degree, e.velocity])).toEqual(eb.map((e) => [e.time, e.note.degree, e.velocity]))
  })
  it('particles die when energy is low, pulled into core, or too old', () => {
    const m = new VortexModel({ ...DEFAULT_VORTEX_PARAMS, gates: [], turbulence: 0, decay: 0.3, pull: 0 })
    const c = ctx()
    m.inject({ degree: 0, octave: 0, velocity: 1, time: 0 }, c)
    run(m, 5, c)
    expect(m.particles.filter((p) => p.alive).length).toBe(0)
    const m2 = new VortexModel({ ...DEFAULT_VORTEX_PARAMS, gates: [], turbulence: 0, decay: 1, pull: 0.5 })
    m2.inject({ degree: 0, octave: 0, velocity: 1, time: 0 }, c)
    run(m2, 3, c)
    expect(m2.particles.filter((p) => p.alive).length).toBe(0)
  })
  it('limits particles and events per second', () => {
    const m = new VortexModel({
      ...DEFAULT_VORTEX_PARAMS,
      gates: defaultGates(8, ['spawnChild']),
      maxParticles: 5,
      maxEventsPerSecond: 3,
      turbulence: 0,
      spin: 4,
      tempoInfluence: 0,
      decay: 1,
      pull: 0,
    })
    const c = ctx()
    for (let i = 0; i < 20; i++) m.inject({ degree: i % 5, octave: 0, velocity: 1, time: 0 }, c)
    expect(m.particles.length).toBe(5)
    const events = run(m, 2, c)
    expect(m.particles.filter((p) => p.alive).length).toBeLessThanOrEqual(5)
    expect(events.length).toBeLessThanOrEqual(3 * 2 + 1)
  })
  it('does not spawn when amount is 0', () => {
    const m = new VortexModel({ ...DEFAULT_VORTEX_PARAMS, gates: [] })
    m.inject({ degree: 0, octave: 0, velocity: 1, time: 0 }, ctx(1, 0))
    expect(m.particles.length).toBe(0)
  })
  it('freeze stops motion', () => {
    const m = new VortexModel({ ...DEFAULT_VORTEX_PARAMS, gates: [], turbulence: 0 })
    const c = ctx()
    m.inject({ degree: 0, octave: 0, velocity: 1, time: 0 }, c)
    m.setFrozen(true)
    const a = m.particles[0].angle
    run(m, 1, c)
    expect(m.particles[0].angle).toBe(a)
  })
})
