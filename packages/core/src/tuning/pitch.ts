import type { Scale, ScaleNote } from './types'
import { noteToCents, noteToFrequency } from './tuning'

/**
 * Semantic pitch identity shared across instruments. A body, particle or
 * bus event carries degree + octave, never only Hz: when the ensemble's
 * tuning changes, "degree 3, octave 0" stays degree 3 and its frequency
 * is re-resolved. `resolvePitch` is the one place Hz is produced from it.
 */
export interface MusicalPitchIdentity {
  scaleDegree: number
  octave: number
}

export interface ResolvedPitch extends MusicalPitchIdentity {
  frequency: number
  cents: number
  rootHz: number
}

export interface TuningContext {
  scale: Scale
  rootHz: number
}

export function resolvePitch(id: MusicalPitchIdentity, tuning: TuningContext): ResolvedPitch {
  const note: ScaleNote = { degree: id.scaleDegree, octave: id.octave }
  return {
    scaleDegree: id.scaleDegree,
    octave: id.octave,
    frequency: noteToFrequency(tuning.scale, tuning.rootHz, note),
    cents: noteToCents(tuning.scale, note),
    rootHz: tuning.rootHz,
  }
}
