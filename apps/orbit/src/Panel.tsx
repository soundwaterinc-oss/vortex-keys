import { Section, Slider, Select, Segmented } from '@el-systema/shared-ui'
import { SCALES, QUANTIZE_VALUES, midiToHz, midiToName } from '@el-systema/core'
import { engine, useOrbitState } from './store'
import { ORBIT_MAPPINGS } from './mappings'

export function Panel() {
  const s = useOrbitState()
  const rootMidi = Math.round(69 + 12 * Math.log2(s.rootHz / 440))
  return (
    <aside className="panel">
      <header className="brand">
        <h1>ORBIT</h1>
        <div className="sub">celestial mechanical sequencer · prototype</div>
        <nav className="family">
          <a href="../">VORTEX KEYS</a>
          <a className="here" href="./">ORBIT</a>
        </nav>
        {!engine.audioReady && (
          <button className="start" onClick={() => engine.start()}>
            ▶ start audio
          </button>
        )}
      </header>
      <p className="hint">Click the dial to launch a body. Its pitch is the degree axis you clicked, its orbit size the distance from the centre. Every gate crossing is a hit.</p>

      <Section title="TIME (shared clock)">
        <Slider label="BPM" value={s.bpm} min={40} max={200} step={1} format={(v) => String(v)} onChange={(bpm) => engine.setState({ bpm })} />
        <Segmented value={s.timing} options={[{ value: 'free', label: 'FREE' }, { value: 'soft', label: 'SOFT' }, { value: 'hard', label: 'HARD' }]} onChange={(timing) => engine.setState({ timing })} />
        <Segmented value={s.quantize} options={QUANTIZE_VALUES.map((q) => ({ value: q, label: q }))} onChange={(quantize) => engine.setState({ quantize })} />
      </Section>

      <Section title="TUNING (shared)">
        <Select label="scale" value={s.scaleId} options={SCALES.map((sc) => ({ value: sc.id, label: `${sc.name} (${sc.cents.length})` }))} onChange={(scaleId) => engine.setState({ scaleId })} />
        <Slider label="root" value={rootMidi} min={24} max={72} step={1} format={(v) => `${midiToName(v)} ${midiToHz(v).toFixed(1)}Hz`} onChange={(m) => engine.setState({ rootHz: midiToHz(m) })} />
      </Section>

      <Section title="ORBIT">
        <Slider label="ECC." value={s.eccentricity} min={0} max={0.9} onChange={(eccentricity) => engine.setState({ eccentricity })} />
        <Slider label="SPEED" value={s.speed} min={0.05} max={1} format={(v) => `${v.toFixed(2)} rev/beat`} onChange={(speed) => engine.setState({ speed })} />
        <Slider label="GATES" value={s.gateCount} min={1} max={8} step={1} format={(v) => String(v)} onChange={(gateCount) => engine.setState({ gateCount })} />
        <Select label="mapping" value={s.mappingId} options={ORBIT_MAPPINGS.map((m) => ({ value: m.id, label: m.name }))} onChange={(mappingId) => engine.setState({ mappingId })} />
        <p className="hint">{ORBIT_MAPPINGS.find((m) => m.id === s.mappingId)?.description}</p>
        <div className="btns">
          <button onClick={() => engine.clear()}>CLEAR</button>
        </div>
      </Section>
    </aside>
  )
}
