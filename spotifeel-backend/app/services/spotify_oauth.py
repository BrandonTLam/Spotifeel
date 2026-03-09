import base64
import secrets
import urllib.parse

import httpx

SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize"
SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"


def new_state() -> str:
    return secrets.token_urlsafe(24)


def build_login_url(client_id: str, redirect_uri: str, state: str, scopes: list[str]) -> str:
    params = {
        "response_type": "code",
        "client_id": client_id,
        "scope": " ".join(scopes),
        "redirect_uri": redirect_uri,
        "state": state,
    }
    return f"{SPOTIFY_AUTH_URL}?{urllib.parse.urlencode(params)}"


def _basic_auth_header(client_id: str, client_secret: str) -> str:
    basic = base64.b64encode(f"{client_id}:{client_secret}".encode("utf-8")).decode("utf-8")
    return f"Basic {basic}"


async def exchange_code_for_token(client_id: str, client_secret: str, redirect_uri: str, code: str) -> dict:
    headers = {
        "Authorization": _basic_auth_header(client_id, client_secret),
        "Content-Type": "application/x-www-form-urlencoded",
    }
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
    }
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(SPOTIFY_TOKEN_URL, headers=headers, data=data)
        r.raise_for_status()
        return r.json()


async def refresh_access_token(client_id: str, client_secret: str, refresh_token: str) -> dict:
    headers = {
        "Authorization": _basic_auth_header(client_id, client_secret),
        "Content-Type": "application/x-www-form-urlencoded",
    }
    data = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
    }
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(SPOTIFY_TOKEN_URL, headers=headers, data=data)
        r.raise_for_status()
        return r.json()
