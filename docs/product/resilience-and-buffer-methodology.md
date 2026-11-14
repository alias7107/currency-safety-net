# Model methodology

Currency Safety Net models how household income, essential expenses and liquid
savings interact across KZT, USD and EUR. The research is available as an
[SSRN preprint](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=7591999).
The implementation lives in `backend/research_engine/`.

## Allocation objective

The optimizer selects currency weights that minimize CVaR95 of cumulative
uncovered expenditure. Each simulated path produces a sum of monthly expenses
that could not be paid. CVaR95 is the average of the worst 5% of those path
losses. With 10,000 paths, this is the average of the largest 500 losses.

CVaR95 is the sole optimization objective. Shortfall probability, VaR95 and
terminal reserve values describe other aspects of the same scenario; the
optimizer does not jointly minimize them or maximize investment returns.

The search uses a two-percentage-point coarse allocation grid and
one-percentage-point refinement. Reported counts refer to evaluated
allocations; overlapping points are deduplicated.

## Scenario generation and units

- The baseline uses joint stationary-bootstrap FX paths, preserving the joint
  behavior of USD/KZT and EUR/KZT returns.
- Production calculations use 10,000 paths and seed 42.
- The engine generates the full five-year path before slicing it for a one-
  or three-year scenario.
- Initial monthly income is normalized to `I0 = 1`.
- With expense-to-income ratio `eta`, initial expenses are `E0 = eta * I0`.
- With buffer coverage `B`, the initial reserve is `W0 = B * E0`.

Shortfall and terminal reserve amounts are expressed in units of initial
monthly income, not months of expenses or currency returns. The initial
buffer input is measured in months of initial essential expenses.

## Research scenarios and custom households

The study evaluates four predefined household currency profiles. Personal
assessments supply income, expense and reserve shares directly. Accepted
off-grid inputs are evaluated by the engine; they are not interpolated from
research tables and do not become additional published validation cases.

The supported horizons are 1, 3 and 5 years. Current API limits accept
expense-to-income ratios from 0.80 to 1.05, initial reserve coverage from 1
to 12 months and conversion costs from 0 to 0.01. Rebalancing is monthly,
quarterly or absent. These are model bounds, not targets for a household.

## Reading the outputs

| Output                | Meaning                                                                   |
| --------------------- | ------------------------------------------------------------------------- |
| CVaR95                | Average cumulative shortfall in the worst 5% of paths                     |
| VaR95                 | The loss at the boundary of that tail, using the engine's order statistic |
| Shortfall probability | Share of paths with positive cumulative unpaid expenses                   |
| Currency weights      | The allocation selected from the evaluated grid                           |
| Identification        | How broadly near-optimal allocations spread over that grid                |

VaR95 can be zero while CVaR95 is positive when fewer than 5% of paths have
losses. If every path has zero cumulative shortfall, its mean, VaR95 and
CVaR95 are all zero. Terminal reserve values can still differ.

Mean cumulative shortfall, terminal reserve mean/median/quantiles and terminal
depletion probability are additional implementation diagnostics, not outputs
reported in the preprint's methodology. Depletion means a reserve at or below
the engine tolerance at the end of the horizon, not at any point during it.

Identification classes A, B and C describe the evaluated optimization surface.
They do not rate household safety. Class C does not necessarily mean every
allocation has exactly equal results. A displayed allocation on an
undistinguished surface must not be presented as a unique recommendation.

Model version, data date, dataset hash, path count and seed describe result
provenance. Near-optimal counts are API summaries of the identification
method; they are not separate published empirical findings.

## Buffer sensitivity

The research explorer evaluates buffers of 1, 3, 6 and 12 months, optimizing
the allocation separately at each level. It shows discrete results without
interpolating between them. The target finder returns the first tested level
meeting the user's chosen metric threshold, including equality.

This is not an optimal or recommended reserve size. The model does not charge
an opportunity cost, inflation or liquidity penalty for holding more cash,
so it does not identify the economic trade-off needed for that recommendation.
There is also no calibrated scalar resilience score or risk band.

## Household assumptions

All income remaining after entered essential expenses stays in simulated
savings. Planned contributions and unentered spending are not separate model
inputs. The current reserve mix is both the initial allocation and the target
for the selected rebalancing policy. Without rebalancing, holdings still
change through cash flows, FX movements and liquidation to pay expenses.

The current-versus-grid comparison excludes the initial cost of converting
actual holdings into the alternative mix. It compares simulated shortfalls,
not a net benefit from making a trade. Results depend on the submitted
assumptions and historical data; they are not exchange-rate forecasts.

See the [personal simulation contract](personalized-simulation-contract.md)
and [buffer API](buffer-sensitivity-batch-design.md) for request and result details.
