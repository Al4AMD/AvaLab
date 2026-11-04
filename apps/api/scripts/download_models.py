#!/usr/bin/env python3
"""Prefetch pinned ML models into a flat per-task cache.

Run with the ML extra::

    uv run --directory apps/api --extra ml python scripts/download_models.py --check
    uv run --directory apps/api --extra ml python scripts/download_models.py --all

``--check`` never downloads and exits 1 when a task is incomplete. ``--all`` is
explicit because it fetches roughly 380 MB. Files are copied out of the
HuggingFace cache into ``<cache>/<task>/`` so runtime loaders can stay offline
without depending on HuggingFace cache internals.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

from avalab_api.ml.models import MODEL_SPECS, ModelSpec
from avalab_api.ml.registry import ModelRegistry, model_dir


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="check the cache and exit")
    parser.add_argument("--all", action="store_true", help="download every pinned model")
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=Path.home() / ".cache" / "avalab" / "models",
        help="destination cache (default: %(default)s)",
    )
    return parser


def _copy_from_hub(spec: ModelSpec, destination: Path) -> None:
    from huggingface_hub import hf_hub_download

    for filename in spec.files:
        source = hf_hub_download(
            repo_id=spec.model_id,
            filename=filename,
            revision=spec.revision,
        )
        target = destination / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)


def _write_manifest(cache_dir: Path) -> None:
    manifest = {
        "models": [
            {
                "task": spec.task,
                "model_id": spec.model_id,
                "revision": spec.revision,
                "license": spec.license,
                "size_bytes": spec.size_bytes,
                "files": list(spec.files),
                "loader_name": spec.loader_name,
            }
            for spec in MODEL_SPECS.values()
        ]
    }
    (cache_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    registry = ModelRegistry(args.cache_dir)
    if args.check or not args.all:
        missing = 0
        for task, spec in MODEL_SPECS.items():
            status = registry.status(task)
            print(f"{task:13} {status.state:9} {spec.model_id}@{spec.revision[:12]}")
            missing += status.state == "missing"
        return 1 if missing else 0

    for task, spec in MODEL_SPECS.items():
        destination = model_dir(args.cache_dir, task)
        destination.mkdir(parents=True, exist_ok=True)
        print(f"downloading {task}: {spec.model_id}@{spec.revision[:12]}")
        _copy_from_hub(spec, destination)
    _write_manifest(args.cache_dir)
    print(f"models ready in {args.cache_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
