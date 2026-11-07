export const EXPERIMENT_IDS = [
  "waveform-spectrogram",
  "sampling",
  "extent",
  "fft",
  "spectrum-edit",
  "speed",
  "reverb",
  "filters",
  "generator-fourier",
  "codec-lab",
  "metrics",
  "ai-separation",
  "ai-denoise",
  "ai-superres",
  "ai-asr",
  "ai-neural-codec",
  "ai-pitch-beat",
  "pipeline",
  "psychoacoustics",
] as const;

export type ExperimentId = (typeof EXPERIMENT_IDS)[number];

export const EXPERIMENT_CATEGORIES = ["signals", "multimedia", "ai", "labs"] as const;

export type ExperimentCategory = (typeof EXPERIMENT_CATEGORIES)[number];

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
  readonly category: ExperimentCategory;
  readonly titleKey: string;
  readonly goalKey: string;
  readonly steps: readonly ExperimentStep[];
};

export const EXPERIMENTS_PROGRESS_STORAGE_KEY = "avalab.experiments.progress";

export type ExperimentProgressStorage = Pick<Storage, "getItem" | "setItem">;

function step(contentId: string, index: number, link: ExperimentLink | null): ExperimentStep {
  return {
    instructionKey: `experiments.${contentId}.steps.s${index + 1}.instruction`,
    observationKey: `experiments.${contentId}.steps.s${index + 1}.observation`,
    ...(link === null ? {} : { link }),
  };
}

function experiment(
  id: ExperimentId,
  category: ExperimentCategory,
  contentId: string,
  links: readonly (ExperimentLink | null)[],
): Experiment {
  return {
    id,
    category,
    titleKey: `experiments.${contentId}.title`,
    goalKey: `experiments.${contentId}.goal`,
    steps: links.map((link, index) => step(contentId, index, link)),
  };
}

const ai = (task: string): ExperimentLink => ({ path: "/tools/ai", search: `task=${task}` });

