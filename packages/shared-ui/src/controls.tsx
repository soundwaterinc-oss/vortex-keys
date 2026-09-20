import type { ReactNode } from 'react'

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sec">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

export function Slider({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.001,
  onChange,
  format,
  big,
}: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (v: number) => void
  format?: (v: number) => string
  big?: boolean
}) {
  return (
    <label className={'row' + (big ? ' big' : '')}>
      <span className="lbl">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="val">{format ? format(value) : value.toFixed(2)}</span>
    </label>
  )
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <label className="row">
      <span className="lbl">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function Toggle({ label, on, onChange, hot }: { label: string; on: boolean; onChange: (v: boolean) => void; hot?: boolean }) {
  return (
    <button className={'tgl' + (on ? ' on' : '') + (hot ? ' hot' : '')} onClick={() => onChange(!on)}>
      {label}
    </button>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
