from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> Optional[str]:
    """Extract user_id from Supabase JWT. Returns None if unauthenticated."""
    if creds is None:
        return None

    from app.database import supabase  # late import avoids circular dependency
    if supabase is None:
        return None

    try:
        resp = supabase.auth.get_user(creds.credentials)
        return str(resp.user.id)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def require_current_user(
    user_id: Optional[str] = Depends(get_current_user),
) -> str:
    """Like get_current_user but raises 401 if not authenticated."""
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user_id
