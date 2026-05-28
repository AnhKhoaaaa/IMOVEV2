import pytest
from unittest.mock import AsyncMock, MagicMock, patch

import app.services.gemini as _gemini
from app.services.gemini import parse_places_input


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
