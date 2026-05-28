import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient

from app.main import app
from app.services.lta import LTAUnavailableError
from app.services.onemap import NoRouteError

client = TestClient(app)

_BUS_ARRIVALS = [
    {"service_no": "7", "next_arrival_minutes": 3, "next_arrival_2_minutes": 8, "load": "SEA"},
    {"service_no": "65", "next_arrival_minutes": 1, "next_arrival_2_minutes": 6, "load": "LSD"},
]

_COMPARE_RESULT = {
    "pt":    {"available": True,  "duration_minutes": 28, "fare_sgd": 1.50, "distance_km": 5.2, "summary": "via EW line"},
    "walk":  {"available": True,  "duration_minutes": 45, "fare_sgd": 0.0,  "distance_km": 3.5, "summary": "direct"},
    "cycle": {"available": False, "duration_minutes": 0,  "fare_sgd": 0.0,  "distance_km": 0.0, "summary": ""},
}


# ── GET /transit/bus-arrivals/{stop_code} ─────────────────────────────────────

def test_bus_arrivals_returns_200_with_list():
    with patch("app.routers.transit.lta.get_bus_arrival", new_callable=AsyncMock,
               return_value=_BUS_ARRIVALS):
        resp = client.get("/transit/bus-arrivals/22009")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert data[0]["service_no"] == "7"
    assert data[0]["next_arrival_minutes"] == 3
    assert data[1]["load"] == "LSD"


def test_bus_arrivals_empty_stop_returns_empty_list():
    with patch("app.routers.transit.lta.get_bus_arrival", new_callable=AsyncMock,
               return_value=[]):
        resp = client.get("/transit/bus-arrivals/99999")
    assert resp.status_code == 200
    assert resp.json() == []


def test_bus_arrivals_lta_unavailable_returns_503():
    with patch("app.routers.transit.lta.get_bus_arrival", new_callable=AsyncMock,
               side_effect=LTAUnavailableError("LTA down")):
        resp = client.get("/transit/bus-arrivals/22009")
    assert resp.status_code == 503
    assert "detail" in resp.json()


def test_bus_arrivals_passes_stop_code_to_service():
    with patch("app.routers.transit.lta.get_bus_arrival", new_callable=AsyncMock,
               return_value=[]) as mock_get:
        client.get("/transit/bus-arrivals/44444")
    mock_get.assert_called_once_with("44444")


# ── GET /transit/compare ──────────────────────────────────────────────────────

def test_compare_returns_200_with_three_modes():
    with patch("app.routers.transit.onemap.get_all_routes", new_callable=AsyncMock,
               return_value=_COMPARE_RESULT):
        resp = client.get("/transit/compare",
                          params={"from_lat": 1.28, "from_lng": 103.85,
                                  "to_lat": 1.30, "to_lng": 103.82})
    assert resp.status_code == 200
    data = resp.json()
    assert set(data.keys()) == {"pt", "walk", "cycle"}
    assert data["pt"]["available"] is True
    assert data["pt"]["duration_minutes"] == 28
    assert data["pt"]["summary"] == "via EW line"
    assert data["cycle"]["available"] is False


def test_compare_passes_coords_to_service():
    with patch("app.routers.transit.onemap.get_all_routes", new_callable=AsyncMock,
               return_value=_COMPARE_RESULT) as mock_all:
        client.get("/transit/compare",
                   params={"from_lat": 1.28, "from_lng": 103.85,
                           "to_lat": 1.30, "to_lng": 103.82})
    mock_all.assert_called_once_with(1.28, 103.85, 1.30, 103.82)


def test_compare_missing_param_returns_422():
    resp = client.get("/transit/compare",
                      params={"from_lat": 1.28, "from_lng": 103.85})
    assert resp.status_code == 422


def test_compare_service_failure_returns_503():
    with patch("app.routers.transit.onemap.get_all_routes", new_callable=AsyncMock,
               side_effect=NoRouteError("all routes failed")):
        resp = client.get("/transit/compare",
                          params={"from_lat": 1.28, "from_lng": 103.85,
                                  "to_lat": 1.30, "to_lng": 103.82})
    assert resp.status_code == 503
