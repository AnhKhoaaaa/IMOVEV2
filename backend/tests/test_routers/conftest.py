import pytest
from unittest.mock import patch

import app.routers.trips as _trips_module


@pytest.fixture(autouse=True)
def no_supabase(monkeypatch):
    """Force supabase to None so router tests don't touch the real DB."""
    monkeypatch.setattr(_trips_module, "supabase", None)
    # Also reset the in-memory store so tests are isolated
    _trips_module._trip_store.clear()
    yield
    _trips_module._trip_store.clear()
