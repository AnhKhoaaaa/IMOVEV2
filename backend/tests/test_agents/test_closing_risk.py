"""dev20 — closing-risk / running-late alert (live trips). 100% rule-based."""

from datetime import date, datetime, time, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.agents.adaptation_agent import (
    SGT,
    _close_minute_today,
    _project_today_timeline,
    _departure_clock,
    _day_capacity_summary,
    _check_closing_risk,
    adapt_trip,
)
from app.models.trip import TripPlan, DayPlan, LegResponse
from app.models.place import Place


# ── fixtures ────────────────────────────────────────────────────────────────

def _place(pid, lat=1.30, lng=103.85, dwell=60, opening_hours=None, close_days=None, outdoor=False):
    # Synthetic ids (not in the curated dataset) so the Place's own opening_hours/close_days win.
    return Place(
        id=pid, name=pid.upper(), lat=lat, lng=lng, dwell_minutes=dwell,
        best_time_start="09:00", best_time_end="21:00",
        category="x", is_outdoor=outdoor, in_curated_dataset=False,
        opening_hours=opening_hours, close_days=close_days,
    )


def _leg(frm, to, dur=30):
    return LegResponse(id=f"{frm}-{to}", from_place_id=frm, to_place_id=to,
                       transport_mode="WALK", duration_minutes=dur, cost_sgd=0.0, is_estimated=False)


def _now(h, m=0):
    """Timezone-aware SGT datetime for today at HH:MM (deterministic clock for tests)."""
    return datetime.combine(date.today(), time(h, m), tzinfo=SGT)


def _supabase(alert=None, trips=None):
    sb = MagicMock()
    cache = {}

    def _table(name):
        if name in cache:
            return cache[name]
        t = MagicMock()
        for m in ("select", "insert", "update", "upsert", "eq", "in_", "is_", "gte", "delete"):
            getattr(t, m).return_value = t
        if name == "lta_alerts":
            t.execute.return_value = MagicMock(data=alert or [])
        elif name == "trips":
            t.execute.return_value = MagicMock(data=trips or [])
        else:
            t.execute.return_value = MagicMock(data=[])
        cache[name] = t
        return t

    sb.table.side_effect = _table
    return sb


def _captured_inserts(sb):
    rows = []

    def cap(row):
        rows.append(row)
        m = MagicMock()
        m.execute.return_value = MagicMock(data=[])
        return m

    sb.table("lta_alerts").insert = cap
    return rows


# ── B1: _close_minute_today ───────────────────────────────────────────────────

def test_close_minute_single_slot():
    p = _place("p", opening_hours=["09:00-17:00"])
    assert _close_minute_today(p.model_dump() | {"close_days": None}, _now(14)) == 1020


def test_close_minute_multi_slot_picks_usable():
    p = {"opening_hours": ["09:00-12:00", "13:00-17:00"], "close_days": None}
    # 12:30 → first slot already past; the still-usable slot closes 17:00.
    assert _close_minute_today(p, _now(12, 30)) == 1020


def test_close_minute_24h_returns_none():
    assert _close_minute_today({"opening_hours": ["00:00-23:59"]}, _now(14)) is None
    assert _close_minute_today({"opening_hours": None}, _now(14)) is None


def test_close_minute_closed_today_returns_none():
    weekday = _now(14).strftime("%A")
    assert _close_minute_today({"opening_hours": ["09:00-17:00"], "close_days": [weekday]}, _now(14)) is None


def test_close_minute_midnight_crossing():
    # 19:00-02:00 stays open past midnight → close at 26:00 (1560).
    assert _close_minute_today({"opening_hours": ["19:00-02:00"]}, _now(20)) == 1560


# ── B2: _project_today_timeline ───────────────────────────────────────────────

def _three_stop_plan():
    plan = TripPlan(
        id="t1",
        days=[DayPlan(day=1, legs=[_leg("p1", "p2", 20), _leg("p2", "p3", 20)],
                      place_ids=["p1", "p2", "p3"])],
        places=[_place("p1"), _place("p2", dwell=150), _place("p3", dwell=60)],
        warnings=[],
    )
    return plan


