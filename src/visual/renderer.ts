import type { SpiralLayout, SpiralNode } from '../core/spiral/spiral'
import type { Snapshot } from '../engine/instrument'
import type { InstrumentState } from '../core/preset/types'
import { GATE_ACTION_LABEL } from '../core/flow/gates'
import { TAU } from '../core/math/util'

export interface RenderInput {
  state: InstrumentState
  snap: Snapshot
  nodes: SpiralNode[]
  layout: SpiralLayout
  scaleLength: number
  hover: SpiralNode | null
  width: number
  height: number
  dpr: number
  scaleName: string
}

/** Hue for a scale degree: degrees are spread around the colour wheel. */
export function degreeHue(degree: number, n: number): number {
  return (degree / n) * 300 + 190
}

/**
 * All geometry in the renderer is derived from the same layout used for hit
 * testing, and all motion from the Instrument snapshot; nothing here moves
 * unless the model moved it.
 */
export function render(ctx: CanvasRenderingContext2D, inp: RenderInput) {
  const { state, snap, nodes, layout, scaleLength: n, width: W, height: H } = inp
  ctx.save()
  ctx.scale(inp.dpr, inp.dpr)
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#07080a'
  ctx.fillRect(0, 0, W, H)

  const cx = layout.centerX
  const cy = layout.centerY
  const R0 = layout.innerRadius // vortex spawn ring == innermost spiral radius
  const outer = layout.innerRadius + layout.spiralSpacing * (nodes.length - 1)

  // ----- radial degree axes -----
  ctx.lineWidth = 1
  for (let d = 0; d < n; d++) {
    const th = layout.thetaOffset + (TAU * d) / n
    ctx.strokeStyle = d === 0 ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)'
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(th) * R0 * 0.35, cy + Math.sin(th) * R0 * 0.35)
    ctx.lineTo(cx + Math.cos(th) * (outer + 18), cy + Math.sin(th) * (outer + 18))
    ctx.stroke()
  }

  // ----- spiral guide -----
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'
  ctx.beginPath()
  const steps = nodes.length * 8
  for (let k = 0; k <= steps; k++) {
    const i = (k / steps) * (nodes.length - 1)
    const th = layout.thetaOffset + (TAU * i) / n
    const r = layout.innerRadius + layout.spiralSpacing * i
    const x = cx + r * Math.cos(th)
    const y = cy + r * Math.sin(th)
    k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.stroke()

  const mode = state.flow.mode

  // ----- vortex core + gates -----
  if (mode === 'vortex') {
    const core = state.flow.vortex.coreRadius * R0
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R0)
    grad.addColorStop(0, 'rgba(120,160,255,0.16)')
    grad.addColorStop(0.5, 'rgba(120,160,255,0.03)')
    grad.addColorStop(1, 'rgba(120,160,255,0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(cx, cy, R0, 0, TAU)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'
    ctx.beginPath()
    ctx.arc(cx, cy, core, 0, TAU)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'
    ctx.setLineDash([2, 6])
    ctx.beginPath()
    ctx.arc(cx, cy, R0, 0, TAU)
    ctx.stroke()
    ctx.setLineDash([])

    ctx.font = '10px ui-monospace, Menlo, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const g of state.flow.gates) {
      const a = g.angle
      const x0 = cx + Math.cos(a) * core
      const y0 = cy + Math.sin(a) * core
      const x1 = cx + Math.cos(a) * R0
      const y1 = cy + Math.sin(a) * R0
      ctx.strokeStyle = g.enabled ? 'rgba(255,200,120,0.35)' : 'rgba(255,255,255,0.08)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      ctx.stroke()
      ctx.fillStyle = g.enabled ? 'rgba(255,200,120,0.8)' : 'rgba(255,255,255,0.25)'
      ctx.fillText(GATE_ACTION_LABEL[g.action], cx + Math.cos(a) * (R0 * 0.62), cy + Math.sin(a) * (R0 * 0.62))
    }

    // particles + trails
    for (const p of snap.particles) {
      const hue = degreeHue(p.scaleDegree, n)
      // trail
      ctx.lineWidth = 1.2
      ctx.beginPath()
      let started = false
      const L = p.trail.length / 2
      for (let k = 0; k < L; k++) {
        const idx = (p.trailHead + k) % L
        const a = p.trail[idx * 2]
        const r = p.trail[idx * 2 + 1]
        if (Number.isNaN(a)) continue
        const x = cx + Math.cos(a) * r * R0
        const y = cy + Math.sin(a) * r * R0
        started ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
        started = true
      }
      ctx.strokeStyle = `hsla(${hue},80%,70%,${0.12 + 0.3 * p.energy})`
      ctx.stroke()
      const x = cx + Math.cos(p.angle) * p.radius * R0
      const y = cy + Math.sin(p.angle) * p.radius * R0
      const size = 1.5 + 4 * p.energy * (0.5 + 0.5 * p.velocity)
      ctx.fillStyle = `hsla(${hue},85%,${60 + 25 * p.energy}%,${0.5 + 0.5 * p.energy})`
      ctx.beginPath()
      ctx.arc(x, y, size, 0, TAU)
      ctx.fill()
      if (p.generation > 0) {
        ctx.strokeStyle = `hsla(${hue},85%,80%,0.4)`
        ctx.beginPath()
        ctx.arc(x, y, size + 2.5, 0, TAU)
        ctx.stroke()
      }
    }
  }

  // ----- wave interference visual -----
  if (mode === 'wave') {
    const base = R0 * 0.55
    const amp = R0 * 0.38
    const hist = snap.waveHistory
    const L = hist.length
    // threshold rings
    const thr = snap.waveThreshold
    ctx.setLineDash([3, 5])
    ctx.strokeStyle = 'rgba(255,200,120,0.35)'
    ctx.beginPath()
    ctx.arc(cx, cy, base + amp * thr, 0, TAU)
    ctx.stroke()
    if (state.flow.wave.direction === 'both') {
      ctx.beginPath()
      ctx.arc(cx, cy, base - amp * thr, 0, TAU)
      ctx.stroke()
    }
    ctx.setLineDash([])
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.beginPath()
    ctx.arc(cx, cy, base, 0, TAU)
    ctx.stroke()
    // polar waveform: newest sample at 12 o'clock, history sweeps clockwise
    ctx.beginPath()
    for (let k = 0; k < L; k++) {
      const idx = (snap.waveHead + k) % L
      const v = hist[idx]
      const a = -Math.PI / 2 - (TAU * (L - k)) / L
      const r = base + amp * v
      const x = cx + Math.cos(a) * r
      const y = cy + Math.sin(a) * r
      k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.strokeStyle = 'rgba(140,190,255,0.7)'
    ctx.lineWidth = 1.3
    ctx.stroke()
    // current value marker
    const rv = base + amp * snap.waveValue
    ctx.fillStyle = Math.abs(snap.waveValue) >= thr ? 'rgba(255,200,120,0.95)' : 'rgba(140,190,255,0.9)'
    ctx.beginPath()
    ctx.arc(cx, cy - rv, 3.5, 0, TAU)
    ctx.fill()
  }

  // ----- active note lookup -----
  const activeByIndex = new Map<number, { vel: number; gen: boolean; age: number }>()
  for (const a of snap.active) {
    const age = snap.now - a.start
    const prev = activeByIndex.get(a.index)
    if (!prev || a.velocity > prev.vel) activeByIndex.set(a.index, { vel: a.velocity, gen: a.generated, age })
  }
  const particleCount = new Map<number, number>()
  for (const p of snap.particles) {
    const idx = p.octave * n + p.scaleDegree
    particleCount.set(idx, (particleCount.get(idx) ?? 0) + 1)
  }

  // ----- nodes -----
  const octaves = state.tuning.octaves
  for (const node of nodes) {
    const hue = degreeHue(node.degree, n)
    const tonic = node.degree === 0
    const octL = 0.35 + 0.5 * (node.octave / Math.max(1, octaves - 1)) // outer octaves brighter
    const baseR = tonic ? 5.5 : 4
    const act = activeByIndex.get(node.index)
    const hovered = inp.hover?.index === node.index

    if (act) {
      const glow = 10 + 14 * act.vel * Math.max(0, 1 - act.age * 0.6)
      const g = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, glow)
      g.addColorStop(0, act.gen ? `hsla(${hue},90%,75%,0.55)` : `hsla(${hue},90%,85%,0.7)`)
      g.addColorStop(1, `hsla(${hue},90%,70%,0)`)
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(node.x, node.y, glow, 0, TAU)
      ctx.fill()
    }

    ctx.beginPath()
    ctx.arc(node.x, node.y, baseR + (act ? 1.5 : 0) + (hovered ? 1 : 0), 0, TAU)
    ctx.fillStyle = act
      ? `hsla(${hue},90%,${act.gen ? 70 : 88}%,1)`
      : `hsla(${hue},55%,${45 * octL + 20}%,${0.55 + 0.45 * octL})`
    ctx.fill()
    if (tonic) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(node.x, node.y, baseR + 3, 0, TAU)
      ctx.stroke()
    }
    const pc = particleCount.get(node.index)
    if (pc) {
      ctx.strokeStyle = `hsla(${hue},90%,70%,0.6)`
      ctx.lineWidth = 1
      for (let k = 0; k < Math.min(pc, 3); k++) {
        ctx.beginPath()
        ctx.arc(node.x, node.y, baseR + 6 + k * 3, 0, TAU)
        ctx.stroke()
      }
    }
  }

  // ----- degree labels on outer ring -----
  ctx.font = '10px ui-monospace, Menlo, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  for (let d = 0; d < n; d++) {
    const th = layout.thetaOffset + (TAU * d) / n
    ctx.fillText(String(d), cx + Math.cos(th) * (outer + 26), cy + Math.sin(th) * (outer + 26))
  }

  // ----- hover readout -----
  if (inp.hover) {
    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.textAlign = 'left'
    ctx.fillText(`deg ${inp.hover.degree}  oct ${inp.hover.octave}`, 12, H - 14)
  }

  // ----- status line -----
  ctx.textAlign = 'right'
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  const meter = Math.min(1, snap.level * 3)
  ctx.fillText(`${inp.scaleName}  ·  ${mode.toUpperCase()}  ·  v${snap.voices}  p${snap.particles.length}`, W - 12, H - 14)
  ctx.fillStyle = meter > 0.8 ? 'rgba(255,120,120,0.8)' : 'rgba(140,190,255,0.6)'
  ctx.fillRect(W - 12 - 80, H - 30, 80 * meter, 2)
  ctx.restore()
}
