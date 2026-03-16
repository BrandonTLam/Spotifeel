const BASE = import.meta.env.VITE_API_BASE_URL;

export async function fetchRecommendations({
  mood = "",
  limit = 12,
  mode = "mood",
  excludeIds = [],
  onlyIds = [],
}) {
  const url = new URL(`${BASE}/recommendations`);

  if (mood && mood.trim()) url.searchParams.set("mood", mood.trim());
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("mode", mode);

  for (const id of onlyIds) url.searchParams.append("only_ids", id);
  for (const id of excludeIds) url.searchParams.append("exclude_ids", id);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

export function spotifyLoginUrl() {
  return `${BASE}/spotify/auth/login`;
}

export async function fetchSpotifyStatus() {
  const res = await fetch(`${BASE}/spotify/status`, { credentials: "include" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

export async function fetchSpotifyData() {
  const res = await fetch(`${BASE}/spotify/data`, { credentials: "include" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

export async function fetchSpotifyToken() {
  const res = await fetch(`${BASE}/spotify/token`, {
    credentials: "include",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch token: ${text}`);
  }

  const data = await res.json();
  return data.access_token;
}

export async function spotifyLogout() {
  const res = await fetch(`${BASE}/spotify/logout`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}
