import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Attempt } from '../lib/api'

export default function Scores() {
  const [attempts, setAttempts] = useState<Attempt[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.myAttempts().then(setAttempts).catch((e) => setError(String(e)))
  }, [])

  return (
    <div className="page">
      <header className="row between">
        <h1>My scores</h1>
        <Link className="btn" to="/picker">← Pick a song</Link>
      </header>

      {error && <p className="error">{error}</p>}
      {!attempts && !error && <p className="muted">Loading…</p>}
      {attempts && attempts.length === 0 && (
        <p className="muted">No attempts yet — go play a round.</p>
      )}
      {attempts && attempts.length > 0 && (
        <table className="scores-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Song</th>
              <th>Artist</th>
              <th>Words</th>
              <th>Time</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {attempts.map((a) => (
              <tr key={a.id}>
                <td className="muted small">{new Date(a.created_at * 1000).toLocaleString()}</td>
                <td>{a.track_name}</td>
                <td className="muted">{a.artist}</td>
                <td>{a.words_correct} / {a.words_total}</td>
                <td>{formatDuration(a.duration_seconds)}</td>
                <td><strong>{a.score}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
