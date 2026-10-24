/**
 * Purpose: phase-vocoder time-stretch (tempo change, pitch preserved) and
 * pitch-shift (pitch change, duration preserved) for the F06 "Playback
 * control" lab. The vocoder analyzes the signal with the STFT, advances every
 * analysis frame's phase by its own (per-bin) true phase difference so the
 * output frames re-synthesize at a slower/faster hop, and normalizes the
 * overlap-add by the summed synthesis-window energy. Pitch-shift composes the
 * vocoder (duration change) with rational resampling (rate change) so the
 * duration cancels back to the input length.
 *
 * Pinned conventions (plan 04 Task 6 + controller rulings R10-R13, see
 * .superpowers/sdd/04-codecs-and-time/progress.md):
 *
 *   analysis hop H_a = floor(windowLengthSamples / 4)
 *   synthesis hop H_s = max(1, round(H_a * stretchFactor))
 *   output length = round(sampleCount * stretchFactor), contributions of
 *   frames whose overlap-add tail passes the output length are discarded
 *   ("clamped"); the pinned length contract intentionally loses the last
 *   partial synthesis frames' tail beyond round(N*r) samples.
 *   window: periodic Hann on analysis AND synthesis (pinned by the plan; other
 *   window kinds are deliberately not exposed — the WOLA reconstruction and
 *   the 75% overlap analysis below are validated for Hann only).
 *
 * Phase propagation (Flanagan & Golden 1966; Dolson 1986), per bin k of the
 * F-bin transform (F = windowLengthSamples), for frames m >= 1, with omega_k =
 * 2*pi*k/F:
 *
 *   expected     = omega_k * H_a            (phase advance of bin k per
 *                                            analysis hop: bin-centered tone)
 *   deviation    = wrap(phi_a[m][k] - phi_a[m-1][k] - expected)
 *                                             (the "..true phase difference..
 *                                              minus expected" term, wrapped
 *                                             into (-pi, pi])
 *   phi_s[m][k]  = phi_s[m-1][k] + omega_k * H_s + deviation * (H_s / H_a)
 *
 * phi_s is stored wrapped into (-pi, pi] after every update (phases are
 * periodic, so this only controls floating-point argument-reduction error).
 * Frame 0 is passed through unmodified: its spectrum is already the
 * synthesis spectrum (phi_s[0] = phi_a[0]), which makes stretchFactor 1 an
 * identity-equivalent path up to overlap-add roundoff.
 *
 * The deviation term carries the bin's actual (not bin-centered) frequency
 * progression; scaling it by the hop ratio H_s/H_a converts the phase
 * progression from rad per analysis sample to rad per synthesis sample, so a
 * tone at ANY frequency keeps its instantaneous frequency after stretching:
 * per output sample the synth phase advances
 *   (omega_k * H_s + deviation * H_s/H_a) / H_s
 *   = omega_k + deviation / H_a          (the estimate of the true omega)
 * while the time scale changed by the hop ratio. Note the deviation MUST be
 * scaled by the hop ratio (R11 lists the unscaled form literally; the scaled
 * form is the standard Dolson propagator and the one that keeps instantaneous
 * frequency independent of the stretch factor — decision recorded in the task
 * report, a deviation note).
 *
 * Magnitudes are reused from the analysis frames unchanged (phase-vocoder
 * premise: the magnitude spectrum is stationary relative to the phase
 * modifications). Only bins 0..ceil(F/2)-1 are measured and propagated; the
 * remaining bins are filled with the conjugate of their Hermitian partner
 * (bin F-k), which keeps the output spectrum Hermitian-symmetric so every
 * inverse transform is real up to roundoff. Bins 0 and F/2 (even F) are their
 * own partners and one-sided: any imaginary residue they pick up from the
 * phase rotation is discarded by taking the real part of the inverse
 * transform (the same convention as librosa's phase_vocoder); for
 * stretchFactor = 1 the rotation is exact and discards nothing.
 *
 * Synthesis: window the inverse-transformed frame with the SAME Hann window
 * (weighted overlap-add, Griffin & Lim 1984), overlap-add at the synthesis
 * hop, and divide every output sample by
 *   S[n] = sum_m w[n - m*H_s]^2
 * over the frames that cover n. For periodic Hann and 75% overlap the
 * interior sum is a constant (1.5 at hop L/4), but frames do not cover the
 * first L-H_s-1 samples uniformly, so the per-sample normalization must be
 * tracked explicitly. S[n] < 1e-12 yields 0 for that sample instead of a
 * division by zero (R12).
 *
 * pitchShift (R13, see deviation note):
 *   q = 2^(semitones / 12)
 *   stretched = timeStretch(x, {stretchFactor: q, windowLengthSamples})
 *   resampled = resampleRational(stretched, {inputRateHz: sampleRateHz,
 *                                            outputRateHz: round(sampleRateHz / q),
 *                                            filter: "kaiserSinc"})
 * Playing the resampled array at the original rate raises the content pitch
 * by sampleRateHz/outputRateHz = q and the resampler cancels the stretch's
 * duration change (length N*q at rate fs -> round(N*q*(fs/q)/fs) = N). The
 * output is then trimmed or zero-padded deterministically to exactly
 * sampleCount (R13: "output length = original count"), so the duration
 * contract is exact regardless of the resampler's rounding.
 *
 * Known artifacts, stated honestly: the phase vocoder smears transient events
 * across the stretched time axis (a drum hit stretching 2x lasts 2x) because
 * each frame's phase is propagated independently per bin; vertical coherence
 * between adjacent bins is not phase-locked (Laroche & Dolson 1999 do that as
 * the next refinement). Tonal content stays clean; broadband transients
 * pre-ringing is the classic symptom. unnormalized magnitudes + per-bin
 * propagation makes stretchFactor = 1 reconstruct the input to float64
 * overlap-add precision (<= 1e-6 pinned in tests, measured ~1e-12).
 *
 * Reference: J. L. Flanagan & R. M. Golden, "Phase vocoder", Bell System
 * Technical Journal 45(9), 1966; M. Dolson, "The phase vocoder: a tutorial",
 * Computer Music Journal 10(4), 1986; J. Laroche & M. Dolson, "Improved
 * phase-vocoder time-scale modification of audio", IEEE Trans. Speech Audio
 * Process. 7(3), 1999 (phase locking — future refinement, not implemented);
 * D. Griffin & J. S. Lim, "Signal estimation from modified short-time Fourier
 * transform", IEEE Trans. ASSP 32(2), 1984 (weighted overlap-add).
 *
 * Complexity: O(M * F log F) time with M = ceil(sampleCount / H_a) analysis
 * frames and F = windowLengthSamples (analysis + inverse transforms), plus
 * O(M * L) overlap-add; O(outputLength) space beyond the frame spectra.
 *
 * Edge cases: empty input -> empty output (both functions, after parameter
 * validation). sampleCount * stretchFactor that rounds to 0 -> empty. A
 * non-finite sample -> TypeError. stretchFactor / semitones that are
 * non-finite, or stretchFactor <= 0 -> RangeError; windowLengthSamples must
 * be an integer >= 8, pitchShift's sampleRateHz finite > 0 -> RangeError
 * otherwise; timeStretch rejects a stretch factor whose rounded output
 * length would not be a safe integer. pitchShift inherits resampleRational's
 * guards (integer rates, safe-integer length) and maps semitones 0 through a
 * same-rate resample passthrough. Inputs are never mutated; every call
 * returns a fresh Float64Array.
 *
 * Deviation from R11: the synthesis phase advance multiplies the wrapped
 * deviation by the hop ratio H_s/H_a (the standard Dolson formulation that
 * preserves instantaneous frequency under time-scaling); R11's literal line
 * shows the unscaled sum.
 *
 * Deviation from R13: R13's literal reading (stretch by 2^(-semitones/12)
 * then resample to sampleRateHz/2^(-semitones/12)) produced an inverted
 * pitch direction when measured (positive semitones lowered the peak). The
 * reciprocal convention above is used so that positive semitones RAISE the
 * pitch (the plan's Review contract: pitchShift +12 doubles the dominant
 * 440 Hz peak to 880 Hz); semitones 0 still passes through unchanged.
 */

