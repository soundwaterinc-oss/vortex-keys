import { describe, it, expect } from 'vitest'
import { spiralNode, spiralNodes, fitLayout, hitTest } from '../src/core/spiral/spiral'

describe('spiral', () => {
  const layout = { centerX: 0, centerY: 0, innerRadius: 10, spiralSpacing: 2, thetaOffset: 0 }
  it('one revolution per octave: same degree shares the radial axis', () => {
    const a = spiralNode(1, 5, layout)
    const b = spiralNode(6, 5, layout)
    expect(b.theta - a.theta).toBeCloseTo(Math.PI * 2, 9)
    expect(Math.atan2(a.y, a.x)).toBeCloseTo(Math.atan2(b.y, b.x), 9)
    expect(b.radius - a.radius).toBeCloseTo(10, 9)
  })
  it('degree/octave from index', () => {
    const n = spiralNode(7, 5, layout)
    expect(n.degree).toBe(2)
    expect(n.octave).toBe(1)
  })
  it('fitLayout places outermost node at outerRadius', () => {
    const l = fitLayout(0, 0, 100, 20, 7, 3)
    const nodes = spiralNodes(7, 3, l)
    expect(nodes[nodes.length - 1].radius).toBeCloseTo(100, 9)
    expect(nodes[0].radius).toBeCloseTo(20, 9)
  })
  it('hit test finds nearest within radius', () => {
    const nodes = spiralNodes(5, 2, layout)
    const target = nodes[3]
    expect(hitTest(nodes, target.x + 0.5, target.y - 0.5, 2)?.index).toBe(3)
    expect(hitTest(nodes, 1000, 1000, 2)).toBeNull()
  })
})
