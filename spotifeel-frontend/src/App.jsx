import { useEffect, useMemo, useRef, useState } from "react";
import { fetchRecommendations } from "./api";
import "./App.css";

const LETTERS = [
  ["S", "#ff4d6d"],
  ["p", "#ffd166"],
  ["o", "#06d6a0"],
  ["t", "#4cc9f0"],
  ["i", "#a29bfe"],
  ["f", "#f72585"],
  ["e", "#ffd166"],
  ["e", "#06d6a0"],
  ["l", "#4cc9f0"],
];

const DAILY_SEEN_KEY = "sf_daily_seen_ids";
const DAILY_SEEN_MAX = 60; 

function msUntilNext3HourBlock() {
  const now = new Date();
  const h = now.getHours();
  const nextH = h - (h % 3) + 3;
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  if (nextH >= 24) {
    next.setDate(next.getDate() + 1);
    next.setHours(0);
  } else {
    next.setHours(nextH);
  }
  return next.getTime() - now.getTime();
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
  }
}

function readDailyCache() {
  const d = readJson("sf_daily_data", null);
  return d?.tracks?.length === 12 ? d : null;
}
function writeDailyCache(d) {
  writeJson("sf_daily_data", d);
}

function readDailySeen() {
  const arr = readJson(DAILY_SEEN_KEY, []);
  return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
}
function writeDailySeen(ids) {
  writeJson(DAILY_SEEN_KEY, ids);
}

function mergeDailySeen(oldIds, newIds) {
  const all = [...(oldIds || []), ...(newIds || [])];
  const seen = new Set();
  const outRev = [];
  for (let i = all.length - 1; i >= 0; i--) {
    const id = all[i];
    if (!id || typeof id !== "string") continue;
    if (seen.has(id)) continue;
    seen.add(id);
    outRev.push(id);
    if (outRev.length >= DAILY_SEEN_MAX) break;
  }
  return outRev.reverse();
}

function readTimeCache() {
  const expires = Number(localStorage.getItem("sf_time_expires") || "0");
  if (!expires) return null;
  const mood = localStorage.getItem("sf_time_mood") || "";
  const bucket = localStorage.getItem("sf_time_bucket") || "";
  if (!mood) return null;
  return { mood, bucket, expires };
}
function writeTimeCache({ mood, bucket, expires }) {
  try {
    localStorage.setItem("sf_time_mood", mood);
    localStorage.setItem("sf_time_bucket", bucket || "");
    localStorage.setItem("sf_time_expires", String(expires));
  } catch {
    // ignore
  }
}

function SpotifeelTitle() {
  return (
    <div className="sfTitle">
      {LETTERS.map(([ch, c], i) => (
        <div key={i} className="sfLetter" style={{ background: c }}>
          {ch}
        </div>
      ))}
    </div>
  );
}

