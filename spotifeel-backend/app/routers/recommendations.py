from __future__ import annotations

import random
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models import TrackFeature
from app.schemas import RecommendationsOut, TrackOut
from app.services.recommender import MOOD_PRESETS, context_adjust, LA_TZ
from app.core.config import settings
from app.services.spotify_store import load_session

router = APIRouter(prefix="", tags=["recommendations"])

def _spotify_url(track_id: str) -> str:
    return f"https://open.spotify.com/track/{track_id}"


def _time_bucket(hour: int) -> str:
    if 0 <= hour < 3:
        return "00_03"
    if 3 <= hour < 6:
        return "03_06"
    if 6 <= hour < 9:
        return "06_09"
    if 9 <= hour < 12:
        return "09_12"
    if 12 <= hour < 15:
        return "12_15"
    if 15 <= hour < 18:
        return "15_18"
    if 18 <= hour < 21:
        return "18_21"
    return "21_24"


TIME_BUCKET_TO_MOOD = {
    "00_03": "sleep",
    "03_06": "sleep",
    "06_09": "mellow",
    "09_12": "focus",
    "12_15": "groovy",
    "15_18": "excited",
    "18_21": "happy",
    "21_24": "chill",
}


def _target_from_mood(mood: str, adjust_for_time: bool) -> dict:
    preset = dict(MOOD_PRESETS[mood])
    if adjust_for_time:
        preset = context_adjust(preset)

    return {
        "valence": float(preset["target_valence"]),
        "energy": float(preset["target_energy"]),
        "dance": float(preset["target_danceability"]),
        "tempo": float(preset["target_tempo"]),
    }


def _python_score(t: TrackFeature, tgt: dict) -> float:
    d = (
        0.40 * abs((t.valence or 0) - tgt["valence"])
        + 0.35 * abs((t.energy or 0) - tgt["energy"])
        + 0.20 * abs((t.danceability or 0) - tgt["dance"])
        + 0.05 * abs(((t.tempo or 0) / 200.0) - (tgt["tempo"] / 200.0))
    )
    pop = float(t.popularity or 0.0)  
    pop = max(0.0, min(100.0, pop))

    MIN_POP = 12.0  
    if pop < MIN_POP:
        return -1e9 

    score = -d
    score += 0.35 * (pop / 100.0)  

    return score


def _track_out(t: TrackFeature, score: float | None) -> TrackOut:
    name = t.name or t.track_id
    return TrackOut(
        id=t.track_id,
        name=name,
        popularity=t.popularity,
        spotify_uri=f"spotify:track:{t.track_id}",
        spotify_url=_spotify_url(t.track_id),
        audio_features={
            "valence": t.valence,
            "energy": t.energy,
            "danceability": t.danceability,
            "tempo": t.tempo,
            "acousticness": t.acousticness,
            "instrumentalness": t.instrumentalness,
            "liveness": t.liveness,
            "speechiness": t.speechiness,
            "loudness": t.loudness,
        },
        score=score,
    )

async def _target_from_spotify_tracks(
    track_ids: list[str], db: AsyncSession) -> dict | None:
    if not track_ids:
        return None
    rows = (
        await db.execute(
            select(TrackFeature).where(TrackFeature.track_id.in_(track_ids))
        )
    ).scalars().all()
    if not rows:
        return None

    def avg(attr):
        vals = [getattr(r, attr) for r in rows if getattr(r, attr) is not None]
        return sum(vals) / len(vals) if vals else None

    v, e, d, t = avg("valence"), avg("energy"), avg("danceability"), avg("tempo")
    if any(x is None for x in [v, e, d, t]):
        return None
    return {"valence": v, "energy": e, "dance": d, "tempo": t}


