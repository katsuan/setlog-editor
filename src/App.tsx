import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import VideoPlayer from './components/VideoPlayer'
import LogList from './components/LogList'
import type { LogEntry, ProjectState } from './types'
import { formatTimecode } from './utils/time'
import { exportCsv, exportJson, exportSrt } from './utils/export'
import { CUT_DURATION, combineClips, renderOverlayVideo } from './utils/videoExport'
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

function loadFromStorage(videoName: string): LogEntry[] {
  try {
    const raw = localStorage.getItem(storageKey(videoName))
    if (!raw) return []
    const parsed = JSON.parse(raw) as ProjectState
    return parsed.entries ?? []
  } catch {
    return []
  }
}

export default function App() {
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoName, setVideoName] = useState<string>('')
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [currentTime, setCurrentTime] = useState(0)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'cut' | 'combine'>('cut')
  const [clipBlobs, setClipBlobs] = useState<Record<string, Blob>>({})
  const [exportingEntryId, setExportingEntryId] = useState<string | null>(null)
  const [isCombining, setIsCombining] = useState(false)
  const [combineProgress, setCombineProgress] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  const handleVideoFile = useCallback((file: File) => {
    const url = URL.createObjectURL(file)
    setVideoUrl(url)
    setVideoName(file.name)
    setEntries(loadFromStorage(file.name))
    setActiveId(null)
    setClipBlobs({})
  }, [])

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleVideoFile(file)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file && file.type.startsWith('video/')) handleVideoFile(file)
  }

  const markHere = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    video.pause()
    const entry: LogEntry = {
      id: crypto.randomUUID(),
      time: video.currentTime,
      clockTime: '',
      caption: '',
    }
    setEntries((prev) => [...prev, entry])
    setActiveId(entry.id)
  }, [])

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
    const project: ProjectState = { videoName, entries }
    localStorage.setItem(storageKey(videoName), JSON.stringify(project))
  }, [videoName, entries])

  const sortedEntries = useMemo(() => [...entries].sort((a, b) => a.time - b.time), [entries])

  const exportEntryClip = useCallback(
    async (entry: LogEntry) => {
      const video = videoRef.current
      if (!video) return
      setExportingEntryId(entry.id)
      try {
        const blob = await renderOverlayVideo(video, [entry])
        setClipBlobs((prev) => ({ ...prev, [entry.id]: blob }))
      } catch (err) {
        alert(`カットの書き出しに失敗しました: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setExportingEntryId(null)
      }
    },
    [],
  )

  const combineAndSave = useCallback(async () => {
    const orderedBlobs = sortedEntries.map((e) => clipBlobs[e.id]).filter((b): b is Blob => !!b)
    if (orderedBlobs.length !== sortedEntries.length) return
    setIsCombining(true)
    setCombineProgress(0)
    try {
      const blob = await combineClips(orderedBlobs, { onProgress: setCombineProgress })
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm'
      const filename = `${videoName ? videoName.replace(/\.[^.]+$/, '') : 'setlog'}.${ext}`
      await saveOrShareBlob(blob, filename)
    } catch (err) {
      alert(`結合に失敗しました: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsCombining(false)
    }
  }, [clipBlobs, sortedEntries, videoName])

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
            <button onClick={() => fileInputRef.current?.click()}>動画ファイルを開く</button>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              hidden
              onChange={onFileInputChange}
            />
            {videoName && <span className="video-name">{videoName}</span>}
          </div>
        </section>

        <section className="log-section">
          <div className="log-header">
            <h2>カット一覧 ({entries.length})</h2>
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
          </div>
          <LogList
            entries={entries}
            activeId={activeId}
            onSeek={seekTo}
            onPreview={previewCut}
            onChangeClockTime={changeClockTime}
            onChangeCaption={changeCaption}
            onDelete={deleteEntry}
          />
        </section>

        {videoUrl && entries.length > 0 && (
          <section className="export-section">
            <div className="export-tabs">
              <button
                className={activeTab === 'cut' ? 'export-tab active' : 'export-tab'}
                onClick={() => setActiveTab('cut')}
              >
                ① カット書き出し
              </button>
              <button
                className={activeTab === 'combine' ? 'export-tab active' : 'export-tab'}
                onClick={() => setActiveTab('combine')}
              >
                ② 結合
              </button>
            </div>

            {activeTab === 'cut' && (
              <ul className="clip-list">
                {sortedEntries.map((entry) => (
                  <li key={entry.id} className="clip-row">
                    <span className="clip-label">
                      {entry.clockTime || formatTimecode(entry.time)}
                      {entry.caption ? ` ／ ${entry.caption}` : ''}
                    </span>
                    <button
                      onClick={() => exportEntryClip(entry)}
                      disabled={exportingEntryId === entry.id}
                    >
                      {exportingEntryId === entry.id
                        ? '書き出し中…'
                        : clipBlobs[entry.id]
                          ? '再書き出し'
                          : '書き出す'}
                    </button>
                    {clipBlobs[entry.id] && <span className="clip-done">✓ 済み</span>}
                  </li>
                ))}
              </ul>
            )}

            {activeTab === 'combine' && (
              <div className="combine-panel">
                <p className="combine-status">
                  {Object.keys(clipBlobs).filter((id) => sortedEntries.some((e) => e.id === id)).length}{' '}
                  / {sortedEntries.length} カット書き出し済み
                </p>
                <button
                  className="export-button"
                  onClick={combineAndSave}
                  disabled={
                    isCombining ||
                    sortedEntries.length === 0 ||
                    sortedEntries.some((e) => !clipBlobs[e.id])
                  }
                >
                  {isCombining
                    ? `結合中… ${Math.round(combineProgress * 100)}%`
                    : '結合して保存/共有'}
                </button>
              </div>
            )}
          </section>
        )}
      </main>

      <footer className="app-footer">
        <p>すべての処理はブラウザ内で完結します。動画ファイルはサーバーに送信されません。</p>
      </footer>
    </div>
  )
}
