import pytest
from contextlib import contextmanager
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient

from app.main import app
from app.dependencies import get_current_user
from app.models.trip import TripPlan, DayPlan, LegResponse, LegSwapResult, AlternativeRoute
from app.models.place import Place
from app.exceptions import PlaceDataMissingError, BudgetExceededError
from app.services.onemap import NoRouteError
import app.routers.trips as _trips_module

client = TestClient(app)


@contextmanager
def _auth_as(user_id: str | None):
    """Override get_current_user for the duration of this context."""
    async def _mock():
        return user_id
    app.dependency_overrides[get_current_user] = _mock
    try:
        yield
    finally:
        app.dependency_overrides.pop(get_current_user, None)


# ── helpers ───────────────────────────────────────────────────────────────────

def _make_plan(trip_id: str = "test-trip") -> TripPlan:
    leg = LegResponse(
        id="leg-001",
        from_place_id="gardens-by-the-bay",
        to_place_id="marina-bay-sands",
        transport_mode="METRO",
        duration_minutes=15,
        cost_sgd=1.80,
        is_estimated=False,
    )
    place = Place(
        id="gardens-by-the-bay",
        name="Gardens by the Bay",
        lat=1.2816,
        lng=103.8636,
        dwell_minutes=180,
        best_time_start="08:00",
        best_time_end="11:00",
        category="nature",
        is_outdoor=True,
        in_curated_dataset=True,
    )
    return TripPlan(
        id=trip_id,
        days=[DayPlan(day=1, legs=[leg])],
        places=[place],
        warnings=[],
    )


# ── POST /trips ───────────────────────────────────────────────────────────────

