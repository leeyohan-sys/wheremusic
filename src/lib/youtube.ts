let apiPromise: Promise<void> | null = null

export function extractVideoId(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  if (/^[\w-]{11}$/.test(trimmed)) return trimmed

  try {
    const url = new URL(trimmed)
    const host = url.hostname.replace(/^www\./, '')

    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0]
      return id && /^[\w-]{11}$/.test(id) ? id : null
    }

    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      if (url.pathname === '/watch') {
        const id = url.searchParams.get('v')
        return id && /^[\w-]{11}$/.test(id) ? id : null
      }
      const parts = url.pathname.split('/').filter(Boolean)
      if ((parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live') && parts[1]) {
        return /^[\w-]{11}$/.test(parts[1]) ? parts[1] : null
      }
    }
  } catch {
    return null
  }

  return null
}

export function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve()
  if (apiPromise) return apiPromise

  apiPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      resolve()
    }

    const existing = document.querySelector<HTMLScriptElement>('script[data-yt-api]')
    if (existing) return

    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.async = true
    script.dataset.ytApi = 'true'
    script.onerror = () => {
      apiPromise = null
      reject(new Error('YouTube API 스크립트를 불러오지 못했습니다.'))
    }
    document.head.appendChild(script)
  })

  return apiPromise
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}

export function parseTimeInput(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)

  const parts = trimmed.split(':').map(Number)
  if (parts.some((n) => Number.isNaN(n))) return null
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return null
}
