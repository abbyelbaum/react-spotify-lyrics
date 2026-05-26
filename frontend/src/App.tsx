import { useEffect, useState } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import Login from './pages/Login'
import SourcePicker from './pages/SourcePicker'
import GuestPicker from './pages/GuestPicker'
import Quiz from './pages/Quiz'
import Scores from './pages/Scores'
import { api, type Me } from './lib/api'
import './App.css'

type AuthState =
  | { status: 'loading' }
  | { status: 'logged-in'; me: Me }
  | { status: 'guest' }
  | { status: 'logged-out' }

const GUEST_FLAG = 'lyric-quiz:guest'

function AuthedApp() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' })
  const location = useLocation()
  const navigate = useNavigate()
  const errorParam = new URLSearchParams(location.search).get('error')

  useEffect(() => {
    let cancelled = false
    // Guest flag overrides Spotify session check — it's a deliberate choice
    // the user makes on the landing page, persisted locally.
    if (localStorage.getItem(GUEST_FLAG) === '1') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAuth({ status: 'guest' })
      return
    }
    api
      .me()
      .then((me) => { if (!cancelled) setAuth({ status: 'logged-in', me }) })
      .catch(() => { if (!cancelled) setAuth({ status: 'logged-out' }) })
    return () => { cancelled = true }
  }, [])

  const onPlayAsGuest = () => {
    localStorage.setItem(GUEST_FLAG, '1')
    setAuth({ status: 'guest' })
    navigate('/picker')
  }

  // Clears the guest flag right before the browser navigates to Spotify
  // OAuth. Without this, the post-login app boot would still see the flag
  // and keep them in guest mode instead of recognising the new session.
  const clearGuestFlagOnLogin = () => {
    localStorage.removeItem(GUEST_FLAG)
  }

  const onLogout = async () => {
    try { await api.logout() } catch { /* ignore */ }
    setAuth({ status: 'logged-out' })
    navigate('/')
  }

  if (auth.status === 'loading') {
    return <div className="page page-center"><p className="muted">Loading…</p></div>
  }

  if (auth.status === 'logged-out') {
    return (
      <Routes>
        <Route path="*" element={<Login error={errorParam} onPlayAsGuest={onPlayAsGuest} />} />
      </Routes>
    )
  }

  if (auth.status === 'guest') {
    return (
      <>
        <nav className="topbar">
          <Link to="/picker" className="brand" aria-label="Back to song search">
            Lyric Quiz
          </Link>
          <a
            href="/auth/login"
            className="btn btn-primary"
            onClick={clearGuestFlagOnLogin}
          >
            Log in with Spotify
          </a>
        </nav>
        <Routes>
          <Route path="/" element={<Navigate to="/picker" replace />} />
          <Route path="/picker" element={<GuestPicker />} />
          <Route path="/quiz" element={<Quiz isGuest />} />
          <Route path="*" element={<Navigate to="/picker" replace />} />
        </Routes>
      </>
    )
  }

  return (
    <>
      <nav className="topbar">
        <Link to="/picker" className="brand" aria-label="Back to song picker">
          Lyric Quiz
        </Link>
        <div className="row gap">
          <span className="muted small">Hi, {auth.me.display_name || auth.me.id}</span>
          <button className="btn btn-ghost" onClick={onLogout}>Log out</button>
        </div>
      </nav>
      <Routes>
        <Route path="/" element={<Navigate to="/picker" replace />} />
        <Route path="/picker" element={<SourcePicker />} />
        <Route path="/quiz" element={<Quiz />} />
        <Route path="/scores" element={<Scores />} />
        <Route path="*" element={<Navigate to="/picker" replace />} />
      </Routes>
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthedApp />
    </BrowserRouter>
  )
}
