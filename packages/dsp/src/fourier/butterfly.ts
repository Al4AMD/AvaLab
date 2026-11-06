/**
 * Purpose: F08 teaching view of the radix-2 Cooley-Tukey FFT. Returns every
 * butterfly operation in execution order so the UI can step through the
 * transform and show the two inputs, the twiddle factor, and both outputs.
 *
 * Formula (same SciPy/engineering convention as fftRadix2):
 *   X[k] = sum_{n=0}^{N-1} x[n] e^(-j 2 pi k n / N)
 * DIT butterfly for stage length m (half = m/2, W = e^(-j 2 pi / m)):
 *   t   = W^j * X[odd]
 *   X[even] = X[even] + t
 *   X[odd]  = X[even] - t
 * The input is first bit-reversed, then log2(N) stages of N/2 butterflies are
 * recorded in place.
 *
 * Reference: Oppenheim & Schafer, "Discrete-Time Signal Processing", 3rd ed.,
 * section 9.3; the stage layout mirrors packages/dsp/src/fourier/fft.ts.
 *
 * Complexity: O(N log N) time and O(N log N) space for the returned steps.
 *
 * Edge cases: only N = 8 and N = 16 are supported (RangeError otherwise);
 * re/im lengths must match (TypeError); non-finite values are rejected
 * (TypeError); inputs are never mutated. Stage numbers are 1-based and
 * butterflyIndex is a 0-based global execution counter.
 */

export interface ButterflyStep {
  readonly stage: number;
  readonly butterflyIndex: number;
  readonly evenIndex: number;
  readonly oddIndex: number;
  readonly twiddleRe: number;
  readonly twiddleIm: number;
  readonly inputEven: number;
  readonly inputEvenIm: number;
  readonly inputOdd: number;
  readonly inputOddIm: number;
  readonly outputEvenRe: number;
  readonly outputEvenIm: number;
  readonly outputOddRe: number;
  readonly outputOddIm: number;
}

const SUPPORTED_SIZES = new Set([8, 16]);

function assertFinite(values: Float64Array, label: string): void {
  for (let index = 0; index < values.length; index += 1) {
    const value: number | undefined = values[index];
    if (value === undefined || !Number.isFinite(value)) {
      throw new TypeError(`${label}[${index}] is not finite (${String(value)})`);
    }
  }
}

export function fftButterflySteps(real: Float64Array, imag: Float64Array): ButterflyStep[] {
  if (real.length !== imag.length) {
    throw new TypeError(
      `fftButterflySteps: re length ${real.length} does not match im length ${imag.length}`,
    );
  }
  const size = real.length;
  if (!SUPPORTED_SIZES.has(size)) {
    throw new RangeError(`fftButterflySteps: size ${size} must be 8 or 16`);
  }
  assertFinite(real, "fftButterflySteps: re");
  assertFinite(imag, "fftButterflySteps: im");

  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const bitCount = Math.log2(size);
  for (let index = 0; index < size; index += 1) {
    let reversed = 0;
    for (let bit = 0; bit < bitCount; bit += 1) {
      reversed = (reversed << 1) | ((index >> bit) & 1);
    }
    re[reversed] = real[index] ?? 0;
    im[reversed] = imag[index] ?? 0;
  }

  const steps: ButterflyStep[] = [];
  let butterflyIndex = 0;
  for (let stageSize = 2; stageSize <= size; stageSize <<= 1) {
    const half = stageSize >> 1;
    const twiddleStride = size / stageSize;
    const stage = Math.log2(stageSize);
    for (let blockStart = 0; blockStart < size; blockStart += stageSize) {
      for (let j = 0; j < half; j += 1) {
        const evenIndex = blockStart + j;
        const oddIndex = evenIndex + half;
        const twiddleIndex = j * twiddleStride;
        const angle = (-2 * Math.PI * twiddleIndex) / size;
        const twiddleRe = Math.cos(angle);
        const twiddleIm = Math.sin(angle);
        const inputEvenRe = re[evenIndex] ?? 0;
        const inputEvenIm = im[evenIndex] ?? 0;
        const inputOddRe = re[oddIndex] ?? 0;
        const inputOddIm = im[oddIndex] ?? 0;
        const productRe = inputOddRe * twiddleRe - inputOddIm * twiddleIm;
        const productIm = inputOddRe * twiddleIm + inputOddIm * twiddleRe;
        const outputEvenRe = inputEvenRe + productRe;
        const outputEvenIm = inputEvenIm + productIm;
        const outputOddRe = inputEvenRe - productRe;
        const outputOddIm = inputEvenIm - productIm;

        steps.push({
          stage,
          butterflyIndex,
          evenIndex,
          oddIndex,
          twiddleRe,
          twiddleIm,
          inputEven: inputEvenRe,
          inputEvenIm,
          inputOdd: inputOddRe,
          inputOddIm,
          outputEvenRe,
          outputEvenIm,
          outputOddRe,
          outputOddIm,
        });
        re[evenIndex] = outputEvenRe;
        im[evenIndex] = outputEvenIm;
        re[oddIndex] = outputOddRe;
        im[oddIndex] = outputOddIm;
        butterflyIndex += 1;
      }
    }
  }
  return steps;
}
