import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, songKey, type Attempt } from '../lib/api'

export default function Scores() {
  const [attempts, setAttempts] = useState<Attempt[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.myAttempts().then(setAttempts).catch((e) => setError(String(e)))
  }, [])

  const sorted = useMemo(() => {
    if (!attempts) return null
    // Keep only the best attempt per song (by song identity, so different
    // releases of the same recording collapse into one row). Best = highest
    // percent, ties broken by raw score, then by recency.
    const bestByKey = new Map<string, Attempt>()
    for (const a of attempts) {
      const key = songKey(a.track_name, a.artist)
      const existing = bestByKey.get(key)
      if (!existing || isBetter(a, existing)) bestByKey.set(key, a)
    }
    return [...bestByKey.values()].sort((a, b) => {
      const pa = percent(a)
      const pb = percent(b)
      if (pb !== pa) return pb - pa
      return b.created_at - a.created_at
    })
  }, [attempts])

  return (
    <div className="page">
      <header className="row between">
        <h1>My Scores</h1>
        <Link className="btn" to="/picker">← Pick a song</Link>
      </header>

      {error && <p className="error">{error}</p>}
      {!attempts && !error && <p className="muted">Loading…</p>}
      {sorted && sorted.length === 0 && (
        <p className="muted">No attempts yet — go play a round.</p>
      )}
      {sorted && sorted.length > 0 && (
        <table className="scores-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Song</th>
              <th>Artist</th>
              <th className="num">Score</th>
              <th>Percent</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => {
              const pct = percent(a)
              return (
                <tr key={a.id}>
                  <td className="muted small">{formatDate(a.created_at)}</td>
                  <td className="song-cell">{a.track_name}</td>
                  <td className="muted">{a.artist}</td>
                  <td className="num">{a.score}</td>
                  <td>
                    <span className={`pct-pill${pct === 100 ? ' pct-pill-perfect' : ''}`}>
                      {pct}%
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

function percent(a: Attempt): number {
  if (!a.words_total) return 0
  return Math.round((a.words_correct / a.words_total) * 100)
}

function isBetter(a: Attempt, b: Attempt): boolean {
  const pa = percent(a)
  const pb = percent(b)
  if (pa !== pb) return pa > pb
  if (a.score !== b.score) return a.score > b.score
  return a.created_at > b.created_at
}

function formatDate(unix: number): string {
  // MM/DD/YYYY with leading zeros, locale-independent.
  const d = new Date(unix * 1000)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${mm}/${dd}/${d.getFullYear()}`
}
