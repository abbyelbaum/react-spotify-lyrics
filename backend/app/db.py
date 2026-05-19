import sqlite3
import time
from pathlib import Path
from contextlib import contextmanager

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
) -> int:
    with connect() as con:
        cur = con.execute(
            """
            INSERT INTO attempts
              (spotify_user_id, track_id, track_name, artist,
               words_correct, words_total, duration_seconds, score, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                spotify_user_id, track_id, track_name, artist,
                words_correct, words_total, duration_seconds, score, int(time.time()),
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


def best_percent_by_user(spotify_user_id: str) -> dict[str, int]:
    """Map of track_id -> best percentage (0-100, rounded) for this user."""
    with connect() as con:
        rows = con.execute(
            """
            SELECT track_id,
                   MAX(CAST(words_correct AS REAL) / words_total) AS best_pct
            FROM attempts
            WHERE spotify_user_id = ? AND words_total > 0
            GROUP BY track_id
            """,
            (spotify_user_id,),
        ).fetchall()
    return {r["track_id"]: round(float(r["best_pct"]) * 100) for r in rows}


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
