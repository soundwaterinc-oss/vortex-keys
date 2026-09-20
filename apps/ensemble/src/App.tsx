import { useEffect, useState } from 'react'
import { InstrumentContext, SpiralCanvas, useInstrumentState } from '@el-systema/vortex-keys'
import { OrbitContext, OrbitCanvas, useOrbitState, ORBIT_MAPPINGS } from '@el-systema/orbit'
import { Slider, Select, Toggle, Segmented } from '@el-systema/shared-ui'
import { SCALES, QUANTIZE_VALUES, midiToHz, midiToName, getScale } from '@el-systema/core'
import { MODELS, MODEL_IDS } from '@el-systema/audio'
import { MAPPING_PRESETS } from '@el-systema/mapping'
import { ensemble, useEnsembleUi, useHostState } from './store'

const pct = (v: number) => `${Math.round(v * 100)}%`

export function App() {
  return (
    <InstrumentContext.Provider value={ensemble.vortex}>
      <OrbitContext.Provider value={ensemble.orbit}>
        <div className="ens">
          <TopBar />
          <section className="pane vortex">
            <header>
              <span>VORTEX KEYS</span>
              <span className="role">melody · free timing</span>
            </header>
            <SpiralCanvas />
          </section>
          <section className="pane orbit">
            <header>
              <span>ORBIT</span>
              <span className="role">rhythm · tempo-synced</span>
            </header>
            <OrbitCanvas />
            <TransferPulse />
          </section>
          <BottomPanel />
        </div>
      </OrbitContext.Provider>
    </InstrumentContext.Provider>
  )
}

function TopBar() {
  const ui = useEnsembleUi()
  const g = useHostState()
  const v = useInstrumentState()
  const tuningId = g?.tuningId ?? v.tuning.scaleId
  const rootHz = g?.rootFrequency ?? v.tuning.rootHz
  const rootMidi = Math.round(69 + 12 * Math.log2(rootHz / 440))
  const bpm = g?.tempo ?? 112
  const seed = g?.seed ?? v.flow.seed
  const setTuning = (id: string, hz: number) => {
    if (ensemble.host) ensemble.host.setTuning(id, hz)
    else ensemble.vortex.setState((s) => ({ tuning: { ...s.tuning, scaleId: id, rootHz: hz, rootMidi: Math.round(69 + 12 * Math.log2(hz / 440)) } }))
  }
  return (
    <header className="top">
      <div className="brand">
        <h1>EL-SYSTEMA ENSEMBLE</h1>
        <nav className="family">
          <a href="../">VORTEX KEYS</a>
          <a href="../orbit/">ORBIT</a>
          <a className="here" href="./">ENSEMBLE</a>
        </nav>
      </div>
      {!ui.started ? (
        <button className="start" onClick={() => ensemble.start()}>
          ▶ start audio
        </button>
      ) : (
        <button className={'tgl' + (ui.playing ? ' on' : '')} onClick={() => ensemble.togglePlay()}>
          {ui.playing ? 'PLAYING' : 'PAUSED'}
        </button>
      )}
      <button onClick={() => ensemble.reset()}>RESET</button>
      <div className="top-ctl">
        <span className="lbl">BPM</span>
        <input type="range" min={40} max={200} step={1} value={bpm} onChange={(e) => ensemble.host?.setTempo(Number(e.target.value))} disabled={!ui.started} />
        <span className="val">{bpm}</span>
      </div>
      <div className="top-ctl wide">
        <span className="lbl">TUNING</span>
        <select value={tuningId} onChange={(e) => setTuning(e.target.value, rootHz)}>
          {SCALES.map((sc) => (
            <option key={sc.id} value={sc.id}>
              {sc.name} ({sc.cents.length})
            </option>
          ))}
        </select>
      </div>
      <div className="top-ctl">
        <span className="lbl">ROOT</span>
        <input type="range" min={24} max={72} step={1} value={rootMidi} onChange={(e) => setTuning(tuningId, midiToHz(Number(e.target.value)))} />
        <span className="val">{midiToName(rootMidi)}</span>
      </div>
      <div className="top-ctl">
        <span className="lbl">SEED</span>
        <input className="seed" type="number" value={seed} onChange={(e) => ensemble.host?.setSeed(Number(e.target.value) >>> 0)} disabled={!ui.started} />
      </div>
      <Toggle label="DIAG" on={ui.diagnostics} onChange={(v) => ensemble.setUi({ diagnostics: v })} />
    </header>
  )
}

