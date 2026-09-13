# Resilience Score & Emergency-Buffer Methodology — Product Research Phase 3A

Status: **Specification / scientific-feasibility phase (no implementation).**
Scope: determine whether Currency Safety Net can scientifically support (a) a scalar
"Resilience Score" and (b) an "emergency-fund size recommendation," and define the
safe product surface that can be built inside the current published evidence base.

This document distinguishes three categories throughout:

- **[PUBLISHED]** — methodology and results in the peer-style manuscript
  (`manuscript.pdf`, Ashkeyev, *Currency Allocation of Household Liquid Savings…*).
  Publication link: *[placeholder — insert stable citation / DOI / repository URL when available]*.
- **[IMPLEMENTATION]** — behavior present in the shipped code/API but **not**
  part of the published methodology.
- **[PROPOSED]** — product methodology proposed here. Never presented as research.

> Manuscript access note: the manuscript PDF was provided to this analysis and
> read in full. Page/section/equation citations below refer to it. All engine
> behavior was cross-checked against the source under `backend/research_engine/`.
> No restricted artifact was modified (see §15).

The proposed product uses **published model outputs where available**, and
**separately labeled implementation-only diagnostics where useful**. Those two
layers must never be blended into an unpublished composite "research" score.

---

## 1. Executive decision

**Q1 — Scalar "Resilience Score" supportable now?** **No.** A single 0–100 scalar
is **not** scientifically defensible on the current model. Every scalar construction
requires either (a) arbitrary normalization constants with no empirical or normative
basis in the study, or (b) collapsing two axes — shortfall **frequency** and tail
**severity** — that the study deliberately keeps separate, that have incompatible
units/scales, and for which the manuscript publishes **no** normalization or
weighting rule (see §6). The published objective is a single measure (CVaR95) whose
scale is horizon- and profile-dependent and therefore not a bounded score.

**Q2 — "Recommended emergency-fund size" supportable now?** **No, not as an
optimum.** The model **optimizes currency allocation conditional on a fixed buffer**;
it does **not** optimize buffer size (manuscript §III-E, eq (10); §III-F). Because the
model assigns **no** opportunity cost, interest, inflation, or liquidity penalty to
holding cash (manuscript §III-F; `backend/research_engine/household/settlement.py`),
there is **no interior trade-off** that would identify an "optimal" buffer. Structurally,
enlarging the buffer can only improve (or leave unchanged) shortfall-risk metrics,
so an "optimal buffer" heuristic collapses toward the **largest permitted buffer** —
not because that size is scientifically preferred, but because the model never prices
holding cash. The research baseline `B = 1` month is a **primary specification**,
explicitly **not** a recommendation (manuscript §III-F).

**Q3 — Product surface inside the evidence base (implementation sequencing):**

| Feature | Scientific status | Technical status |
|---|---|---|
| **Resilience Profile** | Supportable now | **Implementable immediately** from an existing successful optimization result (no new job type) |
| **Buffer Sensitivity Explorer** | Scientifically supportable on documented buffers `{1,3,6,12}` | **Blocked** until the Phase 3B server-side batch contract is designed and benchmarked (§10, §13) |
| **Minimum tested buffer meeting a user-selected diagnostic target** | Scientifically supportable with user-target framing | **Depends on the same batch result**; not immediately implementable; not shippable before Phase 3B |

Do **not** treat all three as equally ready for engineering. Only the Resilience Profile
can ship from current single-job API responses.

**Q4 — Requires research extension / expert judgment / user target / pilot:**
scalar Resilience Score (new research + normative calibration + user pilot);
utility/cost-based *recommended* buffer (research extension D: needs interest,
inflation, liquidity-cost, risk-tolerance inputs and data); externally-defined
policy buffer targets (expert/regulatory evidence); any composite weighting.

**Q5 — Safe interim release (before Phase 3B):** ship the **Resilience Profile** only,
using neutral language ("resilience profile," "simulated coverage rate,"
"model-returned allocation," "scenario next steps"). Buffer sensitivity and the
minimum-tested-buffer finder remain specified product directions that wait on the
Phase 3B batch prerequisite. No scalar score, no word "recommended/recommendation,"
no "advice/forecast/guarantee," no "safe/sufficient/optimal buffer."

**Safest overall product direction (§9):** **Resilience Profile + Buffer Sensitivity
Explorer** (with the user-target buffer finder as a dependent diagnostic on the same
batch outputs). The profile remains multi-metric and can lead; the explorer follows
after Phase 3B. **CVaR95 stays the sole optimization objective.** Other outputs remain
diagnostics and must not be combined into an unpublished score. This direction creates
clear user value — helping users understand allocation sensitivity, tail shortfall, and
the effect of **tested** liquidity buffers — while using published engine outputs where
available and labeled implementation-only diagnostics where useful. Rejecting a
scalar score does **not** make the product less useful; it keeps the product honest
about what the model can and cannot support.

**Phase 3B prerequisite (§13):**  
`Design the batch buffer-sensitivity contract and benchmark it before building the UI.`

---

## 2. Existing evidence base

### 2.1 What the model optimizes  [PUBLISHED]
Minimize the 95% Conditional Value-at-Risk of **cumulative uncovered expenditure**
over the 3-currency simplex:

- Objective: `w* = argmin_{w ∈ Δ²} CVaR_0.95(L(w))` — manuscript §III-E, eq (10);
  code `backend/research_engine/robustness/optimize.py::optimize_cell` +
  `optimization/near_optimal.py::pick_argmin`.
- Single objective. CVaR95 is the **primary** criterion; `P(L>0)` and `VaR95` are
  reported as **diagnostics**, not optimized (manuscript §III-D, §IV-E).
- Deterministic grid search: 2 pp coarse + 1 pp local refinement (manuscript §III-E;
  code `optimization/grid.py`, `config.ROB_COARSE_STEP_BP=200`, `ROB_REFINED_STEP_BP=100`).

### 2.2 Inputs (variables)  [PUBLISHED design / [IMPLEMENTATION] ranges]
Household calibration and scenario controls (manuscript §III-C, §III-F):

