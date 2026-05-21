import asyncio
import random
import time

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from . import auth, db, lyrics, spotify
from .config import settings
from .quiz import compute_score

app = FastAPI(title="Spotify Lyrics Quiz", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    db.init_db()


# -------------------- Auth --------------------

@app.get("/auth/login")
def auth_login():
    return RedirectResponse(auth.build_authorize_url(), status_code=302)


@app.get("/auth/callback")
async def auth_callback(code: str | None = None, state: str | None = None, error: str | None = None):
    if error:
        return RedirectResponse(f"{settings.frontend_url}/?error={error}", status_code=302)
    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing code or state")

    auth.verify_state(state)
    tokens = await auth.exchange_code_for_tokens(code)
    access_token = tokens["access_token"]
    refresh_token = tokens["refresh_token"]
    expires_at = int(time.time()) + int(tokens.get("expires_in", 3600))

    me = await auth.fetch_me(access_token)
    spotify_user_id = me["id"]
    display_name = me.get("display_name") or me["id"]

    db.upsert_user(spotify_user_id, display_name, access_token, refresh_token, expires_at)

    response = RedirectResponse(f"{settings.frontend_url}/picker", status_code=302)
    auth.set_session_cookie(response, spotify_user_id)
    return response


@app.post("/auth/logout")
def auth_logout(response: Response):
    auth.clear_session_cookie(response)
    return {"ok": True}


@app.get("/api/me")
def api_me(request: Request):
    uid = auth.current_user_id(request)
    user = db.get_user(uid)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return {"id": user["spotify_user_id"], "display_name": user["display_name"]}


# -------------------- Spotify content --------------------

@app.get("/api/top-tracks")
async def api_top_tracks(request: Request, time_range: str = "medium_term", limit: int = 50):
    _, access_token = await auth.get_valid_access_token(request)
    return await spotify.get_top_tracks(access_token, time_range, limit)


@app.get("/api/playlists")
async def api_playlists(request: Request):
    _, access_token = await auth.get_valid_access_token(request)
    return await spotify.get_user_playlists(access_token)


@app.get("/api/playlists/{playlist_id}/tracks")
async def api_playlist_tracks(playlist_id: str, request: Request):
    _, access_token = await auth.get_valid_access_token(request)
    return await spotify.get_playlist_tracks(access_token, playlist_id)


@app.get("/api/albums")
async def api_albums(request: Request):
    _, access_token = await auth.get_valid_access_token(request)
    return await spotify.get_saved_albums(access_token)


@app.get("/api/albums/{album_id}/tracks")
async def api_album_tracks(album_id: str, request: Request):
    _, access_token = await auth.get_valid_access_token(request)
    return await spotify.get_album_tracks(access_token, album_id)


@app.get("/api/search")
async def api_search(request: Request, q: str, type: str = "track,album"):
    if not q.strip():
        return {"tracks": [], "albums": []}
    _, access_token = await auth.get_valid_access_token(request)
    return await spotify.search(access_token, q, type)


@app.get("/api/random-from-top")
async def api_random_from_top(request: Request, time_range: str = "medium_term"):
    _, access_token = await auth.get_valid_access_token(request)
    tracks = await spotify.get_top_tracks(access_token, time_range, 50)
    if not tracks:
        raise HTTPException(status_code=404, detail="No top tracks found")
    return random.choice(tracks)


# -------------------- Lyrics + quiz --------------------

@app.get("/api/lyrics")
async def api_lyrics(request: Request, title: str, artist: str):
    auth.current_user_id(request)  # must be logged in
    return await lyrics.get_tokenized_lyrics(title, artist)


class AttemptIn(BaseModel):
    track_id: str
    track_name: str
    artist: str
    words_correct: int
    words_total: int
    duration_seconds: int
    source_kind: str | None = None
    source_id: str | None = None


@app.post("/api/attempts")
def api_attempts(payload: AttemptIn, request: Request):
    uid = auth.current_user_id(request)
    score = compute_score(payload.words_correct, payload.words_total, payload.duration_seconds)
    attempt_id = db.record_attempt(
        spotify_user_id=uid,
        track_id=payload.track_id,
        track_name=payload.track_name,
        artist=payload.artist,
        words_correct=payload.words_correct,
        words_total=payload.words_total,
        duration_seconds=payload.duration_seconds,
        score=score,
        source_kind=payload.source_kind,
        source_id=payload.source_id,
    )
    return {"id": attempt_id, "score": score}


@app.get("/api/attempts")
def api_list_attempts(request: Request, limit: int = 50):
    uid = auth.current_user_id(request)
    rows = db.list_user_attempts(uid, limit)
    return [dict(r) for r in rows]


@app.get("/api/scores/track/{track_id}")
def api_top_scores(track_id: str, request: Request, limit: int = 10):
    auth.current_user_id(request)
    rows = db.top_scores_for_track(track_id, limit)
    return [dict(r) for r in rows]


@app.get("/api/best-scores")
def api_best_scores(request: Request):
    uid = auth.current_user_id(request)
    return db.best_percent_by_user(uid)


@app.get("/api/last-played")
def api_last_played(request: Request):
    uid = auth.current_user_id(request)
    return db.last_played_by_user(uid)


@app.get("/api/last-played-sets")
def api_last_played_sets(request: Request):
    uid = auth.current_user_id(request)
    return db.last_played_sets_by_user(uid)


class SetTracksItem(BaseModel):
    id: str
    snapshot_id: str | None = None


class SetTracksIn(BaseModel):
    kind: str  # "playlist" | "album"
    items: list[SetTracksItem]


@app.post("/api/set-tracks")
async def api_set_tracks(payload: SetTracksIn, request: Request):
    """Return {set_id: [track_ids...]} for a batch of playlists or albums.
    Hits Spotify only for cache misses; misses are throttled (5 concurrent)."""
    if payload.kind not in ("playlist", "album"):
        raise HTTPException(status_code=400, detail="kind must be 'playlist' or 'album'")
    _, access_token = await auth.get_valid_access_token(request)

    result: dict[str, list[str]] = {}
    misses: list[tuple[str, str]] = []  # (set_id, snapshot_id)
    for item in payload.items:
        # Albums are immutable; cache them under their own id as snapshot.
        snapshot = item.snapshot_id or (item.id if payload.kind == "album" else "")
        cached = db.get_cached_set_tracks(payload.kind, item.id, snapshot)
        if cached is not None:
            result[item.id] = cached
        else:
            misses.append((item.id, snapshot))

    if misses:
        sem = asyncio.Semaphore(5)

        async def fetch_one(set_id: str, snapshot: str) -> tuple[str, list[str]]:
            async with sem:
                try:
                    if payload.kind == "playlist":
                        ids = await spotify.get_playlist_track_ids(access_token, set_id)
                    else:
                        ids = await spotify.get_album_track_ids(access_token, set_id)
                except HTTPException:
                    return set_id, []
                db.cache_set_tracks(payload.kind, set_id, snapshot, ids)
                return set_id, ids

        for set_id, ids in await asyncio.gather(*[fetch_one(s, sn) for s, sn in misses]):
            result[set_id] = ids

    return result


@app.get("/api/health")
def api_health():
    return {"ok": True}
