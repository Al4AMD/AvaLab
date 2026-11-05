import type { TheorySection } from "../theory/TheoryPanel";

export const PSYCHOACOUSTICS_THEORY_TITLE_KEY = "psychoacoustics.theory.title";

export const PSYCHOACOUSTICS_THEORY_SECTIONS: readonly TheorySection[] = [
  {
    headingKey: "psychoacoustics.theory.ath.heading",
    bodyKey: "psychoacoustics.theory.ath.body",
    formula:
      "L_{TH}(f)=3.64\\left(\\frac{f}{1000}\\right)^{-0.8}-6.5e^{-0.6\\left(\\frac{f}{1000}-3.3\\right)^2}+10^{-3}\\left(\\frac{f}{1000}\\right)^4",
  },
  {
    headingKey: "psychoacoustics.theory.critical.heading",
    bodyKey: "psychoacoustics.theory.critical.body",
    formula:
      "z(f)=13\\arctan\\!\\left(0.00076f\\right)+3.5\\arctan\\!\\left(\\left(\\frac{f}{7500}\\right)^2\\right)",
  },
  {
    headingKey: "psychoacoustics.theory.masking.heading",
    bodyKey: "psychoacoustics.theory.masking.body",
    formula:
      "L_T(z)=10\\log_{10}\\left(\\sum_{i}10^{\\frac{L_i+S(z-z_i)}{10}}\\right)\\quad\\text{(combined with the ATH)}",
  },
  {
    headingKey: "psychoacoustics.theory.smr.heading",
    bodyKey: "psychoacoustics.theory.smr.body",
    formula: "\\mathrm{SMR}=L_s-L_T",
  },
  {
    headingKey: "psychoacoustics.theory.discard.heading",
    bodyKey: "psychoacoustics.theory.discard.body",
    formula:
      "\\Delta_k=\\max\\!\\left(\\Delta_{\\mathrm{global}},\\,\\Delta_{\\mathrm{mask},k}\\right)",
  },
];