def test_timeline_net_zero_no_false_alarm():
    """Worked example: arrive early + overstay nets out — projected arrival is stable."""
    plan = _three_stop_plan()
    # Dwelling at p2 (active leg p2→p3), arrived 14:00, dwell 150 → planned leave 16:30.
    arrived = 14 * 60
    # Whether the user is early (now 15:00) or on time, leave = max(now, arrived+150)=990.
    tl_early = _project_today_timeline(plan, 1, 1, now_min=15 * 60, arrived_at_min=arrived, anchor_min=None)
    assert tl_early == [{"place_id": "p3", "arrival_min": 990 + 20, "finish_min": 990 + 20 + 60}]


def test_timeline_overstay_pushes_arrival():
    plan = _three_stop_plan()
    arrived = 14 * 60
    # now 17:00 (1020) > planned leave 990 → departure slips to now.
    tl = _project_today_timeline(plan, 1, 1, now_min=1020, arrived_at_min=arrived, anchor_min=None)
    assert tl[0]["arrival_min"] == 1020 + 20


def test_timeline_anchor_overrides_clock():
    plan = _three_stop_plan()
    tl = _project_today_timeline(plan, 1, 1, now_min=600, arrived_at_min=14 * 60, anchor_min=15 * 60)
    assert tl[0]["arrival_min"] == 15 * 60 + 20  # anchored departure wins


def test_timeline_excludes_hotel_leg():
    plan = TripPlan(
        id="t1",
        days=[DayPlan(day=1, legs=[_leg("p1", "p2", 20), _leg("p2", "hotel", 20)],
                      place_ids=["p1", "p2"])],
        places=[_place("p1"), _place("p2")],
        warnings=[],
    )
    tl = _project_today_timeline(plan, 1, 0, now_min=600, arrived_at_min=None, anchor_min=None)
    assert [e["place_id"] for e in tl] == ["p2"]  # hotel return excluded


# ── B3: _day_capacity_summary ─────────────────────────────────────────────────

def test_day_capacity_room_full_closed():
    closed_weekday = (date.today() + timedelta(days=2)).strftime("%A")
    plan = TripPlan(
        id="t1",
        days=[
            DayPlan(day=1, legs=[_leg("a", "b")], place_ids=["a", "b"]),
            DayPlan(day=2, legs=[_leg("c", "d", 10)], place_ids=["c", "d"]),  # light → room
            DayPlan(day=3, legs=[_leg("e", "f", 200)], place_ids=["e", "f"]),  # packed → full
        ],
        places=[_place(x, dwell=60) for x in ("a", "b", "c", "d")]
               + [_place("e", dwell=400), _place("f", dwell=400)],
        warnings=[],
    )
    at_risk = {"close_days": [closed_weekday]}
    summary = _day_capacity_summary(plan, active_day=1, at_risk=at_risk)
    by_day = {d["day"]: d for d in summary}
    assert 1 not in by_day  # active day excluded
    assert by_day[2]["status"] == "room"
    assert by_day[3]["status"] == "closed"  # weekday match overrides full/room


# ── B4: _check_closing_risk ───────────────────────────────────────────────────

def _risk_plan():
    """p3 closes 17:00; dwelling at p2 with slack to recover by leaving earlier."""
    return TripPlan(
        id="t1",
        days=[DayPlan(day=1, legs=[_leg("p1", "p2", 20), _leg("p2", "p3", 20)],
                      place_ids=["p1", "p2", "p3"])],
        places=[
            _place("p1"),
            _place("p2", dwell=150, opening_hours=["00:00-23:59"]),  # never closes → not at risk itself
            _place("p3", dwell=60, opening_hours=["09:00-17:00"]),
        ],
        warnings=[],
    )


