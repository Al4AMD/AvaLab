import { FILTER_THEORY_SECTIONS, FILTER_THEORY_TITLE_KEY } from "../filters/filterTheory";
import { PIPELINE_THEORY_SECTIONS, PIPELINE_THEORY_TITLE_KEY } from "../pipeline/pipelineTheory";
import {
  PSYCHOACOUSTICS_THEORY_SECTIONS,
  PSYCHOACOUSTICS_THEORY_TITLE_KEY,
} from "../psychoacoustics/theory";
import type { TheorySection } from "./TheoryPanel";

export type ToolTheoryEntry = {
  readonly titleKey: string;
  readonly sections: readonly TheorySection[];
};

export type TheoryToolId =
  | "waveform"
  | "spectrogram"
  | "fftview"
  | "filters"
  | "generator"
  | "speed"
  | "sampling"
  | "extent"
  | "reverb"
  | "spectrum-edit"
  | "codec-lab"
  | "metrics"
  | "psychoacoustics"
  | "pipeline";

/**
 * Tool-scoped theory content keyed by route id. The AI lab keeps its own
 * per-task content in `features/ai/aiTheory.ts` because one route hosts six
 * unrelated tasks.
 */
export const TOOL_THEORY: Record<TheoryToolId, ToolTheoryEntry> = {
  waveform: {
    titleKey: "waveform.theory.title",
    sections: [
      {
        headingKey: "waveform.theory.sampling.heading",
        bodyKey: "waveform.theory.sampling.body",
        formula: "x[n]=x(nT_s),\\qquad T_s=\\frac{1}{f_s}",
      },
      {
        headingKey: "waveform.theory.pitfalls.heading",
        bodyKey: "waveform.theory.pitfalls.body",
      },
      {
        headingKey: "channel.theory.heading",
        bodyKey: "channel.theory.body",
      },
    ],
  },
  spectrogram: {
    titleKey: "spectrogram.theory.title",
    sections: [
      {
        headingKey: "spectrogram.theory.stft.heading",
        bodyKey: "spectrogram.theory.stft.body",
        formula: "X_m[k]=\\sum_{n=0}^{N-1}x[n+mH]\\,w[n]\\,e^{-j2\\pi kn/N}",
      },
      {
        headingKey: "spectrogram.theory.resolution.heading",
        bodyKey: "spectrogram.theory.resolution.body",
        formula:
          "\\Delta t=\\frac{N_{\\mathrm{hop}}}{f_s},\\qquad \\Delta f=\\frac{f_s}{N_{\\mathrm{FFT}}}",
      },
      {
        headingKey: "channel.theory.heading",
        bodyKey: "channel.theory.body",
      },
    ],
  },
  fftview: {
    titleKey: "fftview.theory.title",
    sections: [
      {
        headingKey: "fftview.theory.dft.heading",
        bodyKey: "fftview.theory.dft.body",
        formula: "X[k]=\\sum_{n=0}^{N-1}x[n]e^{-j2\\pi kn/N}",
      },
      {
        headingKey: "fftview.theory.window.heading",
        bodyKey: "fftview.theory.window.body",
        formula: "X_w[k]=\\sum_{n=0}^{N-1}x[n]w[n]e^{-j2\\pi kn/N}",
      },
      {
        headingKey: "fftview.theory.phase.heading",
        bodyKey: "fftview.theory.phase.body",
      },
      {
        headingKey: "channel.theory.heading",
        bodyKey: "channel.theory.body",
      },
    ],
  },
  filters: {
    titleKey: FILTER_THEORY_TITLE_KEY,
    sections: FILTER_THEORY_SECTIONS,
  },
  generator: {
    titleKey: "generator.theory.title",
    sections: [
      {
        headingKey: "generator.theory.fourier.heading",
        bodyKey: "generator.theory.fourier.body",
        formula: "x(t)=\\sum_{k=-\\infty}^{\\infty}c_k e^{j2\\pi kf_0t}",
      },
      {
        headingKey: "generator.theory.gibbs.heading",
        bodyKey: "generator.theory.gibbs.body",
        formula:
          "G=\\frac{1}{\\pi}\\int_0^{\\pi}\\frac{\\sin t}{t}\\,dt-\\frac{1}{2}\\approx 0.0895",
      },
      {
        headingKey: "generator.theory.preview.heading",
        bodyKey: "generator.theory.preview.body",
      },
    ],
  },
  speed: {
    titleKey: "speed.theory.title",
    sections: [
      {
        headingKey: "speed.theory.resample.heading",
        bodyKey: "speed.theory.resample.body",
        formula:
          "f_{\\mathrm{out}}=r f_{\\mathrm{in}},\\qquad T_{\\mathrm{out}}=\\frac{T_{\\mathrm{in}}}{r}",
      },
      {
        headingKey: "speed.theory.vocoder.heading",
        bodyKey: "speed.theory.vocoder.body",
        formula: "\\Delta\\varphi_k[m]=\\angle\\!\\left(X_k[m]X_k^{*}[m-1]\\right)-\\omega_k H",
      },
      {
        headingKey: "speed.theory.reverse.heading",
        bodyKey: "speed.theory.reverse.body",
        formula: "x_{\\mathrm{rev}}[n]=x[N-1-n]",
      },
    ],
  },
  sampling: {
    titleKey: "sampling.theory.title",
    sections: [
      {
        headingKey: "sampling.theory.nyquist.heading",
        bodyKey: "sampling.theory.nyquist.body",
        formula: "x[n]=x(nT_s),\\qquad f_s>2f_{\\max}",
      },
      {
        headingKey: "sampling.theory.alias.heading",
        bodyKey: "sampling.theory.alias.body",
        formula: "f_{\\mathrm{alias}}=\\left|f-f_s\\,\\mathrm{round}(f/f_s)\\right|",
      },
      {
        headingKey: "sampling.theory.quantization.heading",
        bodyKey: "sampling.theory.quantization.body",
        formula:
          "\\Delta=\\frac{2A}{2^N},\\qquad \\mathrm{SNR}_{\\text{ideal}}\\approx 6.02N+1.76\\ \\mathrm{dB}",
      },
    ],
  },
  extent: {
    titleKey: "extent.theory.title",
    sections: [
      {
        headingKey: "extent.theory.energy.heading",
        bodyKey: "extent.theory.energy.body",
        formula: "E=\\sum_{n}|x[n]|^2,\\qquad P=\\frac{1}{N}\\sum_{n=0}^{N-1}|x[n]|^2",
      },
      {
        headingKey: "extent.theory.resolution.heading",
        bodyKey: "extent.theory.resolution.body",
        formula: "\\Delta f=\\frac{f_s}{N}",
      },
      {
        headingKey: "extent.theory.timeScale.heading",
        bodyKey: "extent.theory.timeScale.body",
        formula: "x(at)\\;\\longleftrightarrow\\;\\frac{1}{|a|}X\\!\\left(\\frac{f}{a}\\right)",
      },
    ],
  },
  reverb: {
    titleKey: "reverb.theory.title",
    sections: [
      {
        headingKey: "reverb.theory.convolution.heading",
        bodyKey: "reverb.theory.convolution.body",
        formula: "y[n]=(x*h)[n]=\\sum_{m=0}^{L-1}h[m]x[n-m]",
      },
      {
        headingKey: "reverb.theory.ir.heading",
        bodyKey: "reverb.theory.ir.body",
        formula: "h[n]=w[n]e^{-6.91n/(RT60\\,f_s)}",
      },
      {
        headingKey: "reverb.theory.direct.heading",
        bodyKey: "reverb.theory.direct.body",
      },
    ],
  },
  "spectrum-edit": {
    titleKey: "spectrumEdit.theory.title",
    sections: [
      {
        headingKey: "spectrumEdit.theory.inverse.heading",
        bodyKey: "spectrumEdit.theory.inverse.body",
        formula: "x[n]=\\frac{1}{N}\\sum_{k=0}^{N-1}X[k]e^{j2\\pi kn/N}",
      },
      {
        headingKey: "spectrumEdit.theory.hermitian.heading",
        bodyKey: "spectrumEdit.theory.hermitian.body",
        formula: "X[N-k]=X^{*}[k]",
      },
      {
        headingKey: "spectrumEdit.theory.lanes.heading",
        bodyKey: "spectrumEdit.theory.lanes.body",
      },
      {
        headingKey: "spectrumEdit.theory.gibbs.heading",
        bodyKey: "spectrumEdit.theory.gibbs.body",
      },
    ],
  },
  "codec-lab": {
    titleKey: "codecLab.theory.title",
    sections: [
      {
        headingKey: "codecLab.theory.headings.entropy",
        bodyKey: "codecLab.theory.huffman",
        formula: "H=-\\sum_{i}p_i\\log_2 p_i",
        bulletKeys: ["codecLab.theory.rle", "codecLab.theory.delta"],
      },
      {
        headingKey: "codecLab.theory.headings.companding",
        bodyKey: "codecLab.theory.companding",
      },
      {
        headingKey: "codecLab.theory.headings.mdct",
        bodyKey: "codecLab.theory.mdct",
        formula: "R=\\frac{\\text{bits per second}}{1000}\\ \\mathrm{kbps}",
      },
      {
        headingKey: "codecLab.theory.lanes.heading",
        bodyKey: "codecLab.theory.lanes.body",
      },
      {
        headingKey: "codecLab.theory.observe.title",
        bodyKey: "codecLab.theory.observe.body",
        bulletKeys: [
          "codecLab.theory.observe.lossless",
          "codecLab.theory.observe.entropy",
          "codecLab.theory.observe.bitrate",
          "codecLab.theory.observe.sparsity",
        ],
      },
    ],
  },
  metrics: {
    titleKey: "metrics.theory.title",
    sections: [
      {
        headingKey: "metrics.theory.headings.snr",
        bodyKey: "metrics.theory.energy",
        formula: "\\mathrm{SNR}=10\\log_{10}\\!\\left(\\frac{P_s}{P_e}\\right)",
      },
      {
        headingKey: "metrics.theory.headings.segmental",
        bodyKey: "metrics.theory.segmental",
        formula:
          "\\mathrm{SNR}_{\\mathrm{seg}}=\\frac{1}{M}\\sum_{m=1}^{M}10\\log_{10}\\!\\left(\\frac{P_{s,m}}{P_{e,m}}\\right)",
      },
      {
        headingKey: "metrics.theory.headings.psnr",
        bodyKey: "metrics.theory.psnr",
        formula:
          "\\mathrm{PSNR}=10\\log_{10}\\!\\left(\\frac{A^2}{\\mathrm{MSE}}\\right),\\qquad A=1",
      },
      {
        headingKey: "metrics.observe.title",
        bodyKey: "metrics.observe.body",
        bulletKeys: [
          "metrics.observe.lossless",
          "metrics.observe.lossy",
          "metrics.observe.bitrate",
        ],
      },
      {
        headingKey: "channel.theory.heading",
        bodyKey: "channel.theory.body",
      },
    ],
  },
  psychoacoustics: {
    titleKey: PSYCHOACOUSTICS_THEORY_TITLE_KEY,
    sections: PSYCHOACOUSTICS_THEORY_SECTIONS,
  },
  pipeline: {
    titleKey: PIPELINE_THEORY_TITLE_KEY,
    sections: PIPELINE_THEORY_SECTIONS,
  },
};
