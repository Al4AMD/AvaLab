/**
 * Purpose: canonical Huffman codec for byte streams — the core F04 lossless
 * compressor of the compression lab. Huffman coding replaces each byte with a
 * codeword whose bit length grows as the byte's frequency shrinks, so a
 * skewed distribution (silence, held notes, quantization plateaus) shrinks
 * while a flat one does not. The *canonical* variant (RFC 1951 §3.2.2) pins
 * the codeword assignment to the length table alone: the transmitted codebook
 * is just 256 code lengths, and any encoder implementing the pinned rule
 * emits bit-identical streams for the same histogram — which is the
 * determinism contract of this module (Review Focus 2).
 *
 * Construction (pinned, deterministic; controller ruling R6):
 *   1. Tree phase: a binary min-heap merges the positive-frequency symbols.
 *      Heap order (documented tie-break): frequency ascending, then the
 *      subtree's smallest byte value ("min-symbol") ascending, then the node
 *      creation sequence ascending. Min-symbols are unique across a Huffman
 *      forest at every stage (the symbol sets of forest nodes are disjoint),
 *      so the first two keys alone always decide; the creation sequence is a
 *      defensive backstop that makes the comparator total for any histogram.
 *   2. Lengths = leaf depths in the merged tree (all-zero histogram → all
 *      lengths 0; a single positive symbol → length 1, because a lone symbol
 *      must still cost a bit to be decodable).
 *   3. Length limiting (max 15 bits, RFC/DEFLATE-style): unrestricted Huffman
 *      depths always satisfy Kraft exactly (Σ 2^(−d) = 1), but a heavily
 *      skewed histogram (Fibonacci-shaped frequencies) can need depths > 15.
 *      Fallback, pinned in exact steps:
 *        a) clamp: l[s] = min(depth[s], 15) for every positive symbol —
 *          overlong codes are pulled up one or more levels into the 15-bit
 *          space;
 *        b) the clamped multiset is then potentially over-subscribed, so it
 *          is repaired with integer Kraft arithmetic: with
 *          K = Σ_s 2^(15 − l[s]) (every l ≤ 15, K is a plain number),
 *          while K > 2^15: let b be the largest length in 1..14 that still
 *          has a code (it exists — proof below), and demote the SMALLEST
 *          symbol coded at length b to length b + 1; K drops by exactly
 *          2^(14 − b) ≥ 1 per step and starts below 2^15 + 255, so the loop
 *          terminates within 255 steps. Proof that b exists: the depths form
 *          a full binary tree, so Σ 2^(−d) = 1; if every true depth were
 *          ≥ 15 the sum would be ≤ 256·2^(−15) < 1 — contradiction, so some
 *          true depth is ≤ 14 and keeps its own length after clamping. The
 *          same bound keeps the loop alive throughout: while K > 2^15 some
 *          code must sit at a length ≤ 14, because 256 codes of length 15
 *          contribute at most 256 < 2^15.
 *      The repaired multiset has every length ≤ 15 and Kraft ≤ 1, which is
 *      exactly the existence condition of a prefix code; the canonical
 *      assignment realizes it, and `validatePrefixFree` re-verifies it
 *      defensively before anything is returned.
 *   4. Canonical assignment (RFC 1951 §3.2.2): count codes per length, then
 *      `code = 0; for len = 1..15: code = (code + count[len − 1]) << 1` gives
 *      the first codeword of each length, and symbols are stamped in
 *      ascending (length, symbol) order with the running first-code counter.
 *      Zero-frequency symbols get length 0 and are skipped.
 *
 * Bitstream (pinned): codewords are emitted MSB-first (RFC 1951 packs
 * Huffman codes starting with the most significant codeword bit) and the
 * final byte is padded with zero bits. Lengths never exceed 15 bits, so a
 * codeword always fits a plain u32.
 *
 * Reference: D. A. Huffman, "A Method for the Construction of
 * Minimum-Redundancy Codes", Proceedings of the IRE 40(9), 1952; RFC 1951
 * §3.2.2 "Use of Huffman codes in the 'deflate' format"; zlib `trees.c`
 * relates the practical length-limiting trade (this module pins its own
 * simplified one-level demotion repair, documented above).
 *
 * Complexity: O(n log n + n·L) per encode — O(n log n) for the tree/heap
 * builds (n ≤ 256 leaves here) and O(n·L) byte-by-byte bit packing with
 * L ≤ 15; decoding is O(n·L). Space O(n + L) beyond the fresh outputs.
 *
 * Edge cases: empty input → histogram of zeros → empty codebook (maxLength
 * 0) → encode returns `bitLength` 0 with zero bytes and an all-zero
 * codebook, and a decode of an empty stream returns empty output; a single
 * distinct byte encodes with a length-1 code ("0"); a uniform 256-symbol
 * histogram yields every length 8 and the packed stream is exactly as long
 * as the input; 0x00 and 0xFF are ordinary values; adversarial inputs
 * round-trip bit-exactly (the fingerprint of a correct Huffman codec).
 * Decoding never hangs: the walk is strictly bounded by the maximum code
 * length and the typed errors `RangeError("invalid huffman code")` (the
 * walk survived all lengths without reaching a leaf) and
 * `RangeError("truncated bitstream")` (bits ran out mid-symbol) fire
 * instead. Huffman streams are not self-authenticating: a corrupted middle
 * of a valid stream may decode silently into different bytes (documented;
 * the *checked* corruptions are truncation and divergent walks). Inputs
 * are never mutated and every call returns fresh arrays.
 */

