from __future__ import annotations
from typing import Dict, Any, List
from datetime import datetime
from zoneinfo import ZoneInfo

LA_TZ = ZoneInfo("America/Los_Angeles")

MOOD_PRESETS: Dict[str, Dict[str, float]] = {
    "excited":   {"target_valence": 0.86, "target_energy": 0.88, "target_danceability": 0.70, "target_tempo": 140},
    "happy":     {"target_valence": 0.80, "target_energy": 0.65, "target_danceability": 0.65, "target_tempo": 118},
    "sad":       {"target_valence": 0.15, "target_energy": 0.28, "target_danceability": 0.30, "target_tempo": 85},
    "chill":     {"target_valence": 0.55, "target_energy": 0.40, "target_danceability": 0.60, "target_tempo": 102},
    "mellow":    {"target_valence": 0.50, "target_energy": 0.30, "target_danceability": 0.40, "target_tempo": 90},
    "sleep":     {"target_valence": 0.40, "target_energy": 0.12, "target_danceability": 0.12, "target_tempo": 65},
    "romance":   {"target_valence": 0.70, "target_energy": 0.45, "target_danceability": 0.55, "target_tempo": 100},
    "groovy":    {"target_valence": 0.70, "target_energy": 0.60, "target_danceability": 0.82, "target_tempo": 112},
    "party":     {"target_valence": 0.85, "target_energy": 0.85, "target_danceability": 0.88, "target_tempo": 128},
    "hype":      {"target_valence": 0.75, "target_energy": 0.92, "target_danceability": 0.72, "target_tempo": 145},
    "workout":   {"target_valence": 0.60, "target_energy": 0.96, "target_danceability": 0.68, "target_tempo": 155},
    "focus":     {"target_valence": 0.48, "target_energy": 0.35, "target_danceability": 0.22, "target_tempo": 92},
    "anxious":   {"target_valence": 0.30, "target_energy": 0.75, "target_danceability": 0.45, "target_tempo": 150},
    "angry":     {"target_valence": 0.18, "target_energy": 0.95, "target_danceability": 0.55, "target_tempo": 160},
    "confident": {"target_valence": 0.72, "target_energy": 0.58, "target_danceability": 0.55, "target_tempo": 110},
}

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