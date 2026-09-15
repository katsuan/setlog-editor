import type { LogEntry } from '../types'
import { formatTimecode } from '../utils/time'
import TimeSelect from './TimeSelect'

interface Props {
  entries: LogEntry[]
  activeId: string | null
  onSeek: (time: number) => void
  onPreview: (time: number) => void
  onChangeClockTime: (id: string, clockTime: string) => void
  onChangeCaption: (id: string, caption: string) => void
  onDelete: (id: string) => void
  exportedIds: Set<string>
  exportingEntryId: string | null
  onExport: (entry: LogEntry) => void
  onSaveExported: (id: string) => void
}

export default function LogList({
  entries,
  activeId,
  onSeek,
  onPreview,
  onChangeClockTime,
  onChangeCaption,
  onDelete,
  exportedIds,
  exportingEntryId,
  onExport,
  onSaveExported,
}: Props) {
  const sorted = [...entries].sort((a, b) => a.time - b.time)

  if (sorted.length === 0) {
    return <p className="log-empty">まだカットがありません。再生中に「ここでマーク」を押してください。</p>
  }

  return (
    <ul className="log-list">
      {sorted.map((entry) => {
        const done = exportedIds.has(entry.id)
        return (
          <li key={entry.id} className={entry.id === activeId ? 'log-item active' : 'log-item'}>
            <button className="log-time" onClick={() => onSeek(entry.time)} title="この時間に移動">
              {formatTimecode(entry.time)}
            </button>
            <button
              className="log-preview"
              onClick={() => onPreview(entry.time)}
              title="このカット範囲（2秒）を再生"
            >
              ▶︎ プレビュー
            </button>
            <TimeSelect
              className="log-clock-time"
              value={entry.clockTime}
              onChange={(v) => onChangeClockTime(entry.id, v)}
              autoFocus={entry.id === activeId}
            />
            <input
              className="log-caption"
              value={entry.caption}
              placeholder="キャプションを入力..."
              onChange={(e) => onChangeCaption(entry.id, e.target.value)}
            />
            <button onClick={() => onExport(entry)} disabled={exportingEntryId === entry.id}>
              {exportingEntryId === entry.id ? '書き出し中…' : done ? '再書き出し' : '2秒動画にする'}
            </button>
            {done && (
              <>
                <span className="clip-done">✓ 済み</span>
                <button onClick={() => onSaveExported(entry.id)}>保存</button>
              </>
            )}
            <button className="log-delete" onClick={() => onDelete(entry.id)} title="削除" aria-label="削除">
              ✕
            </button>
          </li>
        )
      })}
    </ul>
  )
}
