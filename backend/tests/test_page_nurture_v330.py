from __future__ import annotations

import io
import json
from unittest.mock import patch

from app.services.meta_graph_transport import publish_page_feed_post, publish_page_photo_post


class _FakeHttpResp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def test_publish_page_feed_post_with_share_link() -> None:
    captured: dict[str, object] = {}

    def _fake_urlopen(req, timeout=12):
        captured["url"] = req.full_url
        captured["body"] = req.data.decode("utf-8")
        return _FakeHttpResp(json.dumps({"id": "123456_7890"}).encode("utf-8"))

    with patch("urllib.request.urlopen", side_effect=_fake_urlopen):
        post_id = publish_page_feed_post(
            "10987654321",
            "EAAB_TEST_TOKEN",
            "Chia se kien thuc hay cho ca nha!",
            link="https://www.facebook.com/meta/posts/12345",
        )

    assert post_id == "123456_7890"
    assert "/10987654321/feed" in str(captured["url"])
    assert "link=https%3A%2F%2Fwww.facebook.com%2Fmeta%2Fposts%2F12345" in str(captured["body"])
    assert "message=" in str(captured["body"])


def test_publish_page_photo_post_calls_photos_endpoint() -> None:
    captured: dict[str, object] = {}

    def _fake_urlopen(req, timeout=15):
        captured["url"] = req.full_url
        captured["body"] = req.data.decode("utf-8")
        return _FakeHttpResp(json.dumps({"id": "5555", "post_id": "10987654321_5555"}).encode("utf-8"))

    with patch("urllib.request.urlopen", side_effect=_fake_urlopen):
        post_id = publish_page_photo_post(
            "10987654321",
            "EAAB_TEST_TOKEN",
            "Anh moi cho Fanpage!",
            "https://example.com/assets/hero.jpg",
        )

    assert post_id == "10987654321_5555"
    assert "/10987654321/photos" in str(captured["url"])
    assert "url=https%3A%2F%2Fexample.com%2Fassets%2Fhero.jpg" in str(captured["body"])
    assert "caption=" in str(captured["body"])


def test_publish_page_photo_post_rejects_invalid_url() -> None:
    assert (
        publish_page_photo_post("10987654321", "EAAB_TEST_TOKEN", "Caption", "C:/local/file.jpg")
        is None
    )
