"""Router tests for /chat and /chat/confirm.

/chat is tested with run_chat patched. /chat/confirm is tested for real: it dispatches
to the existing trip handlers in-process, so we seed the in-memory store and patch only
planning_agent.plan_trip (no OneMap/LLM network).
"""
from contextlib import contextmanager

import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient

from app.main import app
from app.dependencies import get_current_user, require_current_user
from app.models.trip import TripPlan, DayPlan, LegResponse
from app.models.place import Place
from app.models.chat import ChatResponse
from app.services.onemap import NoRouteError
from app.agents import chat_agent
from app.agents.planning_agent import get_all_places
import app.routers.trips as _trips_module

client = TestClient(app)


@contextmanager
def _auth_as(user_id):
    async def _mock_get():
        return user_id
    async def _mock_require():
        return user_id  # bypasses the 401 raise so tests can inject None or a real id
    app.dependency_overrides[get_current_user] = _mock_get
    app.dependency_overrides[require_current_user] = _mock_require
    try:
        yield
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(require_current_user, None)


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.setattr(_trips_module, "supabase", None)
    _trips_module._trip_store.clear()
    _trips_module._trip_meta.clear()
    chat_agent.reset()
    yield
    _trips_module._trip_store.clear()
    _trips_module._trip_meta.clear()
    chat_agent.reset()


def _make_plan(trip_id="t1"):
    leg = LegResponse(
        id="leg-001", from_place_id="place-a", to_place_id="place-b",
        transport_mode="METRO", duration_minutes=12, cost_sgd=1.5, is_estimated=False,
    )
    place = Place(
        id="place-a", name="Place A", lat=1.30, lng=103.85,
        dwell_minutes=60, best_time_start="09:00", best_time_end="17:00",
        category="x", is_outdoor=False, in_curated_dataset=True,
    )
    return TripPlan(id=trip_id, days=[DayPlan(day=1, legs=[leg])], places=[place], warnings=[])


def _seed(trip_id, plan, user_id=None):
    _trips_module._trip_store[trip_id] = plan
    _trips_module._trip_meta[trip_id] = {
        "num_days": len(plan.days), "budget_sgd": 999.0,
        "session_id": "sess-seed", "user_id": user_id,
    }


def _a_curated_id():
    return next(iter(get_all_places()))


# ── POST /chat ────────────────────────────────────────────────────────────────

