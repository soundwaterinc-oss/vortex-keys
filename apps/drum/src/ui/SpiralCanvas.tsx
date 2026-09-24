import { useEffect, useRef, useState } from 'react'
import { machine, useMachineState, usePattern } from '../state/useMachine'
import { pick, render } from '../viz/render'
import type { TrackId } from '../engine/pattern'

/** The spiral: draws from the machine snapshot, edits steps on click. */
export function SpiralCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const state = useMachineState()
  const pattern = usePattern()
  const stateRef = useRef(state)
  const patternRef = useRef(pattern)
  stateRef.current = state
  patternRef.current = pattern
  const hoverRef = useRef<{ track: TrackId; step: number } | null>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const [, force] = useState(0)

  useEffect(() => {
    const box = boxRef.current!
    const ro = new ResizeObserver(() => {
      const r = box.getBoundingClientRect()
      sizeRef.current = { w: r.width, h: r.height }
    })
    ro.observe(box)
    const r = box.getBoundingClientRect()
    sizeRef.current = { w: r.width, h: r.height }
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const ctx = canvasRef.current!.getContext('2d')!
    let raf = 0
    let alive = true
    const frame = () => {
      if (!alive) return
      const { w, h } = sizeRef.current
      if (w > 0 && !document.hidden) {
        render(ctx, {
          state: stateRef.current,
          pattern: patternRef.current,
          snap: machine.snapshot(),
          width: w,
          height: h,
          dpr: Math.min(1.5, window.devicePixelRatio || 1),
          hover: hoverRef.current,
        })
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
    }
  }, [])

  const at = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return pick(e.clientX - r.left, e.clientY - r.top, r.width, r.height, stateRef.current.spiral, stateRef.current.editing)
  }

  return (
    <div className="spiral-box" ref={boxRef}>
      <canvas
        ref={canvasRef}
        className="spiral"
        style={{ width: '100%', height: '100%' }}
        onPointerMove={(e) => {
          hoverRef.current = at(e)
        }}
        onPointerLeave={() => {
          hoverRef.current = null
        }}
        onPointerDown={async (e) => {
          const hit = at(e)
          if (!hit) return
          if (!machine.audioReady) await machine.start()
          machine.toggleStep(hit.track, hit.step)
          force((n) => n + 1)
        }}
      />
    </div>
  )
}
