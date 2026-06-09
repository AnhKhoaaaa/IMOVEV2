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
