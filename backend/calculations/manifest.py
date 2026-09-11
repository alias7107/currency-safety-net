"""Manifest helpers and request fingerprinting for optimization jobs."""

from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from research_engine.api import (
    BUFFER_MONTHS_MAX,
    BUFFER_MONTHS_MIN,
    CONVERSION_COST_MAX,
    CONVERSION_COST_MIN,
    DATA_AS_OF,
    EXPENSE_INCOME_RATIO_MAX,
    EXPENSE_INCOME_RATIO_MIN,
    PRODUCTION_N_PATHS,
    PRODUCTION_SEED,
    PROFILE_ALIASES,
    SUPPORTED_HORIZON_YEARS,
    SUPPORTED_REBALANCE_FREQUENCIES,
    _model_version,
)
from research_engine.config import (
    HH_BUFFER_MONTHS,
    HH_EXPENSE_INCOME_RATIOS,
    ROB_CONVERSION_COSTS,
)
from research_engine.household.profiles import PRIMARY_PROFILES

PROFILE_DESCRIPTIONS = {
    "P1_local_control": "Local income and expenses in KZT (control profile).",
    "P2_foreign_income_mismatch": "USD income with KZT expenses (currency mismatch).",
    "P3_mixed_income": "Mixed KZT/USD income with KZT expenses.",
    "P4_full_multi_currency": "Multi-currency income and expenses (USD/EUR/KZT).",
}


@lru_cache(maxsize=1)
def load_manifest() -> dict[str, Any]:
    path = Path(__file__).resolve().parents[1] / "research_engine" / "MODEL_MANIFEST.json"
    return json.loads(path.read_text(encoding="utf-8"))


def model_version() -> str:
    return _model_version()


def data_as_of() -> str:
    return DATA_AS_OF


def dataset_sha256() -> str:
    manifest = load_manifest()
    dataset = manifest.get("dataset", {})
    return str(dataset.get("target_sha256") or dataset.get("sha256") or "")


def normalize_request_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Return a deterministic, engine-ready request payload."""
    profile = str(payload["profile"]).strip()
    canonical = PROFILE_ALIASES.get(profile.upper(), profile)
    return {
        "profile": canonical if any(p.name == canonical for p in PRIMARY_PROFILES) else profile,
        "horizon_years": int(payload["horizon_years"]),
        "expense_income_ratio": float(payload["expense_income_ratio"]),
        "buffer_months": float(payload["buffer_months"]),
        "rebalance_frequency": str(payload["rebalance_frequency"]).lower().strip(),
        "conversion_cost": float(payload["conversion_cost"]),
    }


def compute_request_fingerprint(normalized: dict[str, Any]) -> str:
    material = {
        "request": normalized,
        "model_version": model_version(),
        "dataset_sha256": dataset_sha256(),
        "simulation_paths": PRODUCTION_N_PATHS,
        "simulation_seed": PRODUCTION_SEED,
    }
    encoded = json.dumps(material, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def public_metadata() -> dict[str, Any]:
    manifest = load_manifest()
    baseline = manifest.get("baseline_parameters", {})
    date_range = manifest.get("dataset", {}).get("date_range", {})
    return {
        "model_version": model_version(),
        "data_as_of": data_as_of(),
        "baseline_estimation_period": {
            "start": date_range.get("baseline_estimation_start"),
            "end": date_range.get("baseline_estimation_end"),
        },
        "supported_currencies": ["KZT", "USD", "EUR"],
        "supported_horizons_years": list(SUPPORTED_HORIZON_YEARS),
        "supported_profiles": [
            {
                "id": alias,
                "name": name,
                "description": PROFILE_DESCRIPTIONS.get(name, ""),
            }
            for alias, name in PROFILE_ALIASES.items()
        ],
        "simulation_method": manifest.get("primary_dgp"),
        "simulation_paths": PRODUCTION_N_PATHS,
        "simulation_seed": PRODUCTION_SEED,
        "risk_metric_names": [
            "shortfall_probability",
            "var95_cumulative_shortfall",
            "cvar95_cumulative_shortfall",
            "mean_cumulative_shortfall",
        ],
        "dataset_sha256": dataset_sha256(),
        "canonical_optimization_specification": manifest.get(
            "canonical_optimization_specification"
        ),
        "baseline_defaults": {
            "expense_income_ratio": baseline.get("expense_income_ratio"),
            "buffer_months": baseline.get("buffer_months"),
            "rebalance_frequency": baseline.get("rebalance_frequency"),
            "conversion_cost": baseline.get("conversion_cost"),
        },
    }


def public_options() -> dict[str, Any]:
    baseline = load_manifest().get("baseline_parameters", {})
    expense_defaults = list(HH_EXPENSE_INCOME_RATIOS)
    buffer_defaults = list(HH_BUFFER_MONTHS)
    conversion_defaults = list(ROB_CONVERSION_COSTS)
    return {
        "profiles": [
            {
                "id": alias,
                "name": name,
                "description": PROFILE_DESCRIPTIONS.get(name, ""),
            }
            for alias, name in PROFILE_ALIASES.items()
        ],
        "horizons_years": list(SUPPORTED_HORIZON_YEARS),
        "expense_income_ratio": {
            "min": EXPENSE_INCOME_RATIO_MIN,
            "max": EXPENSE_INCOME_RATIO_MAX,
            "default": float(
                baseline.get("expense_income_ratio", expense_defaults[1])
            ),
            "documented_values": expense_defaults,
        },
        "buffer_months": {
            "min": BUFFER_MONTHS_MIN,
            "max": BUFFER_MONTHS_MAX,
            "default": float(baseline.get("buffer_months", buffer_defaults[0])),
            "documented_values": buffer_defaults,
        },
        "rebalance_frequencies": list(SUPPORTED_REBALANCE_FREQUENCIES),
        "conversion_cost": {
            "min": CONVERSION_COST_MIN,
            "max": CONVERSION_COST_MAX,
            "default": float(baseline.get("conversion_cost", conversion_defaults[0])),
            "documented_values": conversion_defaults,
        },
        "currencies": ["KZT", "USD", "EUR"],
    }
