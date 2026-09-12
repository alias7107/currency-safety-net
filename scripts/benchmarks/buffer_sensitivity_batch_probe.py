#!/usr/bin/env python3
"""Phase 3B engineering probe: buffer-sensitivity batch (public API path).

This is tooling, not production API code. The primary measurement runs four
sequential ``optimize_allocation(..., buffer_months=B)`` calls through the
supported public API for documented buffers ``[1, 3, 6, 12]`` — without the
test-only ``_fx_bundle`` hook.

Usage (from repository root, with backend venv):

    cd backend
    .venv/bin/python ../scripts/benchmarks/buffer_sensitivity_batch_probe.py \\
        --output ../docs/product/benchmarks/buffer-sensitivity-phase3b.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import multiprocessing as mp
import os
import platform
import queue
import re
import resource
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DOCUMENTED_BUFFERS = [1, 3, 6, 12]
CONTRACT_VERSION = "buffer_sensitivity_batch_v1"
PRESENTATION_VERSION = "presentation_v1"

# Canonical gates from research_engine regression suite (B=1, 3y).
# Matching uses the same absolute tolerances as backend/tests/test_research_engine_regression.py
# (pytest.approx(..., abs=...)). This is tolerance-based matching, not bitwise equality.
P2_CVAR_GATE = 1.1871802686857733
P2_PSHORT_GATE = 0.0491
P4_CVAR_GATE = 0.5082906243903793
P4_PSHORT_GATE = 0.0283
CVAR_ATOL = 1e-6
PSHORT_ATOL = 1e-4
WEIGHT_ATOL = 1e-12

SINGLE_JOB_SOFT_S = 120
SINGLE_JOB_HARD_S = 180
SINGLE_JOB_LEASE_S = 240

# Candidate batch limits under evaluation (not applied to production in 3B).
# Revised after public-path P1 5y measurement (~466.6 s total on this host).
CANDIDATE_BATCH_SOFT_S = 600
CANDIDATE_BATCH_HARD_S = 720
CANDIDATE_BATCH_LEASE_S = 840

# Candidate single-job annotations (existing defaults are unsafe for some advertised inputs).
CANDIDATE_SINGLE_SOFT_S = 180
CANDIDATE_SINGLE_HARD_S = 240
CANDIDATE_SINGLE_LEASE_S = 300

IMPLEMENTATION_ONLY_KEYS = (
    "mean_cumulative_shortfall",
    "wealth_depletion_probability",
    "mean_terminal_wealth",
    "median_terminal_wealth",
    "p05_terminal_wealth",
    "p95_terminal_wealth",
)

PUBLISHED_METRIC_KEYS = (
    "shortfall_probability",
    "cvar95_cumulative_shortfall",
    "var95_cumulative_shortfall",
)

BENCHMARK_CASES: list[dict[str, Any]] = [
    {
        "case_id": "P2_3y_ei0.95_monthly_cost0",
        "profile": "P2",
        "horizon_years": 3,
        "expense_income_ratio": 0.95,
        "rebalance_frequency": "monthly",
        "conversion_cost": 0.0,
        "canonical_b1_gates": {
            "cvar95_cumulative_shortfall": P2_CVAR_GATE,
            "shortfall_probability": P2_PSHORT_GATE,
        },
    },
    {
        "case_id": "P4_3y_ei0.95_monthly_cost0",
        "profile": "P4",
        "horizon_years": 3,
        "expense_income_ratio": 0.95,
        "rebalance_frequency": "monthly",
        "conversion_cost": 0.0,
        "canonical_b1_gates": {
            "cvar95_cumulative_shortfall": P4_CVAR_GATE,
            "shortfall_probability": P4_PSHORT_GATE,
        },
    },
    {
        "case_id": "P2_5y_ei1.05_monthly_cost0",
        "profile": "P2",
        "horizon_years": 5,
        "expense_income_ratio": 1.05,
        "rebalance_frequency": "monthly",
        "conversion_cost": 0.0,
        "canonical_b1_gates": None,
        "notes": (
            "Documented 5-year stress case; exploratory for timing/monotonicity. "
            "Also exposes single-job timeout risk on B=1 alone."
        ),
    },
    {
        "case_id": "P1_5y_ei0.95_monthly_cost0",
        "profile": "P1",
        "horizon_years": 5,
        "expense_income_ratio": 0.95,
        "rebalance_frequency": "monthly",
        "conversion_cost": 0.0,
        "canonical_b1_gates": None,
        "notes": (
            "Documented potentially broad near-optimal-surface case for public-path "
            "batch timing."
        ),
    },
]


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _peak_rss_bytes() -> int:
    """Return peak resident set size in bytes (macOS ru_maxrss is bytes; Linux is KB)."""
    rss = int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    if sys.platform == "darwin":
        return rss
    return rss * 1024


def _available_memory_bytes() -> int | None:
    """Best-effort machine memory without extra dependencies."""
    try:
        if sys.platform == "darwin":
            import subprocess

            raw = subprocess.check_output(["sysctl", "-n", "hw.memsize"], text=True).strip()
            return int(raw)
        meminfo = Path("/proc/meminfo")
        if meminfo.is_file():
            for line in meminfo.read_text(encoding="utf-8").splitlines():
                if line.startswith("MemTotal:"):
                    parts = line.split()
                    return int(parts[1]) * 1024
    except Exception:  # noqa: BLE001 — optional metadata
        return None
    return None


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, int) and not isinstance(value, bool):
        return int(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError(f"non-finite float in payload: {value!r}")
        return float(value)
    if isinstance(value, str):
        return value
    type_name = type(value).__name__
    module = type(value).__module__
    if module.startswith("numpy"):
        raise TypeError(f"NumPy value leaked into JSON payload: {type_name}")
    raise TypeError(f"unsupported JSON type: {module}.{type_name}")


def _safe_error_message(exc: BaseException, *, limit: int = 400) -> str:
    """Concise message without absolute machine paths."""
    text = f"{type(exc).__name__}: {exc}"
    text = re.sub(r"(?i)(/Users/|/home/|/var/folders/|[A-Za-z]:\\\\)[^\s\"']+", "<path>", text)
    text = re.sub(r"File \"[^\"]+\"", 'File "<path>"', text)
    return text[:limit]


def _metric_nonincreasing(values: list[float], *, atol: float = 1e-12) -> bool:
    for left, right in zip(values, values[1:]):
        if right > left + atol:
            return False
    return True


def _weights_all_kzt(weights: list[float]) -> bool:
    return (
        abs(float(weights[0]) - 1.0) <= WEIGHT_ATOL
        and abs(float(weights[1])) <= WEIGHT_ATOL
        and abs(float(weights[2])) <= WEIGHT_ATOL
    )


def _package_versions() -> dict[str, str | None]:
    versions: dict[str, str | None] = {
        "numpy": None,
        "pandas": None,
        "scipy": None,
        "statsmodels": None,
    }
    for name in versions:
        try:
            mod = __import__(name)
            versions[name] = getattr(mod, "__version__", None)
        except Exception:  # noqa: BLE001
            versions[name] = None
    return versions


def evaluate_acceptance(record: dict[str, Any]) -> tuple[bool, list[str], dict[str, Any]]:
    """Return (acceptance_ok, failed_checks, detailed_checks)."""
    checks: dict[str, Any] = {}
    failed: list[str] = []
    results = record.get("results_by_buffer") or []
    buffers = [row.get("buffer_months") for row in results]
    expected = [float(b) for b in DOCUMENTED_BUFFERS]
    checks["buffers_exact_order"] = buffers == expected
    if not checks["buffers_exact_order"]:
        failed.append("buffers_exact_order")

    finite_ok = True
    json_ok = True
    try:
        _json_safe(results)
    except (TypeError, ValueError):
        json_ok = False
    for row in results:
        for key in PUBLISHED_METRIC_KEYS:
            value = row.get(key)
            if not isinstance(value, (int, float)) or not math.isfinite(float(value)):
                finite_ok = False
        impl = row.get("implementation_only") or {}
        mean_sf = impl.get("mean_cumulative_shortfall")
        if mean_sf is not None and (
            not isinstance(mean_sf, (int, float)) or not math.isfinite(float(mean_sf))
        ):
            finite_ok = False
        # Guard against accidental duplication outside implementation_only.
        if "mean_cumulative_shortfall" in row:
            checks["mean_shortfall_not_duplicated_outside_implementation_only"] = False
            failed.append("mean_shortfall_not_duplicated_outside_implementation_only")
    if "mean_shortfall_not_duplicated_outside_implementation_only" not in checks:
        checks["mean_shortfall_not_duplicated_outside_implementation_only"] = True

    checks["finite_metrics"] = finite_ok
    checks["json_safe"] = json_ok
    if not finite_ok:
        failed.append("finite_metrics")
    if not json_ok:
        failed.append("json_safe")

    if results:
        paths = {row.get("simulation_paths") for row in results}
        seeds = {row.get("simulation_seed") for row in results}
        models = {row.get("model_version") for row in results}
        datas = {row.get("data_as_of") for row in results}
        checks["shared_simulation_paths"] = len(paths) == 1 and None not in paths
        checks["shared_simulation_seed"] = len(seeds) == 1 and None not in seeds
        checks["shared_model_version"] = len(models) == 1 and None not in models
        checks["shared_data_as_of"] = len(datas) == 1 and None not in datas
    else:
        checks["shared_simulation_paths"] = False
        checks["shared_simulation_seed"] = False
        checks["shared_model_version"] = False
        checks["shared_data_as_of"] = False
    for key in (
        "shared_simulation_paths",
        "shared_simulation_seed",
        "shared_model_version",
        "shared_data_as_of",
    ):
        if not checks[key]:
            failed.append(key)

    shortfall_probs = [float(row["shortfall_probability"]) for row in results]
    cvars = [float(row["cvar95_cumulative_shortfall"]) for row in results]
    vars95 = [float(row["var95_cumulative_shortfall"]) for row in results]
    means = [
        float((row.get("implementation_only") or {})["mean_cumulative_shortfall"])
        for row in results
        if (row.get("implementation_only") or {}).get("mean_cumulative_shortfall") is not None
    ]
    checks["shortfall_probability_nonincreasing"] = _metric_nonincreasing(shortfall_probs)
    checks["cvar95_nonincreasing"] = _metric_nonincreasing(cvars)
    checks["var95_nonincreasing"] = _metric_nonincreasing(vars95)
    checks["mean_shortfall_nonincreasing_implementation_only"] = (
        _metric_nonincreasing(means) if len(means) == len(results) else False
    )
    for key in (
        "shortfall_probability_nonincreasing",
        "cvar95_nonincreasing",
        "var95_nonincreasing",
        "mean_shortfall_nonincreasing_implementation_only",
    ):
        if not checks[key]:
            failed.append(key)

    # Policy metadata — not a boolean acceptance gate.
    checks["identification_policy"] = (
        "Identification class is surface geometry, not a risk metric; "
        "monotonic improvement is not required and is not an acceptance gate."
    )
    checks["identification_classes"] = [
        row.get("identification_class") for row in results
    ]

    gates = record.get("canonical_b1_gates_expected")
    if gates:
        b1 = results[0] if results else {}
        observed_cvar = float(b1.get("cvar95_cumulative_shortfall", float("nan")))
        observed_p = float(b1.get("shortfall_probability", float("nan")))
        expected_cvar = float(gates["cvar95_cumulative_shortfall"])
        expected_p = float(gates["shortfall_probability"])
        cvar_match = abs(observed_cvar - expected_cvar) <= CVAR_ATOL
        p_match = abs(observed_p - expected_p) <= PSHORT_ATOL
        weights_ok = _weights_all_kzt(list(b1.get("weights") or [0.0, 0.0, 0.0]))
        checks["canonical_b1"] = {
            "tolerances": {
                "cvar95_abs": CVAR_ATOL,
                "shortfall_probability_abs": PSHORT_ATOL,
                "weights_abs": WEIGHT_ATOL,
                "matching_rule": (
                    "tolerance-based (same as backend/tests/test_research_engine_regression.py "
                    "pytest.approx abs=...); not bitwise equality"
                ),
            },
            "weights_all_kzt_within_tolerance": weights_ok,
            "cvar95_within_tolerance": cvar_match,
            "shortfall_probability_within_tolerance": p_match,
            "cvar95_numerically_identical_to_gate": observed_cvar == expected_cvar,
            "shortfall_probability_numerically_identical_to_gate": observed_p == expected_p,
            "observed": {
                "weights": b1.get("weights"),
                "cvar95_cumulative_shortfall": observed_cvar,
                "shortfall_probability": observed_p,
            },
            "expected": gates,
        }
        if not weights_ok:
            failed.append("canonical_b1_weights")
        if not cvar_match:
            failed.append("canonical_b1_cvar95")
        if not p_match:
            failed.append("canonical_b1_shortfall_probability")

    acceptance_ok = len(failed) == 0
    return acceptance_ok, failed, checks


def _run_case_worker(case: dict[str, Any], result_queue: mp.Queue) -> None:
    """Execute one public-API batch case in an isolated process."""
    started = time.perf_counter()
    peak_rss = _peak_rss_bytes()
    record: dict[str, Any] = {
        "case_id": case["case_id"],
        "measurement_mode": "production_public_api_sequential",
        "fx_policy": (
            "Each optimize_allocation call regenerates the deterministic production "
            "FX path set (paths/seed fixed). Not in-memory private-bundle reuse."
        ),
        "inputs": {
            "profile": case["profile"],
            "horizon_years": case["horizon_years"],
            "expense_income_ratio": case["expense_income_ratio"],
            "rebalance_frequency": case["rebalance_frequency"],
            "conversion_cost": case["conversion_cost"],
            "buffers": list(DOCUMENTED_BUFFERS),
        },
        "canonical_b1_gates_expected": case.get("canonical_b1_gates"),
        "execution_ok": False,
        "acceptance_ok": False,
        "failed_checks": ["execution_incomplete"],
        "notes": case.get("notes"),
    }
    try:
        backend_dir = _repo_root() / "backend"
        if str(backend_dir) not in sys.path:
            sys.path.insert(0, str(backend_dir))

        from research_engine import optimize_allocation
        from research_engine.api import (
            DATA_AS_OF,
            PRODUCTION_N_PATHS,
            PRODUCTION_SEED,
            _model_version,
        )

        per_buffer: list[dict[str, Any]] = []
        for buffer_months in DOCUMENTED_BUFFERS:
            opt_t0 = time.perf_counter()
            payload = optimize_allocation(
                case["profile"],
                horizon_years=int(case["horizon_years"]),
                expense_income_ratio=float(case["expense_income_ratio"]),
                buffer_months=float(buffer_months),
                rebalance_frequency=str(case["rebalance_frequency"]),
                conversion_cost=float(case["conversion_cost"]),
            )
            opt_seconds = time.perf_counter() - opt_t0
            peak_rss = max(peak_rss, _peak_rss_bytes())
            safe_payload = _json_safe(payload)

            published = {
                "buffer_months": float(safe_payload["buffer_months"]),
                "optimize_wall_seconds": opt_seconds,
                "exceeds_single_job_soft_limit_120s": opt_seconds > SINGLE_JOB_SOFT_S,
                "exceeds_single_job_hard_limit_180s": opt_seconds > SINGLE_JOB_HARD_S,
                "weights": safe_payload["weights"],
                "shortfall_probability": safe_payload["shortfall_probability"],
                "cvar95_cumulative_shortfall": safe_payload["cvar95_cumulative_shortfall"],
                "var95_cumulative_shortfall": safe_payload["var95_cumulative_shortfall"],
                "identification_class": safe_payload.get("identification_class"),
                "near_optimal_1pct_frac": safe_payload.get("near_optimal_1pct_frac"),
                "near_optimal_1pct_count": safe_payload.get("near_optimal_1pct_count"),
                "n_coarse": safe_payload.get("n_coarse"),
                "n_refined": safe_payload.get("n_refined"),
                "n_surface": safe_payload.get("n_surface"),
                "simulation_paths": safe_payload["simulation_paths"],
                "simulation_seed": safe_payload["simulation_seed"],
                "model_version": safe_payload["model_version"],
                "data_as_of": safe_payload["data_as_of"],
                "implementation_only": {
                    key: safe_payload.get(key) for key in IMPLEMENTATION_ONLY_KEYS
                },
            }
            per_buffer.append(published)

        total_seconds = time.perf_counter() - started
        peak_rss = max(peak_rss, _peak_rss_bytes())

        manifest_path = backend_dir / "research_engine" / "MODEL_MANIFEST.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        dataset_sha = (
            manifest.get("dataset", {}).get("target_sha256")
            or manifest.get("dataset", {}).get("sha256")
        )

        record.update(
            {
                "execution_ok": True,
                "provenance": {
                    "model_version": _model_version(),
                    "data_as_of": DATA_AS_OF,
                    "dataset_sha256": dataset_sha,
                    "simulation_paths": PRODUCTION_N_PATHS,
                    "simulation_seed": PRODUCTION_SEED,
                    "canonical_optimization_specification": manifest.get(
                        "canonical_optimization_specification"
                    ),
                    "contract_version": CONTRACT_VERSION,
                    "presentation_version": PRESENTATION_VERSION,
                    "units": {
                        "cumulative_shortfall": "months_of_initial_monthly_income_I0_equals_1"
                    },
                },
                "timing": {
                    "per_buffer_public_optimize_seconds": [
                        row["optimize_wall_seconds"] for row in per_buffer
                    ],
                    "optimize_sum_seconds": sum(
                        row["optimize_wall_seconds"] for row in per_buffer
                    ),
                    "total_batch_seconds": total_seconds,
                    "note": (
                        "Per-buffer wall time includes deterministic FX regeneration "
                        "inside each public optimize_allocation call."
                    ),
                },
                "memory": {
                    "peak_rss_bytes": peak_rss,
                    "peak_rss_mib": peak_rss / (1024 * 1024),
                },
                "buffers": DOCUMENTED_BUFFERS,
                "results_by_buffer": per_buffer,
                "single_job_limit_comparisons": [
                    {
                        "buffer_months": row["buffer_months"],
                        "optimize_wall_seconds": row["optimize_wall_seconds"],
                        "exceeds_soft_120s": row["exceeds_single_job_soft_limit_120s"],
                        "exceeds_hard_180s": row["exceeds_single_job_hard_limit_180s"],
                    }
                    for row in per_buffer
                ],
            }
        )
        acceptance_ok, failed, checks = evaluate_acceptance(record)
        record["acceptance_ok"] = acceptance_ok
        record["failed_checks"] = failed
        record["checks"] = checks
    except Exception as exc:  # noqa: BLE001 — probe must report failures honestly
        print(_safe_error_message(exc), file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        record.update(
            {
                "execution_ok": False,
                "acceptance_ok": False,
                "failed_checks": ["execution_failed"],
                "error": {
                    "type": type(exc).__name__,
                    "message": _safe_error_message(exc),
                },
                "timing": {"total_batch_seconds": time.perf_counter() - started},
                "memory": {
                    "peak_rss_bytes": peak_rss,
                    "peak_rss_mib": peak_rss / (1024 * 1024),
                },
            }
        )
    result_queue.put(record)


def run_case_in_subprocess(case: dict[str, Any], *, timeout_seconds: float) -> dict[str, Any]:
    ctx = mp.get_context("spawn")
    result_queue: mp.Queue = ctx.Queue()
    proc = ctx.Process(target=_run_case_worker, args=(case, result_queue))
    proc.start()
    proc.join(timeout_seconds)
    if proc.is_alive():
        proc.terminate()
        proc.join(10)
        return {
            "case_id": case["case_id"],
            "measurement_mode": "production_public_api_sequential",
            "execution_ok": False,
            "acceptance_ok": False,
            "failed_checks": ["subprocess_timeout"],
            "error": {
                "type": "TimeoutError",
                "message": (
                    f"case exceeded probe process timeout ({timeout_seconds:.0f}s); "
                    "reported honestly without reducing paths/seed/grid"
                ),
            },
            "inputs": {
                "profile": case["profile"],
                "horizon_years": case["horizon_years"],
                "expense_income_ratio": case["expense_income_ratio"],
                "rebalance_frequency": case["rebalance_frequency"],
                "conversion_cost": case["conversion_cost"],
                "buffers": list(DOCUMENTED_BUFFERS),
            },
        }
    try:
        return result_queue.get(timeout=5)
    except queue.Empty:
        return {
            "case_id": case["case_id"],
            "execution_ok": False,
            "acceptance_ok": False,
            "failed_checks": ["worker_no_result"],
            "error": {
                "type": "RuntimeError",
                "message": f"worker exited with code {proc.exitcode} without a result",
            },
        }


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    text = json.dumps(_json_safe(payload), indent=2, sort_keys=True) + "\n"
    tmp_path.write_text(text, encoding="utf-8")
    os.replace(tmp_path, path)


def build_report(case_records: list[dict[str, Any]]) -> dict[str, Any]:
    versions = _package_versions()
    mem_bytes = _available_memory_bytes()
    script_path = Path(__file__).resolve()
    manifest_path = _repo_root() / "backend" / "research_engine" / "MODEL_MANIFEST.json"

    comparisons = []
    for record in case_records:
        total = (record.get("timing") or {}).get("total_batch_seconds")
        comparisons.append(
            {
                "case_id": record.get("case_id"),
                "total_batch_seconds": total,
                "exceeds_candidate_batch_soft_seconds": (
                    total is not None and float(total) > CANDIDATE_BATCH_SOFT_S
                ),
                "exceeds_candidate_batch_hard_seconds": (
                    total is not None and float(total) > CANDIDATE_BATCH_HARD_S
                ),
                "within_candidate_batch_lease_seconds": (
                    total is not None and float(total) <= CANDIDATE_BATCH_LEASE_S
                ),
                "execution_ok": bool(record.get("execution_ok")),
                "acceptance_ok": bool(record.get("acceptance_ok")),
                "failed_checks": list(record.get("failed_checks") or []),
            }
        )

    any_single_soft = False
    any_single_hard = False
    for record in case_records:
        for row in record.get("single_job_limit_comparisons") or []:
            if row.get("exceeds_soft_120s"):
                any_single_soft = True
            if row.get("exceeds_hard_180s"):
                any_single_hard = True

    return {
        "phase": "3B",
        "artifact": "buffer-sensitivity-batch-probe",
        "generated_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "contract_version": CONTRACT_VERSION,
        "presentation_version": PRESENTATION_VERSION,
        "documented_buffers": DOCUMENTED_BUFFERS,
        "compute_design": {
            "production_proposal": (
                "Four sequential public optimize_allocation calls; each regenerates "
                "the deterministic production FX path set. Do not call _fx_bundle in "
                "Phase 3C production workers."
            ),
            "private_hook_status": (
                "_fx_bundle remains test-only. Prior shared-bundle timings are "
                "experimental only and are not the production design."
            ),
            "buffer_execution": "sequential inside one process",
            "paths": 10000,
            "seed": 42,
            "optimizer": "research_engine.optimize_allocation (unmodified public API)",
        },
        "canonical_matching": {
            "rule": "tolerance-based absolute tolerances (not bitwise equality)",
            "source": "backend/tests/test_research_engine_regression.py",
            "cvar95_abs": CVAR_ATOL,
            "shortfall_probability_abs": PSHORT_ATOL,
            "weights_abs": WEIGHT_ATOL,
        },
        "environment": {
            "python_version": platform.python_version(),
            "platform": platform.platform(),
            "architecture": platform.machine(),
            "cpu_count": os.cpu_count(),
            "machine_memory_bytes": mem_bytes,
            "machine_memory_gib": (mem_bytes / (1024**3)) if mem_bytes else None,
            "numpy_version": versions["numpy"],
            "pandas_version": versions["pandas"],
            "scipy_version": versions["scipy"],
            "statsmodels_version": versions["statsmodels"],
            "backend_package_root": "backend",
            "script": "scripts/benchmarks/buffer_sensitivity_batch_probe.py",
            "script_sha256": _sha256_file(script_path),
            "model_manifest": "backend/research_engine/MODEL_MANIFEST.json",
            "model_manifest_sha256": _sha256_file(manifest_path),
        },
        "existing_worker_limits_reference": {
            "CELERY_TASK_SOFT_TIME_LIMIT": SINGLE_JOB_SOFT_S,
            "CELERY_TASK_TIME_LIMIT": SINGLE_JOB_HARD_S,
            "OPTIMIZATION_LEASE_SECONDS": SINGLE_JOB_LEASE_S,
            "CELERY_WORKER_CONCURRENCY": 1,
            "optimization_submit_throttle_default": "3/hour",
        },
        "candidate_batch_limits_under_evaluation": {
            "soft_seconds": CANDIDATE_BATCH_SOFT_S,
            "hard_seconds": CANDIDATE_BATCH_HARD_S,
            "lease_seconds": CANDIDATE_BATCH_LEASE_S,
            "lease_rule": "lease > hard and lease >= hard + safety margin",
            "basis": (
                "Public-path max observed batch total on this host was P1 5y "
                "(~466.6 s). Candidates use ~29% soft headroom above that observation."
            ),
        },
        "candidate_single_job_limits_under_evaluation": {
            "soft_seconds": CANDIDATE_SINGLE_SOFT_S,
            "hard_seconds": CANDIDATE_SINGLE_HARD_S,
            "lease_seconds": CANDIDATE_SINGLE_LEASE_S,
            "lease_rule": "lease > hard and lease >= hard + safety margin",
            "basis": (
                "Public-path max observed single optimize wall time on this host was "
                "P2 5y η=1.05 B=1 (~125.2 s), which already exceeds the current 120 s soft "
                "limit. P1 5y single calls are ~116.7 s (near the soft ceiling)."
            ),
        },
        "critical_findings": {
            "single_job_soft_limit_risk": (
                "Existing single-job Celery soft limit (120 s) is already exceeded by at "
                "least one advertised valid public optimize call on this host "
                "(P2 5y η=1.05 B=1 ≈ 125.2 s). Phase 3C must introduce task-specific "
                "single-job soft/hard/lease limits with lease > hard + margin, or "
                "demonstrate on deployment hardware that all advertised inputs fit the "
                "existing limits with adequate margin. Do not silently restrict "
                "advertised scientific inputs. Do not leave 120/180/240 unqualified."
            ),
            "any_public_call_exceeded_single_job_soft_120s": any_single_soft,
            "any_public_call_exceeded_single_job_hard_180s": any_single_hard,
        },
        "cases": case_records,
        "limit_comparisons": comparisons,
    }


def _acceptance_self_test() -> int:
    """Temporary integrity check: forced false required check must fail acceptance."""
    fake = {
        "results_by_buffer": [
            {
                "buffer_months": 1.0,
                "weights": [1.0, 0.0, 0.0],
                "shortfall_probability": 0.1,
                "cvar95_cumulative_shortfall": 1.0,
                "var95_cumulative_shortfall": 0.5,
                "simulation_paths": 10000,
                "simulation_seed": 42,
                "model_version": "1.0.0",
                "data_as_of": "2025-12-31",
                "implementation_only": {"mean_cumulative_shortfall": 0.2},
            },
            {
                "buffer_months": 3.0,
                "weights": [1.0, 0.0, 0.0],
                "shortfall_probability": 0.2,  # increasing → must fail
                "cvar95_cumulative_shortfall": 0.9,
                "var95_cumulative_shortfall": 0.4,
                "simulation_paths": 10000,
                "simulation_seed": 42,
                "model_version": "1.0.0",
                "data_as_of": "2025-12-31",
                "implementation_only": {"mean_cumulative_shortfall": 0.1},
            },
            {
                "buffer_months": 6.0,
                "weights": [1.0, 0.0, 0.0],
                "shortfall_probability": 0.05,
                "cvar95_cumulative_shortfall": 0.5,
                "var95_cumulative_shortfall": 0.2,
                "simulation_paths": 10000,
                "simulation_seed": 42,
                "model_version": "1.0.0",
                "data_as_of": "2025-12-31",
                "implementation_only": {"mean_cumulative_shortfall": 0.05},
            },
            {
                "buffer_months": 12.0,
                "weights": [1.0, 0.0, 0.0],
                "shortfall_probability": 0.01,
                "cvar95_cumulative_shortfall": 0.1,
                "var95_cumulative_shortfall": 0.05,
                "simulation_paths": 10000,
                "simulation_seed": 42,
                "model_version": "1.0.0",
                "data_as_of": "2025-12-31",
                "implementation_only": {"mean_cumulative_shortfall": 0.01},
            },
        ]
    }
    ok, failed, _checks = evaluate_acceptance(fake)
    if ok or "shortfall_probability_nonincreasing" not in failed:
        print(
            "[self-test] FAILED: expected acceptance_ok=false for increasing shortfall",
            file=sys.stderr,
        )
        return 1
    print(
        "[self-test] ok: intentional false check yields acceptance_ok=false "
        f"failed_checks={failed}",
        flush=True,
    )
    # Demonstrate process exit policy used by main().
    synthetic_records = [
        {"execution_ok": True, "acceptance_ok": False, "failed_checks": failed}
    ]
    exit_code = 0 if all(
        r.get("execution_ok") and r.get("acceptance_ok") for r in synthetic_records
    ) else 1
    if exit_code != 1:
        print("[self-test] FAILED: exit policy did not return non-zero", file=sys.stderr)
        return 1
    print("[self-test] ok: exit policy returns non-zero on acceptance failure", flush=True)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("docs/product/benchmarks/buffer-sensitivity-phase3b.json"),
        help="Relative path for JSON artifact (from cwd).",
    )
    parser.add_argument(
        "--case-timeout-seconds",
        type=float,
        default=2400.0,
        help="Per-case subprocess timeout (seconds). Failures reported; model not altered.",
    )
    parser.add_argument(
        "--acceptance-self-test",
        action="store_true",
        help="Run temporary-only acceptance failure integrity check and exit.",
    )
    args = parser.parse_args()

    if args.acceptance_self_test:
        return _acceptance_self_test()

    repo_root = _repo_root()
    backend_dir = repo_root / "backend"
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))

    records: list[dict[str, Any]] = []
    for case in BENCHMARK_CASES:
        print(f"[probe] starting {case['case_id']} (public API) ...", flush=True)
        record = run_case_in_subprocess(case, timeout_seconds=args.case_timeout_seconds)
        records.append(record)
        status = (
            "ok"
            if record.get("execution_ok") and record.get("acceptance_ok")
            else (
                f"FAILED exec={record.get('execution_ok')} "
                f"accept={record.get('acceptance_ok')} "
                f"checks={record.get('failed_checks')}"
            )
        )
        total = (record.get("timing") or {}).get("total_batch_seconds")
        rss = (record.get("memory") or {}).get("peak_rss_mib")
        print(
            f"[probe] finished {case['case_id']}: {status}; "
            f"total_s={total}; peak_rss_MiB={rss}",
            flush=True,
        )

    report = build_report(records)
    output_path = args.output
    if not output_path.is_absolute():
        output_path = (Path.cwd() / output_path).resolve()
    _atomic_write_json(output_path, report)
    try:
        rel = output_path.relative_to(repo_root)
    except ValueError:
        rel = output_path
    print(f"[probe] wrote {rel}", flush=True)

    if not all(r.get("execution_ok") and r.get("acceptance_ok") for r in records):
        return 1
    return 0


if __name__ == "__main__":
    mp.set_start_method("spawn", force=True)
    raise SystemExit(main())
