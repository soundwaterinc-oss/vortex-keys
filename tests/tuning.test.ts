import { describe, it, expect } from 'vitest'
import { noteToFrequency, wrapDegree, transposeNote, indexToNote, ratioStringToCents, noteToCents } from '../src/core/tuning/tuning'
import { getScale, SCALES } from '../src/core/tuning/scales'

describe('tuning', () => {
  const tet = getScale('12tet')
  it('cents -> frequency', () => {
    expect(noteToFrequency(tet, 261.63, { degree: 0, octave: 0 })).toBeCloseTo(261.63, 5)
    expect(noteToFrequency(tet, 261.63, { degree: 0, octave: 1 })).toBeCloseTo(523.26, 5)
    expect(noteToFrequency(tet, 440, { degree: 7, octave: 0 })).toBeCloseTo(659.255, 2)
  })
  it('just intonation fifth is 3/2', () => {
    const ji = getScale('ji-major')
    expect(noteToFrequency(ji, 200, { degree: 4, octave: 0 })).toBeCloseTo(300, 6)
    expect(ratioStringToCents('3/2')).toBeCloseTo(701.955, 3)
  })
  it('wraps degrees into octaves', () => {
    expect(wrapDegree(5, 0, 5)).toEqual({ degree: 0, octave: 1 })
    expect(wrapDegree(-1, 1, 5)).toEqual({ degree: 4, octave: 0 })
    expect(wrapDegree(12, 0, 5)).toEqual({ degree: 2, octave: 2 })
  })
  it('transposes by scale degree, not semitone', () => {
    const pent = getScale('penta-major')
    const n = pent.cents.length
    const up = transposeNote({ degree: 4, octave: 0 }, 1, 0, n)
    expect(up).toEqual({ degree: 0, octave: 1 })
    expect(noteToCents(pent, up)).toBe(1200)
    expect(transposeNote({ degree: 0, octave: 2 }, -1, 0, n)).toEqual({ degree: 4, octave: 1 })
    expect(transposeNote({ degree: 2, octave: 0 }, 0, 1, n)).toEqual({ degree: 2, octave: 1 })
  })
  it('index <-> note', () => {
    expect(indexToNote(7, 5)).toEqual({ degree: 2, octave: 1 })
  })
  it('non-octave period (Bohlen-Pierce) uses tritave', () => {
    const bp = getScale('bohlen-pierce')
    expect(noteToFrequency(bp, 100, { degree: 0, octave: 1 })).toBeCloseTo(300, 1)
  })
  it('all scales have monotonic cents starting at 0', () => {
    for (const s of SCALES) {
      expect(s.cents[0]).toBe(0)
      for (let i = 1; i < s.cents.length; i++) expect(s.cents[i]).toBeGreaterThan(s.cents[i - 1])
      expect(s.cents[s.cents.length - 1]).toBeLessThan(s.period ?? 1200)
    }
  })
})
