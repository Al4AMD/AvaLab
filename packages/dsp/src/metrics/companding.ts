/**
 * Purpose: G.711 mu-law and A-law companding for the F04 compression lab.
 * Students encode a float signal at 8 bits with a logarithmic quantizer, see
 * that small amplitudes keep a fine step while large amplitudes lose
 * resolution, and decode back to compare the audible/measurable error against
 * uniform 8-bit quantization. Both codecs are the ITU-T G.711 standard curves,
 * bit-compatible with the Python stdlib `audioop` reference used by the golden
 * vectors.
 *
 * Definitions (pinned by controller ruling R5; x in float full scale [-1, 1]):
 *   s[n]      = clip(round(x[n] * 32768), -32768, 32767)   (signed int16)
 *   mulawEncode(x, {bits: 8})[n] = linearToMulaw(s[n])
 *   alawEncode(x, {bits: 8})[n]  = linearToAlaw(s[n])
 *   mulawDecode(bytes)[n] = ulawToLinear(bytes[n]) / 32768
 *   alawDecode(bytes)[n]  = alawToLinear(bytes[n]) / 32768
 *
 * `Math.round` is the ECMAScript half-up-toward-+infinity rule; the golden
 * inputs are exact multiples of 1/32768 or 1/128, so no tie is ever hit and
 * the Python and TypeScript conversions agree byte-for-byte. An input sample
 * outside [-1, 1] is clipped (not rejected) at the int16 boundary above.
 *
 * G.711 mu-law (mu = 255) continuous companding curve, used for theory:
 *   F(x) = sign(x) * ln(1 + 255*|x|) / ln(256),          x in [-1, 1].
 * The 8-bit quantizer is the standard 8-segment piecewise-linear
 * approximation (16 codes per segment, 4-bit magnitude in the low nibble):
 *   let u = (~byte) & 0xFF, q = u & 0x0F, seg = (u >> 4) & 0x07,
 *   magnitude = ((2*q + 33) << seg) * 4 - 132,           (int16 units)
 *   decoded   = ((u & 0x80) ? -magnitude : magnitude) / 32768.
 * Encoding shifts the int16 sample right by 2 (an arithmetic shift, matching
 * the reference g711.c), clips the magnitude to 8159, adds the 33 bias units,
 * finds the segment, and complements the code for positive samples. The
 * shift/truncation makes mu-law a nearest-lower-magnitude quantizer rather
 * than a nearest-neighbour one, so its negative-side error can approach one
 * code step (documented with the measured bounds in the module tests).
 *
 * G.711 A-law (A = 87.6) continuous companding curve:
 *   F(x) = sign(x) * (1 + ln(A*|x|)) / (1 + ln A)        for |x| >= 1/A,
 *   F(x) = sign(x) * A*|x| / (1 + ln A)                  otherwise.
 * The 8-bit approximation uses segments and a 4-bit magnitude:
 *   let a = byte ^ 0x55, q = a & 0x0F, seg = (a >> 4) & 0x07,
 *   magnitude = 16*q + 8                                 for seg = 0,
 *   magnitude = (2*q + 33) << (seg + 2)                  for seg >= 1,
 *   decoded   = ((a & 0x80) ? magnitude : -magnitude) / 32768.
 * The G.711 A-law **even-bit inversion** convention is two separate XORs.
 * The encoder XORs 0x55 to invert the even code bits (bit 0, 2, 4, 6) and
 * additionally XORs 0x80 for non-negative samples, which is the 0xD5 mask;
 * negative samples use 0x55 alone. The decoder XORs only 0x55 to undo the
 * even-bit inversion. It is part of the A-law byte pattern, not an extra
 * per-stream toggle.
 *
 * Roundtrip expectations (measured, see the test file):
 *   - A-law: |decode(encode(x)) - x| <= half of the local code step for every
 *     16-bit input; maximum absolute error 512/32768 = 2^-6.
 *   - mu-law: the standard encoder truncates magnitude, so the bound is one
 *     local code step on negative samples (max ratio 0.875, max absolute
 *     error 644/32768 at the negative full-scale endpoint); positive samples
 *     are within half a step except the top code, whose reconstruction is
 *     truncated by the input domain. This is inherent to G.711 and to the
 *     `audioop` golden reference; the plan's "<= 2^-8 of full scale" bound is
 *     not attainable by an 8-bit logarithmic codec (the top segment step is
 *     1024/32768 = 2^-5, so half a step is 2^-6).
 *   - Resolution near zero is 8/32768 = 2^-12 (A-law zero is the exception:
 *     the first code reconstructs +8/32768), versus 256/32768 = 2^-7 for
 *     uniform 8-bit PCM. This finer small-signal step is why mu-law beats
 *     uniform 8-bit for a -40 dBFS tone (tested).
 *
 * References: ITU-T Recommendation G.711, "Pulse code modulation (PCM) of
 * voice frequencies" (1988), including the mu-law and A-law tables and the
 * A-law even-bit inversion; the reference implementation inherited from
 * Sun's g711.c and exposed by Python 3.12 stdlib `audioop`
 * (`lin2ulaw`/`ulaw2lin`/`lin2alaw`/`alaw2lin`), pinned by the plan for
 * Python 3.12 (audioop is deprecated and removed in Python 3.13).
 *
 * Complexity: O(N) time and O(N) output space per call; encoding uses O(1)
 * extra state, decoding is a pure 256-entry table calculation. Inputs are
 * never mutated and every call returns a fresh array.
 *
 * Edge cases (R5/R6): only `bits = 8` is supported -> any other value,
 * including a missing option, is a RangeError. A non-finite sample ->
 * TypeError. Empty input -> empty output. |x| > 1 is clipped at the int16
 * boundary before encoding. Decoding accepts every possible byte value
 * (0..255) and always returns values inside [-1, 1].
 */

