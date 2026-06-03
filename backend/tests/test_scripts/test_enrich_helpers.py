"""
Unit tests for enrich_places_google.py helper functions.

Tests only pure logic functions (no API calls, no network, no filesystem).
Run from backend/:
    cd backend && pytest tests/test_scripts/test_enrich_helpers.py -v
"""

import sys
from pathlib import Path

# Add backend/ to path so imports resolve without installing the package
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.scripts.enrich_places_google import convert_opening_hours, _haversine_m


# ── convert_opening_hours ─────────────────────────────────────────────────────

class TestConvertOpeningHours:

    def test_none_periods_returns_fail_open(self):
        hours, close = convert_opening_hours(None)
        assert hours == ["00:00-23:59"]
        assert close == []

    def test_empty_list_returns_fail_open(self):
        hours, close = convert_opening_hours([])
        assert hours == ["00:00-23:59"]
        assert close == []

    def test_24h_place_single_sunday_period_no_close(self):
        """24/7 venue: one period, opens Sunday 00:00, no close entry."""
        periods = [{"open": {"day": 0, "hour": 0, "minute": 0}}]
        hours, close = convert_opening_hours(periods)
        assert hours == ["00:00-23:59"]
        assert close == []

    def test_single_slot_all_days(self):
        """Open 09:00–18:00 every day of the week."""
        periods = [
            {"open": {"day": d, "hour": 9, "minute": 0}, "close": {"day": d, "hour": 18, "minute": 0}}
            for d in range(7)
        ]
        hours, close = convert_opening_hours(periods)
        assert hours == ["09:00-18:00"]
        assert close == []

    def test_closed_monday(self):
        """Museum open Tue–Sun (days 2–0 except 1 = Monday)."""
        open_days = [0, 2, 3, 4, 5, 6]  # Sun, Tue, Wed, Thu, Fri, Sat
        periods = [
            {"open": {"day": d, "hour": 10, "minute": 0}, "close": {"day": d, "hour": 18, "minute": 0}}
            for d in open_days
        ]
        hours, close = convert_opening_hours(periods)
        assert hours == ["10:00-18:00"]
        assert "Monday" in close
        assert len(close) == 1

    def test_split_hours_temple(self):
        """Temple with two daily windows: 07:00–12:00 and 18:00–21:00."""
        periods = []
        for d in range(7):
            periods.append({"open": {"day": d, "hour": 7,  "minute": 0}, "close": {"day": d, "hour": 12, "minute": 0}})
            periods.append({"open": {"day": d, "hour": 18, "minute": 0}, "close": {"day": d, "hour": 21, "minute": 0}})
        hours, close = convert_opening_hours(periods)
        assert "07:00-12:00" in hours
        assert "18:00-21:00" in hours
        assert close == []

    def test_midnight_crossing_slot(self):
        """Late-night venue: 22:00–02:00."""
        periods = [
            {"open": {"day": d, "hour": 22, "minute": 0}, "close": {"day": d, "hour": 2, "minute": 0}}
            for d in range(7)
        ]
        hours, close = convert_opening_hours(periods)
        assert "22:00-02:00" in hours
        assert close == []

    def test_closed_saturday_and_sunday(self):
        """Office open Mon–Fri only."""
        open_days = [1, 2, 3, 4, 5]  # Mon–Fri
        periods = [
            {"open": {"day": d, "hour": 9, "minute": 0}, "close": {"day": d, "hour": 17, "minute": 0}}
            for d in open_days
        ]
        hours, close = convert_opening_hours(periods)
        assert hours == ["09:00-17:00"]
        assert "Saturday" in close
        assert "Sunday" in close
        assert len(close) == 2

    def test_multiple_different_slots_deduped(self):
        """Same slot appears for every day — should be stored once."""
        periods = [
            {"open": {"day": d, "hour": 11, "minute": 30}, "close": {"day": d, "hour": 21, "minute": 30}}
            for d in range(7)
        ]
        hours, close = convert_opening_hours(periods)
        assert hours.count("11:30-21:30") == 1  # deduped

    def test_zero_minute_padding(self):
        """Hours and minutes zero-padded correctly."""
        periods = [
            {"open": {"day": 0, "hour": 9, "minute": 0}, "close": {"day": 0, "hour": 18, "minute": 0}}
        ]
        hours, _ = convert_opening_hours(periods)
        assert hours[0] == "09:00-18:00"

    def test_non_zero_minutes(self):
        """Non-zero minutes formatted correctly: 09:30-22:45."""
        periods = [
            {"open": {"day": 1, "hour": 9, "minute": 30}, "close": {"day": 1, "hour": 22, "minute": 45}}
        ]
        hours, _ = convert_opening_hours(periods)
        assert "09:30-22:45" in hours


# ── _haversine_m ──────────────────────────────────────────────────────────────

class TestHaversine:

    def test_same_point_is_zero(self):
        assert _haversine_m(1.3, 103.8, 1.3, 103.8) == 0.0

    def test_merlion_to_mbs_approx_700m(self):
        """Merlion Park to Marina Bay Sands is roughly 700 m."""
        d = _haversine_m(1.28681, 103.85453, 1.28240, 103.85841)
        assert 600 < d < 900, f"Expected ~700m, got {d:.0f}m"

    def test_symmetry(self):
        d1 = _haversine_m(1.3, 103.8, 1.31, 103.82)
        d2 = _haversine_m(1.31, 103.82, 1.3, 103.8)
        assert abs(d1 - d2) < 0.01