import type { Complex } from "../fourier/complex.js";
import { stft } from "../fourier/stft.js";
import { ifft } from "../fourier/transform.js";
import { window as periodicWindow } from "../fourier/windows.js";
import { resampleRational } from "../resample/resample.js";

export interface TimeStretchParams {
  /** Time-scale factor: > 1 slows the audio down (longer output). */
  stretchFactor: number;
  /** STFT frame length in samples (integer >= 8); hop is floor(L/4). */
  windowLengthSamples: number;
}

export interface PitchShiftParams {
  /** Pitch shift in 12-tone equal temperament semitones (may be fractional). */
  semitones: number;
  /** STFT frame length in samples (integer >= 8), passed to timeStretch. */
  windowLengthSamples: number;
  /**
   * Sample rate of the input audio in Hz (finite positive; must be an integer
   * unless semitones = 0, because the resampler builds a rational rate pair).
   */
  sampleRateHz: number;
}

/** Minimum window length (R10). */
const MIN_WINDOW_LENGTH_SAMPLES = 8;
/** Synthesis normalization floor (R12): sums below this yield 0. */
const WINDOW_ENERGY_FLOOR = 1e-12;

/**
 * Wrap an angle into (-pi, pi]. floor((x+pi)/2pi) maps x into [-pi, pi); the
 * exact -pi boundary is pushed up to +pi to honor the ruling's half-open
 * interval.
 */
