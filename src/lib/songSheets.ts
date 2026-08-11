import type { KeyMode, NoteName } from '../types'

/**
 * Hand-transcribed or OCR-extracted lead sheets.
 */

export interface SheetChordHit {
  /** beat position within the bar (0-based, in quarter notes) */
  beat: number
  symbol: string
}

export interface SheetBarDef {
  /** bar length in quarter-note beats (4 = 4/4, 2 = 2/4) */
  beats: number
  chords: SheetChordHit[]
}

export interface SongSheet {
  id: string
  title: string
  videoIds: string[]
  key: { root: NoteName; mode: KeyMode }
  /** printed score line breaks (number of bars per staff line) */
  lineSizes: number[]
  /** one full form (verse) as on the sheet */
  form: SheetBarDef[]
  source?: 'builtin' | 'ocr' | 'web-search'
  rawLines?: string[][]
  tokenCount?: number
  pageCount?: number
  keySource?: string
  labelHint?: string | null
}

/** 손경민 - 하나님의 부르심 (GA / G Major score) */
export const CALLING_OF_GOD_GA: SongSheet = {
  id: 'calling-of-god-ga',
  title: '하나님의 부르심',
  videoIds: ['OF-1Wjd9R2w'],
  key: { root: 'G', mode: 'major' },
  source: 'builtin',
  // score staves: 3 + 3 + 4 + 4 + 4
  lineSizes: [3, 3, 4, 4, 4],
  form: [
    { beats: 4, chords: [{ beat: 0, symbol: 'G' }] },
    { beats: 4, chords: [{ beat: 0, symbol: 'D/F#' }] },
    {
      beats: 4,
      chords: [
        { beat: 0, symbol: 'Em' },
        { beat: 3, symbol: 'Bm/D' },
      ],
    },
    { beats: 4, chords: [{ beat: 0, symbol: 'C' }] },
    {
      beats: 4,
      chords: [
        { beat: 0, symbol: 'G/B' },
        { beat: 2, symbol: 'Am7' },
        { beat: 3, symbol: 'D7' },
      ],
    },
    {
      beats: 4,
      chords: [
        { beat: 0, symbol: 'G' },
        { beat: 3, symbol: 'D/F#' },
      ],
    },
    {
      beats: 4,
      chords: [
        { beat: 0, symbol: 'Em' },
        { beat: 3, symbol: 'Bm/D' },
      ],
    },
    {
      beats: 4,
      chords: [
        { beat: 0, symbol: 'C' },
        { beat: 2, symbol: 'G/B' },
      ],
    },
    {
      beats: 2, // 2/4
      chords: [
        { beat: 0, symbol: 'Am7' },
        { beat: 1, symbol: 'D7' },
      ],
    },
    {
      beats: 4,
      chords: [
        { beat: 0, symbol: 'G' },
        { beat: 3, symbol: 'C/D' },
      ],
    },
    {
      beats: 4,
      chords: [
        { beat: 0, symbol: 'G' },
        { beat: 3, symbol: 'G/B' },
      ],
    },
    {
      beats: 4,
      chords: [
        { beat: 0, symbol: 'C' },
        { beat: 2, symbol: 'E7' },
        { beat: 3, symbol: 'Am7' },
      ],
    },
    {
      beats: 4,
      chords: [
        { beat: 0, symbol: 'A/C#' },
        { beat: 2, symbol: 'D' },
      ],
    },
    {
      beats: 4,
      chords: [
        { beat: 0, symbol: 'D' },
        { beat: 3, symbol: 'B/D#' },
      ],
    },
    {
      beats: 4,
      chords: [
        { beat: 0, symbol: 'Em' },
        { beat: 3, symbol: 'G/D' },
      ],
    },
    {
      beats: 4,
      chords: [
        { beat: 0, symbol: 'C' },
        { beat: 3, symbol: 'Cm6' },
      ],
    },
    {
      beats: 4,
      chords: [
        { beat: 0, symbol: 'G/D' },
        { beat: 2, symbol: 'Am7' },
        { beat: 3, symbol: 'D7' },
      ],
    },
    { beats: 4, chords: [{ beat: 0, symbol: 'G' }] },
  ],
}

export const SONG_SHEETS: SongSheet[] = [CALLING_OF_GOD_GA]

export function findSongSheet(videoId: string | null | undefined): SongSheet | null {
  if (!videoId) return null
  return SONG_SHEETS.find((s) => s.videoIds.includes(videoId)) ?? null
}

export function formBeats(sheet: SongSheet): number {
  return sheet.form.reduce((sum, b) => sum + b.beats, 0)
}

export function formDurationSec(sheet: SongSheet, bpm: number): number {
  return (formBeats(sheet) * 60) / bpm
}
