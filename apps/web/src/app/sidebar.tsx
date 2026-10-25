import { useTranslation } from "react-i18next";
import { NavLink } from "react-router";

import { cn } from "../lib/cn";

function linkClass({ isActive }: { isActive: boolean }): string {
  return cn(
    "block rounded-md px-3 py-2 text-sm",
    isActive ? "bg-surface text-text" : "text-muted hover:bg-surface hover:text-text",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
  );
}

/**
 * Sidebar navigation, one link per Wave-2 tool route. The inline-start border
 * (`border-e`) keeps the sidebar/main separation on the logical start side
 * under both LTR and RTL. Link labels are literal t() calls (not
 * t(`nav.${id}`)) so the i18n key checker sees every key without widening
 * the dynamic allowlist.
 */
export function Sidebar() {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("nav.landmark")} className="shrink-0 border-e border-surface px-3 py-4">
      <ul className="flex flex-col gap-1">
        <li>
          <NavLink to="/tools/waveform" className={linkClass}>
            {t("nav.waveform")}
          </NavLink>
        </li>
        <li>
          <NavLink to="/tools/spectrogram" className={linkClass}>
            {t("nav.spectrogram")}
          </NavLink>
        </li>
        <li>
          <NavLink to="/tools/fftview" className={linkClass}>
            {t("nav.fftview")}
          </NavLink>
        </li>
        <li>
          <NavLink to="/tools/generator" className={linkClass}>
            {t("nav.generator")}
          </NavLink>
        </li>
      </ul>
    </nav>
  );
}
