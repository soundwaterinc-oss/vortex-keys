import type { MappingConfig } from '@el-systema/mapping'

/**
 * ORBIT's own mapping presets. Same physics (OrbitModel) as VORTEX KEYS'
 * orbit mode, read as rhythm: pitch stays on the body's identity, gates and
 * periapsis are the beats, energy is the dynamics.
 */
export const ORBIT_MAPPINGS: MappingConfig[] = [
  {
    id: 'orbit-pulse',
    name: 'Pulse',
    description: 'gate → hit · identity → drum pitch · energy → velocity · periapsis → accent',
    pitchSource: 'identity',
    registerSource: 'none',
    registerSpan: 0,
    velocitySource: 'energy',
    velocityCurve: 'invExp',
    timbreSource: 'radiusInverse',
    widthSource: 'radius',
    triggerOn: ['gateCrossing'],
    accentOn: ['periapsis'],
    pitchRangeFromSync: false,
    durationBeats: 0.25,
  },
  {
    id: 'orbit-apsides',
    name: 'Apsides',
    description: 'periapsis + apoapsis → hits (two-beat elastic pulse) · gates silent',
    pitchSource: 'identity',
    registerSource: 'none',
    registerSpan: 0,
    velocitySource: 'angularVelocity',
    velocityCurve: 'scurve',
    timbreSource: 'acceleration',
    widthSource: 'constant',
    triggerOn: ['periapsis', 'apoapsis'],
    accentOn: ['periapsis'],
    pitchRangeFromSync: false,
    durationBeats: 0.3,
  },
]
