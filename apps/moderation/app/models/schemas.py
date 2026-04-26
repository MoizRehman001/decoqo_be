from pydantic import BaseModel
from typing import Literal


class Detection(BaseModel):
    type: str
    original: str
    position: tuple[int, int]


class ModerateRequest(BaseModel):
    content: str
    context: Literal["CHAT", "NEGOTIATION_CHAT", "DISPUTE"] = "CHAT"
    sender_id: str = ""


class ModerateResponse(BaseModel):
    flagged: bool
    masked: str
    detections: list[Detection]
    action: Literal["ALLOW", "MASK_AND_FLAG"]


class BatchModerateRequest(BaseModel):
    messages: list[ModerateRequest]


class BatchModerateResponse(BaseModel):
    results: list[ModerateResponse]


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
