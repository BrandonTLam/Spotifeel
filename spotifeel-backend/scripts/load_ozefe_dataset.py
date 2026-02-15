import os
import asyncio
from typing import Any, Dict, List, Tuple
from pathlib import Path

import asyncpg
from datasets import load_dataset
from tqdm import tqdm
from dotenv import load_dotenv


def to_asyncpg_dsn(sqlalchemy_url: str) -> str:
    return sqlalchemy_url.replace("postgresql+asyncpg://", "postgresql://", 1)


def to_int(v: Any) -> int | None:
    if v is None:
        return None
    if isinstance(v, bool):
        return int(v)
    try:
        return int(v)
    except Exception:
        return None


def to_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except Exception:
        return None


def to_bool(v: Any) -> bool | None:
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, int):
        return bool(v)
    if isinstance(v, str):
        s = v.strip().lower()
        if s in {"1", "true", "t", "yes", "y"}:
            return True
        if s in {"0", "false", "f", "no", "n"}:
            return False
    return None


async def main():
    project_root = Path(__file__).resolve().parents[1]
    load_dotenv(project_root / ".env")

    sqlalchemy_url = os.getenv("DATABASE_URL")
    if not sqlalchemy_url:
        raise RuntimeError("DATABASE_URL not found. Put it in spotifeel-backend/.env")

    dsn = to_asyncpg_dsn(sqlalchemy_url)

    max_rows = int(os.getenv("LOAD_MAX_ROWS", "0"))  # 0 = all
    ds = load_dataset("ozefe/spotify_audio_features", split="train", streaming=True)

    conn = await asyncpg.connect(dsn)

    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS track_features (
          track_id TEXT PRIMARY KEY,
          name TEXT NULL,
          popularity INT NULL,
          duration_ms INT NULL,
          time_signature INT NULL,
          tempo DOUBLE PRECISION NULL,
          key INT NULL,
          mode INT NULL,
          danceability DOUBLE PRECISION NULL,
          energy DOUBLE PRECISION NULL,
          loudness DOUBLE PRECISION NULL,
          speechiness DOUBLE PRECISION NULL,
          acousticness DOUBLE PRECISION NULL,
          instrumentalness DOUBLE PRECISION NULL,
          liveness DOUBLE PRECISION NULL,
          valence DOUBLE PRECISION NULL,
          null_response BOOLEAN NULL
        );
        """
    )

    await conn.execute("CREATE INDEX IF NOT EXISTS ix_track_features_valence ON track_features(valence);")
    await conn.execute("CREATE INDEX IF NOT EXISTS ix_track_features_energy ON track_features(energy);")
    await conn.execute("CREATE INDEX IF NOT EXISTS ix_track_features_tempo ON track_features(tempo);")

    BATCH_SIZE = 5000
    batch: List[Tuple] = []
    inserted = 0

    def row_to_tuple(r: Dict[str, Any]) -> Tuple:
        track_id = r.get("track_id") or r.get("id")
        return (
            str(track_id),
            r.get("name"),
            to_int(r.get("popularity")),
            to_int(r.get("duration_ms")),
            to_int(r.get("time_signature")),
            to_float(r.get("tempo")),
            to_int(r.get("key")),
            to_int(r.get("mode")),
            to_float(r.get("danceability")),
            to_float(r.get("energy")),
            to_float(r.get("loudness")),
            to_float(r.get("speechiness")),
            to_float(r.get("acousticness")),
            to_float(r.get("instrumentalness")),
            to_float(r.get("liveness")),
            to_float(r.get("valence")),
            to_bool(r.get("null_response")),
        )

    pbar = tqdm(total=max_rows if max_rows > 0 else None, desc="Loading tracks")

    try:
        for r in ds:
            tid = r.get("track_id") or r.get("id")
            if not tid:
                continue

            if to_bool(r.get("null_response")) is True:
                continue

            batch.append(row_to_tuple(r))

            if len(batch) >= BATCH_SIZE:
                await conn.copy_records_to_table(
                    "track_features",
                    records=batch,
                    columns=[
                        "track_id", "name", "popularity", "duration_ms", "time_signature", "tempo", "key", "mode",
                        "danceability", "energy", "loudness", "speechiness", "acousticness", "instrumentalness",
                        "liveness", "valence", "null_response"
                    ],
                )
                inserted += len(batch)
                pbar.update(len(batch))
                batch.clear()

                if max_rows > 0 and inserted >= max_rows:
                    break

        if batch:
            await conn.copy_records_to_table(
                "track_features",
                records=batch,
                columns=[
                    "track_id", "name", "popularity", "duration_ms", "time_signature", "tempo", "key", "mode",
                    "danceability", "energy", "loudness", "speechiness", "acousticness", "instrumentalness",
                    "liveness", "valence", "null_response"
                ],
            )
            inserted += len(batch)
            pbar.update(len(batch))
            batch.clear()

    finally:
        pbar.close()
        await conn.close()

    print(f"Loaded {inserted} rows into track_features")


if __name__ == "__main__":
    asyncio.run(main())
