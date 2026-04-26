"""
Contact Detector Service
Detects phone numbers, emails, UPI IDs, WhatsApp handles, and social handles
in chat messages to prevent off-platform communication.
"""
import re
from dataclasses import dataclass
from typing import Optional

try:
    import spacy
    nlp = spacy.load("en_core_web_sm")
    SPACY_AVAILABLE = True
except Exception:
    nlp = None
    SPACY_AVAILABLE = False


@dataclass
class Detection:
    type: str
    original: str
    position: tuple[int, int]


# ── Regex patterns ─────────────────────────────────────────────────────────────

PATTERNS: dict[str, list[str]] = {
    "PHONE_NUMBER": [
        r"(\+91[\-\s]?)?[6-9]\d{9}",          # Indian mobile: +91 or bare 10-digit
        r"0\d{10}",                              # Landline with 0 prefix
        r"\b\d{5}[\s\-]\d{5}\b",               # Split format: 98765 43210
        r"\b\d{4}[\s\-]\d{3}[\s\-]\d{3}\b",   # Split: 9876 543 210
    ],
    "EMAIL": [
        r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}",
    ],
    "WHATSAPP": [
        r"whatsapp[\s:]*[\+\d\s\-]{10,}",
        r"wa\.me/\d+",
        r"wa\.me/\+\d+",
    ],
    "UPI_ID": [
        r"[a-zA-Z0-9.\-_]{3,}@(?:okaxis|oksbi|okicici|okhdfcbank|ybl|ibl|axl|upi|paytm|gpay|phonepe)",
    ],
    "SOCIAL_HANDLE": [
        r"@[a-zA-Z0-9_]{3,30}(?:\s|$)",        # @handle at word boundary
    ],
    "TELEGRAM": [
        r"t\.me/[a-zA-Z0-9_]+",
        r"telegram[\s:]+@?[a-zA-Z0-9_]+",
    ],
}

# Compile all patterns once at module load
COMPILED_PATTERNS: dict[str, list[re.Pattern]] = {
    ptype: [re.compile(p, re.IGNORECASE) for p in patterns]
    for ptype, patterns in PATTERNS.items()
}


class ContactDetector:
    """
    Detects contact information in text using regex + optional spaCy NLP.
    Designed to be instantiated once and reused (singleton pattern).
    """

    def detect(self, text: str) -> list[Detection]:
        """
        Scan text for contact information.
        Returns list of Detection objects with type, original text, and position.
        """
        detections: list[Detection] = []
        seen_spans: set[tuple[int, int]] = set()

        for detection_type, compiled_list in COMPILED_PATTERNS.items():
            for pattern in compiled_list:
                for match in pattern.finditer(text):
                    span = (match.start(), match.end())
                    # Avoid duplicate detections for overlapping spans
                    if not self._overlaps(span, seen_spans):
                        seen_spans.add(span)
                        detections.append(
                            Detection(
                                type=detection_type,
                                original=match.group().strip(),
                                position=span,
                            )
                        )

        # Optionally enhance with spaCy NER for phone/email entities
        if SPACY_AVAILABLE and nlp is not None:
            detections.extend(self._spacy_detect(text, seen_spans))

        return sorted(detections, key=lambda d: d.position[0])

    def has_contact_info(self, text: str) -> bool:
        """Quick check — returns True if any contact info found."""
        for compiled_list in COMPILED_PATTERNS.values():
            for pattern in compiled_list:
                if pattern.search(text):
                    return True
        return False

    def _spacy_detect(self, text: str, seen_spans: set[tuple[int, int]]) -> list[Detection]:
        """Use spaCy NER to catch phone/email entities missed by regex."""
        extra: list[Detection] = []
        doc = nlp(text)  # type: ignore[misc]
        for ent in doc.ents:
            if ent.label_ in ("PHONE", "EMAIL"):
                span = (ent.start_char, ent.end_char)
                if not self._overlaps(span, seen_spans):
                    seen_spans.add(span)
                    extra.append(
                        Detection(
                            type="PHONE_NUMBER" if ent.label_ == "PHONE" else "EMAIL",
                            original=ent.text,
                            position=span,
                        )
                    )
        return extra

    @staticmethod
    def _overlaps(span: tuple[int, int], seen: set[tuple[int, int]]) -> bool:
        """Check if a span overlaps with any already-seen span."""
        for s in seen:
            if span[0] < s[1] and span[1] > s[0]:
                return True
        return False
