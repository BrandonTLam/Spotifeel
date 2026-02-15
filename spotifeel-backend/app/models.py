from sqlalchemy import String, Integer, Float, Boolean, Index
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base

class TrackFeature(Base):
    __tablename__ = "track_features"

    track_id: Mapped[str] = mapped_column(String(32), primary_key=True)

    name: Mapped[str | None] = mapped_column(String(512), nullable=True)
    popularity: Mapped[int | None] = mapped_column(Integer, nullable=True)

    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    time_signature: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tempo: Mapped[float | None] = mapped_column(Float, nullable=True)
    key: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mode: Mapped[int | None] = mapped_column(Integer, nullable=True)

    danceability: Mapped[float | None] = mapped_column(Float, nullable=True)
    energy: Mapped[float | None] = mapped_column(Float, nullable=True)
    loudness: Mapped[float | None] = mapped_column(Float, nullable=True)
    speechiness: Mapped[float | None] = mapped_column(Float, nullable=True)
    acousticness: Mapped[float | None] = mapped_column(Float, nullable=True)
    instrumentalness: Mapped[float | None] = mapped_column(Float, nullable=True)
    liveness: Mapped[float | None] = mapped_column(Float, nullable=True)
    valence: Mapped[float | None] = mapped_column(Float, nullable=True)

    null_response: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

Index("ix_track_features_valence", TrackFeature.valence)
Index("ix_track_features_energy", TrackFeature.energy)
Index("ix_track_features_tempo", TrackFeature.tempo)