| Input | Published values | Product API accepts | Source |
|---|---|---|---|
| Profile | P1–P4 (Table I) | P1–P4 aliases | `api.PROFILE_ALIASES`, `household/profiles.py` |
| Horizon (years) | {1, 3, 5} | {1, 3, 5} | `config.HH_HORIZON_YEARS` |
| `η = E/I` (expense-income ratio) | {0.80, 0.95, 1.05} | **continuous [0.80, 1.05]** | `serializers.py`, `api._validate_expense_income_ratio` |
| `B` (buffer months) | {1, 3, 6, 12} | **continuous [1, 12]** | `serializers.py`, `api._validate_buffer_months` |
| Rebalance frequency | {monthly, quarterly, none} | same | `config.ROB_REBALANCE_FREQS` |
| Conversion cost | {0, 0.25%, 0.50%, 1.00%} | **continuous [0, 0.01]** | `config.ROB_CONVERSION_COSTS` |
| Paths / seed | 10,000 / 42 (fixed) | fixed, **forbidden** as client fields | `api.PRODUCTION_N_PATHS/SEED`, `serializers.FORBIDDEN_CLIENT_FIELDS` |

> **Boundary caveat:** the API accepts *continuous* `η`, `B`, and `conversion_cost`
> inside the published *endpoints*, but the study reported only the **discrete** grid
> values above. Off-grid values that the engine accepts are **direct model evaluations**
> of those inputs: the optimizer/evaluator runs on the submitted numbers. They are
> **not** interpolations of published grid results, and they are **not** validations
> published in the manuscript. Any buffer feature in this product phase therefore
> operates only on the **documented** buffer set `{1, 3, 6, 12}`
> (`public_options().buffer_months.documented_values`).

### 2.3 Outputs (quantities)
Returned by `api._evaluation_payload` (+ optimize-only fields).

**[PUBLISHED] scientific outputs (manuscript-supported quantities / methodology)**
- `cvar95_cumulative_shortfall` — CVaR95 of `L` (manuscript §III-D eq (9)).
- `var95_cumulative_shortfall` — VaR95 of `L` (manuscript §III-D, §IV-E).
- `shortfall_probability` = `P(L>0)` (manuscript §III-D).
- `weights` (optimum) (manuscript §III-E; Table IV).
- Identification **methodology** and class labels (`identification_class`) as defined in
  the manuscript (§III-E) and implemented in code.

**[IMPLEMENTATION] provenance fields — document model/data configuration; not published
scientific quantities themselves**
- `model_version`, `data_as_of`, `dataset_sha256` (where exposed),
  `simulation_paths`, `simulation_seed`, and echoed request inputs.
- These API fields record *which* configuration produced a result. They must not be
  described as published scientific findings of the manuscript.

**[IMPLEMENTATION] convenience fields tied to published identification methodology**
- `near_optimal_1pct_frac` / `near_optimal_1pct_count` — implementation-returned
  summaries that support displaying the published identification framework. Treat the
  underlying identification method as [PUBLISHED]; treat these numeric convenience
  fields as implementation packaging, not as standalone manuscript tables.

**[IMPLEMENTATION] diagnostics — absent from the published manuscript**
- `mean_cumulative_shortfall` (mean of `L`).
- `wealth_depletion_probability` — `P(terminal_wealth ≤ 1e-10)`.
- `mean_terminal_wealth`, `median_terminal_wealth`, `p05_terminal_wealth`,
  `p95_terminal_wealth`.

These terminal-wealth and depletion fields are **code-level diagnostics** in
`household/risk_metrics.py::summarize_run`. They may be useful in the product **only**
when labeled as implementation-only. They are **not** published evidence and must
**not** be cited as manuscript results or folded into an unpublished score.

**Not currently available from the public API as a currency-weight range**
- A "near-optimal KZT range" (min/max KZT weight among near-optimal allocations) is
  **not** an immediately available UI output. The public API exposes near-optimal
  **count/fraction** and `identification_class`, but **not** a currency-weight range.
  Any such range is a **future backend-derived feature** that would need its own
  definition, provenance fields, and tests before UI use.

### 2.4 How key quantities are defined
- **Initial buffer**  [PUBLISHED]: `W0 = B · E0`, `E0 = η · I0`, `I0 = 1`
  (manuscript eqs (4)–(5); code `optimization/evaluator.py::primary_cashflows`,
  `robustness/optimize.py::make_cashflows`). Units: **months of initial monthly income**.
- **Shortfall / normalization**  [PUBLISHED]: monthly uncovered expenditure
  `U_t = max(G_t − W_t, 0)` (eq (7)); path loss `L_s = Σ_t U_{t,s}` (eq (8)). Income
  is normalized to `I0 = 1`, so **all shortfall and CVaR values are in units of one
  month of initial income** (manuscript §III-C; code `household/settlement.py`,
  `risk_metrics.cumulative_shortfall`).
- **CVaR95 & VaR95**  [PUBLISHED]: order statistics over the `K = ⌈0.05·N⌉ = 500`
  largest path losses (descending sort). `CVaR95 = mean(top 500)`;
  `VaR95 = 500th-largest loss` (eq (9); code `risk_metrics.empirical_cvar/empirical_var`,
  `_tail_k`). No kernel smoothing; the point mass at zero is handled by the order
  statistic.
  - **If `P(L > 0) = 0` for all simulated paths**, then every path loss is zero, so
    **cumulative-shortfall VaR95, CVaR95, and mean shortfall are also zero.** There are
    **no** differing shortfall tails in that case.
  - **If some paths have positive loss but fewer than 500**, `VaR95` can be `0` while
    `CVaR95 > 0` (manuscript §IV-E, Fig 7). That is a property of the order-statistic
    definition when the positive-loss mass is thinner than the 5% tail window — **not**
    a claim about zero-shortfall cells.
  - Terminal-wealth outcomes can still differ across paths even when cumulative shortfall
    is everywhere zero; any such comparison is an **implementation-only diagnostic**,
    not a published shortfall-tail result.
- **Shortfall probability**  [PUBLISHED]: `mean(L > 0)` (code `summarize_run`).
- **Terminal buffer-depletion probability**  [IMPLEMENTATION only]:
  `mean(terminal_wealth ≤ 1e-10)` (code `summarize_run`, `config.HH_WEALTH_DEPLETE_TOL`).
  Not equal to shortfall probability (a path can record a mid-horizon shortfall yet
  end with positive wealth), so the two must not be conflated. **Not in the manuscript.**
