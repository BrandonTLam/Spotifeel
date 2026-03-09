# Spotifeel

A mood-based music recommendation engine that suggests Spotify tracks based on your emotional state, time of day, or generates daily mixes.

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

## Features

- **Mood-Based Recommendations**: Choose from 15 distinct moods (excited, happy, sad, chill, mellow, romance, groovy, party, hype, workout, focus, anxious, angry, confident, sleep)
- **Time-Aware Suggestions**: Get recommendations that adapt to your current time of day (updates every 3 hours)
- **Daily Mix**: Discover new tracks with a popularity-biased random selection that avoids recently played songs
- **Smart Matching**: Uses audio features (valence, energy, danceability, tempo) to find the perfect tracks

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

## 🕐 Time-Based Recommendations
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
uvicorn app.main:app --reload
```

### Frontend 
```bash
cd spotifeel-frontend
npm run dev    
```

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
