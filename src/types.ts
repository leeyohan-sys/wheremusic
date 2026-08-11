export type NoteName =
  | 'C'
  | 'C#'
  | 'D'
  | 'Eb'
  | 'E'
  | 'F'
  | 'F#'
  | 'G'
  | 'Ab'
  | 'A'
  | 'Bb'
  | 'B'

export type KeyMode = 'major' | 'minor'

export interface SongKey {
  root: NoteName
  mode: KeyMode
}

export interface ChordCandidate {
  symbol: string
  root: NoteName
  quality: 'maj' | 'min' | 'dim' | 'aug' | '7' | 'maj7' | 'min7'
  score: number
  inKey: boolean
}

export interface ChordDetection {
  chord: ChordCandidate | null
  chroma: number[]
  energy: number
  timestamp: number
}

export interface ChordHistoryItem {
  id: string
  symbol: string
  at: number
}
