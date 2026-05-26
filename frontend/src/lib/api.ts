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
  snapshot_id?: string | null
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

  guestSearch: (q: string, type = 'track,album') =>
    request<SearchResults>(`/api/guest/search?q=${encodeURIComponent(q)}&type=${encodeURIComponent(type)}`),
  guestAlbumTracks: (id: string) =>
    request<Track[]>(`/api/guest/albums/${encodeURIComponent(id)}/tracks`),

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
    source_kind?: string | null
    source_id?: string | null
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
  bestScores: () => request<Record<string, number>>('/api/best-scores'),
  lastPlayed: () => request<Record<string, number>>('/api/last-played'),
  lastPlayedSets: () => request<Record<string, number>>('/api/last-played-sets'),

  setTracks: (kind: 'playlist' | 'album', items: { id: string; snapshot_id?: string | null }[]) =>
    request<Record<string, string[]>>('/api/set-tracks', {
      method: 'POST',
      body: JSON.stringify({ kind, items }),
    }),
}

export function normalizeWord(word: string): string {
  return word
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

// Mirrors backend/app/song.py: identifies a recording by primary-artist+title,
// release-variant-insensitive. The same value the backend uses as a key for
// best-scores and last-played, so client and server agree on what counts as
// "the same song" across single / album / compilation releases.
const _TITLE_SUFFIX_RE = new RegExp(
  String.raw`\s*[-(]\s*(?:\d{4}\s+)?(?:` +
    [
      'Remaster(?:ed)?(?:\\s+\\d{4})?',
      'Mono(?:\\s+Version)?',
      'Stereo(?:\\s+Version)?',
      'Bonus(?:\\s+Track)?',
      'Single\\s+Version',
      'Album\\s+Version',
      'Radio\\s+(?:Edit|Version)',
      '\\d{4}\\s+Mix',
      'Original\\s+(?:Mix|Version)',
      'Extended\\s+(?:Mix|Version)',
      'Acoustic(?:\\s+Version)?',
      'Live(?:\\s+(?:at|from|in)\\s[^)\\-]+)?',
      'Demo(?:\\s+Version)?',
      'Deluxe(?:\\s+Edition)?',
    ].join('|') +
    String.raw`)[^)\-]*\)?\s*$`,
  'i',
)
const _FEAT_RE = /\s*[([](?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/i

function _alnumLower(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

export function songKey(name: string, artist: string): string {
  let title = (name || '').replace(_TITLE_SUFFIX_RE, '')
  title = title.replace(_FEAT_RE, '').replace(/[\s-]+$/, '').trim()
  const primary = (artist || '').split(',')[0].trim()
  return `${_alnumLower(primary)}|${_alnumLower(title)}`
}
