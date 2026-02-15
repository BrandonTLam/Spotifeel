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

    @property
    def cors_origin_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

settings = Settings()
