import { describe, it, expect } from 'vitest'
import { sanitizePreset, FACTORY_PRESETS, defaultPreset } from '../src/preset/presets'

describe('presets', () => {
  it('factory presets survive a JSON round trip unchanged', () => {
    for (const p of FACTORY_PRESETS) {
      const back = sanitizePreset(JSON.parse(JSON.stringify(p)))
      expect(back).toEqual(p)
    }
  })
  it('sanitizer clamps garbage and unknown mapping ids', () => {
    const p = sanitizePreset({ tuning: { rootHz: 'NaN', octaves: 99 }, time: { bpm: -5 }, flow: { vortex: { spin: Infinity }, mappingId: 'nope', chaos: { r: 9 } } })
    expect(p.tuning.rootHz).toBe(defaultPreset().tuning.rootHz)
    expect(p.tuning.octaves).toBe(6)
    expect(p.time.bpm).toBe(20)
    expect(p.flow.vortex.spin).toBe(defaultPreset().flow.vortex.spin)
    expect(p.flow.mappingId).toBe(defaultPreset().flow.mappingId)
    expect(p.flow.chaos.r).toBe(4)
  })
})
