from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str
    onemap_email: str
    onemap_password: str
    lta_api_key: str
    gemini_api_key: str
    openweather_api_key: str

    class Config:
        env_file = ".env"

settings = Settings()
