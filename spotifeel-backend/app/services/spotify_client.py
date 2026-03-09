import httpx

SPOTIFY_API_BASE = "https://api.spotify.com/v1"


async def spotify_get(access_token: str, path: str, params: dict | None = None) -> dict:
    headers = {"Authorization": f"Bearer {access_token}"}
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(f"{SPOTIFY_API_BASE}{path}", headers=headers, params=params)
        r.raise_for_status()
        return r.json()
