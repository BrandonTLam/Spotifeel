# Spotifeel

A personalized, contextual music recommendation system that recommends Spotify tracks using mood, time of day, and Spotify listening history.

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Setup Instructions](#setup-instructions)
- [Database Schema](#database-schema)
- [API Endpoints](#api-endpoints)
- [Mood Presets](#mood-presets)
- [Time-Based Recommendations](#time-based-recommendations)
- [Recommendation Algorithm](#recommendation-algorithm)
- [Project Structure](#project-structure)
- [How To Run The Backend and Frontend](#how-to-run-the-backend-and-frontend)
- [Spotify OAuth Setup](#spotify-oauth-setup)
- [How to Use Spotifeel](#how-to-use-spotifeel)

## Features

- **Dynamic Recommendation Engine**: Generates custom tracklists on the fly by evaluating complex emotional profiles, temporal context (time of day), and popularity-biased randomization to ensure fresh discovery.
- **Smart Audio Matching**: Leverages Spotify's precise audio data (valence, energy, danceability, tempo) to algorithmically score, filter, and sort tracks to match exact criteria.
- **Seamless Spotify Integration**: Utilizes full OAuth 2.0 authentication to securely connect accounts, pulling in user-specific data like Top Tracks, Liked Songs, and Recently Played history.
- **In-App Premium Playback**: Allows Spotify Premium users to stream, skip, and seek through tracks directly from the web interface without needing to open a separate client.

## Tech Stack

### Backend
- **FastAPI**: High-performance async Python web framework
- **SQLAlchemy 2.0**: Async ORM with PostgreSQL
- **Pydantic**: Data validation and settings management
- **PostgreSQL**: Database for storing track audio features

### Frontend
- **React 18**: Modern UI with hooks
- **Vite**: Fast build tool and dev server
- **CSS**: Custom styling with gradients and animations

## Setup Instructions

For detailed setup instructions, please refer to the [Setup Guide](https://docs.google.com/document/d/156vSsXDk3CxLJq8O6AjCyjVh2XreOKUWg-J0xWi5Q2s/edit?usp=sharing).

**Quick Overview**:
- Python 3.11+ and PostgreSQL 14+ required for backend
- Node.js 25+ required for frontend
- Environment variables needed for both backend and frontend
- Track data must be loaded into the database

## Database Schema

### TrackFeature Model

| Column | Type | Description |
|--------|------|-------------|
| track_id | String(32) | Spotify track ID (Primary Key) |
| name | String(512) | Track name |
| popularity | Integer | Spotify popularity score (0-100) |
| duration_ms | Integer | Track duration in milliseconds |
| tempo | Float | Beats per minute |
| time_signature | Integer | Time signature |
| key | Integer | Musical key (0-11) |
| mode | Integer | Major (1) or minor (0) |
| danceability | Float | How suitable for dancing (0.0-1.0) |
| energy | Float | Intensity and activity level (0.0-1.0) |
| loudness | Float | Average loudness in decibels |
| speechiness | Float | Presence of spoken words (0.0-1.0) |
| acousticness | Float | Acoustic vs electric (0.0-1.0) |
| instrumentalness | Float | Predicts vocal content (0.0-1.0) |
| liveness | Float | Presence of audience (0.0-1.0) |
| valence | Float | Musical positiveness (0.0-1.0) |
| null_response | Boolean | Flag for invalid data |

## API Endpoints

### GET `/recommendations`
Get track recommendations based on mood, time, or random selection

**Query Parameters**:
- `mood` (optional): Mood name (excited, happy, sad, chill, etc.)
- `mode` (default: "mood"): One of "mood", "time", or "random"
- `limit` (default: 12): Number of tracks to return (fixed at 12)
- `market` (default: "US"): Market code
- `only_ids` (optional): List of track IDs to filter by
- `exclude_ids` (optional): List of track IDs to exclude

**Response**:
```json
{
  "mood": "happy",
  "context": {
    "mode_used": "mood",
    "market": "US",
    "target": {
      "valence": 0.80,
      "energy": 0.65,
      "dance": 0.65,
      "tempo": 118
    }
  },
  "tracks": [
    {
      "id": "track_id",
      "name": "Track Name",
      "popularity": 75,
      "spotify_uri": "spotify:track:track_id",
      "spotify_url": "https://open.spotify.com/track/track_id",
      "audio_features": {
        "valence": 0.78,
        "energy": 0.62,
        "danceability": 0.68,
        "tempo": 120
      },
      "score": 0.85
    }
  ]
}
```

### Spotify Auth Endpoints
- `GET /spotify/auth/login`: Starts Spotify OAuth flow (redirects to Spotify login/consent).
- `GET /spotify/auth/callback`: OAuth callback. Exchanges code for token, fetches profile, stores session on disk, and redirects to frontend `?tab=spotify`.
- `GET /spotify/status`: Returns whether Spotify auth is configured and whether a user is connected.
- `GET /spotify/me`: Returns the connected user profile (refreshes token if needed).
- `POST /spotify/logout`: Clears stored Spotify session.

Stored session location defaults to:
- `spotifeel-backend/data/spotify_session.json`

## Mood Presets

| Mood | Valence | Energy | Danceability | Tempo |
|------|---------|--------|--------------|-------|
| excited | 0.86 | 0.88 | 0.70 | 140 |
| happy | 0.80 | 0.65 | 0.65 | 118 |
| sad | 0.15 | 0.28 | 0.30 | 85 |
| chill | 0.55 | 0.40 | 0.60 | 102 |
| mellow | 0.50 | 0.30 | 0.40 | 90 |
| sleep | 0.40 | 0.12 | 0.12 | 65 |
| romance | 0.70 | 0.45 | 0.55 | 100 |
| groovy | 0.70 | 0.60 | 0.82 | 112 |
| party | 0.85 | 0.85 | 0.88 | 128 |
| hype | 0.75 | 0.92 | 0.72 | 145 |
| workout | 0.60 | 0.96 | 0.68 | 155 |
| focus | 0.48 | 0.35 | 0.22 | 92 |
| anxious | 0.30 | 0.75 | 0.45 | 150 |
| angry | 0.18 | 0.95 | 0.55 | 160 |
| confident | 0.72 | 0.58 | 0.55 | 110 |

## Time-Based Recommendations
The system automatically adjusts recommendations based on the time of day in Los Angeles timezone:
| Time Range | Default Mood |
|------------|--------------|
| 12am - 3am | sleep |
| 3am - 6am | sleep |
| 6am - 9am | mellow |
| 9am - 12pm | focus |
| 12pm - 3pm | groovy |
| 3pm - 6pm | excited |
| 6pm - 9pm | happy |
| 9pm - 12am | chill |

**Features**:
- Tracks below popularity threshold (12) are filtered out
- Name deduplication prevents duplicate song versions

## Project Structure

```
spotifeel/
├── spotifeel-backend/
│   ├── app/
│   │   ├── core/
│   │   │   ├── config.py          # Settings and environment config
│   │   │   └── database.py        # Database connection setup
│   │   ├── routers/
│   │   │   └── recommendations.py # API endpoints
│   │   ├── services/
│   │   │   └── recommender.py     # Mood presets and logic
│   │   ├── main.py                # FastAPI application
│   │   ├── models.py              # SQLAlchemy models
│   │   └── schemas.py             # Pydantic schemas
│   ├── .env                       # Environment variables
│   └── requirements.txt           # Python dependencies
│
└── spotifeel-frontend/
    ├── src/
    │   ├── api.js                 # API client
    │   ├── App.jsx                # Main React component
    │   ├── App.css                # Styles
    │   └── main.jsx               # React entry point
    ├── .env                       # Environment variables
    └── package.json               # Node dependencies
```

## How To Run The Backend and Frontend

### Backend 
```bash
cd spotifeel-backend
cp .env.example .env
uvicorn app.main:app --reload
```

### Frontend 
```bash
cd spotifeel-frontend
cp .env.local.example .env.local
npm run dev    
```
Copy and paste the link that is labeled "Local: " (ex: http://localhost:5173/) to any browser

## Spotify OAuth Setup

In `spotifeel-backend/.env`, set:

```env
FRONTEND_URL=http://localhost:5173
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REDIRECT_URI=http://localhost:8000/spotify/auth/callback
SPOTIFY_SCOPES=user-read-email user-read-private user-top-read user-read-recently-played
SPOTIFY_SESSION_PATH=data/spotify_session.json
```

In your Spotify developer dashboard app settings, add this exact Redirect URI:
- `http://localhost:8000/spotify/auth/callback`

## How to Use Spotifeel

Once the app is open in your browser, you'll see the **Spotifeel** logo at the top and a segmented tab bar to switch between modes.

### Modes

- **Daily Mix** — Your default view. Loads 12 curated tracks on first visit and caches them for the day. Hit **Refresh** to get a fresh batch (already-seen tracks are automatically excluded so you won't get repeats).

- **Mood** — Use the dropdown to pick a mood (e.g. CHILL, HYPE, FOCUS). Tracks are fetched to match that vibe. Once results load, a **Refresh** button appears to get 12 new mood-matched tracks.

- **Time-Based** — Automatically detects the current time of day (in 3-hour blocks) and picks a mood to match — no input needed. The mood label is shown in the bar below the tabs. Results refresh automatically every 3 hours.

- **Spotify** — Connect your Spotify account to browse your **Top Tracks**, **Liked Songs**, and **Recently Played**. Hit **Connect Spotify** and authorize via the OAuth flow. Once connected, your library loads automatically.

### Playing Tracks

- **Click a track card** to open it directly in the Spotify app or web player.
- If you have **Spotify Premium**, use the ▶ button on any card to stream the track right inside Spotifeel. Use **-5s / +5s** to skip backward or forward, and click the progress bar to seek.
- Without Premium, clicking the play button will prompt you to open the track in Spotify instead.

---


