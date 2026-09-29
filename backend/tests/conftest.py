"""Shared test fixtures.

The automatic landscape build (discovery) performs real network calls
to PubMed/arXiv, so unit tests neuter its scheduling seam: upload and
attach endpoints in these tests behave exactly as before (no background
build). discovery.run_discovery itself is tested directly in
test_discovery.py with controlled provider fixtures, and the end-to-end
trigger is exercised by Liit/automatic_landscape_check.mjs.
"""
import pytest


@pytest.fixture(autouse=True)
def _no_auto_discovery(monkeypatch):
    from backend.app import discovery
    # Stash the real seam once so tests that inspect its behavior can
    # restore it; every other test sees the neutered no-op.
    if not hasattr(discovery, "_REAL_SCHEDULE_BUILD"):
        discovery._REAL_SCHEDULE_BUILD = discovery.schedule_build
    monkeypatch.setattr(discovery, "schedule_build",
                        lambda *args, **kwargs: False)
