import { generateTimeOptions } from '../utils/time'

const TIME_OPTIONS = generateTimeOptions()

interface Props {
  value: string
  onChange: (value: string) => void
  className?: string
  id?: string
  autoFocus?: boolean
}

export default function TimeSelect({ value, onChange, className, id, autoFocus }: Props) {
  return (
    <select
      id={id}
      className={className}
      value={TIME_OPTIONS.includes(value) ? value : ''}
      onChange={(e) => onChange(e.target.value)}
      autoFocus={autoFocus}
    >
      <option value="">未設定</option>
      {TIME_OPTIONS.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  )
}
