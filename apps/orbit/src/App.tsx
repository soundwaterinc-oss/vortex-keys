import { Panel } from './Panel'
import { OrbitCanvas } from './OrbitCanvas'

export function App() {
  return (
    <div className="app">
      <Panel />
      <main className="stage">
        <OrbitCanvas />
      </main>
    </div>
  )
}
