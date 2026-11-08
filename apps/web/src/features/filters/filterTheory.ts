export type FilterTheorySection = {
  readonly headingKey: string;
  readonly bodyKey: string;
  readonly formula?: string;
  readonly bulletKeys?: readonly string[];
};

export const FILTER_THEORY_TITLE_KEY = "filters.theory.title";

export const FILTER_THEORY_SECTIONS: readonly FilterTheorySection[] = [
  {
    headingKey: "filters.theory.transfer.heading",
    bodyKey: "filters.theory.transfer.body",
    formula:
      "H(z)=\\frac{B(z)}{A(z)}=\\frac{b_0+b_1 z^{-1}+\\cdots+b_M z^{-M}}{1+a_1 z^{-1}+\\cdots+a_N z^{-N}}",
  },
  {
    headingKey: "filters.theory.fir.heading",
    bodyKey: "filters.theory.fir.body",
    formula: "h[n]=h_d[n]\\,w[n],\\qquad H(e^{j\\omega})=\\sum_{n=0}^{N-1}h[n]e^{-j\\omega n}",
  },
  {
    headingKey: "filters.theory.butterworth.heading",
    bodyKey: "filters.theory.butterworth.body",
    formula: "|H(j\\Omega)|^2=\\frac{1}{1+(\\Omega/\\Omega_c)^{2N}}",
  },
  {
    headingKey: "filters.theory.chebyshev.heading",
    bodyKey: "filters.theory.chebyshev.body",
    formula: "|H(j\\Omega)|^2=\\frac{1}{1+\\varepsilon^2 T_N^2(\\Omega/\\Omega_c)}",
  },
  {
    headingKey: "filters.theory.groupDelay.heading",
    bodyKey: "filters.theory.groupDelay.body",
    formula: "\\tau_g(\\omega)=-\\frac{d\\varphi(\\omega)}{d\\omega}",
  },
  {
    headingKey: "filters.theory.poles.heading",
    bodyKey: "filters.theory.poles.body",
    formula: "|p_k|<1",
  },
  {
    headingKey: "filters.theory.lanes.heading",
    bodyKey: "filters.theory.lanes.body",
  },
  {
    headingKey: "filters.theory.observe.heading",
    bodyKey: "filters.theory.observe.body",
    bulletKeys: [
      "filters.theory.observe.bullets.cutoff",
      "filters.theory.observe.bullets.order",
      "filters.theory.observe.bullets.linearPhase",
      "filters.theory.observe.bullets.poles",
    ],
  },
  {
    headingKey: "filters.theory.pitfalls.heading",
    bodyKey: "filters.theory.pitfalls.body",
    bulletKeys: [
      "filters.theory.pitfalls.bullets.nyquist",
      "filters.theory.pitfalls.bullets.unstable",
      "filters.theory.pitfalls.bullets.delay",
    ],
  },
];
