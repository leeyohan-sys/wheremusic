export const PLAYER_CHANNEL = 'wheremusic-player-sync'

export type PlayerSyncMessage =
  | { type: 'hello'; role: 'main' | 'popup' }
  | { type: 'video'; videoId: string }
  | { type: 'tick'; t: number; playing: boolean; videoId: string }
  | { type: 'command'; cmd: 'seek' | 'play' | 'pause'; t?: number }
  | { type: 'popup-ready' }
  | { type: 'popup-closed' }
  | { type: 'focus-popup' }

export function openPlayerChannel(): BroadcastChannel {
  return new BroadcastChannel(PLAYER_CHANNEL)
}

export function openPlayerPopup(videoId: string): Window | null {
  const url = `${window.location.origin}${window.location.pathname}?popup=1&v=${encodeURIComponent(videoId)}`
  const features = [
    'popup=yes',
    'noopener=no',
    'width=1400',
    'height=820',
    'left=80',
    'top=40',
    'menubar=no',
    'toolbar=no',
    'location=no',
    'status=no',
    'resizable=yes',
    'scrollbars=no',
  ].join(',')
  return window.open(url, 'wheremusic-yt-popup', features)
}

export function isPlayerPopupRoute(): boolean {
  const params = new URLSearchParams(window.location.search)
  return params.get('popup') === '1'
}

export function popupVideoIdFromRoute(): string | null {
  const params = new URLSearchParams(window.location.search)
  const v = params.get('v')
  return v && /^[\w-]{11}$/.test(v) ? v : null
}
