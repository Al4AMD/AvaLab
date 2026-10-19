import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "../api/client";
import { cn } from "../lib/cn";

type HealthState = "loading" | "ok" | "offline";

const DOT_CLASSES: Record<HealthState, string> = {
  loading: "bg-muted",
  ok: "bg-accent",
  offline: "bg-red-400",
};

/**
 * Server health pill. Calls `GET /health` once on mount; any failure
 * (network error, non-2xx status, unexpected payload) maps to the
 * translated offline state. Raw error text is never rendered.
 */
export function HealthStatus() {
  const { t } = useTranslation();
  const [state, setState] = useState<HealthState>("loading");

  useEffect(() => {
    let cancelled = false;
    api
      .GET("/health")
      .then(({ data, response }) => {
        if (!cancelled) {
          setState(response.ok && data?.status === "ok" ? "ok" : "offline");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState("offline");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const labelKey =
    state === "loading"
      ? "app.health.loading"
      : state === "ok"
        ? "app.health.ok"
        : "app.health.offline";

  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2">
      <span aria-hidden="true" className={cn("size-2 rounded-full", DOT_CLASSES[state])} />
      <div className="flex flex-col">
        <span className="text-sm">{t(labelKey)}</span>
        {state === "offline" && (
          <span className="max-w-72 text-xs text-muted">{t("app.health.offlineDetail")}</span>
        )}
      </div>
    </div>
  );
}
