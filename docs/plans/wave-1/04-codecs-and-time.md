# Wave 1 · Plan 04 — Lossless codecs, MDCT toy codec, phase vocoder

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Compression lab core: RLE, canonical Huffman, delta+Huffman predictor, entropy utilities; the MDCT-based toy lossy codec with adjustable rate; and the phase vocoder for time-stretch/pitch-shift.

**Architecture:** Pure TS in `packages/dsp/src/codecs/` and `packages/dsp/src/timestretch/`. Lossless codecs operate on `Uint8Array`/`Int16Array` symbol streams — the UI layer (wave 4) converts audio to symbol streams; Wave 1 pins the byte-level formats in ALGORITHMS.md. MDCT consumes plan 01 FFT; phase vocoder consumes plan 01 STFT/ISTFT and plan 02 resampling. `entropyBitsPerSymbol` lives in `src/metrics/entropy.ts` (plan 02 T5) and is imported here — do not duplicate it.

**Tech Stack:** TypeScript strict; vitest; SciPy `fft.dct` golden for MDCT derivation.

**Spec:** `AGENTS.md` §11 + F04/F06/F08 + wave-0 Global Constraints + plan 01 Global Constraints.

## Review Focus

1. **Bit-exact round-trip is the product** — every lossless codec must round-trip bit-exact on adversarial inputs (all-same bytes, alternating, 0x00/0xFF edges, single byte, long runs > 65535), not only on friendly sine-quantized data; the "bit-exact ✓/✗" UI (wave 4) depends on this contract.
2. **Canonical Huffman determinism** — code assignment must be deterministic for identical histograms (sort by length then symbol value, documented); two encodes of the same input produce identical bitstreams; decode rejects corrupted/truncated bitstreams with a typed error instead of hanging or returning garbage.
3. **MDCT perfect reconstruction on random data** — TDAC reconstruction must be ≤1e-10 for seeded random input, not just for sines (sines hide window-sum errors); the golden vs SciPy DCT-IV construction is a second independent check.
4. **Phase-vocoder pitch preservation** — the test must prove the odd/even-frame phase-locking intent by bin: for a pure sine stretched 2×, the dominant bin equals the original within ±1 bin and the energy leaks ≤ −20 dB into neighboring bins (a naive phase-advance without deviation-wrapping fails).

---
### Task 1: RLE codec

**Files:** Create `packages/dsp/src/codecs/rle.ts`, golden `algorithms/rle.py` → `golden/rle.json`, test `packages/dsp/test/codecs/rle.test.ts`; ALGORITHMS.md entry (byte-level format pinned below).

**Interfaces:**
- `rleEncode(bytes: Uint8Array): Uint8Array`; `rleDecode(encoded: Uint8Array): Uint8Array`
- Pinned format: sequence of records `[value: u8][count: u16 little-endian, 1..65535]`; runs longer than 65535 split into multiple records; empty input → empty output
- `rleDecode` throws `RangeError("truncated rle stream")` on odd/truncated tails; count 0 → `RangeError("invalid rle count 0")` (format is NOT self-delimiting by design — documented)

**Golden cases (Python reference implementing the pinned format):** empty; single byte; 70000 identical bytes (forces split); alternating 0x00/0xFF ×100; ramp 0..255; seeded random with runs. Byte-exact equality both directions.

**Tests:** goldens; round-trip property on adversarial set: all-zero 1e5, alternating, random(seed 7, 1e4) — bit-exact; compression sanity: runs-heavy input smaller than input, random input larger (documented as expected, RLE on noise expands).

- [ ] Commit `feat(F04): rle codec with pinned byte format and adversarial round-trips`

### Task 2: Canonical Huffman codec

**Files:** Create `packages/dsp/src/codecs/huffman.ts`, test `packages/dsp/test/codecs/huffman.test.ts` (goldens: known textbook cases encoded in-test, no cross-language fixture — dual-implementation risk avoided by pinning the canonical algorithm + published test vectors); ALGORITHMS.md entry (RFC 1951 §3.2.2 canonical codes).

