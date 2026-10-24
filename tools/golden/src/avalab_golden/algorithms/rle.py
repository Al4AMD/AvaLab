"""Golden cases for the F04 run-length codec in ``packages/dsp/src/codecs/rle.ts``.

This module is the Python reference for the pinned byte format (controller
ruling R5 — the two implementations that must agree are this file and
``rle.ts``). An encoded stream is a sequence of records

    [value: u8][count: u16 little-endian, 1..65535]

Runs longer than 65535 bytes are split greedily (records of 65535 until the
remaining run is shorter), so 70000 identical bytes encode as the records
65535 + 2465. The format is NOT self-delimiting by design: a stream of any
length that is a multiple of 3 is decodable, so corrupted streams decode into
arbitrary bytes unless they are truncated (odd tail) or carry a count of 0.

Golden equality is **byte-exact in both directions** for every case: the
TypeScript test asserts ``rleEncode(input) == expected.encodedBytes`` and
``rleDecode(expected.encodedBytes) == input``, and this module asserts
``rle_decode(rle_encode(data)) == data`` for every case it builds.

Case list (stable order):
  1. ``rle_empty`` — empty in both directions.
  2. ``rle_single_byte_7`` — one byte, one record.
  3. ``rle_zeros_70000_split`` — 70000 identical bytes, forcing the greedy
     split into 65535 + 4465. The constant input is reconstructed from
     ``params`` (``lengthBytes`` x ``byteValue``) instead of being serialised
     into ``input.samples``: a constant run carries no information and its
     full serialisation would add ~0.5 MB of zeros to the fixture for nothing.
     Both languages build the identical input deterministically; the 6-byte
     encoded stream is pinned exactly (0,255,255 = value 0 count 0xFFFF,
     then 0,113,17 = value 0 count 0x1171 = 4465).
  4. ``rle_alternating_100`` — 0x00/0xFF alternating 100 times (200 input
     bytes expand to 300, every run has length 1).
  5. ``rle_ramp_256`` — ramp 0..255 (256 runs of length 1, 768 output bytes).
  6. ``rle_random_runs_seed7`` — seeded random bytes built from random blocks
     of value (0..255) and run length (1..39), NumPy ``default_rng(7)``; the
     full byte list is stored, so the TypeScript side never re-implements the
     random construction (no dual-implementation risk).
"""

from __future__ import annotations

import numpy as np

from avalab_golden.fixtures import GoldenCase

RLE_MAX_RUN = 65535
RANDOM_RUNS_SEED = 7
RANDOM_RUNS_SIZE = 1200
ZEROS_CASE_LENGTH = 70000


def rle_encode(data: bytes | bytearray) -> bytes:
    """Encode ``data`` to the pinned record format described in the module docstring."""
    out = bytearray()
    i = 0
    while i < len(data):
        value = data[i]
        run = 1
        while run < RLE_MAX_RUN and i + run < len(data) and data[i + run] == value:
            run += 1
        out.append(value)
        out += run.to_bytes(2, "little")
        i += run
    return bytes(out)


def rle_decode(data: bytes | bytearray) -> bytes:
    """Decode the pinned record format (inverse of :func:`rle_encode`)."""
    if len(data) % 3 != 0:
        raise ValueError("truncated rle stream")
    out = bytearray()
    for i in range(0, len(data), 3):
        count = int.from_bytes(data[i + 1 : i + 3], "little")
        if count == 0:
            raise ValueError("invalid rle count 0")
        out += data[i : i + 1] * count
    return bytes(out)


def _constant(byte_value: int, length: int) -> bytes:
    return bytes([byte_value]) * length


def _random_with_runs(seed: int, size: int) -> bytes:
    rng = np.random.default_rng(seed)
    values: list[int] = []
    while len(values) < size:
        block_value = int(rng.integers(0, 256))
        block_run = int(rng.integers(1, 40))
        values.extend([block_value] * block_run)
    return bytes(values[:size])


def _case(name: str, data: bytes) -> GoldenCase:
    encoded = rle_encode(data)
    # Byte-exact round-trip inside the reference itself, so a generator bug
    # can never ship as a golden vector.
    assert rle_decode(encoded) == data
    return GoldenCase(
        name=name,
        samples=list(data),
        sample_rate_hz=None,
        expected={"encodedBytes": list(encoded)},
    )


def cases() -> list[GoldenCase]:
    """Return the RLE fixture case set in stable order."""
    zeros_encoded = bytes([0, 255, 255, 0, 113, 17])
    assert rle_encode(_constant(0, ZEROS_CASE_LENGTH)) == zeros_encoded
    assert rle_decode(zeros_encoded) == _constant(0, ZEROS_CASE_LENGTH)
    return [
        _case("rle_empty", b""),
        _case("rle_single_byte_7", bytes([7])),
        GoldenCase(
            name="rle_zeros_70000_split",
            samples=[],
            sample_rate_hz=None,
            params={"byteValue": 0, "lengthBytes": ZEROS_CASE_LENGTH},
            expected={"encodedBytes": list(zeros_encoded)},
        ),
        _case("rle_alternating_100", bytes(v for _ in range(100) for v in (0x00, 0xFF))),
        _case("rle_ramp_256", bytes(range(256))),
        _case("rle_random_runs_seed7", _random_with_runs(RANDOM_RUNS_SEED, RANDOM_RUNS_SIZE)),
    ]
