import type { Macros, SoundModelId } from '../../audio/models'
import type { GravityParams } from '../physics/gravity'
import type { OrbitParams } from '../physics/orbit'
import type { WaveFieldParams } from '../physics/wavefield'
import type { CoupledParams } from '../physics/coupled'
import type { ChaosParams } from '../physics/chaos'
import type { GlobalMacros } from '../physics/types'
import type { Gate } from '../flow/gates'
import type { FlowLimits } from '../flow/physicsFlow'
import type { QuantizeValue, TimingMode } from '../clock/quantize'

export type FlowMode = 'manual' | 'vortex' | 'orbit' | 'wave' | 'coupled' | 'chaos'
export const FLOW_MODES: FlowMode[] = ['manual', 'vortex', 'orbit', 'wave', 'coupled', 'chaos']

export interface TuningSettings {
  scaleId: string
  rootMidi: number
  rootHz: number
  octaves: number
}

export interface SoundSettings {
  model: SoundModelId
  macros: Macros
}

/**
 * Physics preset (mode + per-model params + gates) and mapping preset
 * (mappingId) are independent fields: any physics with any mapping.
 */
export interface FlowSettings {
  mode: FlowMode
  /** 0..1 FLOW amount */
  amount: number
  /** ENERGY / ORDER↔CHAOS / TIME / SPACE */
  macros: GlobalMacros
  mappingId: string
  vortex: Omit<GravityParams, 'gates'>
  orbit: Omit<OrbitParams, 'gates'>
  wave: WaveFieldParams
  coupled: CoupledParams
  chaos: ChaosParams
  gates: Gate[]
  seed: number
  limits: FlowLimits
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
  monitor: boolean
  advanced: boolean
}

export interface Preset {
  version: 2
  name: string
  tuning: TuningSettings
  sound: SoundSettings
  flow: FlowSettings
  time: TimeSettings
}

export interface InstrumentState extends Preset {
  perf: PerformanceSettings
}