**Interfaces:**
- `buildHistogram(bytes: Uint8Array): Uint32Array` (256 bins)
- `buildCanonicalCodes(histogram: Uint32Array): { codeLengths: Uint8Array; codes: Uint32Array; maxLength: number }` — Huffman tree by min-heap (tie-break: smaller symbol, then insertion order — documented), lengths from tree depths, then canonical assignment (sort by length then symbol); 0-frequency symbols get length 0; **max code length ≤ 15 enforced** with a documented fallback (length-limiting via sorting long codes up one level, RFC-style, exact procedure in header)
- `huffmanEncode(bytes: Uint8Array): { bits: Uint8Array; bitLength: number; codebook: { codeLengths: Uint8Array } }` — MSB-first packing, pad last byte with zeros
- `huffmanDecode(bits: Uint8Array, bitLength: number, codebook): Uint8Array` — throws `RangeError("invalid huffman code")` on a code path that walks past maxLength, `RangeError("truncated bitstream")` when bits run out mid-symbol
- `validatePrefixFree(codeLengths: Uint8Array): boolean` — Kraft check + walk verification

**Tests:** empty input; single symbol (length 1 code); "abracadabra" histogram → codeLengths match the hand-computed canonical lengths in-test; prefix-free true for all builds; round-trip bit-exact for adversarial byte sets (from T1 list); average bits/symbol < entropy + 1 (property, random seeds); encode twice → identical output bytes; truncated stream → throws, does not hang; ALL-256-symbol uniform histogram → all lengths 8, stream size == input size + padding.

- [ ] Commit `feat(F04): canonical huffman codec with prefix-free validation`

### Task 3: Delta predictor + Huffman (FLAC-like)

**Files:** Create `packages/dsp/src/codecs/delta.ts`, test `packages/dsp/test/codecs/delta.test.ts`; ALGORITHMS.md entry (first-order predictor, wrapping arithmetic).

**Interfaces:**
- `deltaEncode(samples: Int16Array): Int16Array` — first sample raw; then `x[n] − x[n−1]` in **wrapping Int16 arithmetic** (documented; exactly reversible)
- `deltaDecode(residuals: Int16Array): Int16Array` — wrapping cumulative sum
- `encodeLosslessDeltaHuffman(samples: Int16Array): { payload: Uint8Array; bitLength: number; codebook; stats: { bitsPerSample: number; entropyBitsPerSymbol: number } }` — maps residuals (−32768..32767) to unsigned bytes space by zigzag → 16-bit little-endian symbol pairs? NO — pinned: residuals cast to unsigned via `(r & 0xFFFF)`, split into two byte streams (low byte, high byte) internally, each Huffman-coded, merged stream records order — **exact interleave procedure documented in header + ALGORITHMS.md** (this is the FLAC idea simplified: separate coding of high/low bytes exploits correlation)
- `decodeLosslessDeltaHuffman(...)` inverse
- `stats.bitsPerSample = bitLength / sampleCount`; entropy uses plan-02 `entropyBitsPerSymbol`

**Tests:** round-trip bit-exact for: quantized sine (from plan-02 T6 output), silence, full-scale square (+/−32767 alternation), seeded random Int16, single sample, empty; `bitsPerSample` of sine < bitsPerSample of random (compression ordering property); delta of stationary ramp compresses better than delta of alternating (sanity).

- [ ] Commit `feat(F04): delta predictor with huffman coding in flac style`

### Task 4: MDCT with TDAC

**Files:** Create `packages/dsp/src/timestretch/mdct.ts`, golden `algorithms/mdct.py` → `golden/mdct.json`, test `packages/dsp/test/timestretch/mdct.test.ts`; ALGORITHMS.md entry (formulas both directions, TDAC principle, reference: Princen & Bradley 1986).

**Interfaces:**
- `mdct(x: Float64Array, { frameLengthSamples: number }): { coefficients: Float64Array[]; frameLengthSamples: number; hopLengthSamples: number }` — hop = frame/2 fixed; window applied internally: `w[n] = sin(π/N · (n + 0.5))` for n=0..2N−1 with 2N = frameLengthSamples; coefficient count = N per frame; frames = ceil(len/(N))? — pinned: number of frames = ceil(sampleCount / hop) with final frame zero-padded, frame i starts at i·hop
- `imdct(frames, { frameLengthSamples }): Float64Array` — TDAC overlap-add, output length = frameCount·hop (documented; caller trims to original length)
- Expose `mdctMatrix`? NO — keep only the two functions; the golden script documents the DCT-IV equivalence: MDCT of 2N samples = DCT-IV(2N) of windowed input restricted per the standard derivation.

**Golden cases (SciPy `fft.dct(x_win, type=4)` per the documented derivation):** sine 440 fs 48k frame 512; DC frame; impulse at sample 0 and sample 255 (window-asymmetric probes); seeded random frames. Tolerance rtol 1e-9.

**Tests:** goldens; perfect reconstruction: `imdct(mdct(x))[:N_total]≈x` ≤1e-10 for seeded random x, length 4096 (NOT multiple of frame — tail path); frame 2N=4 minimum; empty input → empty; single frame exact-length input.

