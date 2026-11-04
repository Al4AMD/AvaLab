import type { TheorySection } from "../theory/TheoryPanel";
import type { AiTask } from "./aiState";

export type AiTheoryEntry = {
  readonly titleKey: string;
  readonly sections: readonly TheorySection[];
};

export const AI_THEORY: Record<AiTask, AiTheoryEntry> = {
  denoise: {
    titleKey: "ai.theory.denoise.title",
    sections: [
      {
        headingKey: "ai.theory.denoise.concept.heading",
        bodyKey: "ai.theory.denoise.concept.body",
        formula: "\\hat{X}(f,t)=G_\\theta(f,t)\\,X(f,t)",
      },
      {
        headingKey: "ai.theory.denoise.observe.heading",
        bodyKey: "ai.theory.denoise.observe.body",
        bulletKeys: [
          "ai.theory.denoise.observe.bullets.noise",
          "ai.theory.denoise.observe.bullets.artifacts",
          "ai.theory.denoise.observe.bullets.shape",
        ],
      },
      {
        headingKey: "ai.theory.denoise.pitfalls.heading",
        bodyKey: "ai.theory.denoise.pitfalls.body",
        bulletKeys: [
          "ai.theory.denoise.pitfalls.bullets.speechLoss",
          "ai.theory.denoise.pitfalls.bullets.notRecovered",
        ],
      },
    ],
  },
  superres: {
    titleKey: "ai.theory.superres.title",
    sections: [
      {
        headingKey: "ai.theory.superres.concept.heading",
        bodyKey: "ai.theory.superres.concept.body",
        formula:
          "\\hat{x}_{\\mathrm{HR}}(n)=\\mathcal{G}_\\theta(x_{\\mathrm{LR}})(n),\\qquad f_s^{\\mathrm{HR}}=2f_c",
      },
      {
        headingKey: "ai.theory.superres.observe.heading",
        bodyKey: "ai.theory.superres.observe.body",
        bulletKeys: [
          "ai.theory.superres.observe.bullets.spectrum",
          "ai.theory.superres.observe.bullets.brightness",
          "ai.theory.superres.observe.bullets.plausibility",
        ],
      },
      {
        headingKey: "ai.theory.superres.pitfalls.heading",
        bodyKey: "ai.theory.superres.pitfalls.body",
        bulletKeys: [
          "ai.theory.superres.pitfalls.bullets.invented",
          "ai.theory.superres.pitfalls.bullets.rates",
        ],
      },
    ],
  },
  separation: {
    titleKey: "ai.theory.separation.title",
    sections: [
      {
        headingKey: "ai.theory.separation.concept.heading",
        bodyKey: "ai.theory.separation.concept.body",
        formula:
          "\\hat{s}_k(f,t)=M_k(f,t)\\,X(f,t),\\qquad x(t)\\approx\\sum_{k=1}^{K}\\hat{s}_k(t)",
      },
      {
        headingKey: "ai.theory.separation.observe.heading",
        bodyKey: "ai.theory.separation.observe.body",
        bulletKeys: [
          "ai.theory.separation.observe.bullets.solo",
          "ai.theory.separation.observe.bullets.bleed",
          "ai.theory.separation.observe.bullets.sum",
        ],
      },
      {
        headingKey: "ai.theory.separation.pitfalls.heading",
        bodyKey: "ai.theory.separation.pitfalls.body",
        bulletKeys: [
          "ai.theory.separation.pitfalls.bullets.notTracks",
          "ai.theory.separation.pitfalls.bullets.excerpt",
        ],
      },
    ],
  },
  asr: {
    titleKey: "ai.theory.asr.title",
    sections: [
      {
        headingKey: "ai.theory.asr.concept.heading",
        bodyKey: "ai.theory.asr.concept.body",
        formula: "\\mathrm{WER}=\\frac{S+D+I}{N}",
      },
      {
        headingKey: "ai.theory.asr.observe.heading",
        bodyKey: "ai.theory.asr.observe.body",
        bulletKeys: [
          "ai.theory.asr.observe.bullets.reference",
          "ai.theory.asr.observe.bullets.bitrate",
          "ai.theory.asr.observe.bullets.normalization",
        ],
      },
      {
        headingKey: "ai.theory.asr.pitfalls.heading",
        bodyKey: "ai.theory.asr.pitfalls.body",
        bulletKeys: [
          "ai.theory.asr.pitfalls.bullets.alignment",
          "ai.theory.asr.pitfalls.bullets.persian",
        ],
      },
    ],
  },
  "neural-codec": {
    titleKey: "ai.theory.neuralCodec.title",
    sections: [
      {
        headingKey: "ai.theory.neuralCodec.concept.heading",
        bodyKey: "ai.theory.neuralCodec.concept.body",
        formula:
          "\\hat{\\mathbf{x}}=\\mathcal{D}\\!\\left(\\sum_{q=1}^{Q}\\mathbf{e}_{q,k_q}\\right),\\qquad R=\\frac{Q\\log_2 K}{T}",
      },
      {
        headingKey: "ai.theory.neuralCodec.observe.heading",
        bodyKey: "ai.theory.neuralCodec.observe.body",
        bulletKeys: [
          "ai.theory.neuralCodec.observe.bullets.bitrates",
          "ai.theory.neuralCodec.observe.bullets.rateDistortion",
          "ai.theory.neuralCodec.observe.bullets.artifacts",
        ],
      },
      {
        headingKey: "ai.theory.neuralCodec.pitfalls.heading",
        bodyKey: "ai.theory.neuralCodec.pitfalls.body",
        bulletKeys: [
          "ai.theory.neuralCodec.pitfalls.bullets.alignment",
          "ai.theory.neuralCodec.pitfalls.bullets.stages",
        ],
      },
    ],
  },
};
