"""Shared OpenAPI post-processing: make path keys server-relative.

The app declares ``servers: [{"url": "/api/v1"}]``, and OpenAPI paths are
resolved relative to the declared server URL. FastAPI, however, serves path
keys that already carry the router prefix (``/api/v1/health``), so
servers-aware consumers (e.g. Swagger UI "Try it out") would request
``/api/v1/api/v1/health`` and 404.

Both the served document (the ``app.openapi()`` override in
``avalab_api.main.create_app``) and the exported artifact
(``avalab_api.export_openapi``) run the schema through
:func:`server_relative_schema`, so served spec == committed spec by
construction.

Stripping is guarded: only the exact prefix (mapped to ``/``) or paths below
``prefix + "/"`` are rewritten. A future ``/api/v12/foo`` must survive
untouched — a bare ``str.removeprefix("/api/v1")`` would mangle it to
``2/foo``.
"""

from __future__ import annotations

from typing import Any


def strip_api_prefix(path: str, prefix: str) -> str:
    """Return ``path`` with the router ``prefix`` removed, if it carries it."""
    if path == prefix:
        return "/"
    if path.startswith(prefix + "/"):
        return path[len(prefix) :]
    return path


def server_relative_schema(schema: dict[str, Any], prefix: str) -> dict[str, Any]:
    """Rewrite every path key relative to the server URL (in place).

    Idempotent: already-relative paths (e.g. ``/health``) do not carry the
    prefix and are returned unchanged, so the override and the exporter may
    both apply it safely.
    """
    schema["paths"] = {
        strip_api_prefix(path, prefix): item for path, item in schema["paths"].items()
    }
    return schema
