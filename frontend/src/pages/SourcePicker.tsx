import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, songKey, type Album, type Playlist, type Track } from '../lib/api'

type Mode = 'top' | 'playlists' | 'albums' | 'search'

const TIME_RANGES = [
  { value: 'short_term', label: 'Last 4 weeks' },
  { value: 'medium_term', label: 'Last 6 months' },
  { value: 'long_term', label: 'All time' },
]

type SetContext =
  | { kind: 'playlist'; id: string; name: string; tracks: Track[] }
  | { kind: 'album'; id: string; name: string; tracks: Track[] }

type BestScores = Record<string, number>
type LastPlayed = Record<string, number>
type PlayStats = { played: number; total: number; lastPlayedAt: number | null }

export default function SourcePicker() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('top')
  const [bestScores, setBestScores] = useState<BestScores>({})
  const [lastPlayed, setLastPlayed] = useState<LastPlayed>({})
  const [statsReady, setStatsReady] = useState(false)

  useEffect(() => {
    Promise.all([api.bestScores(), api.lastPlayed()])
      .then(([best, last]) => { setBestScores(best); setLastPlayed(last) })
      .catch(() => {/* ok if empty */})
      .finally(() => setStatsReady(true))
  }, [])

  if (!statsReady) {
    return (
      <div className="page page-center">
        <p className="muted">Loading…</p>
      </div>
    )
  }

  return (
    <div className="page">
      <header className="row between">
        <h1>Pick a song</h1>
        <a className="btn btn-ghost" href="/scores">My scores</a>
      </header>

      <BlindBanner navigate={navigate} />

      <nav className="tabs">
        <button className={mode === 'top' ? 'tab active' : 'tab'} onClick={() => setMode('top')}>Top tracks</button>
        <button className={mode === 'playlists' ? 'tab active' : 'tab'} onClick={() => setMode('playlists')}>Playlists</button>
        <button className={mode === 'albums' ? 'tab active' : 'tab'} onClick={() => setMode('albums')}>Albums</button>
        <button className={mode === 'search' ? 'tab active' : 'tab'} onClick={() => setMode('search')}>Search</button>
      </nav>

      {mode === 'top' && <TopTracks navigate={navigate} bestScores={bestScores} />}
      {mode === 'playlists' && <PlaylistBrowser navigate={navigate} bestScores={bestScores} lastPlayed={lastPlayed} />}
      {mode === 'albums' && <AlbumBrowser navigate={navigate} bestScores={bestScores} lastPlayed={lastPlayed} />}
      {mode === 'search' && <SearchTab navigate={navigate} bestScores={bestScores} />}
    </div>
  )
}

type Nav = ReturnType<typeof useNavigate>

function startQuiz(navigate: Nav, track: Track, set?: SetContext) {
  const params = new URLSearchParams({
    title: track.name,
    artist: track.artist,
    track_id: track.id,
  })
  if (set) {
    const pos = set.tracks.findIndex((t) => t.id === track.id)
    params.set('source', `${set.kind}:${set.id}`)
    if (pos >= 0) params.set('pos', String(pos))
  }
  navigate(`/quiz?${params.toString()}`)
}

function BlindBanner({ navigate }: { navigate: Nav }) {
  return (
    <div className="blind-banner">
      <div>
        <div className="blind-title">Random blind quiz</div>
        <div className="muted small">A random song from your top tracks — title & artist hidden until you finish.</div>
      </div>
      <button className="btn btn-primary" onClick={() => navigate(`/quiz?blind=1&t=${Date.now()}`)}>
        Start blind quiz
      </button>
    </div>
  )
}

function TopTracks({ navigate, bestScores }: { navigate: Nav; bestScores: BestScores }) {
  const [timeRange, setTimeRange] = useState('medium_term')
  const [tracks, setTracks] = useState<Track[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null); setLoading(true)
    api.topTracks(timeRange).then(setTracks).catch((e) => setError(String(e))).finally(() => setLoading(false))
  }, [timeRange])

  return (
    <>
      <div className="row gap">
        <label className="select-field">
          <span className="select-label">Time range</span>
          <select
            className="styled-select"
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
          >
            {TIME_RANGES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Loading…</p>}
      {tracks && <TrackList tracks={tracks} bestScores={bestScores} onPick={(t) => startQuiz(navigate, t)} />}
    </>
  )
}

