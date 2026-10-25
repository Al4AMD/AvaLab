/**
 * Purpose: byte-level run-length (RLE) codec for the F04 lossless compression
 * lab. RLE is the shortest possible compression demo: students see that audio
 * built from held levels (silence, steps, quantization plateaus) collapses
 * into a tiny stream, while a stream where neighbouring bytes are almost never
 * equal (noise) expands, which motivates the Huffman and delta+Huffman codecs
 * of this wave.
 *
 * Wire format (pinned byte layout, controller ruling R5; the two
 * implementations that must agree are this file and the Python golden
 * reference `tools/golden/src/avalab_golden/algorithms/rle.py`):
 *   record = [value: u8][count: u16 little-endian, 1..65535]
 *   stream = zero or more records (a record count must be at least 1)
 * Runs longer than 65535 bytes are split greedily: the scan emits records of
 * 65535 until the remaining run is shorter, so 70000 identical bytes encode
 * as the two records 65535 + 4465 and 200000 as 65535 + 65535 + 65535 + 3395.
 * The greedy split is deterministic: any encoder using the same maximal-run
 * scan yields exactly this stream, which is what the golden vectors pin.
 *
 * The format is **not self-delimiting** by design: a stream is decodable
 * exactly when its length is a multiple of 3, and the encoder only ever
 * produces multiples of 3, so there is no separate end marker. Corrupted
 * streams (except the checked corruptions below) therefore decode without an
 * error into arbitrary bytes; a decoder must never treat that output as the
 * original. The purposefully checked corruptions are:
 *   - an input length that is not a multiple of 3 (odd/truncated tail),
 *   - a record whose count word decodes to 0 (counts must be in 1..65535).
 *
 * Reference: run-length coding, e.g. K. Sayood, *Introduction to Data
 * Compression*, 4th ed. (RLE with count-prefixed runs), PCX/TGA-style
 * count-prefixed runs; the exact record layout above is an AvaLab-internal
 * convention, deliberately kept trivial so the UI can expose the raw bytes.
 *
 * Complexity: O(N) time and O(N) space per call (a counting scan plus a
 * single allocation and fill; no growth, no per-byte JavaScript objects).
 *
 * Edge cases: empty input -> empty output (both directions); a single byte
 * encodes as one 3-byte record; runs of exactly 65535 stay in one record and
 * 65536 splits in two; byte values 0 and 255 (the PCM edges) are ordinary
 * values; decoding a corrupted stream with huge counts fails at the
 * allocation instead of returning a wrong-sized array; inputs are never
 * mutated and every call returns a fresh array.
 */

/** Pinned maximum run per record: a u16 count can hold 1..65535. */
const RLE_MAX_RUN = 65535;

/** Pinned record size: one value byte plus one u16 little-endian count. */
const RECORD_LENGTH = 3;

/** Number of leading equal bytes starting at `index`, capped at 65535. */
function runLengthAt(bytes: Uint8Array, index: number): number {
  const value = bytes[index] ?? 0;
  let run = 1;
  while (run < RLE_MAX_RUN) {
    const sample = bytes[index + run];
    if (sample === undefined || sample !== value) {
      break;
    }
    run += 1;
  }
  return run;
}

/** The record count at `position`, or the pinned decode errors. */
function countAt(encoded: Uint8Array, position: number): number {
  const low = encoded[position + 1];
  const high = encoded[position + 2];
  if (low === undefined || high === undefined) {
    throw new RangeError("truncated rle stream");
  }
  const count = low | (high << 8);
  if (count === 0) {
    throw new RangeError("invalid rle count 0");
  }
  return count;
}

/**
 * Encode a byte stream to the pinned RLE record sequence
 * ([value u8][count u16 LE, 1..65535], runs > 65535 split greedily).
 * Empty input -> empty output. Returns a fresh Uint8Array whose length is a
 * positive multiple of 3 for non-empty input; the input is never mutated.
 */
export function rleEncode(bytes: Uint8Array): Uint8Array {
  // One record per run; count in a first scan so the output is allocated
  // exactly once (O(N) total, no growth for long streams).
  let recordCount = 0;
  let index = 0;
  while (index < bytes.length) {
    recordCount += 1;
    index += runLengthAt(bytes, index);
  }
  const encoded = new Uint8Array(recordCount * RECORD_LENGTH);
  let position = 0;
  index = 0;
  while (index < bytes.length) {
    const value = bytes[index] ?? 0;
    const run = runLengthAt(bytes, index);
    encoded[position] = value;
    encoded[position + 1] = run & 0xff;
    encoded[position + 2] = (run >>> 8) & 0xff;
    position += RECORD_LENGTH;
    index += run;
  }
  return encoded;
}

/**
 * Decode a pinned RLE record sequence back to the original byte stream.
 * Empty input -> empty output. Throws `RangeError("truncated rle stream")`
 * when the length is not a multiple of 3 and
 * `RangeError("invalid rle count 0")` when a record's count is 0. Any other
 * corruption (the format is not self-delimiting) decodes into arbitrary
 * bytes; the input is never mutated.
 */
export function rleDecode(encoded: Uint8Array): Uint8Array {
  if (encoded.length % RECORD_LENGTH !== 0) {
    throw new RangeError("truncated rle stream");
  }
  // Validate every record and size the output in one pass, then fill (so a
  // corrupted stream fails before any large allocation happens).
  let decodedLength = 0;
  for (let position = 0; position < encoded.length; position += RECORD_LENGTH) {
    decodedLength += countAt(encoded, position);
  }
  const decoded = new Uint8Array(decodedLength);
  let written = 0;
  for (let position = 0; position < encoded.length; position += RECORD_LENGTH) {
    const value = encoded[position] ?? 0;
    const count = countAt(encoded, position);
    decoded.fill(value, written, written + count);
    written += count;
  }
  return decoded;
}
