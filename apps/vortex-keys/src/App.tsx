import { Panel } from './ui/Panel'
import { SpiralCanvas } from './ui/SpiralCanvas'
import { Transport } from './ui/Transport'
import { Monitor } from './ui/Monitor'

export function App() {
  return (
    <div className="app">
      <Panel />
      <main className="stage">
        <Transport />
        <SpiralCanvas />
        <Monitor />
      </main>
    </div>
  )
}
