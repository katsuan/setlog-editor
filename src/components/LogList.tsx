import type { LogEntry } from '../types'
import { formatTimecode } from '../utils/time'

interface Props {
  entries: LogEntry[]
  activeId: string | null
  onSeek: (time: number) => void
  onChangeCaption: (id: string, caption: string) => void
  onDelete: (id: string) => void
}

export default function LogList({ entries, activeId, onSeek, onChangeCaption, onDelete }: Props) {
  const sorted = [...entries].sort((a, b) => a.time - b.time)

  if (sorted.length === 0) {
    return <p className="log-empty">まだログがありません。再生中に「ここでマーク」を押してください。</p>
  }

  return (
    <ul className="log-list">
      {sorted.map((entry) => (
        <li key={entry.id} className={entry.id === activeId ? 'log-item active' : 'log-item'}>
          <button className="log-time" onClick={() => onSeek(entry.time)} title="この時間に移動">
            {formatTimecode(entry.time)}
          </button>
          <input
            className="log-caption"
            value={entry.caption}
            placeholder="キャプションを入力..."
            onChange={(e) => onChangeCaption(entry.id, e.target.value)}
            autoFocus={entry.id === activeId}
          />
          <button className="log-delete" onClick={() => onDelete(entry.id)} title="削除" aria-label="削除">
            ✕
          </button>
        </li>
      ))}
    </ul>
  )
}
