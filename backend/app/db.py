"""Storage layer.

Auto-detects backend at import time:
- ``DATABASE_URL`` env var set (postgres://… or postgresql://…) → Neon / Postgres
  via ``psycopg``. Used in production.
- ``DATABASE_URL`` unset → local SQLite file at ``backend/data/scores.db``.
  Used in dev so you don't need a Postgres install.

All query strings use ``?`` placeholders (SQLite native); a small helper
translates them to ``%s`` for Postgres. Same goes for the schema — the
auto-increment id is the only real syntactic difference.
"""
import json
import os
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

from .song import song_key

DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
IS_POSTGRES = DATABASE_URL.startswith(("postgres://", "postgresql://"))

if IS_POSTGRES:
    import threading

    from psycopg.rows import dict_row
    from psycopg_pool import ConnectionPool

    # Keep a small pool of Postgres connections warm. Without this every
    # query reopens a new connection (~100-200ms over the network) which
    # adds up disastrously on endpoints that fire many small queries
    # (e.g. /api/set-tracks loops over every playlist/album).
    _pg_pool = ConnectionPool(
        DATABASE_URL,
        min_size=1,
        max_size=5,
        kwargs={"row_factory": dict_row},
        open=False,  # open lazily so import doesn't fail if Neon is sleeping
    )
    _pool_open_lock = threading.Lock()
    _pool_opened = False

    def _ensure_pool_open() -> None:
        global _pool_opened
        if _pool_opened:
            return
        with _pool_open_lock:
            if not _pool_opened:
                _pg_pool.open(wait=True, timeout=30)
                _pool_opened = True

# Only used when DATABASE_URL is unset (local dev). On Render with Postgres
# in production, this path is never touched.
DB_PATH = Path(__file__).resolve().parent.parent / "data" / "scores.db"


def _q(sql: str) -> str:
    """Translate ? placeholders to %s for Postgres; pass through for SQLite."""
    return sql.replace("?", "%s") if IS_POSTGRES else sql


@contextmanager
def connect():
    if IS_POSTGRES:
        _ensure_pool_open()
        # pool.connection() context manager handles commit/rollback +
        # returns the connection to the pool (NOT closes it) on exit.
        with _pg_pool.connection() as con:
            yield con
        return
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    try:
        yield con
        con.commit()
    finally:
        con.close()


def init_db() -> None:
    if not IS_POSTGRES:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    autoinc_pk = "BIGSERIAL PRIMARY KEY" if IS_POSTGRES else "INTEGER PRIMARY KEY AUTOINCREMENT"
    with connect() as con:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                spotify_user_id TEXT PRIMARY KEY,
                display_name    TEXT,
                access_token    TEXT NOT NULL,
                refresh_token   TEXT NOT NULL,
                expires_at      INTEGER NOT NULL,
                updated_at      INTEGER NOT NULL
            )
            """
        )
        con.execute(
            f"""
            CREATE TABLE IF NOT EXISTS attempts (
                id               {autoinc_pk},
                spotify_user_id  TEXT NOT NULL,
                track_id         TEXT NOT NULL,
                track_name       TEXT NOT NULL,
                artist           TEXT NOT NULL,
                words_correct    INTEGER NOT NULL,
                words_total      INTEGER NOT NULL,
                duration_seconds INTEGER NOT NULL,
                score            INTEGER NOT NULL,
                created_at       INTEGER NOT NULL,
                source_kind      TEXT,
                source_id        TEXT
            )
            """
        )
        # source_kind / source_id were added later. Existing SQLite DBs
        # may have an older `attempts` schema; patch them. (Postgres only
        # sees fresh schemas, so it doesn't need this.)
        if not IS_POSTGRES:
            _add_column_if_missing(con, "attempts", "source_kind", "TEXT")
            _add_column_if_missing(con, "attempts", "source_id", "TEXT")
        con.execute(
            "CREATE INDEX IF NOT EXISTS idx_attempts_user "
            "ON attempts(spotify_user_id, created_at DESC)"
        )
        con.execute(
            "CREATE INDEX IF NOT EXISTS idx_attempts_track_score "
            "ON attempts(track_id, score DESC)"
        )
        con.execute(
            "CREATE INDEX IF NOT EXISTS idx_attempts_source "
            "ON attempts(spotify_user_id, source_kind, source_id, created_at DESC)"
        )
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS set_tracks_cache (
                kind         TEXT NOT NULL,
                set_id       TEXT NOT NULL,
                snapshot_id  TEXT NOT NULL,
                track_ids    TEXT NOT NULL,
                updated_at   INTEGER NOT NULL,
                PRIMARY KEY (kind, set_id, snapshot_id)
            )
            """
        )


def _add_column_if_missing(con, table: str, column: str, decl: str) -> None:
    """SQLite-only migration helper (PRAGMA is SQLite-specific)."""
    cols = {row[1] for row in con.execute(f"PRAGMA table_info({table})")}
    if column not in cols:
        con.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")


def upsert_user(
    spotify_user_id: str,
    display_name: str | None,
    access_token: str,
    refresh_token: str,
    expires_at: int,
) -> None:
    now = int(time.time())
    with connect() as con:
        con.execute(
            _q(
                """
                INSERT INTO users (spotify_user_id, display_name, access_token, refresh_token, expires_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(spotify_user_id) DO UPDATE SET
                    display_name = excluded.display_name,
                    access_token = excluded.access_token,
                    refresh_token = excluded.refresh_token,
                    expires_at   = excluded.expires_at,
                    updated_at   = excluded.updated_at
                """
            ),
            (spotify_user_id, display_name, access_token, refresh_token, expires_at, now),
        )