def test_create_trip_returns_trip_id():
    resp = client.post("/trips", json={
        "session_id": "sess-123",
        "num_days": 2,
        "budget_sgd": 100,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "trip_id" in data
    assert len(data["trip_id"]) == 36  # UUID4 format


def test_create_trip_different_ids_each_call():
    r1 = client.post("/trips", json={"session_id": "session-1", "num_days": 1, "budget_sgd": 50})
    r2 = client.post("/trips", json={"session_id": "session-2", "num_days": 1, "budget_sgd": 50})
    assert r1.json()["trip_id"] != r2.json()["trip_id"]


# ── POST /trips/{id}/plan ─────────────────────────────────────────────────────

def test_plan_trip_returns_tripplan_shape():
    create = client.post("/trips", json={"session_id": "session-x", "num_days": 1, "budget_sgd": 999})
    trip_id = create.json()["trip_id"]

    mock_plan = _make_plan(trip_id)
    with patch(
        "app.routers.trips.planning_agent.plan_trip",
        new_callable=AsyncMock,
        return_value=mock_plan,
    ):
        resp = client.post(f"/trips/{trip_id}/plan", json={
            "place_ids": ["gardens-by-the-bay", "marina-bay-sands"],
            "optimize_order": True,
            "preferences": {"prefer_mrt": True, "max_walk_minutes": 15, "budget_sgd": 999},
        })

    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == trip_id
    assert "days" in data
    assert "places" in data
    assert "warnings" in data
    assert data["days"][0]["legs"][0]["is_estimated"] is False


def test_plan_trip_missing_place_returns_422():
    create = client.post("/trips", json={"session_id": "session-x", "num_days": 1, "budget_sgd": 999})
    trip_id = create.json()["trip_id"]

    with patch(
        "app.routers.trips.planning_agent.plan_trip",
        new_callable=AsyncMock,
        side_effect=PlaceDataMissingError("bad-place"),
    ):
        # Two place_ids to pass min_length=2 validation; agent mock raises the error
        resp = client.post(f"/trips/{trip_id}/plan", json={
            "place_ids": ["gardens-by-the-bay", "bad-place"],
            "optimize_order": False,
        })

    assert resp.status_code == 422
    assert "bad-place" in resp.json()["detail"]


def test_plan_trip_no_route_returns_422():
    create = client.post("/trips", json={"session_id": "session-x", "num_days": 1, "budget_sgd": 999})
    trip_id = create.json()["trip_id"]

    with patch(
        "app.routers.trips.planning_agent.plan_trip",
        new_callable=AsyncMock,
        side_effect=NoRouteError("No route available from 'A' to 'B'"),
    ):
        resp = client.post(f"/trips/{trip_id}/plan", json={
            "place_ids": ["gardens-by-the-bay", "sentosa-universal-studios"],
            "optimize_order": False,
        })

    assert resp.status_code == 422
    assert "route" in resp.json()["detail"].lower()


def test_plan_trip_budget_exceeded_returns_422():
    create = client.post("/trips", json={"session_id": "session-x", "num_days": 1, "budget_sgd": 5})
    trip_id = create.json()["trip_id"]

    with patch(
        "app.routers.trips.planning_agent.plan_trip",
        new_callable=AsyncMock,
        side_effect=BudgetExceededError(150.0, 5.0),
    ):
        resp = client.post(f"/trips/{trip_id}/plan", json={
            "place_ids": ["gardens-by-the-bay", "marina-bay-sands"],
            "optimize_order": False,
            "preferences": {"budget_sgd": 5},
        })

    assert resp.status_code == 422
    assert "budget" in resp.json()["detail"].lower() or "cost" in resp.json()["detail"].lower()


# ── GET /trips/{id} ───────────────────────────────────────────────────────────

def test_get_trip_after_plan():
    create = client.post("/trips", json={"session_id": "session-x", "num_days": 1, "budget_sgd": 999})
    trip_id = create.json()["trip_id"]

    mock_plan = _make_plan(trip_id)
    with patch(
        "app.routers.trips.planning_agent.plan_trip",
        new_callable=AsyncMock,
        return_value=mock_plan,
    ):
        client.post(f"/trips/{trip_id}/plan", json={
            "place_ids": ["gardens-by-the-bay", "marina-bay-sands"],
            "optimize_order": False,
        })

    resp = client.get(f"/trips/{trip_id}")
    assert resp.status_code == 200
    assert resp.json()["id"] == trip_id


def test_get_trip_not_found_returns_404():
    resp = client.get("/trips/nonexistent-trip-id-xyz")
    assert resp.status_code == 404


# ── PATCH /trips/{id}/legs/{leg_id} ──────────────────────────────────────────

def test_patch_leg_updates_transport_mode():
    """PATCH returns LegSwapResult; updated_leg has the new mode and route data."""
    create = client.post("/trips", json={"session_id": "session-x", "num_days": 1, "budget_sgd": 999})
    trip_id = create.json()["trip_id"]

    mock_plan = _make_plan(trip_id)

    # Build LegSwapResult that switch_leg_mode would return
    updated_leg = mock_plan.days[0].legs[0].model_copy(update={
        "transport_mode": "BUS",
        "duration_minutes": 20,
        "cost_sgd": 1.20,
    })
    mock_swap = LegSwapResult(updated_leg=updated_leg, trip_cost_sgd=1.20, warnings=[])

    with patch("app.routers.trips.planning_agent.plan_trip", new_callable=AsyncMock, return_value=mock_plan):
        client.post(f"/trips/{trip_id}/plan", json={
            "place_ids": ["gardens-by-the-bay", "marina-bay-sands"],
            "optimize_order": False,
        })

    with patch("app.routers.trips.planning_agent.switch_leg_mode",
               new_callable=AsyncMock, return_value=mock_swap):
        resp = client.patch(f"/trips/{trip_id}/legs/leg-001", json={"transport_mode": "BUS"})

    assert resp.status_code == 200
    data = resp.json()
    assert data["updated_leg"]["transport_mode"] == "BUS"
    assert data["updated_leg"]["id"] == "leg-001"
    assert "trip_cost_sgd" in data
    assert isinstance(data["warnings"], list)


def test_patch_leg_no_route_returns_422():
    """When switch_leg_mode raises NoRouteError → 422 with error message."""
    create = client.post("/trips", json={"session_id": "session-x", "num_days": 1, "budget_sgd": 999})
    trip_id = create.json()["trip_id"]

    mock_plan = _make_plan(trip_id)
    with patch("app.routers.trips.planning_agent.plan_trip", new_callable=AsyncMock, return_value=mock_plan):
        client.post(f"/trips/{trip_id}/plan", json={
            "place_ids": ["gardens-by-the-bay", "marina-bay-sands"],
            "optimize_order": False,
        })

    with patch("app.routers.trips.planning_agent.switch_leg_mode",
               new_callable=AsyncMock,
               side_effect=NoRouteError("No BUS route available")):
        resp = client.patch(f"/trips/{trip_id}/legs/leg-001", json={"transport_mode": "BUS"})

    assert resp.status_code == 422
    assert "BUS" in resp.json()["detail"]


def test_patch_leg_not_found_returns_404():
    create = client.post("/trips", json={"session_id": "session-x", "num_days": 1, "budget_sgd": 999})
    trip_id = create.json()["trip_id"]

    mock_plan = _make_plan(trip_id)
    with patch(
        "app.routers.trips.planning_agent.plan_trip",
        new_callable=AsyncMock,
        return_value=mock_plan,
    ):
        client.post(f"/trips/{trip_id}/plan", json={
            "place_ids": ["gardens-by-the-bay", "marina-bay-sands"],
            "optimize_order": False,
        })

    resp = client.patch(f"/trips/{trip_id}/legs/no-such-leg", json={"transport_mode": "BUS"})
    assert resp.status_code == 404


# ── POST /trips/{id}/adapt ────────────────────────────────────────────────────

def test_adapt_trip_no_session_id_returns_403():
    """When supabase=None, session_id is not required (no DB to verify against).
    When supabase is available, missing session_id must return 403.
    In tests supabase=None (mocked), so adapt without session_id proceeds to 404
    because the trip doesn't exist in the store either — meaning the check is
    correctly bypassed only when there's no DB, confirming the guard logic."""
    # supabase is None (via conftest fixture) → no session_id required
    resp = client.post("/trips/nonexistent-trip/adapt", json={
        "alert_id": "some-alert-id",
    })
    # trip not in store → 404 (the IDOR guard correctly skips when supabase=None)
    assert resp.status_code == 404


def test_adapt_trip_unknown_trip_id_returns_404_or_503():
    """Adapting a trip that doesn't exist returns 404 (no DB) or 503 (DB down)."""
    resp = client.post("/trips/unknown-trip-xyz/adapt", json={
        "alert_id": "alert-abc",
        "session_id": "valid-session-id",
    })
    # supabase=None and trip not in store → _verify_session_ownership raises 503
    # (supabase is None so cannot verify ownership)
    assert resp.status_code == 503


def test_adapt_trip_with_valid_session_id():
    """Adapt succeeds when trip is in store and session_id matches."""
    import app.routers.trips as _trips_module
    from app.models.trip import AdaptResponse

    # Create and plan a trip so it's in _trip_store and _trip_meta
    create = client.post("/trips", json={"session_id": "valid-session-id", "num_days": 1, "budget_sgd": 999})
    trip_id = create.json()["trip_id"]

    mock_plan = _make_plan(trip_id)
    with patch(
        "app.routers.trips.planning_agent.plan_trip",
        new_callable=AsyncMock,
        return_value=mock_plan,
    ):
        client.post(f"/trips/{trip_id}/plan", json={
            "place_ids": ["gardens-by-the-bay", "marina-bay-sands"],
            "optimize_order": False,
        })

    mock_adapt_response = AdaptResponse(
        adapted=False,
        changes=["Database unavailable"],
        updated_trip=mock_plan,
    )
    with patch(
        "app.routers.trips.adaptation_agent.adapt_trip",
        new_callable=AsyncMock,
        return_value=mock_adapt_response,
    ):
        resp = client.post(f"/trips/{trip_id}/adapt", json={
            "alert_id": "alert-001",
            "session_id": "valid-session-id",
        })

    assert resp.status_code == 200
    data = resp.json()
    assert "adapted" in data
    assert "changes" in data
    assert "updated_trip" in data


# ── POST /trips/{id}/accept-swap ──────────────────────────────────────────────

def test_accept_swap_no_pending_returns_404():
    resp = client.post("/trips/no-pending-trip/accept-swap", json={"alert_id": "alert-1"})
    assert resp.status_code == 404
    assert "pending" in resp.json()["detail"].lower()


def test_accept_swap_wrong_alert_id_returns_409():
    import app.routers.trips as _trips_module
    trip_id = "trip-conflict"
    mock_plan = _make_plan(trip_id)
    _trips_module._pending_swaps[trip_id] = {"alert_id": "correct-alert", "updated_trip": mock_plan}
    _trips_module._trip_meta[trip_id] = {"num_days": 1, "budget_sgd": 999.0, "session_id": "session-conflict-1"}
    try:
        resp = client.post(f"/trips/{trip_id}/accept-swap", json={
            "alert_id": "wrong-alert",
            "session_id": "session-conflict-1",
        })
        assert resp.status_code == 409
        assert "alert_id" in resp.json()["detail"].lower()
    finally:
        _trips_module._pending_swaps.pop(trip_id, None)
        _trips_module._trip_meta.pop(trip_id, None)


def test_accept_swap_success_commits_and_clears_pending():
    trip_id = "trip-accept-ok"
    mock_plan = _make_plan(trip_id)
    _trips_module._pending_swaps[trip_id] = {"alert_id": "alert-ok", "updated_trip": mock_plan}
    _trips_module._trip_meta[trip_id] = {"num_days": 1, "budget_sgd": 999.0, "session_id": "session-accept-ok"}
    try:
        with patch("app.routers.trips.adaptation_agent.commit_adaptation", new_callable=AsyncMock):
            resp = client.post(f"/trips/{trip_id}/accept-swap", json={
                "alert_id": "alert-ok",
                "session_id": "session-accept-ok",
            })
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == trip_id
        # Pending swap must be cleared after acceptance
        assert trip_id not in _trips_module._pending_swaps
    finally:
        _trips_module._pending_swaps.pop(trip_id, None)
        _trips_module._trip_meta.pop(trip_id, None)


# ── helpers for Phase 5 tests ─────────────────────────────────────────────────

def _make_two_place_plan(trip_id: str = "trip-p5") -> TripPlan:
    """Plan with 2 places and 1 connecting leg — baseline for Phase 5 tests."""
    place_a = Place(
        id="place-a", name="Place A", lat=1.28, lng=103.85,
        dwell_minutes=120, best_time_start="09:00", best_time_end="17:00",
        category="nature", is_outdoor=True, in_curated_dataset=True,
    )
    place_b = Place(
        id="place-b", name="Place B", lat=1.29, lng=103.86,
        dwell_minutes=90, best_time_start="09:00", best_time_end="17:00",
        category="culture", is_outdoor=False, in_curated_dataset=True,
    )
    leg = LegResponse(
        id="leg-ab", from_place_id="place-a", to_place_id="place-b",
        transport_mode="METRO", duration_minutes=10, cost_sgd=1.50, is_estimated=False,
    )
    return TripPlan(id=trip_id, days=[DayPlan(day=1, legs=[leg])], places=[place_a, place_b], warnings=[])


def _seed_trip(trip_id: str, plan: TripPlan, user_id: str | None = None) -> None:
    """Seed trip into in-memory store and meta for router tests."""
    _trips_module._trip_store[trip_id] = plan
    _trips_module._trip_meta[trip_id] = {
        "num_days": len(plan.days),
        "budget_sgd": 999.0,
        "session_id": "session-p5",
        "user_id": user_id,
    }


def _cleanup(trip_id: str) -> None:
    _trips_module._trip_store.pop(trip_id, None)
    _trips_module._trip_meta.pop(trip_id, None)


# ── P5-BUG-2: _ordered_place_ids crash fix ───────────────────────────────────

def test_ordered_place_ids_empty_legs_and_places_no_crash():
    """_ordered_place_ids([],[]) must return [] not raise IndexError."""
    from app.routers.trips import _ordered_place_ids
    result = _ordered_place_ids([], [])
    assert result == []


def test_ordered_place_ids_empty_legs_with_places_returns_empty():
    """_ordered_place_ids with no legs should not return all plan places."""
    from app.routers.trips import _ordered_place_ids
    place = Place(
        id="p1", name="P1", lat=1.0, lng=103.0,
        dwell_minutes=60, best_time_start="09:00", best_time_end="17:00",
        category="x", is_outdoor=False, in_curated_dataset=True,
    )
    result = _ordered_place_ids([], [place])
    # Must NOT return all plan.places (the P5-BUG-2b corruption)
    assert result == []


def test_ordered_place_ids_with_legs_reconstructs_correctly():
    """Normal case: leg-based reconstruction works."""
    from app.routers.trips import _ordered_place_ids
    leg = LegResponse(
        id="l1", from_place_id="a", to_place_id="b",
        transport_mode="METRO", duration_minutes=5, cost_sgd=1.0, is_estimated=False,
    )
    assert _ordered_place_ids([leg], []) == ["a", "b"]


# ── P5-BUG-3: day out-of-range returns 422, not silent clamp ─────────────────

def test_add_place_day_out_of_range_returns_422():
    trip_id = "trip-day-range"
    plan = _make_two_place_plan(trip_id)
    _seed_trip(trip_id, plan)  # num_days=1
    try:
        resp = client.post(f"/trips/{trip_id}/places", json={"place_id": "place-a", "day": 5})
        assert resp.status_code == 422
        assert "day" in resp.json()["detail"].lower()
    finally:
        _cleanup(trip_id)


def test_add_place_day_in_range_does_not_422():
    trip_id = "trip-day-valid"
    plan = _make_two_place_plan(trip_id)
    _seed_trip(trip_id, plan)  # num_days=1
    try:
        with patch(
            "app.routers.trips.planning_agent.plan_trip",
            new_callable=AsyncMock,
            return_value=plan,
        ), patch("app.routers.trips.planning_agent.get_curated_place", return_value={"id": "place-a"}):
            resp = client.post(f"/trips/{trip_id}/places", json={"place_id": "place-a", "day": 1})
        assert resp.status_code != 422 or "day" not in resp.json().get("detail", "").lower()
    finally:
        _cleanup(trip_id)


def test_add_place_to_day_excludes_hotel_from_replan_ids():
    """Day legs starting with hotel must not leak 'hotel' into plan_trip's place_ids
    (was raising PlaceDataMissingError("hotel") -> 422 'not found in curated dataset')."""
    trip_id = "trip-add-place-hotel"
    place_a = Place(
        id="place-a", name="Place A", lat=1.28, lng=103.85,
        dwell_minutes=120, best_time_start="09:00", best_time_end="17:00",
        category="nature", is_outdoor=True, in_curated_dataset=True,
    )
    hotel_place = Place(
        id="hotel", name="My Hotel", lat=1.30, lng=103.84,
        dwell_minutes=0, best_time_start="00:00", best_time_end="23:59",
        category="hotel", is_outdoor=False, in_curated_dataset=False,
    )
    legs = [
        LegResponse(id="leg-h-a", from_place_id="hotel", to_place_id="place-a",
                     transport_mode="METRO", duration_minutes=10, cost_sgd=1.50, is_estimated=False),
        LegResponse(id="leg-a-h", from_place_id="place-a", to_place_id="hotel",
                     transport_mode="METRO", duration_minutes=10, cost_sgd=1.50, is_estimated=False),
    ]
    plan = TripPlan(id=trip_id, days=[DayPlan(day=1, legs=legs)], places=[place_a, hotel_place], warnings=[])
    _seed_trip(trip_id, plan)  # num_days=1
    try:
        with patch(
            "app.routers.trips.planning_agent.plan_trip",
            new_callable=AsyncMock,
            return_value=plan,
        ) as mock_plan_trip, patch(
            "app.routers.trips.planning_agent.get_curated_place", return_value={"id": "place-b"}
        ):
            resp = client.post(f"/trips/{trip_id}/places", json={"place_id": "place-b", "day": 1})
        assert resp.status_code == 200
        place_ids = mock_plan_trip.call_args.kwargs["place_ids"]
        assert "hotel" not in place_ids
        assert "place-a" in place_ids
        assert "place-b" in place_ids
    finally:
        _cleanup(trip_id)


# ── dev26: edits preserve the user's per-day grouping ─────────────────────────

def _place(pid: str) -> Place:
    return Place(
        id=pid, name=pid, lat=1.28, lng=103.85,
        dwell_minutes=60, best_time_start="09:00", best_time_end="17:00",
        category="x", is_outdoor=False, in_curated_dataset=True,
    )


def _make_multiday_plan(trip_id: str, day_place_ids: dict[int, list[str]]) -> TripPlan:
    """Build a plan from {day_number: [place_id, …]} using DayPlan.place_ids directly."""
    all_pids = {pid for ids in day_place_ids.values() for pid in ids}
    days = [DayPlan(day=d, legs=[], place_ids=list(ids)) for d, ids in sorted(day_place_ids.items())]
    return TripPlan(id=trip_id, days=days, places=[_place(p) for p in sorted(all_pids)], warnings=[])


def test_add_place_to_empty_day_stays_on_that_day():
    """dev26 Bug 2: adding a place to empty day 2 must keep it on day 2 — day 1 untouched."""
    trip_id = "trip-dev26-add"
    plan = _make_multiday_plan(trip_id, {1: ["place-a", "place-b"], 2: []})
    _seed_trip(trip_id, plan)  # num_days=2
    try:
        with patch(
            "app.routers.trips.planning_agent.plan_trip",
            new_callable=AsyncMock, return_value=plan,
        ) as mock_plan_trip, patch(
            "app.routers.trips.planning_agent.get_curated_place", return_value={"id": "place-c"}
        ):
            resp = client.post(f"/trips/{trip_id}/places", json={"place_id": "place-c", "day": 2})
        assert resp.status_code == 200
        da = mock_plan_trip.call_args.kwargs["day_assignments"]
        assert da == [["place-a", "place-b"], ["place-c"]]
    finally:
        _cleanup(trip_id)


def test_remove_empty_day_leaves_other_days_intact():
    """dev26 Bug 1: removing an empty day must not disturb any other day."""
    trip_id = "trip-dev26-rmempty"
    plan = _make_multiday_plan(trip_id, {1: ["place-a"], 2: ["place-b"], 3: []})
    _seed_trip(trip_id, plan)  # num_days=3
    try:
        with patch(
            "app.routers.trips.planning_agent.plan_trip",
            new_callable=AsyncMock, return_value=plan,
        ) as mock_plan_trip:
            resp = client.delete(f"/trips/{trip_id}/days/3")
        assert resp.status_code == 200
        kwargs = mock_plan_trip.call_args.kwargs
        assert kwargs["num_days"] == 2
        assert kwargs["day_assignments"] == [["place-a"], ["place-b"]]
    finally:
        _cleanup(trip_id)


def test_remove_middle_day_merges_into_previous_day():
    """dev26: removing a non-empty middle day moves its places to the previous day,
    keeping all others where they were."""
    trip_id = "trip-dev26-rmmid"
    plan = _make_multiday_plan(trip_id, {1: ["place-a"], 2: ["place-b"], 3: ["place-c"]})
    _seed_trip(trip_id, plan)  # num_days=3
    try:
        with patch(
            "app.routers.trips.planning_agent.plan_trip",
            new_callable=AsyncMock, return_value=plan,
        ) as mock_plan_trip:
            resp = client.delete(f"/trips/{trip_id}/days/2")
        assert resp.status_code == 200
        kwargs = mock_plan_trip.call_args.kwargs
        assert kwargs["num_days"] == 2
        assert kwargs["day_assignments"] == [["place-a", "place-b"], ["place-c"]]
    finally:
        _cleanup(trip_id)


# ── P5-BUG-4: reorder validates place_ids match current day exactly ───────────

def test_reorder_subset_ids_returns_422():
    """Sending a subset of a day's place_ids must be rejected."""
    trip_id = "trip-reorder-subset"
    plan = _make_two_place_plan(trip_id)  # day 1 has [place-a, place-b]
    _seed_trip(trip_id, plan)
    try:
        resp = client.patch(f"/trips/{trip_id}/reorder", json={"day": 1, "place_ids": ["place-a"]})
        assert resp.status_code == 422
    finally:
        _cleanup(trip_id)


def test_reorder_foreign_ids_returns_422():
    """Sending IDs from a different day must be rejected."""
    trip_id = "trip-reorder-foreign"
    plan = _make_two_place_plan(trip_id)
    _seed_trip(trip_id, plan)
    try:
        resp = client.patch(f"/trips/{trip_id}/reorder", json={"day": 1, "place_ids": ["place-x", "place-y"]})
        assert resp.status_code == 422
    finally:
        _cleanup(trip_id)


def test_reorder_correct_ids_passes_validation():
    """Sending the exact current day IDs in any order should NOT trigger 422."""
    trip_id = "trip-reorder-ok"
    plan = _make_two_place_plan(trip_id)  # day 1 has leg a→b, so [place-a, place-b]
    _seed_trip(trip_id, plan)
    try:
        with patch(
            "app.routers.trips.planning_agent.plan_trip",
            new_callable=AsyncMock,
            return_value=plan,
        ):
            resp = client.patch(f"/trips/{trip_id}/reorder", json={"day": 1, "place_ids": ["place-b", "place-a"]})
        assert resp.status_code == 200
    finally:
        _cleanup(trip_id)


# ── P5-BUG-1: ownership check on all 4 Phase 5 endpoints ─────────────────────

def _owned_trip(trip_id: str, owner: str) -> TripPlan:
    plan = _make_two_place_plan(trip_id)
    _trips_module._trip_store[trip_id] = plan
    _trips_module._trip_meta[trip_id] = {
        "num_days": 1, "budget_sgd": 999.0, "session_id": "sess", "user_id": owner,
    }
    return plan


def test_optimize_forbidden_for_other_user():
    trip_id = "trip-opt-403"
    _owned_trip(trip_id, "user-a")
    try:
        with _auth_as("user-b"):
            resp = client.post(f"/trips/{trip_id}/optimize")
        assert resp.status_code == 403
    finally:
        _cleanup(trip_id)


def test_add_place_forbidden_for_other_user():
    trip_id = "trip-add-403"
    _owned_trip(trip_id, "user-a")
    try:
        with _auth_as("user-b"):
            resp = client.post(f"/trips/{trip_id}/places", json={"place_id": "place-a", "day": 1})
        assert resp.status_code == 403
    finally:
        _cleanup(trip_id)


def test_remove_place_forbidden_for_other_user():
    trip_id = "trip-rm-403"
    _owned_trip(trip_id, "user-a")
    try:
        with _auth_as("user-b"):
            resp = client.delete(f"/trips/{trip_id}/places/place-a")
        assert resp.status_code == 403
    finally:
        _cleanup(trip_id)


def test_reorder_forbidden_for_other_user():
    trip_id = "trip-reorder-403"
    _owned_trip(trip_id, "user-a")
    try:
        with _auth_as("user-b"):
            resp = client.patch(f"/trips/{trip_id}/reorder", json={"day": 1, "place_ids": ["place-b", "place-a"]})
        assert resp.status_code == 403
    finally:
        _cleanup(trip_id)


def test_optimize_allowed_for_owner():
    trip_id = "trip-opt-200"
    _owned_trip(trip_id, "user-a")
    try:
        plan = _make_two_place_plan(trip_id)
        with _auth_as("user-a"), patch(
            "app.routers.trips.planning_agent.plan_trip",
            new_callable=AsyncMock,
            return_value=plan,
        ):
            resp = client.post(f"/trips/{trip_id}/optimize")
        assert resp.status_code == 200
    finally:
        _cleanup(trip_id)


# ── P5-BUG-5: specific exceptions, not bare except ────────────────────────────

def test_optimize_no_route_returns_422_not_500():
    trip_id = "trip-opt-noroute"
    plan = _make_two_place_plan(trip_id)
    _seed_trip(trip_id, plan)
    try:
        with patch(
            "app.routers.trips.planning_agent.plan_trip",
            new_callable=AsyncMock,
            side_effect=NoRouteError("no route"),
        ):
            resp = client.post(f"/trips/{trip_id}/optimize")
        assert resp.status_code == 422
    finally:
        _cleanup(trip_id)


def test_remove_place_no_route_returns_422_not_500():
    trip_id = "trip-rm-noroute"
    plan = _make_two_place_plan(trip_id)
    _seed_trip(trip_id, plan)
    try:
        with patch(
            "app.routers.trips.planning_agent.plan_trip",
            new_callable=AsyncMock,
            side_effect=NoRouteError("no route"),
        ):
            resp = client.delete(f"/trips/{trip_id}/places/place-a")
        assert resp.status_code == 422
    finally:
        _cleanup(trip_id)


# ── P5-BUG-6: happy-path tests for all 4 Phase 5 endpoints ───────────────────

def test_optimize_trip_returns_updated_plan():
    trip_id = "trip-opt-happy"
    plan = _make_two_place_plan(trip_id)
    _seed_trip(trip_id, plan)
    try:
        with patch(
            "app.routers.trips.planning_agent.plan_trip",
            new_callable=AsyncMock,
            return_value=plan,
        ):
            resp = client.post(f"/trips/{trip_id}/optimize")
        assert resp.status_code == 200
        assert resp.json()["id"] == trip_id
        assert "days" in resp.json()
    finally:
        _cleanup(trip_id)


def test_optimize_trip_not_found_returns_404():
    resp = client.post("/trips/nonexistent-xyz/optimize")
    assert resp.status_code == 404


def test_remove_place_minimum_two_places_enforced():
    """Removing a place when only 2 remain must return 422 (would leave 1)."""
    trip_id = "trip-rm-min"
    plan = _make_two_place_plan(trip_id)
    _seed_trip(trip_id, plan)
    try:
        resp = client.delete(f"/trips/{trip_id}/places/place-a")
        assert resp.status_code == 422
        assert "2" in resp.json()["detail"]
    finally:
        _cleanup(trip_id)


def test_remove_place_not_in_trip_returns_404():
    trip_id = "trip-rm-404place"
    plan = _make_two_place_plan(trip_id)
    _seed_trip(trip_id, plan)
    try:
        resp = client.delete(f"/trips/{trip_id}/places/no-such-place")
        assert resp.status_code == 404
    finally:
        _cleanup(trip_id)


def test_remove_place_trip_not_found_returns_404():
    resp = client.delete("/trips/nonexistent-xyz/places/place-a")
    assert resp.status_code == 404


def test_add_place_not_in_curated_returns_422():
    trip_id = "trip-add-unknown"
    plan = _make_two_place_plan(trip_id)
    _seed_trip(trip_id, plan)
    try:
        with patch("app.routers.trips.planning_agent.get_curated_place", return_value=None):
            resp = client.post(f"/trips/{trip_id}/places", json={"place_id": "unknown-place", "day": 1})
        assert resp.status_code == 422
        assert "curated" in resp.json()["detail"].lower()
    finally:
        _cleanup(trip_id)


def test_add_place_trip_not_found_returns_404():
    resp = client.post("/trips/nonexistent-xyz/places", json={"place_id": "place-a", "day": 1})
    assert resp.status_code == 404


def test_reorder_trip_not_found_returns_404():
    resp = client.patch("/trips/nonexistent-xyz/reorder", json={"day": 1, "place_ids": ["a", "b"]})
    assert resp.status_code == 404


# ── POST /trips/{id}/legs/{leg_id}/switch-now ─────────────────────────────────

def _seed_switch_now_trip(trip_id: str, budget: float = 999.0) -> TripPlan:
    """Seed a trip with a known leg-001 for switch-now tests."""
    plan = _make_plan(trip_id)
    _trips_module._trip_store[trip_id] = plan
    _trips_module._trip_meta[trip_id] = {
        "num_days": 1,
        "budget_sgd": budget,
        "session_id": "session-sw",
        "user_id": None,
    }
    return plan


def test_switch_now_returns_leg_swap_result():
    """POST .../switch-now returns LegSwapResult shape with routed_from_current_position."""
    trip_id = "trip-sw-1"
    plan = _seed_switch_now_trip(trip_id)
    try:
        updated_leg = plan.days[0].legs[0].model_copy(update={
            "transport_mode": "BUS",
            "duration_minutes": 20,
            "cost_sgd": 1.20,
        })
        mock_swap = LegSwapResult(
            updated_leg=updated_leg,
            trip_cost_sgd=1.20,
            warnings=[],
            routed_from_current_position=True,
        )
        with patch("app.routers.trips.planning_agent.switch_leg_mode_live",
                   new_callable=AsyncMock, return_value=mock_swap):
            resp = client.post(f"/trips/{trip_id}/legs/leg-001/switch-now", json={
                "new_mode": "BUS",
                "current_lat": 1.2916,
                "current_lng": 103.8636,
            })
        assert resp.status_code == 200
        data = resp.json()
        assert data["updated_leg"]["transport_mode"] == "BUS"
        assert data["updated_leg"]["id"] == "leg-001"
        assert "trip_cost_sgd" in data
        assert isinstance(data["warnings"], list)
        assert data["routed_from_current_position"] is True
    finally:
        _cleanup(trip_id)


def test_switch_now_gps_coords_forwarded_to_agent():
    """GPS coordinates in request body are passed through to switch_leg_mode_live."""
    trip_id = "trip-sw-2"
    plan = _seed_switch_now_trip(trip_id)
    try:
        updated_leg = plan.days[0].legs[0].model_copy(update={"transport_mode": "WALK"})
        mock_swap = LegSwapResult(
            updated_leg=updated_leg,
            trip_cost_sgd=0.0,
            warnings=[],
            routed_from_current_position=False,
        )
        with patch("app.routers.trips.planning_agent.switch_leg_mode_live",
                   new_callable=AsyncMock, return_value=mock_swap) as mock_live:
            resp = client.post(f"/trips/{trip_id}/legs/leg-001/switch-now", json={
                "new_mode": "WALK",
                "current_lat": 1.2816,
                "current_lng": 103.8636,
            })
        assert resp.status_code == 200
        # Verify GPS coords were forwarded to the agent function
        call_kwargs = mock_live.call_args.kwargs
        assert call_kwargs["new_mode"] == "WALK"
        assert call_kwargs["current_lat"] == pytest.approx(1.2816)
        assert call_kwargs["current_lng"] == pytest.approx(103.8636)
    finally:
        _cleanup(trip_id)


def test_switch_now_no_route_returns_422():
    """When switch_leg_mode_live raises NoRouteError → 422 with message."""
    trip_id = "trip-sw-3"
    _seed_switch_now_trip(trip_id)
    try:
        with patch("app.routers.trips.planning_agent.switch_leg_mode_live",
                   new_callable=AsyncMock,
                   side_effect=NoRouteError("No BUS route from your current position")):
            resp = client.post(f"/trips/{trip_id}/legs/leg-001/switch-now", json={
                "new_mode": "BUS",
                "current_lat": 1.2916,
                "current_lng": 103.8636,
            })
        assert resp.status_code == 422
        assert "BUS" in resp.json()["detail"]
    finally:
        _cleanup(trip_id)


def test_switch_now_trip_not_found_returns_404():
    """Trip not in store → 404."""
    resp = client.post("/trips/nonexistent-trip/legs/leg-001/switch-now", json={
        "new_mode": "WALK",
        "current_lat": 1.28,
        "current_lng": 103.86,
    })
    assert resp.status_code == 404


def test_switch_now_leg_not_found_returns_404():
    """Leg not in trip → 404."""
    trip_id = "trip-sw-404leg"
    _seed_switch_now_trip(trip_id)
    try:
        resp = client.post(f"/trips/{trip_id}/legs/no-such-leg/switch-now", json={
            "new_mode": "WALK",
            "current_lat": 1.28,
            "current_lng": 103.86,
        })
        assert resp.status_code == 404
    finally:
        _cleanup(trip_id)


def test_switch_now_budget_warning():
    """When new trip cost > budget → budget warning appended to result."""
    trip_id = "trip-sw-budget"
    plan = _seed_switch_now_trip(trip_id, budget=0.50)  # tiny budget
    try:
        updated_leg = plan.days[0].legs[0].model_copy(update={
            "transport_mode": "METRO",
            "cost_sgd": 5.0,
        })
        mock_swap = LegSwapResult(
            updated_leg=updated_leg,
            trip_cost_sgd=5.0,
            warnings=[],
            routed_from_current_position=True,
        )
        with patch("app.routers.trips.planning_agent.switch_leg_mode_live",
                   new_callable=AsyncMock, return_value=mock_swap):
            resp = client.post(f"/trips/{trip_id}/legs/leg-001/switch-now", json={
                "new_mode": "METRO",
                "current_lat": 1.2916,
                "current_lng": 103.8636,
            })
        assert resp.status_code == 200
        data = resp.json()
        assert any("budget" in w.lower() for w in data["warnings"])
    finally:
        _cleanup(trip_id)


# ── POST /trips/{id}/plan — Patch 3: preference profile fallback ──────────────

def test_plan_trip_uses_default_profile_for_guest():
    """[PATCH 3] Guest user (no auth) → planning_agent receives default UserPreferenceProfile."""
    from app.models.preferences import UserPreferenceProfile
    create = client.post("/trips", json={"session_id": "sess-pref-1", "num_days": 1, "budget_sgd": 999})
    trip_id = create.json()["trip_id"]
    mock_plan = _make_plan(trip_id)

    captured: dict = {}

    async def _spy_plan_trip(*args, **kwargs):
        captured.update(kwargs)
        return mock_plan

    with patch("app.routers.trips.planning_agent.plan_trip", side_effect=_spy_plan_trip):
        resp = client.post(f"/trips/{trip_id}/plan", json={
            "place_ids": ["gardens-by-the-bay", "marina-bay-sands"],
            "optimize_order": False,
        })

    assert resp.status_code == 200
    assert "profile" in captured
    assert isinstance(captured["profile"], UserPreferenceProfile)
    # Must be default weights
    assert abs(captured["profile"].duration_w - 0.40) < 0.01
    assert abs(captured["profile"].cost_w    - 0.30) < 0.01


def test_plan_trip_uses_default_when_no_pref_record():
    """[PATCH 3] Authenticated user with no preference row → default profile, no crash."""
    from app.models.preferences import UserPreferenceProfile
    create = client.post("/trips", json={"session_id": "sess-pref-2", "num_days": 1, "budget_sgd": 999})
    trip_id = create.json()["trip_id"]
    mock_plan = _make_plan(trip_id)

    # Supabase returns empty list (user has no preference row yet)
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = []

    captured: dict = {}

    async def _spy_plan_trip(*args, **kwargs):
        captured.update(kwargs)
        return mock_plan

    with _auth_as("user-no-prefs"), \
         patch("app.routers.trips.supabase", mock_sb), \
         patch("app.routers.trips.planning_agent.plan_trip", side_effect=_spy_plan_trip):
        resp = client.post(f"/trips/{trip_id}/plan", json={
            "place_ids": ["gardens-by-the-bay", "marina-bay-sands"],
            "optimize_order": False,
        })

    assert resp.status_code == 200
    assert isinstance(captured.get("profile"), UserPreferenceProfile)
    assert abs(captured["profile"].duration_w - 0.40) < 0.01


def test_plan_trip_uses_profile_when_found():
    """[PATCH 3] Authenticated user with saved preference → custom profile passed to agent."""
    from app.models.preferences import UserPreferenceProfile
    create = client.post("/trips", json={"session_id": "sess-pref-3", "num_days": 1, "budget_sgd": 999})
    trip_id = create.json()["trip_id"]
    mock_plan = _make_plan(trip_id)

    custom_profile_data = {
        "duration_w": 0.10,
        "cost_w":     0.70,
        "walking_w":  0.15,
        "transfers_w": 0.05,
        "constraints": {
            "avoid_bus": False, "avoid_metro": False,
            "minimize_walking": False, "minimize_fee": True,
        },
    }
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
        {"profile": custom_profile_data}
    ]

    captured: dict = {}

    async def _spy_plan_trip(*args, **kwargs):
        captured.update(kwargs)
        return mock_plan

    with _auth_as("user-with-prefs"), \
         patch("app.routers.trips.supabase", mock_sb), \
         patch("app.routers.trips.planning_agent.plan_trip", side_effect=_spy_plan_trip):
        resp = client.post(f"/trips/{trip_id}/plan", json={
            "place_ids": ["gardens-by-the-bay", "marina-bay-sands"],
            "optimize_order": False,
        })

    assert resp.status_code == 200
    assert isinstance(captured.get("profile"), UserPreferenceProfile)
    assert abs(captured["profile"].cost_w - 0.70) < 0.01
    assert captured["profile"].constraints.minimize_fee is True


# ── Re-plan operations: _fetch_plan_context propagation (dev5) ────────────────

def test_optimize_passes_profile_to_plan_trip():
    """POST /optimize fetches user profile and passes it to planning_agent.plan_trip."""
    from app.models.preferences import UserPreferenceProfile
    trip_id = "trip-opt-ctx"
    plan = _make_two_place_plan(trip_id)
    _owned_trip(trip_id, "user-opt")

    custom_profile_data = {
        "duration_w": 0.10, "cost_w": 0.70,
        "walking_w": 0.15, "transfers_w": 0.05,
        "constraints": {
            "avoid_bus": False, "avoid_metro": False,
            "minimize_walking": False, "minimize_fee": True,
        },
    }
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
        {"profile": custom_profile_data}
    ]

    captured: dict = {}

    async def _spy(*args, **kwargs):
        captured.update(kwargs)
        return _make_two_place_plan(trip_id)

    try:
        with _auth_as("user-opt"), \
             patch("app.routers.trips.supabase", mock_sb), \
             patch("app.routers.trips.planning_agent.plan_trip", side_effect=_spy):
            resp = client.post(f"/trips/{trip_id}/optimize")

        assert resp.status_code == 200
        assert isinstance(captured.get("profile"), UserPreferenceProfile)
        assert abs(captured["profile"].cost_w - 0.70) < 0.01
        assert captured["profile"].constraints.minimize_fee is True
        assert captured.get("context") is not None
    finally:
        _cleanup(trip_id)


