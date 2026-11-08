import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Outlet } from "react-router";

import { HealthStatus } from "../components/HealthStatus";
import { LanguageToggle } from "../components/LanguageToggle";
import { Button } from "../components/ui/button";
import { PlayerDock } from "../features/player/player";
import { LabReportButton } from "../features/report/LabReportButton";
import { ShortcutHelpDialog } from "./ShortcutHelpDialog";
import { Sidebar } from "./sidebar";
import { useTheme } from "./useTheme";

/**
 * App shell: Wave-0 header (title, health pill, language toggle) with a
 * tool sidebar and the docked player panel (Plan 02 Task 4) on every tool
 * page. Inline asymmetries use logical properties (e.g. sidebar `border-e`),
 * so the row mirrors under RTL without forks (AGENTS §6).
 */
export function AppLayout() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [helpOpen, setHelpOpen] = useState(false);
  const showHelp = useCallback(() => {
    setHelpOpen(true);
  }, []);
  const closeHelp = useCallback(() => {
    setHelpOpen(false);
  }, []);

  useEffect(() => {
    document.title = t("app.title");
  }, [t]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-surface px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold">{t("app.title")}</h1>
          <p className="text-sm text-muted">{t("app.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <HealthStatus />
          <LabReportButton />
          <label className="flex items-center gap-2 text-sm text-muted">
            <span>{t("app.theme.label")}</span>
            <select
              data-testid="theme.select"
              aria-label={t("app.theme.label")}
              value={theme.theme}
              onChange={(event) => {
                const next = event.currentTarget.value;
                if (next === "system" || next === "light" || next === "dark") {
                  theme.setTheme(next);
                }
              }}
              className="rounded border border-surface bg-bg px-2 py-1 text-sm text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <option value="system">{t("app.theme.system")}</option>
              <option value="light">{t("app.theme.light")}</option>
              <option value="dark">{t("app.theme.dark")}</option>
            </select>
          </label>
          <Button
            size="sm"
            variant="outline"
            data-testid="shortcuts.helpButton"
            aria-label={t("shortcuts.open")}
            title={t("shortcuts.open")}
            onClick={showHelp}
          >
            <span dir="ltr">?</span>
          </Button>
          <LanguageToggle />
        </div>
      </header>
      <div className="flex flex-1 flex-col md:flex-row">
        <Sidebar />
        <main className="min-w-0 flex-1 px-6 py-8">
          <Outlet />
        </main>
      </div>
      <PlayerDock onShowHelp={showHelp} />
      <ShortcutHelpDialog open={helpOpen} onClose={closeHelp} />
      <footer className="border-t border-surface px-6 py-3 text-xs text-muted">
        {t("app.privacy.ttlNotice")}
      </footer>
    </div>
  );
}
