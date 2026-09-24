import { describe, it, expect } from 'vitest'
import { axesAt, DEFAULT_SPIRAL, emptyPattern, hitsAt, resizePattern, seedPattern, swingOffset, trackLength, turnPattern, TRACKS } from '../src/engine/pattern'

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
    const all = hitsAt(p, 0, { ...cfg, density: 1 })
    const none = hitsAt(p, 0, { ...cfg, density: 0 })
    expect(all.length).toBeGreaterThan(0)
    expect(none.length).toBe(0)
  })

  it('hits carry their position along the whole spiral', () => {
    const p = emptyPattern(16)
    p.kick[0] = 1
    const c = { ...cfg, drift: 0, rotate: 0, density: 1, turns: 4, poly: 0 }
    expect(hitsAt(p, 0, c)[0].spiral).toBe(0)
    expect(hitsAt(p, 32, c)[0].spiral).toBeCloseTo(0.5, 5)
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

  it('poly gives each track its own cycle length, and the kick keeps the bar', () => {
    const none = { ...cfg, poly: 0 }
    for (const t of TRACKS) expect(trackLength(t, none)).toBe(16)
    const wide = { ...cfg, poly: 1 }
    expect(trackLength('kick', wide)).toBe(16)
    const lengths = new Set(TRACKS.map((t) => trackLength(t, wide)))
    expect(lengths.size).toBeGreaterThan(3)
  })

  it('a polymetric track precesses: the same note falls on a different step each bar', () => {
    const p = emptyPattern(16)
    p.hat[0] = 1
    const c = { ...cfg, drift: 0, rotate: 0, density: 1, poly: 1 }
    const len = trackLength('hat', c)
    expect(len).not.toBe(16)
    // it sounds every `len` steps, so against a 16-step bar it walks
    const bars = [0, 1, 2, 3].map((bar) => {
      for (let i = 0; i < 16; i++) if (hitsAt(p, bar * 16 + i, c).some((h) => h.track === 'hat')) return i
      return -1
    })
    expect(new Set(bars).size).toBeGreaterThan(1)
  })

  it('the axes turn on different periods, so they do not move together', () => {
    const c = { ...cfg, warp: 1, bend: 1, fold: 1 }
    const at = (turn: number) => axesAt(turn * c.stepsPerTurn, c)
    // warp is itself two components (3 and 4.5 turns), so it only comes back
    // after 9 turns — not after 3, and never with the other axes
    expect(Math.abs(at(3).warp - at(0).warp)).toBeGreaterThan(0.05)
    expect(at(9).warp).toBeCloseTo(at(0).warp, 6)
    expect(Math.abs(at(9).bend - at(0).bend)).toBeGreaterThan(20)
    expect(Math.abs(at(3).bend - at(0).bend)).toBeGreaterThan(20)
    expect(at(5).bend).toBeCloseTo(at(0).bend, 4)
    expect(Math.abs(at(5).fold - at(0).fold)).toBeGreaterThan(0.05)
  })

  it('the axes leave the ground alone: the kick bends least', () => {
    const p = emptyPattern(16)
    p.kick[4] = 1
    p.perc[4] = 1
    const c = { ...cfg, drift: 0, rotate: 0, density: 1, poly: 0, bend: 1, warp: 1 }
    // step 4 of some turn where the bend axis is away from zero
    for (let i = 4; i < 16 * 8; i += 16) {
      const hs = hitsAt(p, i, c)
      const kick = hs.find((h) => h.track === 'kick')
      const perc = hs.find((h) => h.track === 'perc')
      if (kick && perc && Math.abs(perc.bend) > 1) {
        expect(Math.abs(kick.bend)).toBeLessThan(Math.abs(perc.bend))
        expect(Math.abs(kick.warp)).toBeLessThan(Math.abs(perc.warp) + 1e-9)
        return
      }
    }
    throw new Error('no turn found with an active bend axis')
  })

  it('every factory kit seeds a playable figure', () => {
    for (const k of ['chain', 'dust', 'grain', 'liquid']) {
      const p = seedPattern(k, 16)
      const total = TRACKS.reduce((n, t) => n + p[t].filter((v) => v > 0).length, 0)
      expect(total).toBeGreaterThan(6)
    }
  })
})
