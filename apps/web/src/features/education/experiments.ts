export type ExperimentId = "filters" | "superres" | "asr-codec";

export type ExperimentLink = {
  readonly path: string;
  readonly search: string;
};

export type ExperimentStep = {
  readonly instructionKey: string;
  readonly observationKey: string;
  readonly link?: ExperimentLink;
};

export type Experiment = {
  readonly id: ExperimentId;
  readonly titleKey: string;
  readonly goalKey: string;
  readonly steps: readonly ExperimentStep[];
};

export const EXPERIMENTS: readonly Experiment[] = [
  {
    id: "filters",
    titleKey: "experiments.filters.title",
    goalKey: "experiments.filters.goal",
    steps: [
      {
        instructionKey: "experiments.filters.steps.taps.instruction",
        observationKey: "experiments.filters.steps.taps.observation",
        link: {
          path: "/tools/filters",
          search: "k=fir&bd=lowpass&c=4000&t=101&w=hamming",
        },
      },
      {
        instructionKey: "experiments.filters.steps.order.instruction",
        observationKey: "experiments.filters.steps.order.observation",
        link: {
          path: "/tools/filters",
          search: "k=butterworth&bd=lowpass&c=4000&o=8",
        },
      },
      {
        instructionKey: "experiments.filters.steps.ripple.instruction",
        observationKey: "experiments.filters.steps.ripple.observation",
        link: {
          path: "/tools/filters",
          search: "k=chebyshev1&bd=lowpass&c=4000&o=8&rp=0.5",
        },
      },
      {
        instructionKey: "experiments.filters.steps.groupDelay.instruction",
        observationKey: "experiments.filters.steps.groupDelay.observation",
        link: {
          path: "/tools/filters",
          search: "k=fir&bd=lowpass&c=4000&t=257&w=blackman",
        },
      },
    ],
  },
  {
    id: "superres",
    titleKey: "experiments.superres.title",
    goalKey: "experiments.superres.goal",
    steps: [
      {
        instructionKey: "experiments.superres.steps.load.instruction",
        observationKey: "experiments.superres.steps.load.observation",
        link: { path: "/tools/ai", search: "task=superres" },
      },
      {
        instructionKey: "experiments.superres.steps.sinc.instruction",
        observationKey: "experiments.superres.steps.sinc.observation",
        link: { path: "/tools/ai", search: "task=superres" },
      },
      {
        instructionKey: "experiments.superres.steps.lavasr.instruction",
        observationKey: "experiments.superres.steps.lavasr.observation",
        link: { path: "/tools/ai", search: "task=superres" },
      },
    ],
  },
  {
    id: "asr-codec",
    titleKey: "experiments.asrCodec.title",
    goalKey: "experiments.asrCodec.goal",
    steps: [
      {
        instructionKey: "experiments.asrCodec.steps.low.instruction",
        observationKey: "experiments.asrCodec.steps.low.observation",
        link: { path: "/tools/codec-lab", search: "c=mdct&mbr=32" },
      },
      {
        instructionKey: "experiments.asrCodec.steps.mid.instruction",
        observationKey: "experiments.asrCodec.steps.mid.observation",
        link: { path: "/tools/codec-lab", search: "c=mdct&mbr=128" },
      },
      {
        instructionKey: "experiments.asrCodec.steps.high.instruction",
        observationKey: "experiments.asrCodec.steps.high.observation",
        link: { path: "/tools/codec-lab", search: "c=mdct&mbr=320" },
      },
      {
        instructionKey: "experiments.asrCodec.steps.asr.instruction",
        observationKey: "experiments.asrCodec.steps.asr.observation",
        link: { path: "/tools/ai", search: "task=asr" },
      },
    ],
  },
];