function wrapAngle(angle: number): number {
  const doubledPi = 2 * Math.PI;
  const wrapped = angle - doubledPi * Math.floor((angle + Math.PI) / doubledPi);
  return wrapped <= -Math.PI ? wrapped + doubledPi : wrapped;
}

function assertWindowLengthSamples(windowLengthSamples: number, caller: string): void {
  if (!Number.isInteger(windowLengthSamples) || windowLengthSamples < MIN_WINDOW_LENGTH_SAMPLES) {
    throw new RangeError(
      `${caller}: windowLengthSamples must be an integer >= ${MIN_WINDOW_LENGTH_SAMPLES} ` +
        `(got ${windowLengthSamples})`,
    );
  }
}

/**
 * Stretch `x` in time by `stretchFactor` with the phase vocoder: length
 * round(N * stretchFactor), pitch unchanged, transients smeared (see header).
 */
export function timeStretch(x: Float64Array, params: TimeStretchParams): Float64Array {
  const caller = "timeStretch";
  const stretchFactor: number = params?.stretchFactor;
  const L: number = params?.windowLengthSamples;
  assertWindowLengthSamples(L, caller);
  if (!Number.isFinite(stretchFactor) || stretchFactor <= 0) {
    throw new RangeError(
      `${caller}: stretchFactor must be a finite number > 0 (got ${stretchFactor})`,
    );
  }
  for (let n = 0; n < x.length; n += 1) {
    const sample: number | undefined = x[n];
    if (sample === undefined) {
      throw new TypeError(`${caller}: x[${n}] read out of bounds`);
    }
    if (!Number.isFinite(sample)) {
      throw new TypeError(`${caller}: x[${n}] must be finite (got ${sample})`);
    }
  }
  const outputLength = Math.round(x.length * stretchFactor);
  if (!Number.isSafeInteger(outputLength) || outputLength < 0) {
    throw new RangeError(
      `${caller}: output length round(${x.length} * ${stretchFactor}) must be a ` +
        `non-negative safe integer (got ${outputLength})`,
    );
  }
  if (x.length === 0 || outputLength === 0) {
    return new Float64Array(0);
  }

  const analysisHop = Math.floor(L / 4);
  const synthesisHop = Math.max(1, Math.round(analysisHop * stretchFactor));
  const hopRatio = synthesisHop / analysisHop;
  const hann = periodicWindow("hann", L);

  const analysis = stft(x, {
    frameLengthSamples: L,
    hopLengthSamples: analysisHop,
    fftLengthSamples: L,
    window: hann,
  });
  const frames = analysis.frames;

  // Only frames whose start lands before the output's end contribute to the
  // overlap-add (their tails beyond outputLength are discarded, R10).
  const synthesizedFrames = Math.min(
    frames.length,
    Math.max(1, Math.ceil(outputLength / synthesisHop)),
  );

  const accumulated = new Float64Array(outputLength);
  const windowEnergy = new Float64Array(outputLength);
  // Number of propagated bins: 0..floor(F/2) inclusive — for even F this is
  // L/2+1 bins and covers the Nyquist self-bin; for odd F it is (F+1)/2 and
  // ceil(F/2) would coincidentally match, which is why floor+1 is used.
  const halfBins = Math.floor(L / 2) + 1;

  const reSynth = new Float64Array(L);
  const imSynth = new Float64Array(L);
  const phasesSynth = new Float64Array(halfBins);
  const phasesPrevious = new Float64Array(halfBins);
  // Precomputed per-bin wrapped phase advances (keeps every wrap argument
  // small regardless of H_a, H_s and bin index sizes).
  const expectedAnalysis = new Float64Array(halfBins);
  const expectedSynthesis = new Float64Array(halfBins);
  for (let k = 0; k < halfBins; k += 1) {
    const omegaK = (2 * Math.PI * k) / L;
    expectedAnalysis[k] = wrapAngle(omegaK * analysisHop);
    expectedSynthesis[k] = wrapAngle(omegaK * synthesisHop);
  }

  for (let frameIndex = 0; frameIndex < synthesizedFrames; frameIndex += 1) {
    const frame: Complex | undefined = frames[frameIndex];
    if (frame === undefined) {
      throw new TypeError(`${caller}: analysis frame ${frameIndex} read out of bounds`);
    }
    if (frameIndex === 0) {
      // Frame 0 is the synthesis spectrum as-is; seed the phase trackers.
      reSynth.set(frame.re);
      imSynth.set(frame.im);
      for (let k = 0; k < halfBins; k += 1) {
        const re: number | undefined = frame.re[k];
        const im: number | undefined = frame.im[k];
        if (re === undefined || im === undefined) {
          throw new TypeError(`${caller}: analysis frame 0 bin ${k} read out of bounds`);
        }
        const phase = Math.atan2(im, re);
        phasesSynth[k] = phase;
        phasesPrevious[k] = phase;
      }
    } else {
      for (let k = 0; k < halfBins; k += 1) {
        const re: number | undefined = frame.re[k];
        const im: number | undefined = frame.im[k];
        if (re === undefined || im === undefined) {
          throw new TypeError(
            `${caller}: analysis frame ${frameIndex} bin ${k} read out of bounds`,
          );
        }
        const phasePrevious: number | undefined = phasesPrevious[k];
        const expectedAnalysisK: number | undefined = expectedAnalysis[k];
        const expectedSynthesisK: number | undefined = expectedSynthesis[k];
        const phaseSynthK: number | undefined = phasesSynth[k];
        if (
          phasePrevious === undefined ||
          expectedAnalysisK === undefined ||
          expectedSynthesisK === undefined ||
          phaseSynthK === undefined
        ) {
          throw new TypeError(`${caller}: bin ${k} phase bookkeeping read out of bounds`);
        }
        const magnitude = Math.sqrt(re * re + im * im);
        const phaseAnalysis = Math.atan2(im, re);
        const deviation = wrapAngle(wrapAngle(phaseAnalysis - phasePrevious) - expectedAnalysisK);
        const nextPhase = wrapAngle(phaseSynthK + expectedSynthesisK + deviation * hopRatio);
        phasesSynth[k] = nextPhase;
        phasesPrevious[k] = phaseAnalysis;
        const reRotated = magnitude * Math.cos(nextPhase);
        const imRotated = magnitude * Math.sin(nextPhase);
        reSynth[k] = reRotated;
        imSynth[k] = imRotated;
        // Hermitian partner: X[F-k] = conj(X[k]) keeps the frame real. Bins
        // that are their own partner (0, and F/2 for even F) stay one-sided;
        // bin 0's partner F would fall outside the array, so skip it.
        const mirroredBin = L - k;
        if (mirroredBin !== k && mirroredBin < L) {
          reSynth[mirroredBin] = reRotated;
          imSynth[mirroredBin] = -imRotated;
        }
      }
    }

    const timeFrame = ifft({ re: reSynth, im: imSynth });
    const start = frameIndex * synthesisHop;
    for (let n = 0; n < L; n += 1) {
      const position = start + n;
      if (position >= outputLength) {
        break;
      }
      const weight: number | undefined = hann[n];
      const sample: number | undefined = timeFrame[n];
      if (weight === undefined || sample === undefined) {
        throw new TypeError(
          `${caller}: synthesis frame ${frameIndex} sample ${n} read out of bounds`,
        );
      }
      accumulated[position] = (accumulated[position] ?? 0) + weight * sample;
      windowEnergy[position] = (windowEnergy[position] ?? 0) + weight * weight;
    }
  }

  const output = new Float64Array(outputLength);
  for (let n = 0; n < outputLength; n += 1) {
    const energy: number | undefined = windowEnergy[n];
    const value: number | undefined = accumulated[n];
    if (energy === undefined || value === undefined) {
      throw new TypeError(`${caller}: output sample ${n} read out of bounds`);
    }
    output[n] = energy >= WINDOW_ENERGY_FLOOR ? value / energy : 0;
  }
  return output;
}

