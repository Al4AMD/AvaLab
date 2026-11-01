/**
 * A/B compare slot (F02, Wave 2 Plan 03 Task 4) — the waveform lab's
 * reserved original-vs-derived (mono) canvas pair, wired to the session
 * store so a future processing pipeline can mount the two plots here
 * without reshaping the page.
 *
 * Honesty today: the store holds only the original source and derived CACHE
 * entries (peak buckets, spectrogram tiles), not derived audio SOURCES, so
 * both slots render a dash plus one translated explanation. No fake plots,
 * no placeholder waveform data. The original read below is the store
 * subscription that will select the left lane; keeping it now means the
 * slot already follows load/reset semantics.
 */
import { useTranslation } from "react-i18next";

import { useSessionStore } from "../../session/store";

function ComparePane({ label, testId }: { readonly label: string; readonly testId: string }) {
  return (
    <figure className="flex flex-col gap-1">
      <div
        data-testid={testId}
        aria-hidden="true"
        className="flex h-16 items-center justify-center rounded border border-dashed border-surface text-xl text-muted"
      >
        —
      </div>
      <figcaption className="text-xs text-muted">{label}</figcaption>
    </figure>
  );
}

export function CompareSlot() {
  const { t } = useTranslation();
  const original = useSessionStore((state) => state.original);
  if (original === null) {
    return null;
  }
  return (
    <section data-testid="compare.slot" className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{t("compare.title")}</h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <ComparePane label={t("compare.original")} testId="compare.original.slot" />
        <ComparePane label={t("compare.derived")} testId="compare.derived.slot" />
      </div>
      <p data-testid="compare.pending" className="text-xs text-muted">
        {t("compare.pending")}
      </p>
    </section>
  );
}
