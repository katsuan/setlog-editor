import { useCallback, useEffect, useRef, useState } from 'react'
import VideoPlayer from './components/VideoPlayer'
import LogList from './components/LogList'
import type { LogEntry, ProjectState } from './types'
import { formatTimecode } from './utils/time'
import { exportCsv, exportJson, exportSrt } from './utils/export'
import { renderOverlayVideo } from './utils/videoExport'
import './App.css'

function storageKey(videoName: string) {
  return `setlog-editor:${videoName}`
}

function loadFromStorage(videoName: string): { entries: LogEntry[]; title: string } {
  try {
    const raw = localStorage.getItem(storageKey(videoName))
    if (!raw) return { entries: [], title: '' }
    const parsed = JSON.parse(raw) as ProjectState
    return { entries: parsed.entries ?? [], title: parsed.title ?? '' }
  } catch {
    return { entries: [], title: '' }
  }
}

export default function App() {
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoName, setVideoName] = useState<string>('')
  const [title, setTitle] = useState<string>('')
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [currentTime, setCurrentTime] = useState(0)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  const handleVideoFile = useCallback((file: File) => {
    const url = URL.createObjectURL(file)
    setVideoUrl(url)
    setVideoName(file.name)
    const loaded = loadFromStorage(file.name)
    setEntries(loaded.entries)
    setTitle(loaded.title)
    setActiveId(null)
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
    const entry: LogEntry = {
      id: crypto.randomUUID(),
      time: video.currentTime,
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

  const changeCaption = (id: string, caption: string) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, caption } : e)))
  }

  const deleteEntry = (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id))
  }

  // autosave
  useEffect(() => {
    if (!videoName) return
    const project: ProjectState = { videoName, title, entries }
    localStorage.setItem(storageKey(videoName), JSON.stringify(project))
  }, [videoName, title, entries])

  const exportOverlayVideo = useCallback(async () => {
    const video = videoRef.current
    if (!video) return
    setIsExporting(true)
    setExportProgress(0)
    try {
      const blob = await renderOverlayVideo(video, entries, title, {
        onProgress: setExportProgress,
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${videoName ? videoName.replace(/\.[^.]+$/, '') : 'setlog'}.webm`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert(`動画の書き出しに失敗しました: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsExporting(false)
    }
  }, [entries, title, videoName])

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
        setEntries(parsed.entries)
      }
      if (typeof parsed.title === 'string') {
        setTitle(parsed.title)
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
          {videoUrl && (
            <div className="export-section">
              <input
                className="title-input"
                type="text"
                placeholder="タイトル帯のテキスト（例: 沖縄1日目 setlog🎥🎀）"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <button
                className="export-button"
                onClick={exportOverlayVideo}
                disabled={isExporting || !entries.length}
              >
                {isExporting ? `書き出し中… ${Math.round(exportProgress * 100)}%` : '動画を書き出す (WebM)'}
              </button>
            </div>
          )}
        </section>

        <section className="log-section">
          <div className="log-header">
            <h2>ログ ({entries.length})</h2>
            <div className="log-actions">
              <button onClick={() => exportJson({ videoName, title, entries })} disabled={!entries.length}>
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
            onChangeCaption={changeCaption}
            onDelete={deleteEntry}
          />
        </section>
      </main>

      <footer className="app-footer">
        <p>すべての処理はブラウザ内で完結します。動画ファイルはサーバーに送信されません。</p>
      </footer>
    </div>
  )
}
