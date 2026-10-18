"""Stable machine-readable error model.

Routes raise ApiError; the app-level handler converts it into the exact body
{"error": {"code": "<code>", "message": "<text>"}}. The frontend translates by
code and never shows the message text directly (AGENTS.md sections 7 and 12).
"""

from enum import StrEnum


class ErrorCode(StrEnum):
    """Stable error codes shared with the frontend."""

    file_too_large = "file_too_large"
    duration_too_long = "duration_too_long"
    decode_failed = "decode_failed"
    not_found = "not_found"
    range_not_satisfiable = "range_not_satisfiable"
    invalid_request = "invalid_request"


class ApiError(Exception):
    """An error with a stable code, a developer-facing message and an HTTP status."""

    code: ErrorCode
    message: str
    status_code: int

    def __init__(self, code: ErrorCode, message: str, status_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
