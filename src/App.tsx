import { Panel } from './ui/Panel'
import { SpiralCanvas } from './ui/SpiralCanvas'
import { Transport } from './ui/Transport'

export function App() {
  return (
    <div className="app">
      <Panel />
      <main className="stage">
        <Transport />
        <SpiralCanvas />
      </main>
    </div>
  )
}
