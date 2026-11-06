export type Theme = "dark" | "light" | "system";

export const THEME_STORAGE_KEY = "avalab.theme";

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;

function browserStorage(): (StorageReader & StorageWriter) | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Total decode: unknown or missing persisted values mean "follow the OS". */
export function readStoredTheme(storage: StorageReader | null = browserStorage()): Theme {
  try {
    const stored = storage?.getItem(THEME_STORAGE_KEY);
    return stored === "dark" || stored === "light" || stored === "system" ? stored : "system";
  } catch {
    return "system";
  }
}

export function resolveTheme(theme: Theme, prefersLight: boolean): "dark" | "light" {
  if (theme === "system") {
    return prefersLight ? "light" : "dark";
  }
  return theme;
}

export function writeStoredTheme(
  theme: Theme,
  storage: StorageWriter | null = browserStorage(),
): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private mode/storage failure: the in-memory theme still applies.
  }
}
