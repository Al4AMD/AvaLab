/**
 * Small waveform preview for AI tool lanes. The buffer is copied and the
 * min/max overview is derived in the DSP worker; nothing here touches samples.
 */
import { useEffect, useState } from "react";

import { useSessionStore } from "../../session/store";
import { WaveformCanvas } from "../waveform/canvasWaveform";

export function SampleWave({
  samples,
  sampleRateHz,
  label,
  testId,
}: {
  readonly samples: Float32Array;
  readonly sampleRateHz: number;
  readonly label: string;
  readonly testId: string;
}): React.ReactElement {
  const [minMax, setMinMax] = useState<Float32Array | null>(null);

  useEffect(() => {
    const copy = samples.slice();
    const ticket = useSessionStore
      .getState()
      .deriveStandalone(
        "waveformOverview",
        { bucketCount: 200, sampleRateHz },
        { buffer: copy.buffer, byteOffset: 0, byteLength: copy.byteLength },
      );
    let cancelled = false;
    ticket.outcome.then(
      (outcome) => {
        if (cancelled || "cancelled" in outcome) {
          return;
        }
        const payload = outcome.payload;
        setMinMax(
          payload === undefined
            ? null
            : new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4),
        );
      },
      () => {
        if (!cancelled) {
          setMinMax(null);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [samples, sampleRateHz]);

  if (minMax === null) {
    return (
      <figure className="flex flex-col gap-1">
        <div className="flex h-16 items-center justify-center rounded border border-dashed border-surface text-xl text-muted">
          —
        </div>
        <figcaption className="text-xs text-muted">{label}</figcaption>
      </figure>
    );
  }
  return (
    <figure className="flex flex-col gap-1">
      <div dir="ltr">
        <WaveformCanvas
          minMax={minMax}
          sampleRange={{ startSample: 0, endSample: samples.length }}
          selectionRange={{ startSample: 0, endSample: samples.length }}
          heightPx={64}
          testId={testId}
          label={label}
        />
      </div>
      <figcaption className="text-xs text-muted">{label}</figcaption>
    </figure>
  );
}
