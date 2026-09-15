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

/** Adds minutesToAdd to a "HH:MM" clock time, returning "HH:MM" (wraps at 24h). */
export function addMinutesToClock(base: string, minutesToAdd: number): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(base.trim())
  if (!match) return ''
  const [, hStr, mStr] = match
  const totalMinutes = (parseInt(hStr, 10) * 60 + parseInt(mStr, 10) + Math.round(minutesToAdd) + 24 * 60 * 100) % (24 * 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
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
