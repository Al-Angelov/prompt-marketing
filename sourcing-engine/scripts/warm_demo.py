"""Pre-warm caches before a live demo so every search answers instantly.

    cd sourcing-engine
    .venv/bin/python scripts/warm_demo.py                     # registry screens only (free)
    .venv/bin/python scripts/warm_demo.py --deep              # also deep research on the top candidates (paid)
    .venv/bin/python scripts/warm_demo.py --market "Norway:Software"

Needs the Java model on MODEL_API_URL. Deep research also needs OPENAI_API_KEY and
ALLOW_PAID_RESEARCH=true in .env. Run it within QUICK_CACHE_HOURS / COMPANY_CACHE_HOURS
of the demo, or raise those in .env for demo day.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import market, quick_search  # noqa: E402

DEFAULT_MARKETS = ["Norway:Industrial manufacturing", "Norway:Software", "France:Industrial manufacturing",
                   "France:Software", "Finland:Industrial manufacturing"]


def screen(country: str, industry: str, attempts: int = 3) -> dict:
    for attempt in range(1, attempts + 1):
        started = time.time()
        job = quick_search.run(country, industry)
        print(f"  screen {country}/{industry}: {len(job['results'])} companies, {time.time() - started:.1f}s"
              f"{' (cache)' if job.get('cache_hit') else ''}{' - ' + ' '.join(job['warnings']) if job['warnings'] else ''}")
        if not job["warnings"] or attempt == attempts:
            return job
        # Registry gaps (rate limiting) make the cache short-lived; wait and fill them in.
        print("  registry gaps; retrying in 60s so the cached screen is complete")
        time.sleep(60)
        quick_search.storage.cache_path("quick", [quick_search.CACHE_VERSION, country.casefold(), industry.casefold(),
                                                  quick_search.get_settings().quick_search_limit]).unlink(missing_ok=True)
    return job


def deep(country: str, industry: str) -> None:
    started = time.time()
    job = market.start(country, industry)
    while job["status"] == "running":
        time.sleep(5)
        job = market.snapshot(job["id"])
    top = ", ".join(f"{r['company']} {r['priority']}" for r in job["results"])
    print(f"  deep {country}/{industry}: {job['status']} in {time.time() - started:.0f}s - {top or job['error']}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--market", action="append", help='"Country:Industry"; repeatable. Default: the demo markets.')
    parser.add_argument("--deep", action="store_true", help="Also run paid deep research on the top candidates.")
    args = parser.parse_args()
    for item in args.market or DEFAULT_MARKETS:
        country, _, industry = item.partition(":")
        print(f"{country} / {industry}")
        try:
            screen(country.strip(), industry.strip())
            if args.deep:
                deep(country.strip(), industry.strip())
        except Exception as exc:   # keep warming the other markets
            print(f"  FAILED: {type(exc).__name__}: {exc}")


if __name__ == "__main__":
    main()
