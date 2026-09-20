/**
 * Three kinds of state, kept apart on purpose:
 *  GlobalState     — what the whole ensemble shares (clock, tuning, seed, master gain)
 *  InstrumentState — one instrument's own parameters, opaque to everyone else
 *  PresetState     — a serialisable bundle of both, for save/load
 */
export interface GlobalState {
  tempo: number
  masterGain: number
  tuningId: string
  rootFrequency: number
  seed: number
}

export interface InstrumentState<P = Record<string, unknown>> {
  instrumentId: string
  params: P
}

export interface PresetState {
  version: number
  name: string
  global: GlobalState
  instruments: InstrumentState[]
}

export const DEFAULT_GLOBAL_STATE: GlobalState = {
  tempo: 84,
  masterGain: 0.7,
  tuningId: 'penta-major',
  rootFrequency: 130.8128,
  seed: 1234,
}
