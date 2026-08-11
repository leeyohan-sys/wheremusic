import { useEffect, useRef, useState, type FormEvent } from 'react'
import { extractVideoId, formatTime, loadYouTubeApi } from '../lib/youtube'

interface PlayerControls {
  getCurrentTime: () => number
  seekTo: (sec: number) => void
  play: () => void
  pause: () => void
}

interface YoutubePanelProps {
  videoId: string | null
  onVideoIdChange: (videoId: string) => void
  onTimeUpdate: (time: number, playing: boolean) => void
  onPlayerReady: (api: PlayerControls) => void
  popupOpen?: boolean
  onOpenPopup?: () => void
  onFocusPopup?: () => void
}

type YtPlayerExt = YTPlayer & {
  loadVideoById: (id: string) => void
  cueVideoById: (id: string) => void
  pauseVideo: () => void
}

export function YoutubePanel({
  videoId,
  onVideoIdChange,
  onTimeUpdate,
  onPlayerReady,
  popupOpen = false,
  onOpenPopup,
  onFocusPopup,
}: YoutubePanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YtPlayerExt | null>(null)
  const readyRef = useRef(false)
  const videoIdRef = useRef(videoId)
  const onTimeUpdateRef = useRef(onTimeUpdate)
  const onPlayerReadyRef = useRef(onPlayerReady)
  const [urlInput, setUrlInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)

  const popupOpenRef = useRef(popupOpen)
  popupOpenRef.current = popupOpen

  videoIdRef.current = videoId
  onTimeUpdateRef.current = onTimeUpdate
  onPlayerReadyRef.current = onPlayerReady

  useEffect(() => {
    if (popupOpen) {
      try {
        playerRef.current?.pauseVideo()
      } catch {
        // ignore
      }
    }
  }, [popupOpen])

  useEffect(() => {
    let cancelled = false
    let rafId: number | null = null
    const container = containerRef.current
    if (!container) return

    const host = document.createElement('div')
    host.className = 'yt-mount'
    container.appendChild(host)

    async function setup() {
      try {
        await loadYouTubeApi()
        if (cancelled || !window.YT) return

        playerRef.current = new window.YT.Player(host, {
          width: '100%',
          height: '100%',
          playerVars: {
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
          },
          events: {
            onReady: (event) => {
              if (cancelled) return
              readyRef.current = true
              setReady(true)
              const target = event.target as YtPlayerExt
              onPlayerReadyRef.current({
                getCurrentTime: () => target.getCurrentTime(),
                seekTo: (sec) => target.seekTo(sec, true),
                play: () => target.playVideo(),
                pause: () => target.pauseVideo(),
              })
              const id = videoIdRef.current
              if (id) target.cueVideoById(id)
            },
            onStateChange: (event) => {
              const isPlaying = event.data === window.YT!.PlayerState.PLAYING
              setPlaying(isPlaying)
              setDuration(event.target.getDuration() || 0)
            },
            onError: () => {
              setError('영상을 재생할 수 없습니다. URL을 확인하거나 다른 영상으로 시도해 주세요.')
            },
          },
        }) as YtPlayerExt

        const tick = () => {
          if (cancelled) return
          const player = playerRef.current
          if (player && readyRef.current) {
            try {
              const t = player.getCurrentTime()
              const isPlaying = player.getPlayerState() === window.YT?.PlayerState.PLAYING
              setCurrentTime(t)
              setDuration(player.getDuration() || 0)
              setPlaying(Boolean(isPlaying))
              if (!popupOpenRef.current) {
                onTimeUpdateRef.current(t, Boolean(isPlaying))
              }
            } catch {
              // ignore transient player errors
            }
          }
          rafId = requestAnimationFrame(tick)
        }
        rafId = requestAnimationFrame(tick)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'YouTube 플레이어 초기화 실패')
        }
      }
    }

    void setup()

    return () => {
      cancelled = true
      readyRef.current = false
      if (rafId != null) cancelAnimationFrame(rafId)
      try {
        playerRef.current?.destroy()
      } catch {
        // ignore
      }
      playerRef.current = null
      container.innerHTML = ''
    }
  }, [])

  useEffect(() => {
    if (!ready || !videoId || !playerRef.current) return
    try {
      playerRef.current.cueVideoById(videoId)
      setError(null)
    } catch {
      setError('영상을 불러오지 못했습니다.')
    }
  }, [videoId, ready])

  function handleLoad(e: FormEvent) {
    e.preventDefault()
    const id = extractVideoId(urlInput)
    if (!id) {
      setError('올바른 YouTube URL 또는 video ID를 입력해 주세요.')
      return
    }
    setError(null)
    onVideoIdChange(id)
  }

  return (
    <section className="panel youtube-panel">
      <header className="panel-header">
        <h2>YouTube</h2>
        <span className="panel-meta">
          {formatTime(currentTime)} / {formatTime(duration)}
          {playing ? ' · 재생 중' : ' · 일시정지'}
        </span>
      </header>

      <form className="url-form" onSubmit={handleLoad}>
        <input
          type="text"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
          aria-label="YouTube URL"
        />
        <button type="submit" className="btn primary">
          불러오기
        </button>
      </form>

      <div className="listen-bar">
        <button
          type="button"
          className="btn primary"
          disabled={!videoId}
          onClick={() => (popupOpen ? onFocusPopup?.() : onOpenPopup?.())}
        >
          {popupOpen ? '큰 화면 포커스' : '큰 화면으로 열기'}
        </button>
        <span className="panel-meta">
          {popupOpen
            ? '팝업에서 재생 중 · 다른 모니터로 옮기세요'
            : '듀얼 모니터용 별도 창'}
        </span>
      </div>

      {error && <p className="error-banner">{error}</p>}

      <div className="player-shell">
        <div className={`player-frame ${videoId ? '' : 'is-empty'}`}>
          <div ref={containerRef} className="yt-host" />
          {!videoId && (
            <div className="player-empty overlay">
              <p className="empty-title">영상을 불러오세요</p>
              <p className="empty-desc">YouTube 링크를 입력하면 여기서 재생됩니다.</p>
            </div>
          )}
          {videoId && popupOpen && (
            <div className="player-empty overlay">
              <p className="empty-title">큰 화면에서 재생 중</p>
              <p className="empty-desc">팝업 창을 두 번째 모니터로 옮긴 뒤 본창에서 코드표를 보세요.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
