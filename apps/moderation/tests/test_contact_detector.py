"""
Tests for ContactDetector — covers all Indian contact patterns.
These tests are critical: they verify the anonymity guarantee of the platform.
"""
import pytest
from app.services.contact_detector import ContactDetector

detector = ContactDetector()


class TestPhoneDetection:
    def test_detects_bare_10_digit_mobile(self):
        result = detector.detect("Call me on 9876543210")
        assert any(d.type == "PHONE_NUMBER" for d in result)

    def test_detects_plus91_format(self):
        result = detector.detect("My number is +919876543210")
        assert any(d.type == "PHONE_NUMBER" for d in result)

    def test_detects_plus91_with_space(self):
        result = detector.detect("Reach me at +91 9876543210")
        assert any(d.type == "PHONE_NUMBER" for d in result)

    def test_detects_split_format_hyphen(self):
        result = detector.detect("Call 98765-43210 for details")
        assert any(d.type == "PHONE_NUMBER" for d in result)

    def test_detects_split_format_space(self):
        result = detector.detect("Number: 98765 43210")
        assert any(d.type == "PHONE_NUMBER" for d in result)

    def test_does_not_flag_short_numbers(self):
        result = detector.detect("Room size is 280 sqft at ₹85 per sqft")
        assert not any(d.type == "PHONE_NUMBER" for d in result)

    def test_does_not_flag_project_id(self):
        result = detector.detect("Project ID: 12345678")
        assert not any(d.type == "PHONE_NUMBER" for d in result)


class TestEmailDetection:
    def test_detects_gmail(self):
        result = detector.detect("Email me at vendor@gmail.com")
        assert any(d.type == "EMAIL" for d in result)

    def test_detects_business_email(self):
        result = detector.detect("Contact: rajesh@sharmainteriors.in")
        assert any(d.type == "EMAIL" for d in result)

    def test_detects_email_with_dots(self):
        result = detector.detect("Write to r.sharma@company.co.in")
        assert any(d.type == "EMAIL" for d in result)


class TestUpiDetection:
    def test_detects_upi_okaxis(self):
        result = detector.detect("Pay me at rajesh@okaxis")
        assert any(d.type == "UPI_ID" for d in result)

    def test_detects_upi_paytm(self):
        result = detector.detect("Send to 9876543210@paytm")
        assert any(d.type == "UPI_ID" for d in result)


class TestWhatsappDetection:
    def test_detects_wa_me_link(self):
        result = detector.detect("Chat at wa.me/919876543210")
        assert any(d.type == "WHATSAPP" for d in result)

    def test_detects_whatsapp_mention(self):
        result = detector.detect("WhatsApp me: +91 9876543210")
        assert len(result) > 0  # Either WHATSAPP or PHONE_NUMBER


class TestCleanMessages:
    def test_clean_project_discussion(self):
        result = detector.detect("Can we adjust the timeline to 8 weeks if we start by May 1st?")
        assert len(result) == 0

    def test_clean_boq_discussion(self):
        result = detector.detect("The false ceiling in room 3 needs 280 sqft at ₹85/sqft")
        assert len(result) == 0

    def test_clean_milestone_discussion(self):
        result = detector.detect("Material procurement milestone should be 30% of total value")
        assert len(result) == 0

    def test_clean_budget_discussion(self):
        result = detector.detect("Budget range is ₹5L to ₹15L for 12 weeks")
        assert len(result) == 0


class TestMultipleDetections:
    def test_detects_multiple_contacts(self):
        result = detector.detect("Call 9876543210 or email vendor@gmail.com")
        types = {d.type for d in result}
        assert "PHONE_NUMBER" in types
        assert "EMAIL" in types

    def test_positions_are_correct(self):
        text = "Call 9876543210 now"
        result = detector.detect(text)
        phone = next((d for d in result if d.type == "PHONE_NUMBER"), None)
        assert phone is not None
        assert text[phone.position[0]:phone.position[1]] == phone.original
