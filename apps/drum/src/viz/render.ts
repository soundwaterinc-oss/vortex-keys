import { TRACKS, turnPattern, type SpiralConfig, type Pattern, type TrackId } from '../engine/pattern'
import type { MachineState, Snapshot } from '../engine/machine'

/**
 * The spiral. Angle is the step within a turn; radius grows with the turn,
 * so time runs outward and the same beat of every turn sits on one ray. A
 * step's dot shows the pattern *as that turn will actually play it* (after
 * the turn transform), which is how the drift becomes visible: the figure
 * you drew walks outward and bends.
 */

export interface View {
  state: MachineState
  pattern: Pattern
  snap: Snapshot
  width: number
  height: number
  dpr: number
  hover: { track: TrackId; step: number } | null
}

const TAU = Math.PI * 2
/** track colours: low to high, cool to warm */
export const HUE: Record<TrackId, number> = { kick: 8, sub: 280, snare: 45, hat: 190, perc: 150, air: 320 }

export interface Geometry {
  cx: number
  cy: number
  r0: number
  r1: number
  /** radius of a turn's centre line */
  turnRadius(turn: number): number
  /** radial offset of a track inside its turn band */
  trackRadius(turn: number, track: TrackId): number
  angle(step: number): number
  xy(radius: number, angle: number): [number, number]
}

export function geometry(w: number, h: number, cfg: SpiralConfig): Geometry {
  const cx = w / 2
  const cy = h / 2
  const r1 = Math.min(w, h) / 2 - 26
  const r0 = r1 * 0.24
  const band = (r1 - r0) / Math.max(1, cfg.turns)
  const turnRadius = (turn: number) => r0 + band * (turn + 0.5)
  const trackRadius = (turn: number, track: TrackId) => {
    const i = TRACKS.indexOf(track)
    // tracks stack inside the band, kick nearest the centre
    return r0 + band * turn + (band * (i + 0.5)) / TRACKS.length
  }
  const angle = (step: number) => -Math.PI / 2 + (TAU * step) / cfg.stepsPerTurn
  return { cx, cy, r0, r1, turnRadius, trackRadius, angle, xy: (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)] }
}