/** A short pulse in the ORBIT header when a VORTEX note has just been routed: the note "arriving". */
function TransferPulse() {
  const [, force] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => force((x) => x + 1), 100)
    return () => window.clearInterval(id)
  }, [])
  const now = ensemble.host?.audio.currentTime ?? 0
  const recent = ensemble.transfers.filter((t) => now - t.t < 0.7)
  if (!recent.length) return null
  const last = recent[recent.length - 1]
  const k = Math.min(1, (now - last.t) / 0.7)
  return (
    <div className="transfer" style={{ opacity: 1 - k }}>
      ← deg {last.degree} · oct {last.octave}
    </div>
  )
}

function BottomPanel() {
  const ui = useEnsembleUi()
  const r = ui.routing
  const m = ui.mix
  const v = useInstrumentState()
  const o = useOrbitState()
  const n = getScale(v.tuning.scaleId).cents.length
  return (
    <footer className="bottom">
      <div className="col">
        <h2>ROUTING</h2>
        <div className="btns">
          <Toggle label="VORTEX → ORBIT" on={r.vortexToOrbit} hot onChange={(on) => ensemble.setRouting({ vortexToOrbit: on })} />
          <Toggle label="PITCH FOLLOW" on={r.pitchFollow} onChange={(on) => ensemble.setRouting({ pitchFollow: on })} />
        </div>
        <Slider label="SPAWN" value={r.spawnAmount} format={pct} onChange={(spawnAmount) => ensemble.setRouting({ spawnAmount })} />
        <Slider label="VEL→ENERGY" value={r.velocityToEnergy} format={pct} onChange={(velocityToEnergy) => ensemble.setRouting({ velocityToEnergy })} />
        <p className="hint">played note → body with the same degree/octave; octave → orbit size (higher = faster recurrence); energy → eccentricity, speed, lifetime.</p>
      </div>
      <div className="col">
        <h2>MIX</h2>
        <div className="mixrow">
          <Toggle label={m.vortexMute ? 'MUTED' : 'VORTEX'} on={!m.vortexMute} onChange={(on) => ensemble.setMix({ vortexMute: !on })} />
          <Slider label="" value={m.vortexLevel} max={1.2} format={pct} onChange={(vortexLevel) => ensemble.setMix({ vortexLevel })} />
        </div>
        <div className="mixrow">
          <Toggle label={m.orbitMute ? 'MUTED' : 'ORBIT'} on={!m.orbitMute} onChange={(on) => ensemble.setMix({ orbitMute: !on })} />
          <Slider label="" value={m.orbitLevel} max={1.2} format={pct} onChange={(orbitLevel) => ensemble.setMix({ orbitLevel })} />
        </div>
        <Slider label="MASTER" value={m.master} max={1} format={pct} onChange={(master) => ensemble.setMix({ master })} />
      </div>
      <div className="col">
        <h2>
          <button className="adv" onClick={() => ensemble.setUi({ advanced: !ui.advanced })}>
            {ui.advanced ? '▾' : '▸'} INSTRUMENTS
          </button>
        </h2>
        {ui.advanced && (
          <div className="adv-grid">
            <div>
              <div className="sub">VORTEX KEYS</div>
              <Select label="sound" value={v.sound.model} options={MODEL_IDS.map((id) => ({ value: id, label: MODELS[id].name }))} onChange={(model) => ensemble.vortex.setState((s) => ({ sound: { ...s.sound, model, layers: [model] } }))} />
              <Select label="mapping" value={v.flow.mappingId} options={MAPPING_PRESETS.map((mp) => ({ value: mp.id, label: mp.name }))} onChange={(mappingId) => ensemble.vortex.setState((s) => ({ flow: { ...s.flow, mappingId } }))} />
              <Slider label="FLOW" value={v.flow.amount} format={pct} onChange={(amount) => ensemble.vortex.setState((s) => ({ flow: { ...s.flow, amount } }))} />
              <Segmented value={v.time.mode} options={[{ value: 'free', label: 'FREE' }, { value: 'soft', label: 'SOFT' }, { value: 'hard', label: 'HARD' }]} onChange={(mode) => ensemble.vortex.setState((s) => ({ time: { ...s.time, mode } }))} />
            </div>
            <div>
              <div className="sub">ORBIT</div>
              <Select label="sound" value={o.sound} options={(['wood', 'glass', 'pluck', 'breath'] as const).map((id) => ({ value: id, label: MODELS[id].name }))} onChange={(sound) => ensemble.orbit.setState({ sound })} />
              <Select label="mapping" value={o.mappingId} options={ORBIT_MAPPINGS.map((mp) => ({ value: mp.id, label: mp.name }))} onChange={(mappingId) => ensemble.orbit.setState({ mappingId })} />
              <Slider label="ECC." value={o.eccentricity} min={0} max={0.9} onChange={(eccentricity) => ensemble.orbit.setState({ eccentricity })} />
              <Slider label="SPEED" value={o.speed} min={0.05} max={1} format={(x) => `${x.toFixed(2)} rev/beat`} onChange={(speed) => ensemble.orbit.setState({ speed })} />
              <Slider label="GATES" value={o.gateCount} min={1} max={8} step={1} format={(x) => String(x)} onChange={(gateCount) => ensemble.orbit.setState({ gateCount })} />
              <Slider label="MAX" value={o.maxBodies} min={1} max={16} step={1} format={(x) => String(x)} onChange={(maxBodies) => ensemble.orbit.setState({ maxBodies })} />
              <Segmented value={o.timing} options={[{ value: 'free', label: 'FREE' }, { value: 'soft', label: 'SOFT' }, { value: 'hard', label: 'HARD' }]} onChange={(timing) => ensemble.orbit.setState({ timing })} />
              <Segmented value={o.quantize} options={QUANTIZE_VALUES.map((q) => ({ value: q, label: q }))} onChange={(quantize) => ensemble.orbit.setState({ quantize })} />
            </div>
          </div>
        )}
        {!ui.advanced && <p className="hint">{n}-degree scale · VORTEX {v.time.mode.toUpperCase()} · ORBIT {o.timing.toUpperCase()} {o.quantize}</p>}
      </div>
      {ui.diagnostics && <Diagnostics />}
    </footer>
  )
}

