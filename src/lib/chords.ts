import type { ChordCandidate, NoteName, SongKey } from '../types'

export const NOTE_NAMES: NoteName[] = [
  'C',
  'C#',
  'D',
  'Eb',
  'E',
  'F',
  'F#',
  'G',
  'Ab',
  'A',
  'Bb',
  'B',
]

const NOTE_INDEX: Record<NoteName, number> = {
  C: 0,
  'C#': 1,
  D: 2,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  G: 7,
  Ab: 8,
  A: 9,
  Bb: 10,
  B: 11,
}

/** Pitch-class templates (relative to root) */
const QUALITY_TEMPLATES: Record<
  ChordCandidate['quality'],
  { intervals: number[]; weight: number }
> = {
  maj: { intervals: [0, 4, 7], weight: 1 },
  min: { intervals: [0, 3, 7], weight: 1 },
  dim: { intervals: [0, 3, 6], weight: 0.9 },
  aug: { intervals: [0, 4, 8], weight: 0.85 },
  '7': { intervals: [0, 4, 7, 10], weight: 0.95 },
  maj7: { intervals: [0, 4, 7, 11], weight: 0.9 },
  min7: { intervals: [0, 3, 7, 10], weight: 0.95 },
}

function rotate(chroma: number[], steps: number): number[] {
  const n = chroma.length
  const out = new Array<number>(n)
  for (let i = 0; i < n; i++) out[i] = chroma[(i + steps) % n]
  return out
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na < 1e-9 || nb < 1e-9) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

function templateVector(intervals: number[]): number[] {
  const v = new Array(12).fill(0)
  for (const iv of intervals) v[iv % 12] = 1
  // slight weight on fifth/root for stability
  v[0] += 0.15
  if (intervals.includes(7)) v[7] += 0.08
  return v
}

function symbolFor(root: NoteName, quality: ChordCandidate['quality']): string {
  switch (quality) {
    case 'maj':
      return root
    case 'min':
      return `${root}m`
    case 'dim':
      return `${root}dim`
    case 'aug':
      return `${root}aug`
    case '7':
      return `${root}7`
    case 'maj7':
      return `${root}maj7`
    case 'min7':
      return `${root}m7`
  }
}

/** Diatonic triad/seventh set for a key (pitch-class roots + preferred qualities). */
export function diatonicChords(key: SongKey): Array<{
  root: NoteName
  quality: ChordCandidate['quality']
}> {
  const root = NOTE_INDEX[key.root]
  if (key.mode === 'major') {
    const degrees: Array<[number, ChordCandidate['quality']]> = [
      [0, 'maj'],
      [2, 'min'],
      [4, 'min'],
      [5, 'maj'],
      [7, 'maj'],
      [9, 'min'],
      [11, 'dim'],
      [0, 'maj7'],
      [2, 'min7'],
      [5, 'maj7'],
      [7, '7'],
      [9, 'min7'],
    ]
    return degrees.map(([pc, quality]) => ({
      root: NOTE_NAMES[(root + pc) % 12],
      quality,
    }))
  }

  // natural minor + common harmonic V / V7
  const degrees: Array<[number, ChordCandidate['quality']]> = [
    [0, 'min'],
    [2, 'dim'],
    [3, 'maj'],
    [5, 'min'],
    [7, 'min'],
    [8, 'maj'],
    [10, 'maj'],
    [0, 'min7'],
    [3, 'maj7'],
    [5, 'min7'],
    [7, '7'], // V7 borrowed
    [8, 'maj7'],
    [10, '7'],
  ]
  return degrees.map(([pc, quality]) => ({
    root: NOTE_NAMES[(root + pc) % 12],
    quality,
  }))
}

export function formatKey(key: SongKey): string {
  return `${key.root} ${key.mode === 'major' ? 'Major' : 'minor'}`
}

export function scaleDegrees(key: SongKey): NoteName[] {
  const root = NOTE_INDEX[key.root]
  const intervals =
    key.mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10]
  return intervals.map((i) => NOTE_NAMES[(root + i) % 12])
}

/**
 * Match chroma (length 12, C=0) against chord templates.
 * Prefers diatonic chords of the selected key via score boost.
 */
export function detectChord(
  chroma: number[],
  key: SongKey,
  options?: { allowOutOfKey?: boolean },
): ChordCandidate | null {
  const allowOutOfKey = options?.allowOutOfKey ?? true
  const inKeySet = new Set(
    diatonicChords(key).map((c) => `${c.root}|${c.quality}`),
  )

  const qualities = Object.keys(QUALITY_TEMPLATES) as ChordCandidate['quality'][]
  const candidates: ChordCandidate[] = []

  for (let rootPc = 0; rootPc < 12; rootPc++) {
    const root = NOTE_NAMES[rootPc]
    const rotated = rotate(chroma, rootPc)
    for (const quality of qualities) {
      const tpl = QUALITY_TEMPLATES[quality]
      const score =
        cosineSimilarity(rotated, templateVector(tpl.intervals)) * tpl.weight
      const inKey = inKeySet.has(`${root}|${quality}`)
      if (!inKey && !allowOutOfKey) continue
      candidates.push({
        symbol: symbolFor(root, quality),
        root,
        quality,
        score: inKey ? score * 1.18 : score,
        inKey,
      })
    }
  }

  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]
  if (!best || best.score < 0.55) return null
  return best
}