/** G.711 companding options. Only 8-bit G.711 codes are supported (R5). */
export interface CompandingOptions {
  /** Must be 8; any other value is a RangeError. */
  bits: 8;
}

/** mu = 255 bias in the 14-bit companded domain (0x84 >> 2). */
const MULAW_BIAS_14BIT = 33;
/** Positive 14-bit magnitude clip for mu-law. */
const MULAW_CLIP_14BIT = 8159;
/** Segment upper bounds for the 14-bit mu-law magnitude. */
const MULAW_SEGMENT_ENDS = [0x3f, 0x7f, 0xff, 0x1ff, 0x3ff, 0x7ff, 0xfff, 0x1fff] as const;
/** Segment upper bounds for the 12-bit A-law magnitude. */
const ALAW_SEGMENT_ENDS = [0x1f, 0x3f, 0x7f, 0xff, 0x1ff, 0x3ff, 0x7ff, 0xfff] as const;
/** Common G.711 decoder bias added before the segment shift (0x84). */
const G711_BIAS = 0x84;
/** A-law even-bit inversion mask applied by the encoder/decoder (G.711). */
const ALAW_EVEN_BIT_MASK = 0x55;

function assertFiniteSamples(samples: Float64Array, caller: string): void {
  for (let n = 0; n < samples.length; n += 1) {
    const sample: number | undefined = samples[n];
    if (sample === undefined) {
      throw new TypeError(`${caller}: samples[${n}] read out of bounds`);
    }
    if (!Number.isFinite(sample)) {
      throw new TypeError(`${caller}: samples[${n}] must be finite (got ${sample})`);
    }
  }
}

function assertBitsEight(options: CompandingOptions | undefined, caller: string): void {
  const bits: number | undefined = options?.bits;
  if (bits !== 8) {
    throw new RangeError(
      `${caller}: G.711 companding supports only bits = 8 (got ${String(bits)})`,
    );
  }
}

/** s = clip(round(x * 32768), -32768, 32767), the pinned R5 int16 step. */
function toInt16Sample(sample: number): number {
  const scaled = Math.round(sample * 32768);
  if (scaled < -32768) {
    return -32768;
  }
  if (scaled > 32767) {
    return 32767;
  }
  return scaled;
}

function segmentForMagnitude(magnitude: number, ends: readonly number[]): number {
  for (let segment = 0; segment < ends.length; segment += 1) {
    if (magnitude <= (ends[segment] ?? 0)) {
      return segment;
    }
  }
  return ends.length;
}

/** G.711 mu-law encoder for one signed int16 sample (reference g711.c). */
function linearToMulaw(sample: number): number {
  let magnitude = sample >> 2;
  let mask: number;
  if (magnitude < 0) {
    magnitude = -magnitude;
    mask = 0x7f;
  } else {
    mask = 0xff;
  }
  if (magnitude > MULAW_CLIP_14BIT) {
    magnitude = MULAW_CLIP_14BIT;
  }
  magnitude += MULAW_BIAS_14BIT;
  const segment = segmentForMagnitude(magnitude, MULAW_SEGMENT_ENDS);
  if (segment >= 8) {
    return (0x7f ^ mask) & 0xff;
  }
  const code = (segment << 4) | ((magnitude >> (segment + 1)) & 0x0f);
  return (code ^ mask) & 0xff;
}

