"""Tests for cost calculation in the OpenAI patcher — mirrors the TS pricing tests."""

from __future__ import annotations

import pytest

from agentlens.patchers.openai import _calculate_cost


class TestCalculateCost:
    def test_gpt4o(self) -> None:
        # input: 1000/1000 * 0.005 = 0.005
        # output: 500/1000 * 0.015 = 0.0075
        # total: 0.0125
        cost = _calculate_cost("gpt-4o", 1_000, 500)
        assert cost is not None
        assert abs(cost - 0.0125) < 1e-9

    def test_gpt4o_mini(self) -> None:
        # input: 2000/1000 * 0.00015 = 0.0003
        # output: 1000/1000 * 0.0006 = 0.0006
        # total: 0.0009
        cost = _calculate_cost("gpt-4o-mini", 2_000, 1_000)
        assert cost is not None
        assert abs(cost - 0.0009) < 1e-9

    def test_gpt35_turbo(self) -> None:
        # input: 1000/1000 * 0.0005 = 0.0005
        # output: 1000/1000 * 0.0015 = 0.0015
        # total: 0.002
        cost = _calculate_cost("gpt-3.5-turbo", 1_000, 1_000)
        assert cost is not None
        assert abs(cost - 0.002) < 1e-9

    def test_embedding_model(self) -> None:
        # text-embedding-3-small: 1000/1000 * 0.00002 = 0.00002
        cost = _calculate_cost("text-embedding-3-small", 1_000, 0)
        assert cost is not None
        assert abs(cost - 0.00002) < 1e-12

    def test_unknown_model_returns_none(self) -> None:
        cost = _calculate_cost("gpt-99-unknown", 100, 100)
        assert cost is None

    def test_missing_provider_returns_none(self) -> None:
        # _calculate_cost is model-only; no provider arg needed.
        # Ensure an unmapped model returns None.
        cost = _calculate_cost("totally-unknown-model", 100, 100)
        assert cost is None

    def test_zero_tokens(self) -> None:
        cost = _calculate_cost("gpt-4o", 0, 0)
        assert cost is not None
        assert cost == 0.0

    def test_versioned_model_resolved_to_base(self) -> None:
        # gpt-4o-2024-05-13 is explicitly in the table
        cost_versioned = _calculate_cost("gpt-4o-2024-05-13", 1_000, 1_000)
        cost_base = _calculate_cost("gpt-4o", 1_000, 1_000)
        assert cost_versioned is not None
        assert cost_base is not None
        assert abs(cost_versioned - cost_base) < 1e-9

    def test_date_suffix_normalisation(self) -> None:
        # A model with a date suffix not in the table should normalise to base
        cost = _calculate_cost("gpt-4o-2099-01-01", 1_000, 500)
        # After stripping the date, resolves to gpt-4o
        assert cost is not None
        assert abs(cost - 0.0125) < 1e-9
