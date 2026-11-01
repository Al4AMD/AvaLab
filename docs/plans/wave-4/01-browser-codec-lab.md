# Wave 4 · Plan 01 — Browser compression lab (F04 browser half)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/tools/codec-lab` lab encodes the selected excerpt with RLE,
canonical Huffman, delta+Huffman, μ-law, A-law, or the MDCT toy codec in the
browser worker. It shows compressed size, bits/sample, bitrate, compression
ratio, entropy, encode/decode time, bit-exact status, the byte histogram,
Huffman code lengths, and MDCT coefficient sparsity; the decoded audio plays
through the existing processed lane.

**Architecture:** All codecs already exist in `packages/dsp`. This plan adds
one pure PCM/WAV helper module and one worker op (`codecLabProcess`) that
converts the source excerpt to the 16-bit PCM grid, runs the chosen codec,
decodes it, and returns a Float32 payload plus teaching statistics. The view
is a thin state + presentation layer over that op. Real ffmpeg codecs are
Plan 02/03; this plan must work with the backend offline.

**Tech Stack:** As Wave 3. New deps: none.

**Spec:** `AGENTS.md` F04, §9, §11; `docs/DECISIONS.md` D-026, D-028.

## Global Constraints

- All DSP runs in the worker. No codec work on the main thread.
- Every hand-written codec consumes the **16-bit PCM grid**:
  `pcm16 = floatToInt16Pcm(excerpt)`, `reference = int16PcmToFloat(pcm16)`.
  Lossy metrics compare decoded audio to `reference`.
- Lossless bit-exact means `decodedInt16` equals `pcm16` exactly. μ-law,
  A-law, and MDCT are never bit-exact.
- The MDCT stream size includes its required container overhead: 256 code
  length bytes plus 8 bytes per frame step. This is the teaching size, not
  just the Huffman payload.
- Excerpt cap is 30 s. The lab has an explicit **Encode** action; it does not
  re-encode on every slider tick.
- All strings through i18n; fa machine-drafted + flagged.
- `pnpm check` + `pnpm e2e` green; both locales; zero console errors.

## Review Focus

1. **Lossless round-trip is real** — RLE, Huffman, and delta+Huffman must
   report `bitExact: true` and decode to the exact Int16 reference, including
   clipping edges (`-1`, `+1`, silence).
2. **Statistics arithmetic is consistent** — `originalBytes = 2·N`,
   `compressedSizeBytes` is the actual teaching stream size,
   `bitsPerSample = 8·compressedSizeBytes/N`,
   `bitrateKbps = 8·compressedSizeBytes/(durationSeconds·1000)`, and
   `compressionRatio = originalBytes/compressedSizeBytes`.
3. **MDCT decode is trimmed** — `decodeMdct` returns
   `(frameCount−1)·hop` samples; the op trims to the original `N` before
   metrics and playback.
4. **Teaching internals are visible** — histogram has 256 bins, Huffman code
   lengths are the actual codebook, MDCT sparsity is the zero-coefficient
   fraction, and non-applicable tables are hidden rather than shown as zeros.
5. **Offline lab is honest** — with no backend, all hand-written codecs work
   and the real-codec panel (Plan 03) is visibly disabled.

---

### Task 1: PCM and WAV helpers

**Files:**
- Create: `packages/dsp/src/codecs/pcmWav.ts`
- Modify: `packages/dsp/src/index.ts`
- Create: `packages/dsp/test/codecs/pcmWav.test.ts`
- Modify: `docs/ALGORITHMS.md`

**Interfaces:**
- `export function floatToInt16Pcm(samples: Float32Array | Float64Array): Int16Array`
  - Reject non-finite samples with `TypeError`.
  - Clip to `[-1, 1]`; negative maps with `Math.round(sample * 32768)`,
    non-negative with `Math.round(sample * 32767)`. `-1 → -32768`,
    `+1 → 32767`, `0 → 0`.
- `export function int16PcmToFloat(samples: Int16Array): Float32Array`
  - `sample / 32768`; fresh array; input never mutated.
- `export function int16PcmToBytes(samples: Int16Array): Uint8Array`
  - Little-endian pairs, length `2·N`; fresh array.