function Diagnostics() {
  const ui = useEnsembleUi()
  const [d, setD] = useState(ensemble.diagnostics())
  useEffect(() => {
    const id = window.setInterval(() => setD(ensemble.diagnostics()), 250)
    return () => window.clearInterval(id)
  }, [])
  return (
    <div className="col diag">
      <h2>DIAGNOSTICS</h2>
      <div className="diag-grid">
        <span>audio</span><b>{d.audioState} · {d.contexts} ctx</b>
        <span>voices</span><b>{d.voices}</b>
        <span>vortex particles</span><b>{d.vortexParticles}</b>
        <span>orbit bodies</span><b>{d.orbitBodies}</b>
        <span>physics/s</span><b>{d.physicsPerSec}</b>
        <span>notes/s</span><b>{d.notesPerSec}</b>
        <span>queue</span><b>{d.queue}</b>
        <span>routed / dropped</span><b>{d.routed} / {d.droppedByGeneration}</b>
        <span>seed</span><b>{d.seed}</b>
        <span>bpm</span><b>{d.bpm}</b>
        <span>tuning</span><b>{d.tuning}</b>
      </div>
      <div className="log">
        {ui.log.map((l, i) => (
          <div key={i}>
            <span>{l.t.toFixed(2)}</span> {l.type} <i>g{l.gen}</i>
          </div>
        ))}
      </div>
    </div>
  )
}
