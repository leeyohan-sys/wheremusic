"""Extract chord lead-sheet structure from score images via OCR."""

from __future__ import annotations

import base64
import io
import re
from typing import Any

from PIL import Image

CHORD_TOKEN = re.compile(
    r"^([A-G])([#b♯♭])?(maj|min|dim|aug|sus|add|m|M)?"
    r"(\d+)?([#b♯♭])?(?:/([A-G])([#b♯♭])?)?$"
)

# OCR misreads common on lead sheets
OCR_FIXES = {
    "DIF#": "D/F#",
    "DIF": "D/F#",
    "CID": "C/D",
    "GID": "G/D",
    "BID": "B/D",
    "AID": "A/D",
    "EIF#": "E/F#",
    "BIEB": "B/Eb",
    "B/E♭": "B/Eb",
    "B/EB": "B/Eb",
    "AM7": "Am7",
    "BM/D": "Bm/D",
    "EM": "Em",
    "BM": "Bm",
    "CM6": "Cm6",
    "DM": "Dm",
    "FM": "Fm",
}


def _normalize_symbol(raw: str) -> str | None:
    text = raw.strip().replace(" ", "")
    text = text.replace("♯", "#").replace("♭", "b")
    text = text.replace("／", "/").replace("|", "/")
    # OCR often reads '/' as 'I' between pitch letters
    text = re.sub(r"([A-G][#b]?)I([A-G])", r"\1/\2", text)
    upper = text.upper()
    if upper in OCR_FIXES:
        text = OCR_FIXES[upper]
    elif text in OCR_FIXES:
        text = OCR_FIXES[text]

    # split accidental stuck to quality: Bb m -> handled by regex
    if not CHORD_TOKEN.match(text) and not CHORD_TOKEN.match(
        text[0] + text[1:].replace("MAJ", "maj")
    ):
        # try common lowercasing of qualities
        m = re.match(
            r"^([A-G][#b]?)(MAJ|MIN|DIM|AUG|SUS|ADD|M)?(\d+)?(?:/([A-G][#b]?))?$",
            text,
            re.I,
        )
        if not m:
            return None
        root, qual, num, bass = m.groups()
        qual_map = {
            "MAJ": "maj",
            "MIN": "m",
            "M": "m",
            "DIM": "dim",
            "AUG": "aug",
            "SUS": "sus",
            "ADD": "add",
            None: "",
        }
        q = qual_map.get(qual.upper() if qual else None, (qual or "").lower())
        if q == "m" and qual and qual.upper() == "MAJ":
            q = "maj"
        text = root[0].upper() + root[1:] + q + (num or "") + (f"/{bass}" if bass else "")

    # Final normalize root case
    text = re.sub(r"^([a-g])", lambda m: m.group(1).upper(), text)
    if not CHORD_TOKEN.match(text):
        # accept Em7 style after soft normalize
        soft = re.sub(r"^([A-G][#b]?)(MIN)", r"\1m", text, flags=re.I)
        soft = re.sub(r"^([A-G][#b]?)M(?!\d|aj)", r"\1m", soft)
        if CHORD_TOKEN.match(soft):
            text = soft
        else:
            return None
    return text


def _looks_like_chord_ocr(text: str) -> bool:
    """Reject title/lyric/credit lines that OCR confuses with chords."""
    t = text.strip()
    if not t or len(t) > 28:
        return False
    if re.search(r"[\uac00-\ud7a3]", t):  # Hangul
        return False
    if re.search(r"[_&@]|https?://", t):
        return False
    if re.search(
        r"(?i)\b(the|lord|words|music|by|arrange|arranged|love|capo|key|intro|verse|chorus)\b",
        t,
    ):
        return False
    # must start with pitch letter (optional accidental)
    if not re.match(r"^[A-Ga-g][#b♯♭]?", t):
        return False
    # long lowercase English words are not chord symbols
    if re.search(r"[a-z]{5,}", t) and not re.search(
        r"(?i)(maj|min|dim|aug|sus|add)", t
    ):
        return False
    return True


def _split_chord_blob(text: str) -> list[str]:
    """Split 'Am7 D7' or 'Am7D7' into separate chords when possible."""
    text = text.strip()
    if not text:
        return []
    # 제목·가사·크레딧에서 A~G 글자가 코드로 추출되지 않게
    if not _looks_like_chord_ocr(text):
        return []

    if " " in text:
        parts = text.split()
        out = []
        for p in parts:
            n = _normalize_symbol(p)
            if n:
                out.append(n)
        if out:
            return out

    fixed = _normalize_symbol(text)
    if fixed:
        return [fixed]

    # try splitting concatenated chords: Am7D7, G/BD7
    # only when the whole string is chord alphabet (no prose)
    if not re.fullmatch(r"[A-Ga-g0-9#♯b♭/majMindimAugsusadd\s]+", text):
        return []
    parts = re.findall(
        r"[A-G][#b♯♭]?(?:maj|min|dim|aug|sus\d*|add\d*|m|M)?\d*(?:/[A-G][#b♯♭]?)?",
        text,
        flags=re.I,
    )
    out = []
    for p in parts:
        n = _normalize_symbol(p)
        if n:
            out.append(n)
    return out


NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
NOTE_INDEX = {n: i for i, n in enumerate(NOTE_NAMES)}

# Korean CCM corner labels: GA = G Major (arrangement A)
LABEL_KEY_HINTS = {
    "GA": ("G", "major"),
    "GB": ("G", "major"),
    "GC": ("G", "major"),
    "DA": ("D", "major"),
    "DB": ("D", "major"),
    "EA": ("E", "major"),
    "EB": ("E", "major"),
    "AA": ("A", "major"),
    "AB": ("A", "major"),
    "CA": ("C", "major"),
    "CB": ("C", "major"),
    "FA": ("F", "major"),
    "FB": ("F", "major"),
    "BA": ("Bb", "major"),
    "BB": ("Bb", "major"),
    "EMA": ("E", "minor"),
    "EMB": ("E", "minor"),
    "AMA": ("A", "minor"),
    "AMB": ("A", "minor"),
}

# sharp count → major key (treble)
SHARP_MAJOR = {
    0: "C",
    1: "G",
    2: "D",
    3: "A",
    4: "E",
    5: "B",
    6: "F#",
    7: "C#",
}


def _diatonic_roots(root: str, mode: str) -> set[str]:
    pc = NOTE_INDEX[root]
    intervals = [0, 2, 4, 5, 7, 9, 11] if mode == "major" else [0, 2, 3, 5, 7, 8, 10]
    return {NOTE_NAMES[(pc + i) % 12] for i in intervals}


def _chord_root(symbol: str) -> str | None:
    m = re.match(r"^([A-G][#b]?)", symbol)
    return m.group(1) if m else None


def _detect_key_signature(image: Image.Image) -> tuple[str, str] | None:
    """
    Count sharp columns in the clef/key-signature band (left of staves).
    One sharp column ≈ G major; two ≈ D major, etc.
    """
    try:
        from scipy import ndimage
    except ImportError:
        return None

    import numpy as np

    gray = np.asarray(image.convert("L"))
    h, w = gray.shape
    if w < 200 or h < 200:
        return None

    x0, x1 = int(w * 0.04), int(w * 0.12)
    band = gray[:, x0:x1]
    ink = (band < 145).astype(np.uint8)
    labeled, n = ndimage.label(ink)
    if n <= 0:
        return None

    cands: list[tuple[float, float, int, int, int]] = []
    for i in range(1, n + 1):
        ys, xs = np.where(labeled == i)
        area = int(ys.size)
        hh = int(ys.max() - ys.min() + 1)
        ww = int(xs.max() - xs.min() + 1)
        # sharp-like tall thin marks (not staff lines / bar numbers)
        if not (11 <= hh <= 32 and 4 <= ww <= 16 and 30 <= area <= 220):
            continue
        if hh / max(ww, 1) < 1.15:
            continue
        cands.append((float(ys.mean()), float(xs.mean()) + x0, hh, ww, area))

    if len(cands) < 3:
        return None

    cands.sort(key=lambda c: c[1])
    cols: list[list[tuple[float, float, int, int, int]]] = []
    for c in cands:
        if not cols or abs(c[1] - cols[-1][0][1]) > max(8.0, w * 0.008):
            cols.append([c])
        else:
            cols[-1].append(c)

    # keep columns that repeat across multiple staves
    sharp_cols = [col for col in cols if len(col) >= 3]
    sharp_n = len(sharp_cols)
    if sharp_n <= 0:
        return None
    root = SHARP_MAJOR.get(sharp_n)
    if not root:
        return None
    return (root, "major")


def _ocr_tokens(
    image: Image.Image,
) -> tuple[list[dict[str, Any]], tuple[str, str] | None, tuple[str, str] | None]:
    from rapidocr_onnxruntime import RapidOCR

    # 조표는 리사이즈 전 원본에서 감지 (스케일 후 가짜 # 열 생김 방지)
    key_sig = _detect_key_signature(image)

    ocr = RapidOCR()
    w, h = image.size
    if w < 1400:
        scale = 1400 / w
        image = image.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)

    import numpy as np

    arr = np.array(image.convert("RGB"))
    result, _ = ocr(arr)
    tokens: list[dict[str, Any]] = []
    label_hint: tuple[str, str] | None = None

    for row in result or []:
        box, text, score = row
        try:
            conf = float(score)
        except Exception:
            conf = 0.5
        if conf < 0.35:
            continue
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        cx = sum(xs) / 4
        cy = sum(ys) / 4
        raw = text.strip().upper().replace(" ", "")

        if raw in LABEL_KEY_HINTS:
            label_hint = LABEL_KEY_HINTS[raw]
            continue
        if re.fullmatch(r"\d{1,3}", text.strip()):
            continue
        if raw in {"CAPO", "KEY", "INTRO"}:
            continue
        if not _looks_like_chord_ocr(text):
            continue

        for sym in _split_chord_blob(text):
            tokens.append({"symbol": sym, "x": cx, "y": cy, "score": conf})
    return tokens, label_hint, key_sig


