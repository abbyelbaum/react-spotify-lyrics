"""Shared helpers for identifying songs across releases.

Spotify assigns a different ``track_id`` to every release of the same recording
(single vs. album vs. compilation), so matching on ``track_id`` causes false
negatives — e.g. a song played as a single shows as "not played" on the album.

We define a ``song_key`` = ``primary_artist|title`` (both heavily normalized) so
identical recordings collapse to the same key regardless of release.
"""
import re
import unicodedata


# Spotify often appends qualifier suffixes (e.g. " - 2023 Remaster", "(feat. X)")
# that vary between a song's release versions. Stripping them is what makes the
# album version and single version of the same recording collapse to one key.
_TITLE_SUFFIX_RE = re.compile(
    r"""
    \s*
    [-\(]
    \s*
    (?:\d{4}\s+)?
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
    [^\)\-]*
    \)?
    \s*$
    """,
    re.IGNORECASE | re.VERBOSE,
)

_FEAT_RE = re.compile(
    r"\s*[\(\[](?:feat\.?|ft\.?|featuring|with)\s[^\)\]]*[\)\]]",
    re.IGNORECASE,
)


def clean_title(title: str) -> str:
    cleaned = _TITLE_SUFFIX_RE.sub("", title or "")
    cleaned = _FEAT_RE.sub("", cleaned)
    cleaned = cleaned.rstrip(" -").strip()
    return cleaned or (title or "")


def primary_artist(artist: str) -> str:
    return (artist or "").split(",")[0].strip()


def _alnum_lower(s: str) -> str:
    nfkd = unicodedata.normalize("NFKD", s or "")
    stripped = "".join(c for c in nfkd if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "", stripped.lower())


def song_key(name: str, artist: str) -> str:
    """Stable identity for a recording, immune to release variants."""
    return f"{_alnum_lower(primary_artist(artist))}|{_alnum_lower(clean_title(name))}"