def test_check_closing_risk_leave_earlier_feasible():
    plan = _risk_plan()
    sb = _supabase()
    rows = _captured_inserts(sb)
    with patch("app.agents.adaptation_agent.supabase", sb):
        fired = _check_closing_risk(
            "t1", plan, active_day=1, active_leg_index=1, now_dt=_now(15),
            arrived_at_min=14 * 60, anchor_min=None, start_date=date.today(),
        )
    assert fired is True
    md = rows[0]["metadata"]
    assert md["place_id"] == "p3"
    le = md["resolutions"]["leave_earlier"]
    assert le["feasible"] is True
    assert le["current_place_name"] == "P2"
    assert le["save_minutes"] == 20
    assert le["target_leave_time"] == "16:10"


def test_check_closing_risk_safe_no_alert():
    plan = _risk_plan()
    sb = _supabase()
    rows = _captured_inserts(sb)
    with patch("app.agents.adaptation_agent.supabase", sb):
        fired = _check_closing_risk(
            "t1", plan, active_day=1, active_leg_index=1, now_dt=_now(10),
            arrived_at_min=9 * 60, anchor_min=None, start_date=date.today(),
        )
    assert fired is False
    assert rows == []


def test_check_closing_risk_today_only():
    plan = _risk_plan()
    sb = _supabase()
    _captured_inserts(sb)
    with patch("app.agents.adaptation_agent.supabase", sb):
        fired = _check_closing_risk(
            "t1", plan, active_day=1, active_leg_index=1, now_dt=_now(15),
            arrived_at_min=14 * 60, anchor_min=None,
            start_date=date.today() + timedelta(days=1),  # trip starts tomorrow
        )
    assert fired is False


def test_check_closing_risk_dedup():
    plan = _risk_plan()
    sb = _supabase(alert=[{"id": "old", "metadata": {"place_id": "p3"}}])
    rows = _captured_inserts(sb)
    with patch("app.agents.adaptation_agent.supabase", sb):
        fired = _check_closing_risk(
            "t1", plan, active_day=1, active_leg_index=1, now_dt=_now(15),
            arrived_at_min=14 * 60, anchor_min=None, start_date=date.today(),
        )
    assert fired is False
    assert rows == []


def test_check_closing_risk_push_no_other_day():
    plan = _risk_plan()  # single day
    sb = _supabase()
    rows = _captured_inserts(sb)
    with patch("app.agents.adaptation_agent.supabase", sb):
        _check_closing_risk("t1", plan, 1, 1, _now(15), 14 * 60, None, date.today())
    push = rows[0]["metadata"]["resolutions"]["push"]
    assert push["feasible"] is False
    assert push["reason"] == "no_other_day"


def test_check_closing_risk_push_closed_all():
    closed_weekday = (date.today() + timedelta(days=1)).strftime("%A")
    plan = TripPlan(
        id="t1",
        days=[
            DayPlan(day=1, legs=[_leg("p1", "p2", 20), _leg("p2", "p3", 20)],
                    place_ids=["p1", "p2", "p3"]),
            DayPlan(day=2, legs=[_leg("q1", "q2", 10)], place_ids=["q1", "q2"]),
        ],
        places=[
            _place("p1"), _place("p2", dwell=150, opening_hours=["00:00-23:59"]),
            _place("p3", dwell=60, opening_hours=["09:00-17:00"], close_days=[closed_weekday]),
            _place("q1"), _place("q2"),
        ],
        warnings=[],
    )
    sb = _supabase()
    rows = _captured_inserts(sb)
    with patch("app.agents.adaptation_agent.supabase", sb):
        _check_closing_risk("t1", plan, 1, 1, _now(15), 14 * 60, None, date.today())
    push = rows[0]["metadata"]["resolutions"]["push"]
    assert push["feasible"] is False
    assert push["reason"] == "closed_all"


# ── B6: adapt_trip closing_risk resolutions ───────────────────────────────────

def _alert_row(metadata, alert_id="a1"):
    return {"id": alert_id, "trip_id": "t1", "alert_type": "closing_risk", "metadata": metadata}