/** Pinned maximum code length (RFC 1951 practice). */
const MAX_CODE_LENGTH = 15;

/** Byte alphabet of the codec: one histogram bin per byte value. */
const ALPHABET_SIZE = 256;

/** 2^15: the integer-scaled Kraft capacity of the code space. */
const KRAFT_CAPACITY = 1 << MAX_CODE_LENGTH;

/** Result of `buildCanonicalCodes`: the full canonical codebook. */
export interface CanonicalCodes {
  /** Code length per byte value; 0 = unused symbol. Never exceeds 15. */
  codeLengths: Uint8Array;
  /** Codeword, MSB-first value, per byte value (valid when length > 0). */
  codes: Uint32Array;
  /** Largest used code length; 0 for an all-zero histogram. */
  maxLength: number;
}

/** The only part of the codebook a decoder needs: 256 code lengths. */
export interface HuffmanCodebook {
  codeLengths: Uint8Array;
}

/** Result of `huffmanEncode`. */
export interface HuffmanEncoded {
  /** Packed codewords, MSB-first, last byte zero-padded. */
  bits: Uint8Array;
  /** Number of meaningful bits; the padding bits are excluded. */
  bitLength: number;
  /** The length table needed to decode the stream. */
  codebook: HuffmanCodebook;
}

function asUint8Array(value: unknown, caller: string, label: string): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError(`${caller}: ${label} must be a Uint8Array`);
  }
  return value;
}

function asUint32Array(value: unknown, caller: string, label: string): Uint32Array {
  if (!(value instanceof Uint32Array)) {
    throw new TypeError(`${caller}: ${label} must be a Uint32Array`);
  }
  return value;
}

/**
 * Count every byte value into a 256-bin histogram (fresh, zero-filled
 * allocation; the histogram starts at zero and the input is only read,
 * never mutated). Non-`Uint8Array` input → `TypeError`.
 */
export function buildHistogram(bytes: Uint8Array): Uint32Array {
  const input = asUint8Array(bytes, "buildHistogram", "bytes");
  const histogram = new Uint32Array(ALPHABET_SIZE);
  for (let index = 0; index < input.length; index += 1) {
    const bin = input[index] ?? 0;
    histogram[bin] = (histogram[bin] ?? 0) + 1;
  }
  return histogram;
}

/** One node of the Huffman forest during the merge phase. */
interface ForestNode {
  /** Total frequency of the subtree. */
  count: number;
  /** Smallest byte value in the subtree (unique across the forest). */
  minSymbol: number;
  /** Creation order; see the header tie-break discussion. */
  sequence: number;
  /** Child node indexes; -1 marks a leaf. */
  left: number;
  right: number;
}

/**
 * Array-based binary min-heap over forest-node indexes with the pinned
 * total order (count, minSymbol, sequence — all ascending; module header).
 */
class ForestHeap {
  private readonly nodes: ForestNode[];
  private readonly heap: number[] = [];

  constructor(nodes: ForestNode[]) {
    this.nodes = nodes;
  }

