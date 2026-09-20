import type { Scale, ScaleNote } from './types'
import { mod } from '../math/util'

export function scalePeriod(scale: Scale): number {
  return scale.period ?? 1200
}

/**
 * Core pitch mapping. frequency = root * 2^((octave*period + cents[degree]) / 1200)
 * Degree is wrapped so callers can pass any integer note index.
 */
export function noteToFrequency(scale: Scale, rootHz: number, note: ScaleNote): number {
  const n = scale.cents.length
  const wrapped = wrapDegree(note.degree, note.octave, n)
  const cents = wrapped.octave * scalePeriod(scale) + scale.cents[wrapped.degree]
  return rootHz * Math.pow(2, cents / 1200)
}

/** Total cents above root for a note (useful for MIDI pitch-bend later). */
export function noteToCents(scale: Scale, note: ScaleNote): number {
  const n = scale.cents.length
  const w = wrapDegree(note.degree, note.octave, n)
  return w.octave * scalePeriod(scale) + scale.cents[w.degree]
}

/** Normalise degree into [0, n), carrying overflow into the octave. */
export function wrapDegree(degree: number, octave: number, n: number): ScaleNote {
  const carry = Math.floor(degree / n)
  return { degree: mod(degree, n), octave: octave + carry }
}

/** Linear note index (spiral index) <-> (degree, octave). */
export function indexToNote(i: number, n: number): ScaleNote {
  return { degree: mod(i, n), octave: Math.floor(i / n) }
}

export function noteToIndex(note: ScaleNote, n: number): number {
  return note.octave * n + note.degree
}

/**
 * Scale-degree transposition: +1 means "the next note of this scale",
 * whatever its size in cents. Octave transposition adds whole periods.
 */
export function transposeNote(note: ScaleNote, degrees: number, octaves: number, n: number): ScaleNote {
  const w = wrapDegree(note.degree + degrees, note.octave + octaves, n)
  return w
}

/** Convert cents to a frequency ratio. */
export function centsToRatio(cents: number): number {
  return Math.pow(2, cents / 1200)
}

/** Parse "3/2" or "1.5" to cents. */
export function ratioStringToCents(r: string): number {
  const parts = r.split('/')
  const value = parts.length === 2 ? Number(parts[0]) / Number(parts[1]) : Number(r)
  return 1200 * Math.log2(value)
}

/** Build a scale's cents from a ratio list (for JI definitions). */
export function centsFromRatios(ratios: string[]): number[] {
  return ratios.map(ratioStringToCents)
}

/** MIDI note number -> Hz (12-TET, A4 = 440) for root selection UI. */
export function midiToHz(midi: number, a4 = 440): number {
  return a4 * Math.pow(2, (midi - 69) / 12)
}

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export function midiToName(midi: number): string {
  return `${NOTE_NAMES[mod(midi, 12)]}${Math.floor(midi / 12) - 1}`
}
