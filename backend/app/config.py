import os
from dotenv import load_dotenv

load_dotenv()


def _require(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value or value.startswith("your_") or value == "change_me_to_a_long_random_string":
        raise RuntimeError(
            f"Environment variable {name} is missing. "
            f"Copy backend/.env.example to backend/.env and fill it in."
        )
    return value


class Settings:
    spotify_client_id: str = _require("SPOTIFY_CLIENT_ID")
    spotify_client_secret: str = _require("SPOTIFY_CLIENT_SECRET")
    spotify_redirect_uri: str = _require("SPOTIFY_REDIRECT_URI")
    genius_access_token: str = _require("GENIUS_ACCESS_TOKEN")
    session_secret: str = _require("SESSION_SECRET")
    frontend_url: str = os.environ.get("FRONTEND_URL", "http://127.0.0.1:5173").strip()

    spotify_scopes: str = " ".join([
        "user-read-private",
        "user-top-read",
        "playlist-read-private",
        "playlist-read-collaborative",
        "user-library-read",
    ])


settings = Settings()
