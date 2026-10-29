/**
 * Shared failure readout for the input lanes (F01, Wave-2 Plan 02): the
 * upload card (Task 1) and the offline/demo lane (Task 2) render the same
 * `role="alert"` block. The typed failure's `messageKey` translates AT
 * RENDER TIME (a locale switch re-renders correctly), unknown backend codes
 * surface verbatim through `{{code}}`, and `kind: "backendUnavailable"`
 * pairs with the actionable recovery hint.
 */
import { useTranslation } from "react-i18next";

/**
 * Structural view both lane error classes satisfy (IngestError and
 * OfflineError); the lane-specific kind unions differ, the readout only
 * needs to recognise the one shared kind.
 */
export type LaneFailureView = {
  readonly kind: string;
  readonly code: string | undefined;
  readonly messageKey: string;
};

export function LaneFailureReadout({
  failure,
  testId,
}: {
  failure: LaneFailureView;
  testId: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      data-testid={testId}
      role="alert"
      className="flex flex-col gap-1 rounded-md border border-surface bg-surface/50 p-3 text-start"
    >
      <p className="text-sm">
        {t(failure.messageKey, failure.code === undefined ? undefined : { code: failure.code })}
      </p>
      {failure.kind === "backendUnavailable" && (
        <p className="text-xs text-muted">{t("input.error.backendUnavailableHint")}</p>
      )}
    </div>
  );
}
