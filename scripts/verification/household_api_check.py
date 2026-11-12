from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
import urllib.error
import urllib.request
import uuid

CONTRACT = "household_analysis_v1"
UNITS = "months_of_initial_monthly_income_I0_equals_1"
TIE = 1e-8
POLL_SECONDS = 4.0

CANONICAL_P2_REQUEST = {
    "contract_version": CONTRACT,
    "income_shares": [0.0, 1.0, 0.0],
    "expense_shares": [1.0, 0.0, 0.0],
    "current_reserve_weights": [1.0, 0.0, 0.0],
    "expense_income_ratio": 0.95,
    "buffer_months": 1,
    "horizon_years": 3,
    "rebalance_frequency": "monthly",
    "conversion_cost": 0,
}
# From backend/tests/test_household_analysis_engine.py (_canonical_gate, P2 constants).
P2_CVAR = 1.1871802686857733
P2_PSHORT = 0.0491
CVAR_ATOL = 1e-6
PSHORT_ATOL = 1e-4
P2_COUNTS = (1326, 199, 1473)

UNSAFE_PATTERNS = [
    r"Traceback",
    r'File "',
    r"://",
    r"psycopg",
    r"kombu",
    r"OperationalError",
    r"Exception",
    r"/Users/",
]


def http(method: str, url: str, body: dict | None = None) -> tuple[int, dict, dict]:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Accept", "application/json")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode()
            return resp.status, dict(resp.headers), json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = {"_non_json": raw[:200]}
        return exc.code, dict(exc.headers), parsed


def assert_safe(body: dict, label: str) -> None:
    text = json.dumps(body)
    for pattern in UNSAFE_PATTERNS:
        if re.search(pattern, text):
            raise AssertionError(f"{label}: response contains unsafe text matching {pattern!r}")


def check(cond: bool, message: str) -> None:
    if not cond:
        raise AssertionError(message)


def valid_vector(v) -> bool:
    return (
        isinstance(v, list)
        and len(v) == 3
        and all(isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) and x >= 0 for x in v)
        and abs((v[0] + v[1]) + v[2] - 1.0) <= 1e-12
    )


def check_result_integrity(result: dict, request: dict | None) -> list[str]:
    """Contract integrity and internal consistency; no scientific expectations."""
    notes = []
    check(result["contract_version"] == CONTRACT, "contract_version")
    check(result["engine_interface_version"] == "personal_analysis_engine_v1", "engine interface")
    check(result["units"] == {"cumulative_shortfall": UNITS, "terminal_wealth": UNITS}, "units")
    scenario = result["scenario"]
    for key in ("income_shares", "expense_shares", "current_reserve_weights"):
        check(valid_vector(scenario[key]), f"scenario.{key}")
    if request is not None:
        expected = {k: v for k, v in request.items() if k != "contract_version"}
        check(scenario == expected, f"scenario echo differs: {scenario} != {expected}")
        notes.append("scenario echo matches the submitted request exactly")
    prov = result["provenance"]
    check(prov["simulation_paths"] == 10000 and isinstance(prov["simulation_paths"], int), "paths")
    check(prov["simulation_seed"] == 42 and isinstance(prov["simulation_seed"], int), "seed")
    check(re.fullmatch(r"[0-9a-f]{64}", prov["dataset_sha256"]) is not None, "sha256")
    check(prov["fx_path_policy"] == "single_bundle_shared_by_both_policies", "fx policy")
    cur, opt = result["current_policy"], result["optimized_policy"]
    check(cur["label"] == "current_mix_under_selected_rebalancing", "current label")
    check(opt["label"] == "lowest_cvar95_found_on_evaluated_grid", "optimized label")
    check(cur["weights"] == scenario["current_reserve_weights"], "current weights == scenario")
    check(valid_vector(opt["weights"]), "optimized weights")
    check("identification" not in cur, "identification on current policy")
    ident = opt["identification"]
    check(ident["applies_to"] == "optimization_surface", "identification scope")
    check(0 < ident["n_surface"] <= ident["n_coarse"] + ident["n_refined"], "surface counts")
    check(1 <= ident["near_optimal_1pct_count"] <= ident["n_surface"], "near-optimal count")
    check(
        abs(ident["near_optimal_1pct_frac"] - ident["near_optimal_1pct_count"] / ident["n_surface"]) <= 1e-12,
        "near-optimal fraction",
    )
    comp = result["comparison"]
    c_cvar = cur["objective"]["cvar95_cumulative_shortfall"]
    o_cvar = opt["objective"]["cvar95_cumulative_shortfall"]
    delta = comp["cvar95_optimized_minus_current"]
    check(abs(delta - (o_cvar - c_cvar)) <= 1e-15, "delta consistency")
    expected_outcome = (
        "equal_within_tolerance" if abs(delta) <= TIE else ("optimized_lower" if delta < 0 else "current_lower")
    )
    check(comp["outcome"] == expected_outcome, f"outcome {comp['outcome']} != {expected_outcome}")
    check(comp["includes_initial_switching_cost"] is False, "switching cost flag")
    check(comp["tie_absolute_tolerance"] == TIE, "tie tolerance")
    notes.append(f"outcome={comp['outcome']} delta={delta!r}")
    return notes


