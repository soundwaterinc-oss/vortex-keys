import { describe, it, expect } from 'vitest'
import { centsToMidi, bendValue } from '../src/audio/midiSink'

describe('midi mapping', () => {
  it('maps cents to nearest note + bend', () => {
    expect(centsToMidi(700, 60)).toEqual({ note: 67, bendCents: 0 })
    const r = centsToMidi(701.955, 60)
    expect(r.note).toBe(67)
    expect(r.bendCents).toBeCloseTo(1.955, 3)
    const q = centsToMidi(350, 60)
    expect([63, 64]).toContain(q.note)
    expect(Math.abs(q.bendCents)).toBeCloseTo(50, 6)
  })
  it('bend value centre and range', () => {
    expect(bendValue(0)).toBe(8192)
    expect(bendValue(200)).toBe(16383)
    expect(bendValue(-200)).toBe(1)
  })
})
