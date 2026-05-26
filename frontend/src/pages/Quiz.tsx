import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, normalizeWord, songKey, type LyricToken, type Track } from '../lib/api'

type Status = 'loading' | 'playing' | 'done' | 'error'

type NextInfo = { track: Track; label: string }

export default function Quiz({ isGuest = false }: { isGuest?: boolean } = {}) {
  const [search] = useSearchParams()
  const navigate = useNavigate()

  const blind = search.get('blind') === '1'
  const sourceRaw = search.get('source') // "playlist:abc" | "album:xyz"
  const pos = parseInt(search.get('pos') || '-1', 10)

  // For non-blind quizzes, song info comes from URL. For blind quizzes,
  // we fetch a random song after mount and store it locally so the URL
  // can stay generic (`/quiz?blind=1&t=...`).
  const urlTitle = search.get('title') || ''
  const urlArtist = search.get('artist') || ''
  const urlTrackId = search.get('track_id') || ''

  const [songInfo, setSongInfo] = useState<{ title: string; artist: string; trackId: string } | null>(null)
  const [tokens, setTokens] = useState<LyricToken[]>([])
  const [status, setStatus] = useState<Status>('loading')
  const [errorMsg, setErrorMsg] = useState<string>('')

  const [filled, setFilled] = useState<boolean[]>([])
  const [input, setInput] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [paused, setPaused] = useState(false)
  const startRef = useRef<number>(0)
  const pausedMsRef = useRef<number>(0)
  const pauseStartRef = useRef<number | null>(null)
  const [finalScore, setFinalScore] = useState<number | null>(null)
  const [previousBest, setPreviousBest] = useState<number | null>(null)
  const submittedRef = useRef(false)

  const [nextInfo, setNextInfo] = useState<NextInfo | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)

  const typeableIndices = useMemo(
    () => tokens.map((t, i) => (t.typeable ? i : -1)).filter((i) => i >= 0),
    [tokens],
  )
  const totalWords = typeableIndices.length

  const targetMap = useMemo(() => {
    const m = new Map<string, number[]>()
    typeableIndices.forEach((tokIdx, j) => {
      const norm = tokens[tokIdx].normalized
      if (!norm) return
      const list = m.get(norm)
      if (list) list.push(j)
      else m.set(norm, [j])
    })
    return m
  }, [tokens, typeableIndices])

  const computeElapsedMs = () => {
    const now = Date.now()
    const base = now - startRef.current - pausedMsRef.current
    if (pauseStartRef.current !== null) return base - (now - pauseStartRef.current)
    return base
  }

  // Main load effect: when the URL changes, pick the song (random for blind,
  // URL params otherwise) and fetch its lyrics.
  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus('loading')
    setErrorMsg('')
    setSongInfo(null)
    setNextInfo(null)
    setFilled([])
    setInput('')

    const init = async () => {
      try {
        let song: { title: string; artist: string; trackId: string }
        if (blind) {
          let pick: Track
          if (sourceRaw) {
            // Blind random from a specific playlist or album.
            const [kind, id] = sourceRaw.split(':', 2)
            const tracks =
              kind === 'playlist'
                ? await api.playlistTracks(id)
                : kind === 'album'
                  ? await api.albumTracks(id)
                  : []
            if (!tracks.length) throw new Error('No tracks in this set')
            pick = tracks[Math.floor(Math.random() * tracks.length)]
          } else {
            pick = await api.randomFromTop()
          }
          song = { title: pick.name, artist: pick.artist, trackId: pick.id }
        } else {
          if (!urlTitle || !urlArtist) {
            throw new Error('Missing title or artist')
          }
          song = { title: urlTitle, artist: urlArtist, trackId: urlTrackId }
        }
        if (cancelled) return
        const res = await api.lyrics(song.title, song.artist)
        if (cancelled) return
        setSongInfo(song)
        setTokens(res.tokens)
        setFilled(new Array(res.total_words).fill(false))
        startRef.current = Date.now()
        pausedMsRef.current = 0
        pauseStartRef.current = null
        setPaused(false)
        setElapsed(0)
        setFinalScore(null)
        setPreviousBest(null)
        submittedRef.current = false
        setStatus('playing')

        // Look up previous best percent for this song so we can show
        // an "improved by" message if they beat it. Skipped for guests
        // (no attempt history; /api/attempts requires auth).
        if (!isGuest) {
          try {
            const attempts = await api.myAttempts()
            if (cancelled) return
            const key = songKey(song.title, song.artist)
            let bestPct = -1
            for (const a of attempts) {
              if (a.words_total <= 0) continue
              if (songKey(a.track_name, a.artist) !== key) continue
              const pct = (a.words_correct / a.words_total) * 100
              if (pct > bestPct) bestPct = pct
            }
            if (bestPct >= 0) setPreviousBest(bestPct)
          } catch {
            /* silent — improvement banner is optional */
          }
        }
      } catch (e) {
        if (!cancelled) {
          setErrorMsg(String(e))
          setStatus('error')
        }
      }
    }
    void init()
    return () => { cancelled = true }
    // Re-run when the URL signature changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.toString()])

  useEffect(() => {
    if (status !== 'playing') return
    const id = setInterval(() => setElapsed(Math.floor(computeElapsedMs() / 1000)), 250)
    return () => clearInterval(id)
  }, [status])

  useEffect(() => {
    if (status === 'playing' && !paused) inputRef.current?.focus()
  }, [status, paused])

  const correctCount = filled.filter(Boolean).length

  useEffect(() => {
    if (status !== 'playing') return
    // eslint-disable-next-line react-hooks/immutability
    if (totalWords > 0 && correctCount >= totalWords) void finishQuiz(filled)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [correctCount, totalWords, status])

  // After the quiz ends, figure out what (if anything) to offer as "next".
  useEffect(() => {
    if (status !== 'done' || !songInfo) return
    let cancelled = false
    const loadNext = async () => {
      if (blind) {
        let label = 'Another blind quiz'
        if (sourceRaw) {
          const [kind] = sourceRaw.split(':', 2)
          if (kind === 'playlist') label = 'Another random from this playlist'
          else if (kind === 'album') label = 'Another random from this album'
        }
        if (!cancelled) setNextInfo({
          track: { id: '', name: '', artist: '', album: null, image: null, preview_url: null, uri: '' },
          label,
        })
        return
      }
      if (!sourceRaw) return
      const [kind, id] = sourceRaw.split(':', 2)
      if (!id) return
      try {
        let tracks: Track[]
        let setName = ''
        if (kind === 'playlist') {
          tracks = await api.playlistTracks(id)
          setName = 'playlist'
        } else if (kind === 'album') {
          tracks = await api.albumTracks(id)
          setName = 'album'
        } else {
          return
        }
        // Find the current track by id or by position fallback.
        let idx = tracks.findIndex((t) => t.id === songInfo.trackId)
        if (idx < 0 && pos >= 0 && pos < tracks.length) idx = pos
        const next = tracks[idx + 1]
        if (next && !cancelled) setNextInfo({ track: next, label: `Next in ${setName}` })
      } catch {
        /* silent */
      }
    }
    void loadNext()
    return () => { cancelled = true }
  }, [status, songInfo, blind, sourceRaw, pos])

  const finishQuiz = async (finalFilled: boolean[]) => {
    if (submittedRef.current || !songInfo) return
    submittedRef.current = true
    if (pauseStartRef.current !== null) {
      pausedMsRef.current += Date.now() - pauseStartRef.current
      pauseStartRef.current = null
    }
    const words_correct = finalFilled.filter(Boolean).length
    const duration_seconds = Math.max(0, Math.floor(computeElapsedMs() / 1000))
    setStatus('done')
    if (isGuest) return  // no attempt persistence for guests
    const [sourceKind, sourceId] = sourceRaw ? sourceRaw.split(':', 2) : [null, null]
    try {
      const result = await api.submitAttempt({
        track_id: songInfo.trackId,
        track_name: songInfo.title,
        artist: songInfo.artist,
        words_correct,
        words_total: totalWords,
        duration_seconds,
        source_kind: sourceKind,
        source_id: sourceId,
      })
      setFinalScore(result.score)
    } catch (e) {
      setErrorMsg(`Saved locally only — server error: ${e}`)
    }
  }

  const togglePause = () => {
    if (status !== 'playing') return
    if (paused) {
      if (pauseStartRef.current !== null) {
        pausedMsRef.current += Date.now() - pauseStartRef.current
        pauseStartRef.current = null
      }
      setPaused(false)
    } else {
      pauseStartRef.current = Date.now()
      setPaused(true)
    }
  }

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (status !== 'playing' || paused) return
    const raw = e.target.value
    const normalized = normalizeWord(raw)
    if (!normalized) { setInput(raw); return }
    const positions = targetMap.get(normalized)
    if (!positions || positions.length === 0) { setInput(raw); return }
    const unfilled = positions.filter((j) => !filled[j])
    if (unfilled.length === 0) { setInput(raw); return }
    setFilled((prev) => {
      const next = [...prev]
      for (const j of positions) next[j] = true
      return next
    })
    setInput('')
  }

  const giveUp = () => {
    if (status !== 'playing') return
    void finishQuiz(filled)
  }

  const goToNext = () => {
    if (blind) {
      const params = new URLSearchParams({ blind: '1', t: String(Date.now()) })
      if (sourceRaw) params.set('source', sourceRaw)
      navigate(`/quiz?${params.toString()}`)
      return
    }
    if (!nextInfo || !nextInfo.track.id) return
    const params = new URLSearchParams({
      title: nextInfo.track.name,
      artist: nextInfo.track.artist,
      track_id: nextInfo.track.id,
    })
    if (sourceRaw) params.set('source', sourceRaw)
    if (pos >= 0) params.set('pos', String(pos + 1))
    navigate(`/quiz?${params.toString()}`)
  }

  const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const seconds = String(elapsed % 60).padStart(2, '0')

  if (status === 'loading') {
    return (
      <div className="page page-center">
        <p className="muted">{blind ? 'Picking a random song…' : `Fetching lyrics for "${urlTitle}" by ${urlArtist}…`}</p>
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className="page page-center">
        <h2>Couldn't load that one</h2>
        <p className="error">{errorMsg}</p>
        <Link className="btn" to="/picker">← Pick another song</Link>
      </div>
    )
  }

  // Hide title/artist while playing in blind mode.
  const showSongInfo = !blind || status === 'done'
  const displayTitle = showSongInfo ? songInfo?.title : '???'
  const displayArtist = showSongInfo ? songInfo?.artist : '???'

  return (
    <div className="page">
      <header className="quiz-header">
        <div>
          <h2 className={blind && !showSongInfo ? 'blind-hidden' : ''}>{displayTitle}</h2>
          <p className={'muted small ' + (blind && !showSongInfo ? 'blind-hidden' : '')}>{displayArtist}</p>
          {blind && !showSongInfo && (
            <p className="small muted blind-tag">Blind quiz — title revealed at the end</p>
          )}
        </div>
        <div className="quiz-stats">
          <div className="stat">
            <span className="stat-num">{correctCount}</span>
            <span className="stat-label">/ {totalWords}</span>
          </div>
          <div className="stat">
            <span className="stat-num">{minutes}:{seconds}</span>
            <span className="stat-label">elapsed</span>
          </div>
        </div>
      </header>

      <div className="lyrics-wrap">
        <LyricsView
          tokens={tokens}
          typeableIndices={typeableIndices}
          filled={filled}
          paused={paused && status === 'playing'}
          revealMissed={status === 'done'}
        />
        {paused && status === 'playing' && (
          <div className="lyrics-pause-overlay">
            <div className="pause-card">
              <h2>Paused</h2>
              <p className="muted small">Lyrics hidden so you can't peek.</p>
              <button className="btn btn-primary" onClick={togglePause}>Resume</button>
            </div>
          </div>
        )}
      </div>

      <div className="quiz-controls">
        <input
          ref={inputRef}
          className="quiz-input"
          type="text"
          value={input}
          onChange={onInputChange}
          placeholder={
            status === 'done' ? 'Quiz complete' : paused ? 'Paused' : 'Type any word from the song…'
          }
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          disabled={status !== 'playing' || paused}
        />
        <button className="btn" onClick={togglePause} disabled={status !== 'playing'}>
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button className="btn btn-danger" onClick={giveUp} disabled={status !== 'playing'}>
          Give up
        </button>
      </div>

      {status === 'done' && songInfo && (
        <div className="done-card">
          <h2>Done!</h2>
          {blind && (
            <p className="reveal-line">
              That was <strong>{songInfo.title}</strong> by <strong>{songInfo.artist}</strong>.
            </p>
          )}
          <p>
            You got <strong>{correctCount}</strong> / {totalWords} words
            {totalWords > 0 && (
              <> (<strong>{Math.round((correctCount / totalWords) * 100)}%</strong>)</>
            )}
            .
          </p>
          {finalScore !== null && <p>Score: <strong>{finalScore}</strong></p>}
          {status === 'done' && totalWords > 0 && previousBest !== null && (() => {
            const currentPct = (correctCount / totalWords) * 100
            if (currentPct <= previousBest) return null
            const delta = currentPct - previousBest
            return (
              <p className="improvement">
                🎉 New high score! You beat your previous best of{' '}
                <strong>{Math.round(previousBest)}%</strong> by{' '}
                <strong>{delta < 1 ? delta.toFixed(1) : Math.round(delta)}%</strong>{' '}🎉
              </p>
            )
          })()}
          {errorMsg && <p className="error">{errorMsg}</p>}
          <div className="row gap center wrap done-actions">
            {nextInfo && (
              <button className="btn btn-primary" onClick={goToNext}>
                {nextInfo.label}{!blind && nextInfo.track.name ? `: ${nextInfo.track.name}` : ''}
              </button>
            )}
            <Link className="btn" to="/picker">{isGuest ? 'Search another song' : 'Pick another song'}</Link>
            {!isGuest && <Link className="btn" to="/scores">View my scores</Link>}
          </div>
        </div>
      )}
    </div>
  )
}

