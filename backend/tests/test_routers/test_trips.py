import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient

from app.main import app
from app.models.trip import TripPlan, DayPlan, LegResponse
from app.models.place import Place
from app.exceptions import PlaceDataMissingError, BudgetExceededError
from app.services.onemap import NoRouteError

client = TestClient(app)


# ── helpers ───────────────────────────────────────────────────────────────────

def _make_plan(trip_id: str = "test-trip") -> TripPlan:
    leg = LegResponse(
        id="leg-001",
        from_place_id="gardens-by-the-bay",
        to_place_id="marina-bay-sands",
        transport_mode="MRT",
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
    r1 = client.post("/trips", json={"session_id": "s1", "num_days": 1, "budget_sgd": 50})
    r2 = client.post("/trips", json={"session_id": "s2", "num_days": 1, "budget_sgd": 50})
    assert r1.json()["trip_id"] != r2.json()["trip_id"]


# ── POST /trips/{id}/plan ─────────────────────────────────────────────────────

def test_plan_trip_returns_tripplan_shape():
    create = client.post("/trips", json={"session_id": "s", "num_days": 1, "budget_sgd": 999})
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
    create = client.post("/trips", json={"session_id": "s", "num_days": 1, "budget_sgd": 999})
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
    create = client.post("/trips", json={"session_id": "s", "num_days": 1, "budget_sgd": 999})
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
    create = client.post("/trips", json={"session_id": "s", "num_days": 1, "budget_sgd": 5})
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
    create = client.post("/trips", json={"session_id": "s", "num_days": 1, "budget_sgd": 999})
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
    create = client.post("/trips", json={"session_id": "s", "num_days": 1, "budget_sgd": 999})
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

    resp = client.patch(f"/trips/{trip_id}/legs/leg-001", json={"transport_mode": "BUS"})
    assert resp.status_code == 200
    assert resp.json()["transport_mode"] == "BUS"
    assert resp.json()["id"] == "leg-001"


def test_patch_leg_not_found_returns_404():
    create = client.post("/trips", json={"session_id": "s", "num_days": 1, "budget_sgd": 999})
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