export const EXPERIMENTS: readonly Experiment[] = [
  experiment("waveform-spectrogram", "signals", "waveformSpectrogram", [
    { path: "/tools/waveform", search: "" },
    null,
    { path: "/tools/spectrogram", search: "" },
    null,
    null,
  ]),
  experiment("sampling", "signals", "sampling", [
    { path: "/tools/sampling", search: "tr=8000&aa=0&bd=16&dt=0" },
    { path: "/tools/sampling", search: "tr=8000&aa=1&bd=16&dt=0" },
    { path: "/tools/sampling", search: "tr=8000&aa=1&bd=8&dt=0" },
    { path: "/tools/sampling", search: "tr=8000&aa=1&bd=4&dt=1" },
    { path: "/tools/sampling", search: "tr=8000&aa=1&bd=8&dt=0" },
  ]),
  experiment("extent", "signals", "extent", [
    { path: "/tools/extent", search: "op=identity" },
    { path: "/tools/extent", search: "op=truncate&tl=12000" },
    { path: "/tools/extent", search: "op=zeroPad&from=0&to=12000&pe=12000" },
    { path: "/tools/extent", search: "op=shift&sh=4800" },
    { path: "/tools/extent", search: "op=reverse" },
    { path: "/tools/extent", search: "op=scale&sf=0.5" },
  ]),
  experiment("fft", "signals", "fft", [
    { path: "/tools/fftview", search: "w=hann&n=1024&m=db&p=wrapped" },
    { path: "/tools/fftview", search: "w=rect&n=1024&m=db&p=wrapped" },
    { path: "/tools/fftview", search: "w=blackman&n=4096&m=db&p=wrapped" },
    { path: "/tools/fftview", search: "w=hann&n=8192&m=db&p=wrapped" },
    { path: "/tools/fftview", search: "w=hann&n=1024&m=db&p=unwrapped&mask=-80" },
    null,
    null,
    null,
  ]),
  experiment("spectrum-edit", "signals", "spectrumEdit", [
    { path: "/tools/spectrum-edit", search: "h=1" },
    { path: "/tools/spectrum-edit", search: "h=1" },
    { path: "/tools/spectrum-edit", search: "h=1" },
    { path: "/tools/spectrum-edit", search: "h=1" },
    { path: "/tools/spectrum-edit", search: "h=1" },
    { path: "/tools/spectrum-edit", search: "h=1" },
    { path: "/tools/spectrum-edit", search: "h=0" },
    { path: "/tools/spectrum-edit", search: "h=1" },
  ]),
  experiment("speed", "signals", "speed", [
    { path: "/tools/speed", search: "m=resample&sp=2&rv=0" },
    { path: "/tools/speed", search: "m=timeStretch&sp=2&rv=0" },
    { path: "/tools/speed", search: "m=resample&sp=0.5&rv=0" },
    { path: "/tools/speed", search: "m=timeStretch&sp=1&p=12&rv=0" },
    { path: "/tools/speed", search: "m=resample&sp=1&rv=1" },
  ]),
  experiment("reverb", "signals", "reverb", [
    { path: "/tools/reverb", search: "ir=hall&rt=1.8&me=fft&wm=0.5" },
    { path: "/tools/reverb", search: "ir=hall&rt=3&me=fft&wm=0.5" },
    { path: "/tools/reverb", search: "ir=plate&rt=3&me=fft&wm=0.7" },
    { path: "/tools/reverb", search: "ir=hall&rt=1.8&me=fft&pd=80&wm=0.5" },
    { path: "/tools/reverb", search: "ir=hall&rt=1.8&me=direct&wm=0.5" },
  ]),
  experiment("filters", "signals", "filters", [
    { path: "/tools/filters", search: "k=fir&bd=lowpass&c=4000&t=101&w=hamming" },
    { path: "/tools/filters", search: "k=butterworth&bd=lowpass&c=4000&o=8" },
    { path: "/tools/filters", search: "k=chebyshev1&bd=lowpass&c=4000&o=8&rp=0.5" },
    { path: "/tools/filters", search: "k=fir&bd=lowpass&c=4000&t=257&w=blackman" },
    { path: "/tools/filters", search: "k=fir&bd=highpass&c=2000&t=101&w=hann" },
    { path: "/tools/filters", search: "k=butterworth&bd=bandpass&c=1000&c2=3000&o=4" },
    { path: "/tools/filters", search: "k=butterworth&bd=bandstop&c=1000&c2=3000&o=4" },
    { path: "/tools/filters", search: "k=biquad&bd=peaking&c=1000&g=6&q=1" },
  ]),
  experiment("generator-fourier", "signals", "generatorFourier", [
    { path: "/tools/generator", search: "w=square&fk=square&fh=1&d=2" },
    { path: "/tools/generator", search: "w=square&fk=square&fh=3&d=2" },
    { path: "/tools/generator", search: "w=square&fk=square&fh=9&d=2" },
    { path: "/tools/generator", search: "w=square&fk=square&fh=51&d=2" },
    { path: "/tools/generator", search: "w=triangle&fk=triangle&fh=15&d=2" },
  ]),
  experiment("codec-lab", "multimedia", "codecLab", [
    { path: "/tools/codec-lab", search: "c=rle" },
    { path: "/tools/codec-lab", search: "c=huffman" },
    { path: "/tools/codec-lab", search: "c=deltaHuffman" },
    { path: "/tools/codec-lab", search: "c=mulaw" },
    { path: "/tools/codec-lab", search: "c=mdct&mbr=32" },
    { path: "/tools/codec-lab", search: "c=mdct&mbr=128" },
    { path: "/tools/codec-lab", search: "c=mdct&mbr=320" },
    { path: "/tools/codec-lab", search: "rc=mp3&rbr=128" },
  ]),
  experiment("metrics", "multimedia", "metrics", [
    { path: "/tools/metrics", search: "" },
    null,
    { path: "/tools/metrics", search: "" },
    null,
    null,
  ]),
  experiment("ai-separation", "ai", "aiSeparation", [
    ai("separation"),
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  ]),
  experiment("ai-denoise", "ai", "aiDenoise", [
    ai("denoise"),
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  ]),
  experiment("ai-superres", "ai", "aiSuperres", [
    ai("superres"),
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  ]),
  experiment("ai-asr", "ai", "aiAsr", [ai("asr"), null, null, null, null, null, null, null]),
  experiment("ai-neural-codec", "ai", "aiNeuralCodec", [
    ai("neural-codec"),
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  ]),
  experiment("ai-pitch-beat", "ai", "aiPitchBeat", [
    ai("pitch"),
    null,
    null,
    null,
    ai("beat"),
    null,
    null,
    null,
  ]),
  experiment("pipeline", "labs", "pipeline", [
    { path: "/tools/pipeline", search: "" },
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  ]),
  experiment("psychoacoustics", "labs", "psychoacoustics", [
    { path: "/tools/psychoacoustics", search: "fs=log&rspl=94&th=1" },
    null,
    null,
    { path: "/tools/psychoacoustics", search: "fs=linear&rspl=94&th=1" },
    null,
    null,
    null,
    null,
  ]),
];

export function parseExperimentProgress(raw: string | null): ReadonlySet<ExperimentId> {
  if (raw === null) {
    return new Set();
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    const ids = EXPERIMENT_IDS as readonly string[];
    return new Set(
      parsed.filter(
        (value): value is ExperimentId => typeof value === "string" && ids.includes(value),
      ),
    );
  } catch {
    return new Set();
  }
}

export function loadExperimentProgress(
  storage: ExperimentProgressStorage | null,
): ReadonlySet<ExperimentId> {
  if (storage === null) {
    return new Set();
  }
  try {
    return parseExperimentProgress(storage.getItem(EXPERIMENTS_PROGRESS_STORAGE_KEY));
  } catch {
    return new Set();
  }
}

export function saveExperimentProgress(
  storage: ExperimentProgressStorage | null,
  completed: ReadonlySet<ExperimentId>,
): void {
  if (storage === null) {
    return;
  }
  try {
    storage.setItem(EXPERIMENTS_PROGRESS_STORAGE_KEY, JSON.stringify([...completed]));
  } catch {
    // Storage may be unavailable (private mode); the session still tracks state.
  }
}
