"""
Moderation Router
Internal-only endpoints called by NestJS — never exposed to end users.
"""
from fastapi import APIRouter, Request
from app.models.schemas import (
    ModerateRequest,
    ModerateResponse,
    BatchModerateRequest,
    BatchModerateResponse,
    Detection as DetectionSchema,
)
from app.services.contact_detector import ContactDetector
from app.services.message_masker import MessageMasker
from app.logger import get_logger

router = APIRouter(tags=["moderation"])
logger = get_logger(__name__)

# Singletons — instantiated once at startup
_detector = ContactDetector()
_masker = MessageMasker()


@router.post("/message", response_model=ModerateResponse)
async def moderate_message(request: ModerateRequest) -> ModerateResponse:
    """
    Scan a single message for contact information.
    Returns masked content and detection details.
    Original content is never logged or stored.
    """
    detections = _detector.detect(request.content)

    if not detections:
        return ModerateResponse(
            flagged=False,
            masked=request.content,
            detections=[],
            action="ALLOW",
        )

    masked_content = _masker.mask(request.content, detections)

    logger.warning(
        "Contact info detected and masked",
        extra={
            "context": request.context,
            "sender_id": request.sender_id,
            "detection_types": [d.type for d in detections],
            "detection_count": len(detections),
        },
    )

    return ModerateResponse(
        flagged=True,
        masked=masked_content,
        detections=[
            DetectionSchema(type=d.type, original=d.original, position=d.position)
            for d in detections
        ],
        action="MASK_AND_FLAG",
    )


@router.post("/batch", response_model=BatchModerateResponse)
async def moderate_batch(request: BatchModerateRequest) -> BatchModerateResponse:
    """
    Batch scan multiple messages — used by admin review queue.
    """
    results = []
    for msg in request.messages:
        detections = _detector.detect(msg.content)
        if not detections:
            results.append(ModerateResponse(flagged=False, masked=msg.content, detections=[], action="ALLOW"))
        else:
            masked = _masker.mask(msg.content, detections)
            results.append(
                ModerateResponse(
                    flagged=True,
                    masked=masked,
                    detections=[DetectionSchema(type=d.type, original=d.original, position=d.position) for d in detections],
                    action="MASK_AND_FLAG",
                )
            )
    return BatchModerateResponse(results=results)
