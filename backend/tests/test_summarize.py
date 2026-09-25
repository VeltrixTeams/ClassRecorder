import json

import pytest

from app.pipeline import summarize as summarize_mod
from app.pipeline.summarize import SummaryContent


def make_segments():
    return [
        {"start_ms": 0, "end_ms": 5000, "speaker": "lecturer", "text": "Intro to calculus."},
        {"start_ms": 5000, "end_ms": 10000, "speaker": "lecturer", "text": "Derivatives explained."},
    ]


def full_content_dict(**overrides):
    base = {
        "overview": "intro overview",
        "topics": [{"title": "Calculus", "points": [{"text": "intro", "t": 0}, {"text": "derivative", "t": 5}, {"text": "out of range", "t": 999}]}],
        "definitions": [{"term": "derivative", "meaning": "rate of change", "t": 5}],
        "examples": [{"text": "an example", "t": 3}],
        "emphasized": [{"text": "will be on the exam", "t": 999}],
        "assignments": [{"task": "read chapter 1", "due": "2024-01-01", "t": 0}],
    }
    base.update(overrides)
    return base


async def _fake_chat_valid(messages, **kwargs):
    return {"choices": [{"message": {"content": json.dumps(full_content_dict())}}]}


@pytest.mark.asyncio
async def test_summarize_drops_items_past_duration(monkeypatch):
    monkeypatch.setattr(summarize_mod.gateway, "chat", _fake_chat_valid)
    result = await summarize_mod.summarize(make_segments(), duration_ms=10_000)
    assert [p.t for t in result.topics for p in t.points] == [0, 5]
    assert [e.t for e in result.emphasized] == []  # t=999 dropped
    assert [d.t for d in result.definitions] == [5]
    assert [a.t for a in result.assignments] == [0]


@pytest.mark.asyncio
async def test_summarize_drops_empty_topics_after_filtering():
    content = SummaryContent.model_validate(
        {
            "overview": "x",
            "topics": [{"title": "AllDropped", "points": [{"text": "x", "t": 999}]}],
            "definitions": [],
            "examples": [],
            "emphasized": [],
            "assignments": [],
        }
    )
    filtered = summarize_mod.drop_past_duration(content, duration_sec=10)
    assert filtered.topics == []


@pytest.mark.asyncio
async def test_summarize_retries_once_on_invalid_json_then_succeeds(monkeypatch):
    calls = {"n": 0}

    async def fake_chat(messages, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            return {"choices": [{"message": {"content": "not json"}}]}
        return {"choices": [{"message": {"content": json.dumps(full_content_dict())}}]}

    monkeypatch.setattr(summarize_mod.gateway, "chat", fake_chat)
    result = await summarize_mod.summarize(make_segments(), duration_ms=10_000)
    assert calls["n"] == 2
    assert result.overview == "intro overview"


@pytest.mark.asyncio
async def test_summarize_raises_after_two_failed_attempts(monkeypatch):
    async def fake_chat(messages, **kwargs):
        return {"choices": [{"message": {"content": "still not json"}}]}

    monkeypatch.setattr(summarize_mod.gateway, "chat", fake_chat)
    with pytest.raises(Exception):  # noqa: B017 - validation/json errors both acceptable here
        await summarize_mod.summarize(make_segments(), duration_ms=10_000)


@pytest.mark.asyncio
async def test_summarize_map_reduces_long_transcript(monkeypatch):
    long_segments = [
        {"start_ms": i * 1000, "end_ms": i * 1000 + 900, "speaker": "lecturer", "text": "word " * 50}
        for i in range(3000)
    ]
    calls = {"n": 0}

    async def fake_chat(messages, **kwargs):
        calls["n"] += 1
        content = full_content_dict(
            overview=f"window {calls['n']}",
            topics=[],
            definitions=[],
            examples=[],
            emphasized=[],
            assignments=[],
        )
        return {"choices": [{"message": {"content": json.dumps(content)}}]}

    monkeypatch.setattr(summarize_mod.gateway, "chat", fake_chat)
    result = await summarize_mod.summarize(long_segments, duration_ms=3_000_000)
    assert calls["n"] > 1
    assert result.overview.count("window") == calls["n"]


def test_merge_contents_concatenates_lists_and_overviews():
    a = SummaryContent(overview="a", topics=[{"title": "T1", "points": [{"text": "x", "t": 1}]}])
    b = SummaryContent(overview="b", definitions=[{"term": "y", "meaning": "z", "t": 2}])
    merged = summarize_mod.merge_contents([a, b])
    assert merged.overview == "a\n\nb"
    assert len(merged.topics) == 1
    assert len(merged.definitions) == 1
