import type { LogEntry } from '../types'
import { formatTimecode } from './time'

export const CUT_DURATION = 2 // seconds per log entry

function drawFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  entry: LogEntry,
) {
  const w = canvas.width
  const h = canvas.height
  ctx.drawImage(video, 0, 0, w, h)

  const timeText = formatTimecode(entry.time)
  const captionText = entry.caption
  const timeFontSize = Math.round(w * 0.09)
  const captionFontSize = Math.round(w * 0.06)
  const lineGap = Math.round(timeFontSize * 0.9)

  // Two-line block (time + caption) centered as a whole on the frame.
  const hasCaption = captionText.length > 0
  const blockHeight = hasCaption ? timeFontSize + lineGap : timeFontSize
  const timeY = h / 2 - blockHeight / 2 + timeFontSize / 2
  const captionY = timeY + lineGap

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  ctx.font = `bold ${timeFontSize}px "Hiragino Sans", "Yu Gothic", sans-serif`
  ctx.fillStyle = '#ffffff'
  ctx.shadowColor = 'rgba(0,0,0,0.7)'
  ctx.shadowBlur = Math.round(timeFontSize * 0.15)
  ctx.fillText(timeText, w / 2, timeY)

  if (hasCaption) {
    ctx.font = `bold ${captionFontSize}px "Hiragino Sans", "Yu Gothic", sans-serif`
    ctx.fillText(captionText, w / 2, captionY, w * 0.9)
  }
  ctx.shadowBlur = 0
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked)
      resolve()
    }
    video.addEventListener('seeked', onSeeked)
    video.currentTime = time
  })
}

export interface ExportOptions {
  onProgress?: (ratio: number) => void
}

export async function renderOverlayVideo(
  video: HTMLVideoElement,
  entries: LogEntry[],
  options: ExportOptions = {},
): Promise<Blob> {
  const sorted = [...entries].sort((a, b) => a.time - b.time)
  if (!sorted.length) throw new Error('ログがありません')

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

  // MP4 first: widely accepted by SNS apps (Instagram/LINE/X) without conversion.
  // WebM as fallback for browsers without MediaRecorder MP4 support.
  const mimeType = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ].find((t) => MediaRecorder.isTypeSupported(t))
  if (!mimeType) throw new Error('このブラウザは動画の書き出しに対応していません')

  const recorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: 8_000_000 })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  const wasMuted = video.muted
  const wasTime = video.currentTime
  video.muted = true

  const stopPromise = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }))
    recorder.onerror = (e) => reject(e)
  })

  recorder.start()

  try {
    for (let i = 0; i < sorted.length; i++) {
      const entry = sorted[i]
      await seekTo(video, Math.min(entry.time, video.duration || entry.time))
      await video.play()

      const segmentStart = performance.now()
      await new Promise<void>((resolve) => {
        const tick = () => {
          const elapsed = (performance.now() - segmentStart) / 1000
          drawFrame(ctx, video, canvas, entry)
          if (elapsed >= CUT_DURATION || video.ended) {
            resolve()
            return
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })

      video.pause()
      options.onProgress?.((i + 1) / sorted.length)
    }
  } finally {
    recorder.stop()
    video.muted = wasMuted
    video.currentTime = wasTime
  }

  return stopPromise
}
