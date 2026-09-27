import { registerWithField } from '@el-systema/host'
import { machine } from './engine/machine'

export const INSTRUMENT_ID = 'spira'

/**
 * Join EL-SYSTEMA Live when opened with `?field` (see apps/vortex-keys/src/field.ts).
 *
 * 卓からは PLAY / STOP / 音量 / macro 3本だけを受ける。どれも画面の操作と同じ経路
 * （machine.play / stop / setState(macros)）を通すので、卓から押しても手で押したのと同じ挙動になる。
 * 音は machine.start() が開くまで存在しないので、登録は読み込み時に行い audio は後から差し込む。
 *
 * macro（制御規約 §4.2）: a = 打点の強さ(punch) / b = 歯(grind) / c = 空間(space)。volume = level。
 */
export function connectField(id = INSTRUMENT_ID) {
  const bridge = registerWithField({
    id,
    onPlay: () => void machine.play(),
    onStop: () => machine.stop(),
    onSetParam: (name, value) => {
      const v = Math.max(0, Math.min(1, value))
      if (name === 'volume') return void machine.setState((s) => ({ macros: { ...s.macros, level: v } }))
      if (name === 'macro.a') return void machine.setState((s) => ({ macros: { ...s.macros, punch: v } }))
      if (name === 'macro.b') return void machine.setState((s) => ({ macros: { ...s.macros, grind: v } }))
      if (name === 'macro.c') return void machine.setState((s) => ({ macros: { ...s.macros, space: v } }))
    },
    onLoadPreset: (preset) => machine.setState(preset as never),
    onSnapshot: () => ({ ...machine.state }) as unknown as Record<string, unknown>,
  })
  if (!bridge.active) return bridge
  const tryAttach = () => {
    const h = machine.fieldAudio
    if (h) bridge.attachAudio({ audioContext: h.audio, outputNode: h.master, sharedAnalyser: h.analyser })
  }
  machine.subscribe(tryAttach)
  tryAttach()
  return bridge
}
