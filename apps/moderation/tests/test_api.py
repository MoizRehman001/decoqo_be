"""Integration tests for the FastAPI moderation endpoints."""
import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


class TestHealthEndpoint:
    def test_health_returns_ok(self):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["service"] == "decoqo-moderation"


class TestModerateMessageEndpoint:
    def test_clean_message_allowed(self):
        response = client.post("/moderate/message", json={
            "content": "Can we adjust the timeline to 8 weeks?",
            "context": "CHAT",
            "sender_id": "user-123",
        })
        assert response.status_code == 200
        data = response.json()
        assert data["flagged"] is False
        assert data["action"] == "ALLOW"
        assert data["masked"] == "Can we adjust the timeline to 8 weeks?"

    def test_phone_number_masked(self):
        response = client.post("/moderate/message", json={
            "content": "Call me on 9876543210 to discuss",
            "context": "CHAT",
            "sender_id": "user-123",
        })
        assert response.status_code == 200
        data = response.json()
        assert data["flagged"] is True
        assert data["action"] == "MASK_AND_FLAG"
        assert "9876543210" not in data["masked"]
        assert "[PHONE REMOVED]" in data["masked"]
        assert len(data["detections"]) > 0

    def test_email_masked(self):
        response = client.post("/moderate/message", json={
            "content": "Email me at vendor@gmail.com",
            "context": "NEGOTIATION_CHAT",
            "sender_id": "vendor-456",
        })
        assert response.status_code == 200
        data = response.json()
        assert data["flagged"] is True
        assert "vendor@gmail.com" not in data["masked"]

    def test_multiple_contacts_all_masked(self):
        response = client.post("/moderate/message", json={
            "content": "Call 9876543210 or email v@g.com",
            "context": "CHAT",
            "sender_id": "user-123",
        })
        assert response.status_code == 200
        data = response.json()
        assert "9876543210" not in data["masked"]
        assert "v@g.com" not in data["masked"]


class TestBatchModerateEndpoint:
    def test_batch_processes_all_messages(self):
        response = client.post("/moderate/batch", json={
            "messages": [
                {"content": "Clean message", "context": "CHAT", "sender_id": "u1"},
                {"content": "Call 9876543210", "context": "CHAT", "sender_id": "u2"},
            ]
        })
        assert response.status_code == 200
        data = response.json()
        assert len(data["results"]) == 2
        assert data["results"][0]["flagged"] is False
        assert data["results"][1]["flagged"] is True
