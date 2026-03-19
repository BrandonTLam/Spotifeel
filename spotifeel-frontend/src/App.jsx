import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchRecommendations,
  fetchSpotifyData,
  fetchSpotifyToken,
  spotifyLoginUrl,
  spotifyLogout,
} from "./api";
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

const TIME_HISTORY_KEY = "sf_time_history_by_bucket";
const TIME_HISTORY_DAYS = 14;
const TIME_RESULT_CACHE_KEY = "sf_time_result_cache";

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
  } catch {}
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

function laDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const map = Object.fromEntries(
    parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value])
  );

  return `${map.year}-${map.month}-${map.day}`;
}

function dateKeyToDayNumber(key) {
  const [y, m, d] = key.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

function currentLATimeBucket() {
  const hourPart = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    hour12: false,
  })
    .formatToParts(new Date())
    .find((p) => p.type === "hour")?.value;

  const hour = Number(hourPart || "0") % 24;

  if (0 <= hour && hour < 3) return "00_03";
  if (3 <= hour && hour < 6) return "03_06";
  if (6 <= hour && hour < 9) return "06_09";
  if (9 <= hour && hour < 12) return "09_12";
  if (12 <= hour && hour < 15) return "12_15";
  if (15 <= hour && hour < 18) return "15_18";
  if (18 <= hour && hour < 21) return "18_21";
  return "21_24";
}

function pruneTimeHistory(history) {
  const safe =
    history && typeof history === "object" && !Array.isArray(history) ? history : {};

  const today = laDateKey();
  const todayNum = dateKeyToDayNumber(today);
  const next = {};

  for (const [bucket, entries] of Object.entries(safe)) {
    if (!Array.isArray(entries)) continue;

    const kept = entries.filter((entry) => {
      if (!entry || typeof entry !== "object") return false;
      if (typeof entry.date !== "string" || !Array.isArray(entry.ids)) return false;

      const age = todayNum - dateKeyToDayNumber(entry.date);
      return age >= 0 && age < TIME_HISTORY_DAYS;
    });

    if (kept.length) next[bucket] = kept;
  }

  return next;
}

function readTimeHistory() {
  const pruned = pruneTimeHistory(readJson(TIME_HISTORY_KEY, {}));
  writeJson(TIME_HISTORY_KEY, pruned);
  return pruned;
}

function writeTimeHistory(history) {
  writeJson(TIME_HISTORY_KEY, pruneTimeHistory(history));
}

function getTimeExcludeIds(bucket, currentDate) {
  const history = readTimeHistory();
  const entries = Array.isArray(history[bucket]) ? history[bucket] : [];
  const seen = new Set();

  for (const entry of entries) {
    if (entry.date === currentDate) continue;
    for (const id of entry.ids || []) {
      if (typeof id === "string" && id) seen.add(id);
    }
  }

  return Array.from(seen);
}

function rememberTimeBucketTracks(bucket, date, trackIds) {
  const history = readTimeHistory();
  const ids = [...new Set((trackIds || []).filter((id) => typeof id === "string" && id))];
  const existing = Array.isArray(history[bucket]) ? history[bucket] : [];
  const withoutSameDate = existing.filter((entry) => entry?.date !== date);

  history[bucket] = [...withoutSameDate, { date, ids }];
  writeTimeHistory(history);
}

function readTimeResultCache() {
  const cache = readJson(TIME_RESULT_CACHE_KEY, {});
  return cache && typeof cache === "object" && !Array.isArray(cache) ? cache : {};
}

function getCachedTimeResult(bucket, date) {
  const cache = readTimeResultCache();
  const entry = cache[bucket];
  if (!entry || entry.date !== date) return null;
  return entry.data?.tracks?.length === 12 ? entry.data : null;
}

