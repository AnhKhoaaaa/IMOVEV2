from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Required: Planning + Adaptation agents
    onemap_email: str
    onemap_password: str
    lta_api_key: str
    # Required ONLY in api_key mode. When google_genai_use_vertexai=True the SDK
    # authenticates via service account (GOOGLE_APPLICATION_CREDENTIALS) instead,
    # so this may be left empty — validated at gemini client init.
    gemini_api_key: Optional[str] = None

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

    # Optional: Chatbot LLM via Vertex AI. When True, gemini.py builds a Vertex client
    # (genai.Client(vertexai=True, ...)) and the 15-RPM rate-limit guard is skipped.
    # When False (default), falls back to the api_key client using gemini_api_key.
    google_genai_use_vertexai: bool = False           # GOOGLE_GENAI_USE_VERTEXAI
    google_cloud_project: Optional[str] = None        # GOOGLE_CLOUD_PROJECT
    google_cloud_location: Optional[str] = None       # GOOGLE_CLOUD_LOCATION
    google_application_credentials: Optional[str] = None  # GOOGLE_APPLICATION_CREDENTIALS
    chat_model: str = "gemini-2.5-flash"              # CHAT_MODEL


settings = Settings()
