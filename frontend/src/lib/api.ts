export type Track = {
  id: string
  name: string
  artist: string
  album: string | null
  image: string | null
  preview_url: string | null
  uri: string
}

export type Playlist = {
  id: string
  name: string
  owner: string | null
  image: string | null
  tracks_total: number
}

export type Album = {
  id: string
  name: string
  artist: string
  image: string | null
  tracks_total: number | null
}

export type SearchResults = {
  tracks?: Track[]
  albums?: Album[]
}

export type LyricToken = {
  text: string
  typeable: boolean
  normalized?: string
  newline?: boolean
}

export type LyricsResponse = {
  title: string
  artist: string
  tokens: LyricToken[]
  total_words: number
}

export type Attempt = {
  id: number
  spotify_user_id: string
  track_id: string
  track_name: string
  artist: string
  words_correct: number
  words_total: number
  duration_seconds: number
  score: number
  created_at: number
}

export type Me = { id: string; display_name: string | null }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    ...init,
  })
  if (r.status === 401) {
    const err = new Error('Unauthorized') as Error & { status?: number }
    err.status = 401
    throw err
  }
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(`${r.status} ${r.statusText}: ${text}`)
  }
  if (r.status === 204) return undefined as T
  return r.json() as Promise<T>
}

export const api = {
  me: () => request<Me>('/api/me'),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),

  topTracks: (timeRange = 'medium_term') =>
    request<Track[]>(`/api/top-tracks?time_range=${encodeURIComponent(timeRange)}`),
  randomFromTop: (timeRange = 'medium_term') =>
    request<Track>(`/api/random-from-top?time_range=${encodeURIComponent(timeRange)}`),
  playlists: () => request<Playlist[]>('/api/playlists'),
  playlistTracks: (id: string) =>
    request<Track[]>(`/api/playlists/${encodeURIComponent(id)}/tracks`),

  albums: () => request<Album[]>('/api/albums'),
  albumTracks: (id: string) =>
    request<Track[]>(`/api/albums/${encodeURIComponent(id)}/tracks`),

  search: (q: string, type = 'track,album') =>
    request<SearchResults>(`/api/search?q=${encodeURIComponent(q)}&type=${encodeURIComponent(type)}`),

  lyrics: (title: string, artist: string) =>
    request<LyricsResponse>(
      `/api/lyrics?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`,
    ),

  submitAttempt: (payload: {
    track_id: string
    track_name: string
    artist: string
    words_correct: number
    words_total: number
    duration_seconds: number
  }) =>
    request<{ id: number; score: number }>('/api/attempts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  myAttempts: () => request<Attempt[]>('/api/attempts'),
  topScoresForTrack: (trackId: string) =>
    request<(Attempt & { display_name: string | null })[]>(
      `/api/scores/track/${encodeURIComponent(trackId)}`,
    ),
}

export function normalizeWord(word: string): string {
  return word
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}
