import { instrument, useInstrumentState } from '../state/useInstrument'
import { Section, Slider, Select, Segmented } from './controls'
import { SCALES, getScale } from '../core/tuning/scales'
import { midiToHz, midiToName } from '../core/tuning/tuning'
import { MODELS, MODEL_IDS, type Macros } from '../audio/models'
import { GATE_ACTIONS, GATE_ACTION_LABEL, defaultGates, type GateAction } from '../core/flow/gates'
import { QUANTIZE_VALUES } from '../core/clock/quantize'
import { FACTORY_PRESETS } from '../core/preset/presets'
import { MAPPING_PRESETS, getMapping } from '../core/mapping/presets'
import type { FlowMode, FlowSettings } from '../core/preset/types'

const pct = (v: number) => `${Math.round(v * 100)}%`
const f2 = (v: number) => v.toFixed(2)
const f3 = (v: number) => v.toFixed(3)
const int = (v: number) => String(Math.round(v))

const RATIO_PRESETS: { name: string; ratios: number[] }[] = [
  { name: '1 : 1', ratios: [1, 1] },
  { name: '1 : 2', ratios: [1, 2] },
  { name: '2 : 3', ratios: [2, 3] },
  { name: '3 : 4 : 5', ratios: [3, 4, 5] },
  { name: '1 : 1.05 (beating)', ratios: [1, 1.05] },
  { name: '1 : √2', ratios: [1, Math.SQRT2] },
  { name: '1 : φ', ratios: [1, (1 + Math.sqrt(5)) / 2] },
  { name: '1 : √2 : φ', ratios: [1, Math.SQRT2, (1 + Math.sqrt(5)) / 2] },
]

