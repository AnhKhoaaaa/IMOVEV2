import pytest
from postgrest.exceptions import APIError
from app.config import settings

skip_no_supabase = pytest.mark.skipif(
    not settings.supabase_url,
    reason="SUPABASE_URL not configured — set it in backend/.env to run this test",
)


@skip_no_supabase
def test_supabase_connection():
    """Verify Supabase credentials are valid and API is reachable."""
    from app.database import supabase

    assert supabase is not None, "Supabase client was not created despite URL being set"
    try:
        supabase.table("trips").select("id").limit(1).execute()
    except APIError as e:
        # PGRST205 = table not found → API reachable but migrations not applied yet
        if e.code == "PGRST205":
            pytest.skip("Supabase reachable but migrations not applied — run 001–003 SQL files")
        raise


@skip_no_supabase
def test_supabase_schema_ready():
    """Verify all required tables exist (migrations 001 + 002 applied)."""
    from app.database import supabase

    for table in ("trips", "route_legs", "trip_places", "lta_alerts", "trip_feedback"):
        result = supabase.table(table).select("id").limit(1).execute()
        assert result.data is not None, f"Table '{table}' returned no data object"

    # user_preferences uses user_id as PK (migration 005 dropped the id column)
    result = supabase.table("user_preferences").select("user_id").limit(1).execute()
    assert result.data is not None, "Table 'user_preferences' returned no data object"


@skip_no_supabase
def test_rls_policies_idempotent():
    """Verify migration 003 can be re-applied without error (idempotency check).

    Runs the DROP POLICY IF EXISTS + CREATE POLICY sequence from 003 directly
    via rpc so it confirms the SQL is safe to re-run.
    Skips if the Supabase project does not expose the rpc endpoint.
    """
    from app.database import supabase
    import pathlib

    sql_path = pathlib.Path(__file__).parents[2] / "supabase" / "migrations" / "003_security_patch.sql"
    if not sql_path.exists():
        pytest.skip("003_security_patch.sql not found")

    sql = sql_path.read_text()
    try:
        supabase.rpc("exec_sql", {"query": sql}).execute()
    except APIError as e:
        # PGRST202 = function not found — exec_sql rpc not registered, skip gracefully
        if e.code == "PGRST202":
            pytest.skip("exec_sql rpc not available — verify idempotency manually in SQL Editor")
        raise


@skip_no_supabase
def test_guest_trips_not_accessible_via_anon_key():
    """Guest rows must NOT be readable via the anon key without auth.uid().

    Regression test for the IDOR fix in 003_security_patch.sql:
    the old policy allowed any client to set app.session_id and read
    another guest's trips. After the patch, unauthenticated reads return
    an empty list, not a 403 — because RLS silently filters rows.
    """
    from supabase import create_client
    from app.config import settings

    if not settings.supabase_anon_key:
        pytest.skip("SUPABASE_ANON_KEY not configured")

    anon_client = create_client(settings.supabase_url, settings.supabase_anon_key)
    result = anon_client.table("trips").select("id").execute()
    # Unauthenticated anon client must see zero rows (RLS filters everything)
    assert result.data == [], (
        f"IDOR vulnerability still present: anon client can read {len(result.data)} trip row(s)"
    )