// Given a {set_id: track_ids[]} map plus per-track stats, compute the
// "Played: X / Y" + recency stats for each set.
function computePlayStats(
  setTracks: Record<string, string[]>,
  bestScores: BestScores,
  lastPlayed: LastPlayed,
): Record<string, PlayStats> {
  const out: Record<string, PlayStats> = {}
  for (const setId in setTracks) {
    const ids = setTracks[setId]
    let played = 0
    let lastPlayedAt: number | null = null
    for (const t of ids) {
      if (bestScores[t] !== undefined) played++
      const lp = lastPlayed[t]
      if (lp !== undefined && (lastPlayedAt === null || lp > lastPlayedAt)) {
        lastPlayedAt = lp
      }
    }
    out[setId] = { played, total: ids.length, lastPlayedAt }
  }
  return out
}

function sortByRecency<T extends { id: string }>(items: T[], stats: Record<string, PlayStats>): T[] {
  return [...items].sort((a, b) => {
    const ta = stats[a.id]?.lastPlayedAt ?? -Infinity
    const tb = stats[b.id]?.lastPlayedAt ?? -Infinity
    return tb - ta
  })
}

function filterByName(text: string, fields: (string | null | undefined)[]): boolean {
  if (!text) return true
  const needle = text.toLowerCase().trim()
  return fields.some((f) => f && f.toLowerCase().includes(needle))
}

function PlayCountBadge({ stats, loading }: { stats?: PlayStats; loading?: boolean }) {
  if (loading) return <span className="best-score">…</span>
  if (!stats || stats.total === 0) return null
  const isAll = stats.played === stats.total
  return (
    <span className={isAll ? 'best-score best-score-perfect' : 'best-score'}>
      Played: {stats.played} / {stats.total}
    </span>
  )
}

