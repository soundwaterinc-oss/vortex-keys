import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'
import { connectField } from './field'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// 卓（EL-SYSTEMA Live）から見えるよう、?field の時だけ場へ参加する
connectField()
