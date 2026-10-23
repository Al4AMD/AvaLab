/**
 * Purpose: closed-form signal generators for the F12 signal generator and the
 * P0 demo clips. Every generator is deterministic, pure and returns a fresh
 * Float64Array, so the UI can regenerate a signal while a parameter slider
 * moves without any server round-trip.
 *
 * Sample grid (shared by every generator):
 *   N = round(durationSeconds * sampleRateHz),  t_n = n / sampleRateHz
 *
 * Formulas (a = amplitude, f = frequencyHz, fs = sampleRateHz, n = 0..N-1):
 *   sine      x[n] = a * sin(2*pi*f*n/fs + phaseRad)
 *   square    p[n] = frac(f*n/fs); x[n] = +a when p[n] <= dutyCycle, else -a.
 *             The inclusive threshold is the documented tie rule: it makes the
 *             default 50 % waveform agree with sign(sin(...)) with sign(0)
 *             pinned to +1, so both zero crossings of a period are +a.
 *   sawtooth  x[n] = a * (2*frac(f*n/fs) - 1), rising; range [-a, a)
 *   triangle  x[n] = a * tri(frac(f*n/fs)), where tri(p) =
 *             4p for p < 1/4; 2 - 4p for 1/4 <= p < 3/4; 4p - 4 otherwise.
 *             Starts at 0, rises to +a at p = 1/4, falls to -a at p = 3/4.
 *   impulse   x[n] = a at n = impulseSampleIndex, 0 elsewhere
 *   step      x[n] = amplitudeBefore for n < stepSampleIndex,
 *             amplitudeAfter for n >= stepSampleIndex
 *   chirp     phase = 2*pi * integral_0^t f(tau) dtau, closed form below
 *   twoTone   x[n] = (a/2) * (sin(2*pi*f1*n/fs) + sin(2*pi*f2*n/fs)); the two
 *             components are equal halves so |x[n]| <= |a|
 *   AM        x[n] = a * (1 + modulationIndex*sin(2*pi*fm*n/fs)) * sin(2*pi*fc*n/fs)
 *   FM        x[n] = a * sin(2*pi*fc*n/fs
 *                          + (frequencyDeviationHz/modulationHz)*sin(2*pi*fm*n/fs))
 *
 * Chirp instantaneous frequency and phase (T = durationSeconds, u = t/T):
 *   linear:      f(t) = f0 + (f1 - f0) * u
 *                phase(t) = 2*pi * (f0*t + (f1 - f0)*t^2/(2*T))
 *   logarithmic: f(t) = f0 * exp(alpha * u),  alpha = ln(f1) - ln(f0)
 *                phase(t) = 2*pi * f0*T * expm1(alpha*u) / alpha
 * The logarithmic form uses expm1 to avoid cancellation when f1 is close to
 * f0; alpha = ln(f1) - ln(f0) instead of ln(f1/f0) avoids overflow/underflow
 * of the ratio for extreme (finite) frequencies.
 *
 * Reference: Oppenheim & Schafer, "Discrete-Time Signal Processing", 3rd ed.,
 * section 4.1 (periodic sampling, t = n/fs) and section 1.3 (basic sequences);
 * standard closed-form integration of the linear and exponential chirp
 * instantaneous frequencies. NumPy reference values define the golden vectors
 * in test-data/golden/generators.json.
 *
 * Complexity: O(N) time and O(N) output space per generator.
 *
 * Edge cases: sampleRateHz must be positive and finite -> RangeError; a
 * negative, NaN or infinite durationSeconds -> RangeError; duration 0 ->
 * empty array. Every numeric parameter must be finite -> RangeError
 * (parameters are not sample data, so this is a range error rather than the
 * sample TypeError used elsewhere in the library). dutyCycle must satisfy
 * 0 < dutyCycle <= 1. A logarithmic chirp requires 0 < startFrequencyHz,
 * 0 < endFrequencyHz and startFrequencyHz != endFrequencyHz; the linear sweep
 * also accepts equal endpoints. impulseSampleIndex and stepSampleIndex must
 * be integers in [0, N); when N = 0 both generators return an empty array
 * without an index check (R7). FM rejects modulationHz = 0 because the
 * modulation index divides by it. Inputs (including the twoTone frequency
 * tuple) are never mutated; every call returns a fresh array.
 */

