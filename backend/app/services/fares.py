"""Distance-based public-transport fare estimation (PTC adult card, eff. 27 Dec 2025).

LTA DataMall has no route-fare API; Singapore fares are distance-based and published by
the Public Transport Council. Bus trunk fares and train "other times" fares share the same
bands, so one table covers BUS and METRO. Used only as a fallback when OneMap omits a fare.
Source: simplygo.com.sg/travel-fares/adult-fares (captured 2026-06-12).
"""

# (upper_bound_km inclusive, adult card fare SGD). Distance <= bound → fare.
_FARE_BANDS: list[tuple[float, float]] = [
    (3.2, 1.28), (4.2, 1.38), (5.2, 1.49), (6.2, 1.59), (7.2, 1.68),
    (8.2, 1.75), (9.2, 1.82), (10.2, 1.86), (11.2, 1.90), (12.2, 1.94),
    (13.2, 1.98), (14.2, 2.02), (15.2, 2.07), (16.2, 2.11), (17.2, 2.15),
    (18.2, 2.20), (19.2, 2.24), (20.2, 2.27), (21.2, 2.30), (22.2, 2.33),
    (23.2, 2.36), (24.2, 2.38), (25.2, 2.40), (26.2, 2.42), (27.2, 2.43),
    (28.2, 2.44), (29.2, 2.45), (30.2, 2.46), (31.2, 2.47), (32.2, 2.48),
    (33.2, 2.49), (34.2, 2.50), (35.2, 2.51), (36.2, 2.52), (37.2, 2.53),
    (38.2, 2.54), (39.2, 2.55), (40.2, 2.56),
]
_MAX_FARE = 2.57   # > 40.2 km cap


def estimate_transit_fare(distance_km: float | None) -> float:
    """Estimate an adult-card transit fare from leg distance (km).

    Returns the PTC band fare; distances over the top band return the cap. Non-positive
    or missing distance → 0.0 (no fare to estimate).
    """
    if distance_km is None or distance_km <= 0:
        return 0.0
    for bound, fare in _FARE_BANDS:
        if distance_km <= bound:
            return fare
    return _MAX_FARE
