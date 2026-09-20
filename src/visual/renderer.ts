import type { SpiralLayout, SpiralNode } from '../core/spiral/spiral'
import type { Snapshot } from '../engine/instrument'
import type { InstrumentState } from '../core/preset/types'
import { GATE_ACTION_LABEL } from '../core/flow/gates'
import { TAU } from '../core/math/util'
import type { GravityBody } from '../core/physics/gravity'
import type { OrbitBody } from '../core/physics/orbit'
import { keplerPosition } from '../core/physics/orbit'
import { fieldAt, type WaveSource } from '../core/physics/wavefield'
import type { PhysicsBody } from '../core/physics/types'

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

const FIELD_GRID = 56
let fieldCanvas: HTMLCanvasElement | null = null
let fieldImage: ImageData | null = null

/**
 * All geometry comes from the same layout used for hit testing, and all
 * motion from the Instrument snapshot; nothing here moves unless the model
 * moved it. Simulation radius 1 maps to the innermost spiral radius R0.
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
  const R0 = layout.innerRadius
  const outer = layout.innerRadius + layout.spiralSpacing * (nodes.length - 1)
  const toXY = (r: number, a: number) => [cx + Math.cos(a) * r * R0, cy + Math.sin(a) * r * R0] as const

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
  ctx.font = '10px ui-monospace, Menlo, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const drawGates = (coreR: number) => {
    for (const g of state.flow.gates) {
      const a = g.angle
      const [x0, y0] = toXY(coreR, a)
      const [x1, y1] = toXY(1, a)
      ctx.strokeStyle = g.enabled ? 'rgba(255,200,120,0.35)' : 'rgba(255,255,255,0.08)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      ctx.stroke()
      ctx.fillStyle = g.enabled ? 'rgba(255,200,120,0.8)' : 'rgba(255,255,255,0.25)'
      const [lx, ly] = toXY(0.62, a)
      ctx.fillText(GATE_ACTION_LABEL[g.action], lx, ly)
    }
  }
  const spawnRing = () => {
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'
    ctx.setLineDash([2, 6])
    ctx.beginPath()
    ctx.arc(cx, cy, R0, 0, TAU)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // ================= GRAVITY VORTEX =================
  if (mode === 'vortex') {
    const core = state.flow.vortex.minRadius * R0
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
    spawnRing()
    drawGates(state.flow.vortex.minRadius)
    for (const b of snap.visual as GravityBody[]) {
      const s = b.snapshot
      const hue = degreeHue(b.identity.degree, n)
      ctx.lineWidth = 1.2
      ctx.beginPath()
      let started = false
      const L = b.trail.length / 2
      for (let k = 0; k < L; k++) {
        const idx = (b.trailHead + k) % L
        const a = b.trail[idx * 2]
        const r = b.trail[idx * 2 + 1]
        if (Number.isNaN(a)) continue
        const [x, y] = toXY(r, a)
        started ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
        started = true
      }
      ctx.strokeStyle = `hsla(${hue},80%,70%,${0.12 + 0.3 * s.energy})`
      ctx.stroke()
      const [x, y] = toXY(s.radius, s.angle)
      const size = 1.5 + 4 * s.energy * (0.5 + 0.5 * b.identity.velocity)
      ctx.fillStyle = `hsla(${hue},85%,${60 + 25 * s.energy}%,${0.5 + 0.5 * s.energy})`
      ctx.beginPath()
      ctx.arc(x, y, size, 0, TAU)
      ctx.fill()
      if (b.generation > 0) {
        ctx.strokeStyle = `hsla(${hue},85%,80%,0.4)`
        ctx.beginPath()
        ctx.arc(x, y, size + 2.5, 0, TAU)
        ctx.stroke()
      }
    }
  }

  // ================= ORBIT =================
  if (mode === 'orbit') {
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'
    ctx.beginPath()
    ctx.arc(cx, cy, 3, 0, TAU)
    ctx.stroke()
    spawnRing()
    drawGates(0.05)
    for (const b of snap.visual as OrbitBody[]) {
      const s = b.snapshot
      const o = b.orbit
      const hue = degreeHue(b.identity.degree, n)
      // the ellipse itself, sampled through the same Kepler solution
      ctx.strokeStyle = `hsla(${hue},70%,65%,${0.08 + 0.25 * s.energy})`
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let k = 0; k <= 72; k++) {
        const { r, nu } = keplerPosition(o.semiMajorAxis, o.eccentricity, (TAU * k) / 72)
        const [x, y] = toXY(r, o.orientation + nu)
        k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.stroke()
      // periapsis marker
      const [px, py] = toXY(o.semiMajorAxis * (1 - o.eccentricity), o.orientation)
      ctx.strokeStyle = `hsla(${hue},80%,75%,0.6)`
      ctx.beginPath()
      ctx.moveTo(px - 3, py - 3)
      ctx.lineTo(px + 3, py + 3)
      ctx.moveTo(px + 3, py - 3)
      ctx.lineTo(px - 3, py + 3)
      ctx.stroke()
      // apoapsis marker
      const [ax, ay] = toXY(o.semiMajorAxis * (1 + o.eccentricity), o.orientation + Math.PI)
      ctx.strokeStyle = `hsla(${hue},80%,75%,0.3)`
      ctx.beginPath()
      ctx.arc(ax, ay, 2.5, 0, TAU)
      ctx.stroke()
      // body: size by energy, brightness by speed
      const [x, y] = toXY(s.radius, s.angle)
      const sp = Math.min(1, s.speed / 2.5)
      ctx.fillStyle = `hsla(${hue},85%,${55 + 35 * sp}%,${0.5 + 0.5 * s.energy})`
      ctx.beginPath()
      ctx.arc(x, y, 2 + 3.5 * s.energy, 0, TAU)
      ctx.fill()
      // velocity vector
      ctx.strokeStyle = `hsla(${hue},85%,80%,0.5)`
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + Math.cos(s.angle + Math.PI / 2) * sp * 14 * Math.sign(s.angularVelocity || 1), y + Math.sin(s.angle + Math.PI / 2) * sp * 14 * Math.sign(s.angularVelocity || 1))
      ctx.stroke()
    }
  }

  // ================= WAVE FIELD =================
  if (mode === 'wave') {
    const v = snap.visual as { sources: WaveSource[]; probes: PhysicsBody[]; t: number; baseHz: number; threshold: number } | null
    if (v) {
      const ext = 1.15 // field extent in sim units
      if (!fieldCanvas) {
        fieldCanvas = document.createElement('canvas')
        fieldCanvas.width = FIELD_GRID
        fieldCanvas.height = FIELD_GRID
        fieldImage = fieldCanvas.getContext('2d')!.createImageData(FIELD_GRID, FIELD_GRID)
      }
      const img = fieldImage!
      const d = img.data
      const thr = v.threshold
      const sign = state.flow.wave.expanding
      for (let j = 0; j < FIELD_GRID; j++) {
        for (let i = 0; i < FIELD_GRID; i++) {
          const x = ((i + 0.5) / FIELD_GRID) * 2 * ext - ext
          const y = ((j + 0.5) / FIELD_GRID) * 2 * ext - ext
          const idx = (j * FIELD_GRID + i) * 4
          if (x * x + y * y > ext * ext) {
            d[idx + 3] = 0
            continue
          }
          const f = fieldAt(v.sources, x * sign, y * sign, v.t, v.baseHz)
          const m = Math.abs(f)
          const nearThr = Math.abs(m - thr) < 0.04
          if (f >= 0) {
            d[idx] = 90
            d[idx + 1] = 150
            d[idx + 2] = 255
          } else {
            d[idx] = 255
            d[idx + 1] = 180
            d[idx + 2] = 100
          }
          d[idx + 3] = Math.floor((nearThr ? 200 : 20 + 90 * m * m) * (m < 0.05 ? 0.2 : 1))
        }
      }
      fieldCanvas.getContext('2d')!.putImageData(img, 0, 0)
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, R0 * ext, 0, TAU)
      ctx.clip()
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(fieldCanvas, cx - R0 * ext, cy - R0 * ext, R0 * ext * 2, R0 * ext * 2)
      ctx.restore()
      // sources
      for (const s of v.sources) {
        const x = cx + s.x * R0
        const y = cy + s.y * R0
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'
        ctx.beginPath()
        ctx.moveTo(x - 4, y)
        ctx.lineTo(x + 4, y)
        ctx.moveTo(x, y - 4)
        ctx.lineTo(x, y + 4)
        ctx.stroke()
      }
      // probes: dot + value bar
      for (const b of v.probes) {
        const s = b.snapshot
        const [x, y] = toXY(s.radius, s.angle)
        const hue = degreeHue(b.identity.degree, n)
        const f = s.value ?? 0
        ctx.fillStyle = `hsla(${hue},85%,70%,${0.4 + 0.6 * Math.abs(f)})`
        ctx.beginPath()
        ctx.arc(x, y, 3 + 3 * Math.abs(f), 0, TAU)
        ctx.fill()
        ctx.strokeStyle = Math.abs(f) >= thr ? 'rgba(255,200,120,0.9)' : 'rgba(255,255,255,0.35)'
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x, y - f * 18)
        ctx.stroke()
      }
    }
  }

  // ================= COUPLED OSCILLATORS =================
  if (mode === 'coupled') {
    const v = snap.visual as { oscs: PhysicsBody[]; R: number; psi: number; threshold: number } | null
    if (v) {
      const ring = 0.62
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'
      ctx.beginPath()
      ctx.arc(cx, cy, ring * R0, 0, TAU)
      ctx.stroke()
      // sync threshold ring (order parameter length)
      ctx.setLineDash([3, 5])
      ctx.strokeStyle = 'rgba(255,200,120,0.35)'
      ctx.beginPath()
      ctx.arc(cx, cy, v.threshold * ring * R0, 0, TAU)
      ctx.stroke()
      ctx.setLineDash([])
      // order parameter vector R·e^{iψ}
      const [ox, oy] = toXY(v.R * ring, v.psi)
      ctx.strokeStyle = v.R >= v.threshold ? 'rgba(255,200,120,0.95)' : 'rgba(140,190,255,0.8)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(ox, oy)
      ctx.stroke()
      ctx.lineWidth = 1
      ctx.fillStyle = 'rgba(255,255,255,0.5)'
      ctx.fillText(`R ${v.R.toFixed(2)}`, cx, cy + 14)
      // phase-0 mark
      const [zx, zy] = toXY(ring, 0)
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'
      ctx.beginPath()
      ctx.moveTo(zx - 5, zy)
      ctx.lineTo(zx + 5, zy)
      ctx.stroke()
      for (const b of v.oscs) {
        const s = b.snapshot
        const hue = degreeHue(b.identity.degree, n)
        const [x, y] = toXY(ring, s.angle)
        ctx.strokeStyle = `hsla(${hue},70%,65%,0.18)`
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.lineTo(x, y)
        ctx.stroke()
        ctx.fillStyle = `hsla(${hue},85%,70%,0.9)`
        ctx.beginPath()
        ctx.arc(x, y, 4, 0, TAU)
        ctx.fill()
      }
    }
  }

  // ================= CHAOS =================
  if (mode === 'chaos') {
    const v = snap.visual as { history: Float32Array; head: number; raw: number[]; r: number; threshold: number; x: number; xs: number } | null
    if (v) {
      const base = 0.25
      const amp = 0.7
      // threshold ring
      ctx.setLineDash([3, 5])
      ctx.strokeStyle = 'rgba(255,200,120,0.35)'
      ctx.beginPath()
      ctx.arc(cx, cy, (base + amp * v.threshold) * R0, 0, TAU)
      ctx.stroke()
      ctx.setLineDash([])
      // polar history: newest at 12 o'clock, sweeping clockwise
      const L = v.history.length
      ctx.beginPath()
      for (let k = 0; k < L; k++) {
        const idx = (v.head + k) % L
        const xs = v.history[idx]
        const a = -Math.PI / 2 - (TAU * (L - k)) / L
        const [x, y] = toXY(base + amp * xs, a)
        k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.strokeStyle = 'rgba(140,190,255,0.7)'
      ctx.stroke()
      const [mx, my] = toXY(base + amp * v.xs, -Math.PI / 2)
      ctx.fillStyle = v.xs >= v.threshold ? 'rgba(255,200,120,0.95)' : 'rgba(140,190,255,0.9)'
      ctx.beginPath()
      ctx.arc(mx, my, 3.5, 0, TAU)
      ctx.fill()
      // return map inset: (x_n, x_{n+1}) on the logistic parabola
      const S = 110
      const ix = 12
      const iy = H - 12 - S - 20
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'
      ctx.strokeRect(ix, iy, S, S)
      ctx.beginPath()
      for (let k = 0; k <= 40; k++) {
        const x = k / 40
        const y = v.r * x * (1 - x)
        k === 0 ? ctx.moveTo(ix + x * S, iy + S - y * S) : ctx.lineTo(ix + x * S, iy + S - y * S)
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'
      ctx.stroke()
      ctx.fillStyle = 'rgba(140,190,255,0.7)'
      for (let k = 0; k < v.raw.length; k += 2) {
        ctx.fillRect(ix + v.raw[k] * S - 1, iy + S - v.raw[k + 1] * S - 1, 2, 2)
      }
      ctx.fillStyle = 'rgba(255,255,255,0.45)'
      ctx.textAlign = 'left'
      ctx.fillText(`r ${v.r.toFixed(3)}  x ${v.x.toFixed(3)}`, ix, iy + S + 10)
      ctx.textAlign = 'center'
    }
  }

  // ----- event flashes: an expanding ring where a semantic event happened -----
  for (const e of snap.recentEvents) {
    const age = snap.now - e.time
    if (age < 0 || age > 0.35) continue
    const s = e.current
    const r = mode === 'coupled' ? 0.62 : mode === 'chaos' ? 0.25 + 0.7 * (s.value ?? 0) : s.radius
    const a = mode === 'chaos' ? -Math.PI / 2 : s.angle
    const [x, y] = toXY(r, a)
    const k = age / 0.35
    ctx.strokeStyle = e.type === 'gateCrossing' || e.type === 'periapsis' ? `rgba(255,200,120,${0.7 * (1 - k)})` : `rgba(180,210,255,${0.6 * (1 - k)})`
    ctx.beginPath()
    ctx.arc(x, y, 3 + 14 * k, 0, TAU)
    ctx.stroke()
  }

  // ----- active note lookup -----
  const activeByIndex = new Map<number, { vel: number; gen: boolean; age: number }>()
  for (const a of snap.active) {
    const age = snap.now - a.start
    const prev = activeByIndex.get(a.index)
    if (!prev || a.velocity > prev.vel) activeByIndex.set(a.index, { vel: a.velocity, gen: a.generated, age })
  }
  const bodyCount = new Map<number, number>()
  for (const b of snap.bodies) {
    if (!b.alive) continue
    const idx = b.identity.octave * n + b.identity.degree
    bodyCount.set(idx, (bodyCount.get(idx) ?? 0) + 1)
  }

  // ----- nodes -----
  const octaves = state.tuning.octaves
  for (const node of nodes) {
    const hue = degreeHue(node.degree, n)
    const tonic = node.degree === 0
    const octL = 0.35 + 0.5 * (node.octave / Math.max(1, octaves - 1))
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
    ctx.fillStyle = act ? `hsla(${hue},90%,${act.gen ? 70 : 88}%,1)` : `hsla(${hue},55%,${45 * octL + 20}%,${0.55 + 0.45 * octL})`
    ctx.fill()
    if (tonic) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(node.x, node.y, baseR + 3, 0, TAU)
      ctx.stroke()
    }
    const pc = bodyCount.get(node.index)
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

  // ----- degree labels -----
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  for (let d = 0; d < n; d++) {
    const th = layout.thetaOffset + (TAU * d) / n
    ctx.fillText(String(d), cx + Math.cos(th) * (outer + 26), cy + Math.sin(th) * (outer + 26))
  }
  if (inp.hover) {
    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.textAlign = 'left'
    ctx.fillText(`deg ${inp.hover.degree}  oct ${inp.hover.octave}`, 12, H - 14)
  }
  // ----- status line -----
  ctx.textAlign = 'right'
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  const meter = Math.min(1, snap.level * 3)
  const bodies = snap.bodies.filter((b) => b.alive).length
  const rate = snap.stats ? `  ${snap.stats.notesPerSecond}/s` : ''
  ctx.fillText(`${inp.scaleName}  ·  ${mode.toUpperCase()}  ·  v${snap.voices} b${bodies}${rate}`, W - 12, H - 14)
  ctx.fillStyle = meter > 0.8 ? 'rgba(255,120,120,0.8)' : 'rgba(140,190,255,0.6)'
  ctx.fillRect(W - 12 - 80, H - 30, 80 * meter, 2)
  ctx.restore()
}