  push(nodeIndex: number): void {
    const heap = this.heap;
    heap.push(nodeIndex);
    let child = heap.length - 1;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      const parentNode = heap[parent];
      if (parentNode === undefined || this.before(parentNode, nodeIndex)) {
        break;
      }
      heap[child] = parentNode;
      heap[parent] = nodeIndex;
      child = parent;
    }
  }

  pop(): number {
    const heap = this.heap;
    const root = heap[0] ?? -1;
    const last = heap.pop() ?? root;
    const size = heap.length;
    if (size > 0) {
      heap[0] = last;
      let parent = 0;
      for (;;) {
        let smallest = parent;
        const smallestNode = heap[smallest] ?? -1;
        const leftIndex = 2 * parent + 1;
        const leftNode = heap[leftIndex] ?? -1;
        if (leftIndex < size && this.before(leftNode, smallestNode)) {
          smallest = leftIndex;
        }
        const rightIndex = leftIndex + 1;
        if (rightIndex < size && this.before(heap[rightIndex] ?? -1, heap[smallest] ?? -1)) {
          smallest = rightIndex;
        }
        if (smallest === parent) {
          break;
        }
        heap[parent] = heap[smallest] ?? -1;
        heap[smallest] = smallestNode;
        parent = smallest;
      }
    }
    return root;
  }

  get size(): number {
    return this.heap.length;
  }

  /** Pinned total order: is node `a` strictly before node `b`? */
  private before(a: number, b: number): boolean {
    const nodeA = this.nodes[a];
    const nodeB = this.nodes[b];
    if (nodeA === undefined || nodeB === undefined) {
      throw new RangeError("huffman forest node out of range (internal error)");
    }
    if (nodeA.count !== nodeB.count) {
      return nodeA.count < nodeB.count;
    }
    if (nodeA.minSymbol !== nodeB.minSymbol) {
      return nodeA.minSymbol < nodeB.minSymbol;
    }
    return nodeA.sequence < nodeB.sequence;
  }
}

/**
 * Compute the unrestricted Huffman leaf depths (one depth per
 * positive-frequency symbol), then apply the pinned length-limiting repair
 * so every stored depth is ≤ 15.
 */
function computeLengths(depths: Uint8Array, histogram: Uint32Array): void {
  // Leaves in symbol order carry sequences 0..k-1 (a deterministic base).
  const nodes: ForestNode[] = [];
  for (let symbol = 0; symbol < ALPHABET_SIZE; symbol += 1) {
    const count = histogram[symbol] ?? 0;
    if (count > 0) {
      nodes.push({ count, minSymbol: symbol, sequence: nodes.length, left: -1, right: -1 });
    }
  }
  const leafCount = nodes.length;
  if (leafCount === 0) {
    return; // empty codebook: all depths 0
  }
  if (leafCount === 1) {
    // R6 pin: a lone symbol still gets a decodable 1-bit code.
    const only = nodes[0]?.minSymbol;
    if (only !== undefined) {
      depths[only] = 1;
    }
    return;
  }
  const heap = new ForestHeap(nodes);
  for (let nodeIndex = 0; nodeIndex < leafCount; nodeIndex += 1) {
    heap.push(nodeIndex);
  }
  let sequence = leafCount;
  while (heap.size > 1) {
    const first = heap.pop();
    const second = heap.pop();
    const firstNode = nodes[first];
    const secondNode = nodes[second];
    if (firstNode === undefined || secondNode === undefined) {
      throw new RangeError("huffman forest node out of range (internal error)");
    }
    nodes.push({
      count: firstNode.count + secondNode.count,
      minSymbol: Math.min(firstNode.minSymbol, secondNode.minSymbol),
      sequence,
      left: first,
      right: second,
    });
    heap.push(nodes.length - 1);
    sequence += 1;
  }
  // Depth walk from the root (explicit stack; a leaf's depth = number of
  // merges above it). Two parallel stacks keep the parent/depth pairs.
  const stack: number[] = [nodes.length - 1];
  const stackDepths: number[] = [0];
  while (stack.length > 0) {
    const nodeIndex = stack.pop() ?? -1;
    const depth = stackDepths.pop() ?? 0;
    const node = nodes[nodeIndex];
    if (node === undefined) {
      continue;
    }
    if (node.left < 0) {
      depths[node.minSymbol] = depth;
      continue;
    }
    stack.push(node.left, node.right);
    stackDepths.push(depth + 1, depth + 1);
  }
  limitLengths(depths);
}

/**
 * Pinned length-limiting repair (exact procedure in the module header):
 * clamp depths at 15, compute the integer Kraft sum K = Σ 2^(15 − l), then
 * demote the smallest symbol of the deepest non-maximal length one level
 * per step until K ≤ 2^15.
 */
