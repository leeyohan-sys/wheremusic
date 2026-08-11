"""YouTube audio → key ranking + chord progression (local analysis)."""

from __future__ import annotations

import json
import re
import subprocess
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any

import imageio_ffmpeg
import numpy as np

NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
NOTE_INDEX = {n: i for i, n in enumerate(NOTE_NAMES)}
ROOTS = NOTE_NAMES[:]
MODES = ("major", "minor")

QUALITY_TEMPLATES = {
    "maj": ([0, 4, 7], 1.0),
    "min": ([0, 3, 7], 1.0),
    "dim": ([0, 3, 6], 0.9),
    "aug": ([0, 4, 8], 0.85),
    "7": ([0, 4, 7, 10], 0.95),
    "maj7": ([0, 4, 7, 11], 0.9),
    "min7": ([0, 3, 7, 10], 0.95),
}

VIDEO_ID_RE = re.compile(
    r"(?:youtu\.be/|youtube\.com/(?:watch\?v=|embed/|shorts/|live/)|^[a-zA-Z0-9_-]{11}$)([a-zA-Z0-9_-]{11})"
)


def extract_video_id(url_or_id: str) -> str | None:
    text = url_or_id.strip()
    if re.fullmatch(r"[\w-]{11}", text):
        return text
    m = re.search(
        r"(?:youtu\.be/|youtube\.com/(?:watch\?v=|embed/|shorts/|live/))([\w-]{11})",
        text,
    )
    if m:
        return m.group(1)
    try:
        from urllib.parse import parse_qs, urlparse

        q = parse_qs(urlparse(text).query).get("v", [None])[0]
        if q and re.fullmatch(r"[\w-]{11}", q):
            return q
    except Exception:
        pass
    return None


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


def load_mono(path: Path, sr: int = 22050) -> tuple[np.ndarray, int]:
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


def fetch_youtube_title(video_id: str) -> str | None:
    """Prefer oEmbed (UTF-8) over yt-dlp print on Windows consoles."""
    import urllib.request

    url = (
        "https://www.youtube.com/oembed"
        f"?url=https://www.youtube.com/watch?v={video_id}&format=json"
    )
    try:
        with urllib.request.urlopen(url, timeout=12) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        title = (data.get("title") or "").strip()
        return title or None
    except Exception:
        return None