export interface SignalSpec {
  durationSeconds: number;
  sampleRateHz: number;
}

const TAU = 2 * Math.PI;

function sampleCountOf(spec: SignalSpec, caller: string): number {
  const { durationSeconds, sampleRateHz } = spec;
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new RangeError(
      `${caller}: sampleRateHz must be a positive finite number (got ${sampleRateHz})`,
    );
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
    throw new RangeError(
      `${caller}: durationSeconds must be a non-negative finite number (got ${durationSeconds})`,
    );
  }
  const sampleCount = Math.round(durationSeconds * sampleRateHz);
  if (!Number.isSafeInteger(sampleCount)) {
    throw new RangeError(
      `${caller}: durationSeconds * sampleRateHz must be a safe integer sample count (got ${sampleCount})`,
    );
  }
  return sampleCount;
}

function assertFiniteParam(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite (got ${value})`);
  }
}

function assertSampleIndex(index: number, sampleCount: number, label: string): void {
  // R7: an empty signal returns empty regardless of the index; otherwise the
  // index must address a sample that exists.
  if (sampleCount === 0) {
    return;
  }
  if (!Number.isInteger(index) || index < 0 || index >= sampleCount) {
    throw new RangeError(`${label} must be an integer in [0, ${sampleCount}) (got ${index})`);
  }
}

/** Phase position in [0, 1) for sample `n`; negative frequencies are folded. */
function cyclePhase(frequencyHz: number, sampleIndex: number, sampleRateHz: number): number {
  const cycles = (frequencyHz * sampleIndex) / sampleRateHz;
  return cycles - Math.floor(cycles);
}

/**
 * Sine: x[n] = amplitude * sin(2*pi*frequencyHz*n/sampleRateHz + phaseRad).
 * `phaseRad` defaults to 0, so x[0] = 0.
 */
export function generateSine(
  spec: SignalSpec & { frequencyHz: number; amplitude: number; phaseRad?: number },
): Float64Array {
  const sampleCount = sampleCountOf(spec, "generateSine");
  const { frequencyHz, amplitude } = spec;
  const phaseRad = spec.phaseRad ?? 0;
  assertFiniteParam(frequencyHz, "generateSine: frequencyHz");
  assertFiniteParam(amplitude, "generateSine: amplitude");
  assertFiniteParam(phaseRad, "generateSine: phaseRad");

  const values = new Float64Array(sampleCount);
  for (let n = 0; n < sampleCount; n += 1) {
    const angle = TAU * ((frequencyHz * n) / spec.sampleRateHz) + phaseRad;
    values[n] = amplitude * Math.sin(angle);
  }
  return values;
}

/**
 * Square: +amplitude while the cycle phase is <= dutyCycle, else -amplitude.
 * The inclusive tie rule keeps the mathematical zero of sin (phase 0 and the
 * half-period phase 1/2) at +amplitude, matching sign(sin) with sign(0) = +1.
 * `dutyCycle` defaults to 0.5 and must satisfy 0 < dutyCycle <= 1.
 */
export function generateSquare(
  spec: SignalSpec & { frequencyHz: number; amplitude: number; dutyCycle?: number },
): Float64Array {
  const sampleCount = sampleCountOf(spec, "generateSquare");
  const { frequencyHz, amplitude } = spec;
  const dutyCycle = spec.dutyCycle ?? 0.5;
  assertFiniteParam(frequencyHz, "generateSquare: frequencyHz");
  assertFiniteParam(amplitude, "generateSquare: amplitude");
  if (!Number.isFinite(dutyCycle) || dutyCycle <= 0 || dutyCycle > 1) {
    throw new RangeError(
      `generateSquare: dutyCycle must satisfy 0 < dutyCycle <= 1 (got ${dutyCycle})`,
    );
  }

  const values = new Float64Array(sampleCount);
  for (let n = 0; n < sampleCount; n += 1) {
    const phase = cyclePhase(frequencyHz, n, spec.sampleRateHz);
    values[n] = phase <= dutyCycle ? amplitude : -amplitude;
  }
  return values;
}

/**
 * Rising sawtooth: x[n] = amplitude * (2*frac(frequencyHz*n/sampleRateHz) - 1).
 * Range is [-amplitude, amplitude): the rising ramp starts at -amplitude and
 * never reaches +amplitude before wrapping.
 */
export function generateSawtooth(
  spec: SignalSpec & { frequencyHz: number; amplitude: number },
): Float64Array {
  const sampleCount = sampleCountOf(spec, "generateSawtooth");
  const { frequencyHz, amplitude } = spec;
  assertFiniteParam(frequencyHz, "generateSawtooth: frequencyHz");
  assertFiniteParam(amplitude, "generateSawtooth: amplitude");

  const values = new Float64Array(sampleCount);
  for (let n = 0; n < sampleCount; n += 1) {
    values[n] = amplitude * (2 * cyclePhase(frequencyHz, n, spec.sampleRateHz) - 1);
  }
  return values;
}

/**
 * Triangle: piecewise-linear function of the cycle phase, starting at 0,
 * rising to +amplitude at a quarter period, crossing 0 at half a period and
 * reaching -amplitude at three quarters. This is the waveform whose Fourier
 * series has the odd 1/k^2 sine coefficients used by fourierSeries.ts.
 */
export function generateTriangle(
  spec: SignalSpec & { frequencyHz: number; amplitude: number },
): Float64Array {
  const sampleCount = sampleCountOf(spec, "generateTriangle");
  const { frequencyHz, amplitude } = spec;
  assertFiniteParam(frequencyHz, "generateTriangle: frequencyHz");
  assertFiniteParam(amplitude, "generateTriangle: amplitude");

  const values = new Float64Array(sampleCount);
  for (let n = 0; n < sampleCount; n += 1) {
    const phase = cyclePhase(frequencyHz, n, spec.sampleRateHz);
    let normalized: number;
    if (phase < 0.25) {
      normalized = 4 * phase;
    } else if (phase < 0.75) {
      normalized = 2 - 4 * phase;
    } else {
      normalized = 4 * phase - 4;
    }
    values[n] = amplitude * normalized;
  }
  return values;
}

/**
 * Unit impulse (Kronecker delta): amplitude at impulseSampleIndex, zero
 * everywhere else. The index must be an integer in [0, N); N = 0 returns an
 * empty array without an index check (R7).
 */
export function generateImpulse(
  spec: SignalSpec & { impulseSampleIndex: number; amplitude: number },
): Float64Array {
  const sampleCount = sampleCountOf(spec, "generateImpulse");
  const { impulseSampleIndex, amplitude } = spec;
  assertFiniteParam(amplitude, "generateImpulse: amplitude");
  assertSampleIndex(impulseSampleIndex, sampleCount, "generateImpulse: impulseSampleIndex");

  const values = new Float64Array(sampleCount);
  if (sampleCount > 0) {
    values[impulseSampleIndex] = amplitude;
  }
  return values;
}

/**
 * Unit step with independent levels: amplitudeBefore for n < stepSampleIndex
 * and amplitudeAfter for n >= stepSampleIndex. The index uses the same
 * integer-in-[0, N) contract as the impulse; N = 0 returns empty.
 */
export function generateStep(
  spec: SignalSpec & {
    stepSampleIndex: number;
    amplitudeBefore: number;
    amplitudeAfter: number;
  },
): Float64Array {
  const sampleCount = sampleCountOf(spec, "generateStep");
  const { stepSampleIndex, amplitudeBefore, amplitudeAfter } = spec;
  assertFiniteParam(amplitudeBefore, "generateStep: amplitudeBefore");
  assertFiniteParam(amplitudeAfter, "generateStep: amplitudeAfter");
  assertSampleIndex(stepSampleIndex, sampleCount, "generateStep: stepSampleIndex");

  const values = new Float64Array(sampleCount);
  if (sampleCount > 0) {
    values.fill(amplitudeBefore, 0, stepSampleIndex);
    values.fill(amplitudeAfter, stepSampleIndex);
  }
  return values;
}

/**
 * Chirp with a closed-form phase (no numerical integration):
 *   linear:      phase(t) = 2*pi*(f0*t + (f1 - f0)*t^2/(2*T))
 *   logarithmic: phase(t) = 2*pi*f0*T*expm1(alpha*t/T)/alpha,
 *                alpha = ln(f1) - ln(f0)
 * Instantaneous frequency runs from startFrequencyHz at t = 0 to
 * endFrequencyHz at t = T. Logarithmic sweeps require positive, unequal
 * endpoints; linear sweeps allow f0 = f1 (a pure tone).
 */
export function generateChirp(
  spec: SignalSpec & {
    startFrequencyHz: number;
    endFrequencyHz: number;
    sweep: "linear" | "logarithmic";
  },
): Float64Array {
  const sampleCount = sampleCountOf(spec, "generateChirp");
  const { startFrequencyHz, endFrequencyHz, sweep } = spec;
  assertFiniteParam(startFrequencyHz, "generateChirp: startFrequencyHz");
  assertFiniteParam(endFrequencyHz, "generateChirp: endFrequencyHz");
  if (sweep !== "linear" && sweep !== "logarithmic") {
    throw new RangeError(`generateChirp: unknown sweep ${String(sweep)}`);
  }
  if (sweep === "logarithmic") {
    if (startFrequencyHz <= 0 || endFrequencyHz <= 0 || startFrequencyHz === endFrequencyHz) {
      throw new RangeError(
        "generateChirp: logarithmic sweep requires 0 < startFrequencyHz, " +
          `0 < endFrequencyHz and startFrequencyHz != endFrequencyHz (got ${startFrequencyHz}, ${endFrequencyHz})`,
      );
    }
  }

  const values = new Float64Array(sampleCount);
  if (sampleCount === 0) {
    return values;
  }

  const durationSeconds = spec.durationSeconds;
  if (sweep === "linear") {
    const differenceHz = endFrequencyHz - startFrequencyHz;
    for (let n = 0; n < sampleCount; n += 1) {
      const t = n / spec.sampleRateHz;
      const phaseCycles = startFrequencyHz * t + (differenceHz * t * t) / (2 * durationSeconds);
      values[n] = Math.sin(TAU * phaseCycles);
    }
    return values;
  }

  const alpha = Math.log(endFrequencyHz) - Math.log(startFrequencyHz);
  if (alpha === 0) {
    throw new RangeError(
      "generateChirp: logarithmic sweep endpoints are too close to resolve (log ratio is 0)",
    );
  }
  const scale = (startFrequencyHz * durationSeconds) / alpha;
  for (let n = 0; n < sampleCount; n += 1) {
    const u = n / spec.sampleRateHz / durationSeconds;
    values[n] = Math.sin(TAU * scale * Math.expm1(alpha * u));
  }
  return values;
}

/**
 * Two-tone signal: amplitude/2 * (sin(2*pi*f1*t) + sin(2*pi*f2*t)). Splitting
 * the amplitude keeps the sum bounded by |amplitude|; the tuple is read, never
 * modified.
 */
export function generateTwoTone(
  spec: SignalSpec & { frequenciesHz: [number, number]; amplitude: number },
): Float64Array {
  const sampleCount = sampleCountOf(spec, "generateTwoTone");
  const { frequenciesHz, amplitude } = spec;
  if (!Array.isArray(frequenciesHz) || frequenciesHz.length !== 2) {
    throw new RangeError("generateTwoTone: frequenciesHz must be a pair [f1, f2]");
  }
  const [firstFrequencyHz, secondFrequencyHz] = frequenciesHz;
  assertFiniteParam(firstFrequencyHz, "generateTwoTone: frequenciesHz[0]");
  assertFiniteParam(secondFrequencyHz, "generateTwoTone: frequenciesHz[1]");
  assertFiniteParam(amplitude, "generateTwoTone: amplitude");

  const values = new Float64Array(sampleCount);
  const halfAmplitude = amplitude / 2;
  for (let n = 0; n < sampleCount; n += 1) {
    const timeSeconds = n / spec.sampleRateHz;
    values[n] =
      halfAmplitude *
      (Math.sin(TAU * firstFrequencyHz * timeSeconds) +
        Math.sin(TAU * secondFrequencyHz * timeSeconds));
  }
  return values;
}

/**
 * Amplitude modulation:
 *   x[n] = amplitude * (1 + modulationIndex*sin(2*pi*fm*t)) * sin(2*pi*fc*t)
 * with fc = carrierHz and fm = modulationHz. A modulation index of 0 leaves
 * the unmodulated carrier; the envelope may invert for indices below -1.
 */
export function generateAm(
  spec: SignalSpec & {
    carrierHz: number;
    modulationHz: number;
    modulationIndex: number;
    amplitude: number;
  },
): Float64Array {
  const sampleCount = sampleCountOf(spec, "generateAm");
  const { carrierHz, modulationHz, modulationIndex, amplitude } = spec;
  assertFiniteParam(carrierHz, "generateAm: carrierHz");
  assertFiniteParam(modulationHz, "generateAm: modulationHz");
  assertFiniteParam(modulationIndex, "generateAm: modulationIndex");
  assertFiniteParam(amplitude, "generateAm: amplitude");

  const values = new Float64Array(sampleCount);
  for (let n = 0; n < sampleCount; n += 1) {
    const timeSeconds = n / spec.sampleRateHz;
    const carrier = Math.sin(TAU * carrierHz * timeSeconds);
    const envelope = 1 + modulationIndex * Math.sin(TAU * modulationHz * timeSeconds);
    values[n] = amplitude * envelope * carrier;
  }
  return values;
}

/**
 * Frequency modulation:
 *   x[n] = amplitude * sin(2*pi*fc*t + beta*sin(2*pi*fm*t)),
 *   beta = frequencyDeviationHz / modulationHz (the modulation index).
 * modulationHz must be non-zero (RangeError otherwise); a negative deviation
 * or modulation frequency is mathematically valid and simply flips the sign
 * of beta.
 */
export function generateFm(
  spec: SignalSpec & {
    carrierHz: number;
    modulationHz: number;
    frequencyDeviationHz: number;
    amplitude: number;
  },
): Float64Array {
  const sampleCount = sampleCountOf(spec, "generateFm");
  const { carrierHz, modulationHz, frequencyDeviationHz, amplitude } = spec;
  assertFiniteParam(carrierHz, "generateFm: carrierHz");
  assertFiniteParam(modulationHz, "generateFm: modulationHz");
  assertFiniteParam(frequencyDeviationHz, "generateFm: frequencyDeviationHz");
  assertFiniteParam(amplitude, "generateFm: amplitude");
  if (modulationHz === 0) {
    throw new RangeError("generateFm: modulationHz must be non-zero");
  }

  const values = new Float64Array(sampleCount);
  const modulationIndex = frequencyDeviationHz / modulationHz;
  for (let n = 0; n < sampleCount; n += 1) {
    const timeSeconds = n / spec.sampleRateHz;
    const phase =
      TAU * carrierHz * timeSeconds + modulationIndex * Math.sin(TAU * modulationHz * timeSeconds);
    values[n] = amplitude * Math.sin(phase);
  }
  return values;
}
