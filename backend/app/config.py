from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Required: Planning + Adaptation agents
    onemap_email: str
    onemap_password: str
    lta_api_key: str
    gemini_api_key: str

    # Optional: only needed for Memory Agent (NICE TO HAVE in MVP)
    supabase_url: Optional[str] = None
    supabase_service_role_key: Optional[str] = None
    # Reserved for future client-side auth (Supabase RLS via browser client) — not used server-side.
    supabase_anon_key: Optional[str] = None

    # Optional: Adaptation Agent soft-error path
    openweather_api_key: Optional[str] = None

    # Optional: production frontend URL for CORS (e.g. https://imove.vercel.app)
    frontend_url: Optional[str] = None


settings = Settings()
