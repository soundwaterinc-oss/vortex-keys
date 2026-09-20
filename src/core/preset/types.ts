import type { Macros, SoundModelId } from '../../audio/models'
import type { VortexParams } from '../flow/vortex'
import type { WaveParams } from '../flow/wave'
import type { Gate } from '../flow/gates'
import type { QuantizeValue, TimingMode } from '../clock/quantize'

export type FlowMode = 'manual' | 'vortex' | 'wave'

export interface TuningSettings {
  scaleId: string
  /** MIDI note number used for the root selector; rootHz is derived unless overridden */
  rootMidi: number
  rootHz: number
  octaves: number
}

export interface SoundSettings {
  model: SoundModelId
  macros: Macros
}

export interface FlowSettings {
  mode: FlowMode
  /** 0..1 GENERATIVE amount */
  amount: number
  vortex: Omit<VortexParams, 'gates'>
  wave: WaveParams
  gates: Gate[]
  seed: number
}

export interface TimeSettings {
  bpm: number
  mode: TimingMode
  quantize: QuantizeValue
}

export interface PerformanceSettings {
  sustain: boolean
  latch: boolean
  frozen: boolean
}

/** Everything reproducible. Saved as JSON. */
export interface Preset {
  version: 1
  name: string
  tuning: TuningSettings
  sound: SoundSettings
  flow: FlowSettings
  time: TimeSettings
}

export interface InstrumentState extends Preset {
  perf: PerformanceSettings
}
