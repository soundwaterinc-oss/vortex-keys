import { useEffect, useRef } from 'react'
import { useInstrument, useInstrumentState } from '../state/useInstrument'
import { fitLayout, hitTest, spiralNodes, type SpiralNode } from '../spiral/spiral'
import { getScale } from '@el-systema/core'
import { render } from '../visual/renderer'

/**
 * The spiral keyboard + vortex view. Pointer handling maps to note on/off;
 * the RAF loop only renders the Instrument snapshot.
 */
export function SpiralCanvas() {
  const instrument = useInstrument()
  const state = useInstrumentState()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hoverRef = useRef<SpiralNode | null>(null)
  const pointers = useRef(new Map<number, number>()) // pointerId -> note index
  const geom = useRef<{ nodes: SpiralNode[]; layout: ReturnType<typeof fitLayout>; w: number; h: number } | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  // recompute geometry when scale/octaves/size change
  useEffect(() => {
    const canvas = canvasRef.current!
    const ro = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.floor(rect.width * dpr)
      canvas.height = Math.floor(rect.height * dpr)
      layoutFor(rect.width, rect.height)
    })
    const layoutFor = (w: number, h: number) => {
      const s = stateRef.current
      const n = getScale(s.tuning.scaleId).cents.length
      const outer = Math.min(w, h) * 0.5 - 40
      const inner = Math.max(40, outer * 0.32)
      const layout = fitLayout(w / 2, h / 2, outer, inner, n, s.tuning.octaves)
      geom.current = { nodes: spiralNodes(n, s.tuning.octaves, layout), layout, w, h }
    }
    ro.observe(canvas)
    const rect = canvas.getBoundingClientRect()
    layoutFor(rect.width, rect.height)
    return () => ro.disconnect()
  }, [state.tuning.scaleId, state.tuning.octaves])

  // render loop
  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0
    let running = true
    const frame = () => {
      if (!running) return
      const g = geom.current
      if (g && !document.hidden) {
        const s = stateRef.current
        const scale = getScale(s.tuning.scaleId)
        render(ctx, {
          state: s,
          snap: instrument.snapshot(),
          nodes: g.nodes,
          layout: g.layout,
          scaleLength: scale.cents.length,
          hover: hoverRef.current,
          width: g.w,
          height: g.h,
          dpr: Math.min(2, window.devicePixelRatio || 1),
          scaleName: scale.name,
        })
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      running = false
      cancelAnimationFrame(raf)
    }
  }, [])

  const hit = (e: React.PointerEvent) => {
    const g = geom.current
    if (!g) return null
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
    return hitTest(g.nodes, e.clientX - rect.left, e.clientY - rect.top, Math.max(14, g.layout.spiralSpacing * 2.2))
  }

  const onDown = async (e: React.PointerEvent) => {
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    if (!instrument.audioReady) await instrument.start()
    const node = hit(e)
    if (!node) return
    // velocity from distance to node centre: precise hits are louder
    const vel = e.pressure && e.pressure !== 0.5 ? 0.3 + 0.7 * e.pressure : 0.8
    pointers.current.set(e.pointerId, node.index)
    instrument.noteOn(node.index, vel)
  }
  const onMove = (e: React.PointerEvent) => {
    const node = hit(e)
    hoverRef.current = node
    const cur = pointers.current.get(e.pointerId)
    if (cur === undefined) return
    // glissando: slide across nodes
    if (node && node.index !== cur) {
      instrument.noteOff(cur)
      instrument.noteOn(node.index, 0.7)
      pointers.current.set(e.pointerId, node.index)
    }
  }
  const onUp = (e: React.PointerEvent) => {
    const cur = pointers.current.get(e.pointerId)
    if (cur !== undefined) instrument.noteOff(cur)
    pointers.current.delete(e.pointerId)
  }

  return (
    <canvas
      ref={canvasRef}
      className="spiral"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerLeave={() => (hoverRef.current = null)}
      onContextMenu={(e) => e.preventDefault()}
    />
  )
}