function LyricsView({
  tokens,
  typeableIndices,
  filled,
  paused,
  revealMissed,
}: {
  tokens: LyricToken[]
  typeableIndices: number[]
  filled: boolean[]
  paused: boolean
  revealMissed: boolean
}) {
  const indexInTypeable = new Map<number, number>()
  typeableIndices.forEach((tokIdx, j) => indexInTypeable.set(tokIdx, j))

  const lines: React.ReactNode[][] = [[]]
  tokens.forEach((tok, i) => {
    if (tok.newline) { lines.push([]); return }
    if (tok.typeable) {
      const j = indexInTypeable.get(i)!
      const isFilled = filled[j]
      let className: string
      let display: React.ReactNode
      if (isFilled) {
        className = 'word word-correct'
        display = tok.text
      } else if (revealMissed) {
        className = 'word word-missed'
        display = tok.text
      } else {
        className = 'word word-blank'
        display = '_'.repeat(tok.text.length)
      }
      lines[lines.length - 1].push(<span key={i} className={className}>{display}</span>)
    } else {
      lines[lines.length - 1].push(<span key={i}>{tok.text}</span>)
    }
  })

  return (
    <div className={paused ? 'lyrics lyrics-paused' : 'lyrics'}>
      {lines.map((line, i) => (
        <div className="lyrics-line" key={i}>
          {line.length === 0 ? ' ' : line}
        </div>
      ))}
    </div>
  )
}