def poll(base: str, job_id: str, max_wait: float) -> tuple[dict, list[str], float]:
    statuses = []
    started = time.monotonic()
    while True:
        status, _headers, body = http("GET", f"{base}/api/v1/household-analysis-jobs/{job_id}/")
        check(status == 200, f"GET status {status}")
        check(body["job_id"] == job_id, "GET job id association")
        if not statuses or statuses[-1] != body["status"]:
            statuses.append(body["status"])
        if body["status"] in ("succeeded", "failed"):
            return body, statuses, time.monotonic() - started
        if time.monotonic() - started > max_wait:
            raise AssertionError(f"job {job_id} not terminal after {max_wait}s (status {body['status']})")
        time.sleep(POLL_SECONDS)


def canonical_p2(base: str, max_wait: float) -> dict:
    report: dict = {"case": "canonical-equivalent P2", "request": CANONICAL_P2_REQUEST}
    t0 = time.monotonic()
    status, _h, accepted = http("POST", f"{base}/api/v1/household-analysis-jobs/", CANONICAL_P2_REQUEST)
    report["first_post_status"] = status
    check(status in (200, 202), f"POST status {status}: {accepted}")
    job_id = accepted["job_id"]
    report["job_id"] = job_id
    if status == 202:
        body, statuses, _ = poll(base, job_id, max_wait)
    else:
        body, statuses = http("GET", f"{base}/api/v1/household-analysis-jobs/{job_id}/")[2], ["succeeded (cached)"]
    report["client_wall_seconds_submit_to_terminal"] = round(time.monotonic() - t0, 1)
    report["observed_statuses"] = statuses
    report["server_timestamps"] = {k: body.get(k) for k in ("created_at", "started_at", "completed_at")}
    check(body["status"] == "succeeded", f"job failed: {body.get('error_code')}")
    result = body["result"]
    report["integrity"] = check_result_integrity(result, CANONICAL_P2_REQUEST)

    cur, opt = result["current_policy"], result["optimized_policy"]
    o_cvar = opt["objective"]["cvar95_cumulative_shortfall"]
    o_pshort = opt["diagnostics"]["shortfall_probability"]
    ident = opt["identification"]
    canonical = {
        "optimized_weights": opt["weights"],
        "optimized_weights_ok": all(abs(a - b) <= 1e-12 for a, b in zip(opt["weights"], [1.0, 0.0, 0.0])),
        "cvar95": o_cvar,
        "cvar95_abs_diff": abs(o_cvar - P2_CVAR),
        "cvar95_ok": abs(o_cvar - P2_CVAR) <= CVAR_ATOL,
        "shortfall_probability": o_pshort,
        "shortfall_probability_ok": abs(o_pshort - P2_PSHORT) <= PSHORT_ATOL,
        "identification_class": ident["identification_class"],
        "identification_ok": ident["identification_class"] == "A_WELL_IDENTIFIED",
        "grid_counts": [ident["n_coarse"], ident["n_refined"], ident["n_surface"]],
        "grid_counts_ok": (ident["n_coarse"], ident["n_refined"], ident["n_surface"]) == P2_COUNTS,
        "current_equals_optimized_objective": cur["objective"] == opt["objective"],
        "current_equals_optimized_diagnostics": cur["diagnostics"] == opt["diagnostics"],
        "current_equals_optimized_implementation_only": cur["implementation_only"] == opt["implementation_only"],
        "outcome": result["comparison"]["outcome"],
        "outcome_ok": result["comparison"]["outcome"] == "equal_within_tolerance",
    }
    report["canonical"] = canonical
    report["provenance"] = result["provenance"]
    failed = [k for k, v in canonical.items() if k.endswith("_ok") and v is not True]
    failed += [k for k in canonical if k.startswith("current_equals") and canonical[k] is not True]
    check(not failed, f"canonical checks failed: {failed}")

    status, _h, again = http("POST", f"{base}/api/v1/household-analysis-jobs/", CANONICAL_P2_REQUEST)
    report["resubmit"] = {"status": status, "cached": again.get("cached"), "job_id": again.get("job_id")}
    check(status == 200 and again.get("cached") is True and again.get("job_id") == job_id, "cached reuse")
    check(again["result"] == result, "cached result identical")
    return report


