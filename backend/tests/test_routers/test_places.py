import pytest
from unittest.mock import AsyncMock, patch
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
    # New dataset has "Marina Bay Sands – SkyPark Observation Deck" etc.
    assert any("Marina Bay Sands" in n for n in names)


def test_search_case_insensitive():
    resp = client.get("/places/search", params={"q": "GARDENS"})
    assert resp.status_code == 200
    names = [p["name"] for p in resp.json()]
    # New dataset splits Gardens by the Bay into Supertree Grove, Flower Dome, etc.
    assert any("Gardens by the Bay" in n for n in names)


def test_search_finds_by_category():
    resp = client.get("/places/search", params={"q": "ATTRACTION"})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) > 0
    assert all(p["category"] == "ATTRACTION" for p in data)


def test_search_no_match_returns_empty_list():
    resp = client.get("/places/search", params={"q": "xyzzy-no-match"})
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_ai_suggest_returns_place_ids():
    # Use real IDs from the new dataset — validation filters out unknown ones
    expected = ["merlion-park", "artscience-museum"]
    with patch("app.agents.planning_agent.suggest_places", new_callable=AsyncMock,
               return_value=expected):
        resp = client.post("/places/ai-suggest", json={
            "num_days": 2,
            "travel_styles": ["nature"],
            "group_type": "solo",
        })
    assert resp.status_code == 200
    assert resp.json()["suggested_place_ids"] == expected


@pytest.mark.asyncio
async def test_ai_suggest_filters_hallucinated_ids():
    """Gemini may return stale or invented IDs — only valid curated IDs pass through."""
    with patch("app.agents.planning_agent.suggest_places", new_callable=AsyncMock,
               return_value=["merlion-park", "gardens-by-the-bay", "nonexistent-xyz"]):
        resp = client.post("/places/ai-suggest", json={})
    assert resp.status_code == 200
    result = resp.json()["suggested_place_ids"]
    assert result == ["merlion-park"]          # only the valid ID survives
    assert "gardens-by-the-bay" not in result  # old renamed ID filtered out
    assert "nonexistent-xyz" not in result     # hallucinated ID filtered out


@pytest.mark.asyncio
async def test_ai_suggest_uses_defaults():
    with patch("app.agents.planning_agent.suggest_places", new_callable=AsyncMock,
               return_value=["merlion-park"]) as mock_suggest:
        resp = client.post("/places/ai-suggest", json={})
    assert resp.status_code == 200
    mock_suggest.assert_called_once_with(1, [], "solo")
