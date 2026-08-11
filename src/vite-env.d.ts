/// <reference types="vite/client" />

interface YTPlayer {
  destroy: () => void
  getCurrentTime: () => number
  getDuration: () => number
  getPlayerState: () => number
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  playVideo: () => void
  pauseVideo: () => void
}

interface YTPlayerEvent {
  data: number
  target: YTPlayer
}

interface YTNamespace {
  Player: new (
    elementId: string | HTMLElement,
    options: {
      videoId?: string
      width?: string | number
      height?: string | number
      playerVars?: Record<string, string | number>
      events?: {
        onReady?: (event: YTPlayerEvent) => void
        onStateChange?: (event: YTPlayerEvent) => void
        onError?: (event: YTPlayerEvent) => void
      }
    },
  ) => YTPlayer
  PlayerState: {
    UNSTARTED: number
    ENDED: number
    PLAYING: number
    PAUSED: number
    BUFFERING: number
    CUED: number
  }
}

interface Window {
  YT?: YTNamespace
  onYouTubeIframeAPIReady?: () => void
}
