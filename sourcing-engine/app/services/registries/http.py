"""Polite JSON fetching for free public registries: disk cache, retries, backoff.

Registries rate-limit bursts (Brønnøysund answers 503 under load), so every call is
cached on disk and a failure degrades to "field unavailable", never to a crash.
"""
from __future__ import annotations

import hashlib
import json
import time
import uuid
from datetime import datetime, timezone
from threading import Lock
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from app.config import get_logger, get_settings

logger = get_logger(__name__)
USER_AGENT = "Mergero-MGX/1.0 (hackathon research prototype; public registry data)"
_throttle: dict[str, float] = {}
_throttle_lock = Lock()


class RegistryUnavailable(RuntimeError):
    """The registry did not answer usefully; callers treat the data as missing."""


def _wait_turn(host: str, min_interval: float) -> None:
    with _throttle_lock:
        now = time.monotonic()
        ready = max(now, _throttle.get(host, 0.0))
        _throttle[host] = ready + min_interval
    if ready > now:
        time.sleep(ready - now)


def get_json(url: str, params: dict | None = None, *, cache_hours: float = 168, min_interval: float = 0.15,
             retries: int = 3, timeout: float = 12, not_found=None):
    """GET a JSON document. Returns `not_found` for 404. Raises RegistryUnavailable otherwise."""
    full = url + ("?" + urlencode(params, doseq=True) if params else "")
    folder = get_settings().storage_path / "registry-cache"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / (hashlib.sha256(full.encode()).hexdigest() + ".json")
    if cache_hours > 0 and path.exists():
        try:
            envelope = json.loads(path.read_text(encoding="utf-8"))
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(envelope["cached_at"])).total_seconds()
            if 0 <= age < cache_hours * 3600:
                return envelope["value"]
        except (OSError, ValueError, KeyError):
            pass
    host = full.split("/")[2]
    delay = 1.0
    for attempt in range(retries):
        _wait_turn(host, min_interval)
        try:
            request = Request(full, headers={"Accept": "application/json", "User-Agent": USER_AGENT})
            with urlopen(request, timeout=timeout) as response:
                value = json.load(response)
            break
        except HTTPError as exc:
            if exc.code == 404:
                return not_found
            if exc.code not in (429, 500, 502, 503, 504) or attempt == retries - 1:
                raise RegistryUnavailable(f"{host} answered HTTP {exc.code}") from exc
        except (URLError, TimeoutError, OSError, ValueError) as exc:
            if attempt == retries - 1:
                raise RegistryUnavailable(f"{host} unreachable: {type(exc).__name__}") from exc
        logger.info("registry retry host=%s attempt=%d wait_s=%.1f", host, attempt + 1, delay)
        time.sleep(delay)
        delay *= 2.5
    if cache_hours > 0:
        temporary = path.with_suffix(f".{uuid.uuid4().hex}.tmp")
        temporary.write_text(json.dumps({"cached_at": datetime.now(timezone.utc).isoformat(), "value": value}), encoding="utf-8")
        temporary.replace(path)
    return value