/** G.711 mu-law decoder for one byte, returning signed int16 units. */
function mulawToLinear(byte: number): number {
  const inverted = ~byte & 0xff;
  const shifted = (((inverted & 0x0f) << 3) + G711_BIAS) << ((inverted & 0x70) >> 4);
  const magnitude = shifted - G711_BIAS;
  return (inverted & 0x80) !== 0 ? -magnitude : magnitude;
}

/** G.711 A-law encoder for one signed int16 sample (reference g711.c). */
function linearToAlaw(sample: number): number {
  let magnitude = sample >> 3;
  let mask: number;
  if (magnitude >= 0) {
    mask = 0xd5;
  } else {
    mask = ALAW_EVEN_BIT_MASK;
    magnitude = -magnitude - 1;
  }
  const segment = segmentForMagnitude(magnitude, ALAW_SEGMENT_ENDS);
  if (segment >= 8) {
    return (0x7f ^ mask) & 0xff;
  }
  let code = segment << 4;
  if (segment < 2) {
    code |= (magnitude >> 1) & 0x0f;
  } else {
    code |= (magnitude >> segment) & 0x0f;
  }
  return (code ^ mask) & 0xff;
}

/** G.711 A-law decoder for one byte, returning signed int16 units. */
function alawToLinear(byte: number): number {
  const inverted = byte ^ ALAW_EVEN_BIT_MASK;
  let magnitude = (inverted & 0x0f) << 4;
  const segment = (inverted & 0x70) >> 4;
  if (segment === 0) {
    magnitude += 8;
  } else if (segment === 1) {
    // Segment 1 adds 0x108 = 2 * 0x84 before decoding (G.711 table).
    magnitude += 0x108;
  } else {
    magnitude += 0x108;
    magnitude <<= segment - 1;
  }
  return (inverted & 0x80) !== 0 ? magnitude : -magnitude;
}

/**
 * Encode float samples to 8-bit G.711 mu-law codes:
 * byte[n] = linearToMulaw(clip(round(x[n] * 32768), -32768, 32767)).
 * `options.bits` must be 8 (RangeError otherwise); non-finite samples ->
 * TypeError; |x| > 1 is clipped. Returns a fresh Uint8Array of the same
 * length as the input.
 */
export function mulawEncode(x: Float64Array, options: CompandingOptions): Uint8Array {
  assertBitsEight(options, "mulawEncode");
  assertFiniteSamples(x, "mulawEncode");

  const encoded = new Uint8Array(x.length);
  for (let n = 0; n < x.length; n += 1) {
    encoded[n] = linearToMulaw(toInt16Sample(x[n] ?? 0));
  }
  return encoded;
}

/**
 * Decode 8-bit G.711 mu-law codes to float samples in [-1, 1]:
 * x[n] = mulawToLinear(byte[n]) / 32768. Every byte value is valid and the
 * output length equals the input length.
 */
export function mulawDecode(bytes: Uint8Array): Float64Array {
  const decoded = new Float64Array(bytes.length);
  for (let n = 0; n < bytes.length; n += 1) {
    decoded[n] = mulawToLinear(bytes[n] ?? 0) / 32768;
  }
  return decoded;
}

/**
 * Encode float samples to 8-bit G.711 A-law codes (A = 87.6, including the
 * documented even-bit inversion):
 * byte[n] = linearToAlaw(clip(round(x[n] * 32768), -32768, 32767)).
 * `options.bits` must be 8 (RangeError otherwise); non-finite samples ->
 * TypeError; |x| > 1 is clipped. Returns a fresh Uint8Array of the same
 * length as the input.
 */
export function alawEncode(x: Float64Array, options: CompandingOptions): Uint8Array {
  assertBitsEight(options, "alawEncode");
  assertFiniteSamples(x, "alawEncode");

  const encoded = new Uint8Array(x.length);
  for (let n = 0; n < x.length; n += 1) {
    encoded[n] = linearToAlaw(toInt16Sample(x[n] ?? 0));
  }
  return encoded;
}

/**
 * Decode 8-bit G.711 A-law codes to float samples in [-1, 1]:
 * x[n] = alawToLinear(byte[n]) / 32768. Every byte value is valid and the
 * output length equals the input length.
 */
export function alawDecode(bytes: Uint8Array): Float64Array {
  const decoded = new Float64Array(bytes.length);
  for (let n = 0; n < bytes.length; n += 1) {
    decoded[n] = alawToLinear(bytes[n] ?? 0) / 32768;
  }
  return decoded;
}