export function Panel() {
  const s = useInstrumentState()
  const scale = getScale(s.tuning.scaleId)
  const f = s.flow

  const setMacro = (k: keyof Macros, v: number) => instrument.setState((st) => ({ sound: { ...st.sound, macros: { ...st.sound.macros, [k]: v } } }))
  const setFlow = (patch: Partial<FlowSettings>) => instrument.setState((st) => ({ flow: { ...st.flow, ...patch } }))
  const setG = (k: keyof FlowSettings['macros'], v: number) => setFlow({ macros: { ...f.macros, [k]: v } })
  const setModel = <K extends 'vortex' | 'orbit' | 'wave' | 'coupled' | 'chaos'>(model: K, patch: Partial<FlowSettings[K]>) =>
    instrument.setState((st) => ({ flow: { ...st.flow, [model]: { ...st.flow[model], ...patch } } }))
  const num = <K extends 'vortex' | 'orbit' | 'wave' | 'coupled' | 'chaos'>(model: K, key: keyof FlowSettings[K] & string) => (v: number) =>
    setModel(model, { [key]: v } as Partial<FlowSettings[K]>)

  const mapping = getMapping(f.mappingId)
  const hasGates = f.mode === 'vortex' || f.mode === 'orbit'

  return (
    <aside className="panel">
      <header className="brand">
        <h1>VORTEX KEYS</h1>
        <div className="sub">spiral resonator</div>
        {!instrument.audioReady && (
          <button className="start" onClick={() => instrument.start()}>
            ▶ start audio
          </button>
        )}
      </header>

      <Section title="PRESET">
        <Select
          label="factory"
          value={s.name}
          options={[{ value: s.name, label: s.name }, ...FACTORY_PRESETS.filter((p) => p.name !== s.name).map((p) => ({ value: p.name, label: p.name }))]}
          onChange={(name) => {
            const p = FACTORY_PRESETS.find((x) => x.name === name)
            if (p) instrument.loadPreset(p)
          }}
        />
      </Section>

      <Section title="TUNING">
        <Select
          label="scale"
          value={s.tuning.scaleId}
          options={SCALES.map((sc) => ({ value: sc.id, label: `${sc.name} (${sc.cents.length})` }))}
          onChange={(scaleId) => instrument.setState((st) => ({ tuning: { ...st.tuning, scaleId } }))}
        />
        {scale.description && <p className="hint">{scale.description}</p>}
        <Slider label="root" value={s.tuning.rootMidi} min={24} max={72} step={1} format={(v) => `${midiToName(v)} ${midiToHz(v).toFixed(1)}Hz`} onChange={(m) => instrument.setState((st) => ({ tuning: { ...st.tuning, rootMidi: m, rootHz: midiToHz(m) } }))} />
        <Slider label="octaves" value={s.tuning.octaves} min={1} max={6} step={1} format={int} onChange={(o) => instrument.setState((st) => ({ tuning: { ...st.tuning, octaves: o } }))} />
      </Section>

      <Section title="SOUND">
        <Select label="model" value={s.sound.model} options={MODEL_IDS.map((id) => ({ value: id, label: MODELS[id].name }))} onChange={(model) => instrument.setState((st) => ({ sound: { ...st.sound, model } }))} />
        {(['body', 'air', 'color', 'decay', 'space', 'motion'] as const).map((k) => (
          <Slider key={k} label={k.toUpperCase()} value={s.sound.macros[k]} format={pct} onChange={(v) => setMacro(k, v)} />
        ))}
      </Section>

      <Section title="FLOW">
        <Segmented<FlowMode>
          value={f.mode}
          options={[
            { value: 'manual', label: 'MAN' },
            { value: 'vortex', label: 'VORTEX' },
            { value: 'orbit', label: 'ORBIT' },
          ]}
          onChange={(mode) => setFlow({ mode })}
        />
        <Segmented<FlowMode>
          value={f.mode}
          options={[
            { value: 'wave', label: 'WAVE' },
            { value: 'coupled', label: 'COUPLED' },
            { value: 'chaos', label: 'CHAOS' },
          ]}
          onChange={(mode) => setFlow({ mode })}
        />
        <Slider label="FLOW" big value={f.amount} format={pct} onChange={(amount) => setFlow({ amount })} />
        <Slider label="ENERGY" value={f.macros.energy} format={pct} onChange={(v) => setG('energy', v)} />
        <Slider label="ORD↔CHA" value={f.macros.chaos} format={pct} onChange={(v) => setG('chaos', v)} />
        <Slider label="TIME" value={f.macros.time} format={(v) => `×${Math.pow(2, (v - 0.5) * 2).toFixed(2)}`} onChange={(v) => setG('time', v)} />
        <Slider label="SPACE" value={f.macros.space} format={pct} onChange={(v) => setG('space', v)} />

        <Select label="mapping" value={f.mappingId} options={MAPPING_PRESETS.map((m) => ({ value: m.id, label: m.name }))} onChange={(mappingId) => setFlow({ mappingId })} />
        {mapping.description && <p className="hint">{mapping.description}</p>}

        <button className="adv" onClick={() => instrument.setState((st) => ({ perf: { ...st.perf, advanced: !st.perf.advanced } }))}>
          {s.perf.advanced ? '▾ advanced' : '▸ advanced'}
        </button>

        {s.perf.advanced && f.mode === 'vortex' && (
          <>
            <Slider label="SPIN" value={f.vortex.spin} min={0.01} max={1.5} format={(v) => `${f2(v)} rev/beat`} onChange={num('vortex', 'spin')} />
            <Slider label="PULL" value={f.vortex.pull} min={0} max={0.25} format={f3} onChange={num('vortex', 'pull')} />
            <Slider label="ALPHA" value={f.vortex.alpha} min={0} max={2.5} onChange={num('vortex', 'alpha')} />
            <Slider label="DECAY" value={f.vortex.decay} min={0.5} max={0.995} format={f3} onChange={num('vortex', 'decay')} />
            <Slider label="MIN R" value={f.vortex.minRadius} min={0.02} max={0.4} onChange={num('vortex', 'minRadius')} />
            <Slider label="E LOSS" value={f.vortex.energyLoss} min={0} max={0.3} onChange={num('vortex', 'energyLoss')} />
            <Slider label="TURB." value={f.vortex.turbulence} format={pct} onChange={num('vortex', 'turbulence')} />
            <Slider label="DENSITY" value={f.vortex.density} format={pct} onChange={num('vortex', 'density')} />
            <Slider label="TEMPO" value={f.vortex.tempoInfluence} format={pct} onChange={num('vortex', 'tempoInfluence')} />
            <Slider label="MAX P" value={f.vortex.maxParticles} min={1} max={96} step={1} format={int} onChange={num('vortex', 'maxParticles')} />
          </>
        )}
        {s.perf.advanced && f.mode === 'orbit' && (
          <>
            <Slider label="SIZE" value={f.orbit.orbitSize} min={0.15} max={1} onChange={num('orbit', 'orbitSize')} />
            <Slider label="ECC." value={f.orbit.eccentricity} min={0} max={0.95} onChange={num('orbit', 'eccentricity')} />
            <Slider label="PRECESS" value={f.orbit.precession} min={-0.1} max={0.1} step={0.001} format={f3} onChange={num('orbit', 'precession')} />
            <Slider label="SPEED" value={f.orbit.speed} min={0.02} max={1} format={(v) => `${f2(v)} rev/beat`} onChange={num('orbit', 'speed')} />
            <Slider label="DRIFT" value={f.orbit.drift} format={pct} onChange={num('orbit', 'drift')} />
            <Slider label="ENERGY" value={f.orbit.energy} min={0.5} max={0.999} format={f3} onChange={num('orbit', 'energy')} />
            <Slider label="MAX O" value={f.orbit.maxOrbiters} min={1} max={24} step={1} format={int} onChange={num('orbit', 'maxOrbiters')} />
            <div className="btns">
              <button className={'tgl' + (f.orbit.quadrantEvents ? ' on' : '')} onClick={() => setModel('orbit', { quadrantEvents: !f.orbit.quadrantEvents })}>
                quadrant events
              </button>
            </div>
          </>
        )}
        {s.perf.advanced && f.mode === 'wave' && (
          <>
            <Slider label="SOURCES" value={f.wave.sourceCount} min={1} max={6} step={1} format={int} onChange={num('wave', 'sourceCount')} />
            <Select
              label="ratios"
              value={RATIO_PRESETS.find((r) => r.ratios.length === f.wave.ratios.length && r.ratios.every((x, i) => Math.abs(x - f.wave.ratios[i]) < 1e-6))?.name ?? 'custom'}
              options={[{ value: 'custom', label: 'custom' }, ...RATIO_PRESETS.map((r) => ({ value: r.name, label: r.name }))]}
              onChange={(name) => {
                const r = RATIO_PRESETS.find((x) => x.name === name)
                if (r) setModel('wave', { ratios: [...r.ratios], sourceCount: Math.max(f.wave.sourceCount, r.ratios.length) })
              }}
            />
            <Slider label="RATE" value={f.wave.baseRate} min={0.02} max={2} format={(v) => `${f2(v)} /beat`} onChange={num('wave', 'baseRate')} />
            <Slider label="λ" value={f.wave.wavelength} min={0.1} max={2.5} onChange={num('wave', 'wavelength')} />
            <Slider label="SRC R" value={f.wave.sourceRadius} min={0} max={1} onChange={num('wave', 'sourceRadius')} />
            <Slider label="SRC ROT" value={f.wave.sourceRotation} min={0} max={1} onChange={num('wave', 'sourceRotation')} />
            <Slider label="PHASE" value={f.wave.phaseSpread} min={0} max={1} onChange={num('wave', 'phaseSpread')} />
            <Slider label="AMP" value={f.wave.amplitude} min={0} max={1} onChange={num('wave', 'amplitude')} />
            <Slider label="THRESH" value={f.wave.threshold} min={0.05} max={0.95} onChange={num('wave', 'threshold')} />
            <Segmented value={String(f.wave.expanding)} options={[{ value: '1', label: 'outward' }, { value: '-1', label: 'inward' }]} onChange={(v) => setModel('wave', { expanding: v === '1' ? 1 : -1 })} />
          </>
        )}
        {s.perf.advanced && f.mode === 'coupled' && (
          <>
            <Slider label="COUNT" value={f.coupled.count} min={1} max={16} step={1} format={int} onChange={num('coupled', 'count')} />
            <Slider label="K" value={f.coupled.coupling} min={0} max={2.5} onChange={num('coupled', 'coupling')} />
            <Slider label="SPREAD" value={f.coupled.spread} min={0} max={0.8} onChange={num('coupled', 'spread')} />
            <Slider label="PHASE" value={f.coupled.phaseSpread} min={0} max={1} onChange={num('coupled', 'phaseSpread')} />
            <Slider label="DRIFT" value={f.coupled.drift} min={0} max={0.5} onChange={num('coupled', 'drift')} />
            <Slider label="SYNC@" value={f.coupled.syncThreshold} min={0.1} max={0.99} onChange={num('coupled', 'syncThreshold')} />
            <Slider label="RATE" value={f.coupled.baseRate} min={0.02} max={2} format={(v) => `${f2(v)} /beat`} onChange={num('coupled', 'baseRate')} />
            <div className="btns">
              <button onClick={() => instrument.resetFlow()}>RESET PHASES</button>
            </div>
          </>
        )}
        {s.perf.advanced && f.mode === 'chaos' && (
          <>
            <Slider label="r" value={f.chaos.r} min={2.5} max={4} step={0.001} format={f3} onChange={num('chaos', 'r')} />
            <Slider label="x0" value={f.chaos.x0} min={0.01} max={0.99} onChange={num('chaos', 'x0')} />
            <Slider label="RATE" value={f.chaos.updateRate} min={0.25} max={16} format={(v) => `${f2(v)} /beat`} onChange={num('chaos', 'updateRate')} />
            <Slider label="SMOOTH" value={f.chaos.smoothing} min={0} max={0.95} onChange={num('chaos', 'smoothing')} />
            <Slider label="SENS." value={f.chaos.sensitivity} min={0.1} max={4} onChange={num('chaos', 'sensitivity')} />
            <Slider label="THRESH" value={f.chaos.threshold} min={0.05} max={0.95} onChange={num('chaos', 'threshold')} />
            <div className="btns">
              <button onClick={() => instrument.resetFlow()}>RESET x</button>
            </div>
          </>
        )}
        {s.perf.advanced && hasGates && (
          <div className="gates">
            <div className="row">
              <span className="lbl">GATES</span>
              <Slider label="" value={f.gates.length} min={1} max={12} step={1} format={int} onChange={(count) => setFlow({ gates: defaultGates(count, f.gates.map((g) => g.action)) })} />
            </div>
            <div className="gate-grid">
              {f.gates.map((g, i) => (
                <select key={g.id} value={g.action} title={`gate ${i} @ ${Math.round((g.angle * 180) / Math.PI)}°`} onChange={(e) => setFlow({ gates: f.gates.map((x) => (x.id === g.id ? { ...x, action: e.target.value as GateAction } : x)) })}>
                  {GATE_ACTIONS.map((a) => (
                    <option key={a} value={a}>
                      {GATE_ACTION_LABEL[a]} {a}
                    </option>
                  ))}
                </select>
              ))}
            </div>
          </div>
        )}
        {s.perf.advanced && f.mode !== 'manual' && (
          <>
            <Slider label="MAX n/s" value={f.limits.maxEventsPerSecond} min={1} max={48} step={1} format={int} onChange={(v) => setFlow({ limits: { ...f.limits, maxEventsPerSecond: v } })} />
            <Slider label="MAX/step" value={f.limits.maxEventsPerStep} min={1} max={12} step={1} format={int} onChange={(v) => setFlow({ limits: { ...f.limits, maxEventsPerStep: v } })} />
          </>
        )}
        <div className="row">
          <span className="lbl">seed</span>
          <input className="seed" type="number" value={f.seed} onChange={(e) => setFlow({ seed: Number(e.target.value) >>> 0 })} />
        </div>
      </Section>

      <Section title="TIME">
        <Slider label="BPM" value={s.time.bpm} min={30} max={200} step={1} format={int} onChange={(bpm) => instrument.setState((st) => ({ time: { ...st.time, bpm } }))} />
        <Segmented value={s.time.mode} options={[{ value: 'free', label: 'FREE' }, { value: 'soft', label: 'SOFT' }, { value: 'hard', label: 'HARD' }]} onChange={(mode) => instrument.setState((st) => ({ time: { ...st.time, mode } }))} />
        <Segmented value={s.time.quantize} options={QUANTIZE_VALUES.map((q) => ({ value: q, label: q }))} onChange={(quantize) => instrument.setState((st) => ({ time: { ...st.time, quantize } }))} />
      </Section>
    </aside>
  )
}
