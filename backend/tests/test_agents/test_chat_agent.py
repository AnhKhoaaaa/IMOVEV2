"""Unit tests for the chat agent's tool-calling loop.

generate_chat is patched to return canned Gemini responses, so no LLM/network is hit.
Read tools run for real against the curated dataset (no network); write tools must
build a pending action WITHOUT mutating the trip store.
"""
from types import SimpleNamespace

import pytest
from unittest.mock import AsyncMock, patch

from app.agents import chat_agent
from app.agents.planning_agent import get_all_places
from app.models.chat import Gps
import app.routers.trips as _trips_module


# ── canned Gemini response builders ─────────────────────────────────────────────

def _fc_part(name, args):
    return SimpleNamespace(function_call=SimpleNamespace(name=name, args=args), text=None)


def _text_part(text):
    return SimpleNamespace(function_call=None, text=text)


def _resp(parts):
    return SimpleNamespace(candidates=[SimpleNamespace(content=SimpleNamespace(parts=parts))])


def _patch_gen(*responses):
    """Patch chat_agent.gemini.generate_chat with a sequence of canned responses."""
    if len(responses) == 1:
        mock = AsyncMock(return_value=responses[0])
    else:
        mock = AsyncMock(side_effect=list(responses))
    return patch.object(chat_agent.gemini, "generate_chat", mock), mock


@pytest.fixture(autouse=True)
def _reset_state():
    chat_agent.reset()
    _trips_module._trip_store.clear()
    _trips_module._trip_meta.clear()
    yield
    chat_agent.reset()
    _trips_module._trip_store.clear()
    _trips_module._trip_meta.clear()


def _a_curated_id() -> str:
    return next(iter(get_all_places()))


# ── tests ───────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_advice_only_no_mutation():
    cm, _ = _patch_gen(_resp([_text_part("Try Gardens by the Bay — it's lovely!")]))
    with cm:
        res = await chat_agent.run_chat("s1", "Gợi ý vài địa điểm đẹp", trip_id=None)
    assert "Gardens" in res.reply
    assert res.proposed_action is None
    assert res.pending_action_id is None
    assert "s1" not in chat_agent._pending_actions


@pytest.mark.asyncio
async def test_read_tool_search_places_then_reply():
    cm, mock = _patch_gen(
        _resp([_fc_part("search_places", {"query": "garden"})]),
        _resp([_text_part("I found a few gardens for you.")]),
    )
    with cm:
        res = await chat_agent.run_chat("s2", "quán gần garden", trip_id=None)
    assert res.proposed_action is None
    assert mock.call_count == 2  # tool call + final text
    assert "s2" not in chat_agent._pending_actions


@pytest.mark.asyncio
async def test_write_add_place_builds_pending_without_mutating():
    pid = _a_curated_id()
    cm, mock = _patch_gen(_resp([_fc_part("add_place", {"place_id": pid, "day": 1})]))
    with patch.object(_trips_module, "add_place", AsyncMock()) as spy_add:
        with cm:
            res = await chat_agent.run_chat("s3", "thêm địa điểm này", trip_id="t1")
    assert res.proposed_action is not None
    assert res.proposed_action.tool == "add_place"
    assert res.pending_action_id is not None
    assert chat_agent._pending_actions["s3"]["args"] == {"place_id": pid, "day": 1}
    spy_add.assert_not_awaited()           # NO write happened
    assert _trips_module._trip_store == {}  # store untouched
    assert mock.call_count == 1


@pytest.mark.asyncio
async def test_loop_cap_no_infinite_calls():
    # Model keeps asking for a read tool forever → must stop at _MAX_TURNS, no raise.
    cm, mock = _patch_gen(_resp([_fc_part("get_curated_places", {})]))
    mock.return_value = _resp([_fc_part("get_curated_places", {})])
    with cm:
        res = await chat_agent.run_chat("s4", "loop please", trip_id=None)
    assert mock.call_count == chat_agent._MAX_TURNS
    assert res.proposed_action is None
    assert res.reply  # fallback, not empty


@pytest.mark.asyncio
async def test_lost_without_gps_returns_tool_error_then_reply():
    cm, _ = _patch_gen(
        _resp([_fc_part("switch_leg_now", {"leg_id": "leg-001", "new_mode": "METRO"})]),
        _resp([_text_part("Please enable location so I can re-route you.")]),
    )
    with cm:
        res = await chat_agent.run_chat("s5", "tôi bị lạc", trip_id="t1", gps=None)
    assert res.proposed_action is None          # no pending built (GPS missing)
    assert "s5" not in chat_agent._pending_actions
    assert "location" in res.reply.lower()


@pytest.mark.asyncio
async def test_add_place_outside_curated_rejected():
    cm, _ = _patch_gen(
        _resp([_fc_part("add_place", {"place_id": "definitely-not-real", "day": 1})]),
        _resp([_text_part("Sorry, that place isn't in our dataset.")]),
    )
    with cm:
        res = await chat_agent.run_chat("s6", "thêm chỗ lạ", trip_id="t1")
    assert res.proposed_action is None
    assert "s6" not in chat_agent._pending_actions


