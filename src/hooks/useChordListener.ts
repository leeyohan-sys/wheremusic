import { useCallback, useEffect, useRef, useState } from 'react'
import { detectChord } from '../lib/chords'
import { smoothChroma, spectrumToChroma } from '../lib/chroma'
import type { ChordCandidate, ChordHistoryItem, SongKey } from '../types'

export interface ListenerState {
  listening: boolean
  error: string | null
  current: ChordCandidate | null
  chroma: number[]
  energy: number
  history: ChordHistoryItem[]
}

const EMPTY_CHROMA = new Array(12).fill(0)

export function useChordListener(key: SongKey) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [current, setCurrent] = useState<ChordCandidate | null>(null)
  const [chroma, setChroma] = useState<number[]>(EMPTY_CHROMA)
  const [energy, setEnergy] = useState(0)
  const [history, setHistory] = useState<ChordHistoryItem[]>([])

  const keyRef = useRef(key)
  const audioRef = useRef<{
    ctx: AudioContext
    stream: MediaStream
    analyser: AnalyserNode
    raf: number
    smooth: number[] | null
    lastSymbol: string | null
    stableCount: number
  } | null>(null)

  keyRef.current = key

  const stop = useCallback(() => {
    const pack = audioRef.current
    if (!pack) {
      setListening(false)
      return
    }
    cancelAnimationFrame(pack.raf)
    pack.stream.getTracks().forEach((t) => t.stop())
    void pack.ctx.close()
    audioRef.current = null
    setListening(false)
    setCurrent(null)
    setEnergy(0)
    setChroma(EMPTY_CHROMA)
  }, [])

  const start = useCallback(async () => {
    setError(null)
    if (audioRef.current) stop()

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
        },
        video: false,
      })

      const ctx = new AudioContext()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 8192
      analyser.smoothingTimeConstant = 0.8
      source.connect(analyser)

      const freq = new Uint8Array(analyser.frequencyBinCount)
      const pack = {
        ctx,
        stream,
        analyser,
        raf: 0,
        smooth: null as number[] | null,
        lastSymbol: null as string | null,
        stableCount: 0,
      }
      audioRef.current = pack
      setListening(true)

      const tick = () => {
        const live = audioRef.current
        if (!live) return

        live.analyser.getByteFrequencyData(freq)
        const { chroma: raw, energy: e } = spectrumToChroma(
          freq,
          live.ctx.sampleRate,
          live.analyser.fftSize,
        )
        live.smooth = smoothChroma(live.smooth, raw, 0.4)
        const chord =
          e > 0.015
            ? detectChord(live.smooth, keyRef.current, { allowOutOfKey: true })
            : null

        setChroma(live.smooth.slice())
        setEnergy(e)
        setCurrent(chord)

        if (chord && e > 0.02) {
          if (chord.symbol === live.lastSymbol) {
            live.stableCount += 1
          } else {
            live.lastSymbol = chord.symbol
            live.stableCount = 1
          }
          // commit to history after brief stability
          if (live.stableCount === 8) {
            const symbol = chord.symbol
            setHistory((prev) => {
              if (prev[0]?.symbol === symbol) return prev
              return [
                { id: `${Date.now()}_${symbol}`, symbol, at: Date.now() },
                ...prev,
              ].slice(0, 24)
            })
          }
        } else {
          live.stableCount = 0
        }

        live.raf = requestAnimationFrame(tick)
      }

      pack.raf = requestAnimationFrame(tick)
    } catch (e) {
      setListening(false)
      setError(
        e instanceof Error
          ? e.message
          : '마이크 권한을 허용해야 코드를 감지할 수 있습니다.',
      )
    }
  }, [stop])

  useEffect(() => () => stop(), [stop])

  return {
    listening,
    error,
    current,
    chroma,
    energy,
    history,
    start,
    stop,
    clearHistory: () => setHistory([]),
  } satisfies ListenerState & {
    start: () => Promise<void>
    stop: () => void
    clearHistory: () => void
  }
}
