import { cutTailForStop, registerWithField } from '@el-systema/host'
import type { Instrument } from './engine/instrument'
import { INSTRUMENT_ID } from './engine/instrument'

/**
 * Join EL-SYSTEMA Live when opened with `?field`. Registered at load so the
 * hub lists the instrument before audio exists; audio attaches after the
 * first start (user gesture or hub play → wrapper handles the gesture wait).
 */
export function connectField(instrument: Instrument, id = INSTRUMENT_ID) {
  const bridge = registerWithField({
    id,
    onPlay: () => {
      void instrument.start()
      instrument.setState((s) => ({ perf: { ...s.perf, frozen: false } }))
    },
    onStop: () => {
      instrument.stopAll()
      cutTailForStop(instrument.host?.master)
    },
    onSetParam: (name, value) => instrument.applyMacro(name, value),
    onLoadPreset: (preset) => instrument.loadPreset(preset),
    onSnapshot: () => instrument.exportPreset() as unknown as Record<string, unknown>,
  })
  if (!bridge.active) return bridge
  const tryAttach = () => {
    const h = instrument.host
    if (h) bridge.attachAudio({ audioContext: h.audio, outputNode: h.master.master, sharedAnalyser: h.master.analyser })
  }
  instrument.subscribe(tryAttach)
  tryAttach()
  return bridge
}