- [ ] Commit `feat(F04): mdct and imdct with tdac perfect reconstruction`

### Task 5: MDCT toy lossy codec (adjustable rate)

**Files:** Create `packages/dsp/src/codecs/mdctCodec.ts`, test `packages/dsp/test/codecs/mdctCodec.test.ts`; ALGORITHMS.md entry (rate model formula pinned below; psychoacoustic masking deliberately NOT included — hook documented for wave 5 F13).

**Interfaces:**
- `encodeMdctCodec(audio: Float64Array, { frameLengthSamples: number; bitsPerSecond: number }): { encodedCoefficients: Int16Array[]; frameLengthSamples: number; coefficientsPerFrame: number; stats: { bitsTotal: number; bitsPerSample: number; bitrateKbps: number; nonZeroFraction: number; entropyBitsPerCoefficient: number } }`
  - Rate model (pinned, documented): per-frame bit budget `B = bitsPerSecond · hop / sampleRateHz` — wait, encode has no sampleRateHz: signature is `encodeMdctCodec(audio, { frameLengthSamples, bitsPerSecond, sampleRateHz })`. Per-frame budget in bits; coefficient quantizer step chosen from the frame's RMS and the budget via a documented two-pass: step = RMS·2^{(E − B)/N} with energy split uniform across N coefficients (this is the adjustable quantizer; exact formula in ALGORITHMS.md — implementer must copy it from the formula, not reinvent)
  - Quantized indices stored as Int16Array per frame (in-memory representation for Wave 1; byte serialization deferred to wave 4 — documented)
- `decodeMdctCodec(encoded, { sampleRateHz }): { samples: Float64Array; stats: { bitsTotal, bitsPerSample, bitrateKbps } }` — inverse quantize + imdct + trim
- Huffman: entropy of quantized indices reported in stats (actual Huffman bit length via plan-04 T2 on the zigzag indices — reuse, do not reimplement)

**Tests:** duration preserved ±1 hop; bitrate approximation within ±20% of requested (rate model rounding); rate–distortion monotonicity: for bitsPerSecond ∈ {32k, 96k, 256k} on a 5 s speech-like signal (sum of 3 sines + seeded noise), SNR(32k) < SNR(96k) < SNR(256k), each gap ≥ 3 dB; silence input → near-zero bits (nonZeroFraction < 0.01); stats consistency (bitsTotal/bitrateKbps arithmetic); non-vocoder path: `nonZeroFraction` decreases as bitsPerSecond decreases.

- [ ] Commit `feat(F04): mdct toy codec with adjustable bit budget and rd monotonicity`

### Task 6: Phase vocoder — time-stretch and pitch-shift

**Files:** Create `packages/dsp/src/timestretch/phaseVocoder.ts`, test `packages/dsp/test/timestretch/phaseVocoder.test.ts` (property-based; NO golden vs librosa — different internal conventions documented in ALGORITHMS.md); ALGORITHMS.md entry (phase propagation: expected advance per bin + wrapped deviation; reference: Dolson 1986; window hann 75% overlap pinned).

**Interfaces:**
- `timeStretch(x: Float64Array, { stretchFactor: number; windowLengthSamples: number; }): Float64Array` — stretchFactor > 0; pinned: hann window, analysis hop = window/4, synthesis hop = analysisHop · stretchFactor (rounded to integer, documented rounding); phase-locked to bin (per-bin phase advance uses the bin's expected advance, deviation wrapped into [−π, π]); output length ≈ input · factor
- `pitchShift(x: Float64Array, { semitones: number; windowLengthSamples: number; sampleRateHz: number }): Float64Array` — = timeStretch by 2^(−semitones/12) then resample (plan-02 T7, filter "kaiserSinc") back to original rate; output length = input ±1%

**Tests:** factor 1.0 → identity ≤1e-6 (rounding tolerance); factor 2.0 → length ±1 sample region; sine 440 Hz 2 s at fs 48k stretched 2× → dominant FFT bin == original bin (±1 bin) and neighbor bins ≤ −20 dB (Review Focus 4); chirp stretched keeps instantaneous-frequency trajectory (compare FFT peak track coarse); pitchShift +12 → dominant peak doubles ±2%, duration unchanged ±1%; pitchShift 0 → identity-ish; noise input doesn't explode (finite, bounded by 10× input RMS); empty input → empty.

- [ ] Commit `feat(F06): phase vocoder time-stretch and pitch-shift`
