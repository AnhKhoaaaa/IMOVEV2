import pytest
from unittest.mock import MagicMock, patch

from app.agents.memory_agent import save_feedback, get_preferences, learn_from_implicit


# ── helpers ───────────────────────────────────────────────────────────────────

def _make_sb(prefs_data=None, feedback_data=None, existing_pref=None):
    sb = MagicMock()
    cache = {}

    def _table(name):
        if name in cache:
            return cache[name]
        t = MagicMock()
        t.select.return_value = t
        t.insert.return_value = t
        t.update.return_value = t
        t.eq.return_value = t

        if name == "user_preferences":
            if existing_pref is None:
                t.execute.return_value = MagicMock(data=prefs_data or [])
            else:
                t.execute.return_value = MagicMock(data=existing_pref)
        elif name == "trip_feedback":
            t.execute.return_value = MagicMock(data=feedback_data or [])
        else:
            t.execute.return_value = MagicMock(data=[])
        cache[name] = t
        return t

    sb.table.side_effect = _table
    return sb


# ── save_feedback ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_save_feedback_no_supabase_does_not_crash():
    with patch("app.agents.memory_agent.supabase", None):
        await save_feedback("trip-1", "00000000-0000-0000-0000-000000000001", None, 4, "Great trip")


@pytest.mark.asyncio
async def test_save_feedback_without_user_id_skips_insert():
    sb = _make_sb()

    with patch("app.agents.memory_agent.supabase", sb):
        await save_feedback("trip-1", None, None, 4, "Great trip")

    assert not sb.table("trip_feedback").insert.called


@pytest.mark.asyncio
async def test_save_feedback_inserts_row():
    sb = _make_sb()
    inserted = []

    def capture(row):
        inserted.append(row)
        m = MagicMock()
        m.execute.return_value = MagicMock(data=[])
        return m

    sb.table("trip_feedback").insert = capture

    with patch("app.agents.memory_agent.supabase", sb):
        await save_feedback("trip-1", "00000000-0000-0000-0000-000000000001", "leg-1", 5, "Loved MRT", "explicit")

    assert len(inserted) == 1
    assert inserted[0]["trip_id"] == "trip-1"
    assert inserted[0]["rating"] == 5
    assert inserted[0]["feedback_type"] == "explicit"


# ── get_preferences ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_preferences_no_supabase_returns_defaults():
    with patch("app.agents.memory_agent.supabase", None):
        prefs = await get_preferences("00000000-0000-0000-0000-000000000001")
    assert prefs["max_walk_minutes"] == 15
    assert prefs["prefer_mrt"] is False
    assert prefs["avoid_transfers"] is False


@pytest.mark.asyncio
async def test_get_preferences_no_record_returns_defaults():
    sb = _make_sb(prefs_data=[])
    with patch("app.agents.memory_agent.supabase", sb):
        prefs = await get_preferences("00000000-0000-0000-0000-000000000001")
    assert prefs["prefer_mrt"] is False
    assert prefs["max_walk_minutes"] == 15


@pytest.mark.asyncio
async def test_get_preferences_returns_existing_record():
    record = [{"max_walk_minutes": 20, "prefer_mrt": True, "avoid_transfers": False}]
    sb = _make_sb(prefs_data=record)
    with patch("app.agents.memory_agent.supabase", sb):
        prefs = await get_preferences("00000000-0000-0000-0000-000000000001")
    assert prefs["prefer_mrt"] is True
    assert prefs["max_walk_minutes"] == 20


# ── learn_from_implicit ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_learn_implicit_no_supabase_does_not_crash():
    with patch("app.agents.memory_agent.supabase", None):
        await learn_from_implicit("00000000-0000-0000-0000-000000000001")


@pytest.mark.asyncio
async def test_learn_implicit_no_feedback_no_update():
    sb = _make_sb(feedback_data=[])
    with patch("app.agents.memory_agent.supabase", sb):
        await learn_from_implicit("00000000-0000-0000-0000-000000000001")
    # No update should be called
    assert not sb.table("user_preferences").update.called


@pytest.mark.asyncio
async def test_learn_implicit_single_bus_to_mrt_no_update():
    feedback = [{"comment": "Mode changed: BUS → MRT"}]
    sb = _make_sb(feedback_data=feedback)
    with patch("app.agents.memory_agent.supabase", sb):
        await learn_from_implicit("00000000-0000-0000-0000-000000000001")
    assert not sb.table("user_preferences").update.called


@pytest.mark.asyncio
async def test_learn_implicit_two_bus_to_mrt_sets_prefer_mrt():
    feedback = [
        {"comment": "Mode changed: BUS → MRT"},
        {"comment": "Mode changed: BUS → MRT"},
    ]
    # No existing prefs record → triggers insert
    sb = _make_sb(feedback_data=feedback, existing_pref=[])
    inserted = []

    def capture_insert(row):
        inserted.append(row)
        m = MagicMock()
        m.execute.return_value = MagicMock(data=[])
        return m

    sb.table("user_preferences").insert = capture_insert

    with patch("app.agents.memory_agent.supabase", sb):
        await learn_from_implicit("00000000-0000-0000-0000-000000000001")

    assert len(inserted) == 1
    assert inserted[0]["prefer_mrt"] is True


@pytest.mark.asyncio
async def test_learn_implicit_two_walk_increases_max_walk():
    feedback = [
        {"comment": "Mode changed: BUS → WALK"},
        {"comment": "Mode changed: MRT → WALK"},
    ]
    sb = _make_sb(feedback_data=feedback, existing_pref=[])
    inserted = []

    def capture_insert(row):
        inserted.append(row)
        m = MagicMock()
        m.execute.return_value = MagicMock(data=[])
        return m

    sb.table("user_preferences").insert = capture_insert

    with patch("app.agents.memory_agent.supabase", sb):
        await learn_from_implicit("00000000-0000-0000-0000-000000000001")

    assert len(inserted) == 1
    assert inserted[0]["max_walk_minutes"] == 20  # 15 + 5
