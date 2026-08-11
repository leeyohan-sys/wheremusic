/**
 * Convert AnalyserNode frequency data into a 12-bin chroma vector (C=0).
 */

const A4 = 440
const A4_MIDI = 69

function freqToMidi(freq: number): number {
  return 12 * Math.log2(freq / A4) + A4_MIDI
}

export function spectrumToChroma(
  frequencyData: Uint8Array,
  sampleRate: number,
  fftSize: number,
): { chroma: number[]; energy: number } {
  const chroma = new Array(12).fill(0)
  let energy = 0
  const binHz = sampleRate / fftSize

  // Focus on musical range roughly C2–C7
  const minFreq = 65
  const maxFreq = 2100

  for (let i = 1; i < frequencyData.length; i++) {
    const freq = i * binHz
    if (freq < minFreq || freq > maxFreq) continue
    const mag = frequencyData[i] / 255
    if (mag < 0.02) continue
    const weighted = mag * mag
    energy += weighted

    const midi = freqToMidi(freq)
    const pc = ((Math.round(midi) % 12) + 12) % 12
    // mild emphasis on mid register
    const reg = 1 - Math.min(1, Math.abs(freq - 350) / 1600) * 0.35
    chroma[pc] += weighted * (0.65 + reg)
  }

  // normalize
  const max = Math.max(...chroma, 1e-9)
  for (let i = 0; i < 12; i++) chroma[i] /= max

  return { chroma, energy }
}

/** Temporal smoothing to reduce flicker */
export function smoothChroma(
  previous: number[] | null,
  next: number[],
  alpha = 0.35,
): number[] {
  if (!previous) return next.slice()
  return next.map((v, i) => previous[i] * (1 - alpha) + v * alpha)
}
