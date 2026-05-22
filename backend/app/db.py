import sqlite3
import time
from pathlib import Path
from contextlib import contextmanager

from .song import song_key

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "scores.db"


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as con:
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                spotify_user_id TEXT PRIMARY KEY,
                display_name    TEXT,
                access_token    TEXT NOT NULL,
                refresh_token   TEXT NOT NULL,
                expires_at      INTEGER NOT NULL,
                updated_at      INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS attempts (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                spotify_user_id  TEXT NOT NULL,
                track_id         TEXT NOT NULL,
                track_name       TEXT NOT NULL,
                artist           TEXT NOT NULL,
                words_correct    INTEGER NOT NULL,
                words_total      INTEGER NOT NULL,
                duration_seconds INTEGER NOT NULL,
                score            INTEGER NOT NULL,
                created_at       INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_attempts_user
                ON attempts(spotify_user_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_attempts_track_score
                ON attempts(track_id, score DESC);
            """
        )
        _add_column_if_missing(con, "attempts", "source_kind", "TEXT")
        _add_column_if_missing(con, "attempts", "source_id", "TEXT")
        con.execute(
            "CREATE INDEX IF NOT EXISTS idx_attempts_source "
            "ON attempts(spotify_user_id, source_kind, source_id, created_at DESC)"
        )

        # Track-ID cache for playlists & albums. Keyed by snapshot so a stale
        # row is just ignored next time (playlist contents changed -> miss).
        # For albums (immutable), snapshot_id is set to the album id.
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS set_tracks_cache (
                kind         TEXT NOT NULL,
                set_id       TEXT NOT NULL,
                snapshot_id  TEXT NOT NULL,
                track_ids    TEXT NOT NULL,
                updated_at   INTEGER NOT NULL,
                PRIMARY KEY (kind, set_id, snapshot_id)
            );
            """
        )


def _add_column_if_missing(con: sqlite3.Connection, table: str, column: str, decl: str) -> None:
    cols = {row[1] for row in con.execute(f"PRAGMA table_info({table})")}
    if column not in cols:
        con.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")


@contextmanager
def connect():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    try:
        yield con
        con.commit()
    finally:
        con.close()


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
            """
            INSERT INTO users (spotify_user_id, display_name, access_token, refresh_token, expires_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(spotify_user_id) DO UPDATE SET
                display_name = excluded.display_name,
                access_token = excluded.access_token,
                refresh_token = excluded.refresh_token,
                expires_at   = excluded.expires_at,
                updated_at   = excluded.updated_at
            """,
            (spotify_user_id, display_name, access_token, refresh_token, expires_at, now),
        )


def update_user_tokens(spotify_user_id: str, access_token: str, expires_at: int) -> None:
    with connect() as con:
        con.execute(
            "UPDATE users SET access_token = ?, expires_at = ?, updated_at = ? WHERE spotify_user_id = ?",
            (access_token, expires_at, int(time.time()), spotify_user_id),
        )


def get_user(spotify_user_id: str) -> sqlite3.Row | None:
    with connect() as con:
        return con.execute(
            "SELECT * FROM users WHERE spotify_user_id = ?", (spotify_user_id,)
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
    with connect() as con:
        cur = con.execute(
            """
            INSERT INTO attempts
              (spotify_user_id, track_id, track_name, artist,
               words_correct, words_total, duration_seconds, score, created_at,
               source_kind, source_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                spotify_user_id, track_id, track_name, artist,
                words_correct, words_total, duration_seconds, score, int(time.time()),
                source_kind, source_id,
            ),
        )
        return cur.lastrowid


def list_user_attempts(spotify_user_id: str, limit: int = 50) -> list[sqlite3.Row]:
    with connect() as con:
        return con.execute(
            """
            SELECT * FROM attempts
            WHERE spotify_user_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (spotify_user_id, limit),
        ).fetchall()


def last_played_sets_by_user(spotify_user_id: str) -> dict[str, int]:
    """Map of '<kind>:<id>' -> most recent attempt timestamp, for attempts
    that recorded a source playlist or album. Lets the frontend sort the
    playlist/album lists by recency without enumerating each set's tracks.
    """
    with connect() as con:
        rows = con.execute(
            """
            SELECT source_kind || ':' || source_id AS key,
                   MAX(created_at) AS last_at
            FROM attempts
            WHERE spotify_user_id = ?
              AND source_kind IS NOT NULL
              AND source_id IS NOT NULL
            GROUP BY source_kind, source_id
            """,
            (spotify_user_id,),
        ).fetchall()
    return {r["key"]: int(r["last_at"]) for r in rows}


def last_played_by_user(spotify_user_id: str) -> dict[str, int]:
    """Map of song_key -> most recent attempt timestamp (unix seconds).
    Keyed by song identity (artist+title) so the same recording across
    different releases collapses into one entry."""
    with connect() as con:
        rows = con.execute(
            """
            SELECT track_name, artist, MAX(created_at) AS last_played
            FROM attempts
            WHERE spotify_user_id = ?
            GROUP BY track_name, artist
            """,
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
    """Map of song_key -> best percentage (0-100, rounded) for this user.
    See ``last_played_by_user`` for why we key on song identity, not track_id."""
    with connect() as con:
        rows = con.execute(
            """
            SELECT track_name, artist,
                   MAX(CAST(words_correct AS REAL) / words_total) AS best_pct
            FROM attempts
            WHERE spotify_user_id = ? AND words_total > 0
            GROUP BY track_name, artist
            """,
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
    track-id-only format (pre song_key migration). Stale rows are
    silently overwritten the next time we cache for this set.
    """
    with connect() as con:
        row = con.execute(
            "SELECT track_ids FROM set_tracks_cache "
            "WHERE kind = ? AND set_id = ? AND snapshot_id = ?",
            (kind, set_id, snapshot_id),
        ).fetchone()
    if row is None:
        return None
    import json
    data = json.loads(row["track_ids"])
    # Heuristic: new format entries are "artist|title"; legacy entries are
    # bare Spotify track IDs (22-char base62, no pipe). Treat legacy as miss.
    if not data:
        return data
    if "|" not in data[0]:
        return None
    return data


def cache_set_tracks(kind: str, set_id: str, snapshot_id: str, song_keys: list[str]) -> None:
    import json
    with connect() as con:
        con.execute(
            "INSERT OR REPLACE INTO set_tracks_cache "
            "(kind, set_id, snapshot_id, track_ids, updated_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (kind, set_id, snapshot_id, json.dumps(song_keys), int(time.time())),
        )


def top_scores_for_track(track_id: str, limit: int = 10) -> list[sqlite3.Row]:
    with connect() as con:
        return con.execute(
            """
            SELECT a.*, u.display_name
            FROM attempts a
            LEFT JOIN users u ON u.spotify_user_id = a.spotify_user_id
            WHERE a.track_id = ?
            ORDER BY a.score DESC, a.duration_seconds ASC
            LIMIT ?
            """,
            (track_id, limit),
        ).fetchall()