export function render(ctx: CanvasRenderingContext2D, v: View) {
  const { width: w, height: h, dpr, state, snap } = v
  const cfg = state.spiral
  const cv = ctx.canvas
  if (cv.width !== Math.floor(w * dpr) || cv.height !== Math.floor(h * dpr)) {
    cv.width = Math.floor(w * dpr)
    cv.height = Math.floor(h * dpr)
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  const g = geometry(w, h, cfg)

  // ---- the spiral path itself ----
  ctx.strokeStyle = 'rgba(255,255,255,0.11)'
  ctx.lineWidth = 1
  ctx.beginPath()
  const segs = cfg.turns * cfg.stepsPerTurn * 4
  for (let i = 0; i <= segs; i++) {
    const f = i / segs
    const turn = f * cfg.turns
    const r = g.turnRadius(turn - 0.5)
    const a = -Math.PI / 2 + TAU * turn
    const [x, y] = g.xy(r, a)
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
  }
  ctx.stroke()

  // ---- beat rays ----
  for (let s = 0; s < cfg.stepsPerTurn; s++) {
    const strong = s % 4 === 0
    ctx.strokeStyle = strong ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)'
    const a = g.angle(s)
    const [x0, y0] = g.xy(g.r0 * 0.82, a)
    const [x1, y1] = g.xy(g.r1, a)
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.stroke()
  }

  // ---- steps, turn by turn ----
  // cache each turn's transformed pattern once per frame
  const turned: Record<number, Partial<Record<TrackId, number[]>>> = {}
  for (let turn = 0; turn < cfg.turns; turn++) {
    turned[turn] = {}
    for (const t of TRACKS) turned[turn][t] = turnPattern(v.pattern[t], t, turn, cfg)
  }

  const flash = new Map<string, number>()
  for (const r of snap.recent) {
    const age = snap.now - r.time
    if (age < 0 || age > 0.85) continue
    const k = `${r.track}:${r.turn}:${r.step}`
    flash.set(k, Math.max(flash.get(k) ?? 0, 1 - age / 0.85))
  }

  for (let turn = 0; turn < cfg.turns; turn++) {
    for (const t of TRACKS) {
      const row = turned[turn][t]!
      const muted = state.mutes[t]
      const editing = t === state.editing
      const hue = HUE[t]
      for (let s = 0; s < cfg.stepsPerTurn; s++) {
        const val = row[s]
        const base = v.pattern[t][s]
        const r = g.trackRadius(turn, t)
        const [x, y] = g.xy(r, g.angle(s))
        const hot = flash.get(`${t}:${turn}:${s}`) ?? 0
        if (hot > 0) {
          const rad = 3 + 9 * hot * val
          const grd = ctx.createRadialGradient(x, y, 0, x, y, rad)
          grd.addColorStop(0, `hsla(${hue},95%,72%,${0.75 * hot})`)
          grd.addColorStop(1, `hsla(${hue},95%,60%,0)`)
          ctx.fillStyle = grd
          ctx.beginPath()
          ctx.arc(x, y, rad, 0, TAU)
          ctx.fill()
        }
        if (val <= 0) {
          // only draw the empty grid on the turn being edited, to keep it readable
          if (turn === 0 && editing) {
            ctx.fillStyle = 'rgba(255,255,255,0.12)'
            ctx.beginPath()
            ctx.arc(x, y, 1.2, 0, TAU)
            ctx.fill()
          }
          continue
        }
        const drifted = base <= 0 || Math.abs(val - base) > 0.02
        const size = 1.6 + 2.6 * val
        ctx.globalAlpha = muted ? 0.25 : 1
        ctx.fillStyle = `hsla(${hue},${drifted ? 60 : 85}%,${drifted ? 52 : 66}%,${editing ? 0.95 : 0.6})`
        ctx.beginPath()
        ctx.arc(x, y, size, 0, TAU)
        ctx.fill()
        if (drifted && turn > 0) {
          // a ring marks a note the spiral moved or invented
          ctx.strokeStyle = `hsla(${hue},70%,70%,0.35)`
          ctx.lineWidth = 0.8
          ctx.beginPath()
          ctx.arc(x, y, size + 2.2, 0, TAU)
          ctx.stroke()
        }
        ctx.globalAlpha = 1
      }
    }
  }

  // ---- hover ----
  if (v.hover) {
    const [x, y] = g.xy(g.trackRadius(0, v.hover.track), g.angle(v.hover.step))
    ctx.strokeStyle = `hsla(${HUE[v.hover.track]},90%,75%,0.8)`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(x, y, 6, 0, TAU)
    ctx.stroke()
  }

  // ---- playhead ----
  if (snap.running) {
    const turn = snap.turn + snap.step / cfg.stepsPerTurn
    const a = -Math.PI / 2 + TAU * (snap.step / cfg.stepsPerTurn)
    const rIn = g.turnRadius(snap.turn - 0.5)
    const rOut = g.turnRadius(snap.turn + 0.5)
    const grad = ctx.createLinearGradient(...g.xy(rIn, a), ...g.xy(rOut, a))
    grad.addColorStop(0, 'rgba(255,255,255,0.05)')
    grad.addColorStop(1, 'rgba(255,255,255,0.5)')
    ctx.strokeStyle = grad
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(...g.xy(rIn, a))
    ctx.lineTo(...g.xy(rOut, a))
    ctx.stroke()
    const [px, py] = g.xy(g.turnRadius(turn - snap.turn + snap.turn), a)
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.beginPath()
    ctx.arc(px, py, 2.5, 0, TAU)
    ctx.fill()
  }

  // ---- labels ----
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.font = '9px ui-monospace, monospace'
  ctx.textAlign = 'center'
  for (let s = 0; s < cfg.stepsPerTurn; s += 4) {
    const [x, y] = g.xy(g.r1 + 12, g.angle(s))
    ctx.fillText(String(s + 1), x, y + 3)
  }
  ctx.textAlign = 'left'
  ctx.fillStyle = 'rgba(255,255,255,0.3)'
  ctx.fillText(`turn ${snap.turn + 1}/${cfg.turns}`, 12, h - 14)
}

/** Which step a pointer is over, if any. */
export function pick(x: number, y: number, w: number, h: number, cfg: SpiralConfig, editing: TrackId): { track: TrackId; step: number } | null {
  const g = geometry(w, h, cfg)
  const dx = x - g.cx
  const dy = y - g.cy
  const r = Math.hypot(dx, dy)
  if (r < g.r0 * 0.6 || r > g.r1 + 6) return null
  let a = Math.atan2(dy, dx) + Math.PI / 2
  a = ((a % TAU) + TAU) % TAU
  const step = Math.round((a / TAU) * cfg.stepsPerTurn) % cfg.stepsPerTurn
  return { track: editing, step }
}
