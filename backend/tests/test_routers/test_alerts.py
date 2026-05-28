import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient

from app.main import app
from app.dependencies import get_current_user, require_current_user

client = TestClient(app)


def _auth_override(user_id):
    """Return a FastAPI dependency override that yields user_id."""
    async def _dep():
        return user_id
    return _dep


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


# ── POST /alerts/feedback ─────────────────────────────────────────────────────

def test_feedback_no_auth_returns_201():
    with patch("app.agents.memory_agent.save_feedback", new_callable=AsyncMock):
        resp = client.post("/alerts/feedback", json={"trip_id": "trip-abc", "rating": 4})
    assert resp.status_code == 201
    assert resp.json() == {"status": "ok"}


def test_feedback_with_jwt_calls_learn_from_implicit():
    uid = "550e8400-e29b-41d4-a716-446655440000"
    app.dependency_overrides[get_current_user] = _auth_override(uid)
    with patch("app.agents.memory_agent.save_feedback", new_callable=AsyncMock), \
         patch("app.agents.memory_agent.learn_from_implicit", new_callable=AsyncMock) as mock_learn:
        resp = client.post("/alerts/feedback", json={"trip_id": "trip-abc", "rating": 5})
    assert resp.status_code == 201
    mock_learn.assert_called_once_with(uid)


def test_feedback_save_error_returns_500():
    with patch("app.agents.memory_agent.save_feedback", new_callable=AsyncMock,
               side_effect=RuntimeError("DB gone")):
        resp = client.post("/alerts/feedback", json={"trip_id": "trip-abc", "rating": 3})
    assert resp.status_code == 500


def test_feedback_invalid_rating_returns_422():
    resp = client.post("/alerts/feedback", json={"trip_id": "trip-abc", "rating": 99})
    assert resp.status_code == 422


def test_feedback_body_user_id_field_no_longer_exists():
    """user_id must not appear in the FeedbackRequest schema anymore."""
    from app.models.trip import FeedbackRequest
    assert not hasattr(FeedbackRequest.model_fields.get("user_id", None), "default"), \
        "user_id field should have been removed from FeedbackRequest"
    assert "user_id" not in FeedbackRequest.model_fields


# ── GET /alerts/preferences ───────────────────────────────────────────────────

def test_preferences_no_auth_returns_401():
    resp = client.get("/alerts/preferences")
    assert resp.status_code == 401


def test_preferences_with_jwt_returns_defaults():
    uid = "550e8400-e29b-41d4-a716-446655440000"
    app.dependency_overrides[require_current_user] = _auth_override(uid)
    with patch("app.agents.memory_agent.get_preferences", new_callable=AsyncMock,
               return_value={"max_walk_minutes": 15, "prefer_mrt": False, "avoid_transfers": False}):
        resp = client.get("/alerts/preferences")
    assert resp.status_code == 200
    data = resp.json()
    assert data["max_walk_minutes"] == 15
    assert data["prefer_mrt"] is False
    assert data["avoid_transfers"] is False


def test_preferences_with_jwt_returns_custom_prefs():
    uid = "550e8400-e29b-41d4-a716-446655440000"
    app.dependency_overrides[require_current_user] = _auth_override(uid)
    with patch("app.agents.memory_agent.get_preferences", new_callable=AsyncMock,
               return_value={"max_walk_minutes": 30, "prefer_mrt": True, "avoid_transfers": True}):
        resp = client.get("/alerts/preferences")
    assert resp.status_code == 200
    data = resp.json()
    assert data["max_walk_minutes"] == 30
    assert data["prefer_mrt"] is True
    assert data["avoid_transfers"] is True


def test_preferences_passes_user_id_to_agent():
    uid = "550e8400-e29b-41d4-a716-446655440000"
    app.dependency_overrides[require_current_user] = _auth_override(uid)
    with patch("app.agents.memory_agent.get_preferences", new_callable=AsyncMock,
               return_value={"max_walk_minutes": 15, "prefer_mrt": False, "avoid_transfers": False}) as mock_get:
        client.get("/alerts/preferences")
    mock_get.assert_called_once_with(uid)
