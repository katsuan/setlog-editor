import type { LogEntry, ProjectState } from '../types'
import { formatSrtTimecode } from './time'

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function exportJson(project: ProjectState) {
  download(
    `${project.videoName || 'setlog'}.json`,
    JSON.stringify(project, null, 2),
    'application/json',
  )
}

export function exportSrt(entries: LogEntry[], baseName: string) {
  const sorted = [...entries].sort((a, b) => a.time - b.time)
  const body = sorted
    .map((entry, i) => {
      const start = formatSrtTimecode(entry.time)
      const endTime = sorted[i + 1] ? sorted[i + 1].time : entry.time + 3
      const end = formatSrtTimecode(endTime)
      return `${i + 1}\n${start} --> ${end}\n${entry.caption}\n`
    })
    .join('\n')
  download(`${baseName || 'setlog'}.srt`, body, 'text/plain')
}

export function exportCsv(entries: LogEntry[], baseName: string) {
  const sorted = [...entries].sort((a, b) => a.time - b.time)
  const escape = (s: string) => `"${s.replace(/"/g, '""')}"`
  const header = 'time_seconds,caption\n'
  const rows = sorted.map((e) => `${e.time.toFixed(3)},${escape(e.caption)}`).join('\n')
  download(`${baseName || 'setlog'}.csv`, header + rows, 'text/csv')
}
