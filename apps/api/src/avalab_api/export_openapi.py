"""Export the FastAPI OpenAPI schema to a JSON file.

Usage:
    python -m avalab_api.export_openapi --out <path>

The output is deterministic (sorted keys, two-space indent, trailing newline)
so regenerating never produces a spurious git diff.

Path keys come back server-relative: the strip lives in
``avalab_api.openapi_utils`` and is shared with the ``app.openapi()`` override
in ``avalab_api.main``, so the exported file and the spec the app serves are
equal by construction. Clients then combine ``baseUrl = "/api/v1"`` with
``/health`` to reach the real endpoint exactly once (openapi-typescript
ignores ``servers``).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from avalab_api.main import API_PREFIX, app
from avalab_api.openapi_utils import server_relative_schema


def build_schema() -> dict[str, Any]:
    """Return the app's OpenAPI schema with server-relative path keys."""
    return server_relative_schema(app.openapi(), API_PREFIX)


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
