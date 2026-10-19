/**
 * Typed HTTP client for the AvaLab backend.
 *
 * `schema.d.ts` is generated from the FastAPI OpenAPI document by
 * `pnpm gen:api`; openapi-fetch turns it into a typed `fetch` wrapper.
 * The base URL is resolved at call time — default `/api/v1`, overridable
 * with the `VITE_API_BASE_URL` build-time env var — so every deployment
 * mode (Vite dev proxy, Caddy in Docker, tests) targets the API by
 * configuration only.
 */
import createClient from "openapi-fetch";

import type { components, paths } from "./schema";

export type { components, paths };

/** Health payload from `GET /health`. */
export type HealthResponse = components["schemas"]["HealthResponse"];

/** Canonical audio handle from `POST /ingest`. */
export type IngestResponse = components["schemas"]["IngestResponse"];

export const DEFAULT_API_BASE_URL = "/api/v1";

function resolveBaseUrl(): string {
  const fromEnv: string | undefined = import.meta.env.VITE_API_BASE_URL;
  return fromEnv ?? DEFAULT_API_BASE_URL;
}

/** Build a client; the base URL default is read from the environment now. */
export function createApiClient(baseUrl: string = resolveBaseUrl()) {
  return createClient<paths>({ baseUrl });
}

/** Shared client instance for app code. */
export const api = createApiClient();
