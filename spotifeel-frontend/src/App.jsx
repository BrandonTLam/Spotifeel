import { useState } from "react";
import { fetchRecommendations } from "./api";

export default function App() {
  const [mood, setMood] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    setData(null);
    try {
      const json = await fetchRecommendations({ mood, limit: 10 });
      setData(json);
    } catch (e) {
      setErr(e?.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", padding: 16, fontFamily: "system-ui" }}>
      <h1>Spotifeel</h1>
      <p>Type a mood → get 10 tracks.</p>

      <form onSubmit={onSubmit} style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <input
          value={mood}
          onChange={(e) => setMood(e.target.value)}
          placeholder="chill, happy, sad, focus..."
          style={{ flex: 1, padding: 10, fontSize: 16 }}
        />
        <button type="submit" disabled={loading} style={{ padding: "10px 14px" }}>
          {loading ? "Loading..." : "Recommend"}
        </button>
      </form>

      {err && <div style={{ color: "crimson", marginBottom: 12 }}>{err}</div>}

      {data && (
        <>
          <div style={{ marginBottom: 10, opacity: 0.8 }}>
            Mood: <b>{data.mood}</b>
          </div>

          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
            {data.tracks.map((t) => (
              <li key={t.id} style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{t.name ?? t.id}</div>
                    <div style={{ fontSize: 13, opacity: 0.75 }}>
                      valence {t.audio_features?.valence?.toFixed?.(3)} · energy{" "}
                      {t.audio_features?.energy?.toFixed?.(3)} · dance{" "}
                      {t.audio_features?.danceability?.toFixed?.(3)} · tempo{" "}
                      {t.audio_features?.tempo?.toFixed?.(1)}
                    </div>
                  </div>

                  <button
                    onClick={() => window.open(t.spotify_url, "_blank", "noopener,noreferrer")}
                    style={{ padding: "8px 10px" }}
                  >
                    Open
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
