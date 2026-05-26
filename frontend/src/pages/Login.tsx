export default function Login({
  error,
  onPlayAsGuest,
}: {
  error?: string | null
  onPlayAsGuest: () => void
}) {
  return (
    <div className="page page-center">
      <h1>Lyric Quiz</h1>
      <p className="subtitle">
        Sporcle-style typing quizzes built from your own Spotify library.
      </p>
      {error && <p className="error">Login failed: {error}</p>}
      <a className="btn btn-primary btn-lg" href="/auth/login">
        Log in with Spotify
      </a>
      <button className="btn btn-lg" onClick={onPlayAsGuest}>
        Play as guest
      </button>
      <p className="muted small">
        Log in to play from your library and save scores.
        Guest mode lets you search and play any song — scores aren't saved.
      </p>
    </div>
  )
}
