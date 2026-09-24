import { describe, it, expect } from 'vitest'
import { DEFAULT_SPIRAL, emptyPattern, hitsAt, resizePattern, seedPattern, swingOffset, turnPattern, TRACKS } from '../src/engine/pattern'

const cfg = { ...DEFAULT_SPIRAL }

describe('spiral pattern', () => {
  it('turn 0 plays the figure as written', () => {
    const p = seedPattern('chain', 16)
    expect(turnPattern(p.kick, 'kick', 0, { ...cfg, rotate: 0 })).toEqual(p.kick)
  })

  it('rotation carries the figure around the spiral', () => {
    const p = emptyPattern(16)
    p.kick[0] = 1
    const t2 = turnPattern(p.kick, 'kick', 2, { ...cfg, drift: 0, rotate: 3 })
    expect(t2[6]).toBe(1)
    expect(t2[0]).toBe(0)
  })

  it('is deterministic: the same seed and turn give the same notes', () => {
    const p = seedPattern('dust', 16)
    const a = turnPattern(p.hat, 'hat', 3, cfg)
    const b = turnPattern(p.hat, 'hat', 3, cfg)
    expect(a).toEqual(b)
    const other = turnPattern(p.hat, 'hat', 3, { ...cfg, seed: cfg.seed + 1 })
    expect(other).not.toEqual(a)
  })

  it('drift 0 changes nothing but the rotation', () => {
    const p = seedPattern('liquid', 16)
    for (const t of TRACKS) {
      const still = turnPattern(p[t], t, 4, { ...cfg, drift: 0, rotate: 0 })
      expect(still).toEqual(p[t])
    }
  })

  it('drift moves and thins notes as the turns go out', () => {
    const p = seedPattern('dust', 16)
    const hard = { ...cfg, drift: 1 }
    let changed = 0
    for (let turn = 1; turn < 5; turn++) {
      if (JSON.stringify(turnPattern(p.hat, 'hat', turn, hard)) !== JSON.stringify(p.hat)) changed++
    }
    expect(changed).toBe(4)
  })

  it('the bed tracks drift less than the drums', () => {
    const p = emptyPattern(16)
    for (let i = 0; i < 16; i++) {
      p.air[i] = 1
      p.hat[i] = 1
    }
    const hard = { ...cfg, drift: 1, rotate: 0 }
    const count = (row: number[]) => row.filter((v) => v > 0).length
    let air = 0
    let hat = 0
    for (let turn = 1; turn < 8; turn++) {
      air += count(turnPattern(p.air, 'air', turn, hard))
      hat += count(turnPattern(p.hat, 'hat', turn, hard))
    }
    expect(air).toBeGreaterThan(hat)
  })

  it('density gates hits without editing the pattern', () => {
    const p = seedPattern('chain', 16)
    const all = hitsAt(p, 0, 0, { ...cfg, density: 1 })
    const none = hitsAt(p, 0, 0, { ...cfg, density: 0 })
    expect(all.length).toBeGreaterThan(0)
    expect(none.length).toBe(0)
  })

  it('hits carry their position along the whole spiral', () => {
    const p = emptyPattern(16)
    p.kick[0] = 1
    const c = { ...cfg, drift: 0, rotate: 0, density: 1, turns: 4 }
    expect(hitsAt(p, 0, 0, c)[0].spiral).toBe(0)
    expect(hitsAt(p, 0, 2, c)[0].spiral).toBeCloseTo(0.5, 5)
  })

  it('swing delays the odd steps only', () => {
    expect(swingOffset(0, 0.5, 0.1)).toBe(0)
    expect(swingOffset(1, 0.5, 0.1)).toBeCloseTo(0.025, 6)
    expect(swingOffset(1, 0, 0.1)).toBe(0)
  })

  it('resizing keeps notes on their musical position', () => {
    const p = emptyPattern(16)
    p.kick[0] = 1
    p.kick[8] = 1
    const wide = resizePattern(p, 16, 24)
    expect(wide.kick[0]).toBe(1)
    expect(wide.kick[12]).toBe(1)
    expect(wide.kick.filter((v) => v > 0).length).toBe(2)
  })

  it('every factory kit seeds a playable figure', () => {
    for (const k of ['chain', 'dust', 'grain', 'liquid']) {
      const p = seedPattern(k, 16)
      const total = TRACKS.reduce((n, t) => n + p[t].filter((v) => v > 0).length, 0)
      expect(total).toBeGreaterThan(6)
    }
  })
})
