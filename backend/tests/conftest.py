"""Session-scoped FX paths for regression tests."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from research_engine.api import generate_baseline_fx_levels


@pytest.fixture(scope="session")
def fx_bundle():
    """One SB20 10,000 × 1,260 path set (seed 42), reused by all tests."""
    return generate_baseline_fx_levels(use_cache=False)


@pytest.fixture(scope="session")
def benchmark_log():
    data: dict = {}
    yield data
    out = Path(__file__).resolve().parent / "_optimize_benchmark.json"
    out.write_text(json.dumps(data, indent=2))
