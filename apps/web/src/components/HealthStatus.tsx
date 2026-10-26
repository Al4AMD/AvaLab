import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "../api/client";
import { cn } from "../lib/cn";
import { useSessionStore } from "../session/store";

type HealthState = "loading" | "ok" | "offline";

const DOT_CLASSES: Record<HealthState, string> = {
  loading: "bg-muted",
  ok: "bg-accent",
  offline: "bg-red-400",
};

/**
 * Server health pill. Calls `GET /health` once on mount and writes the
 * verdict through the SESSION STORE's mark* actions (Wave-2 Plan 02
 * Task 2): `backendOnline` is the single source of truth (spec §2.2) — the
 * ingest lane's lane-evidence flips and this probe both feed it, and the
 * pill SUBSCRIBES to the flag instead of holding the ok/offline state
 * itself. The only local state left is the mount probe's in-flight marker:
 * the store flag is boolean and starts false, which alone cannot mean
 * "offline yet". Any probe failure (network error, non-2xx status,
 * unexpected payload) maps to the translated offline state; raw error text
 * is never rendered.
 */
export function HealthStatus() {
  const { t } = useTranslation();
  const backendOnline = useSessionStore((state) => state.backendOnline);
  const [probePending, setProbePending] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .GET("/health", { signal: AbortSignal.timeout(5000) })
      .then(({ data, response }) => {
        if (cancelled) {
          return;
        }
        setProbePending(false);
        if (response.ok && data?.status === "ok") {
          useSessionStore.getState().markBackendReachable();
        } else {
          useSessionStore.getState().markBackendUnreachable();
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProbePending(false);
          useSessionStore.getState().markBackendUnreachable();
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const state: HealthState = probePending ? "loading" : backendOnline ? "ok" : "offline";

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