def test_post_chat_happy_path():
    fake = ChatResponse(reply="Xin chào! Bạn muốn đi đâu?")
    with patch.object(chat_agent, "run_chat", new_callable=AsyncMock, return_value=fake):
        with _auth_as(None):
            resp = client.post("/chat", json={"session_id": "s1", "message": "hello"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["reply"].startswith("Xin chào")
    assert body["proposed_action"] is None


# ── POST /chat/confirm ────────────────────────────────────────────────────────

def test_confirm_executes_add_place():
    trip_id = "t1"
    plan = _make_plan(trip_id)
    _seed(trip_id, plan, user_id=None)
    pid = _a_curated_id()
    chat_agent._pending_actions["s9"] = {
        "id": "p9", "tool": "add_place",
        "args": {"place_id": pid, "day": 1}, "trip_id": trip_id, "preview": "Add place",
    }
    with patch("app.routers.trips.planning_agent.plan_trip", new_callable=AsyncMock, return_value=plan):
        with _auth_as(None):
            resp = client.post("/chat/confirm", json={"session_id": "s9", "pending_action_id": "p9"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["executed"] is True
    assert body["trip"] is not None
    assert "s9" not in chat_agent._pending_actions     # pending consumed


def test_confirm_wrong_id_returns_409():
    chat_agent._pending_actions["s10"] = {
        "id": "real-id", "tool": "add_day", "args": {}, "trip_id": "t1", "preview": "x",
    }
    with _auth_as(None):
        resp = client.post("/chat/confirm", json={"session_id": "s10", "pending_action_id": "WRONG"})
    assert resp.status_code == 409


def test_confirm_no_pending_returns_404():
    with _auth_as(None):
        resp = client.post("/chat/confirm", json={"session_id": "nope", "pending_action_id": "x"})
    assert resp.status_code == 404


def test_confirm_other_users_trip_returns_403_even_for_leg_switch():
    """The ownership gap fix: change_leg_mode/switch_leg_now don't self-verify, so
    /chat/confirm must reject a non-owner BEFORE dispatch."""
    trip_id = "t1"
    plan = _make_plan(trip_id)
    _seed(trip_id, plan, user_id="userA")
    chat_agent._pending_actions["s11"] = {
        "id": "p11", "tool": "change_leg_mode",
        "args": {"leg_id": "leg-001", "transport_mode": "BUS"},
        "trip_id": trip_id, "preview": "Change leg",
    }
    with _auth_as("userB"):
        resp = client.post("/chat/confirm", json={"session_id": "s11", "pending_action_id": "p11"})
    assert resp.status_code == 403
    assert "s11" in chat_agent._pending_actions  # not consumed


def test_confirm_handler_error_returns_executed_false_and_keeps_pending():
    trip_id = "t1"
    plan = _make_plan(trip_id)
    _seed(trip_id, plan, user_id=None)
    pid = _a_curated_id()
    chat_agent._pending_actions["s12"] = {
        "id": "p12", "tool": "add_place",
        "args": {"place_id": pid, "day": 1}, "trip_id": trip_id, "preview": "Add place",
    }
    with patch("app.routers.trips.planning_agent.plan_trip",
               new_callable=AsyncMock, side_effect=NoRouteError("no route")):
        with _auth_as(None):
            resp = client.post("/chat/confirm", json={"session_id": "s12", "pending_action_id": "p12"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["executed"] is False
    assert body["trip"] is None
    assert "s12" in chat_agent._pending_actions  # kept for retry


def test_confirm_cancel_discards_pending():
    chat_agent._pending_actions["s13"] = {
        "id": "p13", "tool": "add_day", "args": {}, "trip_id": "t1", "preview": "x",
    }
    with _auth_as(None):
        resp = client.post(
            "/chat/confirm",
            json={"session_id": "s13", "pending_action_id": "p13", "confirm": False},
        )
    assert resp.status_code == 200
    assert resp.json()["executed"] is False
    assert "s13" not in chat_agent._pending_actions


# ── /chat/phrase-alert (dev25 P1 proactive companion) ────────────────────────────

def test_phrase_alert_returns_proactive_message():
    with _auth_as("user-1"), patch(
        "app.routers.chat.gemini.phrase_alert",
        new=AsyncMock(return_value="Heads up — rain near your Day 2 stop around 3pm!"),
    ):
        resp = client.post(
            "/chat/phrase-alert",
            json={
                "alert": {"id": "al-1", "alert_type": "weather_warning",
                          "message": "70% rain", "day_number": 2},
                "lang": "en",
            },
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["text"] == "Heads up — rain near your Day 2 stop around 3pm!"
    assert body["alert_id"] == "al-1"
    assert body["alert_type"] == "weather_warning"
    assert body["day_number"] == 2


def test_phrase_alert_requires_auth():
    # No auth override → real require_current_user raises 401 (supabase is None in tests).
    resp = client.post("/chat/phrase-alert", json={"alert": {"message": "x"}})
    assert resp.status_code == 401


# ── /chat/companion-check (dev25 P5 live GPS companion) ───────────────────────────

def test_companion_check_returns_nudge():
    from app.models.chat import ProactiveMessage
    nudge = ProactiveMessage(text="It's raining near you — your nearest outdoor stop is X.",
                             alert_type="weather_live")
    with _auth_as("user-1"), patch(
        "app.routers.chat.chat_agent.companion_check", new=AsyncMock(return_value=nudge),
    ):
        resp = client.post("/chat/companion-check", json={
            "session_id": "s1", "trip_id": "t1",
            "gps": {"lat": 1.287, "lng": 103.854}, "lang": "en",
        })
    assert resp.status_code == 200
    body = resp.json()
    assert body["nudge"]["alert_type"] == "weather_live"
    assert "raining" in body["nudge"]["text"]


def test_companion_check_returns_null_when_quiet():
    with _auth_as("user-1"), patch(
        "app.routers.chat.chat_agent.companion_check", new=AsyncMock(return_value=None),
    ):
        resp = client.post("/chat/companion-check", json={
            "session_id": "s1", "trip_id": "t1", "gps": {"lat": 1.30, "lng": 103.85},
        })
    assert resp.status_code == 200
    assert resp.json()["nudge"] is None


def test_companion_check_requires_auth():
    resp = client.post("/chat/companion-check", json={
        "session_id": "s1", "trip_id": "t1", "gps": {"lat": 1.30, "lng": 103.85},
    })
    assert resp.status_code == 401
