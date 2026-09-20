import { describe, it, expect } from 'vitest'
import { sanitizePreset, FACTORY_PRESETS, defaultPreset } from '../src/core/preset/presets'

describe('presets', () => {
  it('factory presets survive a JSON round trip unchanged', () => {
    for (const p of FACTORY_PRESETS) {
      const back = sanitizePreset(JSON.parse(JSON.stringify(p)))
      expect(back).toEqual(p)
    }
  })
  it('sanitizer clamps garbage', () => {
    const p = sanitizePreset({ tuning: { rootHz: 'NaN', octaves: 99 }, time: { bpm: -5 }, flow: { vortex: { spin: Infinity } } })
    expect(p.tuning.rootHz).toBe(defaultPreset().tuning.rootHz)
    expect(p.tuning.octaves).toBe(6)
    expect(p.time.bpm).toBe(20)
    expect(p.flow.vortex.spin).toBe(defaultPreset().flow.vortex.spin)
  })
})
