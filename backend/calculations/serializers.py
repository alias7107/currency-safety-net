"""Request/response serializers for the calculations API."""

from __future__ import annotations

from rest_framework import serializers

from research_engine.api import (
    BUFFER_MONTHS_MAX,
    BUFFER_MONTHS_MIN,
    CONVERSION_COST_MAX,
    CONVERSION_COST_MIN,
    EXPENSE_INCOME_RATIO_MAX,
    EXPENSE_INCOME_RATIO_MIN,
    PROFILE_ALIASES,
    SUPPORTED_HORIZON_YEARS,
    SUPPORTED_REBALANCE_FREQUENCIES,
)
from research_engine.household.profiles import PRIMARY_PROFILES

FORBIDDEN_CLIENT_FIELDS = {
    "n_paths",
    "seed",
    "_fx_bundle",
    "model_version",
    "dataset_path",
    "dataset",
    "data_path",
    "fx_bundle",
    "simulation_paths",
    "simulation_seed",
}


class StrictSerializer(serializers.Serializer):
    """Reject unknown fields so clients cannot smuggle engine controls."""

    def to_internal_value(self, data):
        if not isinstance(data, dict):
            raise serializers.ValidationError(
                {"non_field_errors": ["Request body must be a JSON object."]}
            )
        unknown = sorted(set(data.keys()) - set(self.fields.keys()))
        forbidden = sorted(set(data.keys()) & FORBIDDEN_CLIENT_FIELDS)
        errors = {}
        if forbidden:
            errors["forbidden_fields"] = [
                f"Field '{name}' is not allowed." for name in forbidden
            ]
        remaining_unknown = [name for name in unknown if name not in FORBIDDEN_CLIENT_FIELDS]
        if remaining_unknown:
            errors["unknown_fields"] = [
                f"Unknown field '{name}'." for name in remaining_unknown
            ]
        if errors:
            raise serializers.ValidationError(errors)
        return super().to_internal_value(data)


class OptimizationJobCreateSerializer(StrictSerializer):
    profile = serializers.CharField(max_length=64)
    horizon_years = serializers.IntegerField()
    expense_income_ratio = serializers.FloatField(required=False, default=0.95)
    buffer_months = serializers.FloatField(required=False, default=1)
    rebalance_frequency = serializers.CharField(required=False, default="monthly")
    conversion_cost = serializers.FloatField(required=False, default=0.0)

    def validate_profile(self, value: str) -> str:
        raw = value.strip()
        name = PROFILE_ALIASES.get(raw.upper(), raw)
        if name not in {p.name for p in PRIMARY_PROFILES} and raw.upper() not in PROFILE_ALIASES:
            raise serializers.ValidationError(
                f"Unknown profile. Choose one of: {', '.join(sorted(PROFILE_ALIASES))}."
            )
        return raw

    def validate_horizon_years(self, value: int) -> int:
        if value not in SUPPORTED_HORIZON_YEARS:
            raise serializers.ValidationError(
                f"horizon_years must be one of {list(SUPPORTED_HORIZON_YEARS)}."
            )
        return value

    def validate_expense_income_ratio(self, value: float) -> float:
        if value < EXPENSE_INCOME_RATIO_MIN or value > EXPENSE_INCOME_RATIO_MAX:
            raise serializers.ValidationError(
                "expense_income_ratio must be between "
                f"{EXPENSE_INCOME_RATIO_MIN} and {EXPENSE_INCOME_RATIO_MAX}."
            )
        return float(value)

    def validate_buffer_months(self, value: float) -> float:
        if value < BUFFER_MONTHS_MIN or value > BUFFER_MONTHS_MAX:
            raise serializers.ValidationError(
                "buffer_months must be between "
                f"{BUFFER_MONTHS_MIN} and {BUFFER_MONTHS_MAX}."
            )
        return float(value)

    def validate_rebalance_frequency(self, value: str) -> str:
        freq = value.lower().strip()
        if freq not in SUPPORTED_REBALANCE_FREQUENCIES:
            raise serializers.ValidationError(
                "rebalance_frequency must be one of "
                f"{list(SUPPORTED_REBALANCE_FREQUENCIES)}."
            )
        return freq

    def validate_conversion_cost(self, value: float) -> float:
        if value < CONVERSION_COST_MIN or value > CONVERSION_COST_MAX:
            raise serializers.ValidationError(
                "conversion_cost must be between "
                f"{CONVERSION_COST_MIN} and {CONVERSION_COST_MAX}."
            )
        return float(value)


class OptimizationJobStatusSerializer(serializers.Serializer):
    job_id = serializers.UUIDField(source="id")
    status = serializers.CharField()
    cached = serializers.BooleanField(required=False)
    created_at = serializers.DateTimeField()
    started_at = serializers.DateTimeField(allow_null=True)
    completed_at = serializers.DateTimeField(allow_null=True, required=False)
    result = serializers.JSONField(source="result_payload", required=False, allow_null=True)
    error_code = serializers.CharField(required=False, allow_null=True)
    error_message = serializers.CharField(required=False, allow_null=True)
    status_url = serializers.SerializerMethodField()

    def get_status_url(self, obj) -> str:
        return f"/api/v1/optimization-jobs/{obj.id}/"
