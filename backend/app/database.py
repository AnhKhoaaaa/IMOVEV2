from typing import Optional
from supabase import create_client, Client
from app.config import settings

supabase: Optional[Client] = (
    create_client(settings.supabase_url, settings.supabase_service_role_key)
    if settings.supabase_url and settings.supabase_service_role_key
    else None
)
