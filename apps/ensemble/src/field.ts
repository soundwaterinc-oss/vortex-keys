import { cutTailForStop, registerWithField } from '@el-systema/host'
import type { Ensemble } from './ensemble'

/** The whole ENSEMBLE as one instrument on EL-SYSTEMA Live (opened with `?field`). */
export function connectField(ensemble: Ensemble, id = 'ensemble') {
  const bridge = registerWithField({
    id,
    onPlay: () => void ensemble.start(),
    onStop: () => {
      ensemble.stopAll()
      cutTailForStop(ensemble.host?.master)
    },
    onSetParam: (name, value) => ensemble.applyMacro(name, value),
    onLoadPreset: (preset) => ensemble.loadPresetBundle(preset),
    onSnapshot: () => ensemble.snapshotPreset(),
  })
  if (!bridge.active) return bridge
  const tryAttach = () => {
    const h = ensemble.host
    if (h) bridge.attachAudio({ audioContext: h.audio, outputNode: h.master.master, sharedAnalyser: h.master.analyser })
  }
  ensemble.subscribe(tryAttach)
  tryAttach()
  return bridge
}