- **Identification class**  [PUBLISHED]: heuristic describing how concentrated the
  near-optimal set is. With `f₁%` = fraction of evaluated allocations within 1% of the
  minimum CVaR: **A_WELL_IDENTIFIED** `f₁% ≤ 0.05` (and CVaR* > 1e-8);
  **C_NOT_IDENTIFIED** `f₁% ≥ 0.50` (or CVaR*≈0 with ≥50% within the 5% band);
  **B_WEAKLY_IDENTIFIED** otherwise (manuscript §III-E; code
  `optimization/near_optimal.py::classify_identification`,
  `config.OPT_WELL_IDENTIFIED_MAX_FRAC=0.05`, `OPT_NOT_IDENTIFIED_MIN_FRAC=0.50`). It
  is a **surface-geometry** label about *weight identifiability*. It is **not** a risk
  metric and **not** a measure of household safety.

### 2.5 Parameters evaluated in the published research  [PUBLISHED]
Profiles P1–P4; horizons {1,3,5}; `η ∈ {0.80,0.95,1.05}`; `B ∈ {1,3,6,12}`;
baseline DGP SB20 (block 20); robustness DGPs SB10/SB56/IID; recent 2020–2025 window;
rebalancing {monthly, quarterly, none}; conversion costs {0, 0.25%, 0.50%, 1.00%};
`N=10,000`, `seed=42` (manuscript §III-F, §IV-D, Table IV, Figs 5–6).

### 2.6 Headline published results (Table IV, 3-year)  [PUBLISHED]
All FX-exposed optima at the all-KZT vertex; `VaR95 = 0` in the 3-year cells:

| Profile | CVaR95 | P(sf.) | Identification |
|---|---:|---:|---|
| P2 (USD→KZT) | 1.1872 | 4.91% | Well |
| P4 (multi) | 0.5083 | 2.83% | Well |
| P3 (mixed) | 0.0613 | 0.47% | Well |
| P1 (control) | 0.0000 | 0.00% | Not identified |

The **robust** finding is the *expense-matching mechanism/ranking*, **not** a
universal "100% KZT" rule (manuscript Abstract; §IV-B; §V-B; §VI).

For P1 in this published cell, `P(L>0) = 0`, so cumulative-shortfall VaR, CVaR, and
mean shortfall are likewise zero. That is **not** a case of "identical coverage with
differing shortfall tails."

---

## 3. Current model boundaries

Explicit limits that constrain any Resilience/Buffer feature (manuscript §III-F, §V-D):

1. **Buffer is an input, not an optimization variable.** Only `w` is optimized.
2. **No opportunity cost of cash.** No interest income, inflation, deposit yield,
   liquidity preference, or holding penalty (manuscript §III-F; `settlement.py` has
   no such term). → shortfall-risk metrics are weakly monotone non-increasing in `B` →
   an "optimal buffer" is not identified by the model and, as a naïve rule, trends
   toward the largest permitted buffer.
3. **Loss = uncovered *expenditure*,** not portfolio return; foreign holdings get no
   expected return or inflation hedge (§III-F, §V-A).
4. **Synthetic profiles.** P1–P4 are controlled scenarios, not population estimates
   (§V-D). No microdata, wage adjustment, borrowing, or behavior.
5. **Scale is context-specific.** CVaR/shortfall are in months-of-income and grow with
   horizon and with `η`; they are **not** bounded and **not** comparable across
   horizons/profiles without an (unpublished) normalization.
6. **Identification is fragile when CVaR* is near zero.** When the minimized CVaR is
   approximately zero (for example some large-buffer or low-risk cells), the optimum can
   be *not identified* — many allocations share essentially the same objective value.
   Identification is about the allocation surface, **not** a separate risk metric.
7. **Deterministic, seed-locked.** Fixed seed 42, 10,000 paths → reproducible, but
   results are conditional on the dataset version (`data_as_of`, `dataset_sha256`).
   Data updates can change model outputs, even when the user inputs remain unchanged.

---

## 4. Resilience Score candidate analysis

For each candidate: definition, and the score properties required by the brief
(range/units, direction, behavior at zero and extreme shortfall, monotonicity,
noise/horizon/profile/seed/dataset sensitivity, comparability, explainability,
false-precision & advice risk, compatibility with the published model).

### A. Shortfall-free-path percentage — `coverage = 100·(1 − P(L>0))`
- **Definition/range/units:** 0–100, unitless; higher = "more paths fully funded."
- **Interpretability:** high; "share of simulated scenarios with no shortfall."
- **Loss of severity information:** **severe.** It ignores CVaR entirely.
- **`VaR95 = 0` but `CVaR95 > 0`:** exactly the regime where coverage is *most*
  misleading among cells that still have some positive-loss paths. The manuscript
  itself stresses this order-statistic regime (§IV-E, Fig 7). Example from the
  published 3-year P2 cell: coverage ≈ **95.09** while `CVaR95 ≈ 1.187` months of
  income — frequent funding does not imply a thin tail.
- **Zero-shortfall cells:** if `P(L>0) = 0`, coverage is 100 **and** cumulative-shortfall
  VaR, CVaR, and mean shortfall are also zero. Do **not** describe those cells as having
  "differing shortfall tails." Any remaining differences in terminal wealth belong to
  **implementation-only** diagnostics.
- **Monotonicity/stability:** monotone in buffer under the model's missing cost term;
  across horizons/profiles it can disagree with severity rankings (see §6).
- **"Resilience" naming:** **overstates**. It measures *frequency of full funding*, not
  resilience to severe events. Calling it resilience implies tail safety it does not test.
- **Verdict:** usable **only** as a transparent, precisely-named diagnostic
  ("simulated coverage rate"), **never** as *the* resilience score.

### B. CVaR-based 0–100 transformation
Any map `CVaR95 → [0,100]` (e.g. `100·exp(−CVaR/s)` or `100·(1 − min(CVaR/cap,1))`).
Required **arbitrary** choices, none justified by the study:
- **scale `s`** (units of months-of-income) — no published value.
- **cap / reference `CVaR_ref`** — the study reports no "acceptable" or "max" CVaR.
- **horizon adjustment** — CVaR grows with horizon in the published cells (e.g. P2
  Table IV / related horizon results); without adjustment the score punishes longer
  horizons.
