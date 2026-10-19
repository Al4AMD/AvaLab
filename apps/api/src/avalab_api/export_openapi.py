"""Export the FastAPI OpenAPI schema to a JSON file.

Usage:
    python -m avalab_api.export_openapi --out <path>

The output is deterministic (sorted keys, two-space indent, trailing newline)
so regenerating never produces a spurious git diff.

FastAPI declares ``servers: [{"url": "/api/v1"}]`` yet the mounted router also
prefixes every path key with ``/api/v1``. OpenAPI paths are resolved relative
to the declared server URL, so the duplicated prefix is stripped here; clients
then combine ``baseUrl = "/api/v1"`` with ``/health`` to reach the real
endpoint exactly once. openapi-typescript ignores ``servers``, so without the
strip the generated client would call ``/api/v1/api/v1/health``.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from avalab_api.main import API_PREFIX, app


def build_schema() -> dict[str, Any]:
    """Return the app's OpenAPI schema with server-relative path keys."""
    schema: dict[str, Any] = app.openapi()
    paths: dict[str, Any] = schema["paths"]
    schema["paths"] = {path.removeprefix(API_PREFIX) or "/": item for path, item in paths.items()}
    return schema


def write_schema(out_path: Path) -> None:
    """Write the schema to ``out_path``: parents created, bytes deterministic."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(build_schema(), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, type=Path, help="output JSON file path")
    args = parser.parse_args()
    write_schema(args.out)
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
