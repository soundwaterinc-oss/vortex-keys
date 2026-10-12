import { cutTailForStop, registerWithField } from '@el-systema/host'
import type { OrbitEngine } from './engine'
import { INSTRUMENT_ID } from './engine'

/** Join EL-SYSTEMA Live when opened with `?field` (see apps/vortex-keys/src/field.ts). */
export function connectField(engine: OrbitEngine, id = INSTRUMENT_ID) {
  const bridge = registerWithField({
    id,
    onPlay: () => void engine.playFromHub(),
    onStop: () => {
      engine.clear()
      cutTailForStop(engine.host?.master)
    },
    onSetParam: (name, value) => engine.applyMacro(name, value),
    onLoadPreset: (preset) => engine.setState(preset as Partial<OrbitEngine['state']>),
    onSnapshot: () => ({ ...engine.state }) as unknown as Record<string, unknown>,
  })
  if (!bridge.active) return bridge
  const tryAttach = () => {
    const h = engine.host
    if (h) bridge.attachAudio({ audioContext: h.audio, outputNode: h.master.master, sharedAnalyser: h.master.analyser })
  }
  engine.subscribe(tryAttach)
  tryAttach()
  return bridge
}