- **profile adjustment** — CVaR levels differ sharply across profiles at fixed inputs.
- **nonlinear transform shape** — unconstrained by any normative anchor.
- **zero/extreme handling** — CVaR can be exactly 0 (→100) or arbitrarily large.
- **Verdict:** every constant is a normative/empirical free parameter absent from the
  research. Not defensible now; would manufacture false precision.

### C. Composite score (CVaR95 + P(L>0) + depletion prob + …)
- Requires **weights and thresholds** that are **normative**, not learned in the study
  (the study optimizes CVaR alone).
- **Conflicts with the published single-objective methodology** (eq (10)): a composite
  silently re-defines the objective the paper validated.
- Would lean on `wealth_depletion_probability` and/or terminal-wealth quantiles —
  **[IMPLEMENTATION] only**, absent from the manuscript — combining published and
  unpublished quantities into one "research" number.
- Frequency and severity components can move in opposite directions (§6), so the weighted
  sum's meaning changes case-by-case.
- **Verdict:** not now; would misrepresent the research and hide conflicts.

### D. Reference-distribution percentile
Score a scenario vs. a predefined reference grid or reference household population.
- Requires a **reference population** (profile mix, `η`/`B` distribution, horizon
  weighting) — **undefined** in the study and inherently normative.
- **Data-version dependence:** percentiles shift whenever `fx_daily_*` updates
  (`data_as_of`, `dataset_sha256`); a household's score could change with no change to
  its inputs → confusing and hard to defend.
- **Recalibration:** every dataset/model-version bump needs re-derivation and
  re-communication; breaks cross-version comparability.
- **Verdict:** research + governance project, not an interim feature.

### E. No scalar — transparent multi-metric "resilience profile"  ← recommended
Present the axes the study already validates, side by side, each labeled:
- **frequency:** simulated coverage rate `100·(1−P(L>0))` (or `P(L>0)`) — [PUBLISHED],
- **worst-tail severity:** `CVaR95` (months of income) with plain framing — [PUBLISHED],
- **end-of-horizon depletion:** `wealth_depletion_probability` — **[IMPLEMENTATION] only**,
  labeled as such if shown,
- **allocation identification/stability:** `identification_class` ([PUBLISHED]
  methodology) plus near-optimal **count/fraction** from the public API
  ([IMPLEMENTATION] convenience fields supporting that methodology). Do **not** show a
  near-optimal KZT weight range until a future backend-derived field defines and tests it.
- **Scientifically safer:** uses existing outputs, adds **no** unpublished normalization,
  and **shows** the frequency/severity distinction the paper stresses (§IV-E, Fig 7)
  instead of hiding it. Higher information, lower false-precision and advice risk.
- **Verdict:** **scientifically and technically implementable immediately** from an
  existing successful result (with careful naming and labeling). This is the recommended
  profile surface and the only Q3 feature that can ship before Phase 3B.

**Score-property summary**

| Property | A coverage | B CVaR-map | C composite | D percentile | E profile |
|---|---|---|---|---|---|
| Bounded 0–100 | ✅ | ✅ (arb.) | ✅ (arb.) | ✅ | n/a (multi) |
| Higher = better | ✅ | ✅ | ✅ | ✅ | per-metric |
| Keeps severity | ❌ | ✅ | partial | partial | ✅ |
| No arbitrary constants | ✅ | ❌ | ❌ | ❌ | ✅ |
| Horizon-comparable | ❌ | ❌ | ❌ | ❌ | shown, not hidden |
| Profile-comparable | ❌ | ❌ | ❌ | ❌ | shown, not hidden |
| Dataset-version stable meaning | ✅ | ✅ | ✅ | ❌ | ✅ |
| Matches published objective | partial | partial | ❌ | ❌ | ✅ |
| Low false-precision risk | ✅ | ❌ | ❌ | ❌ | ✅ |
| Low advice-implication risk | medium | ❌ | ❌ | ❌ | ✅ |

---

## 5. Buffer recommendation candidate analysis

**Central structural issue (confirmed).** The model has **no** opportunity cost, interest,
inflation, liquidity cost, or penalty for a larger buffer (manuscript §III-F;
`settlement.py`). Therefore shortfall-risk metrics are **weakly monotonically
non-increasing** in `B`, and an **"optimal" or "recommended" buffer is not identified**
by the research model. The research baseline `B=1` is a *primary specification*, **not**
an optimum; it must **never** be presented as a "recommended," "safe," or "sufficient"
buffer.

**Separate layers (do not conflate):**
1. **Structural argument** — missing cost of holding cash ⇒ no interior optimum for `B`.
2. **Exploratory named cases** — optional engineering checks on specific documented
   combinations; not manuscript validation unless reproduced as such.
3. **Identification behavior** — when minimized CVaR is near zero, many weights can look
   equally good; that is about the allocation surface, **not** a risk metric and **not**
   proof that `B=12` is universally special.

**Illustrative published anchor (Table IV, 3-year, baseline buffer `B=1`):** P2 and P4
report positive CVaR95 with well-identified all-KZT optima. That published evidence does
**not** by itself establish outcomes at `B=12`.

**Scoped exploratory note (not manuscript validation):** In separately run optimize
checks that used the production engine with `N=10,000`, `seed=42`, horizon **3 years**,
baseline-style household settings, and documented buffers for **profiles P2 and P4 only**,
shortfall metrics fell as `B` increased through `{1, 3, 6, 12}`, and **for those named
P2/P4 3-year cases** the `B=12` runs reached approximately zero CVaR with identification
flipping toward **C_NOT_IDENTIFIED**. Those observations are **exploratory and
case-scoped**. They must **not** be generalized as "`B=12` always yields zero CVaR" or
"`B=12` always yields `C_NOT_IDENTIFIED`" across all profiles, horizons, `η`, rebalancing
rules, or conversion costs.

Naïvely "recommending the max buffer" would therefore (a) be a trivial artifact of the
missing cost term and (b), in large-buffer cells where CVaR*≈0, can leave the allocation
result poorly identified — undermining the product's allocation question.

