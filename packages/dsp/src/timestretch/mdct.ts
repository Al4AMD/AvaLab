/**
 * Purpose: modified discrete cosine transform (MDCT) and its inverse (IMDCT)
 * with time-domain aliasing cancellation (TDAC) overlap-add synthesis — the
 * transform core of the F04 toy lossy codec and the F06 time-stretch path.
 * The MDCT compresses a 2N-sample windowed frame into N real coefficients
 * (a 50 % frame overlap in exchange for full critical sampling); the IMDCT
 * expands each frame back to 2N samples, and the synthesis window + overlap-add
 * cancels the time-domain aliasing the critical sampling introduced, so
 * imdct(mdct(x)) reconstructs x exactly (perfect reconstruction, PR).
 *
 * Pinned convention (controller amendment 2026-10-25, see
 * .superpowers/sdd/04-codecs-and-time/progress.md — the plan's literal
 * "plain" DCT-IV angle cannot reconstruct and was amended):
 *
 * Window (analysis AND synthesis, 2N = frameLengthSamples, N = hop):
 *   w[n] = sin(pi * (n + 0.5) / (2N)),  n = 0..2N-1
 * It is symmetric (w[2N-1-n] = w[n]) and satisfies the TDAC window-pair
 * condition exactly: w[j]^2 + w[N+j]^2 = 1.
 *
 * Transform basis (rotated Princen-Bradley / oddly-stacked angle; equivalent
 * to the plain DCT-IV MDCT angle pi*(2n+1)*(2k+1)/(4N) rotated per bin k by
 * (2k+1)*pi/4):
 *   C[k][n] = cos(pi * (2k+1) * (2n+1+N) / (4N)),  k = 0..N-1, n = 0..2N-1
 *
 * Forward, M = ceil(sampleCount / N), frameCount = M + 1 frames (the extra
 * first frame is the pre-roll that covers the first hop of output with two
 * windows; frame i, 0-based, covers samples [(i-1)*N, (i-1)*N + 2N), zero
 * outside [0, sampleCount)):
 *   u_i[n] = x[(i-1)*N + n] * w[n]      (n = 0..2N-1)
 *   X_i[k] = sum_n u_i[n] * C[k][n]     (k = 0..N-1, unnormalized)
 *
 * Inverse (same basis, only scaling differs) and synthesis (plain overlap-add,
 * NO per-sample window-energy normalization: every output sample is covered by
 * exactly two frames and sum(w^2) = 1 there):
 *   v_i[n] = (2/N) * sum_k X_i[k] * C[k][n]   (n = 0..2N-1)
 *   y[(i-1)*N + n] += v_i[n] * w[n]           (positions < 0 discarded)
 * Output length (frameCount - 1) * N = M * N; callers trim trailing zeros to
 * the original sample count.
 *
 * Why this angle (the TDAC algebra; the reason the plan was amended): the
 * per-frame round trip is the operator T = (2/N) * C * C^T on the windowed
 * frame. With the plain DCT-IV angle T = I - A (A the anti-diagonal of size
 * 2N, verified exactly), so each frame output v[n] = u[n] - u[2N-1-n] swaps
 * every sample with its frame-center mirror. At an interior output sample n
 * (covered by frames i0 at local j0 = n - i0*N and i0-1 at local j0 + N) the
 * overlap-add then cannot cancel: the two windows swap DIFFERENT mirror
 * samples (n + 2N-1-2j0 and n - 2j0-1), so both cross terms must vanish,
 * forcing w = 0 — that flavor has no perfect-reconstruction window pair at
 * all (measured O(1) errors on any multi-frame input). With the rotated angle
 * the cross terms reference ONE shared sample A = n + N-1-2j0 with weights
 * -w[j0]*w[N-1-j0] + w[N+j0]*w[2N-1-j0] = -w[j0]*w[N+j0] + w[N+j0]*w[j0] = 0
 * (window symmetry), and the main terms sum to w[j0]^2 + w[N+j0]^2 = 1
 * (window-pair condition) — exact reconstruction everywhere, including the
 * edges via the pre-roll frame. This half-sample-shifted basis is the one
 * real codecs (AAC, Vorbis, MP3) use; see Princen & Bradley, "Analysis/
 * Synthesis filter bank design based on time domain aliasing cancellation",
 * IEEE Trans. ASSP 34(5), 1986, and Malvar, "Lapped transforms for efficient
 * transform/subband coding", IEEE Trans. ASSP 38(6), 1990.
 *
 * The DCT-IV relationship (kept for the golden): with u the windowed frame,
 * z[m] = u[m] - u[2N-1-m] (fold-minus) and z2[m] = u[m] + u[2N-1-m]
 * (fold-plus), m = 0..N-1:
 *   X[k] = 0.5 * (cos((2k+1)pi/4) * DCT4(z)[k] - sin((2k+1)pi/4) * DST4(z2)[k])
 * where DCT4/DST4 are the SciPy self-inverse type-IV transforms
 * (scipy.fft.dct/dst, type=4, unitary scale 0.5 handled by the formula).
 * tools/golden .../algorithms/mdct.py asserts the direct basis against this
 * construction.
 *
 * Implementation decision (documented): the cosine matrix C (N x 2N doubles)
 * is built once per mdct/imdct call and reused across that call's frames —
 * O(N^2) memory, e.g. 4 MB at frame 1024 — instead of a module-level cache,
 * because hidden global state is forbidden for this library and the per-call
 * cost is small next to the O(frameCount * N^2) math. No mdctMatrix export
 * exists on purpose (plan T4): the matrix is an implementation detail.
 *
 * Complexity: O(N^2) to build the matrix once per call, then
 * O(frameCount * N^2) time for the transforms plus O(sum of frame lengths)
 * for the overlap-add; O(N^2 + frameCount * N) space.
 *
 * Edge cases: empty input -> empty coefficients (special case; the pre-roll
 * formula alone would emit one all-zero frame — pinned by R4-amended).
 * imdct with no frames -> empty output. frameLengthSamples must be an even
 * integer >= 4 (frame = 2 * hop) -> RangeError otherwise; every frame handed
 * to imdct must hold exactly hop coefficients -> RangeError; a NaN or
 * +/-Infinity input sample or coefficient -> TypeError. Inputs are never
 * mutated; results are fresh Float64Arrays. Output samples beyond
 * sampleCount are exactly 0 (the cross terms cancel to 0 there), so callers
 * can trim freely.
 */

