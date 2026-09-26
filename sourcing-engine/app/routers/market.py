from fastapi import APIRouter, Depends, HTTPException
from app.auth import require_token
from app.models.schemas import MarketRequest
from app.services import market

router = APIRouter(prefix="/api/v1/investigate-market", dependencies=[Depends(require_token)])


@router.post("", status_code=202)
def start_investigation(body: MarketRequest):
    try:
        return market.start(body.country, body.industry)
    except ValueError as exc:
        raise HTTPException(503, str(exc)) from exc


@router.get("/{job_id}")
def get_investigation(job_id: str):
    result = market.snapshot(job_id)
    if result is None:
        raise HTTPException(404, "This research session has expired. Please start again.")
    return result
