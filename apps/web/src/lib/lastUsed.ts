/**
 * Best-effort last-used settings storage shared by tools with more than URL
 * state. Values are the same stable query strings as share links; callers
 * decode them with their own total decoder. Storage failure (private mode,
 * quota, disabled) is never fatal — the URL still carries the live state.
 *
 * Nothing but serializable parameters is stored: never audio, file names,
 * uploaded impulse responses, or AI results.
 */
export type LastUsedStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): LastUsedStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readLastUsed(
  key: string,
  storage: LastUsedStorage | null = browserStorage(),
): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeLastUsed(
  key: string,
  value: string,
  storage: LastUsedStorage | null = browserStorage(),
): void {
  try {
    if (value !== "") {
      storage?.setItem(key, value);
    }
  } catch {
    // Private mode/storage failure: the live URL state still works.
  }
}
