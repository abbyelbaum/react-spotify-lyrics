# react-spotify-lyrics

Sporcle-style typing quiz built from your own Spotify library. Pick a song
(from your top tracks or a playlist), and type every word of its lyrics as
fast as you can.

- **Frontend:** Vite + React 19 + TypeScript
- **Backend:** FastAPI (Python)
- **Auth:** Spotify OAuth (Authorization Code flow)
- **Lyrics:** Genius (via `lyricsgenius`)
- **Storage:** SQLite (`backend/data/scores.db`)

## One-time setup

### 1. Create the developer apps

**Spotify** — https://developer.spotify.com/dashboard
1. Create an app.
2. Copy the **Client ID** and (click "View client secret" under it) the **Client Secret**.
3. Under **Redirect URIs**, add **exactly**: `http://127.0.0.1:5173/auth/callback`
   - Spotify rejects `localhost` — must be `127.0.0.1`.
   - This routes OAuth through the Vite dev server so cookies just work.

**Genius** — https://genius.com/api-clients
1. Create an API client (any name / website URL is fine).
2. Click **Generate Access Token** and copy the token.
   We only need the Access Token, not the Client ID / Client Secret.

### 2. Backend `.env`

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env` and paste your real values:

| Variable | Where to get it |
| --- | --- |
| `SPOTIFY_CLIENT_ID` | Spotify dashboard → your app |
| `SPOTIFY_CLIENT_SECRET` | Same page, click "View client secret" |
| `SPOTIFY_REDIRECT_URI` | Leave as `http://127.0.0.1:5173/auth/callback` |
| `GENIUS_ACCESS_TOKEN` | Genius API clients → Generate Access Token |
| `SESSION_SECRET` | Run `python3 -c "import secrets; print(secrets.token_urlsafe(48))"` and paste the output |
| `FRONTEND_URL` | Leave as `http://127.0.0.1:5173` |

`backend/.env` is gitignored — your secrets stay local.

### 3. Backend install (already done if you ran the initial scaffold)

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 4. Frontend install

```bash
cd frontend
npm install
```

## Running it

Open **two terminals**.

**Terminal 1 — backend:**
```bash
cd backend
source venv/bin/activate
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

**Terminal 2 — frontend:**
```bash
cd frontend
npm run dev
```

Open http://127.0.0.1:5173 (not `localhost` — must match Spotify's redirect host).
Click **Log in with Spotify**, approve, and you'll land on the song picker.

## How it fits together

- The browser only talks to `http://127.0.0.1:5173`.
- Vite proxies `/api/*` and `/auth/*` to the FastAPI backend on `:8000`,
  so cookies are simple and there's no CORS dance in dev.
- After Spotify redirects to `/auth/callback` (proxied to the backend),
  the backend exchanges the code for tokens, upserts a row in `users`,
  sets a signed `session` cookie, and bounces back to `/picker`.
- Tokens (access + refresh) live in SQLite, refreshed on demand.
- Every quiz attempt is saved to `attempts` and surfaced on `/scores`.

## Project layout

```
react-spotify-lyrics/
├── backend/
│   ├── app/
│   │   ├── main.py          FastAPI routes
│   │   ├── auth.py          Spotify OAuth + signed session cookies
│   │   ├── spotify.py       Spotify Web API client
│   │   ├── lyrics.py        Genius wrapper + tokenizer
│   │   ├── quiz.py          Scoring
│   │   ├── db.py            SQLite schema + helpers
│   │   └── config.py        Env settings
│   ├── data/scores.db       (created on first run, gitignored)
│   ├── .env                 your secrets — gitignored
│   ├── .env.example         template
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── App.tsx          Routing + auth gate
    │   ├── pages/
    │   │   ├── Login.tsx
    │   │   ├── SourcePicker.tsx   top tracks / playlists / random
    │   │   ├── Quiz.tsx           the typing game
    │   │   └── Scores.tsx
    │   └── lib/api.ts       Typed fetch wrapper
    └── vite.config.ts       Dev proxy for /api + /auth
```

## Known caveats

- Genius's API returns metadata + a URL but not lyrics text directly;
  `lyricsgenius` scrapes the song page. If Genius changes their markup it
  may temporarily break — fall back to LRCLIB if that happens.
- Lyrics matching is normalized (lowercased, diacritics + punctuation
  stripped), so `don't` accepts `dont` and `café` accepts `cafe`.
- Currently no leaderboard across users — `/api/scores/track/{id}` exists
  in the backend but isn't surfaced in the UI yet. Easy follow-up.
