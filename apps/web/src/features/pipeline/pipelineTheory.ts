import type { TheorySection } from "../theory/TheoryPanel";

export const PIPELINE_THEORY_TITLE_KEY = "pipeline.theory.title";

export const PIPELINE_THEORY_SECTIONS: readonly TheorySection[] = [
  {
    headingKey: "pipeline.theory.sampling.heading",
    bodyKey: "pipeline.theory.sampling.body",
    formula:
      "f_s > 2f_{\\max},\\qquad f_{\\text{alias}} = \\left|f - f_s\\,\\mathrm{round}(f/f_s)\\right|",
  },
  {
    headingKey: "pipeline.theory.filtering.heading",
    bodyKey: "pipeline.theory.filtering.body",
    formula: "y[n] = \\sum_{k=0}^{M} b_k\\,x[n-k] - \\sum_{k=1}^{N} a_k\\,y[n-k]",
  },
  {
    headingKey: "pipeline.theory.quantization.heading",
    bodyKey: "pipeline.theory.quantization.body",
    formula:
      "\\Delta = \\frac{2A}{2^N},\\qquad \\mathrm{SNR}_{\\text{ideal}} \\approx 6.02N + 1.76\\ \\mathrm{dB}",
  },
  {
    headingKey: "pipeline.theory.codec.heading",
    bodyKey: "pipeline.theory.codec.body",
    formula:
      "R = \\frac{\\text{bits}}{\\text{sample}},\\qquad \\text{MDCT: } X[k] = \\sum_{n=0}^{2M-1} x[n]\\,w[n]\\cos\\!\\left(\\frac{\\pi}{M}\\left(n+\\frac12+\\frac{M}{2}\\right)\\left(k+\\frac12\\right)\\right)",
  },
  {
    headingKey: "pipeline.theory.reverb.heading",
    bodyKey: "pipeline.theory.reverb.body",
    formula: "y[n] = (x * h)[n] = \\sum_{m=0}^{L-1} h[m]\\,x[n-m]",
  },
  {
    headingKey: "pipeline.theory.timeStretch.heading",
    bodyKey: "pipeline.theory.timeStretch.body",
    formula:
      "\\alpha = \\frac{\\text{output length}}{\\text{input length}},\\qquad f_{\\text{out}} = f_{\\text{in}}",
  },
  {
    headingKey: "pipeline.theory.order.heading",
    bodyKey: "pipeline.theory.order.body",
    formula: "\\text{filter} \\circ \\text{reverse} \\neq \\text{reverse} \\circ \\text{filter}",
  },
  {
    headingKey: "pipeline.theory.fanOut.heading",
    bodyKey: "pipeline.theory.fanOut.body",
    formula: "y_A = Q(x),\\qquad y_B = (x * h)[n]",
  },
];
