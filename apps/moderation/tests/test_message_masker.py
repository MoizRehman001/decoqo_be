"""Tests for MessageMasker — verifies original content is never preserved."""
import pytest
from app.services.contact_detector import ContactDetector, Detection
from app.services.message_masker import MessageMasker

detector = ContactDetector()
masker = MessageMasker()


class TestMasking:
    def test_masks_phone_number(self):
        text = "Call me on 9876543210 to discuss"
        detections = detector.detect(text)
        masked = masker.mask(text, detections)
        assert "9876543210" not in masked
        assert "[PHONE REMOVED]" in masked

    def test_masks_email(self):
        text = "Email me at vendor@gmail.com"
        detections = detector.detect(text)
        masked = masker.mask(text, detections)
        assert "vendor@gmail.com" not in masked
        assert "[EMAIL REMOVED]" in masked

    def test_preserves_clean_content(self):
        text = "The budget is ₹12,00,000 for 10 weeks"
        detections = detector.detect(text)
        masked = masker.mask(text, detections)
        assert masked == text

    def test_masks_multiple_contacts(self):
        text = "Call 9876543210 or email v@g.com"
        detections = detector.detect(text)
        masked = masker.mask(text, detections)
        assert "9876543210" not in masked
        assert "v@g.com" not in masked

    def test_empty_detections_returns_original(self):
        text = "Can we start on Monday?"
        masked = masker.mask(text, [])
        assert masked == text

    def test_mask_with_context_returns_tuple(self):
        text = "Call 9876543210"
        detections = detector.detect(text)
        masked, flagged = masker.mask_with_context(text, detections)
        assert flagged is True
        assert "9876543210" not in masked

    def test_mask_with_context_clean_message(self):
        text = "Let us proceed with the BOQ"
        detections = detector.detect(text)
        masked, flagged = masker.mask_with_context(text, detections)
        assert flagged is False
        assert masked == text
