from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field
from typing import List

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = Field(default="Spotifeel Backend", validation_alias="APP_NAME")
    env: str = Field(default="dev", validation_alias="ENV")
    api_base_url: str = Field(default="http://localhost:8000", validation_alias="API_BASE_URL")

    cors_origins: str = Field(default="http://localhost:5173", validation_alias="CORS_ORIGINS")
    database_url: str = Field(validation_alias="DATABASE_URL")
    frontend_url: str = Field(default="http://localhost:5173", validation_alias="FRONTEND_URL")

    spotify_client_id: str = Field(default="", validation_alias="SPOTIFY_CLIENT_ID")
    spotify_client_secret: str = Field(default="", validation_alias="SPOTIFY_CLIENT_SECRET")
    spotify_redirect_uri: str = Field(
        default="http://localhost:8000/spotify/auth/callback",
        validation_alias="SPOTIFY_REDIRECT_URI",
    )
    spotify_scopes: str = Field(
        default="user-read-email user-read-private user-top-read user-library-read user-read-recently-played streaming user-modify-playback-state",
        validation_alias="SPOTIFY_SCOPES",
    )
    spotify_session_path: str = Field(
        default="data/spotify_session.json",
        validation_alias="SPOTIFY_SESSION_PATH",
    )

    @property
    def cors_origin_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def spotify_scope_list(self) -> List[str]:
        return [s.strip() for s in self.spotify_scopes.split(" ") if s.strip()]

    @property
    def spotify_is_configured(self) -> bool:
        return bool(self.spotify_client_id and self.spotify_client_secret and self.spotify_redirect_uri)

settings = Settings()
