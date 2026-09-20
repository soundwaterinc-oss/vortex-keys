import type { PhysicsEvent, PhysicsEventType, PhysicsSnapshot, MusicalIdentity } from '../physics/types'
import type { CurveType } from '../physics/normalize'

export type PitchSource = 'angle' | 'radius' | 'identity' | 'gate' | 'value'
export type RegisterSource = 'none' | 'radius' | 'radiusInverse' | 'speed' | 'slope' | 'sync' | 'valueDelta'
export type VelocitySource = 'energy' | 'angularVelocity' | 'constant' | 'amplitude' | 'distanceFromHalf' | 'phaseVelocity'
export type TimbreSource = 'radius' | 'radiusInverse' | 'energy' | 'acceleration' | 'sync' | 'slope' | 'constant'
export type WidthSource = 'constant' | 'syncInverse' | 'radius'

/**
 * Declarative description of how physics becomes music. A preset picks one;
 * physics presets and mapping presets are independent.
 */
export interface MappingConfig {
  id: string
  name: string
  description?: string
  pitchSource: PitchSource
  registerSource: RegisterSource
  /** octaves of register movement available to registerSource */
  registerSpan: number
  velocitySource: VelocitySource
  velocityCurve: CurveType
  timbreSource: TimbreSource
  widthSource: WidthSource
  /** which semantic events cause a note */
  triggerOn: PhysicsEventType[]
  /** which events get an accent (velocity boost) */
  accentOn: PhysicsEventType[]
  /** when true, high synchronisation narrows the available degree range */
  pitchRangeFromSync: boolean
  /** note length in beats (scaled by energy) */
  durationBeats: number
}

export interface MappingContext {
  scaleLength: number
  octaves: number
  /** the body's musical identity; the mapper may update it (gate actions) */
  identity: MusicalIdentity
  globals: Record<string, number>
  event: PhysicsEvent
  amount: number
  beatSeconds: number
  /** set by the mapper when a gate asked for a child particle */
  requestChild?: boolean
}

export interface PitchInstruction {
  degree: number
  octave: number
}

export interface TimbreInstruction {
  /** 0..1 -> filter opening / partial level */
  brightness: number
  /** 0..1 stereo width multiplier */
  width: number
}

export interface MusicalMapper {
  readonly config: MappingConfig
  shouldTrigger(previous: PhysicsSnapshot, current: PhysicsSnapshot, ctx: MappingContext): boolean
  mapPitch(snapshot: PhysicsSnapshot, ctx: MappingContext): PitchInstruction | null
  mapVelocity(snapshot: PhysicsSnapshot, ctx: MappingContext): number
  mapTimbre(snapshot: PhysicsSnapshot, ctx: MappingContext): TimbreInstruction
}
