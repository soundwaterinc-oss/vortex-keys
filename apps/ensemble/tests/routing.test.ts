import { describe, it, expect } from 'vitest'
import { EventBus, makeEvent, deriveEvent, continueEvent, MAX_EVENT_GENERATION, eventNamespace, resolvePitch, getScale, deriveSeed, type SystemEvent } from '@el-systema/core'
import { OrbitModel, DEFAULT_ORBIT_PARAMS, defaultGates, DEFAULT_MACROS_GLOBAL, type OrbitBody } from '@el-systema/physics'
import { createPrng } from '@el-systema/core'
import { Router, type NotePlayedPayload } from '../src/routing'

const note = (over: Partial<NotePlayedPayload> = {}): SystemEvent<NotePlayedPayload> =>
  makeEvent('vortex-keys', 'vortex.notePlayed', 0, { scaleDegree: 3, octave: 1, frequency: 440, velocity: 0.8, sourceId: 'k8', ...over })

describe('event namespaces and metadata', () => {
  it('namespace helper and namespace subscription', () => {
    expect(eventNamespace('orbit.gateCrossed')).toBe('orbit')
    const bus = new EventBus()
    const got: string[] = []
    bus.onNamespace('orbit.', (e) => got.push(e.type))
    bus.emit(makeEvent('orbit', 'orbit.periapsis', 0, {}))
    bus.emit(makeEvent('vortex-keys', 'vortex.notePlayed', 0, {}))
    expect(got).toEqual(['orbit.periapsis'])
  })
  it('root events are generation 0 with unique ids; derived events increment and link', () => {
    const a = makeEvent('vortex-keys', 'vortex.notePlayed', 0, {})
    const b = makeEvent('vortex-keys', 'vortex.notePlayed', 0, {})
    expect(a.meta.generation).toBe(0)
    expect(a.meta.eventId).not.toBe(b.meta.eventId)
    const d = deriveEvent(a, 'ensemble', 'ensemble.orbitSpawnRequested', 1, {})!
    expect(d.meta.generation).toBe(1)
    expect(d.meta.parentEventId).toBe(a.meta.eventId)
    expect(d.meta.origin).toBe('vortex-keys')
    const c = continueEvent(d.meta, 'orbit', 'orbit.gateCrossed', 2, {})
    expect(c.meta.generation).toBe(1) // same hop, not a new one
  })
  it('refuses chains deeper than MAX_EVENT_GENERATION', () => {
    let e: SystemEvent | null = makeEvent('a', 'a.x', 0, {})
    const hops: number[] = []
    for (let i = 0; i < 5 && e; i++) {
      e = deriveEvent(e, 'b', 'b.y', 0, {})
      if (e) hops.push(e.meta.generation)
    }
    expect(hops).toEqual([1, 2])
    expect(MAX_EVENT_GENERATION).toBe(2)
  })
})

describe('semantic pitch', () => {
  it('degree + octave resolve through the current tuning; identity survives a tuning change', () => {
    const id = { scaleDegree: 2, octave: 0 }
    const ji = resolvePitch(id, { scale: getScale('ji-major'), rootHz: 200 })
    const py = resolvePitch(id, { scale: getScale('pythagorean'), rootHz: 200 })
    expect(ji.frequency).toBeCloseTo(250) // 5/4
    expect(py.frequency).toBeCloseTo(253.125) // 81/64
    expect(ji.scaleDegree).toBe(py.scaleDegree)
  })
})