### A. Buffer sensitivity explorer  ← supportable after Phase 3B batch design
Show model outcomes across documented buffers `{1,3,6,12}` with **no** selected value.
- Uses published outputs where available; labels implementation-only diagnostics if shown;
  transparent; honest about monotonicity.
- **Verdict:** product direction yes; **UI only after** the engineering-feasibility work
  in §10 and the Phase 3B batch contract/benchmark in §13.

### B. Minimum tested buffer meeting a user-selected diagnostic target  ← after Phase 3B batch
Product term (required wording):

> **minimum tested buffer meeting a user-selected diagnostic target**

Return the smallest documented `B ∈ {1,3,6,12}` whose model output satisfies a
threshold the **user** picks (for example a maximum `P(L>0)` or maximum `CVaR95`;
if depletion is offered, it must be labeled [IMPLEMENTATION]).

Hard constraints:
- use **only** documented buffer values `{1, 3, 6, 12}`;
- require the user to choose the target **explicitly**;
- show when **none** of the tested values meets the target;
- **never** extrapolate between tested values;
- **never** call the result optimal, recommended, required, safe, or sufficient;
- **never** provide individualized financial advice;
- treat off-grid continuous `B` values accepted by the API as out of scope for this
  feature (direct evaluations, not manuscript-validated grid points).

**Verdict:** scientifically supportable as a diagnostic finder with the framing above —
**not** as advice, and **not** immediately implementable. It **depends on the same
server-side batch / sensitivity result** as the Buffer Sensitivity Explorer and must
wait on Phase 3B (§10, §13). Do not ship it from four independent browser submissions.