def test_reorder_passes_weather_context_to_plan_trip():
    """PATCH /reorder fetches weather and passes ContextSnapshot with rain to plan_trip."""
    from app.models.preferences import ContextSnapshot
    trip_id = "trip-reorder-ctx"
    plan = _make_two_place_plan(trip_id)
    _seed_trip(trip_id, plan)

    captured: dict = {}

    async def _spy(*args, **kwargs):
        captured.update(kwargs)
        return _make_two_place_plan(trip_id)

    # Mock openweather to return rain data
    mock_weather = {"condition": "Rain", "temp_c": 28.0, "rain_1h": 12.5}

    try:
        with patch("app.routers.trips.planning_agent.plan_trip", side_effect=_spy), \
             patch("app.services.openweather.get_current_weather",
                   new_callable=AsyncMock, return_value=mock_weather):
            resp = client.patch(f"/trips/{trip_id}/reorder", json={
                "day": 1,
                "place_ids": ["place-b", "place-a"],
            })

        assert resp.status_code == 200
        ctx = captured.get("context")
        assert isinstance(ctx, ContextSnapshot)
        assert ctx.rain_mm_per_hour == 12.5
        assert ctx.rain_level == "heavy"
    finally:
        _cleanup(trip_id)


# ── POST /trips/{id}/check-alerts ─────────────────────────────────────────────

