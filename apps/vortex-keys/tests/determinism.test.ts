import { describe, it, expect } from 'vitest'
import { createFlow } from '../src/engine/flowFactory'
import { FACTORY_PRESETS } from '../src/preset/presets'
import { createPrng, deriveSeed, getScale } from '@el-systema/core'

/** Same state + same seed + same input => same generated structure, for every factory preset. */
describe('VORTEX KEYS determinism', () => {
  const play = (name: string) => {
    const p = FACTORY_PRESETS.find((x) => x.name === name)!
    const flow = createFlow(p.flow, p.tuning.octaves)
    const ctx = { scaleLength: getScale(p.tuning.scaleId).cents.length, beatSeconds: 60 / p.time.bpm, amount: p.flow.amount, prng: createPrng(deriveSeed(p.flow.seed, 'vortex-keys')) }
    const out: string[] = []
    const dt = 1 / 120
    for (let t = 0; t < 6; t += dt) {
      if (t === 0 || Math.abs(t - 1) < dt / 2 || Math.abs(t - 2.5) < dt / 2) flow.inject({ degree: Math.round(t) % 5, octave: 1, velocity: 0.8, time: t }, ctx)
      for (const e of flow.update(dt, t, ctx)) out.push(`${e.time.toFixed(4)}:${e.note.degree}/${e.note.octave}:${e.velocity.toFixed(4)}`)
    }
    return out
  }
  it('reproduces every factory preset', () => {
    for (const p of FACTORY_PRESETS) {
      const a = play(p.name)
      const b = play(p.name)
      expect(a).toEqual(b)
    }
  })
  it('generates something for the generative presets', () => {
    expect(play('Tight Vortex').length).toBeGreaterThan(0)
    expect(play('Elliptic Pulse').length).toBeGreaterThan(0)
    expect(play('Gathering Pulse').length).toBeGreaterThan(0)
  })
})