/**
 * Shift the pitch of `x` by `semitones` (12-tone equal temperament) while
 * keeping duration: time-stretch by 2^(semitones/12), then resample back to
 * the original rate (see the header deviation note for the direction).
 * the original sample count with the pinned kaiserSinc filter (R13). Output
 * length is exactly x.length (deterministic trim / zero-pad).
 */
export function pitchShift(x: Float64Array, params: PitchShiftParams): Float64Array {
  const caller = "pitchShift";
  const semitones: number = params?.semitones;
  const sampleRateHz: number = params?.sampleRateHz;
  assertWindowLengthSamples(params?.windowLengthSamples, caller);
  if (!Number.isFinite(semitones)) {
    throw new RangeError(`${caller}: semitones must be finite (got ${semitones})`);
  }
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new RangeError(
      `${caller}: sampleRateHz must be a finite positive number (got ${sampleRateHz})`,
    );
  }
  if (x.length === 0) {
    return new Float64Array(0);
  }

  // Up-stretch (2^(semitones/12) — positive semitones lengthen, i.e. raise
  // the pitch once the resampler removes the extra duration) then resample
  // from sampleRateHz down to sampleRateHz/stretchFactor: playing the
  // resampled array at the original rate multiplies the pitch by
  // sampleRateHz/outputRateHz = 2^(semitones/12) (see header deviation note).
  const stretchFactor = 2 ** (semitones / 12);
  const stretched = timeStretch(x, {
    stretchFactor,
    windowLengthSamples: params.windowLengthSamples,
  });
  // Rates must be integers for the rational resampler; sampleRateHz is
  // validated integer-ness by resampleRational itself.
  const outputRateHz = Math.round(sampleRateHz / stretchFactor);
  const resampled = resampleRational(stretched, {
    inputRateHz: sampleRateHz,
    outputRateHz,
    filter: "kaiserSinc",
  });

  // Deterministic trim / zero-pad to exactly sampleCount (R13).
  const output = new Float64Array(x.length);
  const copyCount = Math.min(x.length, resampled.length);
  if (copyCount > 0) {
    output.set(resampled.subarray(0, copyCount));
  }
  return output;
}
