"""Filesystem persistence for research artifacts.

Layout under STORAGE_DIR:
    storage/regions/{region_slug}_signals.json
    storage/companies/{company_slug}_{region_slug}_signals.json
"""

from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from typing import Optional

from app.config import get_logger, get_settings

logger = get_logger(__name__)


def slugify(value: str) -> str:
    """Convert an arbitrary label into a filesystem-safe slug."""
    value = value.strip().lower()
    value = re.sub(r"[^\w\s-]", "", value)
    value = re.sub(r"[\s_-]+", "-", value)
    return value.strip("-") or "unknown"


def _regions_dir() -> Path:
    path = get_settings().storage_path / "regions"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _companies_dir() -> Path:
    path = get_settings().storage_path / "companies"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _write_json(path: Path, data: dict) -> Path:
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        json.dump(data, stream, indent=2, ensure_ascii=False)
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    logger.info("wrote artifact path=%s", path)
    return path


def region_signals_path(region: str) -> Path:
    return _regions_dir() / f"{slugify(region)}_signals.json"


def company_signals_path(company_name: str, region: str) -> Path:
    return _companies_dir() / f"{slugify(company_name)}_{slugify(region)}_signals.json"


def save_region_signals(region: str, data: dict) -> Path:
    """Persist Phase 1 output for a region."""
    return _write_json(region_signals_path(region), data)


def load_region_signals(region: str) -> Optional[dict]:
    """Load previously-saved Phase 1 output for a region, or None."""
    path = region_signals_path(region)
    if not path.exists():
        logger.warning("region signals not found path=%s", path)
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def save_company_signals(company_name: str, region: str, data: dict) -> Path:
    """Persist Phase 2 output for a company."""
    return _write_json(company_signals_path(company_name, region), data)


def load_company_report_by_slug(company_slug: str) -> Optional[dict]:
    """Load a Phase 2 report by its company slug.

    Matches the first file whose name starts with `{company_slug}_`.
    """
    if not re.fullmatch(r"[\w-]+", company_slug):
        raise ValueError("Invalid company slug")
    companies = _companies_dir()
    matches = sorted(companies.glob(f"{company_slug}_*_signals.json"))
    if not matches:
        # Also allow an exact filename (already includes region + suffix).
        exact = companies / f"{company_slug}.json"
        if exact.exists():
            matches = [exact]
    if not matches:
        logger.warning("company report not found slug=%s", company_slug)
        return None
    if len(matches) > 1:
        raise ValueError("Multiple regional reports exist; use the exact company-and-region filename stem")
    return json.loads(matches[0].read_text(encoding="utf-8"))
