from fastapi import APIRouter, Depends, HTTPException
from app.auth import require_token
from app.models.schemas import MarketRequest
from app.services import quick_search
from app.services.registries.http import RegistryUnavailable

router = APIRouter(prefix="/api/v1/quick-search", dependencies=[Depends(require_token)])


@router.post("")
def quick(body: MarketRequest):
    """Registry-first screen of a market. Synchronous: seconds when warm, no LLM calls."""
    try:
        return quick_search.run(body.country, body.industry)
    except quick_search.UnsupportedMarket as exc:
        raise HTTPException(404, str(exc)) from exc
    except RegistryUnavailable as exc:
        raise HTTPException(503, "The official register is temporarily unavailable. Please try again shortly.") from exc
