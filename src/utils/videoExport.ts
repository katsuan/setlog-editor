import type { LogEntry } from '../types'
import { formatTimecode } from './time'

export const CUT_DURATION = 2 // seconds per log entry

function drawOverlayText(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  timeText: string,
  captionText: string,
) {
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

function drawFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  entry: LogEntry,
) {
  const w = canvas.width
  const h = canvas.height
  ctx.drawImage(video, 0, 0, w, h)
  drawOverlayText(ctx, w, h, entry.clockTime || formatTimecode(entry.time), entry.caption)
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

const MP4_THEN_WEBM = [
  // MP4 first: widely accepted by SNS apps (Instagram/LINE/X) without conversion.
  // WebM as fallback for browsers without MediaRecorder MP4 support.
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
]

function pickMimeType(): string {
  const mimeType = MP4_THEN_WEBM.find((t) => MediaRecorder.isTypeSupported(t))
  if (!mimeType) throw new Error('このブラウザは動画の書き出しに対応していません')
  return mimeType
}

export async function renderOverlayVideo(
  video: HTMLVideoElement,
  entries: LogEntry[],
  options: ExportOptions = {},
): Promise<Blob> {
  const sorted = [...entries].sort((a, b) => a.time - b.time)
  if (!sorted.length) throw new Error('カットがありません')

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

  const mimeType = pickMimeType()

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

  // Paint the first frame before recording starts — otherwise the recorder
  // captures a few frames of the still-blank (black) canvas while we wait
  // for the initial seek/play to complete.
  await seekTo(video, Math.min(sorted[0].time, video.duration || sorted[0].time))
  drawFrame(ctx, video, canvas, sorted[0])
  recorder.start()

  try {
    for (let i = 0; i < sorted.length; i++) {
      const entry = sorted[i]
      if (i > 0) {
        await seekTo(video, Math.min(entry.time, video.duration || entry.time))
        // Paint immediately after seeking so the canvas never shows a stale
        // or blank frame while play() is still buffering.
        drawFrame(ctx, video, canvas, entry)
      }
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

function loadClipMetadata(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const onLoaded = () => {
      video.removeEventListener('loadedmetadata', onLoaded)
      video.removeEventListener('error', onError)
      resolve()
    }
    const onError = () => {
      video.removeEventListener('loadedmetadata', onLoaded)
      video.removeEventListener('error', onError)
      reject(new Error('クリップの読み込みに失敗しました'))
    }
    video.addEventListener('loadedmetadata', onLoaded)
    video.addEventListener('error', onError)
  })
}

function waitForEnded(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    const onEnded = () => {
      video.removeEventListener('ended', onEnded)
      resolve()
    }
    video.addEventListener('ended', onEnded)
  })
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('画像の読み込みに失敗しました'))
    img.src = URL.createObjectURL(blob)
  })
}

/**
 * Turns a still photo into a CUT_DURATION-second video clip with the same
 * time+caption overlay used for video cuts, so photos can be mixed into the
 * combine list alongside clips exported from video.
 */
export async function renderImageClip(
  imageBlob: Blob,
  clockTime: string,
  caption: string,
  options: ExportOptions = {},
): Promise<Blob> {
  const img = await loadImage(imageBlob)

  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context を取得できませんでした')

  const draw = () => {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    drawOverlayText(ctx, canvas.width, canvas.height, clockTime, caption)
  }

  const canvasStream = canvas.captureStream(30)
  const mimeType = pickMimeType()
  const recorder = new MediaRecorder(canvasStream, { mimeType, videoBitsPerSecond: 8_000_000 })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  const stopPromise = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }))
    recorder.onerror = (e) => reject(e)
  })

  // Paint before starting the recorder to avoid capturing a blank frame.
  draw()
  recorder.start()

  const start = performance.now()
  await new Promise<void>((resolve) => {
    const tick = () => {
      draw()
      if ((performance.now() - start) / 1000 >= CUT_DURATION) {
        resolve()
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

  recorder.stop()
  URL.revokeObjectURL(img.src)
  options.onProgress?.(1)

  return stopPromise
}

/**
 * Joins already-exported clips (each its own overlay-baked 2s video) into
 * one final video, in the given order. Each clip is played through its own
 * <video> element (audio routed via Web Audio into a single persistent
 * destination track) while frames are drawn onto one shared canvas, so the
 * whole sequence is captured as a single continuous MediaRecorder session.
 */
export async function combineClips(
  clipBlobs: Blob[],
  options: ExportOptions = {},
): Promise<Blob> {
  if (!clipBlobs.length) throw new Error('結合するクリップがありません')

  const probe = document.createElement('video')
  probe.muted = true
  probe.src = URL.createObjectURL(clipBlobs[0])
  await loadClipMetadata(probe)
  const width = probe.videoWidth
  const height = probe.videoHeight
  URL.revokeObjectURL(probe.src)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context を取得できませんでした')

  const canvasStream = canvas.captureStream(30)
  const audioCtx = new AudioContext()
  const destination = audioCtx.createMediaStreamDestination()

  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...destination.stream.getAudioTracks(),
  ])

  const mimeType = pickMimeType()
  const recorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: 8_000_000 })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  const stopPromise = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }))
    recorder.onerror = (e) => reject(e)
  })

  const objectUrls: string[] = []
  try {
    for (let i = 0; i < clipBlobs.length; i++) {
      const clipVideo = document.createElement('video')
      clipVideo.muted = true // keep silent on speakers; audio still flows through the Web Audio graph below
      clipVideo.playsInline = true
      const url = URL.createObjectURL(clipBlobs[i])
      objectUrls.push(url)
      clipVideo.src = url
      await loadClipMetadata(clipVideo)

      const source = audioCtx.createMediaElementSource(clipVideo)
      source.connect(destination)

      // Paint the clip's first frame before playback so the recorder never
      // captures a blank canvas between clips.
      ctx.drawImage(clipVideo, 0, 0, width, height)
      if (i === 0) recorder.start()

      await clipVideo.play()
      let stopped = false
      const drawLoop = () => {
        if (stopped) return
        ctx.drawImage(clipVideo, 0, 0, width, height)
        requestAnimationFrame(drawLoop)
      }
      requestAnimationFrame(drawLoop)

      await waitForEnded(clipVideo)
      stopped = true
      source.disconnect()
      options.onProgress?.((i + 1) / clipBlobs.length)
    }
  } finally {
    recorder.stop()
    objectUrls.forEach((url) => URL.revokeObjectURL(url))
    await audioCtx.close()
  }

  return stopPromise
}