@pytest.mark.asyncio
async def test_write_without_open_trip_returns_tool_error():
    pid = _a_curated_id()
    cm, _ = _patch_gen(
        _resp([_fc_part("add_place", {"place_id": pid, "day": 1})]),
        _resp([_text_part("Please open an itinerary first.")]),
    )
    with cm:
        res = await chat_agent.run_chat("s7", "thêm địa điểm", trip_id=None)
    assert res.proposed_action is None
    assert "s7" not in chat_agent._pending_actions


# ── rich multi-block messages (dev25 P3) ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_plain_answer_yields_single_text_block():
    cm, _ = _patch_gen(_resp([_text_part("Gardens by the Bay is lovely!")]))
    with cm:
        res = await chat_agent.run_chat("b1", "gợi ý", trip_id=None)
    assert res.blocks is not None
    assert len(res.blocks) == 1
    assert res.blocks[0].type == "text"
    assert res.blocks[0].markdown == "Gardens by the Bay is lovely!"
    assert res.reply == "Gardens by the Bay is lovely!"   # back-compat fallback kept


@pytest.mark.asyncio
async def test_multi_paragraph_yields_multiple_text_blocks():
    cm, _ = _patch_gen(_resp([_text_part("First idea here.\n\nSecond idea here.")]))
    with cm:
        res = await chat_agent.run_chat("b2", "gợi ý", trip_id=None)
    text_blocks = [b for b in res.blocks if b.type == "text"]
    assert [b.markdown for b in text_blocks] == ["First idea here.", "Second idea here."]


@pytest.mark.asyncio
async def test_show_places_yields_place_card_with_dataset_image():
    pid = _a_curated_id()
    from app.agents.planning_agent import get_curated_place
    curated = get_curated_place(pid)
    cm, _ = _patch_gen(
        _resp([_fc_part("show_places", {"place_ids": [pid]})]),
        _resp([_text_part("Here's a great spot for you.")]),
    )
    with cm:
        res = await chat_agent.run_chat("b3", "đề xuất", trip_id=None)
    cards = [b for b in res.blocks if b.type == "place_card"]
    assert len(cards) == 1
    assert cards[0].id == pid
    assert cards[0].name == curated["name"]
    # Image comes from the dataset, never invented by the model.
    assert cards[0].image_url == curated.get("image_url")
    # Final text block precedes the card.
    assert res.blocks[0].type == "text"


@pytest.mark.asyncio
async def test_show_places_ignores_unknown_ids():
    cm, _ = _patch_gen(
        _resp([_fc_part("show_places", {"place_ids": ["not-a-real-id"]})]),
        _resp([_text_part("Hmm, nothing to show.")]),
    )
    with cm:
        res = await chat_agent.run_chat("b4", "đề xuất", trip_id=None)
    assert [b for b in res.blocks if b.type == "place_card"] == []


@pytest.mark.asyncio
async def test_compare_routes_yields_route_compare_block():
    routes = {
        "pt": {"available": True, "duration_minutes": 22, "fare_sgd": 1.5, "distance_km": 8, "summary": "Bus 14"},
        "walk": {"available": False, "duration_minutes": 0, "fare_sgd": 0, "distance_km": 0, "summary": ""},
        "cycle": {"available": True, "duration_minutes": 18, "fare_sgd": 0.0, "distance_km": 5, "summary": "direct"},
    }
    cm, _ = _patch_gen(
        _resp([_fc_part("compare_routes", {"from_lat": 1.3, "from_lng": 103.8, "to_lat": 1.31, "to_lng": 103.85})]),
        _resp([_text_part("Transit is your best bet.")]),
    )
    with cm, patch("app.services.onemap.get_all_routes", new=AsyncMock(return_value=routes)):
        res = await chat_agent.run_chat("b5", "đường nào nhanh", trip_id=None)
    blocks = [b for b in res.blocks if b.type == "route_compare"]
    assert len(blocks) == 1
    modes = {o.mode for o in blocks[0].options}
    assert modes == {"TRANSIT", "CYCLE"}      # unavailable WALK is dropped


@pytest.mark.asyncio
async def test_bus_arrivals_yields_block():
    arrivals = [
        {"service_no": "14", "next_arrival_minutes": 3, "next_arrival_2_minutes": 12, "load": "SEA"},
        {"service_no": "16", "next_arrival_minutes": 7, "next_arrival_2_minutes": 20, "load": "SDA"},
    ]
    cm, _ = _patch_gen(
        _resp([_fc_part("get_bus_arrivals", {"stop_code": "83139"})]),
        _resp([_text_part("Next buses are close.")]),
    )
    with cm, patch("app.services.lta.get_bus_arrival", new=AsyncMock(return_value=arrivals)):
        res = await chat_agent.run_chat("b6", "xe buýt", trip_id=None)
    blocks = [b for b in res.blocks if b.type == "bus_arrivals"]
    assert len(blocks) == 1
    assert blocks[0].stop_code == "83139"
    assert [s.service_no for s in blocks[0].services] == ["14", "16"]
    assert blocks[0].services[0].eta_min == 3


@pytest.mark.asyncio
async def test_proposal_response_has_no_blocks():
    pid = _a_curated_id()
    cm, _ = _patch_gen(_resp([_fc_part("add_place", {"place_id": pid, "day": 1})]))
    with cm:
        res = await chat_agent.run_chat("b7", "thêm địa điểm này", trip_id="t1")
    assert res.proposed_action is not None
    assert res.blocks is None        # proposals keep using `reply`
