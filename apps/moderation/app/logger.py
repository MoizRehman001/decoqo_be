import logging
import json
import sys
from datetime import datetime, timezone


class JsonFormatter(logging.Formatter):
    """Structured JSON formatter — matches Winston output schema."""

    def format(self, record: logging.LogRecord) -> str:
        log_entry: dict = {
            "level": record.levelname.lower(),
            "message": record.getMessage(),
            "context": record.name,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "service": "decoqo-moderation",
        }
        if record.exc_info:
            log_entry["error"] = self.formatException(record.exc_info)
        # Merge any extra fields
        for key, value in record.__dict__.items():
            if key not in (
                "name", "msg", "args", "levelname", "levelno", "pathname",
                "filename", "module", "exc_info", "exc_text", "stack_info",
                "lineno", "funcName", "created", "msecs", "relativeCreated",
                "thread", "threadName", "processName", "process", "message",
            ):
                log_entry[key] = value
        return json.dumps(log_entry)


def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(JsonFormatter())
        logger.addHandler(handler)
        logger.setLevel(logging.DEBUG)
        logger.propagate = False
    return logger
