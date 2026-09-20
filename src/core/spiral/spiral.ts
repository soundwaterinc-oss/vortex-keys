import { TAU } from '../math/util'

export interface SpiralLayout {
  centerX: number
  centerY: number
  innerRadius: number
  /** radius growth per note index */
  spiralSpacing: number
  /** rotation of degree 0 (radians); -PI/2 puts the tonic at 12 o'clock */
  thetaOffset: number
}

export interface SpiralNode {
  index: number
  degree: number
  octave: number
  theta: number
  radius: number
  x: number
  y: number
}

/**
 * One revolution = one octave: theta advances 2π/n per degree, so the same
 * degree in consecutive octaves lands on the same radial axis (radius grows
 * by n * spacing per octave).
 */
export function spiralNode(i: number, n: number, layout: SpiralLayout): SpiralNode {
  const theta = layout.thetaOffset + (TAU * i) / n
  const radius = layout.innerRadius + layout.spiralSpacing * i
  return {
    index: i,
    degree: ((i % n) + n) % n,
    octave: Math.floor(i / n),
    theta,
    radius,
    x: layout.centerX + radius * Math.cos(theta),
    y: layout.centerY + radius * Math.sin(theta),
  }
}

export function spiralNodes(n: number, octaves: number, layout: SpiralLayout): SpiralNode[] {
  const out: SpiralNode[] = []
  for (let i = 0; i < n * octaves; i++) out.push(spiralNode(i, n, layout))
  return out
}

/**
 * Fit the spiral into a square viewport: choose spacing so the outermost
 * node sits at `outerRadius`.
 */
export function fitLayout(
  centerX: number,
  centerY: number,
  outerRadius: number,
  innerRadius: number,
  n: number,
  octaves: number,
): SpiralLayout {
  const count = Math.max(1, n * octaves - 1)
  return {
    centerX,
    centerY,
    innerRadius,
    spiralSpacing: (outerRadius - innerRadius) / count,
    thetaOffset: -Math.PI / 2,
  }
}

/** Nearest node within hitRadius, or null. */
export function hitTest(nodes: SpiralNode[], x: number, y: number, hitRadius: number): SpiralNode | null {
  let best: SpiralNode | null = null
  let bestD = hitRadius * hitRadius
  for (const node of nodes) {
    const dx = node.x - x
    const dy = node.y - y
    const d = dx * dx + dy * dy
    if (d < bestD) {
      bestD = d
      best = node
    }
  }
  return best
}
