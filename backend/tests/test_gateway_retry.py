import httpx
import pytest

from app.ai import gateway


class FakeClient:
    """Fakes httpx.AsyncClient.request, returning canned responses in order."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = 0

    async def request(self, method, url, json=None, headers=None, timeout=None):
        self.calls += 1
        item = self._responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def make_response(status_code, body):
    return httpx.Response(status_code, json=body, request=httpx.Request("POST", "http://x"))


@pytest.mark.asyncio
async def test_chat_retries_on_429_then_succeeds(monkeypatch):
    monkeypatch.setattr(gateway, "_log_usage", lambda **kw: _noop())
    sleeps = []

    async def fake_sleep(seconds):
        sleeps.append(seconds)

    client = FakeClient(
        [
            make_response(429, {}),
            make_response(200, {"choices": [{"message": {"content": "ok"}}], "usage": {"cost": 0.01}}),
        ]
    )
    data = await gateway.chat([{"role": "user", "content": "hi"}], sleep=fake_sleep, client=client)
    assert data["choices"][0]["message"]["content"] == "ok"
    assert client.calls == 2
    assert sleeps == [2.0]


@pytest.mark.asyncio
async def test_chat_gives_up_after_exhausting_backoffs(monkeypatch):
    monkeypatch.setattr(gateway, "_log_usage", lambda **kw: _noop())
    sleeps = []

    async def fake_sleep(seconds):
        sleeps.append(seconds)

    client = FakeClient([make_response(500, {})] * 4)
    with pytest.raises(httpx.HTTPStatusError):
        await gateway.chat([{"role": "user", "content": "hi"}], sleep=fake_sleep, client=client)
    assert sleeps == [2.0, 8.0, 30.0]


async def _noop():
    return None
