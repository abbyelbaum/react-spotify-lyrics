import { useEffect, useState } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import Login from './pages/Login'
import SourcePicker from './pages/SourcePicker'
import Quiz from './pages/Quiz'
import Scores from './pages/Scores'
import { api, type Me } from './lib/api'
import './App.css'

type AuthState =
  | { status: 'loading' }
  | { status: 'logged-in'; me: Me }
  | { status: 'logged-out' }

function AuthedApp() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' })
  const location = useLocation()
  const navigate = useNavigate()
  const errorParam = new URLSearchParams(location.search).get('error')

  useEffect(() => {
    let cancelled = false
    api
      .me()
      .then((me) => { if (!cancelled) setAuth({ status: 'logged-in', me }) })
      .catch(() => { if (!cancelled) setAuth({ status: 'logged-out' }) })
    return () => { cancelled = true }
  }, [])

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
        <Route path="*" element={<Login error={errorParam} />} />
      </Routes>
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
