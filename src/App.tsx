import { useCallback, useEffect, useRef, useState } from 'react'
import { AnalysisPanel } from './components/AnalysisPanel'
import { PlayerPopup } from './components/PlayerPopup'
import { YoutubePanel } from './components/YoutubePanel'
import {
  isPlayerPopupRoute,
  openPlayerChannel,
  openPlayerPopup,
  type PlayerSyncMessage,
} from './lib/playerSync'
import type { SongKey } from './types'
import './App.css'

const KEY_STORAGE = 'wheremusic.key'
const VIDEO_STORAGE = 'wheremusic.videoId'

interface PlayerApi {
  getCurrentTime: () => number
  seekTo: (sec: number) => void
  play: () => void
  pause: () => void
}

function loadKey(): SongKey {
  try {
    const raw = localStorage.getItem(KEY_STORAGE)
    if (!raw) return { root: 'C', mode: 'major' }
    const parsed = JSON.parse(raw) as SongKey
    if (parsed?.root && (parsed.mode === 'major' || parsed.mode === 'minor')) {
      return parsed
    }
  } catch {
    // ignore
  }
  return { root: 'C', mode: 'major' }
}

export default function App() {
  if (isPlayerPopupRoute()) {
    return <PlayerPopup />
  }

  return <MainApp />
}

function MainApp() {
  const [videoId, setVideoId] = useState<string | null>(() =>
    localStorage.getItem(VIDEO_STORAGE),
  )
  const [songKey, setSongKey] = useState<SongKey>(loadKey)
  const [status, setStatus] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [popupOpen, setPopupOpen] = useState(false)
  const playerApiRef = useRef<PlayerApi | null>(null)
  const popupRef = useRef<Window | null>(null)
  const channelRef = useRef<BroadcastChannel | null>(null)
  const lastTickRef = useRef(0)
  const popupOpenRef = useRef(false)

  popupOpenRef.current = popupOpen

  useEffect(() => {
    localStorage.setItem(KEY_STORAGE, JSON.stringify(songKey))
  }, [songKey])

  useEffect(() => {
    if (videoId) localStorage.setItem(VIDEO_STORAGE, videoId)
    else localStorage.removeItem(VIDEO_STORAGE)
  }, [videoId])

  useEffect(() => {
    const channel = openPlayerChannel()
    channelRef.current = channel
    channel.postMessage({ type: 'hello', role: 'main' } satisfies PlayerSyncMessage)

    channel.onmessage = (ev: MessageEvent<PlayerSyncMessage>) => {
      const msg = ev.data
      if (!msg || typeof msg !== 'object') return
      if (msg.type === 'tick' && popupOpenRef.current) {
        const now = performance.now()
        if (now - lastTickRef.current < 80 && msg.playing) {
          setPlaying(msg.playing)
          return
        }
        lastTickRef.current = now
        setCurrentTime(msg.t)
        setPlaying(msg.playing)
      }
      if (msg.type === 'popup-ready' || msg.type === 'hello') {
        if (msg.type === 'hello' && msg.role === 'popup') setPopupOpen(true)
        if (msg.type === 'popup-ready') setPopupOpen(true)
      }
      if (msg.type === 'popup-closed') {
        setPopupOpen(false)
        popupRef.current = null
      }
    }

    const pollClosed = window.setInterval(() => {
      if (popupRef.current && popupRef.current.closed) {
        setPopupOpen(false)
        popupRef.current = null
        channel.postMessage({ type: 'popup-closed' } satisfies PlayerSyncMessage)
      }
    }, 800)

    return () => {
      window.clearInterval(pollClosed)
      channel.close()
      channelRef.current = null
    }
  }, [])

  useEffect(() => {
    if (popupOpen && videoId) {
      channelRef.current?.postMessage({
        type: 'video',
        videoId,
      } satisfies PlayerSyncMessage)
    }
  }, [videoId, popupOpen])

  const handleTimeUpdate = useCallback((t: number, isPlaying: boolean) => {
    if (popupOpenRef.current) return
    setPlaying(isPlaying)
    const now = performance.now()
    if (now - lastTickRef.current < 100 && isPlaying) return
    lastTickRef.current = now
    setCurrentTime(t)
  }, [])

  const handlePlayerReady = useCallback((api: PlayerApi) => {
    playerApiRef.current = api
    setStatus('영상을 불러온 뒤 오른쪽에서 조성 분석을 실행하세요')
  }, [])

  const handleSeek = useCallback((sec: number) => {
    setCurrentTime(sec)
    setPlaying(true)
    if (popupOpenRef.current) {
      channelRef.current?.postMessage({
        type: 'command',
        cmd: 'seek',
        t: sec,
      } satisfies PlayerSyncMessage)
      return
    }
    playerApiRef.current?.seekTo(sec)
    playerApiRef.current?.play()
  }, [])

  const handleOpenPopup = useCallback(() => {
    if (!videoId) {
      setStatus('먼저 YouTube 영상을 불러오세요')
      return
    }
    const win = openPlayerPopup(videoId)
    if (!win) {
      setStatus('팝업이 차단되었습니다. 브라우저에서 팝업을 허용해 주세요.')
      return
    }
    popupRef.current = win
    setPopupOpen(true)
    try {
      playerApiRef.current?.pause()
    } catch {
      // ignore
    }
    setStatus('큰 화면 창을 두 번째 모니터로 옮기면 됩니다')
  }, [videoId])

  const handleFocusPopup = useCallback(() => {
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.focus()
      channelRef.current?.postMessage({ type: 'focus-popup' } satisfies PlayerSyncMessage)
      return
    }
    handleOpenPopup()
  }, [handleOpenPopup])

  return (
    <div className="app">
      <div className="bg-atmosphere" aria-hidden />
      <header className="topbar">
        <div className="brand-block">
          <p className="brand">WhereMusic</p>
          <p className="tagline">링크만 있으면, 조성과 코드 진행까지</p>
        </div>
        <div className="project-controls">
          <span className="top-key-badge">
            Key {songKey.root} {songKey.mode === 'major' ? 'Major' : 'minor'}
          </span>
          {popupOpen && (
            <button type="button" className="btn ghost" onClick={handleFocusPopup}>
              큰 화면 포커스
            </button>
          )}
        </div>
      </header>

      {status && (
        <div className="status-bar" role="status">
          {status}
          <button type="button" className="status-close" onClick={() => setStatus(null)}>
            ×
          </button>
        </div>
      )}

      <main className="workspace">
        <YoutubePanel
          videoId={videoId}
          onVideoIdChange={setVideoId}
          onTimeUpdate={handleTimeUpdate}
          onPlayerReady={handlePlayerReady}
          popupOpen={popupOpen}
          onOpenPopup={handleOpenPopup}
          onFocusPopup={handleFocusPopup}
        />
        <AnalysisPanel
          videoId={videoId}
          songKey={songKey}
          currentTime={currentTime}
          playing={playing}
          onKeyChange={setSongKey}
          onSeek={handleSeek}
        />
      </main>
    </div>
  )
}
