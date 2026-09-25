from app.pipeline.merge import Word, dedup_overlap, group_sentences, merge_chunks


def w(start_ms, end_ms, text, speaker="lecturer"):
    return Word(start_ms=start_ms, end_ms=end_ms, text=text, speaker=speaker)


def test_dedup_overlap_keeps_later_chunk_version():
    # chunk 0 runs 0..30000ms, chunk 1 starts at 29900ms (2s overlap window
    # before it, i.e. [27900, 29900), belongs to chunk 1's version instead).
    chunk0 = [w(20000, 20500, "hello"), w(28500, 29000, "world-old")]
    chunk1 = [w(29900, 30400, "world-new"), w(30500, 31000, "next")]
    merged = dedup_overlap([chunk0, chunk1], overlap_ms=2000)
    texts = [x["text"] for x in merged]
    assert "world-old" not in texts
    assert texts == ["hello", "world-new", "next"]


def test_dedup_overlap_handles_empty_chunks():
    assert dedup_overlap([], 2000) == []
    assert dedup_overlap([[], []], 2000) == []
    chunk0 = [w(0, 500, "hi")]
    assert dedup_overlap([chunk0, []], 2000) == chunk0


def test_group_sentences_splits_on_punctuation():
    words = [w(0, 500, "Hello."), w(600, 900, "How"), w(950, 1200, "are"), w(1250, 1600, "you?")]
    segments = group_sentences(words)
    assert len(segments) == 2
    assert segments[0]["text"] == "Hello."
    assert segments[1]["text"] == "How are you?"
    assert segments[0]["start_ms"] == 0
    assert segments[1]["end_ms"] == 1600


def test_group_sentences_splits_on_speaker_change():
    words = [
        w(0, 500, "lecturing", "lecturer"),
        w(600, 900, "question", "student"),
    ]
    segments = group_sentences(words)
    assert len(segments) == 2
    assert segments[0]["speaker"] == "lecturer"
    assert segments[1]["speaker"] == "student"


def test_group_sentences_splits_on_long_gap():
    words = [w(0, 500, "before"), w(10000, 10500, "after")]
    segments = group_sentences(words, max_gap_ms=1500)
    assert len(segments) == 2


def test_merge_chunks_end_to_end():
    chunk0 = [w(0, 400, "Hi."), w(500, 900, "This"), w(950, 1300, "is-old")]
    chunk1 = [w(900, 1250, "is-new"), w(1300, 1700, "lecture.")]
    segments = merge_chunks([chunk0, chunk1], overlap_ms=500)
    all_text = " ".join(s["text"] for s in segments)
    assert "is-old" not in all_text
    assert "is-new" in all_text