function writeCachedTimeResult(bucket, date, data) {
  const cache = readTimeResultCache();
  cache[bucket] = { date, data };
  writeJson(TIME_RESULT_CACHE_KEY, cache);
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
      { value: "spotify", label: "Spotify" },
    ],
    []
  );

  const idx = Math.max(0, items.findIndex((x) => x.value === value));

  return (
    <div className="segmented" style={{ "--segIndex": idx, "--segCount": items.length }}>
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

function CenterLoading({ text }) {
  return (
    <div
      style={{
        minHeight: "calc(100vh - 180px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          textAlign: "center",
        }}
      >
        <div>{text}</div>
        <div className="spinner"></div>
      </div>
    </div>
  );
}

function describeTrackFeatures(audio = {}) {
  const tags = [];

  if (typeof audio.energy === "number") {
    if (audio.energy >= 0.7) tags.push("high energy");
    else if (audio.energy <= 0.35) tags.push("calmer energy");
  }

  if (typeof audio.danceability === "number" && audio.danceability >= 0.7) {
    tags.push("danceable feel");
  }

  if (typeof audio.tempo === "number") {
    if (audio.tempo >= 125) tags.push("faster tempo");
    else if (audio.tempo <= 95) tags.push("slower tempo");
  }

  if (typeof audio.valence === "number") {
    if (audio.valence >= 0.65) tags.push("more upbeat mood");
    else if (audio.valence <= 0.35) tags.push("more mellow mood");
  }

  return tags.slice(0, 2);
}

function buildWhyText(t, explainContext = {}, compact = false) {
  const audio = t?.audio_features || {};
  const featureTags = describeTrackFeatures(audio);

  const mode = explainContext?.mode || "";
  const selectedMood = (explainContext?.selectedMood || "").toLowerCase();
  const apiMood = (explainContext?.apiMood || "").toLowerCase();
  const spotifyPersonalized = Boolean(explainContext?.context?.spotify_personalized);

  const shortTags = compact ? featureTags.slice(0, 1) : featureTags.slice(0, 2);
  const featureText = shortTags.length ? ` • ${shortTags.join(", ")}` : "";

  if (mode === "mood") {
    const moodLabel = selectedMood || apiMood || "your mood";
    if (compact) {
      return spotifyPersonalized
        ? `Matches ${moodLabel} + your Spotify taste${featureText}.`
        : `Matches ${moodLabel}${featureText}.`;
    }
    return spotifyPersonalized
      ? `Matches your ${moodLabel} mood and is similar to your Spotify preferences${featureText}.`
      : `Matches your ${moodLabel} mood${featureText}.`;
  }

  if (mode === "time") {
    const moodLabel = apiMood || "time-based vibe";
    if (compact) {
      return spotifyPersonalized
        ? `Fits ${moodLabel} + your Spotify style${featureText}.`
        : `Fits this time of day${featureText}.`;
    }
    return spotifyPersonalized
      ? `Fits your ${moodLabel} vibe and your Spotify listening style${featureText}.`
      : `Fits your current time of day${featureText}.`;
  }

  if (mode === "daily") {
    return spotifyPersonalized
      ? `Picked for variety while staying close to your Spotify taste profile${featureText}.`
      : `Picked for variety${featureText}.`;
  }

  if (spotifyPersonalized) {
    return `Similar to your Spotify preferences${featureText}.`;
  }

  return shortTags.length
    ? `Good match${featureText}.`
    : "Good match for your current recommendation settings.";
}

function TrackCard({
  t,
  deviceId,
  token,
  sdkPlayer,
  playbackState,
  spotifyConnected,
  externalTrackOverrideId,
  pendingPlayTrackKey,
  onRequiresPremium,
  onTrackUnavailable,
  onOpenExternalTrack,
  onResumeFromOverride,
  onBeginPlayRequest,
  onFinishPlayRequest,
  onFailPlayRequest,
  explainContext,
  isSpotify,
  compactCard,
}) {
  const trackUri = t.spotify_uri || t.uri;
  const trackKey = t.id || trackUri;
  const isForcedInactive = externalTrackOverrideId === trackKey;
  const isActive =
    !isForcedInactive &&
    (playbackState?.id === t.id || playbackState?.uri === trackUri);

  const isConnecting = pendingPlayTrackKey === trackKey && !isActive;
  const [localProgress, setLocalProgress] = useState(0);

  useEffect(() => {
    if (isActive) {
      setLocalProgress(playbackState.position);
    } else {
      setLocalProgress(0);
    }
  }, [isActive, playbackState?.position]);

  useEffect(() => {
    let interval;
    if (isActive && !playbackState?.isPaused) {
      interval = setInterval(() => {
        setLocalProgress((prev) => Math.min(prev + 1000, playbackState.duration));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isActive, playbackState?.isPaused, playbackState?.duration]);

  const formatTime = (ms) => {
    if (!ms || isNaN(ms)) return "0:00";
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = (totalSeconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const displayDuration =
    isActive && playbackState?.duration
      ? playbackState.duration
      : t.duration_ms || t.track?.duration_ms || t.item?.duration_ms || 0;

  const progressPercent = displayDuration > 0 ? (localProgress / displayDuration) * 100 : 0;
  const whyText = !isSpotify ? buildWhyText(t, explainContext, compactCard) : "";

  const handleCardClick = () => {
    onOpenExternalTrack?.({
      trackKey,
      trackId: t.id,
      trackUri,
      url: t.spotify_url || t.external_urls?.spotify,
    });
  };

  async function waitForLocalPlayer(player, tries = 10, delay = 250) {
    for (let i = 0; i < tries; i++) {
      const state = await player?.getCurrentState?.().catch(() => null);
      if (state) return true;
      await new Promise((r) => setTimeout(r, delay));
    }
    return false;
  }

  const handlePlayPause = async (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (!spotifyConnected) {
      onRequiresPremium();
      return;
    }

    if (!token) {
      onTrackUnavailable("Spotify token missing or expired. Please reconnect Spotify.");
      return;
    }

    if (!deviceId) {
      onTrackUnavailable("Spotify browser player is not ready yet. Please try again.");
      return;
    }

    if (isActive) {
      if (sdkPlayer) sdkPlayer.togglePlay();
      return;
    }

    onResumeFromOverride?.(trackKey);
    onBeginPlayRequest?.(trackKey);

    try {
      if (sdkPlayer?.activateElement) {
        await sdkPlayer.activateElement();
      }

      const transferRes = await fetch("https://api.spotify.com/v1/me/player", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          device_ids: [deviceId],
          play: false,
        }),
      });

      if (!transferRes.ok && transferRes.status !== 204) {
        const errorData = await transferRes.json().catch(() => ({}));
        onFailPlayRequest?.();

        if (errorData.error?.reason === "PREMIUM_REQUIRED" || transferRes.status === 401) {
          onRequiresPremium();
        } else {
          onTrackUnavailable(errorData.error?.message || "Unable to transfer playback");
        }
        return;
      }

      const ready = await waitForLocalPlayer(sdkPlayer);

      if (!ready) {
        onFailPlayRequest?.();
        onTrackUnavailable("Spotify browser player is not ready yet. Please try again.");
        return;
      }

      const playRes = await fetch(
        `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ uris: [trackUri] }),
        }
      );

      if (!playRes.ok) {
        const errorData = await playRes.json().catch(() => ({}));
        onFailPlayRequest?.();

        if (errorData.error?.reason === "PREMIUM_REQUIRED" || playRes.status === 401) {
          onRequiresPremium();
        } else {
          onTrackUnavailable(
            errorData.error?.message || "Spotify rejected playback for this browser player."
          );
        }
        return;
      }

      onFinishPlayRequest?.(trackKey);
    } catch (err) {
      console.error("Playback request failed", err);
      onFailPlayRequest?.();
      onTrackUnavailable("Playback request failed. Please try again.");
    }
  };

  const skip = (amountSec, e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isActive || !sdkPlayer || !playbackState) return;
    const newPos = Math.min(Math.max(localProgress + amountSec * 1000, 0), playbackState.duration);
    sdkPlayer.seek(newPos);
    setLocalProgress(newPos);
  };

  const handleSeek = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isActive || !sdkPlayer || !playbackState?.duration) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(1, clickX / rect.width));
    const newPos = Math.floor(percent * playbackState.duration);

    sdkPlayer.seek(newPos);
    setLocalProgress(newPos);
  };

  return (
    <li className="card" onClick={handleCardClick}>
      <div className={`cardText ${compactCard ? "cardText--compact" : ""}`}>
        <div
          className="trackTitle"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {t.name ?? t.id}
        </div>

        <div className="trackMeta">
          {t.audio_features ? (
            <>
              val {t.audio_features?.valence?.toFixed?.(2)} · en{" "}
              {t.audio_features?.energy?.toFixed?.(2)} · da{" "}
              {t.audio_features?.danceability?.toFixed?.(2)} · bpm{" "}
              {t.audio_features?.tempo?.toFixed?.(0)}
            </>
          ) : (
            <>
              {(t.artists || []).join(", ")}
              {t.album ? ` • ${t.album}` : ""}
            </>
          )}
        </div>

        {!isSpotify && (
          <div className="trackWhy">
            <strong>Why:</strong> {whyText}
          </div>
        )}
      </div>

      <div className="playerContainer" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
        <div className="progressRow">
          <span className="timeText">{formatTime(localProgress)}</span>
          <div className="progressBar" onClick={handleSeek} style={{ cursor: isActive ? "pointer" : "default" }}>
            <div className="progressFill" style={{ width: `${progressPercent}%` }}></div>
          </div>
          <span className="timeText">{formatTime(displayDuration)}</span>
        </div>

        <div className="controlsRow">
          <button className="ctrlBtn" onClick={(e) => skip(-5, e)} disabled={!isActive}>
            -5s
          </button>
          <button className="ctrlBtn playBtn" onClick={handlePlayPause}>
            {isConnecting ? (
              <div className="miniSpinner"></div>
            ) : isActive && !playbackState?.isPaused ? (
              "⏸"
            ) : (
              "▶"
            )}
          </button>
          <button className="ctrlBtn" onClick={(e) => skip(5, e)} disabled={!isActive}>
            +5s
          </button>
        </div>
      </div>
    </li>
  );
}

function TrackGrid({
  tracks,
  deviceId,
  token,
  sdkPlayer,
  playbackState,
  spotifyConnected,
  externalTrackOverrideId,
  pendingPlayTrackKey,
  onRequiresPremium,
  onTrackUnavailable,
  onOpenExternalTrack,
  onResumeFromOverride,
  onBeginPlayRequest,
  onFinishPlayRequest,
  onFailPlayRequest,
  isSpotify,
  explainContext,
  compactCard,
}) {
  return (
    <ul className={`grid ${isSpotify ? "spotifyGrid" : ""}`}>
      {tracks.map((t, idx) => (
        <TrackCard
          key={`${t.id || "track"}-${idx}`}
          t={t}
          deviceId={deviceId}
          token={token}
          sdkPlayer={sdkPlayer}
          playbackState={playbackState}
          spotifyConnected={spotifyConnected}
          externalTrackOverrideId={externalTrackOverrideId}
          pendingPlayTrackKey={pendingPlayTrackKey}
          onRequiresPremium={onRequiresPremium}
          onTrackUnavailable={onTrackUnavailable}
          onOpenExternalTrack={onOpenExternalTrack}
          onResumeFromOverride={onResumeFromOverride}
          onBeginPlayRequest={onBeginPlayRequest}
          onFinishPlayRequest={onFinishPlayRequest}
          onFailPlayRequest={onFailPlayRequest}
          explainContext={explainContext}
          isSpotify={isSpotify}
          compactCard={compactCard}
        />
      ))}
    </ul>
  );
}

function InfoModal({ open, title, onClose, children }) {
  if (!open) return null;

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modalContent" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <h3>{title}</h3>
          <button className="modalClose" onClick={onClose}>×</button>
        </div>
        <div className="modalBody">{children}</div>
        <div className="modalFooter">
          <button className="modalActionBtn" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
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

  const [mode, setMode] = useState(() => {
    const qMode = new URLSearchParams(window.location.search).get("tab");
    if (["daily", "mood", "time", "spotify"].includes(qMode)) return qMode;
    return "daily";
  });
  const [selectedMood, setSelectedMood] = useState("");

  const [err, setErr] = useState("");

  const [dailyData, setDailyData] = useState(() => readDailyCache());
  const [timeData, setTimeData] = useState(null);
  const [moodData, setMoodData] = useState(null);
  const [spotifyData, setSpotifyData] = useState({
    configured: false,
    connected: false,
    profile: null,
    top_tracks: [],
    liked_tracks: [],
    recently_played: [],
    warnings: [],
  });

  const [timeInfo, setTimeInfo] = useState(() => readTimeCache() ?? { mood: "", bucket: "", expires: 0 });

  const [dailyLoading, setDailyLoading] = useState(false);
  const [timeLoading, setTimeLoading] = useState(false);
  const [moodLoading, setMoodLoading] = useState(false);

  const [dailyRefreshBusy, setDailyRefreshBusy] = useState(false);
  const [moodRefreshBusy, setMoodRefreshBusy] = useState(false);
  const [spotifyRefreshBusy, setSpotifyRefreshBusy] = useState(false);
  const [spotifyLoading, setSpotifyLoading] = useState(false);

  const [moodSelectBusy, setMoodSelectBusy] = useState(false);
  const [timeSelectBusy, setTimeSelectBusy] = useState(false);

  const timerRef = useRef({ timeoutId: null, intervalId: null });
  const playTimeoutRef = useRef(null);
  const playRequestActiveRef = useRef(false);
  const dailySeenRef = useRef(readDailySeen());
  const externalTrackOverrideRef = useRef(null);

  const [spotifyToken, setSpotifyToken] = useState(null);
  const [deviceId, setDeviceId] = useState(null);
  const [sdkPlayer, setSdkPlayer] = useState(null);
  const [playbackState, setPlaybackState] = useState(null);
  const [externalTrackOverrideId, setExternalTrackOverrideId] = useState(null);
  const [pendingPlayTrackKey, setPendingPlayTrackKey] = useState(null);

  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [trackUnavailableMessage, setTrackUnavailableMessage] = useState("");

  useEffect(() => {
    externalTrackOverrideRef.current = externalTrackOverrideId;
  }, [externalTrackOverrideId]);

  function clearTimers() {
    const t = timerRef.current;
    if (t.timeoutId) clearTimeout(t.timeoutId);
    if (t.intervalId) clearInterval(t.intervalId);
    timerRef.current = { timeoutId: null, intervalId: null };
  }

  function clearPendingPlay() {
    if (playTimeoutRef.current) clearTimeout(playTimeoutRef.current);
    playTimeoutRef.current = null;
    playRequestActiveRef.current = false;
    setPendingPlayTrackKey(null);
  }

  function beginPendingPlay(trackKey) {
    clearPendingPlay();
    playRequestActiveRef.current = true;
    setPendingPlayTrackKey(trackKey);
    playTimeoutRef.current = setTimeout(() => {
      playRequestActiveRef.current = false;
      setPendingPlayTrackKey(null);
    }, 5000);
  }

  function pickExternalSpotifyDevice(devices, currentDeviceId) {
    if (!Array.isArray(devices)) return null;

    const others = devices.filter(
      (d) => d?.id && d.id !== currentDeviceId && !d.is_restricted
    );

    if (!others.length) return null;

    return (
      others.find((d) => d.is_active) ||
      others.find((d) => d.type === "Smartphone") ||
      others.find((d) => d.type === "Computer") ||
      others[0]
    );
  }

  function syncPlaybackState(state) {
    if (!state) {
      setPlaybackState(null);
      clearPendingPlay();
      return;
    }

    const currentTrack = state.track_window.current_track;
    const trackId = currentTrack?.linked_from?.id || currentTrack?.id;
    const trackUri = currentTrack?.linked_from?.uri || currentTrack?.uri;
    const trackKey = trackId || trackUri;

    if (!state.paused) {
      clearPendingPlay();
      setExternalTrackOverrideId(null);
    } else if (
      externalTrackOverrideRef.current &&
      externalTrackOverrideRef.current !== trackKey
    ) {
      setExternalTrackOverrideId(null);
    }

    setPlaybackState({
      id: trackId,
      uri: trackUri,
      isPaused: state.paused,
      position: state.position ?? 0,
      duration: state.duration ?? 0,
    });
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
      const bucket = currentLATimeBucket();
      const date = laDateKey();

      const cachedResult = getCachedTimeResult(bucket, date);
      if (cachedResult) {
        setTimeData(cachedResult);

        const mood = (cachedResult?.mood || "").toString();
        const cacheBucket = (cachedResult?.context?.time_bucket || bucket || "").toString();
        const expires = Date.now() + msUntilNext3HourBlock();
        const info = { mood, bucket: cacheBucket, expires };

        setTimeInfo(info);
        writeTimeCache(info);
        return;
      }

      const excludeIds = getTimeExcludeIds(bucket, date);

      const json = await fetchRecommendations({
        mode: "time",
        limit: 12,
        excludeIds,
      });

      setTimeData(json);

      if (json?.context?.mode_used === "time") {
        const mood = (json?.mood || "").toString();
        const actualBucket = (json?.context?.time_bucket || bucket || "").toString();
        const expires = Date.now() + msUntilNext3HourBlock();
        const info = { mood, bucket: actualBucket, expires };

        setTimeInfo(info);
        writeTimeCache(info);

        const returnedIds = (json?.tracks || []).map((t) => t.id).filter(Boolean);
        rememberTimeBucketTracks(actualBucket, date, returnedIds);
        writeCachedTimeResult(actualBucket, date, json);
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

  async function getFreshSpotifyToken() {
    const fresh = await fetchSpotifyToken();
    setSpotifyToken(fresh);
    return fresh;
  }

  async function getValidSpotifyToken() {
    try {
      const fresh = await fetchSpotifyToken();
      setSpotifyToken(fresh);
      return fresh;
    } catch {
      return spotifyToken;
    }
  }

  async function loadSpotify() {
    setErr("");
    setSpotifyLoading(true);
    try {
      const json = await fetchSpotifyData();
      setSpotifyData(json);
    } catch (e) {
      setErr(e?.message || "Something went wrong");
    } finally {
      setSpotifyLoading(false);
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
    return () => {
      clearTimers();
      clearPendingPlay();
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const qMode = params.get("tab");
    const spotifyFlag = params.get("spotify");

    if (qMode === "spotify") {
      setMode("spotify");
      loadSpotify();
    }

    if (["error", "token_error", "state_mismatch"].includes(spotifyFlag)) {
      setErr("Spotify authentication failed. Please try connecting again.");
    }

    if (qMode || spotifyFlag) {
      params.delete("tab");
      params.delete("spotify");
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
      window.history.replaceState({}, "", next);
    }
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
      if (!hasTracks || !cacheFresh) {
        setTimeSelectBusy(true);
        loadTime().finally(() => setTimeSelectBusy(false));
      }

      timerRef.current.timeoutId = setTimeout(() => {
        loadTime();
        timerRef.current.intervalId = setInterval(loadTime, 3 * 60 * 60 * 1000);
      }, msUntilNext3HourBlock());

      return;
    }

    if (mode === "spotify") {
      if (!spotifyData.connected && !spotifyLoading) loadSpotify();
      return;
    }
  }, [mode, timeData, dailyData]);

  useEffect(() => {
    if (!selectedMood) return;
    setMoodSelectBusy(true);
    loadMood({ mood: selectedMood }).finally(() => setMoodSelectBusy(false));
  }, [selectedMood]);

  useEffect(() => {
    clearPendingPlay();
    setTrackUnavailableMessage("");
    if (sdkPlayer) {
      sdkPlayer.pause().catch(() => {});
    }
  }, [mode, sdkPlayer]);

  useEffect(() => {
    let player;

    async function setupPlayer() {
      try {
        const initialToken = await getFreshSpotifyToken();

        const script = document.createElement("script");
        script.src = "https://sdk.scdn.co/spotify-player.js";
        script.async = true;
        document.body.appendChild(script);

        window.onSpotifyWebPlaybackSDKReady = () => {
          player = new window.Spotify.Player({
            name: "Spotifeel Web Player",
            getOAuthToken: async (cb) => {
              try {
                const fresh = await getFreshSpotifyToken();
                cb(fresh);
              } catch {
                cb(initialToken);
              }
            },
            volume: 0.5,
          });

          player.addListener("ready", ({ device_id }) => {
            console.log("Ready with Device ID", device_id);
            setDeviceId(device_id);
          });

          player.addListener("not_ready", ({ device_id }) => {
            console.log("Device ID has gone offline", device_id);
            setDeviceId(null);
          });

          player.addListener("player_state_changed", (state) => {
            syncPlaybackState(state);
          });

          player.addListener("playback_error", ({ message }) => {
            console.error("SDK playback_error:", message);
            if (playRequestActiveRef.current) {
              clearPendingPlay();
              setTrackUnavailableMessage(`Spotify playback error: ${message}`);
            }
          });

          player.addListener("authentication_error", ({ message }) => {
            console.error("SDK authentication_error:", message);
            if (playRequestActiveRef.current) {
              clearPendingPlay();
              setErr(`Spotify auth error: ${message}`);
            }
          });

          player.addListener("account_error", ({ message }) => {
            console.error("SDK account_error:", message);
            if (playRequestActiveRef.current) {
              clearPendingPlay();
              setShowPremiumModal(true);
            }
          });

          player.connect().then((success) => {
            if (success) setSdkPlayer(player);
          });
        };
      } catch (err) {
        console.log("Spotify player waiting for user to log in.");
      }
    }

    setupPlayer();

    return () => {
      if (player) player.disconnect();
    };
  }, []);

  const activeData = mode === "daily" ? dailyData : mode === "time" ? timeData : moodData;
  const showMoodRefresh = mode === "mood" && Boolean(moodData?.tracks?.length);
  const showSpotifyRefresh = mode === "spotify" && spotifyData.connected;
  const timeMoodLabel = mode === "time" && timeInfo?.mood ? String(timeInfo.mood).toUpperCase() : "…";
  const spotifyProfile = spotifyData?.profile;
  const spotifyWarnings = Array.isArray(spotifyData?.warnings) ? spotifyData.warnings : [];

  const hasBar = mode === "mood" || mode === "time";

  const isBusy =
    (mode === "daily" && dailyRefreshBusy) ||
    (mode === "mood" && (moodSelectBusy || moodRefreshBusy)) ||
    (mode === "time" && timeSelectBusy) ||
    (mode === "spotify" && spotifyRefreshBusy);

  const handleOpenExternalTrack = async ({ trackKey, trackUri, url }) => {
    clearPendingPlay();
    setTrackUnavailableMessage("");
    setExternalTrackOverrideId(trackKey);

    const popup = window.open(url, "_blank", "noopener,noreferrer");

    try {
      const activeToken = await getValidSpotifyToken();

      if (!activeToken) {
        if (sdkPlayer) await sdkPlayer.pause().catch(() => {});
        setPlaybackState(null);
        return;
      }

      if (sdkPlayer) {
        await sdkPlayer.pause().catch(() => {});
      }

      await new Promise((resolve) => setTimeout(resolve, 500));

      const devicesRes = await fetch("https://api.spotify.com/v1/me/player/devices", {
        headers: {
          Authorization: `Bearer ${activeToken}`,
        },
      });

      const devicesJson = await devicesRes.json().catch(() => ({}));
      const targetDevice = pickExternalSpotifyDevice(devicesJson?.devices, deviceId);

      if (targetDevice?.id) {
        const transferRes = await fetch("https://api.spotify.com/v1/me/player", {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${activeToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            device_ids: [targetDevice.id],
            play: true,
          }),
        });

        if (transferRes.ok || transferRes.status === 204) {
          await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${targetDevice.id}`, {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${activeToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              uris: [trackUri],
            }),
          }).catch(() => {});
        }
      }

      setPlaybackState(null);
    } catch (err) {
      console.error("Failed to hand off playback to Spotify app", err);
      setPlaybackState(null);
    }

    if (!popup) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const handleResumeFromOverride = (trackKey) => {
    if (externalTrackOverrideId === trackKey) {
      setExternalTrackOverrideId(null);
    }
  };

  const handlePlayAccepted = (trackKey) => {
    clearPendingPlay();
    if (externalTrackOverrideId === trackKey) {
      setExternalTrackOverrideId(null);
    }
  };

  function renderSpotifyTracks(title, tracks) {
    if (!tracks?.length) return null;

    return (
      <section className="spotifySection">
        <h3 className="spotifySectionTitle">{title}</h3>
        <TrackGrid
          tracks={tracks}
          deviceId={deviceId}
          token={spotifyToken}
          sdkPlayer={sdkPlayer}
          playbackState={playbackState}
          spotifyConnected={spotifyData.connected}
          externalTrackOverrideId={externalTrackOverrideId}
          pendingPlayTrackKey={pendingPlayTrackKey}
          onRequiresPremium={() => setShowPremiumModal(true)}
          onTrackUnavailable={(msg) => setTrackUnavailableMessage(msg)}
          onOpenExternalTrack={handleOpenExternalTrack}
          onResumeFromOverride={handleResumeFromOverride}
          onBeginPlayRequest={beginPendingPlay}
          onFinishPlayRequest={handlePlayAccepted}
          onFailPlayRequest={clearPendingPlay}
          isSpotify={true}
          compactCard={false}
        />
      </section>
    );
  }

  return (
    <div className={`sfRoot ${hasBar ? "sfRoot--bar" : "sfRoot--noBar"}`}>
      <div className="sfHeader">
        <SpotifeelTitle />
        <div />
      </div>

      <div className="sfControls">
        <ModeSegmented value={mode} onChange={setMode} />
        {mode === "daily" || showMoodRefresh || showSpotifyRefresh ? (
          <button
            className="refreshBtn"
            disabled={
              (mode === "daily" && dailyLoading) ||
              (mode === "mood" && (moodLoading || moodSelectBusy)) ||
              (mode === "spotify" && (spotifyLoading || spotifyRefreshBusy))
            }
            onClick={async () => {
              setTrackUnavailableMessage("");
              clearPendingPlay();

              if (sdkPlayer) sdkPlayer.pause().catch(() => {});

              if (mode === "daily") {
                setDailyRefreshBusy(true);
                await loadDaily({ excludeIds: dailySeenRef.current || [] });
                setDailyRefreshBusy(false);
                return;
              }
              if (mode === "spotify") {
                setSpotifyRefreshBusy(true);
                await loadSpotify();
                setSpotifyRefreshBusy(false);
                return;
              }
              setMoodRefreshBusy(true);
              const ids = moodData?.tracks?.map((t) => t.id) ?? [];
              await loadMood({ mood: selectedMood, excludeIds: ids });
              setMoodRefreshBusy(false);
            }}
          >
            {mode === "daily"
              ? dailyRefreshBusy
                ? "Refreshing..."
                : "Refresh"
              : mode === "spotify"
              ? spotifyRefreshBusy
                ? "Refreshing..."
                : "Refresh Spotify"
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
            >
              <option value="" disabled>Select a mood…</option>
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

      {mode === "spotify" ? (
        <div className="spotifyPanel">
          {spotifyLoading ? (
            <CenterLoading text="Loading Spotify data..." />
          ) : !spotifyData.configured ? (
            <div className="spotifyMessage">Spotify auth is not configured in backend `.env` yet.</div>
          ) : !spotifyData.connected ? (
            <div className="spotifyMessage">
              <div>Connect Spotify to load your top songs, liked songs, and recently played tracks.</div>
              <button className="spotifyActionBtn" onClick={() => window.location.assign(spotifyLoginUrl())}>
                Connect Spotify
              </button>
            </div>
          ) : (
            <div className="spotifyInfo">
              <div className="spotifyRow">
                <span className="spotifyLabel">Logged In As</span>
                <span className="spotifyValue">{spotifyProfile?.display_name || spotifyProfile?.id || "Spotify user"}</span>
              </div>
              {renderSpotifyTracks("Top Tracks", spotifyData.top_tracks)}
              {renderSpotifyTracks("Liked Songs", spotifyData.liked_tracks)}
              {renderSpotifyTracks("Recently Played", spotifyData.recently_played)}
              {spotifyWarnings.length ? (
                <div className="spotifyWarnings">
                  {spotifyWarnings.map((w, i) => (
                    <div key={`${w}-${i}`}>Note: {w}</div>
                  ))}
                </div>
              ) : null}
              <div className="spotifyActions">
                <button
                  className="spotifyActionBtn spotifyActionBtn--secondary"
                  onClick={async () => {
                    clearPendingPlay();

                    if (sdkPlayer) {
                      await sdkPlayer.pause().catch(() => {});
                      sdkPlayer.disconnect();
                    }

                    await spotifyLogout();
                    setSpotifyToken(null);
                    setDeviceId(null);
                    setSdkPlayer(null);
                    setPlaybackState(null);
                    setExternalTrackOverrideId(null);
                    setTrackUnavailableMessage("");
                    setSpotifyData({
                      configured: true,
                      connected: false,
                      profile: null,
                      top_tracks: [],
                      liked_tracks: [],
                      recently_played: [],
                      warnings: [],
                    });
                  }}
                >
                  Disconnect
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="gridWrap">
          {isBusy ? (
            <CenterLoading text="Finding new tracks..." />
          ) : activeData?.tracks?.length ? (
            <TrackGrid
              tracks={activeData.tracks}
              deviceId={deviceId}
              token={spotifyToken}
              sdkPlayer={sdkPlayer}
              playbackState={playbackState}
              spotifyConnected={spotifyData.connected}
              externalTrackOverrideId={externalTrackOverrideId}
              pendingPlayTrackKey={pendingPlayTrackKey}
              onRequiresPremium={() => setShowPremiumModal(true)}
              onTrackUnavailable={(msg) => setTrackUnavailableMessage(msg)}
              onOpenExternalTrack={handleOpenExternalTrack}
              onResumeFromOverride={handleResumeFromOverride}
              onBeginPlayRequest={beginPendingPlay}
              onFinishPlayRequest={handlePlayAccepted}
              onFailPlayRequest={clearPendingPlay}
              isSpotify={false}
              compactCard={mode === "mood" || mode === "time"}
              explainContext={{
                mode,
                selectedMood,
                apiMood: activeData?.mood,
                context: activeData?.context,
              }}
            />
          ) : (
            <div />
          )}
        </div>
      )}

      <InfoModal
        open={showPremiumModal}
        title="Spotify Premium Required"
        onClose={() => setShowPremiumModal(false)}
      >
        <p>
          Spotify requires an active <strong>Premium</strong> account to stream full songs directly
          inside other apps.
        </p>
        <p>
          To listen to this track, you can log in with a Premium account <strong>(Go to the Spotify tab)</strong>,
          or simply <strong>click anywhere on the track card</strong> to open it directly in the Spotify app!
        </p>
      </InfoModal>

      <InfoModal
        open={Boolean(trackUnavailableMessage)}
        title="Playback Error"
        onClose={() => setTrackUnavailableMessage("")}
      >
        <p>Spotify could not start playback in the browser player.</p>
        <p>
          This can happen if the SDK device is not ready yet, or if Spotify restricts playback for
          that track/device context.
        </p>
        <p><strong>Error:</strong> {trackUnavailableMessage}</p>
      </InfoModal>
    </div>
  );
}