/**
 * Purpose: the single complex-valued spectrum representation shared by every
 * Fourier-domain tool in @avalab/dsp (F08, F09, F11, ...). A spectrum is two
 * parallel Float64Arrays so transforms stay allocation-friendly and run in
 * Workers / AudioWorklets / Node tests alike.
 *
 * Formula: n/a (data type). Re{X[k]} and Im{X[k]} are stored separately.
 *
 * Reference: AGENTS section 11 (DSP library rules; Float64 internals).
 *
 * Complexity: n/a (plain data container, no methods).
 *
 * Edge cases: callers own length and finiteness contracts; algorithms document
 * them (e.g. idftNaive requires re.length === im.length and rejects non-finite
 * values).
 */

export interface Complex {
  re: Float64Array;
  im: Float64Array;
}
