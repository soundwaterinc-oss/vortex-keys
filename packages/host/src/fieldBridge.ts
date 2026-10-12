/**
 * EL-SYSTEMA Live (the hub) bridge — control-contract v1.
 *
 * The hub's leaf wrapper (`shared/el-systema-control.js`, loaded as classic
 * scripts in index.html) exposes `window.registerElSystemaInstrument`. An
 * instrument joins the field only when opened with `?field`; it then
 * answers play / stop / setParam(macro.a|b|c, volume) / loadPreset /
 * snapshot and streams kehai (presence) from an analyser the wrapper adds
 * to our master node. Audio may attach later (after the user gesture).
 *
 * Macro semantics (§4.2): a = density/energy, b = timbre/structure/order,
 * c = space/reverb/spread. volume = master gain, perceptually v².
 */
export interface FieldBridgeConfig {
  id: string
  onPlay?: () => void
  onStop?: () => void
  onSetParam?: (name: string, value: number) => void
  onRamp?: (name: string, from: number, to: number, duration: number) => void
  onLoadPreset?: (preset: Record<string, unknown>) => void
  onSnapshot?: () => Record<string, unknown>
}

export interface FieldAudio {
  audioContext: AudioContext
  outputNode?: AudioNode
  sharedAnalyser?: AnalyserNode
}

export interface FieldBridgeHandle {
  attachAudio?: (a: FieldAudio) => void
}

type RegisterFn = (config: FieldBridgeConfig & Partial<FieldAudio>) => FieldBridgeHandle | undefined

declare global {
  interface Window {
    registerElSystemaInstrument?: RegisterFn
  }
}

/** True when the page was opened by (or for) the hub. */
export function fieldRequested(): boolean {
  return typeof location !== 'undefined' && /[?&#]field/.test(location.href)
}

/**
 * Register once at load (so the hub sees the instrument before audio exists)
 * and return a handle whose `attachAudio` is safe to call any time.
 * No-op when not opened with `?field` or when the wrapper scripts are absent.
 */
export function registerWithField(config: FieldBridgeConfig): { active: boolean; attachAudio: (a: FieldAudio) => void } {
  if (!fieldRequested() || typeof window === 'undefined' || typeof window.registerElSystemaInstrument !== 'function') {
    return { active: false, attachAudio: () => {} }
  }
  const handle = window.registerElSystemaInstrument(config)
  let attached = false
  return {
    active: true,
    attachAudio: (a) => {
      if (attached) return
      attached = true
      handle?.attachAudio?.(a)
    },
  }
}

/** Contract §4.3: 0..1 fader → perceptual gain. */
export const volumeToGain = (v: number) => {
  const x = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))
  return x * x
}

/**
 * Hub stop: cut the space return so the delay/reverb tail does not keep the
 * instrument "sounding" (the hub re-lights ▶ if presence stays up >3 s after
 * a stop). Reopens after `reopenMs`, once the tail is gone, so playing the
 * instrument from its own tab still has its space.
 */
export function cutTailForStop(chain: { dampTail(on: boolean): void } | undefined, reopenMs = 2500) {
  if (!chain) return
  chain.dampTail(true)
  setTimeout(() => chain.dampTail(false), reopenMs)
}