describe('VORTEX → ORBIT routing', () => {
  const mk = (seed = 1) => {
    const bus = new EventBus()
    const r = new Router(bus, seed, () => 0)
    r.attach()
    const out: SystemEvent[] = []
    bus.on('ensemble.orbitSpawnRequested', (e) => out.push(e))
    return { bus, r, out }
  }
  it('maps a played note to a spawn request preserving identity', () => {
    const { bus, out } = mk()
    bus.emit(note())
    expect(out.length).toBe(1)
    const p = out[0].payload as { scaleDegree: number; octave: number; velocity: number; energy: number }
    expect(p.scaleDegree).toBe(3)
    expect(p.octave).toBe(1)
    expect(p.velocity).toBe(0.8)
    expect(out[0].meta.generation).toBe(1)
  })
  it('routing disabled: nothing is requested', () => {
    const { bus, r, out } = mk()
    r.state = { ...r.state, vortexToOrbit: false }
    bus.emit(note())
    expect(out.length).toBe(0)
  })
  it('pitch follow off uses the tonic; velocity→energy amount clamps', () => {
    const { r } = mk()
    const a = r.buildRequest(note({ velocity: 1 }).payload, { ...r.state, pitchFollow: false, velocityToEnergy: 1 })
    expect(a.scaleDegree).toBe(0)
    expect(a.energy).toBe(1)
    const b = r.buildRequest(note({ velocity: 5 }).payload, { ...r.state, velocityToEnergy: 1 })
    expect(b.energy).toBeLessThanOrEqual(1)
    const c = r.buildRequest(note({ velocity: 0.1 }).payload, { ...r.state, velocityToEnergy: 0 })
    expect(c.energy).toBeCloseTo(0.5)
  })
  it('spawn amount is deterministic per seed', () => {
    const run = (seed: number) => {
      const { bus, r, out } = mk(seed)
      r.state = { ...r.state, spawnAmount: 0.5 }
      for (let i = 0; i < 20; i++) bus.emit(note())
      return out.length
    }
    expect(run(3)).toBe(run(3))
    expect(run(3)).toBeGreaterThan(2)
    expect(run(3)).toBeLessThan(18)
  })
  it('does not react to orbit.noteGenerated (no feedback)', () => {
    const { bus, out } = mk()
    bus.emit(makeEvent('orbit', 'orbit.noteGenerated', 0, { scaleDegree: 1, octave: 1, velocity: 1 }))
    expect(out.length).toBe(0)
  })
})

describe('orbit body creation from identity', () => {
  const ctx = (seed = 1) => ({ scaleLength: 7, octaves: 3, beatSeconds: 0.5, amount: 1, prng: createPrng(deriveSeed(seed, 'orbit')), macros: { ...DEFAULT_MACROS_GLOBAL, chaos: 0 } })
  const model = (max = 4) => new OrbitModel({ ...DEFAULT_ORBIT_PARAMS, gates: defaultGates(4, ['repeat']), drift: 0, keplerian: true, referenceAxis: 0.5, evictWhenFull: true, maxOrbiters: max })
  it('body keeps identity; larger orbit recurs more slowly (Kepler 3)', () => {
    const m = model()
    const c = ctx()
    const big = m.inject({ degree: 3, octave: 0, velocity: 1 }, c, 0, { orbitSize: 0.9 })!
    const small = m.inject({ degree: 3, octave: 2, velocity: 1 }, c, 0, { orbitSize: 0.3 })!
    expect(big.identity.degree).toBe(3)
    expect(small.orbit.orbitalSpeed).toBeGreaterThan(big.orbit.orbitalSpeed * 3)
  })
  it('gate crossings of a spawned body fire, timing follows orbit size', () => {
    const m = model()
    const c = ctx()
    const big = m.inject({ degree: 1, octave: 0, velocity: 1 }, c, 0, { orbitSize: 0.9 })!
    const small = m.inject({ degree: 2, octave: 2, velocity: 1 }, c, 0, { orbitSize: 0.3 })!
    let nBig = 0
    let nSmall = 0
    for (let t = 0; t < 8; t += 1 / 120) for (const e of m.step(1 / 120, t, c)) if (e.type === 'gateCrossing') e.bodyId === big.id ? nBig++ : e.bodyId === small.id ? nSmall++ : 0
    expect(nBig).toBeGreaterThan(0)
    expect(nSmall).toBeGreaterThan(nBig * 2)
  })
  it('body limit: evicts lowest-energy body deterministically', () => {
    const m = model(3)
    const c = ctx()
    const a = m.inject({ degree: 0, octave: 0, velocity: 1 }, c, 0, { energy: 0.9 })!
    const b = m.inject({ degree: 1, octave: 0, velocity: 1 }, c, 0, { energy: 0.2 })!
    const d = m.inject({ degree: 2, octave: 0, velocity: 1 }, c, 0, { energy: 0.6 })!
    m.inject({ degree: 3, octave: 0, velocity: 1 }, c, 0, { energy: 0.8 })
    const alive = (m.bodies() as OrbitBody[]).filter((x) => x.alive).map((x) => x.id)
    expect(alive.length).toBe(3)
    expect(alive).toContain(a.id)
    expect(alive).toContain(d.id)
    expect(alive).not.toContain(b.id)
  })
  it('same seed + same request → same orbital initial conditions', () => {
    const run = () => {
      const m = model()
      const c = { ...ctx(9), macros: { ...DEFAULT_MACROS_GLOBAL, chaos: 0.5 } }
      const b = m.inject({ degree: 4, octave: 1, velocity: 0.7 }, c, 0, { energy: 0.6 })!
      return [b.orbit.semiMajorAxis, b.orbit.eccentricity, b.orbit.orbitalSpeed, b.orbit.orientation]
    }
    expect(run()).toEqual(run())
  })
})
