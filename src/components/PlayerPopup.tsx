import { useEffect, useRef, useState } from 'react'
import { formatTime, loadYouTubeApi } from '../lib/youtube'
import {
  openPlayerChannel,
  popupVideoIdFromRoute,
  type PlayerSyncMessage,
} from '../lib/playerSync'
import './PlayerPopup.css'

type YtPlayerExt = YTPlayer & {
  cueVideoById: (id: string) => void
  loadVideoById: (id: string) => void
}

export function PlayerPopup() {
  const hostRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YtPlayerExt | null>(null)
  const channelRef = useRef<BroadcastChannel | null>(null)
  const [videoId, setVideoId] = useState(() => popupVideoIdFromRoute())
  const [ready, setReady] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'WhereMusic · YouTube 큰 화면'
    const channel = openPlayerChannel()
    channelRef.current = channel
    channel.postMessage({ type: 'hello', role: 'popup' } satisfies PlayerSyncMessage)
    channel.postMessage({ type: 'popup-ready' } satisfies PlayerSyncMessage)

    channel.onmessage = (ev: MessageEvent<PlayerSyncMessage>) => {
      const msg = ev.data
      if (!msg || typeof msg !== 'object') return
      const player = playerRef.current
      if (msg.type === 'command' && player) {
        if (msg.cmd === 'seek' && typeof msg.t === 'number') {
          player.seekTo(msg.t, true)
          player.playVideo()
        } else if (msg.cmd === 'play') {
          player.playVideo()
        } else if (msg.cmd === 'pause') {
          player.pauseVideo()
        }
      }
      if (msg.type === 'video' && msg.videoId) {
        setVideoId(msg.videoId)
      }
      if (msg.type === 'focus-popup') {
        window.focus()
      }
    }

    const onUnload = () => {
      try {
        channel.postMessage({ type: 'popup-closed' } satisfies PlayerSyncMessage)
        channel.close()
      } catch {
        // ignore
      }
    }
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('beforeunload', onUnload)
      onUnload()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let rafId: number | null = null
    const host = hostRef.current
    if (!host || !videoId) return
    const activeId: string = videoId

    host.innerHTML = ''
    const mount = document.createElement('div')
    mount.className = 'popup-yt-mount'
    host.appendChild(mount)

    async function setup() {
      try {
        await loadYouTubeApi()
        if (cancelled || !window.YT) return

        playerRef.current = new window.YT.Player(mount, {
          width: '100%',
          height: '100%',
          videoId: activeId,
          playerVars: {
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
            autoplay: 1,
          },
          events: {
            onReady: (event) => {
              if (cancelled) return
              setReady(true)
              setDuration(event.target.getDuration() || 0)
              event.target.playVideo()
            },
            onStateChange: (event) => {
              const isPlaying = event.data === window.YT!.PlayerState.PLAYING
              setPlaying(isPlaying)
              setDuration(event.target.getDuration() || 0)
            },
            onError: () => {
              setError('영상을 재생할 수 없습니다.')
            },
          },
        }) as YtPlayerExt

        const tickAlways = () => {
          if (cancelled) return
          const player = playerRef.current
          if (player) {
            try {
              const t = player.getCurrentTime()
              const isPlaying = player.getPlayerState() === window.YT?.PlayerState.PLAYING
              setCurrentTime(t)
              setDuration(player.getDuration() || 0)
              setPlaying(Boolean(isPlaying))
              channelRef.current?.postMessage({
                type: 'tick',
                t,
                playing: Boolean(isPlaying),
                videoId: activeId,
              } satisfies PlayerSyncMessage)
            } catch {
              // ignore
            }
          }
          rafId = requestAnimationFrame(tickAlways)
        }
        rafId = requestAnimationFrame(tickAlways)
      } catch (e) {
        setError(e instanceof Error ? e.message : '플레이어 초기화 실패')
      }
    }

    void setup()
    return () => {
      cancelled = true
      if (rafId != null) cancelAnimationFrame(rafId)
      try {
        playerRef.current?.destroy()
      } catch {
        // ignore
      }
      playerRef.current = null
      host.innerHTML = ''
    }
  }, [videoId])

  return (
    <div className="player-popup">
      <header className="popup-bar">
        <div>
          <p className="popup-brand">WhereMusic</p>
          <p className="popup-sub">두 번째 모니터용 큰 화면 · 본창 코드표와 동기화됩니다</p>
        </div>
        <div className="popup-meta">
          {formatTime(currentTime)} / {formatTime(duration)}
          {playing ? ' · 재생 중' : ' · 일시정지'}
          {!ready ? ' · 준비 중' : ''}
        </div>
      </header>
      {error && <p className="popup-error">{error}</p>}
      <div className="popup-stage">
        {videoId ? (
          <div ref={hostRef} className="popup-frame" />
        ) : (
          <p className="popup-empty">videoId가 없습니다. 본창에서 다시 열어 주세요.</p>
        )}
      </div>
    </div>
  )
}
