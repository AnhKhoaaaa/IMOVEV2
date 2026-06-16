from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient

from app.dependencies import get_current_user
from app.main import app
from app.models.place import Place
from app.models.trip import DayPlan, LegResponse, TripPlan
import app.routers.trips as trips


client = TestClient(app)


@contextmanager
def _auth_as(user_id: str | None):
    async def _mock():
        return user_id

    app.dependency_overrides[get_current_user] = _mock
    try:
        yield
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def _make_plan(trip_id: str) -> TripPlan:
    place = Place(
        id="place-a",
        name="Place A",
        lat=1.28,
        lng=103.85,
        dwell_minutes=60,
        best_time_start="09:00",
        best_time_end="17:00",
        category="culture",
        is_outdoor=False,
        in_curated_dataset=True,
    )
    leg = LegResponse(
        id="leg-a",
        from_place_id="place-a",
        to_place_id="place-b",
        transport_mode="WALK",
        duration_minutes=10,
        cost_sgd=0,
        is_estimated=False,
    )
    return TripPlan(
        id=trip_id,
        days=[DayPlan(day=1, legs=[leg])],
        places=[place],
        warnings=[],
    )


def _seed_owned_trip(trip_id: str, owner: str) -> None:
    trips._trip_store[trip_id] = _make_plan(trip_id)
    trips._trip_meta[trip_id] = {
        "num_days": 1,
        "budget_sgd": 100.0,
        "session_id": "session-owner",
        "user_id": owner,
    }


def test_create_trip_uses_jwt_user_instead_of_spoofed_body_user_id():
    jwt_user = "11111111-1111-1111-1111-111111111111"
    spoofed_user = "22222222-2222-2222-2222-222222222222"

    with _auth_as(jwt_user):
        response = client.post(
            "/trips",
            json={
                "session_id": "session-auth",
                "user_id": spoofed_user,
                "num_days": 1,
                "budget_sgd": 100,
            },
        )

    assert response.status_code == 200
    trip_id = response.json()["trip_id"]
    assert trips._trip_meta[trip_id]["user_id"] == jwt_user


def test_guest_cannot_claim_another_user_id_when_creating_trip():
    spoofed_user = "22222222-2222-2222-2222-222222222222"

    response = client.post(
        "/trips",
        json={
            "session_id": "session-guest",
            "user_id": spoofed_user,
            "num_days": 1,
            "budget_sgd": 100,
        },
    )

    assert response.status_code == 200
    trip_id = response.json()["trip_id"]
    assert trips._trip_meta[trip_id]["user_id"] is None


@pytest.mark.parametrize(
    ("method", "path", "payload"),
    [
        ("get", "/trips/{trip_id}", None),
        (
            "post",
            "/trips/{trip_id}/plan",
            {"place_ids": ["place-a", "place-b"]},
        ),
        (
            "patch",
            "/trips/{trip_id}/legs/leg-a",
            {"transport_mode": "BUS"},
        ),
        (
            "post",
            "/trips/{trip_id}/legs/leg-a/switch-now",
            {"new_mode": "BUS", "current_lat": 1.28, "current_lng": 103.85},
        ),
        ("post", "/trips/{trip_id}/adapt", {"alert_id": "alert-a"}),
        (
            "post",
            "/trips/{trip_id}/location",
            {"lat": 1.28, "lng": 103.85},
        ),
        ("delete", "/trips/{trip_id}", None),
        ("post", "/trips/{trip_id}/accept-swap", {"alert_id": "alert-a"}),
        ("post", "/trips/{trip_id}/check-alerts", {}),
    ],
)
def test_account_trip_rejects_requests_without_jwt(method, path, payload):
    trip_id = "owned-trip"
    _seed_owned_trip(trip_id, "owner-user")

    response = client.request(
        method,
        path.format(trip_id=trip_id),
        json=payload,
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Access denied"


def test_account_trip_rejects_a_different_authenticated_user():
    trip_id = "owned-trip-other-user"
    _seed_owned_trip(trip_id, "owner-user")

    with _auth_as("other-user"):
        response = client.get(f"/trips/{trip_id}")

    assert response.status_code == 403


def test_account_trip_allows_its_owner():
    trip_id = "owned-trip-owner"
    _seed_owned_trip(trip_id, "owner-user")

    with _auth_as("owner-user"):
        response = client.get(f"/trips/{trip_id}")

    assert response.status_code == 200
    assert response.json()["id"] == trip_id


def test_guest_trip_remains_available_without_jwt_for_compatibility():
    trip_id = "guest-trip"
    trips._trip_store[trip_id] = _make_plan(trip_id)
    trips._trip_meta[trip_id] = {
        "num_days": 1,
        "budget_sgd": 100.0,
        "session_id": "session-guest",
        "user_id": None,
    }

    response = client.get(f"/trips/{trip_id}")

    assert response.status_code == 200
