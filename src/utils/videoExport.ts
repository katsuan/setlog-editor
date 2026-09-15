import type { LogEntry } from '../types'
import { formatTimecode } from './time'

export const CUT_DURATION = 2 // seconds per log entry

// H.264 encoders generally require even width/height (macroblock alignment);
// an odd dimension (common on cropped/downloaded photos) can make the
// MediaRecorder either fail outright or emit a file that later fails to
// decode. Round down to the nearest even number to stay safe.
function toEvenDimension(n: number): number {
  return n - (n % 2)
}

function drawOverlayText(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  timeText: string,
  captionText: string,
) {
  const timeFontSize = Math.round(w * 0.065)
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
  // Prefer higher H.264 profiles (better quality per bit) before falling back
  // to Baseline, and WebM for browsers without MediaRecorder MP4 support.
  'video/mp4;codecs=avc1.640028,mp4a.40.2', // High profile
  'video/mp4;codecs=avc1.4d0028,mp4a.40.2', // Main profile
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2', // Baseline profile
  'video/mp4;codecs=avc1,mp4a',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
]

// Short clips, so a generous bitrate doesn't cost much size while noticeably
// reducing block/banding artifacts from the canvas-capture re-encode.
const VIDEO_BITS_PER_SECOND = 16_000_000

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
  canvas.width = toEvenDimension(video.videoWidth)
  canvas.height = toEvenDimension(video.videoHeight)
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

  const recorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: VIDEO_BITS_PER_SECOND })
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
      const segmentStart = performance.now()
      const playPromise = video.play()
      // Start the draw loop immediately alongside play() (not after it
      // resolves) so decoded frames get painted as soon as they're ready,
      // instead of leaving the just-seeked still frame recorded for the
      // whole duration of play()'s buffering/startup latency.
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
      await playPromise.catch(() => {})

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

// Waits for 'loadeddata' (not just 'loadedmetadata') so the video's first
// frame is actually decoded and paintable, not just its dimensions known.
function loadClipMetadata(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const onLoaded = () => {
      video.removeEventListener('loadeddata', onLoaded)
      video.removeEventListener('error', onError)
      resolve()
    }
    const onError = () => {
      video.removeEventListener('loadeddata', onLoaded)
      video.removeEventListener('error', onError)
      reject(new Error('クリップの読み込みに失敗しました'))
    }
    video.addEventListener('loadeddata', onLoaded)
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
  canvas.width = toEvenDimension(img.naturalWidth)
  canvas.height = toEvenDimension(img.naturalHeight)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context を取得できませんでした')

  const draw = () => {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    drawOverlayText(ctx, canvas.width, canvas.height, clockTime, caption)
  }

  const canvasStream = canvas.captureStream(30)
  const mimeType = pickMimeType()
  const recorder = new MediaRecorder(canvasStream, { mimeType, videoBitsPerSecond: VIDEO_BITS_PER_SECOND })
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

  // Preload every clip's first frame up front. Doing this mid-loop (loading
  // clip N+1 only once clip N finishes) left a visible freeze at every cut —
  // the canvas kept re-recording clip N+1's still, undecoded first frame
  // while it buffered. Preloading means each switch just starts playback on
  // an already-decoded video element.
  const objectUrls: string[] = []
  const clipVideos: HTMLVideoElement[] = []
  try {
    for (let i = 0; i < clipBlobs.length; i++) {
      const clipVideo = document.createElement('video')
      clipVideo.muted = true // keep silent on speakers; audio still flows through the Web Audio graph below
      clipVideo.playsInline = true
      clipVideo.preload = 'auto'
      const url = URL.createObjectURL(clipBlobs[i])
      objectUrls.push(url)
      clipVideo.src = url
      try {
        await loadClipMetadata(clipVideo)
      } catch (err) {
        throw new Error(
          `${i + 1}番目のクリップの読み込みに失敗しました: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
      clipVideos.push(clipVideo)
    }

    const width = toEvenDimension(clipVideos[0].videoWidth)
    const height = toEvenDimension(clipVideos[0].videoHeight)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context を取得できませんでした')

    const canvasStream = canvas.captureStream(30)
    const audioCtx = new AudioContext()
    await audioCtx.resume()
    const destination = audioCtx.createMediaStreamDestination()

    const combinedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...destination.stream.getAudioTracks(),
    ])

    const mimeType = pickMimeType()
    const recorder = new MediaRecorder(combinedStream, {
      mimeType,
      videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
    })
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    const stopPromise = new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }))
      recorder.onerror = (e) => {
        const message = e instanceof ErrorEvent ? e.message : 'MediaRecorder でエラーが発生しました'
        reject(new Error(message))
      }
    })

    try {
      ctx.drawImage(clipVideos[0], 0, 0, width, height)
      recorder.start()

      for (let i = 0; i < clipVideos.length; i++) {
        const clipVideo = clipVideos[i]
        let source: MediaElementAudioSourceNode
        try {
          source = audioCtx.createMediaElementSource(clipVideo)
          source.connect(destination)
          if (i > 0) ctx.drawImage(clipVideo, 0, 0, width, height)

          let stopped = false
          const drawLoop = () => {
            if (stopped) return
            ctx.drawImage(clipVideo, 0, 0, width, height)
            requestAnimationFrame(drawLoop)
          }
          // Start the draw loop immediately alongside play() instead of
          // waiting for the play() promise first, so decoded frames get
          // painted as soon as they're available rather than after an
          // extra serialized wait.
          requestAnimationFrame(drawLoop)
          await clipVideo.play()
          await waitForEnded(clipVideo)
          stopped = true
          source.disconnect()
        } catch (err) {
          throw new Error(
            `${i + 1}番目のクリップの再生に失敗しました: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
        options.onProgress?.((i + 1) / clipVideos.length)
      }
    } finally {
      recorder.stop()
      await audioCtx.close()
    }

    return await stopPromise
  } finally {
    objectUrls.forEach((url) => URL.revokeObjectURL(url))
  }
}
