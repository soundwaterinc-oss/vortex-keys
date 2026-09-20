import { TAU, wrapAngle, mod } from '@el-systema/core'

/** Angle of a scale degree's radial axis (degree 0 at 12 o'clock). */
export function degreeAngle(degree: number, n: number): number {
  return wrapAngle(-Math.PI / 2 + (TAU * degree) / n)
}

/** Nearest scale degree for an angle in the shared frame. */
export function angleToDegree(angle: number, n: number): number {
  const turns = wrapAngle(angle + Math.PI / 2) / TAU
  return mod(Math.round(turns * n), n)
}

export function polarToXY(radius: number, angle: number): { x: number; y: number } {
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) }
}
