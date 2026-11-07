from __future__ import annotations

import os
import sqlite3
from pathlib import Path

SESSIONS_ENV = "OMP_DASHBOARD_SESSIONS_DIR"
STATS_DB_ENV = "OMP_DASHBOARD_STATS_DB"
DATA_DIR_ENV = "OMP_DASHBOARD_DATA_DIR"
APP_NAME = "omp-dashboard"


def sessions_root() -> Path:
    override = os.environ.get(SESSIONS_ENV)
    return Path(override) if override else Path.home() / ".omp" / "agent" / "sessions"


def stats_db_path() -> Path:
    override = os.environ.get(STATS_DB_ENV)
    return Path(override) if override else Path.home() / ".omp" / "stats.db"


def data_dir() -> Path:
    override = os.environ.get(DATA_DIR_ENV)
    if override:
        return Path(override)
    home = os.environ.get("KIROCREW_HOME") or str(Path.home() / ".kiro" / "crew")
    return Path(home) / "apps" / (os.environ.get("KIROCREW_APP_NAME") or APP_NAME) / "data"


def connect_readonly(path: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True, timeout=5)
