import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { HealthStatus } from "./components/HealthStatus";
import { LanguageToggle } from "./components/LanguageToggle";

export function App() {
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
      <main className="flex-1 px-6 py-8" />
      <footer className="border-t border-surface px-6 py-3 text-xs text-muted">
        {t("app.privacy.ttlNotice")}
      </footer>
    </div>
  );
}
