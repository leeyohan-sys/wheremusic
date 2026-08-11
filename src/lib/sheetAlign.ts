import type { ProgressionChord } from './analyzeApi'
import type { LeadBar, LeadLine } from './leadSheet'
import {
  formBeats,
  formDurationSec,
  type SheetBarDef,
  type SongSheet,
} from './songSheets'

export interface SheetTiming {
  offsetSec: number
  bpm: number
  barSec4: number
  formSec: number
  repeats: number
}

function rootOf(symbol: string): string {
  const m = symbol.match(/^([A-G](?:#|b)?)/)
  return m?.[1] ?? symbol
}

function scoreAlignment(
  progression: ProgressionChord[],
  sheet: SongSheet,
  offset: number,
  bpm: number,
  durationSec: number,
): number {
  const beatSec = 60 / bpm
  const formSec = formDurationSec(sheet, bpm)
  if (formSec <= 0) return -1

  let score = 0
  let checks = 0
  let t = offset
  let formIdx = 0

  while (t < durationSec - 1 && formIdx < 8) {
    let beatPos = 0
    for (const bar of sheet.form) {
      for (const hit of bar.chords) {
        const at = t + (beatPos + hit.beat) * beatSec + 0.15
        if (at >= durationSec) break
        const expected = rootOf(hit.symbol)
        const actual = progression.find((p) => at >= p.t && at < p.end)
        checks += 1
        if (actual && rootOf(actual.symbol) === expected) score += 1
        else if (actual && rootOf(actual.symbol)[0] === expected[0]) score += 0.35
      }
      beatPos += bar.beats
    }
    t += formSec
    formIdx += 1
  }

  return checks ? score / checks : 0
}

/** Search offset + BPM so the printed form lines up with detected roots. */
export function alignSheetTiming(
  sheet: SongSheet,
  progression: ProgressionChord[],
  durationSec: number,
): SheetTiming {
  let best = { offsetSec: 8, bpm: 72, score: -1 }

  for (let bpm = 62; bpm <= 86; bpm += 1) {
    const formSec = formDurationSec(sheet, bpm)
    const maxOffset = Math.min(40, Math.max(4, durationSec - formSec))
    for (let offset = 0; offset <= maxOffset; offset += 0.25) {
      const s = scoreAlignment(progression, sheet, offset, bpm, durationSec)
      if (s > best.score) best = { offsetSec: offset, bpm, score: s }
    }
  }

  const barSec4 = (4 * 60) / best.bpm
  const formSec = formDurationSec(sheet, best.bpm)
  const repeats = Math.max(1, Math.ceil((durationSec - best.offsetSec) / formSec))

  return {
    offsetSec: Number(best.offsetSec.toFixed(2)),
    bpm: best.bpm,
    barSec4: Number(barSec4.toFixed(3)),
    formSec: Number(formSec.toFixed(2)),
    repeats,
  }
}

function barLabel(def: SheetBarDef): string {
  return def.chords.map((c) => c.symbol).join('  ')
}

function buildTimedBars(
  sheet: SongSheet,
  timing: SheetTiming,
  durationSec: number,
): LeadBar[] {
  const beatSec = 60 / timing.bpm
  const bars: LeadBar[] = []
  let index = 0
  let t = timing.offsetSec

  // optional intro placeholder before first downbeat
  if (timing.offsetSec > 0.8) {
    bars.push({
      index: index++,
      start: 0,
      end: timing.offsetSec,
      chords: ['(intro)'],
      label: '(intro)',
    })
  }

  while (t < durationSec - 0.5) {
    for (const def of sheet.form) {
      const dur = def.beats * beatSec
      const end = Math.min(durationSec, t + dur)
      if (t >= durationSec - 0.05) break
      bars.push({
        index: index++,
        start: Number(t.toFixed(2)),
        end: Number(end.toFixed(2)),
        chords: def.chords.map((c) => c.symbol),
        label: barLabel(def),
      })
      t = end
    }
  }

  return bars
}

/** Group bars into printed-score style lines (variable bars/line). */
export function buildSheetLeadLines(
  sheet: SongSheet,
  timing: SheetTiming,
  durationSec: number,
): LeadLine[] {
  const bars = buildTimedBars(sheet, timing, durationSec)
  const lines: LeadLine[] = []
  let cursor = 0
  let lineIndex = 0

  // intro alone on first line if present
  if (bars[0]?.label === '(intro)') {
    lines.push({
      lineIndex: lineIndex++,
      startBar: 1,
      bars: [bars[0]],
    })
    cursor = 1
  }

  const pattern = sheet.lineSizes
  let patternIdx = 0
  while (cursor < bars.length) {
    const size = pattern[patternIdx % pattern.length]
    patternIdx += 1
    const slice = bars.slice(cursor, cursor + size)
    if (!slice.length) break
    lines.push({
      lineIndex: lineIndex++,
      startBar: cursor + 1,
      bars: slice,
    })
    cursor += slice.length
  }

  return lines
}

export function sheetMetaLabel(sheet: SongSheet, timing: SheetTiming): string {
  const beats = formBeats(sheet)
  return `악보 기준 · ${timing.bpm} BPM · 4/4≈${timing.barSec4.toFixed(2)}s · 1절 ${beats}박(${timing.formSec}s)`
}