def _cluster_lines(tokens: list[dict[str, Any]], y_thresh: float = 70.0) -> list[list[dict[str, Any]]]:
    if not tokens:
        return []
    ordered = sorted(tokens, key=lambda t: t["y"])
    lines: list[list[dict[str, Any]]] = [[ordered[0]]]
    for tok in ordered[1:]:
        prev_y = sum(t["y"] for t in lines[-1]) / len(lines[-1])
        if abs(tok["y"] - prev_y) <= y_thresh:
            lines[-1].append(tok)
        else:
            lines.append([tok])
    for line in lines:
        line.sort(key=lambda t: t["x"])
    return lines


def _split_line_into_bars(line: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    """Lead-sheet heuristic: each spaced chord is usually one bar; only merge nearby hits."""
    if not line:
        return []
    if len(line) == 1:
        return [line]

    gaps = [line[i + 1]["x"] - line[i]["x"] for i in range(len(line) - 1)]
    med = sorted(gaps)[len(gaps) // 2] if gaps else 120
    same_bar = min(max(med * 0.45, 48.0), 110.0)

    bars: list[list[dict[str, Any]]] = [[line[0]]]
    for i in range(1, len(line)):
        gap = line[i]["x"] - line[i - 1]["x"]
        if gap <= same_bar:
            bars[-1].append(line[i])
        else:
            bars.append([line[i]])
    return bars


def _bar_def_from_tokens(toks: list[dict[str, Any]]) -> dict[str, Any]:
    chords = []
    n = max(len(toks), 1)
    for i, tok in enumerate(toks):
        if n == 1:
            beat = 0
        elif n == 2:
            beat = 0 if i == 0 else 2
        elif n == 3:
            beat = [0, 2, 3][i]
        else:
            beat = min(3, int(round(i * 3 / (n - 1))))
        chords.append({"beat": beat, "symbol": tok["symbol"]})
    beats = 4
    if n == 2 and {t["symbol"] for t in toks} <= {"Am7", "D7"}:
        span = toks[-1]["x"] - toks[0]["x"]
        if span < 160:
            beats = 2
            chords = [
                {"beat": 0, "symbol": toks[0]["symbol"]},
                {"beat": 1, "symbol": toks[1]["symbol"]},
            ]
    return {"beats": beats, "chords": chords}


def guess_key_from_form(
    form: list[dict[str, Any]],
    label_hint: tuple[str, str] | None = None,
    key_sig: tuple[str, str] | None = None,
) -> dict[str, str]:
    """Prefer printed GA label / key signature, then diatonic fit."""
    if label_hint:
        return {"root": label_hint[0], "mode": label_hint[1], "via": "label"}
    if key_sig:
        return {"root": key_sig[0], "mode": key_sig[1], "via": "key-signature"}

    symbols: list[str] = []
    for bar in form:
        for hit in bar["chords"]:
            symbols.append(hit["symbol"])
    if not symbols:
        return {"root": "C", "mode": "major", "via": "default"}

    first_root = _chord_root(symbols[0])
    last_sym = symbols[-1]
    last_root = _chord_root(last_sym)
    # C/D 같은 슬래시(버도미넌트 준비)로 끝나면 C 토닉으로 오인하기 쉬움
    last_is_slash = "/" in last_sym
    bag = set(symbols)
    has_fs_bass = any("/F#" in s or "/F♯" in s for s in symbols)

    best: tuple[float, str, str] | None = None
    for root in NOTE_NAMES:
        for mode in ("major", "minor"):
            dia = _diatonic_roots(root, mode)
            score = 0.0
            for i, sym in enumerate(symbols):
                cr = _chord_root(sym)
                if not cr:
                    continue
                w = 2.5 if i in (0, len(symbols) - 1) else 1.0
                if cr in dia:
                    score += w
                else:
                    score -= 0.4 * w
                if mode == "major" and (sym == root or sym.startswith(root + "/")):
                    score += 1.4 * w
                if mode == "minor" and re.match(rf"^{re.escape(root)}m", sym):
                    score += 1.4 * w
            # D/F#로 시작하는 경우 V/I 가능성 — D first 보너스 약화
            if first_root == root:
                if root == "D" and symbols[0].startswith("D/F"):
                    score += 0.4
                else:
                    score += 2.0
            if last_root == root:
                score += 0.8 if last_is_slash else 2.5
            if mode == "major" and root == "G":
                if {"Em", "Em7", "Am7", "Am"} & bag and (
                    any(s.startswith("G") for s in bag) or has_fs_bass
                ):
                    score += 5.0
                if has_fs_bass and ({"Em7", "Em"} & bag):
                    score += 3.0
            if mode == "major" and root == "C":
                # C/D가 많아도 G의 V 준비일 수 있음 — C 과대평가 억제
                if has_fs_bass and ({"Em7", "Em", "Am7"} & bag):
                    score -= 4.0
                slash_c = sum(1 for s in symbols if s.startswith("C/"))
                if slash_c >= 3 and any(s.startswith("G") for s in bag):
                    score -= 2.0
            if mode == "major" and root == "D":
                # D often looks frequent because of D7/D/F# as V of G — dampen alone
                if {"Em", "Em7", "Am7"} & bag and (
                    any(s.startswith("G") for s in bag) or has_fs_bass
                ):
                    score -= 3.0
            cand = (score, root, mode)
            if best is None or cand[0] > best[0]:
                best = cand

    assert best is not None
    return {"root": best[1], "mode": best[2], "via": "diatonic"}


def extract_sheet_from_image_bytes(data: bytes, name: str = "sheet.png") -> dict[str, Any]:
    image = Image.open(io.BytesIO(data)).convert("RGB")
    tokens, label_hint, key_sig = _ocr_tokens(image)
    lines = _cluster_lines(tokens)
    form: list[dict[str, Any]] = []
    line_sizes: list[int] = []
    raw_lines: list[list[str]] = []

    for line in lines:
        bars = _split_line_into_bars(line)
        if not bars:
            continue
        line_sizes.append(len(bars))
        raw_lines.append([t["symbol"] for t in line])
        for bar_toks in bars:
            form.append(_bar_def_from_tokens(bar_toks))

    if not form:
        raise RuntimeError("악보에서 코드를 찾지 못했습니다. 더 선명한 이미지를 올려 주세요.")

    key = guess_key_from_form(form, label_hint=label_hint, key_sig=key_sig)
    sheet = {
        "id": f"upload-{abs(hash(name)) % 10_000_000}",
        "title": name.rsplit(".", 1)[0],
        "videoIds": [],
        "key": {"root": key["root"], "mode": key["mode"]},
        "keySource": key.get("via", "unknown"),
        "labelHint": f"{label_hint[0]} {label_hint[1]}" if label_hint else None,
        "lineSizes": line_sizes or [4],
        "form": form,
        "source": "ocr",
        "rawLines": raw_lines,
        "tokenCount": len(tokens),
    }
    return sheet


def extract_sheets_from_base64_list(items: list[dict[str, str]]) -> dict[str, Any]:
    """Merge multiple page images into one form (pages concatenated)."""
    merged_form: list[dict[str, Any]] = []
    merged_sizes: list[int] = []
    raw_lines: list[list[str]] = []
    titles: list[str] = []
    tokens = 0
    label_hint_str: str | None = None
    label_tuple: tuple[str, str] | None = None
    key_sig: tuple[str, str] | None = None

    for item in items:
        name = item.get("name") or "sheet.png"
        b64 = item.get("dataBase64") or ""
        if "," in b64:
            b64 = b64.split(",", 1)[1]
        data = base64.b64decode(b64)
        page = extract_sheet_from_image_bytes(data, name=name)
        merged_form.extend(page["form"])
        merged_sizes.extend(page["lineSizes"])
        raw_lines.extend(page.get("rawLines") or [])
        titles.append(page["title"])
        tokens += int(page.get("tokenCount") or 0)
        if page.get("labelHint") and not label_hint_str:
            label_hint_str = page["labelHint"]
            parts = label_hint_str.split()
            if len(parts) == 2:
                label_tuple = (parts[0], parts[1])
        if page.get("keySource") == "key-signature" and not key_sig:
            key_sig = (page["key"]["root"], page["key"]["mode"])

    key = guess_key_from_form(merged_form, label_hint=label_tuple, key_sig=key_sig)
    return {
        "id": f"upload-{abs(hash(tuple(titles))) % 10_000_000}",
        "title": titles[0] if len(titles) == 1 else "+".join(titles[:2]),
        "videoIds": [],
        "key": {"root": key["root"], "mode": key["mode"]},
        "keySource": key.get("via", "unknown"),
        "labelHint": label_hint_str,
        "lineSizes": merged_sizes or [4],
        "form": merged_form,
        "source": "ocr",
        "rawLines": raw_lines,
        "tokenCount": tokens,
        "pageCount": len(items),
    }
