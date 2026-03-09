import json
import os
from pathlib import Path
from typing import Any


def _resolve_path(path: str) -> Path:
    p = Path(path)
    if p.is_absolute():
        return p
    # .../spotifeel-backend/app/services/spotify_store.py -> parents[2] == spotifeel-backend
    project_root = Path(__file__).resolve().parents[2]
    return (project_root / p).resolve()


def load_session(path: str) -> dict[str, Any] | None:
    resolved = _resolve_path(path)
    if not resolved.exists():
        return None
    with resolved.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_session(path: str, payload: dict[str, Any]) -> None:
    resolved = _resolve_path(path)
    os.makedirs(resolved.parent, exist_ok=True)
    with resolved.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)


def clear_session(path: str) -> None:
    resolved = _resolve_path(path)
    if resolved.exists():
        resolved.unlink()
