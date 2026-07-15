"""Thread-safe SQLite event store (sessions + detection events)."""
import json
import sqlite3
import threading
import time
from typing import Any, Optional

from . import config

_lock = threading.Lock()
_conn: Optional[sqlite3.Connection] = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    use_case    TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source      TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'running',
    created_at  REAL NOT NULL,
    ended_at    REAL
);
CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    use_case   TEXT NOT NULL,
    type       TEXT NOT NULL,
    label      TEXT NOT NULL,
    confidence REAL,
    ts         REAL NOT NULL,
    extra      TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
"""


def init_db() -> None:
    global _conn
    _conn = sqlite3.connect(str(config.DB_PATH), check_same_thread=False)
    _conn.row_factory = sqlite3.Row
    _conn.execute("PRAGMA journal_mode=WAL")
    _conn.executescript(SCHEMA)
    _conn.commit()
    # Any session left 'running' from a previous process is dead now.
    with _lock:
        _conn.execute(
            "UPDATE sessions SET status='stopped', ended_at=? WHERE status='running'",
            (time.time(),),
        )
        _conn.commit()


def _db() -> sqlite3.Connection:
    assert _conn is not None, "init_db() not called"
    return _conn


# ---------- sessions ----------

def create_session(session_id: str, use_case: str, source_type: str, source: str) -> None:
    with _lock:
        _db().execute(
            "INSERT INTO sessions (id, use_case, source_type, source, status, created_at) "
            "VALUES (?, ?, ?, ?, 'running', ?)",
            (session_id, use_case, source_type, source, time.time()),
        )
        _db().commit()


def set_session_status(session_id: str, status: str) -> None:
    with _lock:
        _db().execute(
            "UPDATE sessions SET status=?, ended_at=? WHERE id=?",
            (status, time.time() if status != "running" else None, session_id),
        )
        _db().commit()


def get_session(session_id: str) -> Optional[dict]:
    with _lock:
        row = _db().execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
    return dict(row) if row else None


def list_sessions(limit: int = 50) -> list[dict]:
    with _lock:
        rows = _db().execute(
            "SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


# ---------- events ----------

def insert_events(session_id: str, use_case: str, events: list[dict]) -> None:
    if not events:
        return
    rows = [
        (
            session_id,
            use_case,
            e["type"],
            e["label"],
            e.get("confidence"),
            e.get("ts", time.time()),
            json.dumps(e.get("extra")) if e.get("extra") is not None else None,
        )
        for e in events
    ]
    with _lock:
        _db().executemany(
            "INSERT INTO events (session_id, use_case, type, label, confidence, ts, extra) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            rows,
        )
        _db().commit()


def query_events(
    session_id: Optional[str] = None,
    use_case: Optional[str] = None,
    event_type: Optional[str] = None,
    q: Optional[str] = None,
    since: Optional[float] = None,
    limit: int = 200,
    offset: int = 0,
) -> list[dict]:
    sql = "SELECT * FROM events WHERE 1=1"
    args: list[Any] = []
    if session_id:
        sql += " AND session_id=?"
        args.append(session_id)
    if use_case:
        sql += " AND use_case=?"
        args.append(use_case)
    if event_type:
        sql += " AND type=?"
        args.append(event_type)
    if q:
        sql += " AND (label LIKE ? OR type LIKE ?)"
        args += [f"%{q}%", f"%{q}%"]
    if since:
        sql += " AND ts>=?"
        args.append(since)
    sql += " ORDER BY ts DESC LIMIT ? OFFSET ?"
    args += [limit, offset]
    with _lock:
        rows = _db().execute(sql, args).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["extra"] = json.loads(d["extra"]) if d["extra"] else None
        out.append(d)
    return out


def events_per_hour(hours: int = 24) -> list[dict]:
    """Event counts bucketed per hour per use case — powers the history chart."""
    since = time.time() - hours * 3600
    with _lock:
        rows = _db().execute(
            "SELECT CAST(ts / 3600 AS INTEGER) * 3600 AS bucket, use_case, COUNT(*) AS count "
            "FROM events WHERE ts>=? GROUP BY bucket, use_case ORDER BY bucket",
            (since,),
        ).fetchall()
    return [dict(r) for r in rows]


def attendance_log(session_id: str) -> list[dict]:
    """Per-person first/last seen inside one session."""
    with _lock:
        rows = _db().execute(
            "SELECT label AS name, MIN(ts) AS first_seen, MAX(ts) AS last_seen, COUNT(*) AS sightings "
            "FROM events WHERE session_id=? AND type IN ('check_in','seen') "
            "GROUP BY label ORDER BY first_seen",
            (session_id,),
        ).fetchall()
    return [dict(r) for r in rows]
