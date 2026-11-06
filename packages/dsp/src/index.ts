/**
 * Purpose: public entry point of @avalab/dsp, the pure TypeScript DSP library.
 * Wave 1 adds algorithm folders (fourier/, stft/, filters/, ...) beside utils/.
 *
 * Formula: n/a (re-export barrel).
 *
 * Reference: AGENTS section 11 (DSP library rules).
 *
 * Complexity: n/a.
 *
 * Edge cases: n/a; every exported function documents its own.
 */

export type {
  BeatAnalysis,
  PitchAnalysis,
  PitchBeatAnalysis,
} from "./analysis/pitchBeat.js";
export type { CodecLabCodec } from "./codecs/codecLabTypes.js";
export type {
  DeltaHuffmanDecoded,
  DeltaHuffmanEncoded,
} from "./codecs/delta.js";
export {
  decodeLosslessDeltaHuffman,
  deltaDecode,
  deltaEncode,
  encodeLosslessDeltaHuffman,
} from "./codecs/delta.js";
export type { CanonicalCodes, HuffmanCodebook, HuffmanEncoded } from "./codecs/huffman.js";
export {
  buildCanonicalCodes,
  buildHistogram,
  huffmanDecode,
  huffmanEncode,
  validatePrefixFree,
} from "./codecs/huffman.js";
export type {
  MdctCodecDecodeParams,
  MdctCodecEncoded,
  MdctCodecEncodeParams,
  MdctCodecStats,
} from "./codecs/mdctCodec.js";
export { decodeMdct, encodeMdct } from "./codecs/mdctCodec.js";
export type {
  MdctPsychoBandStat,
  MdctPsychoEncoded,
  MdctPsychoFrameStat,
  MdctPsychoParams,
} from "./codecs/mdctPsycho.js";
export {
  decodeMdctPsycho,
  encodeMdctPsycho,
  measureReferencePower,
  PSYCHO_REFERENCE_SPL_DB,
  PSYCHO_SIDE_INFO_BITS_PER_BAND,
} from "./codecs/mdctPsycho.js";
export type { WavPcm16Options } from "./codecs/pcmWav.js";
export {
  bytesToInt16Pcm,
  encodeWavPcm16,
  floatToInt16Pcm,
  int16PcmToBytes,
  int16PcmToFloat,
} from "./codecs/pcmWav.js";
export { rleDecode, rleEncode } from "./codecs/rle.js";
export type {
  FreqzOptions,
  FreqzResult,
  PolesZerosResult,
} from "./filters/analysis.js";
export {
  freqz,
  groupDelaySamples,
  impulseResponse,
  isStable,
  magnitudeDb,
  polesZeros,
  stepResponse,
  unwrapPhase,
} from "./filters/analysis.js";
export type {
  BiquadGainOptions,
  BiquadOptions,
} from "./filters/biquad.js";
export {
  biquadHighpass,
  biquadLowpass,
  biquadNotch,
  biquadPeaking,
} from "./filters/biquad.js";
export type {
  FirBand,
  FirWindowFilter,
  FirWindowKind,
  FirWindowOptions,
} from "./filters/fir.js";
export { designFirWindow } from "./filters/fir.js";
export type {
  ButterworthOptions,
  Chebyshev1Options,
  IirBand,
  IirCoefficients,
} from "./filters/iir.js";
export { applyFilter, designButterworth, designChebyshev1 } from "./filters/iir.js";
export { fftBluestein } from "./fourier/bluestein.js";
export type { ButterflyStep } from "./fourier/butterfly.js";
export { fftButterflySteps } from "./fourier/butterfly.js";
export type { Complex } from "./fourier/complex.js";
export { dftNaive, idftNaive } from "./fourier/dft.js";
export { fftRadix2, ifftRadix2 } from "./fourier/fft.js";
export type {
  FftBenchmarkResult,
  StftBenchmarkChunkParams,
  StftBenchmarkChunkResult,
} from "./fourier/fftBenchmark.js";
export {
  benchmarkFft,
  FFT_BENCHMARK_SIZES,
  stftBenchmarkChunk,
} from "./fourier/fftBenchmark.js";
export { irfft, rfft } from "./fourier/rfft.js";
export type {
  SpectrogramTilesParams,
  SpectrogramTilesResult,
  SpectrogramWindowFamily,
} from "./fourier/spectrogramTiles.js";
export { spectrogramTiles } from "./fourier/spectrogramTiles.js";
export type {
  SpectrumCurveEdit,
  SpectrumCurvePoint,
  SpectrumCurveTarget,
} from "./fourier/spectrumCurves.js";
export { applySpectrumCurves } from "./fourier/spectrumCurves.js";
export type {
  EditSpectrumParams,
  EditSpectrumResult,
  SpectrumEdit,
  SpectrumEditMode,
  SpectrumEditTarget,
  SpectrumPreset,
} from "./fourier/spectrumEdit.js";
export { buildSpectrumPreset, editSpectrum } from "./fourier/spectrumEdit.js";
export type { StftParams, StftResult } from "./fourier/stft.js";
export { istft, stft } from "./fourier/stft.js";
export { fft, ifft } from "./fourier/transform.js";
export type { WindowKind } from "./fourier/windows.js";
export { i0, kaiser, window, windowSymmetric } from "./fourier/windows.js";
export type { PsnrOptions, SegmentalSnrOptions } from "./metrics/basic.js";
export {
  bitrateKbps,
  compressionRatio,
  mse,
  psnrDb,
  segmentalSnrDb,
  snrDb,
} from "./metrics/basic.js";
export type { CompandingOptions } from "./metrics/companding.js";
export { alawDecode, alawEncode, mulawDecode, mulawEncode } from "./metrics/companding.js";
export { entropyBitsPerSymbol } from "./metrics/entropy.js";
export type {
  LoudnessBlock,
  LoudnessParams,
  LoudnessResult,
} from "./metrics/loudness.js";
export {
  kWeightingCoefficients,
  loudnessGainDb,
  measureLoudness,
} from "./metrics/loudness.js";
export type { TpdfDitherOptions, UniformQuantizeOptions } from "./metrics/quantize.js";
export {
  quantizationError,
  quantizeUniform,
  quantizeWithTpdfDither,
} from "./metrics/quantize.js";
export type {
  PipelineOutput,
  PipelineRunResult,
  PipelineStageSummary,
} from "./pipeline/runPipeline.js";
export { PipelineRunError, runPipeline } from "./pipeline/runPipeline.js";
export type {
  FilterApplyParams,
  PipelineEdge,
  PipelineGraph,
  PipelineNode,
  ReverbIrParams,
  ReverbProcessParams,
  XY,
} from "./pipeline/types.js";
export {
  PIPELINE_MAX_NODES,
  PIPELINE_MAX_OUTPUTS,
} from "./pipeline/types.js";
export type { PipelineErrorCode, PipelineValidation } from "./pipeline/validate.js";
export { validatePipeline } from "./pipeline/validate.js";
export {
  absoluteThresholdDb,
  bandAthDb,
  bandLevelsDb,
  barkBandEdgesHz,
  barkBandIndexOf,
  barkToHz,
  hzToBark,
  maskingThresholdDb,
  maskStepForBand,
  PSYCHO_BAND_COUNT,
  signalToMaskRatioDb,
  spreadingDb,
} from "./psychoacoustics/index.js";
export type {
  ResampleFilter,
  ResampleRationalOptions,
} from "./resample/resample.js";
export { resampleRational } from "./resample/resample.js";
export type { LowpassSincOptions } from "./resample/windowedSinc.js";
export { designLowpassSinc } from "./resample/windowedSinc.js";
export { aliasFrequencyHz } from "./signals/aliasing.js";
export type {
  FloatArray,
  SignalType,
  SupportOptions,
  SupportRange,
} from "./signals/extent.js";
export {
  averagePower,
  classifySignalType,
  periodicExtend,
  reverse,
  signalEnergy,
  support,
  timeScale,
  timeShift,
  truncate,
  zeroPad,
} from "./signals/extent.js";
export type { FourierSeriesKind, FourierSeriesSpec } from "./signals/fourierSeries.js";
export { fourierSeriesPartialSum, measureGibbsOvershoot } from "./signals/fourierSeries.js";
export type { SignalSpec } from "./signals/generators.js";
export {
  generateAm,
  generateChirp,
  generateFm,
  generateImpulse,
  generateSawtooth,
  generateSine,
  generateSquare,
  generateStep,
  generateTriangle,
  generateTwoTone,
} from "./signals/generators.js";
export { generatePinkNoise, generateWhiteNoise, mulberry32 } from "./signals/noise.js";
export type { ConvolveFftOptions } from "./systems/convolution.js";
export { convolveDirect, convolveFft, nextPowerOfTwo } from "./systems/convolution.js";
export type { SyntheticIrKind, SyntheticIrParams } from "./systems/impulseResponse.js";
export { generateSyntheticIr } from "./systems/impulseResponse.js";
export type { MdctParams, MdctResult } from "./timestretch/mdct.js";
export { imdct, mdct } from "./timestretch/mdct.js";
export type { PitchShiftParams, TimeStretchParams } from "./timestretch/phaseVocoder.js";
export { pitchShift, timeStretch } from "./timestretch/phaseVocoder.js";
export { averagePowerOf, energyOf } from "./utils/energy.js";
export { inputHash64 } from "./utils/hash.js";
export { computePeakBuckets } from "./utils/peaks.js";
export { samplesToSeconds, secondsToSamples } from "./utils/time.js";
