import { NOTE_NAMES, formatKey, scaleDegrees } from '../lib/chords'
import { useChordListener } from '../hooks/useChordListener'
import type { KeyMode, NoteName, SongKey } from '../types'

interface ChordPanelProps {
  songKey: SongKey
  onKeyChange: (key: SongKey) => void
}

export function ChordPanel({ songKey, onKeyChange }: ChordPanelProps) {
  const {
    listening,
    error,
    current,
    chroma,
    energy,
    history,
    start,
    stop,
    clearHistory,
  } = useChordListener(songKey)

  const scale = scaleDegrees(songKey)

  return (
    <section className="panel chord-panel">
      <header className="panel-header">
        <h2>코드 감지</h2>
        <span className="panel-meta">{formatKey(songKey)}</span>
      </header>

      <div className="key-block">
        <label className="field">
          <span>Key</span>
          <select
            value={songKey.root}
            onChange={(e) =>
              onKeyChange({ ...songKey, root: e.target.value as NoteName })
            }
          >
            {NOTE_NAMES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <div className="mode-toggle" role="group" aria-label="Major / minor">
          {(['major', 'minor'] as KeyMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`btn ${songKey.mode === mode ? 'primary' : ''}`}
              onClick={() => onKeyChange({ ...songKey, mode })}
            >
              {mode === 'major' ? 'Major' : 'minor'}
            </button>
          ))}
        </div>
      </div>

      <p className="hint">
        왼쪽 YouTube를 재생한 뒤 <strong>듣기 시작</strong>을 누르면, 스피커 소리를
        마이크로 들어 현재 코드를 추정합니다. 헤드셋만 쓰면 감지가 어려우니
        스피커 재생을 권장합니다.
      </p>

      <div className="listen-bar">
        {!listening ? (
          <button type="button" className="btn primary listen-btn" onClick={() => void start()}>
            듣기 시작
          </button>
        ) : (
          <button type="button" className="btn danger-solid listen-btn" onClick={stop}>
            듣기 중지
          </button>
        )}
        <div className={`listen-dot ${listening ? 'on' : ''}`} aria-hidden />
        <span className="panel-meta">
          {listening ? '분석 중' : '대기'} · 에너지 {(energy * 100).toFixed(0)}%
        </span>
      </div>

      {error && <p className="error-banner">{error}</p>}

      <div className="chord-stage">
        <p className="chord-label">Now</p>
        <p className={`chord-big ${current ? 'has' : ''}`}>
          {current ? current.symbol : listening ? '—' : 'Key를 고르고 들으세요'}
        </p>
        <p className="chord-sub">
          {current
            ? `${current.inKey ? '조성 안' : '조성 밖'} · 신뢰도 ${(current.score * 100).toFixed(0)}%`
            : listening
              ? '음을 기다리는 중…'
              : '마이크 권한이 필요합니다'}
        </p>
      </div>

      <div className="chroma-row" aria-hidden>
        {chroma.map((v, i) => (
          <div key={NOTE_NAMES[i]} className="chroma-cell">
            <div className="chroma-bar" style={{ height: `${Math.round(v * 100)}%` }} />
            <span className={scale.includes(NOTE_NAMES[i]) ? 'in-scale' : ''}>
              {NOTE_NAMES[i]}
            </span>
          </div>
        ))}
      </div>

      <div className="scale-chips">
        <span className="chips-label">스케일</span>
        {scale.map((n) => (
          <span key={n} className="chip">
            {n}
          </span>
        ))}
      </div>

      <div className="chord-history">
        <div className="history-head">
          <h3>최근 코드</h3>
          <button type="button" className="btn ghost tiny" onClick={clearHistory}>
            비우기
          </button>
        </div>
        {history.length === 0 ? (
          <p className="muted">감지된 코드가 여기에 쌓입니다.</p>
        ) : (
          <ol>
            {history.map((item) => (
              <li key={item.id}>
                <span className="hist-chord">{item.symbol}</span>
                <span className="muted">
                  {new Date(item.at).toLocaleTimeString('ko-KR', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}