- `export function bytesToInt16Pcm(bytes: Uint8Array): Int16Array`
  - Little-endian pairs; odd length → `RangeError("bytesToInt16Pcm: odd byte length")`.
- `export interface WavPcm16Options { sampleRateHz: number }`
- `export function encodeWavPcm16(samples: Float32Array, options: WavPcm16Options): Uint8Array`
  - Mono, 16-bit PCM, 44-byte canonical header.
  - `RIFF` size `36 + 2·N`; `WAVE`; `fmt ` size 16; audio format 1;
    channels 1; sample rate; byte rate `sampleRateHz·2`; block align 2;
    bits per sample 16; `data` size `2·N`.
  - `sampleRateHz` must be a positive integer ≤ 192000; else `RangeError`.
  - Empty input returns a valid 44-byte header.

- [ ] **Step 1: Write failing tests** for the conversion table
  (`-1, -0.5, 0, 0.5, +1`, clipping `±2`), odd-byte rejection, empty WAV
  header fields, a 3-sample WAV parsed with `DataView` (tag, sizes, rate,
  sample bytes), and no-mutation.
- [ ] **Step 2: Run** `pnpm --filter @avalab/dsp test -- pcmWav` — expected FAIL.
- [ ] **Step 3: Implement** the helpers and export them from
  `packages/dsp/src/index.ts`.
- [ ] **Step 4: Run** the test — expected PASS; add the `ALGORITHMS` row
  (formulas, clipping, WAV layout, endianness).
- [ ] **Step 5: Commit** `feat(F04): add pcm16 and wav helpers`.

### Task 2: Worker op `codecLabProcess`

**Files:**
- Modify: `apps/web/src/session/ops.ts`
- Modify: `apps/web/src/session/ops.test.ts`
- Modify: `apps/web/src/workers/dsp.worker.ts`

**Interfaces:**
- `export type CodecLabCodec = "rle" | "huffman" | "deltaHuffman" | "mulaw" | "alaw" | "mdct";`
- `export type CodecLabParams = { codec: CodecLabCodec; sampleRateHz: number; startSample: number; endSample: number; mdctBitsPerSecond: number; };`
- `export type CodecLabMeta = { codec; sampleCount; sampleRateHz; startSample; endSample; originalBytes; compressedSizeBytes; bitsPerSample; bitrateKbps; compressionRatio; entropyBitsPerSymbol; encodeMs; decodeMs; bitExact; mse; snrDb; segmentalSnrDb; psnrDb; histogram: number[]; codeLengths: number[]; coefficientSparsity: number | null; frameCount: number | null; bitsTotal: number | null; };`
- `export type CodecLabResult = { meta: CodecLabMeta; payload?: TransferablePayload };`
- Handler:
  1. Validate params: known codec, `sampleRateHz` finite in `(0, 96000]`,
     integer `startSample >= 0`, `endSample >= startSample`,
     `mdctBitsPerSecond` finite in `[8000, 512000]`, payload Float32-aligned.
  2. Read source Float32 payload. Reject empty selection with `badParams`.
     Cap the selection at 30 s (`30·sampleRateHz`); the view slices, but the
     handler enforces the cap too.
  3. Convert to Int16 and reference Float32 with the Task 1 helpers.
  4. Dispatch:
     - `rle`: `bytes = int16PcmToBytes(pcm16)`;
       `encoded = rleEncode(bytes)`; `decodedBytes = rleDecode(encoded)`;
       `decodedInt16 = bytesToInt16Pcm(decodedBytes)`;
       `compressedSizeBytes = encoded.length`;
       `entropyBitsPerSymbol(entropySource = bytes)`;
       `bitsTotal = encoded.length*8`.
     - `huffman`: `encoded = huffmanEncode(bytes)`;
       `decoded = huffmanDecode(encoded.bits, encoded.bitLength, encoded.codebook)`;
       `compressedSizeBytes = ceil(bitLength/8) + 256`;
       `bitsTotal = encoded.bitLength`;
       `codeLengths = Array.from(encoded.codebook.codeLengths)`.
     - `deltaHuffman`: `encoded = encodeLosslessDeltaHuffman(pcm16)`;
       `decodedInt16 = decodeLosslessDeltaHuffman(encoded.payload)`;
       `compressedSizeBytes = encoded.payload.length`;
       `bitsTotal = encoded.bitLength`;
       `entropyBitsPerSymbol = encoded.stats.entropyBitsPerSymbol`;
       `codeLengths = Array.from(encoded.codebook.codeLengths)`.
     - `mulaw` / `alaw`: encode `Float64Array.from(reference)` with
       `{bits: 8}`; decode; `compressedSizeBytes = bytes.length`;
       `bitsTotal = bytes.length*8`; entropy of the companded bytes.
     - `mdct`: `encoded = encodeMdct(Float32Array.from(reference), {sampleRateHz, frameLengthSamples: 512, bitsPerSecond: mdctBitsPerSecond})`;
       `decoded = decodeMdct(encoded, {sampleRateHz, frameLengthSamples: 512})`;
       trim `decoded` to `N`;
       `compressedSizeBytes = encoded.stats.compressedSizeBytes + 256 + encoded.steps.length*8`;
       `bitsTotal = encoded.bitsTotal`;
       `frameCount = encoded.coefficients.length`;
       `coefficientSparsity = zeros / (frameCount*hop)`;
       `codeLengths = Array.from(encoded.codebook.codeLengths)`;
       entropy source = flattened quantized coefficients as `Int32Array`.
  5. Lossless `bitExact = int16 arrays equal`; lossy `bitExact = false`.
  6. Metrics: `mse`, `snrDb`, `segmentalSnrDb` with
     `frameLengthSamples = round(0.02·sampleRateHz)`, `psnrDb({peak: 1})`
     comparing decoded Float32 to `reference`. For lossless decoded =
     `int16PcmToFloat(decodedInt16)`; for lossy decoded is the codec output.
  7. `histogram` = 256-bin histogram of `int16PcmToBytes(pcm16)` for every
     codec. `encodeMs`/`decodeMs` use `performance.now()` around the codec
     call only.
  8. Payload = decoded Float32 samples (`N` floats).

