import type { KeyMode, NoteName } from '../types'
import type { SongSheet } from './songSheets'

const ANALYZE_BASE =
  (import.meta.env.VITE_ANALYZE_URL as string | undefined)?.replace(/\/$/, '') ||
  'http://127.0.0.1:18790'

export interface RankedKey {
  id: string
  root: NoteName
  mode: KeyMode
  label: string
  confidence: number
  inKeyRatio: number
  relative: number
  rank: number
  topChords: Array<{ symbol: string; frames: number; ratio: number }>
}

export interface ProgressionChord {
  t: number
  end: number
  symbol: string
  score: number
  inKey: boolean
}

export interface KeyDetail {
  root: NoteName
  mode: KeyMode
  label: string
  inKeyRatio: number
  confidence: number
  topChords: Array<{ symbol: string; frames: number; ratio: number }>
  progression: ProgressionChord[]
  sampleCount: number
}

export interface AnalyzeResult {
  title?: string
  videoId?: string
  durationSec: number
  frameCount: number
  rankings: RankedKey[]
  keys: Record<string, KeyDetail>
  bestKey: RankedKey
  uploadedSheet?: SongSheet
  suggestedKeyId?: string
  webScoreSearch?: {
    scoreFound: boolean
    ocrOk?: boolean
    title?: string
    error?: string
    searchQuery?: string
    tokenCount?: number
    bars?: number
  }
}

export interface SheetImagePayload {
  name: string
  dataBase64: string
}

export async function checkAnalyzeServer(): Promise<boolean> {
  try {
    const res = await fetch(`${ANALYZE_BASE}/wm-analyze/health`, { method: 'GET' })
    if (!res.ok) return false
    const data = (await res.json()) as { ok?: boolean; service?: string }
    return Boolean(data.ok)
  } catch {
    return false
  }
}

export async function analyzeYoutube(
  urlOrId: string,
  sheets?: SheetImagePayload[],
): Promise<AnalyzeResult> {
  const res = await fetch(`${ANALYZE_BASE}/wm-analyze/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: urlOrId,
      sheets: sheets?.length ? sheets : undefined,
    }),
  })
  const data = (await res.json()) as AnalyzeResult & { error?: string }
  if (!res.ok) {
    throw new Error(data.error || `분석 실패 (${res.status})`)
  }
  return data
}

export async function extractSheetFromImages(
  sheets: SheetImagePayload[],
): Promise<SongSheet> {
  const res = await fetch(`${ANALYZE_BASE}/wm-analyze/extract-sheet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sheets }),
  })
  const data = (await res.json()) as { sheet?: SongSheet; error?: string }
  if (!res.ok || !data.sheet) {
    throw new Error(data.error || `악보 추출 실패 (${res.status})`)
  }
  return data.sheet
}

export function fileToBase64Payload(file: File): Promise<SheetImagePayload> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      resolve({
        name: file.name,
        dataBase64: String(reader.result),
      })
    }
    reader.onerror = () => reject(new Error(`이미지 읽기 실패: ${file.name}`))
    reader.readAsDataURL(file)
  })
}

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}
