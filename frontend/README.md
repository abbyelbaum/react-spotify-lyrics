# react-spotify-lyrics — frontend

Vite + React 19 + TypeScript client for the Sporcle-style lyric typing quiz.
Log in with Spotify, pick a song from your top tracks or a playlist, and race
to type every word of its lyrics.

The frontend is purely a UI — auth, Spotify, Genius, and score storage all
live in the FastAPI backend. Vite's dev server proxies `/api/*` and `/auth/*`
to the backend on port 8000.

## Pages

- [src/pages/Login.tsx](src/pages/Login.tsx) — Spotify OAuth entry point
- [src/pages/SourcePicker.tsx](src/pages/SourcePicker.tsx) — choose from top tracks, a playlist, or random
- [src/pages/Quiz.tsx](src/pages/Quiz.tsx) — the typing game
- [src/pages/Scores.tsx](src/pages/Scores.tsx) — your past attempts

## Running it

You need **both** the backend and the frontend running. See the [root README](../README.md)
for one-time setup (Spotify + Genius API keys, `backend/.env`, Python venv).

Open two terminals from the repo root:

**Terminal 1 — backend** (FastAPI on `:8000`):
```bash
cd backend
source venv/bin/activate
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

**Terminal 2 — frontend** (Vite on `:5173`):
```bash
cd frontend
npm install        # first time only
npm run dev
```

Then open **http://127.0.0.1:5173** — not `localhost`, since Spotify's
redirect URI is registered against `127.0.0.1`.

## Other scripts

```bash
npm run build      # type-check + production build to dist/
npm run preview    # serve the built bundle locally
npm run lint       # eslint
```

## Dev proxy

[vite.config.ts](vite.config.ts) forwards `/api/*` and `/auth/*` to
`http://127.0.0.1:8000`. That means the browser only ever talks to the Vite
origin, so the session cookie set by the backend's OAuth callback Just Works
with no CORS configuration.
