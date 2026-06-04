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

    # Optional: Unsplash image seeding (seed_images.py only — not used at runtime)
    # Demo key: 50 req/hr. Production key: 5,000 req/hr (free, apply at unsplash.com/developers)
    unsplash_access_key: Optional[str] = None

    # Optional: Pexels image seeding (seed_images_pexels.py only — not used at runtime)
    # Free tier: 200 req/hr, 20 000 req/month. Get key at pexels.com/api
    pexels_api_key: Optional[str] = None

    # Optional: Google Places API (New) — enrich_places_google.py only, not used at runtime.
    # Enable at: https://console.cloud.google.com → Maps Platform → Places API (New)
    # Free caps: Text Search Pro 5K/month, Place Details Enterprise 1K/month, Photos 1K/month
    google_places_api_key: Optional[str] = None


settings = Settings()