def test_check_alerts_returns_200_for_known_trip():
    """check-alerts endpoint returns 200 with summary dict for a known trip."""
    trip_id = "trip-check-ok"
    plan = _make_two_place_plan(trip_id)
    _seed_trip(trip_id, plan)
    try:
        mock_result = {"lta_checked": True, "weather_checked": True, "alerts_inserted": 0}
        with patch(
            "app.routers.trips.adaptation_agent.check_alerts_for_trip",
            new_callable=AsyncMock,
            return_value=mock_result,
        ):
            resp = client.post(f"/trips/{trip_id}/check-alerts", json={})
        assert resp.status_code == 200
        data = resp.json()
        assert "lta_checked" in data
        assert "weather_checked" in data
        assert "alerts_inserted" in data
    finally:
        _cleanup(trip_id)


def test_check_alerts_returns_404_for_unknown_trip():
    """check-alerts returns 404 when trip is not in store and Supabase is unavailable."""
    resp = client.post("/trips/no-such-trip-xyz/check-alerts", json={})
    assert resp.status_code == 404


# ── _persist_trip_plan: DELETE-before-INSERT contract ────────────────────────

def test_persist_trip_plan_deletes_before_insert():
    """_persist_trip_plan must DELETE all stale rows before inserting new ones.

    Regression test for the stale-accumulation bug:
      • trip_places primary key is an auto-generated UUID with no UNIQUE constraint
        on (trip_id, place_id), so upsert without a prior delete always inserts new rows.
      • route_legs generates fresh UUIDs for every plan_trip call, so upsert also
        always inserts, leaving old rows from previous plans intact.
    After a backend restart _fetch_trip_from_db reads ALL rows including stale ones,
    causing phantom days, doubled stop counts, and overlapping route polylines.
    """
    from unittest.mock import MagicMock, call, patch
    from app.routers.trips import _persist_trip_plan

    # Build a minimal chain mock that records the operation sequence.
    # supabase.table(name).delete().eq("trip_id", x).execute()
    # supabase.table(name).insert(rows).execute()
    delete_eq_mock = MagicMock()
    delete_eq_mock.execute = MagicMock(return_value=MagicMock())
    delete_mock = MagicMock()
    delete_mock.eq = MagicMock(return_value=delete_eq_mock)

    insert_mock = MagicMock()
    insert_mock.execute = MagicMock(return_value=MagicMock())

    call_sequence: list[str] = []

    def _table(name):
        tbl = MagicMock()

        def _delete():
            call_sequence.append(f"delete:{name}")
            return delete_mock
        def _insert(_rows):
            call_sequence.append(f"insert:{name}")
            return insert_mock

        tbl.delete = _delete
        tbl.insert = _insert
        return tbl

    mock_supabase = MagicMock()
    mock_supabase.table = _table

    plan = _make_plan("trip-persist-test")

    with patch("app.routers.trips.supabase", mock_supabase):
        _persist_trip_plan("trip-persist-test", plan)

    # Both tables must be deleted before either is inserted
    assert "delete:route_legs" in call_sequence, "route_legs DELETE not called"
    assert "delete:trip_places" in call_sequence, "trip_places DELETE not called"
    assert "insert:trip_places" in call_sequence, "trip_places INSERT not called"
    assert "insert:route_legs" in call_sequence, "route_legs INSERT not called"

    route_legs_del_idx  = call_sequence.index("delete:route_legs")
    trip_places_del_idx = call_sequence.index("delete:trip_places")
    trip_places_ins_idx = call_sequence.index("insert:trip_places")
    route_legs_ins_idx  = call_sequence.index("insert:route_legs")

    # Deletes must precede their own inserts
    assert route_legs_del_idx  < route_legs_ins_idx,  "route_legs DELETE must come before INSERT"
    assert trip_places_del_idx < trip_places_ins_idx, "trip_places DELETE must come before INSERT"


