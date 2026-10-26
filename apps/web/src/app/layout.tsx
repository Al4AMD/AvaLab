import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Outlet } from "react-router";

import { HealthStatus } from "../components/HealthStatus";
import { LanguageToggle } from "../components/LanguageToggle";
import { PlayerDock } from "../features/player/player";
import { Sidebar } from "./sidebar";

/**
 * App shell: Wave-0 header (title, health pill, language toggle) with a
 * tool sidebar and the docked player panel (Plan 02 Task 4) on every tool
 * page. Inline asymmetries use logical properties (e.g. sidebar `border-e`),
 * so the row mirrors under RTL without forks (AGENTS §6).
 */
export function AppLayout() {
  const { t } = useTranslation();

  useEffect(() => {
    document.title = t("app.title");
  }, [t]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-surface px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold">{t("app.title")}</h1>
          <p className="text-sm text-muted">{t("app.subtitle")}</p>
        </div>
        <div className="flex items-center gap-4">
          <HealthStatus />
          <LanguageToggle />
        </div>
      </header>
      <div className="flex flex-1">
        <Sidebar />
        <main className="flex-1 px-6 py-8">
          <Outlet />
        </main>
      </div>
      <PlayerDock />
      <footer className="border-t border-surface px-6 py-3 text-xs text-muted">
        {t("app.privacy.ttlNotice")}
      </footer>
    </div>
  );
}
