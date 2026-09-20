import { describe, it, expect } from 'vitest'
import { GravityModel, DEFAULT_GRAVITY_PARAMS, defaultGates, DEFAULT_MACROS_GLOBAL, type PhysicsEvent } from '../src'
import { createPrng } from '@el-systema/core'

describe('physics event serialization', () => {
  it('semantic events survive JSON round trip (bus / OSC ready)', () => {
    const m = new GravityModel({ ...DEFAULT_GRAVITY_PARAMS, gates: defaultGates(2), turbulence: 0, spin: 1, tempoInfluence: 0, pull: 0, alpha: 0 })
    const ctx = { scaleLength: 5, octaves: 4, beatSeconds: 0.5, amount: 1, prng: createPrng(1), macros: { ...DEFAULT_MACROS_GLOBAL } }
    m.inject({ degree: 0, octave: 1, velocity: 1 }, ctx, 0)
    let ev: PhysicsEvent[] = []
    for (let t = 0; t < 1 && !ev.length; t += 1 / 120) ev = m.step(1 / 120, t, ctx)
    expect(ev.length).toBeGreaterThan(0)
    const back = JSON.parse(JSON.stringify(ev[0])) as PhysicsEvent
    expect(back.type).toBe('gateCrossing')
    expect(back.current.radius).toBeCloseTo(ev[0].current.radius)
    expect(back.gate?.action).toBe(ev[0].gate?.action)
    expect(Object.values(back.current).every((v) => typeof v !== 'number' || Number.isFinite(v))).toBe(true)
  })
})
