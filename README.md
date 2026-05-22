# react-spotify-lyrics

Sporcle-style typing quiz built from your own Spotify library. Pick a song
— from your top tracks, a saved playlist, a saved album, or a global Spotify
search — and type every word of its lyrics. The blanks fill in as you type
correct words (in any order; one word can fill all its occurrences at once).
Pause when you need to, give up to reveal the missed words in red, and your
score history is saved locally.

- **Frontend:** Vite + React 19 + TypeScript
- **Backend:** FastAPI (Python)
- **Auth:** Spotify OAuth (Authorization Code flow)
- **Lyrics:** Genius (via `lyricsgenius`)
- **Storage:** SQLite (`backend/data/scores.db`)

## Features

- **Sources:** top tracks (4-week / 6-month / all-time), saved playlists,
  saved albums, full Spotify search, and a "blind quiz" mode that hides the
  song's title and artist until you finish.
- **Random:** the top-of-screen banner picks blind from your top tracks;
  the per-playlist and per-album "Random" buttons pick blind *from that
  set*, and the post-game "Another random" button keeps rerolling the same
  set.
- **Library tools:** filter inputs on the Playlists and Albums tabs to
  search by name, plus a "Played: X / Y" badge per set so you can see how
  much of an album you've quizzed through.
- **Recency sort:** playlists and albums you've played from recently float
  to the top automatically.
- **Per-track best score:** every track row shows your best percentage if
  you've played it before; perfect scores get a green pill.
- **Quiz quality of life:** pause (blurs lyrics so you can't peek), give up
  to fill missed words in red, percentage + score on the done card, and an
  auto-suggested "Next song" if you launched from a playlist or album.

## One-time setup

### 1. Create the developer apps

**Spotify** — https://developer.spotify.com/dashboard
1. Create an app.
2. Copy the **Client ID** and (click "View client secret" under it) the **Client Secret**.
3. Under **Redirect URIs**, add **exactly**: `http://127.0.0.1:5173/auth/callback`
   - Spotify rejects `localhost` — must be `127.0.0.1`.
   - This routes OAuth through the Vite dev server so cookies just work.
4. On the same Settings page, add yourself under **User Management** while
   the app is in Development Mode (Spotify rejects logins from non-allowlisted
   users with a generic `server_error`).

**Genius** — https://genius.com/api-clients
1. Create an API client (any name / website URL is fine).
2. Click **Generate Access Token** and copy the token.
   We only use the Access Token — not the Client ID / Client Secret.

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

`backend/.env` is gitignored — your secrets stay local. If you ever rotate
the Spotify or Genius credentials, restart uvicorn (it doesn't auto-reload
on `.env` changes).

### 3. Install

```bash
cd backend && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt
cd ../frontend && npm install
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

- The browser only talks to `http://127.0.0.1:5173`. Vite proxies `/api/*`
  and `/auth/*` to FastAPI on `:8000`, so cookies are simple and there's
  no CORS dance in dev.
- Spotify redirects to `/auth/callback` (proxied to the backend), the
  backend exchanges the code for access + refresh tokens, upserts the user
  row, sets a signed `session` cookie, and bounces back to `/picker`.
- Tokens live in SQLite and get refreshed on demand.
- Every quiz attempt is saved with its source playlist/album (if any), so
  the recency sort and "Played X / Y" badges work without enumerating sets.
- Playlist/album track lists are cached locally per Spotify `snapshot_id`,
  so the badge fan-out only pays the Spotify API cost once per playlist
  version (and once per album, since albums are immutable).
- Songs are matched by a **normalized song key** (`primary_artist|title`,
  release-suffix stripped) rather than Spotify's `track_id`, so the same
  recording on a single, an album, and a compilation all count as one
  "song played."

## Known caveats

- Genius's API returns metadata and a URL but not lyrics text directly;
  `lyricsgenius` scrapes the song page. If Genius changes their HTML
  it may break temporarily — falling back to LRCLIB would be a small
  change in `backend/app/lyrics.py`.
- The match verifier rejects results where Genius silently returned an
  unrelated page (which it sometimes does for songs it doesn't have);
  you'll see a clean "Couldn't load that one" instead of garbage lyrics.
- Lyrics matching is normalized — `don't` accepts `dont`, `café` accepts
  `cafe`, and we scrub homoglyph anti-scraping characters (Cyrillic `е`
  injected to look like Latin `e`, etc.).
- No cross-user leaderboard yet. `/api/scores/track/{id}` exists in the
  backend but isn't surfaced in the UI.