@pytest.mark.asyncio
async def test_adapt_leave_earlier_is_advisory():
    plan = _three_stop_plan()
    md = {"place_id": "p3", "place_name": "P3",
          "resolutions": {"leave_earlier": {"feasible": True, "current_place_name": "P2",
                                            "target_leave_time": "16:10", "save_minutes": 20}}}
    sb = _supabase(alert=[_alert_row(md)])
    with patch("app.agents.adaptation_agent.supabase", sb):
        resp = await adapt_trip("t1", "a1", plan, resolution="leave_earlier")
    assert resp.adapted is True
    assert resp.updated_trip == plan  # nothing structural changed
    assert resp.delta_active_time == 0
    assert "P2" in resp.changes[0]


@pytest.mark.asyncio
async def test_adapt_skip_removes_place_and_restitches():
    plan = _three_stop_plan()
    md = {"place_id": "p2", "place_name": "P2", "resolutions": {}}
    sb = _supabase(alert=[_alert_row(md)])
    stitched = _leg("p1", "p3", 25)
    with patch("app.agents.adaptation_agent.supabase", sb):
        with patch("app.agents.adaptation_agent._recalculate_leg",
                   new_callable=AsyncMock, return_value=stitched):
            resp = await adapt_trip("t1", "a1", plan, resolution="skip")
    assert resp.adapted is True
    assert all(p.id != "p2" for p in resp.updated_trip.places)
    legs = resp.updated_trip.days[0].legs
    assert [(l.from_place_id, l.to_place_id) for l in legs] == [("p1", "p3")]


@pytest.mark.asyncio
async def test_adapt_push_to_closed_day_rejected():
    closed_weekday = (date.today() + timedelta(days=1)).strftime("%A")
    plan = TripPlan(
        id="t1",
        days=[
            DayPlan(day=1, legs=[_leg("p1", "p2", 20), _leg("p2", "p3", 20)],
                    place_ids=["p1", "p2", "p3"]),
            DayPlan(day=2, legs=[_leg("q1", "q2", 10)], place_ids=["q1", "q2"]),
        ],
        places=[_place("p1"), _place("p2"),
                _place("p3", close_days=[closed_weekday]), _place("q1"), _place("q2")],
        warnings=[],
    )
    md = {"place_id": "p3", "place_name": "P3", "resolutions": {}}
    sb = _supabase(alert=[_alert_row(md)])
    with patch("app.agents.adaptation_agent.supabase", sb):
        resp = await adapt_trip("t1", "a1", plan, resolution="push", target_day=2)
    assert resp.adapted is False
    assert "closed" in resp.changes[0].lower()


@pytest.mark.asyncio
async def test_adapt_push_moves_place_to_target_day():
    plan = TripPlan(
        id="t1",
        days=[
            DayPlan(day=1, legs=[_leg("p1", "p2", 20), _leg("p2", "p3", 20)],
                    place_ids=["p1", "p2", "p3"]),
            DayPlan(day=2, legs=[_leg("q1", "q2", 10)], place_ids=["q1", "q2"]),
        ],
        places=[_place("p1"), _place("p2"), _place("p3"), _place("q1"), _place("q2")],
        warnings=[],
    )
    md = {"place_id": "p3", "place_name": "P3", "resolutions": {}}
    sb = _supabase(alert=[_alert_row(md)])
    new_leg = _leg("q2", "p3", 15)
    with patch("app.agents.adaptation_agent.supabase", sb):
        with patch("app.agents.adaptation_agent._recalculate_leg",
                   new_callable=AsyncMock, return_value=new_leg):
            resp = await adapt_trip("t1", "a1", plan, resolution="push", target_day=2)
    assert resp.adapted is True
    day2 = next(d for d in resp.updated_trip.days if d.day == 2)
    assert "p3" in day2.place_ids
    day1 = next(d for d in resp.updated_trip.days if d.day == 1)
    assert "p3" not in day1.place_ids
