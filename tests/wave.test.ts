import { describe, it, expect } from 'vitest'
import { WaveModel, DEFAULT_WAVE_PARAMS, waveSum, crossedThreshold, componentsFromRatios } from '../src/core/flow/wave'
import { createPrng } from '../src/core/math/prng'
import type { FlowContext } from '../src/core/flow/types'

const ctx = (): FlowContext => ({ scaleLength: 5, beatSeconds: 1, amount: 1, prng: createPrng(1) })

describe('wave', () => {
  it('threshold crossing detection', () => {
    expect(crossedThreshold(0.2, 0.6, 0.5, 'rising')).toBe(true)
    expect(crossedThreshold(0.6, 0.2, 0.5, 'rising')).toBe(false)
    expect(crossedThreshold(0.6, 0.2, 0.5, 'falling')).toBe(true)
    expect(crossedThreshold(0.6, 0.7, 0.5, 'both')).toBe(false)
  })
  it('waveSum is normalised to [-1, 1]', () => {
    const comps = componentsFromRatios([3, 4, 5])
    for (let t = 0; t < 10; t += 0.01) {
      const v = waveSum(comps, 1, t)
      expect(Math.abs(v)).toBeLessThanOrEqual(1 + 1e-9)
    }
  })
  it('single sine at 1 cycle/beat triggers once per beat on rising crossings', () => {
    const m = new WaveModel({ ...DEFAULT_WAVE_PARAMS, baseRate: 1, components: [{ ratio: 1, amplitude: 1, phase: 0 }, { ratio: 1, amplitude: 0, phase: 0 }], threshold: 0.5, direction: 'rising' })
    const c = ctx()
    m.inject({ degree: 2, octave: 1, velocity: 0.8, time: 0 }, c)
    const events = []
    const dt = 1 / 120
    for (let t = 0; t < 4; t += dt) events.push(...m.update(dt, t, c))
    expect(events.length).toBe(4)
    for (let i = 1; i < events.length; i++) expect(events[i].time - events[i - 1].time).toBeCloseTo(1, 1)
    expect(events[0].note).toEqual({ degree: 2, octave: 1 })
  })
  it('does not fire without seed notes', () => {
    const m = new WaveModel({ ...DEFAULT_WAVE_PARAMS, baseRate: 2 })
    const c = ctx()
    let n = 0
    for (let t = 0; t < 2; t += 1 / 120) n += m.update(1 / 120, t, c).length
    expect(n).toBe(0)
  })
})
