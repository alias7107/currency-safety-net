"""Verified currency-allocation calculation engine.

Callers must use the public functions below. Do not import household
settlement, simulation, or optimization internals from Django views.
"""

from .api import evaluate_allocation, optimize_allocation
from .personal import analyze_household

__all__ = ["analyze_household", "evaluate_allocation", "optimize_allocation"]
