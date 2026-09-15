import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import VideoPlayer from './components/VideoPlayer'
import LogList from './components/LogList'
import type { LogEntry, ProjectState } from './types'
import { addMinutesToClock, formatTimecode, roundToHalfHour } from './utils/time'
import TimeSelect from './components/TimeSelect'
import { exportCsv, exportJson, exportSrt } from './utils/export'
import { CUT_DURATION, combineClips, renderImageClip, renderOverlayVideo } from './utils/videoExport'
import './App.css'

async function saveOrShareBlob(blob: Blob, filename: string) {
  const file = new File([blob], filename, { type: blob.type })

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename })
      return
    } catch (shareErr) {
      if (shareErr instanceof Error && shareErr.name === 'AbortError') return
      // fall through to download if share failed for another reason
    }
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function storageKey(videoName: string) {
  return `setlog-editor:${videoName}`
}

function loadFromStorage(videoName: string): { entries: LogEntry[]; baseClockTime: string } {
  try {
    const raw = localStorage.getItem(storageKey(videoName))
    if (!raw) return { entries: [], baseClockTime: '' }
    const parsed = JSON.parse(raw) as ProjectState
    return { entries: parsed.entries ?? [], baseClockTime: parsed.baseClockTime ?? '' }
  } catch {
    return { entries: [], baseClockTime: '' }
  }
}

interface ExportedClip {
  id: string
  videoName: string
  clockTime: string
  caption: string
  blob: Blob
}

