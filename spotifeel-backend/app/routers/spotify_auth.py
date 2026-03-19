import time

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse

from app.core.config import settings
from app.services.spotify_client import spotify_get
from app.services.spotify_oauth import (
    build_login_url,
    exchange_code_for_token,
    new_state,
    refresh_access_token,
)
from app.services.spotify_store import clear_session, load_session, save_session

router = APIRouter(prefix="/spotify", tags=["spotify_auth"])
legacy_router = APIRouter(tags=["spotify_auth_legacy"])

STATE_COOKIE = "spotify_auth_state"
STATE_TTL_SECONDS = 600
PENDING_STATES: dict[str, int] = {}


def _require_spotify_config() -> None:
    if settings.spotify_is_configured:
        return
    raise HTTPException(
        status_code=500,
        detail=(
            "Spotify OAuth is not configured. "
            "Set SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, and SPOTIFY_REDIRECT_URI in spotifeel-backend/.env"
        ),
    )


def _token_with_expiry(token_payload: dict) -> dict:
    out = dict(token_payload)
    expires_in = int(out.get("expires_in") or 3600)
    out["expires_at"] = int(time.time()) + max(expires_in - 30, 0)
    return out


def _remember_state(state: str) -> None:
    now = int(time.time())
    # Clean expired entries opportunistically.
    expired = [k for k, exp in PENDING_STATES.items() if exp <= now]
    for k in expired:
        del PENDING_STATES[k]
    PENDING_STATES[state] = now + STATE_TTL_SECONDS


def _consume_state(state: str | None) -> bool:
    if not state:
        return False
    expires_at = PENDING_STATES.get(state)
    if not expires_at:
        return False
    del PENDING_STATES[state]
    return expires_at > int(time.time())


def _token_is_expired(token_payload: dict) -> bool:
    expires_at = int(token_payload.get("expires_at") or 0)
    return expires_at <= int(time.time())


def _normalize_track_item(item: dict) -> dict | None:
    if not item:
        return None
    track = item.get("track") if isinstance(item.get("track"), dict) else item
    if not isinstance(track, dict):
        return None

    artists = []
    for a in (track.get("artists") or []):
        name = (a or {}).get("name")
        if name:
            artists.append(name)

    images = ((track.get("album") or {}).get("images") or [])
    image_url = images[0]["url"] if images and isinstance(images[0], dict) else None

    return {
        "id": track.get("id"),
        "name": track.get("name"),
        "artists": artists,
        "album": (track.get("album") or {}).get("name"),
        "image_url": image_url,
        "spotify_url": (track.get("external_urls") or {}).get("spotify"),
        "uri": track.get("uri"),
        "popularity": track.get("popularity"),
        "played_at": item.get("played_at"),
    }


async def _spotify_get_optional(access_token: str, path: str, params: dict | None = None) -> tuple[dict | None, str | None]:
    try:
        data = await spotify_get(access_token, path, params=params)
        return data, None
    except httpx.HTTPStatusError as exc:
        code = exc.response.status_code
        if code in {401, 403, 404}:
            return None, f"{path} returned {code}"
        raise


async def _refresh_token_if_needed(session: dict) -> dict:
    token = dict(session.get("token") or {})
    if not token.get("access_token"):
        raise HTTPException(status_code=401, detail="Not logged in to Spotify.")

    if not _token_is_expired(token):
        return token

    refresh_token = token.get("refresh_token")
    if not refresh_token:
        raise HTTPException(status_code=401, detail="Spotify session expired. Please login again.")

    refreshed = await refresh_access_token(
        client_id=settings.spotify_client_id,
        client_secret=settings.spotify_client_secret,
        refresh_token=refresh_token,
    )
    refreshed = _token_with_expiry(refreshed)
    if "refresh_token" not in refreshed:
        refreshed["refresh_token"] = refresh_token

    session["token"] = refreshed
    session["saved_at"] = int(time.time())
    save_session(settings.spotify_session_path, session)
    return refreshed


@router.get("/auth/login")
def spotify_login():
    _require_spotify_config()
    state = new_state()
    _remember_state(state)
    url = build_login_url(
        settings.spotify_client_id,
        settings.spotify_redirect_uri,
        state,
        settings.spotify_scope_list,
    )
    resp = RedirectResponse(url=url, status_code=307)
    resp.set_cookie(STATE_COOKIE, state, httponly=True, samesite="lax", max_age=600)
    return resp


@legacy_router.get("/auth/login")
def spotify_login_legacy():
    return spotify_login()


