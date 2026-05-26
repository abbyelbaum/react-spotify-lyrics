import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Album, type Track } from '../lib/api'

// Guest picker: search-only. No top tracks / playlists / albums / scores
// because none of those make sense without a Spotify user identity.
export default function GuestPicker() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<{ tracks: Track[]; albums: Album[] } | null>(null)
  const [activeAlbum, setActiveAlbum] = useState<{ album: Album; tracks: Track[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const runSearch = async (query: string) => {
    if (!query.trim()) return
    setLoading(true); setError(null); setActiveAlbum(null)
    try {
      const r = await api.guestSearch(query)
      setResults({ tracks: r.tracks || [], albums: r.albums || [] })
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }

  const openAlbum = async (a: Album) => {
    setLoading(true); setError(null)
    try {
      const tracks = await api.guestAlbumTracks(a.id)
      setActiveAlbum({ album: a, tracks })
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }

  const startQuiz = (t: Track) => {
    const params = new URLSearchParams({
      title: t.name,
      artist: t.artist,
      track_id: t.id,
    })
    navigate(`/quiz?${params.toString()}`)
  }

  return (
    <div className="page">
      <header className="row between">
        <h1>Search a song</h1>
      </header>

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
        <button type="submit" className="btn btn-primary" disabled={loading || !q.trim()}>
          Search
        </button>
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
          <TrackList tracks={activeAlbum.tracks} onPick={startQuiz} />
        </>
      )}

      {!activeAlbum && results && (
        <>
          {results.tracks.length > 0 && (
            <>
              <h2 className="section-h">Songs</h2>
              <TrackList tracks={results.tracks} onPick={startQuiz} />
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
    </div>
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