function PlaylistBrowser({
  navigate,
  bestScores,
  lastPlayed,
}: {
  navigate: Nav
  bestScores: BestScores
  lastPlayed: LastPlayed
}) {
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null)
  const [setTracks, setSetTracks] = useState<Record<string, string[]>>({})
  const [tracksReady, setTracksReady] = useState(false)
  const [active, setActive] = useState<{ playlist: Playlist; tracks: Track[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    api.playlists().then(setPlaylists).catch((e) => setError(String(e))).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!playlists) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTracksReady(false)
    api
      .setTracks('playlist', playlists.map((p) => ({ id: p.id, snapshot_id: p.snapshot_id })))
      .then((map) => { if (!cancelled) setSetTracks(map) })
      .catch(() => { /* leave badges empty on failure */ })
      .finally(() => { if (!cancelled) setTracksReady(true) })
    return () => { cancelled = true }
  }, [playlists])

  const playStats = useMemo(
    () => computePlayStats(setTracks, bestScores, lastPlayed),
    [setTracks, bestScores, lastPlayed],
  )

  const visiblePlaylists = useMemo(() => {
    if (!playlists) return null
    const sorted = tracksReady ? sortByRecency(playlists, playStats) : playlists
    return sorted.filter((p) => filterByName(filter, [p.name, p.owner]))
  }, [playlists, playStats, tracksReady, filter])

  const openPlaylist = async (p: Playlist) => {
    setLoading(true); setError(null)
    try {
      const tracks = await api.playlistTracks(p.id)
      setActive({ playlist: p, tracks })
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }

  const blindRandomFromPlaylist = (p: Playlist) => {
    navigate(`/quiz?blind=1&source=playlist:${encodeURIComponent(p.id)}&t=${Date.now()}`)
  }

  if (active) {
    const played = active.tracks.filter((t) => bestScores[songKey(t.name, t.artist)] !== undefined).length
    return (
      <>
        <div className="row between">
          <h2>{active.playlist.name}</h2>
          <div className="row gap">
            <button className="btn btn-primary" onClick={() => blindRandomFromPlaylist(active.playlist)}>Random</button>
            <button className="btn btn-ghost" onClick={() => setActive(null)}>← Back to playlists</button>
          </div>
        </div>
        <p className="muted small">Played {played} / {active.tracks.length} songs in this playlist.</p>
        <TrackList
          tracks={active.tracks}
          bestScores={bestScores}
          onPick={(t) => startQuiz(navigate, t, { kind: 'playlist', id: active.playlist.id, name: active.playlist.name, tracks: active.tracks })}
        />
      </>
    )
  }

  return (
    <>
      <LibraryFilter value={filter} onChange={setFilter} placeholder="Filter your playlists…" />
      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Loading…</p>}
      {visiblePlaylists && visiblePlaylists.length === 0 && (
        <p className="muted">{filter ? 'No playlists match that filter.' : 'No playlists.'}</p>
      )}
      {visiblePlaylists && visiblePlaylists.length > 0 && (
        <ul className="list">
          {visiblePlaylists.map((p) => (
            <li key={p.id} className="list-item">
              {p.image && <img src={p.image} alt="" className="thumb" />}
              <div className="list-body">
                <div className="list-title">{p.name}</div>
                <div className="muted small">{p.tracks_total} tracks · {p.owner}</div>
              </div>
              <PlayCountBadge stats={playStats[p.id]} loading={!tracksReady} />
              <div className="row gap">
                <button className="btn" onClick={() => openPlaylist(p)}>Browse</button>
                <button className="btn btn-primary" onClick={() => blindRandomFromPlaylist(p)}>Random</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function AlbumBrowser({
  navigate,
  bestScores,
  lastPlayed,
}: {
  navigate: Nav
  bestScores: BestScores
  lastPlayed: LastPlayed
}) {
  const [albums, setAlbums] = useState<Album[] | null>(null)
  const [setTracks, setSetTracks] = useState<Record<string, string[]>>({})
  const [tracksReady, setTracksReady] = useState(false)
  const [active, setActive] = useState<{ album: Album; tracks: Track[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    api.albums().then(setAlbums).catch((e) => setError(String(e))).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!albums) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTracksReady(false)
    api
      .setTracks('album', albums.map((a) => ({ id: a.id })))
      .then((map) => { if (!cancelled) setSetTracks(map) })
      .catch(() => { /* leave badges empty on failure */ })
      .finally(() => { if (!cancelled) setTracksReady(true) })
    return () => { cancelled = true }
  }, [albums])

  const playStats = useMemo(
    () => computePlayStats(setTracks, bestScores, lastPlayed),
    [setTracks, bestScores, lastPlayed],
  )

  const visibleAlbums = useMemo(() => {
    if (!albums) return null
    const sorted = tracksReady ? sortByRecency(albums, playStats) : albums
    return sorted.filter((a) => filterByName(filter, [a.name, a.artist]))
  }, [albums, playStats, tracksReady, filter])

  const openAlbum = async (a: Album) => {
    setLoading(true); setError(null)
    try {
      const tracks = await api.albumTracks(a.id)
      setActive({ album: a, tracks })
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }

  const blindRandomFromAlbum = (a: Album) => {
    navigate(`/quiz?blind=1&source=album:${encodeURIComponent(a.id)}&t=${Date.now()}`)
  }

  if (active) {
    const played = active.tracks.filter((t) => bestScores[songKey(t.name, t.artist)] !== undefined).length
    return (
      <>
        <div className="row between">
          <h2>{active.album.name}</h2>
          <div className="row gap">
            <button className="btn btn-primary" onClick={() => blindRandomFromAlbum(active.album)}>Random</button>
            <button className="btn btn-ghost" onClick={() => setActive(null)}>← Back to albums</button>
          </div>
        </div>
        <p className="muted small">{active.album.artist} · Played {played} / {active.tracks.length} songs in this album.</p>
        <TrackList
          tracks={active.tracks}
          bestScores={bestScores}
          onPick={(t) => startQuiz(navigate, t, { kind: 'album', id: active.album.id, name: active.album.name, tracks: active.tracks })}
        />
      </>
    )
  }

  return (
    <>
      <LibraryFilter value={filter} onChange={setFilter} placeholder="Filter your albums…" />
      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Loading…</p>}
      {visibleAlbums && visibleAlbums.length === 0 && (
        <p className="muted">{filter ? 'No albums match that filter.' : 'No saved albums.'}</p>
      )}
      {visibleAlbums && visibleAlbums.length > 0 && (
        <ul className="list">
          {visibleAlbums.map((a) => (
            <li key={a.id} className="list-item">
              {a.image && <img src={a.image} alt="" className="thumb" />}
              <div className="list-body">
                <div className="list-title">{a.name}</div>
                <div className="muted small">{a.artist}{a.tracks_total ? ` · ${a.tracks_total} tracks` : ''}</div>
              </div>
              <PlayCountBadge stats={playStats[a.id]} loading={!tracksReady} />
              <div className="row gap">
                <button className="btn" onClick={() => openAlbum(a)}>Browse</button>
                <button className="btn btn-primary" onClick={() => blindRandomFromAlbum(a)}>Random</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function LibraryFilter({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <div className="row gap library-filter">
      <input
        className="search-input"
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {value && (
        <button className="btn btn-ghost" onClick={() => onChange('')}>Clear</button>
      )}
    </div>
  )
}

function SearchTab({ navigate, bestScores }: { navigate: Nav; bestScores: BestScores }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<{ tracks: Track[]; albums: Album[] } | null>(null)
  const [activeAlbum, setActiveAlbum] = useState<{ album: Album; tracks: Track[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const runSearch = async (query: string) => {
    if (!query.trim()) return
    setLoading(true); setError(null); setActiveAlbum(null)
    try {
      const r = await api.search(query)
      setResults({ tracks: r.tracks || [], albums: r.albums || [] })
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }

  const openAlbum = async (a: Album) => {
    setLoading(true); setError(null)
    try {
      const tracks = await api.albumTracks(a.id)
      setActiveAlbum({ album: a, tracks })
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }

  return (
    <>
      <form
        className="row gap search-bar"
        onSubmit={(e) => { e.preventDefault(); void runSearch(q) }}
      >
        <input
          className="search-input"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search Spotify for any song or album…"
          autoFocus
        />
        <button type="submit" className="btn btn-primary" disabled={loading || !q.trim()}>Search</button>
      </form>
      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Searching…</p>}

      {activeAlbum && (
        <>
          <div className="row between">
            <h2>{activeAlbum.album.name}</h2>
            <div className="row gap">
              <button
                className="btn btn-primary"
                onClick={() => navigate(`/quiz?blind=1&source=album:${encodeURIComponent(activeAlbum.album.id)}&t=${Date.now()}`)}
              >
                Random
              </button>
              <button className="btn btn-ghost" onClick={() => setActiveAlbum(null)}>← Back to results</button>
            </div>
          </div>
          <p className="muted small">{activeAlbum.album.artist}</p>
          <TrackList
            tracks={activeAlbum.tracks}
            bestScores={bestScores}
            onPick={(t) => startQuiz(navigate, t, {
              kind: 'album', id: activeAlbum.album.id, name: activeAlbum.album.name, tracks: activeAlbum.tracks,
            })}
          />
        </>
      )}

      {!activeAlbum && results && (
        <>
          {results.tracks.length > 0 && (
            <>
              <h2 className="section-h">Songs</h2>
              <TrackList tracks={results.tracks} bestScores={bestScores} onPick={(t) => startQuiz(navigate, t)} />
            </>
          )}
          {results.albums.length > 0 && (
            <>
              <h2 className="section-h">Albums</h2>
              <ul className="list">
                {results.albums.map((a) => (
                  <li key={a.id} className="list-item">
                    {a.image && <img src={a.image} alt="" className="thumb" />}
                    <div className="list-body">
                      <div className="list-title">{a.name}</div>
                      <div className="muted small">{a.artist}</div>
                    </div>
                    <button className="btn" onClick={() => openAlbum(a)}>Browse</button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {results.tracks.length === 0 && results.albums.length === 0 && (
            <p className="muted">No results.</p>
          )}
        </>
      )}
    </>
  )
}

function TrackList({
  tracks,
  bestScores,
  onPick,
}: {
  tracks: Track[]
  bestScores?: BestScores
  onPick: (t: Track) => void
}) {
  if (!tracks.length) return <p className="muted">No tracks found.</p>
  return (
    <ul className="list">
      {tracks.map((t) => {
        const best = bestScores?.[songKey(t.name, t.artist)]
        return (
          <li key={t.id} className="list-item">
            {t.image && <img src={t.image} alt="" className="thumb" />}
            <div className="list-body">
              <div className="list-title">{t.name}</div>
              <div className="muted small">{t.artist}</div>
            </div>
            {best !== undefined && (
              <span className={`best-score${best === 100 ? ' best-score-perfect' : ''}`}>
                {best}%
              </span>
            )}
            <button className="btn btn-primary" onClick={() => onPick(t)}>Quiz me</button>
          </li>
        )
      })}
    </ul>
  )
}
