"""The six product industries mapped onto each registry's activity classification.

Norway (SN2007) and Finland (TOL2008) accept code prefixes; France (NAF rév. 2) needs
exact codes. All three are national variants of NACE Rev. 2, so the divisions match.
"""

# NACE divisions / groups, used as prefixes by brreg and PRH.
NACE_PREFIXES = {
    "industrial manufacturing": ["25", "28", "22", "24"],
    "software": ["62", "58.2"],
    "healthcare": ["86"],
    "business services": ["69", "70", "71", "73", "78"],
    "energy": ["35"],
    "electronics": ["26", "27"],
}

# NACE section for Eurostat sector statistics.
NACE_SECTION = {
    "industrial manufacturing": "C", "software": "J", "healthcare": "Q",
    "business services": "M", "energy": "D", "electronics": "C",
}

NAF_CODES = {
    "industrial manufacturing": ["25.11Z", "25.12Z", "25.29Z", "25.50A", "25.50B", "25.61Z", "25.62A", "25.62B", "25.73B",
                                 "25.93Z", "25.99B", "28.11Z", "28.12Z", "28.13Z", "28.14Z", "28.15Z", "28.22Z", "28.25Z",
                                 "28.29A", "28.29B", "28.30Z", "28.41Z", "28.49Z", "28.92Z", "28.93Z", "28.99B", "22.21Z",
                                 "22.22Z", "22.29A", "22.29B", "24.10Z", "24.51Z", "24.53Z"],
    "software": ["62.01Z", "62.02A", "62.02B", "62.03Z", "62.09Z", "58.21Z", "58.29A", "58.29B", "58.29C"],
    "healthcare": ["86.10Z", "86.21Z", "86.22A", "86.22B", "86.22C", "86.23Z", "86.90A", "86.90B", "86.90D", "86.90E"],
    "business services": ["69.20Z", "70.22Z", "71.12A", "71.12B", "71.20B", "73.11Z", "73.20Z", "78.10Z", "78.20Z"],
    "energy": ["35.11Z", "35.12Z", "35.13Z", "35.14Z", "35.21Z", "35.22Z", "35.23Z", "35.30Z"],
    "electronics": ["26.11Z", "26.12Z", "26.20Z", "26.30Z", "26.40Z", "26.51A", "26.51B", "26.60Z", "26.70Z",
                    "27.11Z", "27.12Z", "27.20Z", "27.31Z", "27.32Z", "27.33Z", "27.40Z", "27.51Z", "27.90Z"],
}


def key(industry: str) -> str | None:
    value = industry.strip().casefold()
    return value if value in NACE_PREFIXES else None


def evenly_spaced(total_pages: int, wanted: int) -> list[int]:
    """Deterministic spread of page numbers, so results aren't all the alphabetical 'A…' companies."""
    if total_pages <= 0:
        return []
    wanted = min(wanted, total_pages)
    return sorted({int(i * total_pages / wanted) for i in range(wanted)})
