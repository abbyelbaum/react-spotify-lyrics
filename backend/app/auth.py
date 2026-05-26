import base64
import secrets
import time
import urllib.parse
from typing import Optional

import httpx
from fastapi import HTTPException, Request, Response
from itsdangerous import BadSignature, URLSafeSerializer

from .config import settings
from . import db

SESSION_COOKIE = "session"
_serializer = URLSafeSerializer(settings.session_secret, salt="session")
_state_serializer = URLSafeSerializer(settings.session_secret, salt="oauth-state")

SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"
SPOTIFY_AUTHORIZE_URL = "https://accounts.spotify.com/authorize"
SPOTIFY_ME_URL = "https://api.spotify.com/v1/me"


def build_authorize_url() -> str:
    state = _state_serializer.dumps({"nonce": secrets.token_urlsafe(16), "ts": int(time.time())})
    params = {
        "response_type": "code",
        "client_id": settings.spotify_client_id,
        "scope": settings.spotify_scopes,
        "redirect_uri": settings.spotify_redirect_uri,
        "state": state,
        "show_dialog": "false",
    }
    return f"{SPOTIFY_AUTHORIZE_URL}?{urllib.parse.urlencode(params)}"


def verify_state(state: str) -> None:
    try:
        payload = _state_serializer.loads(state)
    except BadSignature:
        raise HTTPException(status_code=400, detail="Invalid OAuth state")
    if int(time.time()) - int(payload.get("ts", 0)) > 600:
        raise HTTPException(status_code=400, detail="OAuth state expired")


def _basic_auth_header() -> str:
    raw = f"{settings.spotify_client_id}:{settings.spotify_client_secret}".encode()
    return "Basic " + base64.b64encode(raw).decode()


async def exchange_code_for_tokens(code: str) -> dict:
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            SPOTIFY_TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": settings.spotify_redirect_uri,
            },
            headers={"Authorization": _basic_auth_header()},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=400, detail=f"Token exchange failed: {r.text}")
    return r.json()


async def refresh_access_token(refresh_token: str) -> dict:
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            SPOTIFY_TOKEN_URL,
            data={"grant_type": "refresh_token", "refresh_token": refresh_token},
            headers={"Authorization": _basic_auth_header()},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Failed to refresh Spotify token")
    return r.json()


_cc_token_cache: dict = {"token": None, "expires_at": 0}


async def get_client_credentials_token() -> str:
    """App-level Spotify token for public reads (search, album lookups).
    No user auth required. Cached in-memory until expiry. Used by the
    "Play as guest" mode so a viewer can browse the public Spotify catalog
    without logging in.
    """
    if _cc_token_cache["token"] and time.time() < _cc_token_cache["expires_at"] - 30:
        return _cc_token_cache["token"]
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            SPOTIFY_TOKEN_URL,
            data={"grant_type": "client_credentials"},
            headers={"Authorization": _basic_auth_header()},
        )
    if r.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Spotify client_credentials failed: {r.text}",
        )
    data = r.json()
    _cc_token_cache["token"] = data["access_token"]
    _cc_token_cache["expires_at"] = time.time() + int(data.get("expires_in", 3600))
    return _cc_token_cache["token"]


async def fetch_me(access_token: str) -> dict:
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(SPOTIFY_ME_URL, headers={"Authorization": f"Bearer {access_token}"})
    if r.status_code != 200:
        raise HTTPException(status_code=400, detail=f"Failed to fetch Spotify profile: {r.text}")
    return r.json()


def set_session_cookie(response: Response, spotify_user_id: str) -> None:
    token = _serializer.dumps({"uid": spotify_user_id})
    response.set_cookie(
        SESSION_COOKIE,
        token,
        httponly=True,
        samesite="lax",
        max_age=60 * 60 * 24 * 30,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")


def _read_session(request: Request) -> Optional[str]:
    raw = request.cookies.get(SESSION_COOKIE)
    if not raw:
        return None
    try:
        payload = _serializer.loads(raw)
    except BadSignature:
        return None
    return payload.get("uid")


async def get_valid_access_token(request: Request) -> tuple[str, str]:
    """Returns (spotify_user_id, fresh access_token), refreshing if needed."""
    uid = _read_session(request)
    if not uid:
        raise HTTPException(status_code=401, detail="Not logged in")
    user = db.get_user(uid)
    if not user:
        raise HTTPException(status_code=401, detail="Session user not found")

    if int(time.time()) < int(user["expires_at"]) - 30:
        return uid, user["access_token"]

    refreshed = await refresh_access_token(user["refresh_token"])
    new_access = refreshed["access_token"]
    new_expires = int(time.time()) + int(refreshed.get("expires_in", 3600))
    db.update_user_tokens(uid, new_access, new_expires)
    return uid, new_access


def current_user_id(request: Request) -> str:
    uid = _read_session(request)
    if not uid:
        raise HTTPException(status_code=401, detail="Not logged in")
    return uid