@router.get("/auth/callback")
async def spotify_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
):
    _require_spotify_config()
    frontend_base = settings.frontend_url.rstrip("/")

    if error:
        return RedirectResponse(f"{frontend_base}/?tab=spotify&spotify=error", status_code=307)
    if not code or not state:
        return RedirectResponse(f"{frontend_base}/?tab=spotify&spotify=error", status_code=307)

    stored_state = request.cookies.get(STATE_COOKIE)
    cookie_matches = bool(stored_state and stored_state == state)
    pending_matches = _consume_state(state)
    if not cookie_matches and not pending_matches:
        return RedirectResponse(f"{frontend_base}/?tab=spotify&spotify=state_mismatch", status_code=307)

    try:
        token = await exchange_code_for_token(
            client_id=settings.spotify_client_id,
            client_secret=settings.spotify_client_secret,
            redirect_uri=settings.spotify_redirect_uri,
            code=code,
        )
        token = _token_with_expiry(token)
        user = await spotify_get(token["access_token"], "/me")
    except httpx.HTTPError:
        return RedirectResponse(f"{frontend_base}/?tab=spotify&spotify=token_error", status_code=307)

    save_session(
        settings.spotify_session_path,
        {
            "token": token,
            "user": user,
            "saved_at": int(time.time()),
        },
    )

    resp = RedirectResponse(f"{frontend_base}/?tab=spotify&spotify=connected", status_code=307)
    resp.delete_cookie(STATE_COOKIE)
    return resp


@legacy_router.get("/auth/callback")
async def spotify_callback_legacy(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
):
    return await spotify_callback(request=request, code=code, state=state, error=error)


@router.get("/status")
def spotify_status():
    if not settings.spotify_is_configured:
        return {"configured": False, "connected": False, "user": None}

    session = load_session(settings.spotify_session_path)
    user = (session or {}).get("user")
    return {"configured": True, "connected": bool(user), "user": user}


@router.get("/data")
async def spotify_data():
    if not settings.spotify_is_configured:
        return {
            "configured": False,
            "connected": False,
            "profile": None,
            "top_tracks": [],
            "liked_tracks": [],
            "recently_played": [],
            "warnings": [],
        }

    session = load_session(settings.spotify_session_path)
    if not session:
        return {
            "configured": True,
            "connected": False,
            "profile": None,
            "top_tracks": [],
            "liked_tracks": [],
            "recently_played": [],
            "warnings": [],
        }

    token = await _refresh_token_if_needed(session)
    access_token = token["access_token"]

    warnings: list[str] = []

    profile, warn = await _spotify_get_optional(access_token, "/me")
    if warn:
        warnings.append(warn)

    top_raw, warn = await _spotify_get_optional(
        access_token,
        "/me/top/tracks",
        params={"limit": 12, "time_range": "short_term"},
    )
    if warn:
        warnings.append(warn)

    liked_raw, warn = await _spotify_get_optional(
        access_token,
        "/me/tracks",
        params={"limit": 12},
    )
    if warn:
        warnings.append(warn)

    recent_raw, warn = await _spotify_get_optional(
        access_token,
        "/me/player/recently-played",
        params={"limit": 12},
    )
    if warn:
        warnings.append(warn)

    top_tracks = [_normalize_track_item(x) for x in ((top_raw or {}).get("items") or [])]
    liked_tracks = [_normalize_track_item(x) for x in ((liked_raw or {}).get("items") or [])]
    recently_played = [_normalize_track_item(x) for x in ((recent_raw or {}).get("items") or [])]

    top_tracks = [x for x in top_tracks if x]
    liked_tracks = [x for x in liked_tracks if x]
    recently_played = [x for x in recently_played if x]

    if profile:
        session["user"] = profile
        session["saved_at"] = int(time.time())
        session["top_track_ids"] = [t["id"] for t in top_tracks if t and t.get("id")]
        session["liked_track_ids"] = [t["id"] for t in liked_tracks if t and t.get("id")]
        session["recent_track_ids"] = [t["id"] for t in recently_played if t and t.get("id")]
        save_session(settings.spotify_session_path, session)

    return {
        "configured": True,
        "connected": True,
        "profile": profile,
        "top_tracks": top_tracks,
        "liked_tracks": liked_tracks,
        "recently_played": recently_played,
        "warnings": warnings,
    }


@router.get("/me")
async def spotify_me():
    _require_spotify_config()
    session = load_session(settings.spotify_session_path)
    if not session:
        raise HTTPException(status_code=401, detail="Not logged in to Spotify.")

    token = await _refresh_token_if_needed(session)
    try:
        user = await spotify_get(token["access_token"], "/me")
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Spotify API request failed: {exc}") from exc

    session["user"] = user
    session["saved_at"] = int(time.time())
    save_session(settings.spotify_session_path, session)
    return {"configured": True, "connected": True, "user": user}

@router.get("/token")
async def spotify_token():
    _require_spotify_config()
    session = load_session(settings.spotify_session_path)
    if not session:
        raise HTTPException(status_code=401, detail="Not logged in to Spotify.")
    
    token = await _refresh_token_if_needed(session)
    return {"access_token": token["access_token"]}

@router.post("/logout")
def spotify_logout():
    clear_session(settings.spotify_session_path)
    return {"ok": True}
