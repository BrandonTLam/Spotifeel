from __future__ import annotations
from typing import Dict, Any, List
from datetime import datetime
from zoneinfo import ZoneInfo

LA_TZ = ZoneInfo("America/Los_Angeles")

MOOD_PRESETS: Dict[str, Dict[str, float]] = {
    "happy":   {"target_valence": 0.85, "target_energy": 0.80, "target_danceability": 0.75, "target_tempo": 125},
    "sad":     {"target_valence": 0.15, "target_energy": 0.30, "target_danceability": 0.35, "target_tempo": 90},
    "calm":    {"target_valence": 0.55, "target_energy": 0.25, "target_danceability": 0.35, "target_tempo": 80},
    "chill":   {"target_valence": 0.60, "target_energy": 0.45, "target_danceability": 0.55, "target_tempo": 105},
    "angry":   {"target_valence": 0.25, "target_energy": 0.90, "target_danceability": 0.55, "target_tempo": 140},
    "focus":   {"target_valence": 0.55, "target_energy": 0.40, "target_danceability": 0.30, "target_tempo": 95},
}

def normalize_mood(mood: str) -> str:
    m = (mood or "").strip().lower()
    if not m:
        return "chill"
    aliases = {"relaxed": "calm", "relax": "calm", "rnb": "chill", "lofi": "focus", "study": "focus", "mad": "angry"}
    m = aliases.get(m, m)
    return m if m in MOOD_PRESETS else "chill"

def context_adjust(preset: Dict[str, float]) -> Dict[str, float]:
    now = datetime.now(LA_TZ)
    hour = now.hour
    p = dict(preset)

    if hour >= 22 or hour < 6:
        p["target_energy"] = max(0.05, p["target_energy"] - 0.10)
        p["target_tempo"] = max(60, p["target_tempo"] - 8)

    if 6 <= hour <= 10 and p["target_energy"] > 0.35:
        p["target_energy"] = min(0.98, p["target_energy"] + 0.05)
        p["target_tempo"] = min(170, p["target_tempo"] + 4)

    return p

def top_genres_from_artists(top_artists: Dict[str, Any], max_genres: int = 5) -> List[str]:
    counts: Dict[str, int] = {}
    for a in top_artists.get("items", []):
        for g in a.get("genres", []):
            counts[g] = counts.get(g, 0) + 1
    ranked = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)
    return [g for g, _ in ranked[:max_genres]]

def score_track(features: Dict[str, Any], target: Dict[str, float], popularity: int | None = None) -> float:
    if not features:
        return -1e9
    try:
        valence = float(features.get("valence", 0.0))
        energy = float(features.get("energy", 0.0))
        dance = float(features.get("danceability", 0.0))
        tempo = float(features.get("tempo", 0.0))
    except Exception:
        return -1e9

    tempo_n = min(1.0, max(0.0, tempo / 200.0))
    target_tempo_n = min(1.0, max(0.0, float(target["target_tempo"]) / 200.0))

    dv = abs(valence - float(target["target_valence"]))
    de = abs(energy - float(target["target_energy"]))
    dd = abs(dance - float(target["target_danceability"]))
    dt = abs(tempo_n - target_tempo_n)

    dist = (0.40 * dv) + (0.35 * de) + (0.15 * dd) + (0.10 * dt)

    pop_bonus = 0.0
    if popularity is not None:
        pop_bonus = 0.05 * (min(100, max(0, popularity)) / 100.0)

    return (1.0 - dist) + pop_bonus