- [ ] **Step 1: Write failing op tests** for:
  - RLE/Huffman/delta on a sine: `bitExact: true`, payload length `N`,
    decoded samples equal `int16PcmToFloat(pcm16)`.
  - μ-law/A-law/MDCT: `bitExact: false`; MDCT payload length exactly `N`.
  - Stats arithmetic for RLE: `originalBytes = 2N`,
    `bitsPerSample = 8·compressedSizeBytes/N`, `bitrateKbps` formula.
  - Histogram sums to `2N`; Huffman `codeLengths.length === 256`;
    MDCT `coefficientSparsity` in `[0, 1]` and `frameCount > 0`.
  - Empty selection, bad codec, bad bitrate, unaligned payload → `badParams`.
  - 30 s cap: a 31 s payload is capped or rejected; pin one behavior
    (reject is simpler and matches the view cap).
- [ ] **Step 2: Run** `pnpm --filter @avalab/web test -- ops.test` — expected FAIL.
- [ ] **Step 3: Implement** the handler + worker case.
- [ ] **Step 4: Run** the test — expected PASS.
- [ ] **Step 5: Commit** `feat(F04): add codec lab worker op`.

### Task 3: Codec lab state and view

**Files:**
- Create: `apps/web/src/features/codecLab/{codecLabState.ts,codecLabState.test.ts,codecLabView.tsx}`
- Modify: `apps/web/src/app/routes.tsx`, `apps/web/src/app/sidebar.tsx`, `apps/web/src/app/routes.test.tsx`
- Modify: `apps/web/src/i18n/en.json`, `apps/web/src/i18n/fa.json`

**Interfaces:**
- URL keys: `c` (codec, default `rle`), `mbr` (MDCT kbps, default `128`),
  `from`, `to` (samples). Decoder validates the codec against
  `CodecLabCodec`, clamps `mbr` to `32..512`, clamps `from/to` to the source,
  and falls back to `0..min(N, 30·fs)` when absent/invalid.
- State exposes `settings`, `updateSettings`, `run`, `status`
  (`idle | running | ready | error`), `result`, `errorKey`, and a stale flag
  set when settings change after a result.
