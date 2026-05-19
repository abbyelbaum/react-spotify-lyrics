def compute_score(words_correct: int, words_total: int, duration_seconds: int) -> int:
    """Score = accuracy * 1000, plus a small speed bonus if perfect.
    duration_seconds is how long the player took to finish (or give up).
    """
    if words_total <= 0:
        return 0
    accuracy = words_correct / words_total
    base = int(accuracy * 1000)
    if words_correct == words_total and duration_seconds > 0:
        speed_bonus = max(0, 500 - duration_seconds * 2)
        return base + speed_bonus
    return base
