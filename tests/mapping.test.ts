import { describe, it, expect } from 'vitest'
import { ConfigurableMapper } from '../src/core/mapping/mapper'
import { getMapping, MAPPING_PRESETS } from '../src/core/mapping/presets'
import type { MappingContext } from '../src/core/mapping/types'
import type { PhysicsEvent, PhysicsSnapshot } from '../src/core/physics/types'
import { emptySnapshot } from '../src/core/physics/types'
import { degreeAngle } from '../src/core/physics/frame'
import { PhysicsFlow } from '../src/core/flow/physicsFlow'
import { GravityModel, DEFAULT_GRAVITY_PARAMS } from '../src/core/physics/gravity'
import { ChaosModel, DEFAULT_CHAOS_PARAMS } from '../src/core/physics/chaos'
import { defaultGates } from '../src/core/flow/gates'
import { createPrng } from '../src/core/math/prng'
import { DEFAULT_MACROS_GLOBAL } from '../src/core/physics/types'

const snap = (o: Partial<PhysicsSnapshot>): PhysicsSnapshot => ({ ...emptySnapshot(), ...o })
const mctx = (event: Partial<PhysicsEvent>, o: Partial<MappingContext> = {}): MappingContext => ({
  scaleLength: 5,
  octaves: 4,
  identity: { degree: 1, octave: 1, velocity: 1 },
  globals: {},
  amount: 1,
  beatSeconds: 0.5,
  event: { type: 'gateCrossing', time: 0, bodyId: 'x', prev: snap({}), current: snap({}), ...event },
  ...o,
})

describe('mapper', () => {
  it('angle -> degree, radius -> octave (Spiral Melody)', () => {
    const m = new ConfigurableMapper(getMapping('spiral-melody'))
    const s = snap({ angle: degreeAngle(3, 5), radius: 1 })
    const p = m.mapPitch(s, mctx({}))!
    expect(p.degree).toBe(3)
    expect(p.octave).toBe(2) // identity oct 1 + span 2 * r 1 − floor(2/2)
    const inner = m.mapPitch(snap({ angle: degreeAngle(3, 5), radius: 0 }), mctx({}))!
    expect(inner.octave).toBe(0)
  })
  it('gate pitch source mutates identity by scale degree and requests children', () => {
    const m = new ConfigurableMapper(getMapping('gravity-bass'))
    const c = mctx({ gate: { id: 'g', angle: 0, action: 'degreeUp', probability: 1, enabled: true } })
    m.mapPitch(snap({ radius: 0.5 }), c)
    expect(c.identity.degree).toBe(2)
    const c2 = mctx({ gate: { id: 'g', angle: 0, action: 'spawnChild', probability: 1, enabled: true } })
    m.mapPitch(snap({}), c2)
    expect(c2.requestChild).toBe(true)
  })
  it('velocity from energy with curve, accent on listed events, scaled by FLOW', () => {
    const m = new ConfigurableMapper({ ...getMapping('spiral-melody'), accentOn: ['periapsis'] })
    const v1 = m.mapVelocity(snap({ energy: 1 }), mctx({}))
    const v0 = m.mapVelocity(snap({ energy: 0 }), mctx({}))
    expect(v1).toBeGreaterThan(v0)
    const acc = m.mapVelocity(snap({ energy: 1 }), mctx({ type: 'periapsis' }))
    expect(acc).toBeGreaterThanOrEqual(v1)
    const low = m.mapVelocity(snap({ energy: 1 }), mctx({}, { amount: 0.1 }))
    expect(low).toBeLessThan(v1)
  })
  it('sync narrows the pitch range and width', () => {
    const m = new ConfigurableMapper(getMapping('swarm-pulse'))
    const wide = m.mapPitch(snap({}), mctx({}, { identity: { degree: 4, octave: 1, velocity: 1 }, globals: { R: 0 } }))!
    const narrow = m.mapPitch(snap({}), mctx({}, { identity: { degree: 4, octave: 1, velocity: 1 }, globals: { R: 1 } }))!
    expect(wide.degree).toBe(4)
    expect(narrow.degree).toBe(0)
    expect(m.mapTimbre(snap({}), mctx({}, { globals: { R: 1 } })).width).toBeLessThan(m.mapTimbre(snap({}), mctx({}, { globals: { R: 0 } })).width)
  })
  it('shouldTrigger follows triggerOn', () => {
    const m = new ConfigurableMapper(getMapping('chaotic-melody'))
    expect(m.shouldTrigger(snap({}), snap({}), mctx({ type: 'extrema' }))).toBe(true)
    expect(m.shouldTrigger(snap({}), snap({}), mctx({ type: 'nullCrossing' }))).toBe(false)
  })
  it('every preset yields in-range pitches for any snapshot', () => {
    for (const cfg of MAPPING_PRESETS) {
      const m = new ConfigurableMapper(cfg)
      for (const r of [0, 0.3, 1]) {
        const p = m.mapPitch(snap({ radius: r, value: r, angle: r * 6 }), mctx({}))!
        expect(p.degree).toBeGreaterThanOrEqual(0)
        expect(p.degree).toBeLessThan(5)
        expect(p.octave).toBeGreaterThanOrEqual(0)
        expect(p.octave).toBeLessThan(4)
      }
    }
  })
})

