const BASE = import.meta.env.VITE_API_BASE_URL;

export async function fetchRecommendations({ mood, limit = 10 }) {
  const url = new URL(`${BASE}/recommendations`);
  url.searchParams.set("mood", mood);
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}