def download_audio(video_id: str, out_dir: Path) -> tuple[Path, dict[str, Any]]:
    out_dir.mkdir(parents=True, exist_ok=True)
    out_tmpl = str(out_dir / f"{video_id}.%(ext)s")
    url = f"https://www.youtube.com/watch?v={video_id}"
    title = fetch_youtube_title(video_id) or video_id
    duration = None
    meta_cmd = [
        "yt-dlp",
        "--skip-download",
        "--print",
        "%(title)s|||%(duration)s",
        url,
    ]
    meta_proc = subprocess.run(
        meta_cmd, capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    if meta_proc.returncode == 0 and meta_proc.stdout.strip():
        parts = meta_proc.stdout.strip().split("|||")
        # oEmbed 우선; 실패했을 때만 yt-dlp 제목 사용
        if title == video_id and parts[0]:
            title = parts[0]
        if len(parts) > 1 and parts[1].isdigit():
            duration = int(parts[1])

    dl_cmd = [
        "yt-dlp",
        "-f",
        "bestaudio[ext=m4a]/bestaudio",
        "--no-playlist",
        "-o",
        out_tmpl,
        url,
    ]
    proc = subprocess.run(dl_cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr[-800:] or "yt-dlp download failed")

    matches = list(out_dir.glob(f"{video_id}.*"))
    if not matches:
        raise RuntimeError("Downloaded audio file not found")
    # prefer non-json
    audio = next((p for p in matches if p.suffix.lower() in {".m4a", ".webm", ".opus", ".mp3", ".wav"}), matches[0])
    return audio, {"title": title, "duration": duration, "videoId": video_id}


def compute_frames(y: np.ndarray, sr: int, hop_sec: float = 0.25, win_sec: float = 1.5):
    hop = int(sr * hop_sec)
    win = int(sr * win_sec)
    frames: list[tuple[float, np.ndarray]] = []
    smooth = None
    alpha = 0.4
    for start in range(0, max(1, len(y) - win), hop):
        chroma, energy = frame_chroma(y[start : start + win], sr)
        if energy <= 1e-4:
            continue
        smooth = chroma if smooth is None else smooth * (1 - alpha) + chroma * alpha
        frames.append((start / sr, smooth.copy()))
    return frames


def progression_for_key(frames, key_root: str, mode: str, stable_needed: int = 3):
    timeline = []
    samples = []
    last_symbol = None
    stable = 0
    for t, chroma in frames:
        chord = detect_chord(chroma, key_root, mode)
        if not chord:
            stable = 0
            continue
        samples.append(chord)
        if chord["symbol"] == last_symbol:
            stable += 1
        else:
            last_symbol = chord["symbol"]
            stable = 1
        if stable == stable_needed:
            if not timeline or timeline[-1]["symbol"] != chord["symbol"]:
                timeline.append(
                    {
                        "t": round(t, 2),
                        "symbol": chord["symbol"],
                        "score": round(chord["score"], 3),
                        "inKey": chord["inKey"],
                    }
                )

    # attach end times
    for i, item in enumerate(timeline):
        if i + 1 < len(timeline):
            item["end"] = timeline[i + 1]["t"]
        else:
            item["end"] = round(frames[-1][0], 2) if frames else item["t"]

    counts = Counter(c["symbol"] for c in samples)
    in_key = sum(1 for c in samples if c["inKey"])
    total = len(samples) or 1
    top = [
        {"symbol": s, "frames": n, "ratio": round(n / total, 3)}
        for s, n in counts.most_common(8)
    ]
    return {
        "root": key_root,
        "mode": mode,
        "label": f"{key_root} {'Major' if mode == 'major' else 'minor'}",
        "inKeyRatio": round(in_key / total, 4),
        "confidence": round(in_key / total, 4),
        "topChords": top,
        "progression": timeline,
        "sampleCount": len(samples),
    }


def analyze_audio_file(audio_path: Path, meta: dict[str, Any] | None = None) -> dict[str, Any]:
    y, sr = load_mono(audio_path)
    duration = len(y) / sr
    frames = compute_frames(y, sr)
    if not frames:
        raise RuntimeError("오디오에서 분석 가능한 구간을 찾지 못했습니다.")

    rankings = []
    details: dict[str, Any] = {}
    for root in ROOTS:
        for mode in MODES:
            result = progression_for_key(frames, root, mode)
            key_id = f"{root}:{mode}"
            rankings.append(
                {
                    "id": key_id,
                    "root": root,
                    "mode": mode,
                    "label": result["label"],
                    "confidence": result["confidence"],
                    "inKeyRatio": result["inKeyRatio"],
                    "topChords": result["topChords"][:5],
                }
            )
            details[key_id] = result

    rankings.sort(key=lambda x: x["confidence"], reverse=True)
    # normalize relative score vs best
    best = rankings[0]["confidence"] or 1.0
    for i, row in enumerate(rankings):
        row["rank"] = i + 1
        row["relative"] = round(row["confidence"] / best, 4)

    return {
        "title": (meta or {}).get("title"),
        "videoId": (meta or {}).get("videoId"),
        "durationSec": round(duration, 1),
        "frameCount": len(frames),
        "rankings": rankings,
        "keys": details,
        "bestKey": rankings[0],
    }


def analyze_youtube(url_or_id: str, cache_dir: Path | None = None) -> dict[str, Any]:
    video_id = extract_video_id(url_or_id)
    if not video_id:
        raise ValueError("올바른 YouTube URL 또는 video ID가 아닙니다.")

    base = cache_dir or Path(tempfile.gettempdir()) / "wheremusic_analyze"
    base.mkdir(parents=True, exist_ok=True)

    cached = list(base.glob(f"{video_id}.*"))
    audio = next(
        (p for p in cached if p.suffix.lower() in {".m4a", ".webm", ".opus", ".mp3", ".wav"}),
        None,
    )
    meta: dict[str, Any] = {"videoId": video_id, "title": video_id, "duration": None}
    if audio is None:
        audio, meta = download_audio(video_id, base)
    else:
        title = fetch_youtube_title(video_id)
        if title:
            meta["title"] = title
        meta_cmd = [
            "yt-dlp",
            "--skip-download",
            "--print",
            "%(title)s|||%(duration)s",
            f"https://www.youtube.com/watch?v={video_id}",
        ]
        meta_proc = subprocess.run(
            meta_cmd, capture_output=True, text=True, encoding="utf-8", errors="replace"
        )
        if meta_proc.returncode == 0 and meta_proc.stdout.strip():
            parts = meta_proc.stdout.strip().split("|||")
            if meta["title"] == video_id and parts[0]:
                meta["title"] = parts[0]
            if len(parts) > 1 and parts[1].isdigit():
                meta["duration"] = int(parts[1])

    return analyze_audio_file(audio, meta)
