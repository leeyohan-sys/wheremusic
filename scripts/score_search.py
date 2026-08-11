"""Search web score images via playlist findScoreImageBuffer (Node)."""

from __future__ import annotations

import base64
import json
import subprocess
from pathlib import Path
from typing import Any

SCRIPTS_DIR = Path(__file__).resolve().parent
FETCH_JS = SCRIPTS_DIR / "fetch_score_image.cjs"
DEFAULT_OUT_DIR = SCRIPTS_DIR.parent / "tmp" / "web_scores"


def fetch_score_image_for_title(
    title: str,
    *,
    out_dir: Path | None = None,
    timeout_sec: int = 150,
) -> dict[str, Any]:
    """
    Returns:
      {
        scoreFound: bool,
        path?: str,
        dataBase64?: str,
        name?: str,
        meta?: dict,
        title?: str,
        error?: str,
      }
    """
    if not title or not title.strip():
        return {"scoreFound": False, "error": "empty title"}
    if not FETCH_JS.exists():
        return {"scoreFound": False, "error": "fetch_score_image.cjs missing"}

    dest_dir = out_dir or DEFAULT_OUT_DIR
    dest_dir.mkdir(parents=True, exist_ok=True)
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in title.strip())[:48]
    out_path = dest_dir / f"{safe or 'score'}.jpg"

    cmd = [
        "node",
        str(FETCH_JS),
        "--title",
        title.strip(),
        "--out",
        str(out_path),
    ]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout_sec,
            cwd=str(SCRIPTS_DIR.parent),
        )
    except subprocess.TimeoutExpired:
        return {"scoreFound": False, "error": "score search timed out"}
    except FileNotFoundError:
        return {"scoreFound": False, "error": "node not found"}

    raw = (proc.stdout or "").strip().splitlines()
    payload_line = raw[-1] if raw else ""
    try:
        data = json.loads(payload_line) if payload_line else {}
    except json.JSONDecodeError:
        return {
            "scoreFound": False,
            "error": f"invalid node output: {(proc.stdout or proc.stderr or '')[:300]}",
        }

    if not data.get("scoreFound"):
        return {
            "scoreFound": False,
            "title": data.get("title"),
            "error": data.get("error") or "no score image found",
            "searchQuery": data.get("searchQuery"),
        }

    path = Path(data.get("outPath") or out_path)
    if not path.exists():
        return {"scoreFound": False, "error": "score file missing after search"}

    blob = path.read_bytes()
    b64 = base64.b64encode(blob).decode("ascii")
    mime = "image/jpeg"
    if path.suffix.lower() == ".png":
        mime = "image/png"
    return {
        "scoreFound": True,
        "path": str(path),
        "name": path.name,
        "dataBase64": f"data:{mime};base64,{b64}",
        "title": data.get("title") or title,
        "meta": data.get("meta"),
        "searchQuery": data.get("searchQuery"),
    }