export interface MdctParams {
  /** Total frame length 2N in samples (even, >= 4); the hop is fixed to N. */
  frameLengthSamples: number;
}

export interface MdctResult {
  /** One Float64Array of N (= frameLengthSamples/2) coefficients per frame. */
  coefficients: Float64Array[];
  frameLengthSamples: number;
  hopLengthSamples: number;
}

function assertFrameLengthSamples(value: number, caller: string): void {
  if (!Number.isInteger(value) || value < 4 || value % 2 !== 0) {
    throw new RangeError(
      `${caller}: frameLengthSamples must be an even integer >= 4 (got ${value})`,
    );
  }
}

function assertFiniteValues(values: Float64Array, label: string): void {
  for (let index = 0; index < values.length; index += 1) {
    const value: number | undefined = values[index];
    if (value === undefined) {
      throw new TypeError(`${label}[${index}] read out of bounds`);
    }
    if (!Number.isFinite(value)) {
      throw new TypeError(`${label}[${index}] is not finite (${value})`);
    }
  }
}

/** Build the sinusoid windows and basis matrix shared by both directions. */
function buildBasis(frameLengthSamples: number): {
  window: Float64Array;
  matrix: Float64Array;
  hopLengthSamples: number;
} {
  const hopLengthSamples = frameLengthSamples / 2;
  const win = new Float64Array(frameLengthSamples);
  for (let n = 0; n < frameLengthSamples; n += 1) {
    win[n] = Math.sin((Math.PI * (n + 0.5)) / frameLengthSamples);
  }
  // Row-major matrix: matrix[k * frameLengthSamples + n] = C[k][n].
  const matrix = new Float64Array(hopLengthSamples * frameLengthSamples);
  for (let k = 0; k < hopLengthSamples; k += 1) {
    for (let n = 0; n < frameLengthSamples; n += 1) {
      const angle =
        (Math.PI * (2 * k + 1) * (2 * n + 1 + hopLengthSamples)) / (4 * hopLengthSamples);
      matrix[k * frameLengthSamples + n] = Math.cos(angle);
    }
  }
  return { window: win, matrix, hopLengthSamples };
}

