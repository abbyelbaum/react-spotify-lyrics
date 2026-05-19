import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Album, type Playlist, type Track } from '../lib/api'

type Mode = 'top' | 'playlists' | 'albums' | 'search'

const TIME_RANGES = [
  { value: 'short_term', label: 'Last 4 weeks' },
  { value: 'medium_term', label: 'Last 6 months' },
  { value: 'long_term', label: 'All time' },
]

type SetContext =
  | { kind: 'playlist'; id: string; name: string; tracks: Track[] }
  | { kind: 'album'; id: string; name: string; tracks: Track[] }

export default function SourcePicker() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('top')

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

      {mode === 'top' && <TopTracks navigate={navigate} />}
      {mode === 'playlists' && <PlaylistBrowser navigate={navigate} />}
      {mode === 'albums' && <AlbumBrowser navigate={navigate} />}
      {mode === 'search' && <SearchTab navigate={navigate} />}
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

function TopTracks({ navigate }: { navigate: Nav }) {
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
        <label>
          Time range:{' '}
          <select value={timeRange} onChange={(e) => setTimeRange(e.target.value)}>
            {TIME_RANGES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Loading…</p>}
      {tracks && <TrackList tracks={tracks} onPick={(t) => startQuiz(navigate, t)} />}
    </>
  )
}

function PlaylistBrowser({ navigate }: { navigate: Nav }) {
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null)
  const [active, setActive] = useState<{ playlist: Playlist; tracks: Track[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    api.playlists().then(setPlaylists).catch((e) => setError(String(e))).finally(() => setLoading(false))
  }, [])

  const openPlaylist = async (p: Playlist) => {
    setLoading(true); setError(null)
    try {
      const tracks = await api.playlistTracks(p.id)
      setActive({ playlist: p, tracks })
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }

  const randomFromPlaylist = async (p: Playlist) => {
    setLoading(true); setError(null)
    try {
      const tracks = await api.playlistTracks(p.id)
      if (!tracks.length) { setError('That playlist is empty'); return }
      const pick = tracks[Math.floor(Math.random() * tracks.length)]
      startQuiz(navigate, pick, { kind: 'playlist', id: p.id, name: p.name, tracks })
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }

  if (active) {
    return (
      <>
        <div className="row between">
          <h2>{active.playlist.name}</h2>
          <button className="btn btn-ghost" onClick={() => setActive(null)}>← Back to playlists</button>
        </div>
        <TrackList
          tracks={active.tracks}
          onPick={(t) => startQuiz(navigate, t, { kind: 'playlist', id: active.playlist.id, name: active.playlist.name, tracks: active.tracks })}
        />
      </>
    )
  }

  return (
    <>
      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Loading…</p>}
      {playlists && (
        <ul className="list">
          {playlists.map((p) => (
            <li key={p.id} className="list-item">
              {p.image && <img src={p.image} alt="" className="thumb" />}
              <div className="list-body">
                <div className="list-title">{p.name}</div>
                <div className="muted small">{p.tracks_total} tracks · {p.owner}</div>
              </div>
              <div className="row gap">
                <button className="btn" onClick={() => openPlaylist(p)}>Browse</button>
                <button className="btn btn-primary" onClick={() => randomFromPlaylist(p)}>Random</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function AlbumBrowser({ navigate }: { navigate: Nav }) {
  const [albums, setAlbums] = useState<Album[] | null>(null)
  const [active, setActive] = useState<{ album: Album; tracks: Track[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    api.albums().then(setAlbums).catch((e) => setError(String(e))).finally(() => setLoading(false))
  }, [])

  const openAlbum = async (a: Album) => {
    setLoading(true); setError(null)
    try {
      const tracks = await api.albumTracks(a.id)
      setActive({ album: a, tracks })
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }

  const randomFromAlbum = async (a: Album) => {
    setLoading(true); setError(null)
    try {
      const tracks = await api.albumTracks(a.id)
      if (!tracks.length) { setError('That album has no tracks'); return }
      const pick = tracks[Math.floor(Math.random() * tracks.length)]
      startQuiz(navigate, pick, { kind: 'album', id: a.id, name: a.name, tracks })
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }

  if (active) {
    return (
      <>
        <div className="row between">
          <h2>{active.album.name}</h2>
          <button className="btn btn-ghost" onClick={() => setActive(null)}>← Back to albums</button>
        </div>
        <p className="muted small">{active.album.artist}</p>
        <TrackList
          tracks={active.tracks}
          onPick={(t) => startQuiz(navigate, t, { kind: 'album', id: active.album.id, name: active.album.name, tracks: active.tracks })}
        />
      </>
    )
  }

  return (
    <>
      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Loading…</p>}
      {albums && albums.length === 0 && <p className="muted">No saved albums.</p>}
      {albums && (
        <ul className="list">
          {albums.map((a) => (
            <li key={a.id} className="list-item">
              {a.image && <img src={a.image} alt="" className="thumb" />}
              <div className="list-body">
                <div className="list-title">{a.name}</div>
                <div className="muted small">{a.artist}{a.tracks_total ? ` · ${a.tracks_total} tracks` : ''}</div>
              </div>
              <div className="row gap">
                <button className="btn" onClick={() => openAlbum(a)}>Browse</button>
                <button className="btn btn-primary" onClick={() => randomFromAlbum(a)}>Random</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function SearchTab({ navigate }: { navigate: Nav }) {
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
            <button className="btn btn-ghost" onClick={() => setActiveAlbum(null)}>← Back to results</button>
          </div>
          <p className="muted small">{activeAlbum.album.artist}</p>
          <TrackList
            tracks={activeAlbum.tracks}
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
              <TrackList tracks={results.tracks} onPick={(t) => startQuiz(navigate, t)} />
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

function TrackList({ tracks, onPick }: { tracks: Track[]; onPick: (t: Track) => void }) {
  if (!tracks.length) return <p className="muted">No tracks found.</p>
  return (
    <ul className="list">
      {tracks.map((t) => (
        <li key={t.id} className="list-item">
          {t.image && <img src={t.image} alt="" className="thumb" />}
          <div className="list-body">
            <div className="list-title">{t.name}</div>
            <div className="muted small">{t.artist}</div>
          </div>
          <button className="btn btn-primary" onClick={() => onPick(t)}>Quiz me</button>
        </li>
      ))}
    </ul>
  )
}