def errors(base: str) -> dict:
    url = f"{base}/api/v1/household-analysis-jobs/"
    report = {}

    invalid = dict(CANONICAL_P2_REQUEST, income_shares=[0.5, 0.5])
    status, _h, body = http("POST", url, invalid)
    assert_safe(body, "400")
    check(status == 400 and body["error"]["code"] == "validation_error", f"400: {status} {body}")
    error = body["error"]
    report["invalid_vector"] = {"status": status, "code": error["code"], "details": error.get("details")}

    zero = dict(CANONICAL_P2_REQUEST, current_reserve_weights=None, buffer_months=0)
    status, _h, body = http("POST", url, zero)
    assert_safe(body, "422 zero reserve")
    check(status == 422 and body["error"]["code"] == "unsupported_scenario", f"422: {status} {body}")
    error = body["error"]
    report["zero_reserve"] = {"status": status, "reasons": error["reasons"], "message": error["message"]}

    ratio = dict(CANONICAL_P2_REQUEST, expense_income_ratio=0.5)
    status, _h, body = http("POST", url, ratio)
    assert_safe(body, "422 ratio")
    check(status == 422, f"422 ratio: {status}")
    report["ratio_out_of_range"] = {"status": status, "reasons": body["error"]["reasons"]}

    unknown = str(uuid.uuid4())
    status, _h, body = http("GET", f"{url}{unknown}/")
    assert_safe(body, "404")
    check(status == 404 and body["error"]["code"] == "not_found", f"404: {status} {body}")
    report["unknown_job"] = {"status": status, "body": body}
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["canonical-p2", "errors", "job"])
    parser.add_argument("--base-url", default="http://127.0.0.1:58000")
    parser.add_argument("--job-id")
    parser.add_argument("--request-json", help="submitted request, to verify the scenario echo")
    parser.add_argument("--max-wait", type=float, default=900.0)
    parser.add_argument("--out")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    try:
        if args.command == "canonical-p2":
            report = canonical_p2(base, args.max_wait)
        elif args.command == "errors":
            report = errors(base)
        else:
            status, _h, body = http("GET", f"{base}/api/v1/household-analysis-jobs/{args.job_id}/")
            check(status == 200 and body["status"] == "succeeded", f"job not succeeded: {status}")
            request = json.loads(open(args.request_json).read()) if args.request_json else None
            report = {
                "job_id": args.job_id,
                "server_timestamps": {k: body.get(k) for k in ("created_at", "started_at", "completed_at")},
                "integrity": check_result_integrity(body["result"], request),
                "result": body["result"],
            }
        ok = True
    except AssertionError as exc:
        report = {"error": str(exc)}
        ok = False
    text = json.dumps(report, indent=2, sort_keys=True)
    if args.out:
        with open(args.out, "w") as fh:
            fh.write(text)
    print(text)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
