from app.api.chat import format_label, parse_citations


def test_parse_citations_maps_labels_to_lecture_and_time():
    chunk_by_id = {
        1: {"lecture_id": "lec-a", "start_ms": 62_000},
        2: {"lecture_id": "lec-b", "start_ms": 5_000},
    }
    text = "As mentioned [c:1 | Calc | 2024-01-01 | 01:02], and also [c:2 | Physics | 2024-01-02 | 00:05]."
    citations = parse_citations(text, chunk_by_id)
    assert citations == [
        {"lecture_id": "lec-a", "start_ms": 62_000},
        {"lecture_id": "lec-b", "start_ms": 5_000},
    ]


def test_parse_citations_dedupes_repeated_citation():
    chunk_by_id = {1: {"lecture_id": "lec-a", "start_ms": 1000}}
    text = "[c:1 | x | y | 00:01] repeated again [c:1 | x | y | 00:01]"
    citations = parse_citations(text, chunk_by_id)
    assert len(citations) == 1


def test_parse_citations_ignores_unknown_ids():
    text = "See [c:999 | x | y | 00:00]"
    assert parse_citations(text, {}) == []


def test_format_label_includes_mmss_and_course():
    chunk = {"id": 5, "start_ms": 125_000, "recorded_at": None, "course_name": "Calc I"}
    label = format_label(chunk)
    assert label.startswith("[c:5")
    assert "02:05" in label
    assert "Calc I" in label
