import pytest
from unittest.mock import AsyncMock, MagicMock, patch

import app.services.gemini as _gemini
from app.services.gemini import parse_places_input, phrase_alert, search_events_grounded


@pytest.fixture(autouse=True)
def reset_rate_limit():
    _gemini._last_call_at = 0
    yield
    _gemini._last_call_at = 0


def _mock_client(text: str):
    """Return a mock _client whose aio.models.generate_content returns text."""
    mock_resp = MagicMock()
    mock_resp.text = text
    mock_client = MagicMock()
    mock_client.aio.models.generate_content = AsyncMock(return_value=mock_resp)
    return mock_client


@pytest.mark.asyncio
async def test_parse_places_returns_list():
    with patch.object(_gemini, "_client", _mock_client('["Marina Bay Sands", "Gardens by the Bay"]')):
        result = await parse_places_input("I want to visit Marina Bay Sands and Gardens by the Bay")

    assert result == ["Marina Bay Sands", "Gardens by the Bay"]


@pytest.mark.asyncio
async def test_parse_places_strips_markdown_fences():
    with patch.object(_gemini, "_client", _mock_client('```json\n["Sentosa"]\n```')):
        result = await parse_places_input("go to Sentosa")

    assert result == ["Sentosa"]


@pytest.mark.asyncio
async def test_parse_places_safety_filter_raises():
    with patch.object(_gemini, "_client", _mock_client(None)):
        with pytest.raises(ValueError, match="filtered"):
            await parse_places_input("visit Singapore")


@pytest.mark.asyncio
async def test_parse_places_non_json_raises():
    with patch.object(_gemini, "_client", _mock_client("Sorry, I cannot help with that.")):
        with pytest.raises(ValueError, match="non-JSON"):
            await parse_places_input("visit Singapore")


@pytest.mark.asyncio
async def test_phrase_alert_returns_friendly_text():
    with patch.object(_gemini, "_client", _mock_client("Heads up — likely rain at 3pm near your Day 2 stop!")):
        out = await phrase_alert(
            {"alert_type": "weather_warning", "message": "70% rain", "day_number": 2}, "en"
        )
    assert out == "Heads up — likely rain at 3pm near your Day 2 stop!"


@pytest.mark.asyncio
async def test_phrase_alert_falls_back_to_original_on_error():
    mock_client = MagicMock()
    mock_client.aio.models.generate_content = AsyncMock(side_effect=RuntimeError("network down"))
    with patch.object(_gemini, "_client", mock_client):
        out = await phrase_alert({"alert_type": "train_delay", "message": "EW line delayed"}, "vi")
    assert out == "EW line delayed"


@pytest.mark.asyncio
async def test_phrase_alert_falls_back_when_model_returns_empty():
    with patch.object(_gemini, "_client", _mock_client("   ")):
        out = await phrase_alert({"alert_type": "weather_live", "message": "Raining now"}, "en")
    assert out == "Raining now"


# ── search_events_grounded (dev25 P4 web grounding) ──────────────────────────────

@pytest.mark.asyncio
async def test_search_events_grounded_returns_text():
    with patch.object(_gemini, "_client", _mock_client("Singapore Food Festival runs this weekend at Marina Bay.")):
        out = await search_events_grounded("festivals this weekend", today="2026-06-13")
    assert "Food Festival" in out["text"]
    assert isinstance(out["citations"], list)


@pytest.mark.asyncio
async def test_search_events_grounded_falls_back_on_error():
    mock_client = MagicMock()
    mock_client.aio.models.generate_content = AsyncMock(side_effect=RuntimeError("network down"))
    with patch.object(_gemini, "_client", mock_client):
        out = await search_events_grounded("anything")
    assert out == {"text": "", "citations": []}


@pytest.mark.asyncio
async def test_search_events_grounded_falls_back_when_empty():
    with patch.object(_gemini, "_client", _mock_client("   ")):
        out = await search_events_grounded("anything")
    assert out == {"text": "", "citations": []}


@pytest.mark.asyncio
async def test_rate_limit_guard_triggers_sleep():
    mock_sleep = AsyncMock()
    with patch("app.services.gemini.asyncio.sleep", mock_sleep):
        with patch.object(_gemini, "_client", _mock_client('["Sentosa"]')):
            await parse_places_input("visit Sentosa")        # first call — no sleep
            await parse_places_input("visit Marina Bay")     # second call — should sleep

    mock_sleep.assert_called_once()
    sleep_duration = mock_sleep.call_args[0][0]
    assert 0 < sleep_duration <= _gemini._MIN_INTERVAL


@pytest.mark.asyncio
async def test_rate_limit_lock_not_held_during_sleep():
    """asyncio.sleep must occur OUTSIDE _RATE_LIMIT_LOCK.

    If sleep is inside the lock, concurrent callers stack delays: each caller holds
    the lock for _MIN_INTERVAL seconds, so N callers wait N*_MIN_INTERVAL total.
    With the fix (sleep outside lock), the lock is released before sleeping so other
    callers can reserve their slot immediately.
    """
    lock_held_during_sleep = []

    async def spy_sleep(duration):
        lock_held_during_sleep.append(_gemini._RATE_LIMIT_LOCK.locked())

    with patch("app.services.gemini.asyncio.sleep", side_effect=spy_sleep):
        with patch.object(_gemini, "_client", _mock_client('["Sentosa"]')):
            await parse_places_input("visit Sentosa")
            await parse_places_input("visit Marina Bay")  # triggers sleep

    assert len(lock_held_during_sleep) == 1, "sleep should be called exactly once"
    assert not lock_held_during_sleep[0], (
        "_RATE_LIMIT_LOCK must not be held during asyncio.sleep — "
        "holding it blocks concurrent callers and stacks delays"
    )
