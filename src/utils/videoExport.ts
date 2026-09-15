import type { LogEntry } from '../types'
import { formatTimecode } from './time'

interface ActiveEntry {
  entry: LogEntry
  endTime: number
}

function findActiveEntry(sorted: LogEntry[], t: number): ActiveEntry | null {
  let found: LogEntry | null = null
  let next: LogEntry | null = null
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].time <= t) {
      found = sorted[i]
      next = sorted[i + 1] ?? null
    }
  }
  if (!found) return null
  const endTime = next ? next.time : found.time + 3
  if (t >= endTime) return null
  return { entry: found, endTime }
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  title: string,
  sorted: LogEntry[],
) {
  const w = canvas.width
  const h = canvas.height
  ctx.drawImage(video, 0, 0, w, h)

  // title bar (top)
  if (title) {
    const barH = Math.round(h * 0.12)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
    ctx.fillRect(0, 0, w, barH)
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `bold ${Math.round(barH * 0.42)}px "Hiragino Sans", "Yu Gothic", sans-serif`
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = Math.round(barH * 0.12)
    ctx.fillText(title, w / 2, barH / 2, w * 0.92)
    ctx.shadowBlur = 0
  }

  // time + caption overlay
  const active = findActiveEntry(sorted, video.currentTime)
  if (active) {
    const timeText = formatTimecode(active.entry.time)
    const captionText = active.entry.caption
    const centerY = h * 0.45
    const timeFontSize = Math.round(w * 0.09)
    const captionFontSize = Math.round(w * 0.06)
    const lineGap = Math.round(timeFontSize * 0.9)

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    ctx.font = `bold ${timeFontSize}px "Hiragino Sans", "Yu Gothic", sans-serif`
    ctx.fillStyle = '#ffffff'
    ctx.shadowColor = 'rgba(0,0,0,0.7)'
    ctx.shadowBlur = Math.round(timeFontSize * 0.15)
    ctx.fillText(timeText, w / 2, centerY)

    if (captionText) {
      ctx.font = `bold ${captionFontSize}px "Hiragino Sans", "Yu Gothic", sans-serif`
      ctx.fillText(captionText, w / 2, centerY + lineGap, w * 0.9)
    }
    ctx.shadowBlur = 0
  }
}

export interface ExportOptions {
  onProgress?: (ratio: number) => void
}

export async function renderOverlayVideo(
  video: HTMLVideoElement,
  entries: LogEntry[],
  title: string,
  options: ExportOptions = {},
): Promise<Blob> {
  if (!video.duration || !Number.isFinite(video.duration)) {
    throw new Error('動画の長さを取得できませんでした')
  }
  const sorted = [...entries].sort((a, b) => a.time - b.time)

  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context を取得できませんでした')

  const fps = 30
  const canvasStream = canvas.captureStream(fps)

  const captureVideo = video as HTMLVideoElement & {
    captureStream?: () => MediaStream
  }
  const audioSourceStream = captureVideo.captureStream?.()
  const audioTrack = audioSourceStream?.getAudioTracks()[0]
  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...(audioTrack ? [audioTrack] : []),
  ])

  const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    .find((t) => MediaRecorder.isTypeSupported(t))
  if (!mimeType) throw new Error('このブラウザは WebM の書き出しに対応していません')

  const recorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: 8_000_000 })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  const wasMuted = video.muted
  const wasTime = video.currentTime

  return new Promise<Blob>((resolve, reject) => {
    let rafId = 0
    let stopped = false

    const cleanup = () => {
      cancelAnimationFrame(rafId)
      video.removeEventListener('ended', onEnded)
      video.muted = wasMuted
      video.currentTime = wasTime
    }

    const onEnded = () => {
      if (stopped) return
      stopped = true
      cleanup()
      recorder.stop()
    }

    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: mimeType }))
    }
    recorder.onerror = (e) => {
      cleanup()
      reject(e)
    }

    const tick = () => {
      if (stopped) return
      drawFrame(ctx, video, canvas, title, sorted)
      options.onProgress?.(Math.min(1, video.currentTime / video.duration))
      rafId = requestAnimationFrame(tick)
    }

    video.addEventListener('ended', onEnded)
    video.currentTime = 0
    video.muted = true
    recorder.start()
    video
      .play()
      .then(() => {
        rafId = requestAnimationFrame(tick)
      })
      .catch((err) => {
        cleanup()
        reject(err)
      })
  })
}
