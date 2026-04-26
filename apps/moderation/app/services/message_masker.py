"""
Message Masker Service
Replaces detected contact information with safe placeholder text.
Original content is NEVER stored — only the masked version.
"""
from .contact_detector import Detection

REPLACEMENT_MAP: dict[str, str] = {
    "PHONE_NUMBER": "[PHONE REMOVED]",
    "EMAIL": "[EMAIL REMOVED]",
    "WHATSAPP": "[WHATSAPP REMOVED]",
    "UPI_ID": "[UPI REMOVED]",
    "SOCIAL_HANDLE": "[HANDLE REMOVED]",
    "TELEGRAM": "[TELEGRAM REMOVED]",
}


class MessageMasker:
    """
    Replaces detected contact info with safe placeholders.
    Processes detections in reverse order to preserve string positions.
    """

    def mask(self, text: str, detections: list[Detection]) -> str:
        """
        Apply masking to text based on detections.
        Processes from end to start to preserve character positions.
        """
        if not detections:
            return text

        result = text
        # Sort by position descending so replacements don't shift earlier positions
        sorted_detections = sorted(detections, key=lambda d: d.position[0], reverse=True)

        for detection in sorted_detections:
            replacement = REPLACEMENT_MAP.get(detection.type, "[REMOVED]")
            start, end = detection.position
            result = result[:start] + replacement + result[end:]

        return result

    def mask_with_context(self, text: str, detections: list[Detection]) -> tuple[str, bool]:
        """
        Returns (masked_text, was_flagged).
        Convenience method for the common use case.
        """
        if not detections:
            return text, False
        return self.mask(text, detections), True