export default function App() {
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoName, setVideoName] = useState<string>('')
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [currentTime, setCurrentTime] = useState(0)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [baseClockTime, setBaseClockTime] = useState('')
  const [showMoreExports, setShowMoreExports] = useState(false)
  const [exportedClips, setExportedClips] = useState<ExportedClip[]>([])
  const [exportingEntryId, setExportingEntryId] = useState<string | null>(null)
  const [isCombining, setIsCombining] = useState(false)
  const [combineProgress, setCombineProgress] = useState(0)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoClockTime, setPhotoClockTime] = useState('')
  const [photoCaption, setPhotoCaption] = useState('')
  const [isExportingPhoto, setIsExportingPhoto] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const clipImportInputRef = useRef<HTMLInputElement>(null)

  const handleVideoFile = useCallback((file: File) => {
    const url = URL.createObjectURL(file)
    setVideoUrl(url)
    setVideoName(file.name)
    const loaded = loadFromStorage(file.name)
    setEntries(loaded.entries)
    setBaseClockTime(loaded.baseClockTime)
    setActiveId(null)
    // exportedClips intentionally persists across video switches — combining
    // is meant to span cuts taken from multiple different source videos.
  }, [])

  const handlePhotoFile = useCallback((file: File) => {
    setPhotoFile(file)
    setPhotoClockTime('')
    setPhotoCaption('')
  }, [])

  const handleMediaFile = useCallback(
    (file: File) => {
      if (file.type.startsWith('image/')) {
        handlePhotoFile(file)
      } else {
        handleVideoFile(file)
      }
    },
    [handleVideoFile, handlePhotoFile],
  )

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleMediaFile(file)
    e.target.value = ''
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file && (file.type.startsWith('video/') || file.type.startsWith('image/'))) {
      handleMediaFile(file)
    }
  }

  const markHere = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    video.pause()
    const entry: LogEntry = {
      id: crypto.randomUUID(),
      time: video.currentTime,
      clockTime: baseClockTime
        ? roundToHalfHour(addMinutesToClock(baseClockTime, video.currentTime / 60))
        : '',
      caption: '',
    }
    setEntries((prev) => [...prev, entry])
    setActiveId(entry.id)
  }, [baseClockTime])

  const seekTo = (time: number) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = time
    video.play().catch(() => {})
  }

  const previewCut = useCallback((time: number) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = time
    video.play().catch(() => {})
    const stopAt = time + CUT_DURATION
    const onTimeUpdate = () => {
      if (video.currentTime >= stopAt) {
        video.pause()
        video.currentTime = stopAt
        video.removeEventListener('timeupdate', onTimeUpdate)
      }
    }
    video.addEventListener('timeupdate', onTimeUpdate)
  }, [])

  const changeCaption = (id: string, caption: string) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, caption } : e)))
  }

  const changeClockTime = (id: string, clockTime: string) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, clockTime } : e)))
  }

  const deleteEntry = (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id))
  }

  // autosave
  useEffect(() => {
    if (!videoName) return
    const project: ProjectState = { videoName, entries, baseClockTime }
    localStorage.setItem(storageKey(videoName), JSON.stringify(project))
  }, [videoName, entries, baseClockTime])

  const exportedIds = useMemo(() => new Set(exportedClips.map((c) => c.id)), [exportedClips])

  // Auto-sort the combine list by shooting time (撮影時刻); clips with no
  // clock time set sort to the end, keeping their original relative order.
  const sortedExportedClips = useMemo(() => {
    return exportedClips
      .map((clip, index) => ({ clip, index }))
      .sort((a, b) => {
        if (!a.clip.clockTime && !b.clip.clockTime) return a.index - b.index
        if (!a.clip.clockTime) return 1
        if (!b.clip.clockTime) return -1
        if (a.clip.clockTime !== b.clip.clockTime) return a.clip.clockTime < b.clip.clockTime ? -1 : 1
        return a.index - b.index
      })
      .map((x) => x.clip)
  }, [exportedClips])

  const exportEntryClip = useCallback(
    async (entry: LogEntry) => {
      const video = videoRef.current
      if (!video) return
      setExportingEntryId(entry.id)
      try {
        const blob = await renderOverlayVideo(video, [entry])
        const record: ExportedClip = {
          id: entry.id,
          videoName,
          clockTime: entry.clockTime,
          caption: entry.caption,
          blob,
        }
        setExportedClips((prev) => {
          const idx = prev.findIndex((c) => c.id === entry.id)
          if (idx === -1) return [...prev, record]
          const next = [...prev]
          next[idx] = record
          return next
        })
      } catch (err) {
        alert(`カットの書き出しに失敗しました: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setExportingEntryId(null)
      }
    },
    [videoName],
  )

  const removeExportedClip = (id: string) => {
    setExportedClips((prev) => prev.filter((c) => c.id !== id))
  }

  const saveExportedClip = (clip: ExportedClip) => {
    const ext = clip.blob.type.includes('mp4') ? 'mp4' : 'webm'
    const base = clip.caption || clip.clockTime || clip.videoName.replace(/\.[^.]+$/, '') || 'clip'
    saveOrShareBlob(clip.blob, `${base}.${ext}`)
  }

  const saveExportedClipById = (id: string) => {
    const clip = exportedClips.find((c) => c.id === id)
    if (clip) saveExportedClip(clip)
  }

  const onImportClips = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length) {
      setExportedClips((prev) => [
        ...prev,
        ...files.map((file) => ({
          id: crypto.randomUUID(),
          videoName: file.name,
          clockTime: '',
          caption: '',
          blob: file,
        })),
      ])
    }
    e.target.value = ''
  }

  const combineAndSave = useCallback(async () => {
    if (!sortedExportedClips.length) return
    setIsCombining(true)
    setCombineProgress(0)
    try {
      const blob = await combineClips(
        sortedExportedClips.map((c) => c.blob),
        { onProgress: setCombineProgress },
      )
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm'
      const filename = `setlog-combined.${ext}`
      await saveOrShareBlob(blob, filename)
    } catch (err) {
      alert(`結合に失敗しました: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsCombining(false)
    }
  }, [sortedExportedClips])

  const exportPhotoClip = useCallback(async () => {
    if (!photoFile) return
    setIsExportingPhoto(true)
    try {
      const blob = await renderImageClip(photoFile, photoClockTime, photoCaption)
      const record: ExportedClip = {
        id: crypto.randomUUID(),
        videoName: photoFile.name,
        clockTime: photoClockTime,
        caption: photoCaption,
        blob,
      }
      setExportedClips((prev) => [...prev, record])
      setPhotoFile(null)
      setPhotoClockTime('')
      setPhotoCaption('')
    } catch (err) {
      alert(`写真の書き出しに失敗しました: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsExportingPhoto(false)
    }
  }, [photoFile, photoClockTime, photoCaption])

  // keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      if (e.code === 'KeyM') {
        e.preventDefault()
        markHere()
      } else if (e.code === 'Space') {
        e.preventDefault()
        const video = videoRef.current
        if (!video) return
        if (video.paused) video.play()
        else video.pause()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [markHere])

  const onTimeUpdate = () => {
    setCurrentTime(videoRef.current?.currentTime ?? 0)
  }

  const onImportJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    try {
      const parsed = JSON.parse(text) as ProjectState
      if (Array.isArray(parsed.entries)) {
        setEntries(parsed.entries.map((e) => ({ ...e, clockTime: e.clockTime ?? '' })))
      }
    } catch {
      alert('JSONの読み込みに失敗しました')
    }
    e.target.value = ''
  }

  return (
    <div className="app" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <header className="app-header">
        <h1>SetLog Editor</h1>
        <p className="subtitle">動画にタイムスタンプ付きキャプションをローカルで付けるツール</p>
      </header>

      <main className="app-main">
        <section className="player-section">
          <VideoPlayer ref={videoRef} src={videoUrl} onTimeUpdate={onTimeUpdate} />
          {videoUrl && (
            <div className="player-controls">
              <span className="current-time">{formatTimecode(currentTime)}</span>
              <button className="mark-button" onClick={markHere}>
                ここでマーク (M)
              </button>
            </div>
          )}
          <div className="file-controls">
            <button onClick={() => fileInputRef.current?.click()}>動画または写真を選ぶ</button>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,image/*"
              hidden
              onChange={onFileInputChange}
            />
            {videoName && <span className="video-name">{videoName}</span>}
          </div>
          {videoUrl && (
            <div className="base-clock-row">
              <label htmlFor="base-clock-time">動画の開始時刻</label>
              <TimeSelect
                id="base-clock-time"
                className="log-clock-time"
                value={baseClockTime}
                onChange={setBaseClockTime}
              />
              <span className="base-clock-hint">設定するとマーク時に撮影時刻を自動計算します</span>
            </div>
          )}
        </section>

        <section className="log-section">
          <div className="log-header">
            <h2>カット ({entries.length})</h2>
            <button className="link-toggle" onClick={() => setShowMoreExports((v) => !v)}>
              {showMoreExports ? '▾ その他の書き出しを閉じる' : '▸ その他の書き出し（JSON/SRT/CSV）'}
            </button>
            {showMoreExports && (
              <div className="log-actions">
                <button onClick={() => exportJson({ videoName, entries })} disabled={!entries.length}>
                  JSON書き出し
                </button>
                <button onClick={() => exportSrt(entries, videoName)} disabled={!entries.length}>
                  SRT書き出し
                </button>
                <button onClick={() => exportCsv(entries, videoName)} disabled={!entries.length}>
                  CSV書き出し
                </button>
                <button onClick={() => importInputRef.current?.click()}>JSON読み込み</button>
                <input
                  ref={importInputRef}
                  type="file"
                  accept="application/json"
                  hidden
                  onChange={onImportJson}
                />
              </div>
            )}
          </div>
          <LogList
            entries={entries}
            activeId={activeId}
            onSeek={seekTo}
            onPreview={previewCut}
            onChangeClockTime={changeClockTime}
            onChangeCaption={changeCaption}
            onDelete={deleteEntry}
            exportedIds={exportedIds}
            exportingEntryId={exportingEntryId}
            onExport={exportEntryClip}
            onSaveExported={saveExportedClipById}
          />
        </section>

        {photoFile && (
          <section className="photo-section">
            <h2>写真をクリップにする</h2>
            <p className="combine-status">
              「{photoFile.name}」を {CUT_DURATION} 秒間の静止画クリップにして、結合リストに追加します。
            </p>
            <div className="clip-row">
              <TimeSelect className="log-clock-time" value={photoClockTime} onChange={setPhotoClockTime} />
              <input
                className="log-caption"
                value={photoCaption}
                placeholder="キャプションを入力..."
                onChange={(e) => setPhotoCaption(e.target.value)}
              />
              <button onClick={exportPhotoClip} disabled={isExportingPhoto}>
                {isExportingPhoto ? '書き出し中…' : `${CUT_DURATION}秒クリップとして書き出す`}
              </button>
            </div>
          </section>
        )}

        <section className="export-section">
          <h2>結合 ({exportedClips.length})</h2>
          <p className="combine-status">
            書き出したカット（複数の動画・写真から集めたものでもOK）を撮影時刻順に自動で並べ、1本の動画に結合します。
          </p>
          <button className="link-toggle" onClick={() => clipImportInputRef.current?.click()}>
            ▸ 保存済みのクリップファイルを読み込んで追加
          </button>
          <input
            ref={clipImportInputRef}
            type="file"
            accept="video/*"
            multiple
            hidden
            onChange={onImportClips}
          />
          {sortedExportedClips.length === 0 ? (
            <p className="combine-status">
              まだ書き出したカットがありません。上の「カットを書き出す」で書き出してください。
            </p>
          ) : (
            <ul className="clip-list">
              {sortedExportedClips.map((clip, index) => (
                <li key={clip.id} className="clip-row">
                  <span className="clip-label">
                    {index + 1}. [{clip.videoName}] {clip.clockTime || '時刻未設定'}
                    {clip.caption ? ` ／ ${clip.caption}` : ''}
                  </span>
                  <button
                    className="log-delete"
                    onClick={() => removeExportedClip(clip.id)}
                    title="結合対象から外す"
                    aria-label="結合対象から外す"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            className="export-button"
            onClick={combineAndSave}
            disabled={isCombining || exportedClips.length === 0}
          >
            {isCombining ? `結合中… ${Math.round(combineProgress * 100)}%` : '結合して保存/共有'}
          </button>
        </section>
      </main>

      <footer className="app-footer">
        <p>すべての処理はブラウザ内で完結します。動画ファイルはサーバーに送信されません。</p>
      </footer>
    </div>
  )
}
