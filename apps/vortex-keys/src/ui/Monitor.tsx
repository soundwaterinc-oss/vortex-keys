import { useEffect, useState } from 'react'
import { useInstrument, useInstrumentState } from '../state/useInstrument'
import type { Snapshot } from '../engine/instrument'

const Bar = ({ label, v, max = 1, fmt }: { label: string; v: number; max?: number; fmt?: (v: number) => string }) => {
  const n = Math.max(0, Math.min(1, Math.abs(v) / max))
  return (
    <div className="mon-row">
      <span className="mon-l">{label}</span>
      <span className="mon-bar">
        <i style={{ width: `${n * 100}%` }} />
      </span>
      <span className="mon-v">{fmt ? fmt(v) : v.toFixed(3)}</span>
    </div>
  )
}

/**
 * Physics monitor: the last mapped event's normalised physical values and
 * the musical result the mapper derived from them, plus event rates.
 * Polled at 15 Hz (not per frame) to keep React out of the render loop.
 */
export function Monitor() {
  const instrument = useInstrument()
  const s = useInstrumentState()
  const [snap, setSnap] = useState<Snapshot | null>(null)
  useEffect(() => {
    if (!s.perf.monitor) return
    const id = window.setInterval(() => setSnap(instrument.snapshot()), 66)
    return () => window.clearInterval(id)
  }, [s.perf.monitor])
  if (!s.perf.monitor || !snap) return null
  const m = snap.monitor
  const st = snap.stats
  const g = snap.globals
  return (
    <div className="monitor">
      <div className="mon-h">
        PHYSICS MONITOR · {snap.modelId} {m ? `· ${m.bodyId} · ${m.eventType}` : ''}
      </div>
      {m ? (
        <>
          <Bar label="r" v={m.snapshot.radius} />
          <Bar label="θ" v={m.snapshot.angle} max={Math.PI * 2} fmt={(v) => `${((v * 180) / Math.PI).toFixed(0)}°`} />
          <Bar label="ω" v={m.snapshot.angularVelocity} max={Math.PI * 6} fmt={(v) => `${v.toFixed(2)} rad/s`} />
          <Bar label="dr/dt" v={m.snapshot.radialVelocity} max={1} />
          <Bar label="accel" v={m.snapshot.acceleration} max={30} />
          <Bar label="energy" v={m.snapshot.energy} />
          <Bar label="phase" v={m.snapshot.phase ?? 0} />
          <Bar label="curv" v={m.snapshot.curvature ?? 0} max={20} />
          <Bar label="value" v={m.snapshot.value ?? 0} />
          <div className="mon-sep" />
          <div className="mon-row">
            <span className="mon-l">pitch</span>
            <span className="mon-v wide">{m.pitch ? `deg ${m.pitch.degree} · oct ${m.pitch.octave}` : '—'}</span>
          </div>
          <Bar label="vel" v={m.velocity} />
          <Bar label="bright" v={m.timbre.brightness} />
          <Bar label="width" v={m.timbre.width} />
          <div className="mon-row">
            <span className="mon-l">trigger</span>
            <span className={'mon-v wide ' + (m.triggered ? 'hot' : '')}>{m.triggered ? 'FIRED' : 'ignored by mapping'}</span>
          </div>
        </>
      ) : (
        <div className="hint">play a note to seed the model</div>
      )}
      <div className="mon-sep" />
      {st && (
        <div className="mon-row">
          <span className="mon-l">rate</span>
          <span className="mon-v wide">
            phys {st.physicsEventsPerSecond}/s · notes {st.notesPerSecond}/s · dropped {st.droppedLastSecond}
          </span>
        </div>
      )}
      <div className="mon-row">
        <span className="mon-l">globals</span>
        <span className="mon-v wide">
          {Object.entries(g)
            .map(([k, v]) => `${k} ${typeof v === 'number' ? v.toFixed(2) : v}`)
            .join(' · ')}
        </span>
      </div>
      <div className="mon-row">
        <span className="mon-l">voices</span>
        <span className="mon-v wide">{snap.voices}</span>
      </div>
    </div>
  )
}