@router.get("/recommendations", response_model=RecommendationsOut)
async def recommend(
    mood: str | None = Query(default=None),
    mode: str = Query(default="mood", description="mood|time|random"),
    limit: int = Query(default=12, ge=12, le=12), 
    market: str = Query(default="US"),
    only_ids: list[str] | None = Query(default=None),
    exclude_ids: list[str] | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    
    session = load_session(settings.spotify_session_path)
    spotify_connected = bool(session and session.get("token"))
    recent_ids  = list(session.get("recent_track_ids", []))[:50] if spotify_connected else []
    top_ids     = list(session.get("top_track_ids", []))[:20]    if spotify_connected else []
    liked_ids   = list(session.get("liked_track_ids", []))[:20]  if spotify_connected else []
    effective_exclude = list(set((exclude_ids or []) + recent_ids))

    raw_mood = (mood or "").strip()
    mode_in = (mode or "mood").strip().lower()
    if mode_in not in {"mood", "time", "random"}:
        mode_in = "mood"

    now = datetime.now(LA_TZ)
    hour = now.hour
    bucket = _time_bucket(hour)

    stmt = (
        select(TrackFeature)
        .where(
            TrackFeature.valence.is_not(None),
            TrackFeature.energy.is_not(None),
            TrackFeature.danceability.is_not(None),
            TrackFeature.tempo.is_not(None),
            (TrackFeature.null_response.is_(None)) | (TrackFeature.null_response.is_(False)),
        )
    )

    if only_ids:
        stmt = stmt.where(TrackFeature.track_id.in_(only_ids))
    if exclude_ids:
        stmt = stmt.where(~TrackFeature.track_id.in_(exclude_ids))

    if mode_in == "random":
        candidate_n_pop = 20000
        candidate_n_any = 20000

        out: list[TrackOut] = []
        seen_names: set[str] = set()
        used_ids: set[str] = set()

        def add_track(t: TrackFeature, dedupe_name: bool = True) -> bool:
            if t.track_id in used_ids:
                return False
            name = t.name or t.track_id
            k = (name or "").strip().lower()
            if dedupe_name and k and k in seen_names:
                return False

            used_ids.add(t.track_id)
            if k:
                seen_names.add(k)

            out.append(_track_out(t, score=None))
            return True

        popular_threshold_used: int | None = None
        popular_rows: list[TrackFeature] = []

        for thr in (85, 75, 65, 55, 45):
            q = (
                stmt.where(TrackFeature.popularity.is_not(None), TrackFeature.popularity >= thr)
                .order_by((TrackFeature.popularity * func.random()).desc())
                .limit(candidate_n_pop)
            )
            rows = (await db.execute(q)).scalars().all()
            if rows:
                popular_rows = rows
                popular_threshold_used = thr
                break

        any_rows = (await db.execute(stmt.order_by(func.random()).limit(candidate_n_any))).scalars().all()

        if not popular_rows and not any_rows:
            raise HTTPException(status_code=500, detail="No tracks available for random mix.")

        for t in popular_rows:
            if len(out) >= 10:
                break
            add_track(t, dedupe_name=True)

        if len(out) < 10:
            q2 = (
                stmt.where(TrackFeature.popularity.is_not(None))
                .order_by((TrackFeature.popularity * func.random()).desc())
                .limit(candidate_n_pop)
            )
            rows2 = (await db.execute(q2)).scalars().all()
            for t in rows2:
                if len(out) >= 10:
                    break
                add_track(t, dedupe_name=True)

        for t in any_rows:
            if len(out) >= 12:
                break
            add_track(t, dedupe_name=True)

        if len(out) < 12:
            for t in any_rows:
                if len(out) >= 12:
                    break
                add_track(t, dedupe_name=False)

        return RecommendationsOut(
            mood="random",
            context={
                "mode_used": "random",
                "market": market,
                "popular_threshold_used": popular_threshold_used,
                "popular_bias": "first_10_popularity_biased_random_last_2_any",
                "exclude_ids_applied": bool(exclude_ids),
                "only_ids_applied": bool(only_ids),
            },
            tracks=out,
        )

    if mode_in == "time" or not raw_mood:
        inferred = TIME_BUCKET_TO_MOOD[bucket]
        m = inferred
        
        spotify_tgt = None
        if spotify_connected and (top_ids or liked_ids):
            spotify_tgt = await _target_from_spotify_tracks(top_ids + liked_ids, db)
        
        if spotify_tgt:
            preset_tgt = _target_from_mood(m, adjust_for_time=True)
            tgt = {
                "valence":  0.6 * spotify_tgt["valence"] + 0.4 * preset_tgt["valence"],
                "energy":   0.6 * spotify_tgt["energy"]  + 0.4 * preset_tgt["energy"],
                "dance":    0.6 * spotify_tgt["dance"]   + 0.4 * preset_tgt["dance"],
                "tempo":    0.6 * spotify_tgt["tempo"]   + 0.4 * preset_tgt["tempo"],
            }
            mode_used = "time+spotify"
        else:
            tgt = _target_from_mood(m, adjust_for_time=True)
            mode_used = "time"

    if mode_in == "mood":
        m = raw_mood.strip().lower()
        if m not in MOOD_PRESETS:
            m = "chill"

        spotify_tgt = None
        if spotify_connected and (top_ids or liked_ids):
            spotify_tgt = await _target_from_spotify_tracks(top_ids + liked_ids, db)            
        
        if spotify_tgt:
            tgt = {
                "valence": 0.5 * spotify_tgt["valence"] + 0.5 * tgt["valence"],
                "energy":  0.5 * spotify_tgt["energy"]  + 0.5 * tgt["energy"],
                "dance":   0.5 * spotify_tgt["dance"]   + 0.5 * tgt["dance"],
                "tempo":   0.5 * spotify_tgt["tempo"]   + 0.5 * tgt["tempo"],
            }
            mode_used = "mood+spotify"
            
        else:
            tgt = _target_from_mood(m, adjust_for_time=False)
            mode_used = "mood"

    dist = (
        0.40 * func.abs(TrackFeature.valence - tgt["valence"])
        + 0.35 * func.abs(TrackFeature.energy - tgt["energy"])
        + 0.20 * func.abs(TrackFeature.danceability - tgt["dance"])
        + 0.05 * func.abs((TrackFeature.tempo / 200.0) - (tgt["tempo"] / 200.0))
    )

    candidate_n = 20000 if effective_exclude else 7000
    rows = (await db.execute(stmt.order_by(dist.asc()).limit(candidate_n))).scalars().all()

    if not rows:
        raise HTTPException(status_code=500, detail="No track features available. Did you load the dataset?")

    ranked = sorted(rows, key=lambda t: _python_score(t, tgt), reverse=True)

    out: list[TrackOut] = []
    seen_names: set[str] = set()

    def try_add(t: TrackFeature, score: float) -> bool:
        name = t.name or t.track_id
        k = (name or "").strip().lower()
        if k and k in seen_names:
            return False
        if k:
            seen_names.add(k)
        out.append(_track_out(t, score=score))
        return True

    if effective_exclude:
        pool_n = min(2500, len(ranked))
        pool = ranked[:pool_n]
        random.shuffle(pool)

        for t in pool:
            if len(out) >= limit:
                break
            try_add(t, _python_score(t, tgt))

        if len(out) < limit:
            for t in ranked[pool_n:]:
                if len(out) >= limit:
                    break
                try_add(t, _python_score(t, tgt))
    else:
        for t in ranked:
            if len(out) >= limit:
                break
            try_add(t, _python_score(t, tgt))

    context = {
        "mode_used": mode_used,
        "spotify_personalized": spotify_connected and bool(top_ids or liked_ids),
        "recent_tracks_excluded": len(recent_ids),
        "market": market,
        "target": tgt,
        "exclude_ids_applied": bool(exclude_ids),
        "only_ids_applied": bool(only_ids),
    }
    if mode_used == "time":
        context["time_bucket"] = bucket
        context["inferred_mood"] = m

    return RecommendationsOut(
        mood=m,
        context=context,
        tracks=out,
    )