function ModeSegmented({ value, onChange }) {
  const items = useMemo(
    () => [
      { value: "daily", label: "Daily Mix" },
      { value: "mood", label: "Mood" },
      { value: "time", label: "Time-Based" },
    ],
    []
  );

  const idx = Math.max(0, items.findIndex((x) => x.value === value));

  return (
    <div className="segmented" style={{ "--segIndex": idx }}>
      <div className="segPill" />
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          className={`segBtn ${value === it.value ? "active" : ""}`}
          onClick={() => onChange(it.value)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

function TrackGrid({ tracks }) {
  return (
    <ul className="grid">
      {tracks.map((t) => (
        <li key={t.id} className="card">
          <div className="trackTitle">{t.name ?? t.id}</div>
          <div className="trackMeta">
            val {t.audio_features?.valence?.toFixed?.(2)} · en {t.audio_features?.energy?.toFixed?.(2)}
            <br />
            da {t.audio_features?.danceability?.toFixed?.(2)} · bpm {t.audio_features?.tempo?.toFixed?.(0)}
          </div>
          <div className="cardFooter">
            <button
              className="openBtn"
              onClick={() => window.open(t.spotify_url, "_blank", "noopener,noreferrer")}
            >
              Open
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function App() {
  const MOODS = useMemo(
    () => [
      "excited",
      "happy",
      "sad",
      "chill",
      "mellow",
      "romance",
      "groovy",
      "hype",
      "party",
      "workout",
      "focus",
      "anxious",
      "angry",
      "confident",
      "sleep",
    ],
    []
  );

  const [mode, setMode] = useState("daily");
  const [selectedMood, setSelectedMood] = useState("");

  const [err, setErr] = useState("");

  const [dailyData, setDailyData] = useState(() => readDailyCache());
  const [timeData, setTimeData] = useState(null);
  const [moodData, setMoodData] = useState(null);

  const [timeInfo, setTimeInfo] = useState(() => readTimeCache() ?? { mood: "", bucket: "", expires: 0 });

  const [dailyLoading, setDailyLoading] = useState(false);
  const [timeLoading, setTimeLoading] = useState(false);
  const [moodLoading, setMoodLoading] = useState(false);

  const [dailyRefreshBusy, setDailyRefreshBusy] = useState(false);
  const [moodRefreshBusy, setMoodRefreshBusy] = useState(false);

  const [moodSelectBusy, setMoodSelectBusy] = useState(false);
  const [timeSelectBusy, setTimeSelectBusy] = useState(false);

  const timerRef = useRef({ timeoutId: null, intervalId: null });
  const dailySeenRef = useRef(readDailySeen());

  function clearTimers() {
    const t = timerRef.current;
    if (t.timeoutId) clearTimeout(t.timeoutId);
    if (t.intervalId) clearInterval(t.intervalId);
    timerRef.current = { timeoutId: null, intervalId: null };
  }

  async function loadDaily({ excludeIds = [] } = {}) {
    setErr("");
    setDailyLoading(true);
    try {
      const json = await fetchRecommendations({ mode: "random", limit: 12, excludeIds });
      setDailyData(json);
      writeDailyCache(json);

      const newIds = (json?.tracks || []).map((t) => t.id).filter(Boolean);
      const merged = mergeDailySeen(dailySeenRef.current, newIds);
      dailySeenRef.current = merged;
      writeDailySeen(merged);
    } catch (e) {
      setErr(e?.message || "Something went wrong");
    } finally {
      setDailyLoading(false);
    }
  }

  async function loadTime() {
    setErr("");
    setTimeLoading(true);
    try {
      const json = await fetchRecommendations({ mode: "time", limit: 12 });
      setTimeData(json);

      if (json?.context?.mode_used === "time") {
        const mood = (json?.mood || "").toString();
        const bucket = (json?.context?.time_bucket || "").toString();
        const expires = Date.now() + msUntilNext3HourBlock();
        const info = { mood, bucket, expires };
        setTimeInfo(info);
        writeTimeCache(info);
      }
    } catch (e) {
      setErr(e?.message || "Something went wrong");
    } finally {
      setTimeLoading(false);
    }
  }

  async function loadMood({ mood, excludeIds = [] } = {}) {
    if (!mood) return;
    setErr("");
    setMoodLoading(true);
    try {
      const json = await fetchRecommendations({ mode: "mood", mood, limit: 12, excludeIds });
      setMoodData(json);
    } catch (e) {
      setErr(e?.message || "Something went wrong");
    } finally {
      setMoodLoading(false);
    }
  }

  useEffect(() => {
    const cached = dailyData;
    if (cached?.tracks?.length === 12) {
      const cachedIds = cached.tracks.map((t) => t.id).filter(Boolean);
      const merged = mergeDailySeen(dailySeenRef.current, cachedIds);
      dailySeenRef.current = merged;
      writeDailySeen(merged);
    } else {
      loadDaily();
    }
    return () => clearTimers();
  }, []);

  useEffect(() => {
    clearTimers();
    setErr("");

    if (mode === "daily") {
      if (!dailyData?.tracks?.length) loadDaily();
      return;
    }

    if (mode === "time") {
      const cached = readTimeCache();
      if (cached) setTimeInfo(cached);

      const hasTracks = Boolean(timeData?.tracks?.length);
      const cacheFresh = Boolean(cached?.expires && Date.now() < cached.expires);
      const shouldFetch = !hasTracks || !cacheFresh;

      let cancelled = false;

      if (shouldFetch) {
        (async () => {
          setTimeSelectBusy(true);
          await loadTime();
          if (!cancelled) setTimeSelectBusy(false);
        })();
      } else {
        setTimeSelectBusy(false);
      }

      const first = setTimeout(() => {
        loadTime();
        const interval = setInterval(loadTime, 3 * 60 * 60 * 1000);
        timerRef.current.intervalId = interval;
      }, msUntilNext3HourBlock());

      timerRef.current.timeoutId = first;

      return () => {
        cancelled = true;
      };
    }
  }, [mode, timeData, dailyData]);

  useEffect(() => {
    if (!selectedMood) return;
    let cancelled = false;

    (async () => {
      setMoodSelectBusy(true);
      await loadMood({ mood: selectedMood, excludeIds: [] });
      if (!cancelled) setMoodSelectBusy(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedMood]);

  const activeData = mode === "daily" ? dailyData : mode === "time" ? timeData : moodData;
  const showMoodRefresh = mode === "mood" && Boolean(moodData?.tracks?.length);
  const timeMoodLabel = mode === "time" && timeInfo?.mood ? String(timeInfo.mood).toUpperCase() : "…";

  const hasBar = mode === "mood" || mode === "time";

  return (
    <div className={`sfRoot ${hasBar ? "sfRoot--bar" : "sfRoot--noBar"}`}>
      <div className="sfHeader">
        <SpotifeelTitle />
        <div />
      </div>

      <div className="sfControls">
        <ModeSegmented value={mode} onChange={setMode} />

        {(mode === "daily" || showMoodRefresh) ? (
          <button
            className="refreshBtn"
            disabled={
              (mode === "daily" && dailyLoading) ||
              (mode === "mood" && (moodLoading || moodSelectBusy))
            }
            onClick={async () => {
              if (mode === "daily") {
                setDailyRefreshBusy(true);
                try {
                  await loadDaily({ excludeIds: dailySeenRef.current || [] });
                } finally {
                  setDailyRefreshBusy(false);
                }
                return;
              }

              setMoodRefreshBusy(true);
              try {
                const ids = moodData?.tracks?.map((t) => t.id) ?? [];
                await loadMood({ mood: selectedMood, excludeIds: ids });
              } finally {
                setMoodRefreshBusy(false);
              }
            }}
          >
            {mode === "daily"
              ? dailyRefreshBusy
                ? "Refreshing..."
                : "Refresh"
              : moodRefreshBusy
              ? "Refreshing..."
              : "Refresh"}
          </button>
        ) : (
          <div className="spacerBtn" />
        )}
      </div>

      {mode === "mood" && (
        <div className="sfBarRow">
          {moodSelectBusy ? (
            <div className="bar">Loading…</div>
          ) : (
            <select
              className="select"
              value={selectedMood}
              onChange={(e) => setSelectedMood(e.target.value)}
              disabled={moodLoading || moodRefreshBusy}
              style={{ "--arrowOffset": "15px" }}
            >
              <option value="" disabled>
                Select a mood…
              </option>
              {MOODS.map((m) => (
                <option key={m} value={m}>
                  {m.toUpperCase()}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {mode === "time" && (
        <div className="sfBarRow">
          {timeSelectBusy ? (
            <div className="bar">Loading…</div>
          ) : (
            <div className="timeBar">
              <span className="timeLabel">Time-Based mood:</span>
              <span className="timeChip">{timeMoodLabel}</span>
              <span className="timeNote">updates every 3 hours</span>
            </div>
          )}
        </div>
      )}

      {err && <div className="error">{err}</div>}

      <div className="gridWrap">{activeData?.tracks?.length ? <TrackGrid tracks={activeData.tracks} /> : <div />}</div>
    </div>
  );
}