/** Forward MDCT: window each (pre-rolled) 2N block, project on the basis. */
export function mdct(x: Float64Array, params: MdctParams): MdctResult {
  assertFrameLengthSamples(params.frameLengthSamples, "mdct");
  assertFiniteValues(x, "mdct: x");

  const { frameLengthSamples } = params;
  const { window: win, matrix, hopLengthSamples } = buildBasis(frameLengthSamples);

  if (x.length === 0) {
    return { coefficients: [], frameLengthSamples, hopLengthSamples };
  }

  // frameCount = ceil(sampleCount / hop) + 1: the last real hop is frame M
  // (M = ceil(...)), and one extra frame holds the pre-roll + right-edge
  // half-window the TDAC cancellation needs.
  const frameCount = Math.ceil(x.length / hopLengthSamples) + 1;
  const coefficients: Float64Array[] = [];
  const windowed = new Float64Array(frameLengthSamples);

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    windowed.fill(0);
    const start = (frameIndex - 1) * hopLengthSamples;
    for (let n = 0; n < frameLengthSamples; n += 1) {
      const sampleOffset = start + n;
      if (sampleOffset >= 0 && sampleOffset < x.length) {
        const sample: number | undefined = x[sampleOffset];
        if (sample === undefined) {
          throw new TypeError(`mdct: x[${sampleOffset}] read out of bounds`);
        }
        const windowSample: number | undefined = win[n];
        if (windowSample === undefined) {
          throw new TypeError(`mdct: window[${n}] read out of bounds`);
        }
        windowed[n] = sample * windowSample;
      }
    }
    const coefficientsFrame = new Float64Array(hopLengthSamples);
    for (let k = 0; k < hopLengthSamples; k += 1) {
      let sum = 0;
      const rowOffset = k * frameLengthSamples;
      for (let n = 0; n < frameLengthSamples; n += 1) {
        const basis: number | undefined = matrix[rowOffset + n];
        const windowedSample: number | undefined = windowed[n];
        if (basis === undefined || windowedSample === undefined) {
          throw new TypeError(`mdct: basis[${k}, ${n}] read out of bounds`);
        }
        sum += basis * windowedSample;
      }
      coefficientsFrame[k] = sum;
    }
    coefficients.push(coefficientsFrame);
  }

  return { coefficients, frameLengthSamples, hopLengthSamples };
}

/**
 * Inverse MDCT with TDAC overlap-add. `coefficients` are consecutive frames of
 * the forward transform; the output spans (frameCount - 1) * hop samples with
 * the reconstruction aligned to the input the frames came from (positions
 * 0..sampleCount-1), padded with exact zeros up to that length (trim to the
 * original sample count by taking a prefix).
 */
export function imdct(coefficients: readonly Float64Array[], params: MdctParams): Float64Array {
  assertFrameLengthSamples(params.frameLengthSamples, "imdct");

  const { frameLengthSamples } = params;
  const { window: win, matrix, hopLengthSamples } = buildBasis(frameLengthSamples);

  for (let frameIndex = 0; frameIndex < coefficients.length; frameIndex += 1) {
    const frame: Float64Array | undefined = coefficients[frameIndex];
    if (frame === undefined) {
      throw new TypeError(`imdct: frame ${frameIndex} read out of bounds`);
    }
    if (frame.length !== hopLengthSamples) {
      throw new RangeError(
        `imdct: frame ${frameIndex} holds ${frame.length} coefficients, expected hop ${hopLengthSamples}`,
      );
    }
    assertFiniteValues(frame, `imdct: frame ${frameIndex} coefficient`);
  }

  if (coefficients.length === 0) {
    return new Float64Array(0);
  }

  const outputLength = (coefficients.length - 1) * hopLengthSamples;
  const output = new Float64Array(outputLength);
  const spectral = new Float64Array(hopLengthSamples);

  for (let frameIndex = 0; frameIndex < coefficients.length; frameIndex += 1) {
    const frame = coefficients[frameIndex];
    if (frame === undefined) {
      throw new TypeError(`imdct: frame ${frameIndex} read out of bounds`);
    }
    for (let k = 0; k < hopLengthSamples; k += 1) {
      const coefficient: number | undefined = frame[k];
      if (coefficient === undefined) {
        throw new TypeError(`imdct: frame ${frameIndex} coefficient ${k} read out of bounds`);
      }
      spectral[k] = (2 / hopLengthSamples) * coefficient;
    }
    const start = (frameIndex - 1) * hopLengthSamples;
    for (let n = 0; n < frameLengthSamples; n += 1) {
      let sum = 0;
      for (let k = 0; k < hopLengthSamples; k += 1) {
        const basis: number | undefined = matrix[k * frameLengthSamples + n];
        const weighted: number | undefined = spectral[k];
        if (basis === undefined || weighted === undefined) {
          throw new TypeError(`imdct: basis[${k}, ${n}] read out of bounds`);
        }
        sum += basis * weighted;
      }
      const outputOffset = start + n;
      if (outputOffset >= 0 && outputOffset < outputLength) {
        const current: number | undefined = output[outputOffset];
        if (current === undefined) {
          throw new TypeError(`imdct: output[${outputOffset}] read out of bounds`);
        }
        const windowSample: number | undefined = win[n];
        if (windowSample === undefined) {
          throw new TypeError(`imdct: window[${n}] read out of bounds`);
        }
        output[outputOffset] = current + sum * windowSample;
      }
    }
  }

  return output;
}