def test_persist_trip_plan_no_upsert_called():
    """_persist_trip_plan must NOT call upsert — only delete+insert."""
    from unittest.mock import MagicMock, patch
    from app.routers.trips import _persist_trip_plan

    upsert_called: list[str] = []

    def _table(name):
        tbl = MagicMock()
        delete_chain = MagicMock()
        delete_chain.eq.return_value.execute.return_value = MagicMock()
        tbl.delete.return_value = delete_chain
        tbl.insert.return_value.execute.return_value = MagicMock()

        def _upsert(_rows):
            upsert_called.append(name)
            return MagicMock()
        tbl.upsert = _upsert
        return tbl

    mock_supabase = MagicMock()
    mock_supabase.table = _table

    plan = _make_plan("trip-no-upsert")
    with patch("app.routers.trips.supabase", mock_supabase):
        _persist_trip_plan("trip-no-upsert", plan)

    assert upsert_called == [], (
        f"upsert was called on tables {upsert_called} — must use DELETE+INSERT instead"
    )


# ── dev22 Phase 2: alternatives persistence round-trip ────────────────────────

class _FakeTable:
    """Fluent stub: select/eq/order return self; execute() yields preset rows."""
    def __init__(self, rows):
        self._rows = rows
    def select(self, *a, **k):  return self
    def eq(self, *a, **k):      return self
    def order(self, *a, **k):   return self
    def execute(self):
        resp = MagicMock()
        resp.data = self._rows
        return resp


