import { forwardRef } from 'react'

interface Props {
  src: string | null
  onTimeUpdate?: () => void
}

const VideoPlayer = forwardRef<HTMLVideoElement, Props>(({ src, onTimeUpdate }, ref) => {
  if (!src) {
    return (
      <div className="video-placeholder">
        <p>動画ファイルを読み込んでください</p>
      </div>
    )
  }
  return (
    <video
      ref={ref}
      src={src}
      controls
      className="video-player"
      onTimeUpdate={onTimeUpdate}
    />
  )
})

VideoPlayer.displayName = 'VideoPlayer'

export default VideoPlayer
