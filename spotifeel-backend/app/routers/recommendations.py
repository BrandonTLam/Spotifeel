from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.database import get_db
from app.models import TrackFeature
from app.schemas import RecommendationsOut, TrackOut
from app.services.recommender import normalize_mood  

router = APIRouter(prefix="", tags=["recommendations"])


MOOD_TARGETS = {
    "happy": {"valence": 0.85, "energy": 0.70, "dance": 0.75, "tempo": 117.0},
    "sad": {"valence": 0.15, "energy": 0.35, "dance": 0.40, "tempo": 85.0},
    "calm": {"valence": 0.45, "energy": 0.25, "dance": 0.35, "tempo": 90.0},
    "chill": {"valence": 0.55, "energy": 0.40, "dance": 0.65, "tempo": 100.0},
    "angry": {"valence": 0.20, "energy": 0.90, "dance": 0.55, "tempo": 140.0},
    "focus": {"valence": 0.50, "energy": 0.30, "dance": 0.25, "tempo": 95.0},
}


def _spotify_url(track_id: str) -> str:
    return f"https://open.spotify.com/track/{track_id}"


def _python_score(t: TrackFeature, tgt: dict) -> float:
    d = (
        0.40 * abs((t.valence or 0) - tgt["valence"])
        + 0.35 * abs((t.energy or 0) - tgt["energy"])
        + 0.20 * abs((t.danceability or 0) - tgt["dance"])
        + 0.05 * abs(((t.tempo or 0) / 200.0) - (tgt["tempo"] / 200.0))
    )

    score = -d

    if t.popularity is not None:
        score += 0.15 * (max(0, min(100, t.popularity)) / 100.0)

    return score


@router.get("/recommendations", response_model=RecommendationsOut)
async def recommend(
    mood: str = Query(default="chill"),
    limit: int = Query(default=10, ge=1, le=50),
    market: str = Query(default="US"),
    only_ids: list[str] | None = Query(
        default=None,
        description="Optional allowlist of Spotify track IDs. Repeat query param: only_ids=...&only_ids=...",
    ),
    exclude_ids: list[str] | None = Query(
        default=None,
        description="Optional blocklist of Spotify track IDs. Repeat query param: exclude_ids=...&exclude_ids=...",
    ),
    db: AsyncSession = Depends(get_db),
):
    m = normalize_mood(mood)
    if m not in MOOD_TARGETS:
        m = "chill"
    tgt = MOOD_TARGETS[m]

    dist = (
        0.40 * func.abs(TrackFeature.valence - tgt["valence"])
        + 0.35 * func.abs(TrackFeature.energy - tgt["energy"])
        + 0.20 * func.abs(TrackFeature.danceability - tgt["dance"])
        + 0.05 * func.abs((TrackFeature.tempo / 200.0) - (tgt["tempo"] / 200.0))
    )

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

    candidate_n = min(5000, max(limit * 200, limit))

    rows = (
        await db.execute(
            stmt.order_by(dist.asc()).limit(candidate_n)
        )
    ).scalars().all()

    if not rows:
        raise HTTPException(
            status_code=500,
            detail="No track features available (or filters removed everything). Did you load the dataset into track_features?",
        )

    ranked = sorted(rows, key=lambda t: _python_score(t, tgt), reverse=True)

    out: list[TrackOut] = []
    seen_names: set[str] = set()

    for t in ranked:
        if len(out) >= limit:
            break

        name = t.name or t.track_id

        k = name.strip().lower()
        if k and k in seen_names:
            continue
        if k:
            seen_names.add(k)

        out.append(
            TrackOut(
                id=t.track_id,
                name=name,
                artists=[],  
                album=None,
                preview_url=None,
                external_url=_spotify_url(t.track_id),
                popularity=t.popularity,
                spotify_uri=f"spotify:track:{t.track_id}",
                spotify_url=f"https://open.spotify.com/track/{t.track_id}",
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
                score=_python_score(t, tgt),
            )
        )

    return RecommendationsOut(
        mood=m,
        context={
            "source": "postgres_track_features",
            "target": tgt,
            "market": market,
            "candidates_considered": candidate_n,
            "only_ids_applied": bool(only_ids),
            "exclude_ids_applied": bool(exclude_ids),
        },
        tracks=out,
    )
