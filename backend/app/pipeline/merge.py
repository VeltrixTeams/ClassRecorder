"""PURE functions merging per-chunk STT word lists into transcript segments.

No I/O, no imports of db/ai/config — easy to unit test in isolation.

Rules (§4):
- offset: each chunk's words already carry absolute start_ms/end_ms (STT layer
  applies the chunk offset), chunks are concatenated in index order.
- 2 s overlap dedup: consecutive chunks overlap by `overlap_ms`; words from the
  EARLIER chunk that fall inside the overlap window of the NEXT chunk's start
  are dropped, keeping the later chunk's version of that audio.
- per-chunk "longest talker = lecturer": already applied upstream in stt.py
  per chunk; merge.py trusts the speaker label on each word.
- sentence grouping: words are grouped into segments split on sentence-ending
  punctuation, or when the speaker changes, or when the gap to the next word
  exceeds `max_gap_ms`.
"""

from typing import TypedDict


class Word(TypedDict):
    start_ms: int
    end_ms: int
    text: str
    speaker: str


class Segment(TypedDict):
    start_ms: int
    end_ms: int
    speaker: str
    text: str
    words: list[Word]


_SENTENCE_ENDERS = (".", "?", "!", "。", "…")


def dedup_overlap(chunks: list[list[Word]], overlap_ms: int) -> list[Word]:
    """Concatenate per-chunk word lists, dropping earlier-chunk words that
    fall within `overlap_ms` of the next chunk's first word start (later
    chunk wins for that time range)."""
    merged: list[Word] = []
    for i, chunk in enumerate(chunks):
        if not chunk:
            continue
        if i + 1 < len(chunks) and chunks[i + 1]:
            next_start = chunks[i + 1][0]["start_ms"]
            cutoff = next_start - overlap_ms
            chunk = [w for w in chunk if w["start_ms"] < cutoff]
        merged.extend(chunk)
    merged.sort(key=lambda w: w["start_ms"])
    return merged


def group_sentences(words: list[Word], max_gap_ms: int = 1500) -> list[Segment]:
    """Group a flat, time-ordered word list into sentence-level segments."""
    segments: list[Segment] = []
    current: list[Word] = []

    def flush() -> None:
        if not current:
            return
        segments.append(
            Segment(
                start_ms=current[0]["start_ms"],
                end_ms=current[-1]["end_ms"],
                speaker=current[0]["speaker"],
                text=" ".join(w["text"] for w in current).strip(),
                words=list(current),
            )
        )

    prev: Word | None = None
    for w in words:
        if current and prev is not None:
            gap = w["start_ms"] - prev["end_ms"]
            speaker_changed = w["speaker"] != current[0]["speaker"]
            if speaker_changed or gap > max_gap_ms:
                flush()
                current = []
        current.append(w)
        prev = w
        if w["text"].strip().endswith(_SENTENCE_ENDERS):
            flush()
            current = []
            prev = None
    flush()
    return segments


def merge_chunks(chunks: list[list[Word]], overlap_ms: int = 2000, max_gap_ms: int = 1500) -> list[Segment]:
    """Full merge pipeline: dedup overlap then group into sentences."""
    words = dedup_overlap(chunks, overlap_ms)
    return group_sentences(words, max_gap_ms=max_gap_ms)