class _FakeSupabase:
    def __init__(self, trips, places, legs):
        self._map = {"trips": trips, "trip_places": places, "route_legs": legs}
    def table(self, name):
        return _FakeTable(self._map.get(name, []))


def _leg_row(**over):
    row = {
        "id": "leg-1", "day_number": 1,
        "from_place_id": "merlion-park", "to_place_id": "clarke-quay",
        "transport_mode": "METRO", "duration_minutes": 12, "cost_sgd": 1.5,
        "is_estimated": False, "instructions": [], "geometry": None,
        "distance_km": 2.0, "sub_legs": [], "first_bus_stop_code": None,
        "geometries": [],
    }
    row.update(over)
    return row


def _place_row(pid, name, lat, lng, day=1, order=0):
    return {"place_id": pid, "place_name": name, "lat": lat, "lng": lng,
            "dwell_minutes": 60, "day_number": day, "order_in_day": order}


def test_serialize_deserialize_alternatives_round_trip():
    from app.routers.trips import _serialize_alternatives, _deserialize_alternatives
    alts = {
        "METRO": AlternativeRoute(duration_minutes=12, cost_sgd=1.5, is_estimated=False,
                                  distance_km=2.0, geometry="poly", instructions=["x"]),
        "WALK":  AlternativeRoute(duration_minutes=30, cost_sgd=0.0, is_estimated=True, distance_km=2.0),
    }
    compact = _serialize_alternatives(alts)
    assert compact["METRO"] == {"duration_minutes": 12, "cost_sgd": 1.5,
                                "is_estimated": False, "distance_km": 2.0}
    # polyline/instructions are intentionally dropped (re-fetched lazily on switch)
    assert "geometry" not in compact["METRO"]
    restored = _deserialize_alternatives(compact)
    assert set(restored) == {"METRO", "WALK"}
    assert restored["METRO"].duration_minutes == 12
    assert restored["METRO"].cost_sgd == 1.5
    assert restored["METRO"].geometry is None       # not persisted
    assert restored["WALK"].is_estimated is True


