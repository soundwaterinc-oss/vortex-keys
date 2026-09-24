import { machine, useMachineState } from '../state/useMachine'

export function Transport() {
  const s = useMachineState()
  return (
    <div className="transport">
      <button
        className={s.playing ? 'tgl on' : 'tgl'}
        onClick={() => (s.playing ? machine.stop() : machine.play())}
      >
        {s.playing ? '■ STOP' : '▶ PLAY'}
      </button>
      <button onClick={() => machine.rewind()}>REWIND</button>
      <span className="gap" />
      <label className="bpm">
        <span>BPM</span>
        <input
          type="number"
          min={40}
          max={200}
          value={s.bpm}
          onChange={(e) => machine.setState({ bpm: Math.min(200, Math.max(40, Number(e.target.value) || 120)) })}
        />
      </label>
      <label className="bpm">
        <span>SWING</span>
        <input type="range" min={0} max={0.6} step={0.01} value={s.swing} onChange={(e) => machine.setState({ swing: Number(e.target.value) })} />
      </label>
      <span className="gap" />
      <button onClick={() => machine.randomize()}>RANDOMIZE</button>
      <button onClick={() => machine.clear()}>CLEAR</button>
    </div>
  )
}
