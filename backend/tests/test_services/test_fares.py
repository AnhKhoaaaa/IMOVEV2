import pytest

from app.services.fares import estimate_transit_fare, _MAX_FARE


@pytest.mark.parametrize("dist_km, expected", [
    (0.5, 1.28),      # bottom band
    (3.2, 1.28),      # exact boundary → still bottom band
    (3.3, 1.38),      # just over → next band
    (9.0, 1.82),      # mid band
    (15.0, 2.07),     # mid band
    (40.2, 2.56),     # top defined band (exact)
    (50.0, _MAX_FARE),  # beyond the table → cap
])
def test_estimate_transit_fare_bands(dist_km, expected):
    assert estimate_transit_fare(dist_km) == expected


@pytest.mark.parametrize("dist_km", [0, -1.0, None])
def test_estimate_transit_fare_non_positive_or_missing_is_zero(dist_km):
    assert estimate_transit_fare(dist_km) == 0.0


def test_bands_are_monotonic_non_decreasing():
    """Fares must never decrease as distance grows (sanity on the table)."""
    fares = [estimate_transit_fare(d) for d in [0.5, 3.3, 5.0, 9.0, 15.0, 25.0, 40.0, 60.0]]
    assert fares == sorted(fares)
    assert fares[-1] == _MAX_FARE