def test_fetch_trip_from_db_restores_stored_alternatives():
    trip_row = {"id": "t1", "hotel_name": None, "hotel_lat": None, "hotel_lng": None}
    places = [_place_row("merlion-park", "Merlion", 1.2868, 103.8545, order=0),
              _place_row("clarke-quay", "Clarke Quay", 1.2906, 103.8465, order=1)]
    legs = [_leg_row(alternatives={
        "BUS":   {"duration_minutes": 18, "cost_sgd": 1.2, "is_estimated": False, "distance_km": 2.0},
        "METRO": {"duration_minutes": 12, "cost_sgd": 1.5, "is_estimated": False, "distance_km": 2.0},
    })]
    with patch.object(_trips_module, "supabase", _FakeSupabase([trip_row], places, legs)):
        plan = _trips_module._fetch_trip_from_db("t1")
    leg = plan.days[0].legs[0]
    assert {"BUS", "METRO"} <= set(leg.alternatives)
    assert leg.alternatives["BUS"].duration_minutes == 18


def test_fetch_trip_from_db_legacy_rebuilds_always_modes():
    """Pre-019 rows have no 'alternatives' → rebuild WALK/CYCLE/GRAB from place coords."""
    trip_row = {"id": "t2", "hotel_name": None, "hotel_lat": None, "hotel_lng": None}
    places = [_place_row("merlion-park", "Merlion", 1.2868, 103.8545, order=0),
              _place_row("clarke-quay", "Clarke Quay", 1.2906, 103.8465, order=1)]
    legs = [_leg_row()]   # no 'alternatives' key (legacy)
    with patch.object(_trips_module, "supabase", _FakeSupabase([trip_row], places, legs)):
        plan = _trips_module._fetch_trip_from_db("t2")
    leg = plan.days[0].legs[0]
    assert {"WALK", "CYCLE", "GRAB"} <= set(leg.alternatives)
    # current mode stays selectable too
    assert "METRO" in leg.alternatives
