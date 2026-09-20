import { describe, it, expect } from 'vitest'
import { createPrng, hashSeed } from '../src/core/math/prng'
import { crossedAngle, wrapAngle } from '../src/core/math/util'

describe('prng', () => {
  it('is deterministic for a seed', () => {
    const a = createPrng(42)
    const b = createPrng(42)
    const xs = Array.from({ length: 20 }, () => a.next())
    const ys = Array.from({ length: 20 }, () => b.next())
    expect(xs).toEqual(ys)
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true)
  })
  it('differs for different seeds', () => {
    expect(createPrng(1).next()).not.toBe(createPrng(2).next())
  })
  it('hashes strings to a seed', () => {
    expect(hashSeed('vortex')).toBe(hashSeed('vortex'))
    expect(hashSeed('vortex')).not.toBe(hashSeed('keys'))
  })
})

describe('crossedAngle', () => {
  it('detects forward crossing', () => {
    expect(crossedAngle(0.1, 0.3, 0.2)).toBe(true)
    expect(crossedAngle(0.1, 0.3, 0.4)).toBe(false)
  })
  it('detects crossing across the 0/2π seam', () => {
    expect(crossedAngle(6.2, 0.1, 0)).toBe(true)
    expect(crossedAngle(6.2, 0.1, 6.25)).toBe(true)
    expect(crossedAngle(6.2, 0.1, 3)).toBe(false)
  })
  it('detects backward crossing', () => {
    expect(crossedAngle(0.3, 0.1, 0.2)).toBe(true)
    expect(crossedAngle(0.1, 6.2, 0)).toBe(true)
  })
  it('no crossing when stationary', () => {
    expect(crossedAngle(1, 1, 1)).toBe(false)
  })
  it('wrapAngle', () => {
    expect(wrapAngle(-0.5)).toBeCloseTo(Math.PI * 2 - 0.5)
    expect(wrapAngle(Math.PI * 4 + 1)).toBeCloseTo(1)
  })
})
