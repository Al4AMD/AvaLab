"""ASGI middleware capping the ingest body size before FastAPI parses it.

FastAPI parses the whole multipart body before the route runs (Starlette
spools parts > 1 MiB to system temp), so the in-route streaming cap cannot
stop an oversized upload from being received. This middleware guards only
``POST /api/v1/ingest``:

* a declared ``Content-Length`` above the cap is rejected immediately with
  the standard 413 envelope, without reading the body;
* for bodies without ``Content-Length`` (chunked transfer) the wrapped
  ``receive`` counts streamed bytes and raises ``BodyTooLarge`` once the
  running total exceeds the cap. The signal fires while the app is still
  parsing, before any response has started, so this middleware catches it
  and answers with the same 413 envelope.

``BodyTooLarge`` subclasses ``BaseException`` on purpose: FastAPI converts any
``Exception`` raised while parsing the body into a 400 ("There was an error
parsing the body"), which would swallow the signal before this middleware sees
it. BaseException bypasses every ``except Exception`` in the app stack.

The in-route streaming cap stays as a backstop (it also covers bodies whose
declared length lies).
"""

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from avalab_api.errors import ErrorCode

INGEST_PATH = "/api/v1/ingest"


class BodyTooLarge(BaseException):
    """Internal control-flow signal: streamed body exceeded the cap."""


class UploadLimitMiddleware:
    """Reject oversized ingest uploads before FastAPI parses them."""

    def __init__(self, app: ASGIApp, max_upload_bytes: int) -> None:
        self.app = app
        self.max_upload_bytes = max_upload_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if not self._guards(scope):
            await self.app(scope, receive, send)
            return

        declared_bytes = _declared_content_length(scope)
        if declared_bytes is not None and declared_bytes > self.max_upload_bytes:
            await self._reject(scope, receive, send)
            return

        response_started = False

        async def guarded_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        streamed_bytes = 0

        async def counting_receive() -> Message:
            nonlocal streamed_bytes
            message = await receive()
            if message["type"] == "http.request":
                streamed_bytes += len(message.get("body", b""))
                if streamed_bytes > self.max_upload_bytes:
                    raise BodyTooLarge()
            return message

        try:
            await self.app(scope, counting_receive, guarded_send)
        except BodyTooLarge:
            if response_started:
                raise
            await self._reject(scope, receive, send)

    @staticmethod
    def _guards(scope: Scope) -> bool:
        return (
            scope["type"] == "http"
            and scope.get("method") == "POST"
            and scope.get("path") == INGEST_PATH
        )

    async def _reject(self, scope: Scope, receive: Receive, send: Send) -> None:
        response = JSONResponse(
            status_code=413,
            content={
                "error": {
                    "code": ErrorCode.file_too_large.value,
                    "message": (
                        f"Upload exceeds the maximum size of {self.max_upload_bytes} bytes"
                    ),
                }
            },
        )
        await response(scope, receive, send)


def _declared_content_length(scope: Scope) -> int | None:
    for name, value in scope.get("headers", []):
        if name == b"content-length":
            try:
                return int(value)
            except ValueError:
                return None
    return None
