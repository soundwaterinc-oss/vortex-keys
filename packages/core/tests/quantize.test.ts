import { describe, it, expect } from 'vitest'
import { quantizeTime, quantizeStepBeats } from '../src/time/quantize'

describe('quantize', () => {
  it('FREE leaves time untouched', () => {
    expect(quantizeTime(1.2345, 'free', '1/16', 120)).toBe(1.2345)
  })
  it('HARD snaps to next grid point at 120bpm 1/8 (0.25s)', () => {
    expect(quantizeTime(1.01, 'hard', '1/8', 120)).toBeCloseTo(1.25)
    expect(quantizeTime(1.25, 'hard', '1/8', 120)).toBeCloseTo(1.25)
  })
  it('SOFT moves halfway to nearest', () => {
    expect(quantizeTime(1.1, 'soft', '1/4', 120, 0, 0.5)).toBeCloseTo(1.05)
  })
  it('triplet steps', () => {
    expect(quantizeStepBeats('1/8T')).toBeCloseTo(1 / 3)
    expect(quantizeStepBeats('1/16T')).toBeCloseTo(1 / 6)
  })
})
