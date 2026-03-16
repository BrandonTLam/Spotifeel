from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

class TrackOut(BaseModel):
    id: str
    name: Optional[str] = None
    popularity: Optional[int] = None

    spotify_uri: str
    spotify_url: str

    audio_features: Optional[Dict[str, Any]] = None
    duration_ms: int | None = None
    
    score: Optional[float] = None

class RecommendationsOut(BaseModel):
    mood: str
    context: Dict[str, Any] = Field(default_factory=dict)
    tracks: List[TrackOut]
