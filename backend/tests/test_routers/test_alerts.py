from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_feedback_endpoint_disabled_until_jwt_auth_is_wired():
    resp = client.post("/alerts/feedback", json={
        "trip_id": "trip-1",
        "rating": 5,
        "comment": "Great trip",
    })

    assert resp.status_code == 501
    assert "Authentication required" in resp.json()["detail"]


def test_preferences_endpoint_disabled_until_jwt_auth_is_wired():
    resp = client.get("/alerts/preferences")

    assert resp.status_code == 501
    assert "Authentication required" in resp.json()["detail"]
