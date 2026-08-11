import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  analyzeYoutube,
  checkAnalyzeServer,
  fileToBase64Payload,
  formatClock,
  type AnalyzeResult,
  type RankedKey,
} from '../lib/analyzeApi'
import {
  buildLeadSheet,
  chordAtTime,
  estimateBarSec,
  findActiveBar,
  lineTimeLabel,
} from '../lib/leadSheet'
import {
  alignSheetTiming,
  buildSheetLeadLines,
  sheetMetaLabel,
  type SheetTiming,
} from '../lib/sheetAlign'
import { findSongSheet, formDurationSec, type SongSheet } from '../lib/songSheets'
import type { SongKey } from '../types'

interface AnalysisPanelProps {
  videoId: string | null
  songKey: SongKey
  currentTime: number
  playing: boolean
  onKeyChange: (key: SongKey) => void
  onSeek: (sec: number) => void
}

function chordInBar(chords: string[], progress: number): string {
  if (!chords.length) return '—'
  if (chords.length === 1) return chords[0]
  const idx = Math.min(chords.length - 1, Math.floor(progress * chords.length))
  return chords[idx]
}

export function AnalysisPanel({
  videoId,
  songKey,
  currentTime,
  playing,
  onKeyChange,
  onSeek,
}: AnalysisPanelProps) {
  const [serverOk, setServerOk] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AnalyzeResult | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [barSec, setBarSec] = useState(2)
  const [autoBar, setAutoBar] = useState(true)
  const [useSheet, setUseSheet] = useState(true)
  const [sheetTiming, setSheetTiming] = useState<SheetTiming | null>(null)
  const [sheetFiles, setSheetFiles] = useState<File[]>([])
  const [uploadedSheet, setUploadedSheet] = useState<SongSheet | null>(null)
  const sheetInputRef = useRef<HTMLInputElement>(null)
  const activeLineRef = useRef<HTMLDivElement | null>(null)
  const lastScrollBarRef = useRef<number | null>(null)

  const builtinSheet = useMemo(() => findSongSheet(videoId), [videoId])
  const activeSheet = uploadedSheet ?? (useSheet ? builtinSheet : null)

  const previews = useMemo(
    () => sheetFiles.map((f) => ({ name: f.name, url: URL.createObjectURL(f) })),
    [sheetFiles],
  )

  useEffect(() => {
    return () => {
      previews.forEach((p) => URL.revokeObjectURL(p.url))
    }
  }, [previews])

  useEffect(() => {
    let alive = true
    void checkAnalyzeServer().then((ok) => {
      if (alive) setServerOk(ok)
    })
    const id = window.setInterval(() => {
      void checkAnalyzeServer().then((ok) => {
        if (alive) setServerOk(ok)
      })
    }, 5000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [])

  const selected = useMemo(() => {
    if (!result || !selectedId) return null
    return result.keys[selectedId] ?? null
  }, [result, selectedId])

  const effectiveBarSec = useMemo(() => {
    if (activeSheet && useSheet && sheetTiming) return sheetTiming.barSec4
    if (!selected) return barSec
    if (autoBar) return estimateBarSec(selected.progression)
    return barSec
  }, [selected, autoBar, barSec, activeSheet, useSheet, sheetTiming])

  const leadLines = useMemo(() => {
    if (!result) return []
    if (activeSheet && useSheet && sheetTiming) {
      return buildSheetLeadLines(activeSheet, sheetTiming, result.durationSec)
    }
    if (!selected) return []
    return buildLeadSheet(
      selected.progression,
      result.durationSec,
      effectiveBarSec,
      4,
    )
  }, [selected, result, effectiveBarSec, activeSheet, useSheet, sheetTiming])

  const active = useMemo(
    () => findActiveBar(leadLines, currentTime),
    [leadLines, currentTime],
  )

  const nowSymbol = useMemo(() => {
    if (active && activeSheet && useSheet) {
      return chordInBar(active.bar.chords, active.progress)
    }
    if (selected) return chordAtTime(selected.progression, currentTime)?.symbol
    return active?.bar.label
  }, [active, selected, currentTime, activeSheet, useSheet])

  useEffect(() => {
    if (!active || !playing) return
    if (lastScrollBarRef.current === active.bar.index) return
    lastScrollBarRef.current = active.bar.index
    activeLineRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    })
  }, [active, playing])

  function onSheetFilesChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).filter((f) =>
      f.type.startsWith('image/'),
    )
    setSheetFiles((prev) => [...prev, ...files].slice(0, 6))
    e.target.value = ''
  }

  function applySheet(
    sheet: SongSheet,
    data: AnalyzeResult,
  ) {
    const keyId = `${sheet.key.root}:${sheet.key.mode}`
    const preferred =
      data.keys[keyId] ??
      (data.suggestedKeyId ? data.keys[data.suggestedKeyId] : undefined) ??
      data.keys[data.bestKey.id]
    setSelectedId(
      data.keys[keyId]
        ? keyId
        : data.suggestedKeyId ?? data.bestKey.id,
    )
    onKeyChange(sheet.key)
    const timing = alignSheetTiming(sheet, preferred.progression, data.durationSec)
    setSheetTiming(timing)
    setUseSheet(true)
    setBarSec(timing.barSec4)
    setAutoBar(false)
  }

  async function handleAnalyze() {
    if (!videoId) {
      setError('먼저 왼쪽에 YouTube 영상을 불러오세요.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const payloads =
        sheetFiles.length > 0
          ? await Promise.all(sheetFiles.map((f) => fileToBase64Payload(f)))
          : undefined
      const data = await analyzeYoutube(videoId, payloads)
      setResult(data)

      const ocrSheet = data.uploadedSheet ?? null
      if (ocrSheet) {
        setUploadedSheet(ocrSheet)
        applySheet(ocrSheet, data)
      } else {
        setUploadedSheet(null)
        const sheet = findSongSheet(videoId)
        if (sheet) {
          applySheet(sheet, data)
        } else {
          setSelectedId(data.bestKey.id)
          onKeyChange({ root: data.bestKey.root, mode: data.bestKey.mode })
          setSheetTiming(null)
          setUseSheet(false)
          const detail = data.keys[data.bestKey.id]
          if (detail) {
            setBarSec(estimateBarSec(detail.progression))
            setAutoBar(true)
          }
        }
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : '분석에 실패했습니다. 로컬 분석 서버가 켜져 있는지 확인하세요.',
      )
    } finally {
      setLoading(false)
    }
  }

  function selectKey(row: RankedKey) {
    setSelectedId(row.id)
    onKeyChange({ root: row.root, mode: row.mode })
    if (activeSheet && useSheet && result) {
      const prog = result.keys[row.id]?.progression
      if (prog) {
        setSheetTiming(alignSheetTiming(activeSheet, prog, result.durationSec))
      }
    }
  }

  const bpmApprox = Math.round(240 / effectiveBarSec)
  const sheetMode = Boolean(activeSheet && useSheet && sheetTiming)
  const sheetLabel =
    uploadedSheet?.source === 'ocr'
      ? '업로드 악보(OCR)'
      : uploadedSheet?.source === 'web-search'
        ? '웹 검색 악보(OCR)'
        : builtinSheet
          ? '내장 악보'
          : '악보'

  return (
    <section className="panel analysis-panel">
      <header className="panel-header">
        <h2>조성 · 코드 분석</h2>
        <span className="panel-meta">
          {serverOk === null ? '서버 확인 중…' : serverOk ? '분석 서버 연결됨' : '분석 서버 오프라인'}
        </span>
      </header>

      <p className="hint">
        악보 이미지를 올리면 OCR로 진행표를 만듭니다. 올리지 않으면 곡 제목으로 웹
        악보를 검색해 같은 방식으로 처리합니다. (코드 기호 위주 악보에 최적화)
      </p>

      <div className="sheet-upload">
        <div className="listen-bar">
          <button
            type="button"
            className="btn"
            onClick={() => sheetInputRef.current?.click()}
          >
            악보 이미지 추가
          </button>
          <input
            ref={sheetInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            hidden
            onChange={onSheetFilesChange}
          />
          {sheetFiles.length > 0 && (
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setSheetFiles([])
                setUploadedSheet(null)
              }}
            >
              악보 비우기
            </button>
          )}
          <span className="panel-meta">
            {sheetFiles.length > 0
              ? `${sheetFiles.length}장 선택됨`
              : '선택 사항 · 없으면 웹 검색 · 최대 6장'}
          </span>
        </div>
        {previews.length > 0 && (
          <div className="sheet-preview-row">
            {previews.map((p) => (
              <figure key={p.url} className="sheet-preview">
                <img src={p.url} alt={p.name} />
                <figcaption>{p.name}</figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>

      <div className="listen-bar">
        <button
          type="button"
          className="btn primary listen-btn"
          disabled={!videoId || loading || serverOk === false}
          onClick={() => void handleAnalyze()}
        >
          {loading ? '분석 중…' : '조성 분석하기'}
        </button>
        <span className="panel-meta">
          {loading
            ? sheetFiles.length
              ? '유튜브 + 악보 OCR 분석 중…'
              : '유튜브 분석 + 웹 악보 검색 중… (1~2분)'
            : videoId
              ? `video: ${videoId}`
              : '영상 필요'}
        </span>
      </div>

      {serverOk === false && (
        <p className="error-banner">
          분석 서버가 꺼져 있습니다. 터미널에서 <code>npm run analyze</code> 를 실행하세요.
        </p>
      )}
      {error && <p className="error-banner">{error}</p>}

      {result && (
        <>
          <div className="analyze-summary">
            <p className="analyze-title">
              {activeSheet?.title ?? result.title ?? result.videoId}
            </p>
            <p className="muted">
              {formatClock(result.durationSec)} · 1위 {result.bestKey.label} (
              {(result.bestKey.confidence * 100).toFixed(0)}%)
              {activeSheet ? ` · ${sheetLabel}` : ''}
            </p>
            {result.webScoreSearch &&
              !result.uploadedSheet &&
              result.webScoreSearch.scoreFound === false && (
                <p className="muted">
                  웹 악보를 찾지 못해 오디오 추정만 사용합니다
                  {result.webScoreSearch.error
                    ? ` (${result.webScoreSearch.error})`
                    : ''}
                  .
                </p>
              )}
            {result.webScoreSearch?.ocrOk === false && (
              <p className="muted">
                웹 악보 이미지는 찾았으나 OCR에 실패해 오디오 추정만 사용합니다.
              </p>
            )}
          </div>

          <div className="key-rank-list">
            <h3>추정 Key (정확도 순)</h3>
            <ol>
              {result.rankings.slice(0, 10).map((row) => {
                const isActive = row.id === selectedId
                const current =
                  row.root === songKey.root && row.mode === songKey.mode
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      className={`key-rank-btn ${isActive ? 'active' : ''}`}
                      onClick={() => selectKey(row)}
                    >
                      <span className="rank-num">#{row.rank}</span>
                      <span className="rank-label">
                        {row.label}
                        {current ? ' · 적용됨' : ''}
                      </span>
                      <span className="rank-bar-wrap" aria-hidden>
                        <span
                          className="rank-bar"
                          style={{ width: `${Math.round(row.relative * 100)}%` }}
                        />
                      </span>
                      <span className="rank-pct">
                        {(row.confidence * 100).toFixed(0)}%
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </div>

          {(selected || sheetMode) && (
            <div className="progression-block">
              <div className="history-head">
                <h3>
                  {sheetMode
                    ? `${activeSheet!.title} · 악보형 코드`
                    : `${selected!.label} 코드 진행`}
                </h3>
                <span className="muted">
                  {leadLines.length}줄
                  {sheetMode ? ` · ${sheetLabel}` : ' · 4마디'}
                </span>
              </div>

              {activeSheet && (
                <div className="sheet-toggle-row">
                  <label className="bar-check">
                    <input
                      type="checkbox"
                      checked={useSheet}
                      onChange={(e) => setUseSheet(e.target.checked)}
                    />
                    악보 기준으로 표시 ({activeSheet.key.root}{' '}
                    {activeSheet.key.mode === 'major' ? 'Major' : 'minor'}
                    {uploadedSheet?.labelHint
                      ? ` · 라벨 ${uploadedSheet.labelHint}`
                      : uploadedSheet?.keySource
                        ? ` · ${uploadedSheet.keySource}`
                        : ''}
                    )
                  </label>
                  {sheetTiming && useSheet && (
                    <span className="muted">{sheetMetaLabel(activeSheet, sheetTiming)}</span>
                  )}
                  {uploadedSheet?.rawLines && (
                    <details className="ocr-raw">
                      <summary>OCR로 읽은 코드 줄</summary>
                      <ul>
                        {uploadedSheet.rawLines.map((line, i) => (
                          <li key={i}>{line.join('  ·  ')}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}

              {!sheetMode && selected && (
                <>
                  <div className="top-chord-row">
                    {selected.topChords.map((c) => (
                      <span key={c.symbol} className="chip">
                        {c.symbol} {(c.ratio * 100).toFixed(0)}%
                      </span>
                    ))}
                  </div>
                  <div className="bar-controls">
                    <label className="bar-check">
                      <input
                        type="checkbox"
                        checked={autoBar}
                        onChange={(e) => setAutoBar(e.target.checked)}
                      />
                      마디 길이 자동
                    </label>
                    <label className="field inline">
                      <span>1마디</span>
                      <input
                        type="range"
                        min={1.4}
                        max={3.6}
                        step={0.1}
                        value={effectiveBarSec}
                        disabled={autoBar}
                        onChange={(e) => {
                          setAutoBar(false)
                          setBarSec(Number(e.target.value))
                        }}
                      />
                      <span className="muted">
                        {effectiveBarSec.toFixed(1)}s ≈ {bpmApprox} BPM
                      </span>
                    </label>
                  </div>
                </>
              )}

              {sheetMode && sheetTiming && (
                <div className="bar-controls">
                  <label className="field inline">
                    <span>시작(오프셋)</span>
                    <input
                      type="range"
                      min={0}
                      max={30}
                      step={0.25}
                      value={sheetTiming.offsetSec}
                      onChange={(e) =>
                        setSheetTiming({
                          ...sheetTiming,
                          offsetSec: Number(e.target.value),
                        })
                      }
                    />
                    <span className="muted">{sheetTiming.offsetSec.toFixed(2)}s</span>
                  </label>
                  <label className="field inline">
                    <span>BPM</span>
                    <input
                      type="range"
                      min={60}
                      max={90}
                      step={1}
                      value={sheetTiming.bpm}
                      onChange={(e) => {
                        const bpm = Number(e.target.value)
                        const barSec4 = (4 * 60) / bpm
                        const formSec = formDurationSec(activeSheet!, bpm)
                        setSheetTiming({
                          ...sheetTiming,
                          bpm,
                          barSec4: Number(barSec4.toFixed(3)),
                          formSec: Number(formSec.toFixed(2)),
                        })
                      }}
                    />
                    <span className="muted">
                      {sheetTiming.bpm} · 4/4 {sheetTiming.barSec4.toFixed(2)}s
                    </span>
                  </label>
                </div>
              )}

              <div className={`now-playhead ${playing ? 'playing' : ''}`}>
                <span className="now-label">{playing ? 'Playing' : 'Now'}</span>
                <span className="now-chord">{nowSymbol ?? '—'}</span>
                <span className="muted">
                  {formatClock(currentTime)}
                  {active
                    ? ` · ${active.barIndex + 1}/${Math.max(active.barIndex + 1, leadLines[active.lineIndex]?.bars.length ?? 4)}`
                    : ''}
                </span>
              </div>

              <div className={`lead-sheet ${sheetMode ? 'sheet-score' : ''}`} role="list">
                {leadLines.map((line) => {
                  const lineActive = active?.lineIndex === line.lineIndex
                  const cols = Math.max(line.bars.length, 1)
                  return (
                    <div
                      key={line.lineIndex}
                      ref={lineActive ? activeLineRef : undefined}
                      className={`lead-line ${lineActive ? 'active' : ''}`}
                      role="listitem"
                    >
                      <span className="lead-time">{lineTimeLabel(line)}</span>
                      <div
                        className="lead-bars"
                        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                      >
                        {line.bars.map((bar, bi) => {
                          const isActive =
                            active?.lineIndex === line.lineIndex &&
                            active.barIndex === bi
                          const live = isActive
                            ? chordInBar(bar.chords, active?.progress ?? 0)
                            : null
                          return (
                            <button
                              key={`${line.lineIndex}-${bi}-${bar.start}`}
                              type="button"
                              className={`lead-bar ${bar.index < 0 ? 'empty' : ''} ${isActive ? 'active' : ''} ${bar.label === '(intro)' ? 'intro' : ''}`}
                              disabled={bar.index < 0 || !bar.label}
                              onClick={() => onSeek(bar.start)}
                              title={
                                bar.index >= 0
                                  ? `${formatClock(bar.start)} 로 이동`
                                  : undefined
                              }
                            >
                              {isActive && (
                                <span
                                  className="lead-progress"
                                  style={{
                                    width: `${Math.round((active?.progress ?? 0) * 100)}%`,
                                  }}
                                  aria-hidden
                                />
                              )}
                              <span className="lead-chords">
                                {bar.chords.length > 1 ? (
                                  bar.chords.map((c) => (
                                    <span
                                      key={`${bar.index}-${c}`}
                                      className={`lead-hit ${live === c ? 'hot' : ''}`}
                                    >
                                      {c}
                                    </span>
                                  ))
                                ) : (
                                  bar.label || ' '
                                )}
                              </span>
                              {bi < line.bars.length - 1 && (
                                <span className="lead-pipe" aria-hidden>
                                  |
                                </span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
