import { useTranslation } from "react-i18next";

import { applyDocumentLanguage, LANGUAGE_AUTONYMS, type Language, persistLanguage } from "../i18n";
import { Button } from "./ui/button";

export function LanguageToggle() {
  const { i18n, t } = useTranslation();
  const current: Language = i18n.language === "en" ? "en" : "fa";
  const next: Language = current === "fa" ? "en" : "fa";

  function switchLanguage() {
    void i18n.changeLanguage(next);
    applyDocumentLanguage(next);
    persistLanguage(next);
  }

  return (
    <Button variant="outline" aria-label={t("app.language.switchLabel")} onClick={switchLanguage}>
      {LANGUAGE_AUTONYMS[next]}
    </Button>
  );
}
