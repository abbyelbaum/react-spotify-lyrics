export default function Login({ error }: { error?: string | null }) {
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
      <p className="muted small">
        We use Spotify's OAuth login. We never see your password.
      </p>
    </div>
  )
}