function limitLengths(depths: Uint8Array): void {
  const counts = new Uint32Array(MAX_CODE_LENGTH + 1);
  let kraftSum = 0;
  let clamped = false;
  for (let symbol = 0; symbol < ALPHABET_SIZE; symbol += 1) {
    const depth = depths[symbol] ?? 0;
    if (depth === 0) {
      continue;
    }
    if (depth > MAX_CODE_LENGTH) {
      depths[symbol] = MAX_CODE_LENGTH;
      counts[MAX_CODE_LENGTH] = (counts[MAX_CODE_LENGTH] ?? 0) + 1;
      kraftSum += 1;
      clamped = true;
      continue;
    }
    counts[depth] = (counts[depth] ?? 0) + 1;
    kraftSum += 1 << (MAX_CODE_LENGTH - depth);
  }
  if (!clamped) {
    return; // true Huffman depths: Kraft holds by construction
  }
  while (kraftSum > KRAFT_CAPACITY) {
    // Largest non-maximal length holding a code; existence proved in the
    // module header (while K overflows, some code sits at length ≤ 14 and
    // keeps its own, un-clamped length). Bounded so a broken invariant can
    // never loop past the bottom of the table.
    let length = MAX_CODE_LENGTH - 1;
    while (length > 1 && (counts[length] ?? 0) === 0) {
      length -= 1;
    }
    // Deterministic choice: the SMALLEST symbol currently at `length`.
    let target = -1;
    for (let symbol = 0; symbol < ALPHABET_SIZE; symbol += 1) {
      if ((depths[symbol] ?? 0) === length) {
        target = symbol;
        break;
      }
    }
    if (target < 0 || (counts[length] ?? 0) === 0) {
      throw new RangeError("huffman length repair lost a code (internal error)");
    }
    depths[target] = length + 1;
    counts[length] = (counts[length] ?? 0) - 1;
    counts[length + 1] = (counts[length + 1] ?? 0) + 1;
    kraftSum -= 1 << (MAX_CODE_LENGTH - 1 - length);
  }
}

/**
 * Build the canonical codebook of a 256-bin byte histogram (RFC 1951 §3.2.2;
 * pinned construction in the module header). Returns the full length table,
 * the codewords and the maximum length. Guards: a non-`Uint32Array` input
 * rejects with `TypeError`, a histogram whose length differs from 256 with
 * `RangeError` (R14). The histogram is only read, never mutated.
 */
export function buildCanonicalCodes(histogram: Uint32Array): CanonicalCodes {
  const counts = asUint32Array(histogram, "buildCanonicalCodes", "histogram");
  if (counts.length !== ALPHABET_SIZE) {
    throw new RangeError(`buildCanonicalCodes: histogram must have ${ALPHABET_SIZE} bins`);
  }
  const codeLengths = new Uint8Array(ALPHABET_SIZE);
  computeLengths(codeLengths, counts);
  return assignCanonicalCodes(codeLengths);
}

/**
 * RFC 1951 §3.2.2 canonical assignment from a valid length multiset:
 * accumulating first codes per length, then stamping symbols in ascending
 * (length, symbol) order.
 */
function assignCanonicalCodes(codeLengths: Uint8Array): CanonicalCodes {
  const counts = new Uint32Array(MAX_CODE_LENGTH + 1);
  let maxLength = 0;
  for (let symbol = 0; symbol < ALPHABET_SIZE; symbol += 1) {
    const length = codeLengths[symbol] ?? 0;
    if (length > 0) {
      counts[length] = (counts[length] ?? 0) + 1;
      if (length > maxLength) {
        maxLength = length;
      }
    }
  }
  const firstCodes = new Uint32Array(MAX_CODE_LENGTH + 1);
  let code = 0;
  for (let length = 1; length <= MAX_CODE_LENGTH; length += 1) {
    code = (code + (counts[length - 1] ?? 0)) << 1;
    firstCodes[length] = code;
  }
  const codes = new Uint32Array(ALPHABET_SIZE);
  for (let length = 1; length <= maxLength; length += 1) {
    for (let symbol = 0; symbol < ALPHABET_SIZE; symbol += 1) {
      if ((codeLengths[symbol] ?? 0) === length) {
        codes[symbol] = firstCodes[length] ?? 0;
        firstCodes[length] = (firstCodes[length] ?? 0) + 1;
      }
    }
  }
  // Defensive contract check (R6): the produced length table must describe a
  // canonical prefix code. The pinned construction guarantees it; this check
  // keeps any future change of the procedures from shipping an invalid book.
  if (!validatePrefixFree(codeLengths)) {
    throw new RangeError("buildCanonicalCodes: non-prefix-free length table (internal error)");
  }
  return { codeLengths, codes, maxLength };
}