def update_user_tokens(spotify_user_id: str, access_token: str, expires_at: int) -> None:
    with connect() as con:
        con.execute(
            _q("UPDATE users SET access_token = ?, expires_at = ?, updated_at = ? WHERE spotify_user_id = ?"),
            (access_token, expires_at, int(time.time()), spotify_user_id),
        )


def get_user(spotify_user_id: str):
    with connect() as con:
        return con.execute(
            _q("SELECT * FROM users WHERE spotify_user_id = ?"), (spotify_user_id,)
        ).fetchone()


def record_attempt(
    spotify_user_id: str,
    track_id: str,
    track_name: str,
    artist: str,
    words_correct: int,
    words_total: int,
    duration_seconds: int,
    score: int,
    source_kind: str | None = None,
    source_id: str | None = None,
) -> int:
    params = (
        spotify_user_id, track_id, track_name, artist,
        words_correct, words_total, duration_seconds, score, int(time.time()),
        source_kind, source_id,
    )
    base_sql = """
        INSERT INTO attempts
          (spotify_user_id, track_id, track_name, artist,
           words_correct, words_total, duration_seconds, score, created_at,
           source_kind, source_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """
    with connect() as con:
        if IS_POSTGRES:
            row = con.execute(_q(base_sql + " RETURNING id"), params).fetchone()
            return int(row["id"])
        cur = con.execute(base_sql, params)
        return int(cur.lastrowid)


def list_user_attempts(spotify_user_id: str, limit: int = 50):
    with connect() as con:
        return con.execute(
            _q(
                """
                SELECT * FROM attempts
                WHERE spotify_user_id = ?
                ORDER BY created_at DESC
                LIMIT ?
                """
            ),
            (spotify_user_id, limit),
        ).fetchall()


def last_played_sets_by_user(spotify_user_id: str) -> dict[str, int]:
    """Map of '<kind>:<id>' -> most recent attempt timestamp.
    `||` is SQL standard string concat — works on both SQLite and Postgres."""
    with connect() as con:
        rows = con.execute(
            _q(
                """
                SELECT source_kind || ':' || source_id AS key,
                       MAX(created_at) AS last_at
                FROM attempts
                WHERE spotify_user_id = ?
                  AND source_kind IS NOT NULL
                  AND source_id IS NOT NULL
                GROUP BY source_kind, source_id
                """
            ),
            (spotify_user_id,),
        ).fetchall()
    return {r["key"]: int(r["last_at"]) for r in rows}


def last_played_by_user(spotify_user_id: str) -> dict[str, int]:
    """Map of song_key -> most recent attempt timestamp."""
    with connect() as con:
        rows = con.execute(
            _q(
                """
                SELECT track_name, artist, MAX(created_at) AS last_played
                FROM attempts
                WHERE spotify_user_id = ?
                GROUP BY track_name, artist
                """
            ),
            (spotify_user_id,),
        ).fetchall()
    out: dict[str, int] = {}
    for r in rows:
        key = song_key(r["track_name"], r["artist"])
        ts = int(r["last_played"])
        if ts > out.get(key, 0):
            out[key] = ts
    return out


def best_percent_by_user(spotify_user_id: str) -> dict[str, int]:
    """Map of song_key -> best percentage (0-100, rounded)."""
    with connect() as con:
        rows = con.execute(
            _q(
                """
                SELECT track_name, artist,
                       MAX(CAST(words_correct AS REAL) / words_total) AS best_pct
                FROM attempts
                WHERE spotify_user_id = ? AND words_total > 0
                GROUP BY track_name, artist
                """
            ),
            (spotify_user_id,),
        ).fetchall()
    out: dict[str, int] = {}
    for r in rows:
        key = song_key(r["track_name"], r["artist"])
        pct = round(float(r["best_pct"]) * 100)
        if pct > out.get(key, -1):
            out[key] = pct
    return out


def get_cached_set_tracks(kind: str, set_id: str, snapshot_id: str) -> list[str] | None:
    """Return the cached list of song_keys for a (playlist|album, snapshot) pair.

    Returns None for cache misses AND for stale rows in the legacy
    track-id-only format (pre song_key migration).
    """
    with connect() as con:
        row = con.execute(
            _q(
                "SELECT track_ids FROM set_tracks_cache "
                "WHERE kind = ? AND set_id = ? AND snapshot_id = ?"
            ),
            (kind, set_id, snapshot_id),
        ).fetchone()
    if row is None:
        return None
    data = json.loads(row["track_ids"])
    if not data:
        return data
    # Heuristic: new format entries are "artist|title"; legacy entries are
    # bare Spotify track IDs (no pipe). Treat legacy as miss.
    if "|" not in data[0]:
        return None
    return data


def cache_set_tracks(kind: str, set_id: str, snapshot_id: str, song_keys: list[str]) -> None:
    """UPSERT cached track list. `ON CONFLICT` works on both SQLite (>=3.24)
    and Postgres, so we don't need separate code paths."""
    with connect() as con:
        con.execute(
            _q(
                """
                INSERT INTO set_tracks_cache (kind, set_id, snapshot_id, track_ids, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (kind, set_id, snapshot_id) DO UPDATE SET
                    track_ids = excluded.track_ids,
                    updated_at = excluded.updated_at
                """
            ),
            (kind, set_id, snapshot_id, json.dumps(song_keys), int(time.time())),
        )


def top_scores_for_track(track_id: str, limit: int = 10):
    with connect() as con:
        return con.execute(
            _q(
                """
                SELECT a.*, u.display_name
                FROM attempts a
                LEFT JOIN users u ON u.spotify_user_id = a.spotify_user_id
                WHERE a.track_id = ?
                ORDER BY a.score DESC, a.duration_seconds ASC
                LIMIT ?
                """
            ),
            (track_id, limit),
        ).fetchall()