### C. Minimum tested buffer meeting an **externally-defined policy** target
- Requires financial/regulatory/expert evidence to set the threshold (e.g. "3–6 months
  of expenses" norms). The study provides **no** such target.
- **Verdict:** needs expert/normative sourcing before use; not from this research.

### D. Utility/cost-based buffer optimization  ← research extension (do not implement)
To make buffer size a genuine trade-off, the model must add terms it currently lacks:
deposit yield/interest, inflation, liquidity cost of holding cash, transaction/liquidity
frictions, and a household risk-tolerance/utility function — plus data to calibrate them.
- **Verdict:** new research question (§11). Do not implement in this phase.

---

## 6. Conceptual and methodological checks (not new manuscript findings)

This section records **product-methodology** reasons for rejecting a scalar score and
an "optimal buffer." It is **not** a substitute for manuscript tables. Aggregate
exploratory cell-counts from ad-hoc sweeps are **nonessential** and are **not** used
as headline evidence here.

1. **Agreement with published optima.** Production optimize gates match Table IV for the
   canonical cells (including P2/P4 3-year CVaR gates). Product analysis rests on that
   validated engine behavior.

2. **`VaR95 = 0` while `CVaR95 > 0` among positive-loss cells.** This order-statistic
   regime is discussed in the manuscript (§IV-E, Fig 7). Coverage/frequency alone is then
   especially incomplete. This is **not** the same statement as zero-shortfall cells
   (where VaR, CVaR, and mean shortfall are all zero).

3. **Frequency vs severity are different axes.** They have different meanings and
   incompatible scales; the manuscript publishes **no** rule for normalizing or weighting
   them into one number. Conceptually, a high-frequency / lower-severity shortfall pattern
   can rank opposite a low-frequency / higher-severity pattern. A scalar would have to pick
   a side without scientific warrant. Published Table IV already shows that profiles with
   lower shortfall frequency are not automatically the ones with lower CVaR ranking once
   severity is considered — reinforcing a **multi-metric** display rather than a single
   score.

4. **Budget-deficit vs FX-mismatch confounding.** When `η > 1`, shortfalls can reflect a
   structural expense/income gap rather than currency mismatch. A scalar "resilience"
   number would also conflate those economically distinct mechanisms.

5. **Horizon / profile scale non-comparability.** CVaR is in months of income and grows
   with horizon and profile exposure. Any fixed CVaR→score map is therefore
   context-dependent unless an unpublished normalization is invented.

6. **Buffer monotonicity (structural).** With no holding cost for cash, enlarging `B`
   cannot worsen shortfall metrics. That structural fact — not an aggregate sweep count —
   is why "optimal buffer" is ill-posed.

7. **Identification ≠ risk.** Near-zero CVaR can widen the near-optimal set. Report
   identification as surface geometry when relevant; do not treat it as a safety score.

8. **Depletion ≠ shortfall** ([IMPLEMENTATION] vs [PUBLISHED]). Terminal depletion and
   terminal-wealth quantiles can differ from `P(L>0)` and must be shown separately if at
   all, never summed into a research score.

9. **Compute cost (engineering, not science).** One full optimize is on the order of
   tens of seconds at 10k paths. A four-buffer explorer that re-optimizes four times is
   four heavy jobs unless a batch design reuses work carefully (see §10).

---

## 7. Terminology decision

| Term (challenge concept) | Classification | Safer alternative |
|---|---|---|
| "resilience score" (scalar) | **Should not be used** (now) | "resilience profile" (multi-metric) |
| "recommended emergency-fund size" | **Should not be used** | "buffer sensitivity"; "minimum tested buffer meeting a user-selected diagnostic target" |
| "optimal buffer" / "safe buffer" / "sufficient buffer" | **Should not be used** | tested buffer values; user-selected diagnostic target |
| "personalized recommendation" | **Should not be used** | "scenario result for your inputs"; "model-returned allocation" |
| "action plan" | **Requires careful renaming** | "scenario next steps" (neutral: compare buffers, read methodology) |
| "simulated coverage rate" | **Supported now** (precise name) | keep; define as `100·(1−P(L>0))` |
| "resilience profile" | **Implementable immediately** (careful labeling) | keep; bundle of labeled metrics from an existing successful result |
| "buffer sensitivity" | **Scientifically supportable; blocked on Phase 3B batch** | keep |
| "minimum tested buffer meeting a user-selected diagnostic target" | **Scientifically supportable; depends on Phase 3B batch** | keep, with user-target framing |
| "model-returned allocation" | **Supported now** | keep (already used in copy) |
| "near-optimal KZT range" | **Not available now** | future backend-derived field only |

Consistency note: existing copy already forbids "advice/forecast/guarantee/
recommendation" (`frontend/src/app/core/i18n/en.ts`). Introducing
"recommended/recommendation," "optimal/safe buffer," or a scalar "score" would
**contradict** the product's own guardrails and the manuscript's "not a universal
recommendation" framing (Abstract; §V-A/B). Do not weaken the product, but do not claim
unearned support.

---

## 8. Product decision table

| Feature | Go now (single-job API) | After Phase 3B batch contract | Research required | Do not implement now; research and validation are required before reconsideration |
|---|:--:|:--:|:--:|:--:|
| Scalar Resilience Score | | | ✅ | ✅ |
| Resilience profile | ✅ | | | |
| Buffer sensitivity explorer | | ✅ | | |
| Recommended / optimal buffer | | | ✅ (extension D) | ✅ |
| User-target buffer finder ("minimum tested buffer meeting a user-selected diagnostic target") | | ✅ (same batch outputs) | | |
| Personalized action plan → "scenario next steps" | ✅ (wording only) | | | ✅ (as "advice") |

**Justification.**
- *Scalar score:* fails §4/§6 (arbitrary constants; incompatible frequency/severity axes;
  no published normalization; horizon/profile scale; VaR=0-with-positive-CVaR regime).
  **Do not implement now; research and validation are required before reconsideration.**
- *Resilience profile:* scientifically and technically ready **now** from an existing
  successful result; published outputs where available, plus clearly labeled
  implementation-only diagnostics if shown; no new science; surfaces the paper's own
  frequency/severity distinction.
- *Buffer sensitivity explorer:* scientifically supportable over documented buffers;
  honest about monotonicity; no selected value ⇒ no advice; **blocked** on engineering
  batch design (§10, §13) before UI.
- *Recommended/optimal buffer:* ill-posed without a cost term (§5); the words imply advice.
  **Do not implement now; research and validation are required before reconsideration.**
- *User-target buffer finder:* scientifically supportable **iff** the threshold is the
  user's, language is explicit, search is restricted to `{1,3,6,12}`, and non-attainment
  is shown without extrapolation — and **only after** the same Phase 3B batch result exists.
  It is **not** immediately implementable.
- *Action plan:* becomes safe only as neutral "scenario next steps" with no
  directive/advice language.

---

## 9. Recommended next feature

**Resilience Profile + Buffer Sensitivity Explorer (combined transparent direction).**

**Implementation sequence:**
1. **Now:** Resilience Profile on an existing successful single-job result.
2. **After Phase 3B:** Buffer Sensitivity Explorer (documented buffers via server-side batch).
3. **After the same batch:** minimum tested buffer meeting a user-selected diagnostic
   target (derived from batch outputs; not a separate four-POST fan-out).

- **User value:** answers two real questions — "how does my modeled risk change across
  the **tested** buffers?" and "how often vs. how badly could I fall short?" — without a
  number that overclaims. Shipping the profile first already delivers part of that value;
  the explorer extends it after the batch prerequisite. Rejecting a scalar score does not
  make the product less useful.
- **Profile:** multi-metric only. **CVaR95 remains the sole optimization objective.**
  Frequency, identification, and any implementation-only diagnostics stay diagnostic and
  are not combined into an unpublished score.
- **Explorer inputs:** the scenario's existing inputs; buffer varied over documented
  `{1,3,6,12}` via the Phase 3B batch contract — not via immediate UI fan-out.
- **Outputs shown:** profile panel from the current result (frequency / tail severity /
  separately labeled depletion / identification + near-optimal count/fraction). After
  Phase 3B, per-buffer rows — `shortfall_probability`, `cvar95_cumulative_shortfall`
  (months of income), optional `wealth_depletion_probability` (**labeled [IMPLEMENTATION]**),
  and optional `identification_class`. **No near-optimal KZT range** until a future
  backend field exists.
- **Framing:** "model outputs for tested buffers," "not a recommendation," reuse existing
  disclaimer copy.
- **Explicitly excluded:** any scalar score; any "recommended/optimal/safe buffer"; any
  advice verb; any unpublished composite.

---

## 10. Engineering feasibility — Buffer Sensitivity Explorer

This section is **engineering and product-ops**, not new science. It constrains Phase 3B.

Facts about the current stack:
- The current API represents **one optimization per job**.
- Evaluating four buffers through **four browser submissions** conflicts with the current
  optimization submit throttle (`optimization_submit`, default **`3/hour`**).
- Optimization workers currently run with **`concurrency = 1`** because of peak memory use
  (~900 MB class path generation + optimize).
- A **naïve frontend fan-out** (four parallel POSTs, or four sequential POSTs under the
  hourly cap) **must not be implemented**.

Phase 3B must therefore:
1. **Design and benchmark a server-side batch / sensitivity job** before any explorer UI.
2. Specify reuse of **one generated FX bundle** across the documented buffer grid where
   scientifically valid (same paths/seed/DGP; only `B` changes).
3. Specify **caching**, **request fingerprinting**, **provenance**, **job lifecycle**,
   **bounded inputs** (documented buffers only), and **failure behavior** before UI work.
4. Preserve async polling semantics and avoid leaving users with partial unlabeled sets of
   buffer results.

Until that contract exists and is benchmarked, the Buffer Sensitivity Explorer **and**
the minimum-tested-buffer finder remain **specified product directions**, not
implementable UI tasks. The Resilience Profile does **not** depend on this batch work
and may proceed from existing successful single-job results.

---

## 11. Future research requirements

Only if a scalar score and/or a *recommended* buffer are later pursued.

**R1 — Scalar Resilience Score**
- *Research question:* is there a normatively-justified, bounded map from the model's
  tail-risk outputs to a single comparable score that preserves severity and is stable
  across horizons/profiles/data versions?
- *Candidate definitions:* severity-anchored CVaR transform with an **externally
  justified** reference (e.g., expert-set "acceptable months-of-income shortfall"),
  horizon-normalized CVaR, or an explicit two-parameter (frequency, severity) index with
  documented weights.
- *Additional inputs/data:* normative reference values (expert panel); optionally a
  reference household population for percentile scoring.
- *Calibration dataset:* the frozen `fx_daily_*` version plus documented parameter grid;
  scenario-generated outputs, not new market data.
- *Expert validation:* panel review of scale, cap, and horizon adjustment; sign-off that
  the score does not imply advice.
- *Household pilot questions:* do users interpret the score as *tail safety* (intended)
  vs *guarantee/return* (unintended)? does a high score cause over-confidence?
- *Sensitivity analyses:* score vs seed, path count, DGP (SB10/SB56/IID), window,
  rebalancing, cost; monotonicity in buffer; behavior at CVaR=0 and extreme CVaR.
- *Accept/reject criteria:* monotone in risk; horizon/profile comparability documented;
  no arbitrary constant without justification; stable interpretation across data versions;
  pilot shows no advice/guarantee misreading.
- *Versioning:* new `score_version` independent of `model_version`; recompute on any
  input change.
- *Change management:* on data/model updates, communicate that scores may move without any
  user-input change; show prior/next context; avoid silent re-scoring.
- *Distinct from paper:* label as "product score (experimental), not part of the published
  study"; never cite the manuscript as its validation.

**R2 — Utility/cost-based recommended buffer (extension D)**
- *Research question:* what buffer minimizes a well-posed objective that trades shortfall
  risk against the cost of holding cash?
- *Additional model terms/inputs:* deposit yield/interest, inflation, liquidity cost,
  transaction frictions, household risk tolerance/utility.
- *Calibration:* interest/inflation series; assumptions for liquidity cost and risk
  aversion; sensitivity across them.
- *Validation & gates:* any later buffer optimum must be **interior** (not merely the max),
  robust across cost/rate assumptions, and expert-reviewed; pilot for advice-perception.
- *Versioning/distinction:* separate model version; explicitly beyond the published paper.

---

## 12. Conceptual API contract (proposal only — do not implement)

Every field tagged: **published** / **derived** (transparent function of published
outputs) / **implementation** (exists in code, not in paper) / **experimental** /
**validated**. New fields carry a `*_version`.

### 12.1 Existing published scientific fields (unchanged) — source: published methodology
`weights`, `cvar95_cumulative_shortfall` (months-of-income, ≥0),
`var95_cumulative_shortfall` (≥0), `shortfall_probability` (0–1),
`identification_class` (enum; published identification methodology).

### 12.2 Existing implementation provenance fields (unchanged) — configuration metadata
`model_version`, `data_as_of`, `dataset_sha256` (where exposed),
`simulation_paths`, `simulation_seed`, and echoed request inputs.

These fields document the model/data configuration that produced a result. They are
**not** published scientific quantities of the manuscript.

### 12.3 Existing implementation convenience fields for identification display
`near_optimal_1pct_frac` (0–1), `near_optimal_1pct_count` (int).

Underlying identification method: [PUBLISHED]. These numeric fields: implementation
packaging for UI/API convenience.

### 12.4 Existing implementation diagnostics (unchanged) — absent from manuscript
`mean_cumulative_shortfall`, `wealth_depletion_probability`,
`mean/median/p05/p95_terminal_wealth`.

**Action:** if surfaced, label explicitly as implementation-only diagnostics absent from
the published manuscript; do not present as published evidence.

### 12.5 Proposed derived presentation fields (no new science) — source: derived
| Name | Type | Unit/range | Definition | Source | Version | Status | When |
|---|---|---|---|---|---|---|---|
| `coverage_rate_pct` | float | 0–100 | `100·(1 − shortfall_probability)` | derived from published | `presentation_v1` | derived | with Resilience Profile (now) |
| `resilience_profile` | object | — | `{coverage_rate_pct, cvar95_cumulative_shortfall, wealth_depletion_probability?, identification_class, near_optimal_1pct_frac, near_optimal_1pct_count}` for display; depletion optional and labeled implementation-only | derived + optional implementation | `presentation_v1` | derived | **now** (single successful job) |
| `buffer_sensitivity` | array | — | list over documented buffers `{1,3,6,12}` of `{buffer_months, shortfall_probability, cvar95_cumulative_shortfall, wealth_depletion_probability?, identification_class}` from a **server-side batch** job | published/implementation engine calls via batch contract | `presentation_v1` | derived | **after Phase 3B** |
| `min_tested_buffer_for_target` | object/null | — | `{target_metric, target_value, buffer_months}` = smallest documented buffer meeting a **user-selected diagnostic target**; null if none | derived from the same batch outputs | `presentation_v1` | derived | **after Phase 3B** (depends on batch) |

Notes:
- No `near_optimal_kzt_range` field is proposed for immediate use. A currency-weight range
  would be a **future** backend-derived feature with its own definition and tests.
- `buffer_sensitivity` requires the §10 batch contract; it is not four independent browser
  POSTs.
- `min_tested_buffer_for_target` requires the same batch outputs plus explicit
  user-supplied `target_metric` + `target_value` and must carry `is_user_target: true`
  (or equivalent) plus disclaimer metadata. It is **not** immediately implementable.

### 12.6 Future experimentally-calibrated fields — **not** in production API now
| Name | Type | Unit/range | Definition | Source | Version | Status |
|---|---|---|---|---|---|---|
| `resilience_score` | float | 0–100 | calibrated tail-risk score (R1) | new research | `score_vX` | experimental → validated only after R1 gates |
| `recommended_buffer` | object | months | utility/cost-based optimal buffer (R2) | new research | `buffer_opt_vX` | experimental → validated only after R2 gates |

> Do **not** place `resilience_score` or `recommended_buffer` in the production API
> unless/until the corresponding research (§11) passes its acceptance gates. This
> document concludes a scalar score is **not** supportable now, and an optimal/recommended
> buffer is **not** supportable now.

---

## 13. Phase 3B recommendation

**Phase 3B recommendation (explicit):**

> **Design the batch buffer-sensitivity contract and benchmark it before building the UI.**

Acceptance intent for that phase (design only in 3B; not begun in this document):
- one job (or explicitly specified batch resource) covering documented buffers `{1,3,6,12}`;
- scientifically valid FX-bundle reuse where appropriate;
- fingerprinting, caching, provenance, lifecycle, bounded inputs, and failure semantics;
- benchmark wall-clock and memory under `concurrency = 1` worker constraints;
- confirmation that the design does not require clients to bypass the `3/hour` submit
  throttle via fan-out;
- outputs sufficient for both the Buffer Sensitivity Explorer and the dependent
  **minimum tested buffer meeting a user-selected diagnostic target**.

Do **not** begin Phase 3B implementation in the same workstream as this editorial pass.
The Resilience Profile may still be implemented from current single-job results without
waiting on Phase 3B.

---

## 14. Implementation acceptance gates (for a later engineering phase)

A feature may ship only when all applicable gates pass:

1. **Scientific definition approved** — each displayed quantity maps to a [PUBLISHED]
   result or a clearly-labeled [DERIVED]/[IMPLEMENTATION] one; no scalar score.
2. **Terminology approved** — matches §7; no "recommended/optimal/safe buffer,"
   "advice/forecast/guarantee," or scalar "score"; user targets labeled as user-chosen
   diagnostic targets.
3. **Monotonicity checked** — buffer sensitivity is non-increasing in shortfall-risk
   metrics under the current model; any exception flagged and explained.
4. **Edge cases checked** — `VaR95=0`/`CVaR95>0` among positive-loss cells;
   zero-shortfall ⇒ zero shortfall VaR/CVaR/mean; `CVaR≈0` ⇒ Not-identified disclosed
   where observed; `η>1` structural-deficit cases; "no tested buffer meets target."
5. **Deterministic output** — fixed seed 42 / 10,000 paths; identical inputs ⇒ identical
   outputs; fingerprinting preserved (`calculations/manifest.py`).
6. **Benchmark fixtures created** — regression fixtures for presentation fields on
   P2/P4 3y where applicable, pinned to published gates; **no change** to existing
   canonical fixtures/tests.
7. **Model versioning decided** — presentation fields carry `presentation_v1`, tied to
   `model_version` + `dataset_sha256`; future score/buffer fields get their own versions.
8. **API contract reviewed** — additive only; `FORBIDDEN_CLIENT_FIELDS` unchanged;
   engine (`backend/research_engine/`) untouched; batch sensitivity contract reviewed
   before UI.
9. **User-facing limitations written** — buffer monotonicity, months-of-income units,
   horizon/profile non-comparability, synthetic profiles, data-version dependence,
   implementation-only labeling.
10. **No contradiction with the manuscript** — reviewer checks each claim against
    §§III–V; the expense-matching *mechanism* (not "100% KZT") is the headline.
11. **Pilot/expert validation identified** — required before any scalar score or
    *recommended* buffer (§11); not required for the Resilience Profile once labeling is
    approved; explorer/finder still require §10 and §13 first.
12. **Engineering gates for explorer / user-target finder** — §10 and §13 satisfied
    before those UIs. Resilience Profile may ship earlier from a single successful job.

---

## 15. Sources inspected

**Manuscript (provided PDF, read in full):** Abstract; §III-C Household Cash-Flow Model
(eqs 4–7); §III-D Loss & CVaR (eqs 8–9); §III-E Optimization (eq 10) & identification;
§III-F Experimental Design (η/B/horizons; *no interest/inflation*); §IV-B Baseline &
Table IV; §IV-C Benchmarks (Fig 5); §IV-D Robustness (Fig 6); §IV-E Tail Structure &
Fig 7 (`VaR95=0`, `CVaR95=1.1872`); §V Discussion & §V-D Limitations; §VI Conclusion.
Publication link: *[placeholder — insert stable citation / DOI / repository URL when available]*.

**Model manifest / config:**
`backend/research_engine/MODEL_MANIFEST.json` (version 1.0.0, seed 42, 10k paths, SB20,
gates), `backend/research_engine/config.py` (grids, thresholds, robustness sets).

**Engine (read-only, unmodified):**
`research_engine/api.py` (public `evaluate_allocation`/`optimize_allocation`, validators,
payload), `household/profiles.py`, `household/cashflows.py`, `household/settlement.py`
(no cost/interest term), `household/risk_metrics.py` (CVaR/VaR/summary),
`optimization/evaluator.py`, `optimization/near_optimal.py` (identification),
`robustness/optimize.py`, `robustness/classify.py`.

**Product API layer:**
`calculations/serializers.py` (accepted/forbidden fields, ranges),
`calculations/manifest.py` (`public_metadata`/`public_options`, documented values,
fingerprint), `calculations/services.py`, `calculations/views.py` (via urls),
`calculations/models.py` (job lifecycle), throttle configuration for optimization submit.

**Frontend terminology:** `frontend/src/app/core/i18n/en.ts` (advice/forecast/
recommendation guardrails).

**Temporary exploratory probes** (if any were used historically) are **not** persisted in
the repository and are **not** treated as manuscript validation in this corrected
document.

---

## 16. Uncertainties and unresolved decisions

1. **Manuscript vs. implementation diagnostics.** `wealth_depletion_probability` and the
   terminal-wealth quantiles are [IMPLEMENTATION] only. Confirm with the author whether
   they should be surfaced at all, and how to label them.
2. **Off-grid inputs.** The API accepts continuous `η`/`B`/cost inside published
   endpoints; the engine evaluates those inputs directly. Decision needed: restrict product
   features to documented values (recommended) vs. allow direct off-grid evaluations with an
   explicit "not a manuscript-validated grid point" caveat. Do **not** describe off-grid
   handling as interpolation of published results.
3. **Buffer explorer batch contract.** Exact request/response shape, FX-bundle reuse rules,
   caching/fingerprinting, and failure partials — Phase 3B design work (§13).
4. **User-target finder targets.** Which metric(s) users may target (`P(L>0)`, `CVaR95`,
   optionally depletion labeled implementation-only) and whether the UI offers presets —
   presets must not imply a norm or "safe buffer."
5. **Coverage-rate exposure.** Whether to show `coverage_rate_pct` at all, given its
   severity blind spot (§4A/§6); if shown, it must sit beside CVaR, never alone.
6. **Data-version communication.** Policy for how results change on `fx_daily_*` updates
   (`data_as_of`, `dataset_sha256`) so users are not surprised by moving numbers.
7. **Manuscript pages.** Citations use section/equation/table/figure labels; exact PDF
   page numbers should be reconciled against the final typeset version.
8. **Future near-optimal weight-range field.** Definition, tests, and API exposure remain
   unresolved; not available for immediate UI.
9. **Any scalar/score or recommended/optimal buffer** remains unresolved pending the §11
   research and pilot; this phase concludes neither is supportable now
   (**do not implement now; research and validation are required before reconsideration**).
