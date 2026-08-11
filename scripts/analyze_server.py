"""Local analysis API for WhereMusic (YouTube + sheet OCR)."""

from __future__ import annotations

import json
import sys
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))

from analyze_engine import analyze_youtube, extract_video_id
from score_search import fetch_score_image_for_title
from sheet_ocr import extract_sheets_from_base64_list

HOST = "127.0.0.1"
PORT = 18790
CACHE_DIR = Path(__file__).resolve().parent.parent / "tmp" / "analyze_cache"


def _log(msg: str) -> None:
    """Windows cp949 콘솔에서도 죽지 않게 로그."""
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        enc = getattr(sys.stdout, "encoding", None) or "utf-8"
        sys.stdout.buffer.write((msg + "\n").encode(enc, errors="replace"))
        sys.stdout.buffer.flush()


def _clean_title(title: str) -> str:
    # yt-dlp/콘솔 깨짐으로 들어간 대체문자 제거
    return " ".join(title.replace("\ufffd", "").split()).strip()


def _apply_sheet_to_result(result: dict, sheet: dict) -> None:
    result["uploadedSheet"] = sheet
    key_id = f"{sheet['key']['root']}:{sheet['key']['mode']}"
    if key_id in result.get("keys", {}):
        result["suggestedKeyId"] = key_id


def _try_web_score_search(result: dict) -> None:
    """No uploaded sheets → playlist-style web score search + OCR."""
    title = _clean_title((result.get("title") or "").strip())
    if not title:
        _log("[analyze] web score search skipped (no title)")
        return
    _log(f"[analyze] web score search title={title!r}")
    found = fetch_score_image_for_title(title)
    if not found.get("scoreFound"):
        _log(
            f"[analyze] web score not found: {found.get('error') or 'unknown'} "
            f"q={found.get('searchQuery')!r}"
        )
        result["webScoreSearch"] = {
            "scoreFound": False,
            "title": title,
            "error": found.get("error"),
            "searchQuery": found.get("searchQuery"),
        }
        return
    try:
        sheet = extract_sheets_from_base64_list(
            [{"name": found.get("name") or "web-score.jpg", "dataBase64": found["dataBase64"]}]
        )
        sheet["source"] = "web-search"
        sheet["title"] = found.get("title") or sheet.get("title") or title
        sheet["id"] = f"web-{abs(hash(title)) % 10_000_000}"
        _apply_sheet_to_result(result, sheet)
        result["webScoreSearch"] = {
            "scoreFound": True,
            "title": sheet["title"],
            "searchQuery": found.get("searchQuery"),
            "tokenCount": sheet.get("tokenCount"),
            "bars": len(sheet.get("form") or []),
        }
        _log(
            f"[analyze] web score OCR ok bars={len(sheet['form'])} "
            f"key={sheet['key']} tokens={sheet.get('tokenCount')}"
        )
    except Exception as e:
        traceback.print_exc()
        _log(f"[analyze] web score OCR failed: {e}")
        result["webScoreSearch"] = {
            "scoreFound": True,
            "ocrOk": False,
            "title": title,
            "error": str(e),
            "searchQuery": found.get("searchQuery"),
        }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        _log(f"[analyze] {self.address_string()} {fmt % args}")

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self._cors()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path in ("/api/health", "/wm-analyze/health"):
            self._json(200, {"ok": True, "service": "wheremusic-analyze"})
            return
        self._json(404, {"error": "not found"})

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self._json(400, {"error": "JSON 파싱 실패"})
            return

        if path in ("/api/extract-sheet", "/wm-analyze/extract-sheet"):
            sheets = data.get("sheets") or []
            if not sheets:
                self._json(400, {"error": "sheets 이미지가 필요합니다"})
                return
            try:
                _log(f"[extract-sheet] pages={len(sheets)}")
                sheet = extract_sheets_from_base64_list(sheets)
                _log(
                    f"[extract-sheet] done bars={len(sheet['form'])} "
                    f"key={sheet['key']} tokens={sheet.get('tokenCount')}"
                )
                self._json(200, {"sheet": sheet})
            except Exception as e:
                traceback.print_exc()
                self._json(500, {"error": str(e)})
            return

        if path not in ("/api/analyze", "/wm-analyze/analyze"):
            self._json(404, {"error": "not found"})
            return

        url = (data.get("url") or data.get("videoId") or "").strip()
        if not url:
            self._json(400, {"error": "url 또는 videoId가 필요합니다"})
            return
        if not extract_video_id(url):
            self._json(400, {"error": "올바른 YouTube URL 또는 video ID가 아닙니다"})
            return

        try:
            _log(f"[analyze] start {url}")
            result = analyze_youtube(url, cache_dir=CACHE_DIR)

            sheets = data.get("sheets") or []
            if sheets:
                _log(f"[analyze] extracting sheet pages={len(sheets)}")
                sheet = extract_sheets_from_base64_list(sheets)
                _apply_sheet_to_result(result, sheet)
            else:
                # 업로드 없으면 playlist/eguitar와 동일 로직으로 웹 악보 검색
                skip_web = bool(data.get("skipWebScoreSearch"))
                if skip_web:
                    _log("[analyze] web score search skipped by client")
                else:
                    _try_web_score_search(result)

            _log(
                f"[analyze] done best={result['bestKey']['label']} "
                f"({result['bestKey']['confidence']:.1%})"
            )
            self._json(200, result)
        except Exception as e:
            traceback.print_exc()
            self._json(500, {"error": str(e)})


def main() -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    # Windows 콘솔에서 한글/깨진 제목 로그가 안전하게 나가도록
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except Exception:
            pass
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    _log(f"WhereMusic analyze API  http://{HOST}:{PORT}")
    _log('POST /wm-analyze/analyze  {"url":"...","sheets":[{name,dataBase64}]}')
    _log("POST /wm-analyze/extract-sheet  {\"sheets\":[...]}")
    server.serve_forever()


if __name__ == "__main__":
    main()
