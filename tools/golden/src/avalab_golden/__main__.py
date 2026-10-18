"""CLI entry point: ``python -m avalab_golden generate [--only ALGORITHM] [--out DIR]``.

The default output directory is ``packages/dsp/test-data/golden`` resolved
relative to the repository root, which is found by walking up from this
module's location until a directory containing ``.git`` is reached.
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

from avalab_golden.algorithms import GENERATORS
from avalab_golden.fixtures import write_golden_file

DEFAULT_OUT_DIR = Path("packages/dsp/test-data/golden")


def find_repo_root(start: Path) -> Path:
    """Return the closest ancestor of *start* (inclusive) that contains ``.git``.

    Raises ``FileNotFoundError`` when no repository root is found, so the CLI
    never silently writes fixtures into an unexpected directory.
    """
    resolved = start.resolve()
    for candidate in (resolved, *resolved.parents):
        if (candidate / ".git").exists():
            return candidate
    raise FileNotFoundError(f"no .git directory found above {start}")


def generate(only: str | None, out_dir: Path) -> list[Path]:
    """Write fixture files for one (``only``) or all algorithms; return written paths."""
    names = [only] if only is not None else sorted(GENERATORS)
    written: list[Path] = []
    for name in names:
        generator = GENERATORS.get(name)
        if generator is None:
            available = ", ".join(sorted(GENERATORS))
            raise SystemExit(f"error: unknown algorithm {name!r}; available: {available}")
        written.append(write_golden_file(name, generator(), out_dir))
    return written


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m avalab_golden",
        description="Generate golden-vector fixture JSON files for AvaLab DSP tests.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    generate_parser = subparsers.add_parser("generate", help="write golden fixture JSON files")
    generate_parser.add_argument(
        "--only",
        metavar="ALGORITHM",
        help="generate fixtures for a single algorithm (default: all)",
    )
    generate_parser.add_argument(
        "--out",
        type=Path,
        metavar="DIR",
        help=f"output directory (default: <repo-root>/{DEFAULT_OUT_DIR})",
    )
    args = parser.parse_args(argv)

    out_dir = args.out if args.out is not None else find_repo_root(Path(__file__)) / DEFAULT_OUT_DIR
    for path in generate(args.only, out_dir):
        print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
