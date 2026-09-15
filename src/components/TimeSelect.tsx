const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'))
const MINUTES = ['00', '30']

interface Props {
  value: string
  onChange: (value: string) => void
  className?: string
  id?: string
  autoFocus?: boolean
}

export default function TimeSelect({ value, onChange, className, id, autoFocus }: Props) {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  const hour = match ? match[1] : ''
  const minute = match && MINUTES.includes(match[2]) ? match[2] : ''

  const emit = (h: string, m: string) => {
    onChange(h && m ? `${h}:${m}` : '')
  }

  return (
    <span className={className ? `${className} time-select` : 'time-select'} id={id}>
      <select
        className="time-select-hour"
        value={hour}
        onChange={(e) => emit(e.target.value, minute || '00')}
        autoFocus={autoFocus}
      >
        <option value="">--</option>
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span className="time-select-colon">:</span>
      <select
        className="time-select-minute"
        value={minute}
        onChange={(e) => emit(hour || '00', e.target.value)}
      >
        <option value="">--</option>
        {MINUTES.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </span>
  )
}
