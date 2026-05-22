import httpx
from fastapi import HTTPException

from .song import song_key

API_BASE = "https://api.spotify.com/v1"


async def _get(access_token: str, path: str, params: dict | None = None) -> dict:
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(
            f"{API_BASE}{path}",
            params=params,
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if r.status_code == 401:
        raise HTTPException(status_code=401, detail="Spotify token expired")
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=f"Spotify error: {r.text}")
    return r.json()


def _format_track(track: dict) -> dict:
    artists = track.get("artists") or []
    album = track.get("album") or {}
    images = album.get("images") or []
    return {
        "id": track.get("id"),
        "name": track.get("name"),
        "artist": ", ".join(a.get("name", "") for a in artists),
        "album": album.get("name"),
        "image": images[0]["url"] if images else None,
        "preview_url": track.get("preview_url"),
        "uri": track.get("uri"),
    }


async def get_top_tracks(access_token: str, time_range: str = "medium_term", limit: int = 50) -> list[dict]:
    data = await _get(
        access_token,
        "/me/top/tracks",
        {"time_range": time_range, "limit": min(limit, 50)},
    )
    return [_format_track(t) for t in data.get("items", []) if t.get("id")]


async def get_user_playlists(access_token: str, limit: int = 50) -> list[dict]:
    data = await _get(access_token, "/me/playlists", {"limit": min(limit, 50)})
    return [
        {
            "id": p.get("id"),
            "name": p.get("name"),
            "owner": (p.get("owner") or {}).get("display_name"),
            "image": (p.get("images") or [{}])[0].get("url") if p.get("images") else None,
            "tracks_total": (p.get("tracks") or {}).get("total", 0),
            "snapshot_id": p.get("snapshot_id"),
        }
        for p in data.get("items", [])
        if p.get("id")
    ]


async def get_playlist_tracks(access_token: str, playlist_id: str, limit: int = 100) -> list[dict]:
    data = await _get(
        access_token,
        f"/playlists/{playlist_id}/tracks",
        {"limit": min(limit, 100), "fields": "items(track(id,name,artists(name),album(name,images),preview_url,uri))"},
    )
    tracks = []
    for item in data.get("items", []):
        track = item.get("track")
        if track and track.get("id"):
            tracks.append(_format_track(track))
    return tracks


def _format_album_summary(album: dict) -> dict:
    images = album.get("images") or []
    return {
        "id": album.get("id"),
        "name": album.get("name"),
        "artist": ", ".join(a.get("name", "") for a in (album.get("artists") or [])),
        "image": images[0]["url"] if images else None,
        "tracks_total": (album.get("tracks") or {}).get("total")
            or album.get("total_tracks"),
    }


async def get_saved_albums(access_token: str, limit: int = 50) -> list[dict]:
    data = await _get(access_token, "/me/albums", {"limit": min(limit, 50)})
    return [
        _format_album_summary(item["album"])
        for item in data.get("items", [])
        if item.get("album", {}).get("id")
    ]


async def get_album_tracks(access_token: str, album_id: str) -> list[dict]:
    """Fetch the full album, then map each track and attach album metadata
    (Spotify's /albums/{id}/tracks endpoint omits album info per track)."""
    album = await _get(access_token, f"/albums/{album_id}")
    images = album.get("images") or []
    album_image = images[0]["url"] if images else None
    album_name = album.get("name")
    tracks = []
    for t in (album.get("tracks") or {}).get("items", []):
        if not t.get("id"):
            continue
        tracks.append({
            "id": t.get("id"),
            "name": t.get("name"),
            "artist": ", ".join(a.get("name", "") for a in (t.get("artists") or [])),
            "album": album_name,
            "image": album_image,
            "preview_url": t.get("preview_url"),
            "uri": t.get("uri"),
        })
    return tracks


async def get_playlist_song_keys(access_token: str, playlist_id: str) -> list[str]:
    """Returns ``song_key`` per track for cache population.

    Using song_key (artist+title) instead of Spotify's track_id lets us match
    plays of the same recording across different releases (single, album,
    compilation), which all have distinct track_ids.
    """
    keys: list[str] = []
    offset = 0
    while True:
        data = await _get(
            access_token,
            f"/playlists/{playlist_id}/tracks",
            {
                "limit": 100, "offset": offset,
                "fields": "items(track(name,artists(name))),next",
            },
        )
        for item in data.get("items", []):
            track = item.get("track") or {}
            name = track.get("name")
            artists = ", ".join(a.get("name", "") for a in (track.get("artists") or []))
            if name and artists:
                keys.append(song_key(name, artists))
        if not data.get("next"):
            break
        offset += 100
    return keys


async def get_album_song_keys(access_token: str, album_id: str) -> list[str]:
    """Returns ``song_key`` per album track (see ``get_playlist_song_keys``)."""
    keys: list[str] = []
    offset = 0
    while True:
        data = await _get(
            access_token,
            f"/albums/{album_id}/tracks",
            {"limit": 50, "offset": offset},
        )
        for t in data.get("items", []):
            name = t.get("name")
            artists = ", ".join(a.get("name", "") for a in (t.get("artists") or []))
            if name and artists:
                keys.append(song_key(name, artists))
        if not data.get("next"):
            break
        offset += 50
    return keys


async def search(access_token: str, query: str, kinds: str = "track,album", limit: int = 20) -> dict:
    data = await _get(
        access_token,
        "/search",
        {"q": query, "type": kinds, "limit": min(limit, 50)},
    )
    out: dict = {}
    if "tracks" in data:
        out["tracks"] = [_format_track(t) for t in data["tracks"].get("items", []) if t.get("id")]
    if "albums" in data:
        out["albums"] = [
            _format_album_summary(a) for a in data["albums"].get("items", []) if a.get("id")
        ]
    return out
