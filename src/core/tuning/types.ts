/**
 * A scale is a list of cents above the root, one per degree, within one
 * period (assumed 1200 cents = octave for now; `period` allows non-octave
 * scales later, e.g. Bohlen-Pierce). Cents are the canonical representation;
 * ratios are optional documentation / exact source.
 */
export interface Scale {
  id: string
  name: string
  description?: string
  /** cents above root for each degree; degree 0 is normally 0 */
  cents: number[]
  /** optional exact ratios as strings ("3/2"), parallel to cents */
  ratios?: string[]
  source?: string
  /** true when the scale is a 12-TET (or otherwise simplified) approximation */
  approximation?: boolean
  /** period in cents; defaults to 1200 */
  period?: number
}

/** A pitch identity independent of frequency: which degree, which octave. */
export interface ScaleNote {
  degree: number
  octave: number
}

export interface TuningState {
  scaleId: string
  /** root frequency in Hz (octave 0, degree 0) */
  rootHz: number
  /** number of octaves shown on the spiral */
  octaves: number
}
