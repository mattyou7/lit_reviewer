"""URL-keyed HTTP record/replay for deterministic automated checks.

Off unless an environment variable is set — normal runs always hit the
real network:

  LIIT_HTTP_RECORD_DIR=<dir>  fetch for real and save each response body
                              under sha1(url) (used ONCE to capture the
                              fixture set during a live integration run).
  LIIT_HTTP_REPLAY_DIR=<dir>  never touch the network: return the saved
                              body for sha1(url); a missing file raises
                              SearchError("replay fixture missing: ..."),
                              which callers surface honestly.

Response files: <sha1-hex-of-full-url>.body  (plus a .url sidecar with
the original URL for human inspection of the fixture set).
"""
from __future__ import annotations

import hashlib
import os
from pathlib import Path

from .common import SearchError


def _record_dir() -> Path | None:
    value = os.environ.get("LIIT_HTTP_RECORD_DIR", "")
    return Path(value) if value else None


def _replay_dir() -> Path | None:
    value = os.environ.get("LIIT_HTTP_REPLAY_DIR", "")
    return Path(value) if value else None


def _paths(directory: Path, url: str) -> tuple[Path, Path]:
    key = hashlib.sha1(url.encode("utf-8")).hexdigest()
    return directory / f"{key}.body", directory / f"{key}.url"


def http_get(url: str, fetch) -> bytes:
    """Route one HTTP GET through record/replay/live.

    `fetch` performs the real request. Replay mode never calls it;
    record mode calls it once and stores the body for later replay.
    """
    record_dir = _record_dir()
    replay_dir = _replay_dir()
    if replay_dir is not None:
        body_path, _ = _paths(replay_dir, url)
        if not body_path.exists():
            raise SearchError(f"replay fixture missing: {url}")
        return body_path.read_bytes()
    body = fetch()
    if record_dir is not None:
        record_dir.mkdir(parents=True, exist_ok=True)
        body_path, url_path = _paths(record_dir, url)
        body_path.write_bytes(body)
        url_path.write_text(url, encoding="utf-8")
    return body
