import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.routers.places import _CURATED

client = TestClient(app)


def test_curated_returns_all_places():
    resp = client.get("/places/curated")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == len(_CURATED)


def test_curated_place_has_required_fields():
    resp = client.get("/places/curated")
    for place in resp.json():
        assert "id" in place
        assert "lat" in place
        assert "lng" in place
        assert "dwell_minutes" in place
        assert "is_outdoor" in place


def test_search_finds_by_name():
    resp = client.get("/places/search", params={"q": "marina"})
    assert resp.status_code == 200
    names = [p["name"] for p in resp.json()]
    assert "Marina Bay Sands" in names


def test_search_case_insensitive():
    resp = client.get("/places/search", params={"q": "GARDENS"})
    assert resp.status_code == 200
    names = [p["name"] for p in resp.json()]
    assert "Gardens by the Bay" in names


def test_search_finds_by_category():
    resp = client.get("/places/search", params={"q": "nature"})
    assert resp.status_code == 200
    names = [p["name"] for p in resp.json()]
    assert "Gardens by the Bay" in names


def test_search_no_match_returns_empty_list():
    resp = client.get("/places/search", params={"q": "xyzzy-no-match"})
    assert resp.status_code == 200
    assert resp.json() == []
