"""Server-to-server authentication; the browser never receives this token."""
import secrets
from fastapi import Header, HTTPException
from app.config import get_settings


def require_token(authorization: str = Header(default="")) -> None:
    settings = get_settings()
    if not settings.sourcing_api_token:
        if settings.require_api_token:
            raise HTTPException(503, "Research service authentication is not configured")
        return  # explicit local-only opt-out
    if not secrets.compare_digest(authorization.encode(), ("Bearer " + settings.sourcing_api_token).encode()):
        raise HTTPException(401, "Unauthorized")
