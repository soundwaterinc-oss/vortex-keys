import type React from 'react'
import { Section, Select, Slider, Toggle } from '@el-systema/shared-ui'
import { machine, useMachineState } from '../state/useMachine'
import { KITS, KIT_IDS } from '../audio/kits'
import { TRACKS, TRACK_LABEL } from '../engine/pattern'
import { HUE } from '../viz/render'

const pct = (v: number) => `${Math.round(v * 100)}%`
const semi = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)} st`

export function Panel() {
  const s = useMachineState()
  const kit = KITS[s.kit]
  const macro = (k: keyof typeof s.macros, v: number) => machine.setState((st) => ({ macros: { ...st.macros, [k]: v } }))
  const spiral = (patch: Partial<typeof s.spiral>) => machine.setState((st) => ({ spiral: { ...st.spiral, ...patch } }))

  return (
    <aside className="panel">
      <div className="brand">
        <h1>SPIRA</h1>
        <div className="sub">螺旋鼓 / spiral drum</div>
        <nav className="family">
          <a href="../">VORTEX KEYS</a>
          <a href="../orbit/">ORBIT</a>
          <a className="here" href="./">SPIRA</a>
        </nav>
      </div>

      {!machine.audioReady && (
        <button className="start" onClick={() => machine.start()}>
          START AUDIO
        </button>
      )}

      <Section title="KIT">
        <Select
          label="kit"
          value={s.kit}
          options={KIT_IDS.map((id) => ({ value: id, label: KITS[id].name }))}
          onChange={(k) => {
            machine.setState({ kit: k })
            machine.loadKitPattern(k)
          }}
        />
        <p className="hint">{kit.description}</p>
        <p className="hint">
          WEIGHT puts a sub layer under every voice, lengthens the bodies and lifts the low end. PUNCH hardens the beater, shortens the
          body and deepens the duck under every kick.
        </p>
        <Slider label="TUNE" value={s.macros.tune} min={-12} max={12} step={0.5} format={semi} onChange={(v) => macro('tune', v)} />
        <Slider label="WEIGHT" value={s.macros.weight} format={pct} big onChange={(v) => macro('weight', v)} />
        <Slider label="PUNCH" value={s.macros.punch} format={pct} big onChange={(v) => macro('punch', v)} />
        <Slider label="GRIT" value={s.macros.grit} format={pct} onChange={(v) => macro('grit', v)} />
        <Slider label="DECAY" value={s.macros.decay} format={pct} onChange={(v) => macro('decay', v)} />
        <Slider label="SPACE" value={s.macros.space} format={pct} onChange={(v) => macro('space', v)} />
        <Slider label="LEVEL" value={s.macros.level} format={pct} onChange={(v) => macro('level', v)} />
      </Section>

      <Section title="SPIRAL">
        <p className="hint">
          Five axes turning at once, none of them in step: the figure drifts and rotates over {s.spiral.turns} turns (DRIFT, ROTATE), each
          track runs its own cycle length (POLY), and timing, pitch and distortion swing on periods of 3, 5 and 7 turns (WARP, BEND, FOLD).
          They only all line up again after a very long time.
        </p>
        <Slider label="DRIFT" value={s.spiral.drift} format={pct} big onChange={(v) => spiral({ drift: v })} />
        <Slider label="POLY" value={s.spiral.poly} format={pct} big onChange={(v) => spiral({ poly: v })} />
        <Slider label="WARP" value={s.spiral.warp} format={pct} onChange={(v) => spiral({ warp: v })} />
        <Slider label="BEND" value={s.spiral.bend} format={pct} onChange={(v) => spiral({ bend: v })} />
        <Slider label="FOLD" value={s.spiral.fold} format={pct} onChange={(v) => spiral({ fold: v })} />
        <Slider label="DENSITY" value={s.spiral.density} format={pct} onChange={(v) => spiral({ density: v })} />
        <Slider label="ROTATE" value={s.spiral.rotate} min={-4} max={4} step={1} format={(v) => `${v > 0 ? '+' : ''}${v} st/turn`} onChange={(v) => spiral({ rotate: v })} />
        <Slider label="TURNS" value={s.spiral.turns} min={1} max={6} step={1} format={(v) => String(v)} onChange={(v) => spiral({ turns: v })} />
        <Slider label="GRID" value={s.spiral.stepsPerTurn} min={8} max={24} step={4} format={(v) => `${v}/bar`} onChange={(v) => spiral({ stepsPerTurn: v })} />
        <Slider label="SEED" value={s.spiral.seed} min={0} max={999} step={1} format={(v) => String(v)} onChange={(v) => spiral({ seed: v })} />
      </Section>

      <Section title="TRACKS">
        <p className="hint">Click the spiral to place a step on the track you are editing.</p>
        <div className="tracks">
          {TRACKS.map((t) => (
            <div key={t} className="track-row">
              <button
                className={'chip' + (s.editing === t ? ' on' : '')}
                // the chip carries the colour the canvas draws that track in
                style={{ '--tone': `hsl(${HUE[t]},80%,62%)` } as React.CSSProperties}
                onClick={() => machine.setState({ editing: t })}
              >
                <i className="dot" />
                {TRACK_LABEL[t]}
              </button>
              <Toggle label="MUTE" on={s.mutes[t]} onChange={(v) => machine.setState((st) => ({ mutes: { ...st.mutes, [t]: v } }))} />
            </div>
          ))}
        </div>
      </Section>
    </aside>
  )
}
