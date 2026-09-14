export function formatTimecode(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds)
  const h = Math.floor(clamped / 3600)
  const m = Math.floor((clamped % 3600) / 60)
  const s = Math.floor(clamped % 60)
  const ms = Math.floor((clamped - Math.floor(clamped)) * 1000)
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  if (h > 0) {
    return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`
  }
  return `${pad(m)}:${pad(s)}.${pad(ms, 3)}`
}

export function formatSrtTimecode(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds)
  const h = Math.floor(clamped / 3600)
  const m = Math.floor((clamped % 3600) / 60)
  const s = Math.floor(clamped % 60)
  const ms = Math.floor((clamped - Math.floor(clamped)) * 1000)
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`
}