/**
 * Encode a byte stream with the canonical codebook derived from its own
 * histogram (self-contained; no shared state). Returns the MSB-first
 * bitstream packed into bytes (last byte zero-padded), the exact bit length
 * and the length table. Empty input → `bitLength` 0 with an empty bit array
 * and an all-zero codebook. Non-`Uint8Array` → `TypeError`. Encoding the
 * same input twice yields byte-identical output (Review Focus 2).
 */
export function huffmanEncode(bytes: Uint8Array): HuffmanEncoded {
  const input = asUint8Array(bytes, "huffmanEncode", "bytes");
  const codebook = buildCanonicalCodes(buildHistogram(input));
  const { codeLengths, codes } = codebook;
  let totalBits = 0;
  for (let index = 0; index < input.length; index += 1) {
    totalBits += codeLengths[input[index] ?? 0] ?? 0;
  }
  const bits = new Uint8Array((totalBits + 7) >> 3);
  let bitCursor = 0;
  for (let index = 0; index < input.length; index += 1) {
    const symbol = input[index] ?? 0;
    const code = codes[symbol] ?? 0;
    const length = codeLengths[symbol] ?? 0;
    // MSB-first: from the most significant codeword bit down.
    for (let bitIndex = length - 1; bitIndex >= 0; bitIndex -= 1) {
      if (((code >> bitIndex) & 1) === 1) {
        const byte = bits[bitCursor >> 3] ?? 0;
        bits[bitCursor >> 3] = byte | (0x80 >> (bitCursor & 7));
      }
      bitCursor += 1;
    }
  }
  return {
    bits,
    bitLength: totalBits,
    codebook: { codeLengths: codebook.codeLengths },
  };
}

/**
 * Decode a Huffman bitstream produced by `huffmanEncode` with the same code
 * book. `bitLength` is the meaningful bit count (padding bits excluded) and
 * must be held by `bits`. The pinned table walk (RFC 1951 decode order)
 * resolves one codeword at a time; a walk that survives the maximum code
 * length without reaching a leaf throws `RangeError("invalid huffman
 * code")`, bits running out mid-symbol throw `RangeError("truncated
 * bitstream")`. Empty stream (`bitLength` 0) decodes to an empty output.
 * A codebook that is not prefix-free (corrupted length table) rejects with
 * `RangeError("invalid huffman codebook")` before any walk. Guards:
 * non-`Uint8Array` bit arrays / codebooks → `TypeError`; non-integer or
 * negative `bitLength`, or one longer than the buffer holds (which is
 * exactly a truncated stream) → `RangeError`. The walk is bounded, so
 * decoding can never hang; inputs are never mutated.
 */
