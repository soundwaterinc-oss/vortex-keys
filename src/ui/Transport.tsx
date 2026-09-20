import { useRef } from 'react'
import { instrument, useInstrumentState } from '../state/useInstrument'
import { Toggle } from './controls'

/** Performance controls: always visible above the spiral. */
export function Transport() {
  const s = useInstrumentState()
  const fileRef = useRef<HTMLInputElement>(null)

  const save = () => {
    const preset = instrument.exportPreset()
    const name = prompt('Preset name', preset.name) ?? preset.name
    preset.name = name
    const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${name.replace(/[^\w-]+/g, '_')}.vortexkeys.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const load = async (f: File | undefined) => {
    if (!f) return
    try {
      instrument.loadPreset(JSON.parse(await f.text()))
    } catch {
      alert('Could not parse preset JSON')
    }
  }

  return (
    <div className="transport">
      <Toggle label="SUSTAIN" on={s.perf.sustain} onChange={(v) => instrument.setState((st) => ({ perf: { ...st.perf, sustain: v } }))} />
      <Toggle label="LATCH" on={s.perf.latch} onChange={(v) => instrument.setState((st) => ({ perf: { ...st.perf, latch: v } }))} />
      <Toggle label="FREEZE" on={s.perf.frozen} hot onChange={(v) => instrument.setState((st) => ({ perf: { ...st.perf, frozen: v } }))} />
      <span className="gap" />
      <button onClick={() => instrument.clearFlow()}>CLEAR</button>
      <button onClick={() => instrument.panic()}>PANIC</button>
      <button onClick={() => instrument.randomize()}>RANDOMIZE</button>
      <button onClick={() => instrument.resetFlow()}>RESET</button>
      <span className="gap" />
      <Toggle label="MONITOR" on={s.perf.monitor} onChange={(v) => instrument.setState((st) => ({ perf: { ...st.perf, monitor: v } }))} />
      <span className="gap" />
      <button onClick={save}>SAVE</button>
      <button onClick={() => fileRef.current?.click()}>LOAD</button>
      <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => load(e.target.files?.[0])} />
    </div>
  )
}
