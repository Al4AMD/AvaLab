import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../components/ui/button";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible shortcut reference. Focus moves into the dialog on open and is
 * restored on close; Tab cycles inside; Escape closes.
 * Shortcuts are suppressed while focus is inside `role="dialog"` (see
 * `useGlobalShortcuts`), so the table cannot trigger the player behind it.
 */
export function ShortcutHelpDialog({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const titleId = useId();
  const hintId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open || typeof document === "undefined") {
      return;
    }
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || dialog === null) {
        return;
      }
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => !element.hasAttribute("disabled") && element.tabIndex >= 0,
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) {
        return;
      }
      const active = document.activeElement;
      if (event.shiftKey && (active === first || dialog.contains(active) === false)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || dialog.contains(active) === false)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={hintId}
        data-testid="shortcuts.dialog"
        className="w-full max-w-md rounded-lg border border-surface bg-surface p-5 text-text shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold">
              {t("shortcuts.title")}
            </h2>
            <p id={hintId} className="mt-1 text-sm text-muted">
              {t("shortcuts.hint")}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            data-testid="shortcuts.close"
            onClick={() => {
              onClose();
            }}
          >
            {t("shortcuts.close")}
          </Button>
        </div>
        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="text-start text-muted">
              <th scope="col" className="py-1 text-start font-medium">
                {t("shortcuts.keyHeader")}
              </th>
              <th scope="col" className="py-1 text-start font-medium">
                {t("shortcuts.actionHeader")}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="py-1">
                <kbd dir="ltr">{t("shortcuts.keys.space")}</kbd>
              </td>
              <td className="py-1">{t("shortcuts.actions.playPause")}</td>
            </tr>
            <tr>
              <td className="py-1">
                <kbd dir="ltr">{t("shortcuts.keys.left")}</kbd>
              </td>
              <td className="py-1">{t("shortcuts.actions.back5")}</td>
            </tr>
            <tr>
              <td className="py-1">
                <kbd dir="ltr">{t("shortcuts.keys.right")}</kbd>
              </td>
              <td className="py-1">{t("shortcuts.actions.forward5")}</td>
            </tr>
            <tr>
              <td className="py-1">
                <kbd dir="ltr">{t("shortcuts.keys.shiftLeft")}</kbd>
              </td>
              <td className="py-1">{t("shortcuts.actions.back10")}</td>
            </tr>
            <tr>
              <td className="py-1">
                <kbd dir="ltr">{t("shortcuts.keys.shiftRight")}</kbd>
              </td>
              <td className="py-1">{t("shortcuts.actions.forward10")}</td>
            </tr>
            <tr>
              <td className="py-1">
                <kbd dir="ltr">{t("shortcuts.keys.question")}</kbd>
              </td>
              <td className="py-1">{t("shortcuts.actions.help")}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