- View:
  - Requires a source; otherwise the standard translated empty hint.
  - Excerpt card: start/end seconds (Latin digits, `dir="ltr"`), “Use
    selection” button, range readout, 30 s cap notice.
  - Codec selector (`rle`, `huffman`, `deltaHuffman`, `mulaw`, `alaw`,
    `mdct`); MDCT bitrate select (`32, 64, 96, 128, 192, 256, 320, 512` kbps)
    visible only for MDCT.
  - **Encode** button; disabled while running or empty. Result persists until
    the next encode; changing settings shows a translated “settings changed”
    stale hint.
  - Stats table: original/compressed bytes, ratio, bits/sample, bitrate,
    entropy, encode/decode ms, bit-exact badge, SNR, segmental SNR, PSNR
    (`∞` for identical), MSE. PSNR note: peak = 1.0.
  - Histogram: 256-bin `<canvas>` bar chart, `dir="ltr"`, aria label.
  - Code-length table: non-zero entries only, symbol in Latin hex, length;
    hidden for codecs without a Huffman codebook.
  - MDCT: sparsity percentage, frame count, total bits.
  - Play decoded: `setProcessed(decoded, sampleRateHz, "codecLab")`; A/B dock
    switches to processed automatically.
  - Theory panel: RLE format, canonical Huffman, first-order predictor,
    G.711 companding, MDCT + quantization; “what to observe” bullets
    (lossless vs lossy, entropy bound, bitrate vs quality, coefficient
    sparsity).
- Route `/tools/codec-lab`; `TOOL_IDS` gains `"codec-lab"`; sidebar label
  `nav.codecLab`; route test updated.

- [ ] **Step 1: Write failing state tests** for URL round-trip, codec/mbr
  clamps, default excerpt, stale flag, and `Use selection`.
- [ ] **Step 2: Run** `pnpm --filter @avalab/web test -- codecLabState` — expected FAIL.
- [ ] **Step 3: Implement** state + view + route/sidebar + i18n
  (`codecLab.*`, `nav.codecLab`, `tool.codecLab.title`).
- [ ] **Step 4: Run** `pnpm check` — expected PASS.
- [ ] **Step 5: Commit** `feat(F04): browser codec lab view`.

### Task 4: E2E coverage

**Files:**
- Create: `apps/web/e2e/codec-lab.spec.ts`

- [ ] **Step 1: Write e2e**:
  - Load the demo chirp; default RLE encode; assert bit-exact badge true,
    stats table visible, histogram painted, processed lane active.
  - Select MDCT, set 64 kbps, encode; assert bit-exact false and sparsity
    readout visible.
  - `Use selection` with a range updates `from/to`; zero console errors.
  - English locale: `localStorage` language, `html[dir=ltr]`, same flow.
- [ ] **Step 2: Run** `pnpm e2e -- codec-lab` — expected PASS.
- [ ] **Step 3: Commit** `test(F04): codec lab e2e`.

### Task 5: Close-out

**Files:**
- Modify: `docs/PROGRESS.md`, `docs/plans/wave-4/README.md`, `docs/ALGORITHMS.md`

- [ ] **Step 1: Run** full `pnpm check` + `pnpm e2e`; record counts and fa
  review backlog.
- [ ] **Step 2: Update** plan status and docs; note the 30 s cap and the
  MDCT container-overhead convention.
- [ ] **Step 3: Commit** `docs(F04): close browser codec lab plan`.

## Definition of Done

- `/tools/codec-lab` works in fa/RTL and en/LTR with no console errors.
- Every hand-written codec encodes/decodes in the worker and shows the
  required internals.
- Lossless codecs are bit-exact; lossy codecs are honest about it.
- `pnpm check` and `pnpm e2e` pass.
- `docs/ALGORITHMS.md` and `docs/PROGRESS.md` updated.

## Carries

- Real codecs and backend alignment are Plan 02/03.
- Persian copy for `codecLab.*` needs owner review.
- MDCT at 30 s is a batch action; if measured worker time exceeds the §9
  budget, lower the MDCT excerpt cap and record it in `PROGRESS.md`.
