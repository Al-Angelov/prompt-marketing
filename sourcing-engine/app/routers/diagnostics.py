"""Operator-only log access. Requires the service token; the public Vercel site
has no gateway route to it, so end users can never reach these logs."""

from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query

from app import diagnostics
from app.auth import require_token
from app.config import get_settings

router = APIRouter(prefix="/api/v1/diagnostics", tags=["diagnostics"], dependencies=[Depends(require_token)])


@router.get("/logs")
def read_logs(
    file: Literal["errors", "activity"] = "errors",
    lines: int = Query(default=200, ge=1, le=2000),
    trace: Optional[str] = Query(default=None, max_length=64),
) -> dict:
    """Newest log entries (JSON lines), optionally for one request/job trace id."""
    entries = diagnostics.tail(get_settings().log_path, file, lines, trace)
    return {"file": file, "count": len(entries), "entries": entries}
