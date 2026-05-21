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

# Some lyric sources sprinkle non-Latin lookalike characters (Cyrillic/Greek)
# inside otherwise English words as an anti-scraping tactic — they render
# identical but break tokenization. Translate the common ones back to Latin.
_HOMOGLYPHS = str.maketrans({
    # Cyrillic -> Latin
    "а": "a", "А": "A",
    "е": "e", "Е": "E",
    "о": "o", "О": "O",
    "с": "c", "С": "C",
    "р": "p", "Р": "P",
    "х": "x", "Х": "X",
    "у": "y", "У": "Y",
    "і": "i", "І": "I",
    "ј": "j", "Ј": "J",
    "ѕ": "s", "Ѕ": "S",
    "ԁ": "d",
    "ʟ": "L",
    # Greek -> Latin
    "ο": "o", "Ο": "O",
    "α": "a", "Α": "A",
    "ε": "e", "Ε": "E",
    "ρ": "p", "Ρ": "P",
    "τ": "t", "Τ": "T",
    "κ": "k", "Κ": "K",
    "χ": "x", "Χ": "X",
    "ν": "v", "Ν": "N",
    "ι": "i", "Ι": "I",
    "η": "n", "Η": "H",
    "μ": "u", "Μ": "M",
    # Fullwidth ASCII -> ASCII
    **{chr(0xFF21 + i): chr(0x41 + i) for i in range(26)},   # Ａ-Ｚ
    **{chr(0xFF41 + i): chr(0x61 + i) for i in range(26)},   # ａ-ｚ
})

# Spotify often appends qualifier suffixes (e.g. " - 2023 Remaster", " - Remastered",
# "(Live at …)", " - Radio Edit") that don't appear on Genius's title for the same
# song. Stripping them before searching dramatically improves the match rate.
_TITLE_SUFFIX_RE = re.compile(
    r"""
    \s*
    [-\(]                                       # dash or open paren
    \s*
    (?:\d{4}\s+)?                                # optional leading year
    (?:
        Remaster(?:ed)?(?:\s+\d{4})?         |
        Mono(?:\s+Version)?                  |
        Stereo(?:\s+Version)?                |
        Bonus(?:\s+Track)?                   |
        Single\s+Version                     |
        Album\s+Version                      |
        Radio\s+(?:Edit|Version)             |
        \d{4}\s+Mix                          |
        Original\s+(?:Mix|Version)           |
        Extended\s+(?:Mix|Version)           |
        Acoustic(?:\s+Version)?              |
        Live(?:\s+(?:at|from|in)\s[^\)\-]+)? |
        Demo(?:\s+Version)?                  |
        Deluxe(?:\s+Edition)?
    )
    [^\)\-]*                                 # the rest of the qualifier
    \)?
    \s*$
    """,
    re.IGNORECASE | re.VERBOSE,
)

_FEAT_RE = re.compile(
    r"\s*[\(\[](?:feat\.?|ft\.?|featuring|with)\s[^\)\]]*[\)\]]",
    re.IGNORECASE,
)


def _clean_title_for_search(title: str) -> str:
    cleaned = _TITLE_SUFFIX_RE.sub("", title)
    cleaned = _FEAT_RE.sub("", cleaned)
    cleaned = cleaned.rstrip(" -").strip()
    return cleaned or title


def _clean_artist_for_search(artist: str) -> str:
    # Spotify joins multiple artists with ", "; Genius expects just the primary.
    return artist.split(",")[0].strip()


def _norm_for_compare(s: str) -> str:
    nfkd = unicodedata.normalize("NFKD", s or "")
    stripped = "".join(c for c in nfkd if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "", stripped.lower())


def _is_plausible_match(
    returned_title: str, returned_artist: str,
    want_title: str, want_artist: str,
) -> bool:
    rt, ra = _norm_for_compare(returned_title), _norm_for_compare(returned_artist)
    wt, wa = _norm_for_compare(want_title), _norm_for_compare(want_artist)
    if not rt or not ra or not wt or not wa:
        return False
    title_ok = wt in rt or rt in wt
    artist_ok = wa in ra or ra in wa
    return title_ok and artist_ok


def _clean_lyrics(text: str) -> str:
    if not text:
        return ""
    text = _HEADER_RE.sub("", text, count=1)
    text = _SECTION_RE.sub("", text)
    text = _YOU_MIGHT_ALSO_LIKE_RE.sub("", text)
    text = _EMBED_RE.sub("", text).strip()
    # Scrub anti-scraping homoglyphs so identical-looking words tokenize identically.
    text = text.translate(_HOMOGLYPHS)
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
    clean_title = _clean_title_for_search(title)
    clean_artist = _clean_artist_for_search(artist)
    try:
        song = _genius.search_song(clean_title, clean_artist)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Genius lookup failed: {e}")
    if song is None or not getattr(song, "lyrics", None):
        raise HTTPException(status_code=404, detail=f"No lyrics found for '{title}' by '{artist}'")
    returned_title = getattr(song, "title", "") or ""
    returned_artist = getattr(song, "artist", "") or ""
    if not _is_plausible_match(returned_title, returned_artist, clean_title, clean_artist):
        raise HTTPException(
            status_code=404,
            detail=(
                f"Genius returned a non-matching page for '{title}' by '{artist}' "
                f"(got '{returned_title}' by '{returned_artist}')"
            ),
        )
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
