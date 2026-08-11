"""Offline chord detection test mirroring the app's chroma + template matcher."""

from __future__ import annotations

import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

import imageio_ffmpeg
import numpy as np

NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
NOTE_INDEX = {n: i for i, n in enumerate(NOTE_NAMES)}

QUALITY_TEMPLATES = {
    "maj": ([0, 4, 7], 1.0),
    "min": ([0, 3, 7], 1.0),
    "dim": ([0, 3, 6], 0.9),
    "aug": ([0, 4, 8], 0.85),
    "7": ([0, 4, 7, 10], 0.95),
    "maj7": ([0, 4, 7, 11], 0.9),
    "min7": ([0, 3, 7, 10], 0.95),
}


def symbol_for(root: str, quality: str) -> str:
    return {
        "maj": root,
        "min": f"{root}m",
        "dim": f"{root}dim",
        "aug": f"{root}aug",
        "7": f"{root}7",
        "maj7": f"{root}maj7",
        "min7": f"{root}m7",
    }[quality]


def diatonic(key_root: str, mode: str):
    root = NOTE_INDEX[key_root]
    if mode == "major":
        degrees = [
            (0, "maj"),
            (2, "min"),
            (4, "min"),
            (5, "maj"),
            (7, "maj"),
            (9, "min"),
            (11, "dim"),
            (0, "maj7"),
            (2, "min7"),
            (5, "maj7"),
            (7, "7"),
            (9, "min7"),
        ]
    else:
        degrees = [
            (0, "min"),
            (2, "dim"),
            (3, "maj"),
            (5, "min"),
            (7, "min"),
            (8, "maj"),
            (10, "maj"),
            (0, "min7"),
            (3, "maj7"),
            (5, "min7"),
            (7, "7"),
            (8, "maj7"),
            (10, "7"),
        ]
    return {(NOTE_NAMES[(root + pc) % 12], q) for pc, q in degrees}


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    na = np.linalg.norm(a)
    nb = np.linalg.norm(b)
    if na < 1e-9 or nb < 1e-9:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def template_vec(intervals):
    v = np.zeros(12)
    for iv in intervals:
        v[iv % 12] = 1.0
    v[0] += 0.15
    if 7 in intervals:
        v[7] += 0.08
    return v


def detect_chord(chroma: np.ndarray, key_root: str, mode: str):
    in_key = diatonic(key_root, mode)
    best = None
    for root_pc in range(12):
        root = NOTE_NAMES[root_pc]
        rotated = np.roll(chroma, -root_pc)
        for quality, (intervals, weight) in QUALITY_TEMPLATES.items():
            score = cosine(rotated, template_vec(intervals)) * weight
            keyed = (root, quality) in in_key
            if keyed:
                score *= 1.18
            cand = {
                "symbol": symbol_for(root, quality),
                "root": root,
                "quality": quality,
                "score": score,
                "inKey": keyed,
            }
            if best is None or cand["score"] > best["score"]:
                best = cand
    if best is None or best["score"] < 0.55:
        return None
    return best


def load_mono(path: Path, sr: int = 22050) -> np.ndarray:
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    cmd = [
        ffmpeg,
        "-v",
        "error",
        "-i",
        str(path),
        "-f",
        "f32le",
        "-acodec",
        "pcm_f32le",
        "-ac",
        "1",
        "-ar",
        str(sr),
        "pipe:1",
    ]
    proc = subprocess.run(cmd, capture_output=True, check=True)
    audio = np.frombuffer(proc.stdout, dtype=np.float32)
    return audio, sr


def frame_chroma(frame: np.ndarray, sr: int) -> tuple[np.ndarray, float]:
    # Hann window + rFFT magnitude -> pitch-class energy
    if np.max(np.abs(frame)) < 1e-6:
        return np.zeros(12), 0.0
    windowed = frame * np.hanning(len(frame))
    spec = np.abs(np.fft.rfft(windowed))
    freqs = np.fft.rfftfreq(len(frame), 1.0 / sr)
    chroma = np.zeros(12)
    energy = 0.0
    a4 = 440.0
    for mag, freq in zip(spec, freqs):
        if freq < 65 or freq > 2100:
            continue
        w = float(mag * mag)
        if w < 1e-10:
            continue
        energy += w
        midi = 12 * np.log2(freq / a4) + 69
        pc = int(round(midi)) % 12
        reg = 1 - min(1.0, abs(freq - 350) / 1600) * 0.35
        chroma[pc] += w * (0.65 + reg)
    mx = chroma.max()
    if mx > 0:
        chroma /= mx
    return chroma, float(energy)


def main():
    audio_path = Path(sys.argv[1] if len(sys.argv) > 1 else "tmp/track.m4a")
    key_root = sys.argv[2] if len(sys.argv) > 2 else "A"
    mode = sys.argv[3] if len(sys.argv) > 3 else "major"
    hop_sec = 0.25
    win_sec = 1.5

    print(f"Loading {audio_path} ...")
    y, sr = load_mono(audio_path)
    duration = len(y) / sr
    print(f"Duration: {duration:.1f}s | Key: {key_root} {mode}")

    hop = int(sr * hop_sec)
    win = int(sr * win_sec)
    smooth = None
    alpha = 0.4
    last_symbol = None
    stable = 0
    timeline = []
    samples = []

    for start in range(0, max(1, len(y) - win), hop):
        frame = y[start : start + win]
        chroma, energy = frame_chroma(frame, sr)
        if smooth is None:
            smooth = chroma
        else:
            smooth = smooth * (1 - alpha) + chroma * alpha

        chord = detect_chord(smooth, key_root, mode) if energy > 1e-4 else None
        t = start / sr
        if chord and energy > 1e-4:
            if chord["symbol"] == last_symbol:
                stable += 1
            else:
                last_symbol = chord["symbol"]
                stable = 1
            if stable == 3:
                if not timeline or timeline[-1]["symbol"] != chord["symbol"]:
                    timeline.append(
                        {
                            "t": round(t, 2),
                            "symbol": chord["symbol"],
                            "score": round(chord["score"], 3),
                            "inKey": chord["inKey"],
                        }
                    )
            samples.append(chord["symbol"])
        else:
            stable = 0

    counts = Counter(samples)
    top = counts.most_common(12)
    in_key_share = 0.0
    if samples:
        in_key_set = {symbol_for(r, q) for r, q in diatonic(key_root, mode)}
        in_key_share = sum(1 for s in samples if s in in_key_set) / len(samples)

    result = {
        "title_hint": "OF-1Wjd9R2w",
        "key": f"{key_root} {mode}",
        "duration_sec": round(duration, 1),
        "frames_with_chord": len(samples),
        "in_key_ratio": round(in_key_share, 3),
        "top_chords": [{"symbol": s, "frames": n, "ratio": round(n / max(len(samples), 1), 3)} for s, n in top],
        "timeline_first_40": timeline[:40],
        "timeline_count": len(timeline),
    }

    out = Path("tmp/chord_test_result.json")
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    print(f"\nSaved: {out}")


if __name__ == "__main__":
    main()
