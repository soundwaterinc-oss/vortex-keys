import type { ScaleNote } from '@el-systema/core'
import { transposeNote } from '@el-systema/core'

export type GateAction =
  | 'repeat'
  | 'degreeUp'
  | 'degreeDown'
  | 'octaveUp'
  | 'octaveDown'
  | 'velocityUp'
  | 'velocityDown'
  | 'spawnChild'

export const GATE_ACTIONS: GateAction[] = [
  'repeat',
  'degreeUp',
  'degreeDown',
  'octaveUp',
  'octaveDown',
  'velocityUp',
  'velocityDown',
  'spawnChild',
]

export const GATE_ACTION_LABEL: Record<GateAction, string> = {
  repeat: '=',
  degreeUp: '+1',
  degreeDown: '−1',
  octaveUp: '8va',
  octaveDown: '8vb',
  velocityUp: 'v+',
  velocityDown: 'v−',
  spawnChild: '⊕',
}

export interface Gate {
  id: string
  /** radians, in the vortex frame (0 = +x) */
  angle: number
  action: GateAction
  /** probability that the gate fires when crossed (0..1) */
  probability: number
  enabled: boolean
}

export interface GateResult {
  note: ScaleNote
  velocity: number
  spawnChild: boolean
}

/**
 * Apply a gate action to a particle's musical identity. Transposition is in
 * scale degrees (+1 = next note of the current scale), never semitones.
 * Velocity edits are multiplicative and clamped by the caller.
 */
export function applyGate(gate: Gate, note: ScaleNote, velocity: number, n: number): GateResult {
  switch (gate.action) {
    case 'repeat':
      return { note, velocity, spawnChild: false }
    case 'degreeUp':
      return { note: transposeNote(note, 1, 0, n), velocity, spawnChild: false }
    case 'degreeDown':
      return { note: transposeNote(note, -1, 0, n), velocity, spawnChild: false }
    case 'octaveUp':
      return { note: transposeNote(note, 0, 1, n), velocity, spawnChild: false }
    case 'octaveDown':
      return { note: transposeNote(note, 0, -1, n), velocity, spawnChild: false }
    case 'velocityUp':
      return { note, velocity: Math.min(1, velocity * 1.25), spawnChild: false }
    case 'velocityDown':
      return { note, velocity: velocity * 0.7, spawnChild: false }
    case 'spawnChild':
      return { note, velocity, spawnChild: true }
  }
}

/** Evenly spaced default gates. */
export function defaultGates(count: number, actions?: GateAction[]): Gate[] {
  const acts = actions ?? ['repeat', 'degreeUp', 'repeat', 'degreeDown', 'octaveUp', 'spawnChild', 'velocityDown', 'repeat']
  const gates: Gate[] = []
  for (let k = 0; k < count; k++) {
    gates.push({
      id: `g${k}`,
      angle: (Math.PI * 2 * k) / count,
      action: acts[k % acts.length],
      probability: 1,
      enabled: true,
    })
  }
  return gates
}