describe('PhysicsFlow', () => {
  const fctx = (seed = 1) => ({ scaleLength: 5, beatSeconds: 0.5, amount: 1, prng: createPrng(seed) })
  it('gravity + gravity-bass produces notes that follow gate transposition', () => {
    const phys = new GravityModel({ ...DEFAULT_GRAVITY_PARAMS, gates: defaultGates(1, ['degreeUp']), turbulence: 0, spin: 1, tempoInfluence: 0, pull: 0, decay: 1, alpha: 0 })
    const flow = new PhysicsFlow(phys, new ConfigurableMapper({ ...getMapping('gravity-bass'), registerSource: 'none' }), { ...DEFAULT_MACROS_GLOBAL })
    const c = fctx()
    flow.inject({ degree: 0, octave: 1, velocity: 1, time: 0 }, c)
    const out = []
    for (let t = 0; t < 2; t += 1 / 120) out.push(...flow.update(1 / 120, t, c))
    expect(out.map((e) => e.note.degree)).toEqual([1, 2])
    expect(out[0].note.octave).toBe(1)
  })
  it('same physics with a different mapping gives different music', () => {
    const mk = (id: string) => {
      const phys = new ChaosModel({ ...DEFAULT_CHAOS_PARAMS, updateRate: 6 })
      const flow = new PhysicsFlow(phys, new ConfigurableMapper(getMapping(id)), { ...DEFAULT_MACROS_GLOBAL })
      const c = fctx(3)
      flow.inject({ degree: 2, octave: 1, velocity: 1, time: 0 }, c)
      const out = []
      for (let t = 0; t < 8; t += 1 / 120) out.push(...flow.update(1 / 120, t, c))
      return out
    }
    const a = mk('chaotic-melody')
    const b = mk('spiral-melody')
    expect(a.length).toBeGreaterThan(3)
    expect(a.map((e) => e.note.degree).join()).not.toEqual(b.map((e) => e.note.degree).join())
  })
  it('enforces per-second and per-step limits and reports drops', () => {
    const phys = new GravityModel({ ...DEFAULT_GRAVITY_PARAMS, gates: defaultGates(12, ['repeat']), turbulence: 0, spin: 3, tempoInfluence: 0, pull: 0, decay: 1, alpha: 0, energyLoss: 0 })
    const flow = new PhysicsFlow(phys, new ConfigurableMapper(getMapping('accelerating-spiral')), { ...DEFAULT_MACROS_GLOBAL }, { maxEventsPerSecond: 5, maxEventsPerStep: 2 })
    const c = fctx()
    for (let i = 0; i < 10; i++) flow.inject({ degree: i % 5, octave: 1, velocity: 1, time: 0 }, c)
    const out = []
    for (let t = 0; t < 2; t += 1 / 120) out.push(...flow.update(1 / 120, t, c))
    expect(out.length).toBeLessThanOrEqual(5 * 2 + 2)
    expect(flow.stats(2).droppedLastSecond).toBeGreaterThan(0)
  })
})
