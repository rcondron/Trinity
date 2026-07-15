"""Map free-text behavior prompts ("wave hello", "lean forward attentively")
onto clip names. Both backends share this vocabulary: ARDY receives the raw
prompt text, the procedural backend receives the mapped clip."""

import re

CLIPS = (
    "idle",
    "walk",
    "wave",
    "nod",
    "shake",
    "shrug",
    "think",
    "lean_forward",
    "open_arms",
    "point",
    "bow",
)

_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"wave|hello|greet|\bhi\b|\bbye\b|goodbye", "wave"),
    (r"nod|yes\b|agree|affirm", "nod"),
    (r"shake\s*(my|your)?\s*head|\bno\b|disagree|deny", "shake"),
    (r"shrug|dunno|unsure|maybe|don.t know", "shrug"),
    (r"think|ponder|chin|hmm|consider|reflect", "think"),
    (r"lean|attentive|listen|closer", "lean_forward"),
    (r"open arms|welcom|embrace|present", "open_arms"),
    (r"point|indicate|direct", "point"),
    (r"bow|curtsy|thank", "bow"),
    (r"walk|pace|stroll|wander|approach|retreat", "walk"),
    (r"idle|ease|still|stand|stop|rest", "idle"),
)


def prompt_to_clip(prompt: str) -> str:
    p = prompt.lower()
    if p.startswith("locomotion:"):
        mode = p.split(":", 2)[1]
        return "idle" if mode == "idle" else "walk"
    for pattern, clip in _PATTERNS:
        if re.search(pattern, p):
            return clip
    return "idle"


def locomotion_params(prompt: str) -> tuple[str, float]:
    """Parse 'locomotion:mode[:speed]' → (mode, speed)."""
    parts = prompt.lower().split(":")
    mode = parts[1] if len(parts) > 1 else "idle"
    try:
        speed = float(parts[2]) if len(parts) > 2 else 0.5
    except ValueError:
        speed = 0.5
    return mode, max(0.0, min(2.0, speed))
