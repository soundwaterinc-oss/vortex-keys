import { useEffect, useRef } from 'react'
import { keplerPosition, type OrbitBody, GATE_ACTION_LABEL } from '@el-systema/physics'
import { angleToDegree, TAU } from './shared'
import { engine } from './store'
import { getScale } from '@el-systema/core'

/**
 * ORBIT's interaction surface: a celestial dial. Click launches a body on an
 * orbit whose size is the click radius and whose pitch is the click angle
 * (degree axes as in VORTEX KEYS, so the two instruments agree on where a
 * degree lives). Everything drawn comes from the engine snapshot.
 */
export function OrbitCanvas() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0
    const ro = new ResizeObserver(() => {
      const r = canvas.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = r.width * dpr
      canvas.height = r.height * dpr
    })
    ro.observe(canvas)
    const frame = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const W = canvas.width / dpr
      const H = canvas.height / dpr
      const cx = W / 2
      const cy = H / 2
      const R = Math.min(W, H) * 0.42
      const s = engine.snapshot()
      const n = getScale(engine.state.scaleId).cents.length
      ctx.save()
      ctx.scale(dpr, dpr)
      ctx.fillStyle = '#07080a'
      ctx.fillRect(0, 0, W, H)
      ctx.font = '10px ui-monospace, Menlo, monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      // degree axes (shared frame)
      for (let d = 0; d < n; d++) {
        const a = -Math.PI / 2 + (TAU * d) / n
        ctx.strokeStyle = d === 0 ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)'
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R)
        ctx.stroke()
        ctx.fillStyle = 'rgba(255,255,255,0.35)'
        ctx.fillText(String(d), cx + Math.cos(a) * (R + 16), cy + Math.sin(a) * (R + 16))
      }
      // launch ring
      ctx.setLineDash([2, 6])
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'
      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, TAU)
      ctx.stroke()
      ctx.setLineDash([])
      // gates: ticks on the rim + label
      for (const g of s.gates) {
        const x0 = cx + Math.cos(g.angle) * R * 0.08
        const y0 = cy + Math.sin(g.angle) * R * 0.08
        const x1 = cx + Math.cos(g.angle) * R
        const y1 = cy + Math.sin(g.angle) * R
        ctx.strokeStyle = 'rgba(255,200,120,0.35)'
        ctx.beginPath()
        ctx.moveTo(x0, y0)
        ctx.lineTo(x1, y1)
        ctx.stroke()
        ctx.fillStyle = 'rgba(255,200,120,0.8)'
        ctx.fillText(GATE_ACTION_LABEL[g.action], cx + Math.cos(g.angle) * R * 0.93, cy + Math.sin(g.angle) * R * 0.93)
      }
      // beat pulse at the centre (shared clock made visible)
      const beatFrac = s.beat - Math.floor(s.beat)
      ctx.fillStyle = `rgba(140,190,255,${0.35 * (1 - beatFrac)})`
      ctx.beginPath()
      ctx.arc(cx, cy, 4 + 6 * (1 - beatFrac), 0, TAU)
      ctx.fill()
      // orbits + bodies
      for (const b of s.bodies as OrbitBody[]) {
        const o = b.orbit
        const hue = (b.identity.degree / n) * 300 + 190
        ctx.strokeStyle = `hsla(${hue},70%,65%,${0.1 + 0.3 * b.snapshot.energy})`
        ctx.beginPath()
        for (let k = 0; k <= 72; k++) {
          const { r, nu } = keplerPosition(o.semiMajorAxis, o.eccentricity, (TAU * k) / 72)
          const a = o.orientation + nu
          const x = cx + Math.cos(a) * r * R
          const y = cy + Math.sin(a) * r * R
          k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
        }
        ctx.stroke()
        const x = cx + Math.cos(b.snapshot.angle) * b.snapshot.radius * R
        const y = cy + Math.sin(b.snapshot.angle) * b.snapshot.radius * R
        ctx.fillStyle = `hsla(${hue},85%,72%,${0.5 + 0.5 * b.snapshot.energy})`
        ctx.beginPath()
        ctx.arc(x, y, 3 + 3 * b.snapshot.energy, 0, TAU)
        ctx.fill()
      }
      // hits: expanding rings at the gate the body crossed
      for (const h of s.hits) {
        const age = s.now - h.time
        if (age < 0) continue
        const k = Math.min(1, age / 0.5)
        const x = cx + Math.cos(h.angle) * h.radius * R
        const y = cy + Math.sin(h.angle) * h.radius * R
        ctx.strokeStyle = `rgba(255,200,120,${(1 - k) * 0.9 * h.velocity})`
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(x, y, 4 + 22 * k, 0, TAU)
        ctx.stroke()
        ctx.lineWidth = 1
      }
      ctx.textAlign = 'right'
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      ctx.fillText(`ORBIT · ${engine.state.timing.toUpperCase()} ${engine.state.quantize} · beat ${Math.floor(s.beat)} · ${s.stats.notesPerSecond}/s`, W - 12, H - 14)
      const meter = Math.min(1, s.level * 3)
      ctx.fillStyle = 'rgba(140,190,255,0.6)'
      ctx.fillRect(W - 12 - 80, H - 30, 80 * meter, 2)
      ctx.restore()
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  const onDown = async (e: React.PointerEvent) => {
    if (!engine.audioReady) await engine.start()
    const r = (e.target as HTMLCanvasElement).getBoundingClientRect()
    const cx = r.width / 2
    const cy = r.height / 2
    const R = Math.min(r.width, r.height) * 0.42
    const dx = e.clientX - r.left - cx
    const dy = e.clientY - r.top - cy
    const n = getScale(engine.state.scaleId).cents.length
    engine.launch(angleToDegree(Math.atan2(dy, dx), n), Math.hypot(dx, dy) / R)
  }

  return <canvas ref={ref} className="dial" onPointerDown={onDown} onContextMenu={(e) => e.preventDefault()} />
}
