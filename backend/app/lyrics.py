import re
import unicodedata
from functools import lru_cache

import lyricsgenius
from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool

from .config import settings


_genius = lyricsgenius.Genius(
    settings.genius_access_token,
    timeout=15,
    retries=2,
    remove_section_headers=True,
    skip_non_songs=True,
)
# Silence the library's stdout chatter when searching.
_genius.verbose = False


_HEADER_RE = re.compile(r"^\d*\s*Contributors.*?Lyrics", re.IGNORECASE | re.DOTALL)
_EMBED_RE = re.compile(r"\d*Embed\s*$", re.IGNORECASE)
_YOU_MIGHT_ALSO_LIKE_RE = re.compile(r"You might also like", re.IGNORECASE)
_SECTION_RE = re.compile(r"\[[^\]]+\]")


def _clean_lyrics(text: str) -> str:
    if not text:
        return ""
    text = _HEADER_RE.sub("", text, count=1)
    text = _SECTION_RE.sub("", text)
    text = _YOU_MIGHT_ALSO_LIKE_RE.sub("", text)
    text = _EMBED_RE.sub("", text).strip()
    # Collapse 3+ newlines into 2 for readability
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _normalize_word(word: str) -> str:
    """Lowercase, strip diacritics, keep alphanumerics only."""
    nfkd = unicodedata.normalize("NFKD", word)
    stripped = "".join(c for c in nfkd if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", stripped.lower())


# Word = run of unicode letters/digits, allowing curly/straight apostrophes mid-word.
# Lyrics rarely contain underscores, so accepting `\w` (which includes `_`) is fine.
_WORD_RE = re.compile(r"[\w'’‘]+", re.UNICODE)


def tokenize(lyrics: str) -> list[dict]:
    """Split lyrics into a list of tokens.
    Each token is {"text": str, "typeable": bool, "normalized": str|None, "newline": bool}.
    Newlines are kept as their own non-typeable tokens so the UI can preserve line breaks.
    """
    tokens: list[dict] = []
    for line in lyrics.split("\n"):
        idx = 0
        for match in _WORD_RE.finditer(line):
            start, end = match.start(), match.end()
            if start > idx:
                tokens.append({"text": line[idx:start], "typeable": False})
            word = line[start:end]
            normalized = _normalize_word(word)
            if normalized:
                tokens.append({"text": word, "typeable": True, "normalized": normalized})
            else:
                tokens.append({"text": word, "typeable": False})
            idx = end
        if idx < len(line):
            tokens.append({"text": line[idx:], "typeable": False})
        tokens.append({"text": "\n", "typeable": False, "newline": True})
    # Drop trailing newline
    if tokens and tokens[-1].get("newline"):
        tokens.pop()
    return tokens


@lru_cache(maxsize=256)
def _fetch_lyrics_sync(title: str, artist: str) -> str:
    try:
        song = _genius.search_song(title, artist)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Genius lookup failed: {e}")
    if song is None or not getattr(song, "lyrics", None):
        raise HTTPException(status_code=404, detail=f"No lyrics found for '{title}' by '{artist}'")
    return _clean_lyrics(song.lyrics)


async def get_tokenized_lyrics(title: str, artist: str) -> dict:
    cleaned = await run_in_threadpool(_fetch_lyrics_sync, title, artist)
    tokens = tokenize(cleaned)
    total_words = sum(1 for t in tokens if t.get("typeable"))
    return {
        "title": title,
        "artist": artist,
        "tokens": tokens,
        "total_words": total_words,
    }
