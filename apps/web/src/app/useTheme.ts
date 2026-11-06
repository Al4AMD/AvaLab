import { useCallback, useEffect, useState } from "react";

import { readStoredTheme, resolveTheme, type Theme, writeStoredTheme } from "./theme";

export type ThemeApi = {
  readonly theme: Theme;
  readonly resolvedTheme: "dark" | "light";
  readonly setTheme: (theme: Theme) => void;
};

function prefersLight(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: light)").matches
      : false;
  } catch {
    return false;
  }
}

export function useTheme(): ThemeApi {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);
  const [systemPrefersLight, setSystemPrefersLight] = useState(prefersLight);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const update = (): void => {
      setSystemPrefersLight(query.matches);
    };
    update();
    query.addEventListener("change", update);
    return () => {
      query.removeEventListener("change", update);
    };
  }, []);

  const resolvedTheme = resolveTheme(theme, systemPrefersLight);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  const setTheme = useCallback((nextTheme: Theme) => {
    setThemeState(nextTheme);
    writeStoredTheme(nextTheme);
  }, []);

  return { theme, resolvedTheme, setTheme };
}
