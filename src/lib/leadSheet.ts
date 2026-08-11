import type { ProgressionChord } from './analyzeApi'
import { formatClock } from './analyzeApi'

export interface LeadBar {
  index: number
  start: number
  end: number
  chords: string[]
  label: string
}

export interface LeadLine {
  lineIndex: number
  startBar: number
  bars: LeadBar[]
}

/** Estimate one bar length (seconds) from progression density. */
export function estimateBarSec(progression: ProgressionChord[]): number {
  if (progression.length < 2) return 3
  const lens = progression
    .map((p) => Math.max(0.01, p.end - p.t))
    .sort((a, b) => a - b)
  const mid = lens[Math.floor(lens.length / 2)]
  // Prefer typical 4/4 CCM bar lengths (~2.6–3.6s ≈ 67–92 BPM)
  const guess = Math.max(mid * 1.35, mid + 0.8)
  return Math.min(3.6, Math.max(2.6, Number(guess.toFixed(2))))
}

function chordsInWindow(
  progression: ProgressionChord[],
  start: number,
  end: number,
  hold: string | null,
): string[] {
  const hits: Array<{ t: number; symbol: string }> = []
  for (const p of progression) {
    if (p.end <= start || p.t >= end) continue
    hits.push({ t: Math.max(p.t, start), symbol: p.symbol })
  }
  hits.sort((a, b) => a.t - b.t)

  const ordered: string[] = []
  for (const h of hits) {
    if (ordered[ordered.length - 1] !== h.symbol) ordered.push(h.symbol)
  }

  if (ordered.length === 0) {
    return hold ? [hold] : ['·']
  }

  // Keep at most 2 chord changes inside one bar for readability
  if (ordered.length > 2) {
    return [ordered[0], ordered[ordered.length - 1]]
  }
  return ordered
}

export function buildLeadSheet(
  progression: ProgressionChord[],
  durationSec: number,
  barSec: number,
  barsPerLine = 4,
): LeadLine[] {
  if (!progression.length || barSec <= 0) return []

  const start = Math.max(0, progression[0].t)
  const end = Math.max(durationSec, progression[progression.length - 1].end, start + barSec)
  const barCount = Math.ceil((end - start) / barSec)

  const bars: LeadBar[] = []
  let hold: string | null = null

  for (let i = 0; i < barCount; i++) {
    const bStart = start + i * barSec
    const bEnd = bStart + barSec
    const chords = chordsInWindow(progression, bStart, bEnd, hold)
    if (chords[0] !== '·') hold = chords[chords.length - 1]
    bars.push({
      index: i,
      start: bStart,
      end: bEnd,
      chords,
      label: chords.join('  '),
    })
  }

  const lines: LeadLine[] = []
  for (let i = 0; i < bars.length; i += barsPerLine) {
    const slice = bars.slice(i, i + barsPerLine)
    while (slice.length < barsPerLine) {
      const last = slice[slice.length - 1]
      slice.push({
        index: -1,
        start: last?.end ?? end,
        end: (last?.end ?? end) + barSec,
        chords: [],
        label: '',
      })
    }
    lines.push({
      lineIndex: Math.floor(i / barsPerLine),
      startBar: i + 1,
      bars: slice,
    })
  }
  return lines
}

export function lineTimeLabel(line: LeadLine): string {
  const real = line.bars.filter((b) => b.index >= 0)
  if (!real.length) return ''
  return `${formatClock(real[0].start)}`
}

export function findActiveBar(
  lines: LeadLine[],
  timeSec: number,
): { lineIndex: number; barIndex: number; bar: LeadBar; progress: number } | null {
  for (const line of lines) {
    for (let bi = 0; bi < line.bars.length; bi++) {
      const bar = line.bars[bi]
      if (bar.index < 0) continue
      if (timeSec >= bar.start && timeSec < bar.end) {
        const dur = Math.max(bar.end - bar.start, 0.001)
        return {
          lineIndex: line.lineIndex,
          barIndex: bi,
          bar,
          progress: Math.min(1, Math.max(0, (timeSec - bar.start) / dur)),
        }
      }
    }
  }

  // clamp to last real bar if past end
  for (let li = lines.length - 1; li >= 0; li--) {
    const real = lines[li].bars.filter((b) => b.index >= 0)
    const last = real[real.length - 1]
    if (!last) continue
    if (timeSec >= last.start) {
      return {
        lineIndex: lines[li].lineIndex,
        barIndex: lines[li].bars.findIndex((b) => b.index === last.index),
        bar: last,
        progress: 1,
      }
    }
  }
  return null
}

export function chordAtTime(
  progression: ProgressionChord[],
  timeSec: number,
): ProgressionChord | null {
  for (const p of progression) {
    if (timeSec >= p.t && timeSec < p.end) return p
  }
  if (!progression.length) return null
  const last = progression[progression.length - 1]
  if (timeSec >= last.t) return last
  return null
}
