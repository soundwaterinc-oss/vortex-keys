import { instrument, useInstrumentState } from '../state/useInstrument'
import { Section, Slider, Select, Segmented } from './controls'
import { SCALES, getScale } from '../core/tuning/scales'
import { midiToHz, midiToName } from '../core/tuning/tuning'
import { MODELS, MODEL_IDS, type Macros } from '../audio/models'
import { GATE_ACTIONS, GATE_ACTION_LABEL, defaultGates, type GateAction } from '../core/flow/gates'
import { QUANTIZE_VALUES } from '../core/clock/quantize'
import { WAVE_RATIO_PRESETS, componentsFromRatios } from '../core/flow/wave'
import { FACTORY_PRESETS } from '../core/preset/presets'
import type { FlowMode } from '../core/preset/types'

const pct = (v: number) => `${Math.round(v * 100)}%`

export function Panel() {
  const s = useInstrumentState()
  const scale = getScale(s.tuning.scaleId)

  const setMacro = (k: keyof Macros, v: number) =>
    instrument.setState((st) => ({ sound: { ...st.sound, macros: { ...st.sound.macros, [k]: v } } }))
  const setVortex = (k: string, v: number) =>
    instrument.setState((st) => ({ flow: { ...st.flow, vortex: { ...st.flow.vortex, [k]: v } } }))
  const setWave = (patch: Partial<typeof s.flow.wave>) =>
    instrument.setState((st) => ({ flow: { ...st.flow, wave: { ...st.flow.wave, ...patch } } }))

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
        <Slider
          label="root"
          value={s.tuning.rootMidi}
          min={24}
          max={72}
          step={1}
          format={(v) => `${midiToName(v)} ${midiToHz(v).toFixed(1)}Hz`}
          onChange={(m) => instrument.setState((st) => ({ tuning: { ...st.tuning, rootMidi: m, rootHz: midiToHz(m) } }))}
        />
        <Slider
          label="octaves"
          value={s.tuning.octaves}
          min={1}
          max={6}
          step={1}
          format={(v) => String(v)}
          onChange={(o) => instrument.setState((st) => ({ tuning: { ...st.tuning, octaves: o } }))}
        />
      </Section>

      <Section title="SOUND">
        <Select
          label="model"
          value={s.sound.model}
          options={MODEL_IDS.map((id) => ({ value: id, label: MODELS[id].name }))}
          onChange={(model) => instrument.setState((st) => ({ sound: { ...st.sound, model } }))}
        />
        {(['body', 'air', 'color', 'decay', 'space', 'motion'] as const).map((k) => (
          <Slider key={k} label={k.toUpperCase()} value={s.sound.macros[k]} format={pct} onChange={(v) => setMacro(k, v)} />
        ))}
      </Section>

      <Section title="FLOW">
        <Segmented<FlowMode>
          value={s.flow.mode}
          options={[
            { value: 'manual', label: 'MANUAL' },
            { value: 'vortex', label: 'VORTEX' },
            { value: 'wave', label: 'WAVE' },
          ]}
          onChange={(mode) => instrument.setState((st) => ({ flow: { ...st.flow, mode } }))}
        />
        <Slider
          label="FLOW"
          big
          value={s.flow.amount}
          format={pct}
          onChange={(amount) => instrument.setState((st) => ({ flow: { ...st.flow, amount } }))}
        />
        {s.flow.mode === 'vortex' && (
          <>
            <Slider label="SPIN" value={s.flow.vortex.spin} min={0.01} max={1.5} format={(v) => `${v.toFixed(2)} rev/beat`} onChange={(v) => setVortex('spin', v)} />
            <Slider label="PULL" value={s.flow.vortex.pull} min={0} max={0.25} format={(v) => v.toFixed(3)} onChange={(v) => setVortex('pull', v)} />
            <Slider label="DECAY" value={s.flow.vortex.decay} min={0.5} max={0.995} format={(v) => v.toFixed(3)} onChange={(v) => setVortex('decay', v)} />
            <Slider label="TURB." value={s.flow.vortex.turbulence} format={pct} onChange={(v) => setVortex('turbulence', v)} />
            <Slider label="DENSITY" value={s.flow.vortex.density} format={pct} onChange={(v) => setVortex('density', v)} />
            <Slider label="TEMPO" value={s.flow.vortex.tempoInfluence} format={pct} onChange={(v) => setVortex('tempoInfluence', v)} />
            <Slider label="ALPHA" value={s.flow.vortex.alpha} min={0} max={2.5} onChange={(v) => setVortex('alpha', v)} />
            <div className="gates">
              <div className="row">
                <span className="lbl">GATES</span>
                <Slider
                  label=""
                  value={s.flow.gates.length}
                  min={1}
                  max={12}
                  step={1}
                  format={(v) => String(v)}
                  onChange={(count) =>
                    instrument.setState((st) => ({
                      flow: { ...st.flow, gates: defaultGates(count, st.flow.gates.map((g) => g.action)) },
                    }))
                  }
                />
              </div>
              <div className="gate-grid">
                {s.flow.gates.map((g, i) => (
                  <select
                    key={g.id}
                    value={g.action}
                    title={`gate ${i} @ ${Math.round((g.angle * 180) / Math.PI)}°`}
                    onChange={(e) =>
                      instrument.setState((st) => ({
                        flow: { ...st.flow, gates: st.flow.gates.map((x) => (x.id === g.id ? { ...x, action: e.target.value as GateAction } : x)) },
                      }))
                    }
                  >
                    {GATE_ACTIONS.map((a) => (
                      <option key={a} value={a}>
                        {GATE_ACTION_LABEL[a]} {a}
                      </option>
                    ))}
                  </select>
                ))}
              </div>
            </div>
          </>
        )}
        {s.flow.mode === 'wave' && (
          <>
            <Select
              label="ratios"
              value={ratioName(s.flow.wave.components.map((c) => c.ratio))}
              options={[{ value: 'custom', label: 'custom' }, ...WAVE_RATIO_PRESETS.map((p) => ({ value: p.name, label: p.name }))]}
              onChange={(name) => {
                const p = WAVE_RATIO_PRESETS.find((x) => x.name === name)
                if (p) setWave({ components: componentsFromRatios(p.ratios) })
              }}
            />
            <Slider label="RATE" value={s.flow.wave.baseRate} min={0.02} max={2} format={(v) => `${v.toFixed(2)} /beat`} onChange={(v) => setWave({ baseRate: v })} />
            <Slider label="THRESH" value={s.flow.wave.threshold} min={0} max={0.98} onChange={(v) => setWave({ threshold: v })} />
            <Segmented
              value={s.flow.wave.direction}
              options={[
                { value: 'rising', label: '↑' },
                { value: 'falling', label: '↓' },
                { value: 'both', label: '↕' },
              ]}
              onChange={(direction) => setWave({ direction })}
            />
            {s.flow.wave.components.map((c, i) => (
              <div className="wave-comp" key={i}>
                <Slider
                  label={`f${i + 1}`}
                  value={c.ratio}
                  min={0.25}
                  max={8}
                  step={0.001}
                  format={(v) => v.toFixed(3)}
                  onChange={(v) => setWave({ components: s.flow.wave.components.map((x, k) => (k === i ? { ...x, ratio: v } : x)) })}
                />
                <Slider
                  label={`a${i + 1}`}
                  value={c.amplitude}
                  onChange={(v) => setWave({ components: s.flow.wave.components.map((x, k) => (k === i ? { ...x, amplitude: v } : x)) })}
                />
                <Slider
                  label={`φ${i + 1}`}
                  value={c.phase}
                  onChange={(v) => setWave({ components: s.flow.wave.components.map((x, k) => (k === i ? { ...x, phase: v } : x)) })}
                />
              </div>
            ))}
            <div className="btns">
              <button
                disabled={s.flow.wave.components.length >= 5}
                onClick={() => setWave({ components: [...s.flow.wave.components, { ratio: s.flow.wave.components.length + 1, amplitude: 0.5, phase: 0 }] })}
              >
                + wave
              </button>
              <button disabled={s.flow.wave.components.length <= 2} onClick={() => setWave({ components: s.flow.wave.components.slice(0, -1) })}>
                − wave
              </button>
            </div>
          </>
        )}
        <div className="row">
          <span className="lbl">seed</span>
          <input
            className="seed"
            type="number"
            value={s.flow.seed}
            onChange={(e) => instrument.setState((st) => ({ flow: { ...st.flow, seed: Number(e.target.value) >>> 0 } }))}
          />
        </div>
      </Section>

      <Section title="TIME">
        <Slider label="BPM" value={s.time.bpm} min={30} max={200} step={1} format={(v) => String(v)} onChange={(bpm) => instrument.setState((st) => ({ time: { ...st.time, bpm } }))} />
        <Segmented
          value={s.time.mode}
          options={[
            { value: 'free', label: 'FREE' },
            { value: 'soft', label: 'SOFT' },
            { value: 'hard', label: 'HARD' },
          ]}
          onChange={(mode) => instrument.setState((st) => ({ time: { ...st.time, mode } }))}
        />
        <Segmented value={s.time.quantize} options={QUANTIZE_VALUES.map((q) => ({ value: q, label: q }))} onChange={(quantize) => instrument.setState((st) => ({ time: { ...st.time, quantize } }))} />
      </Section>

    </aside>
  )
}

function ratioName(ratios: number[]): string {
  const p = WAVE_RATIO_PRESETS.find((x) => x.ratios.length === ratios.length && x.ratios.every((r, i) => Math.abs(r - ratios[i]) < 1e-6))
  return p?.name ?? 'custom'
}