export function huffmanDecode(
  bits: Uint8Array,
  bitLength: number,
  codebook: HuffmanCodebook,
): Uint8Array {
  const input = asUint8Array(bits, "huffmanDecode", "bits");
  const lengths = asUint8Array(codebook?.codeLengths, "huffmanDecode", "codebook.codeLengths");
  if (!Number.isInteger(bitLength) || bitLength < 0) {
    throw new RangeError("huffmanDecode: bitLength must be a non-negative integer");
  }
  if (lengths.length !== ALPHABET_SIZE) {
    throw new RangeError(`huffmanDecode: codebook.codeLengths must have ${ALPHABET_SIZE} entries`);
  }
  if (bitLength > input.length * 8) {
    throw new RangeError("truncated bitstream");
  }
  if (!validatePrefixFree(lengths)) {
    throw new RangeError("invalid huffman codebook");
  }
  if (bitLength === 0) {
    return new Uint8Array(0);
  }
  // Canonical decode tables: counts per length and the symbol table in
  // ascending (length, symbol) order — the same order the encoder stamps
  // codewords with, so the walk indexes match the assignment exactly.
  const counts = new Uint32Array(MAX_CODE_LENGTH + 1);
  let maxLength = 0;
  for (let symbol = 0; symbol < ALPHABET_SIZE; symbol += 1) {
    const length = lengths[symbol] ?? 0;
    if (length > 0) {
      counts[length] = (counts[length] ?? 0) + 1;
      if (length > maxLength) {
        maxLength = length;
      }
    }
  }
  const symbolTable = new Uint8Array(ALPHABET_SIZE);
  let rank = 0;
  for (let length = 1; length <= maxLength; length += 1) {
    for (let symbol = 0; symbol < ALPHABET_SIZE; symbol += 1) {
      if ((lengths[symbol] ?? 0) === length) {
        symbolTable[rank] = symbol;
        rank += 1;
      }
    }
  }
  // Every codeword is at least 1 bit, so the output can never exceed the
  // declared bit length; one over-allocation, then return the exact slice.
  const decoded = new Uint8Array(bitLength);
  let written = 0;
  let bitPosition = 0;
  while (bitPosition < bitLength) {
    let code = 0;
    let first = 0;
    let index = 0;
    let symbol = -1;
    for (let length = 1; length <= maxLength; length += 1) {
      const bit = readBit(input, bitPosition, bitLength);
      bitPosition += 1;
      code = (code << 1) | bit;
      const count = counts[length] ?? 0;
      if (code - first < count) {
        symbol = symbolTable[index + (code - first)] ?? -1;
        break;
      }
      index += count;
      first = (first + count) << 1;
    }
    if (symbol < 0) {
      // The walk survived every length without reaching a leaf.
      throw new RangeError("invalid huffman code");
    }
    decoded[written] = symbol;
    written += 1;
  }
  return decoded.slice(0, written);
}

/** Read one declared bit of the stream; exhausted → truncated bitstream. */
function readBit(bits: Uint8Array, bitPosition: number, bitLength: number): number {
  if (bitPosition >= bitLength) {
    throw new RangeError("truncated bitstream");
  }
  const byte = bits[bitPosition >> 3] ?? 0;
  return (byte >> (7 - (bitPosition & 7))) & 1;
}

/**
 * Validate that a code-length table describes a prefix-free (decodable)
 * canonical code — the shared guard of the builder, the decoder and the
 * tests. Length-0 entries (unused symbols) are ignored; an all-zero table
 * is vacuously prefix-free. Non-`Uint8Array` input → `TypeError`.
 *
 * Two exact checks, both demanded by the plan:
 *   1. Kraft inequality Σ 2^(−l) ≤ 1, evaluated with BigInt at the scale of
 *      the largest length, so every length a u8 can hold (0..255) is decided
 *      without rounding;
 *   2. canonical walk verification: the RFC 1951 assignment is simulated in
 *      (length, symbol) order and every stamped codeword must fit inside
 *      its own length and never collide with an earlier one — the literal
 *      decodability proof. Kraft ≤ 1 is the existence theorem for a prefix
 *      code; the walk verifies that the canonical construction realizes it.
 */
export function validatePrefixFree(codeLengths: Uint8Array): boolean {
  const lengths = asUint8Array(codeLengths, "validatePrefixFree", "codeLengths");
  let maxLength = 0;
  const counts: number[] = new Array<number>(256).fill(0);
  for (let symbol = 0; symbol < lengths.length; symbol += 1) {
    const length = lengths[symbol] ?? 0;
    if (length === 0) {
      continue;
    }
    counts[length] = (counts[length] ?? 0) + 1;
    if (length > maxLength) {
      maxLength = length;
    }
  }
  if (maxLength === 0) {
    return true; // no codes at all
  }
  // (1) Kraft Σ 2^(−l) ≤ 1, exact: scale every term up by 2^maxLength.
  let kraftSum = 0n;
  for (let length = 1; length <= maxLength; length += 1) {
    kraftSum += BigInt(counts[length] ?? 0) << BigInt(maxLength - length);
  }
  if (kraftSum > 1n << BigInt(maxLength)) {
    return false;
  }
  // (2) Canonical walk in (length, symbol) order; `code = −1` convention
  // makes the first codeword of every length the all-zero word.
  let code = -1n;
  let previousLength = 0;
  for (let length = 1; length <= maxLength; length += 1) {
    for (let symbol = 0; symbol < lengths.length; symbol += 1) {
      if ((lengths[symbol] ?? 0) !== length) {
        continue;
      }
      // Canonical stepping: add one slot, shift up when the length grows.
      code = (code + 1n) << BigInt(length - previousLength);
      if (code > (1n << BigInt(length)) - 1n) {
        return false;
      }
      previousLength = length;
    }
  }
  return true;
}
