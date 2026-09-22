import { describe, it, expect } from 'vitest'
import { noteToFrequency, wrapDegree, transposeNote, indexToNote, ratioStringToCents, noteToCents } from '../src/tuning/tuning'
import { getScale, SCALES } from '../src/tuning/scales'

describe('tuning', () => {
  const yo = getScale('yo')
  it('cents -> frequency', () => {
    expect(noteToFrequency(yo, 261.63, { degree: 0, octave: 0 })).toBeCloseTo(261.63, 5)
    expect(noteToFrequency(yo, 261.63, { degree: 0, octave: 1 })).toBeCloseTo(523.26, 5)
    expect(noteToFrequency(yo, 440, { degree: 3, octave: 0 })).toBeCloseTo(659.255, 2)
  })
  it('just intonation fifth is 3/2', () => {
    const ji = getScale('bhairav')
    expect(noteToFrequency(ji, 200, { degree: 4, octave: 0 })).toBeCloseTo(300, 6)
    expect(ratioStringToCents('3/2')).toBeCloseTo(701.955, 3)
  })
  it('wraps degrees into octaves', () => {
    expect(wrapDegree(5, 0, 5)).toEqual({ degree: 0, octave: 1 })
    expect(wrapDegree(-1, 1, 5)).toEqual({ degree: 4, octave: 0 })
    expect(wrapDegree(12, 0, 5)).toEqual({ degree: 2, octave: 2 })
  })
  it('transposes by scale degree, not semitone', () => {
    const pent = getScale('gong')
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
  it('all scales have monotonic cents starting at 0', () => {
    for (const s of SCALES) {
      expect(s.cents[0]).toBe(0)
      for (let i = 1; i < s.cents.length; i++) expect(s.cents[i]).toBeGreaterThan(s.cents[i - 1])
      expect(s.cents[s.cents.length - 1]).toBeLessThan(s.period ?? 1200)
    }
  })
})
