import type { Macros, SoundModelId } from '@el-systema/audio'
import type { GravityParams } from '@el-systema/physics'
import type { OrbitParams } from '@el-systema/physics'
import type { WaveFieldParams } from '@el-systema/physics'
import type { CoupledParams } from '@el-systema/physics'
import type { ChaosParams } from '@el-systema/physics'
import type { GlobalMacros } from '@el-systema/physics'
import type { Gate } from '@el-systema/physics'
import type { FlowLimits } from '@el-systema/mapping'
import type { QuantizeValue, TimingMode } from '@el-systema/core'

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
