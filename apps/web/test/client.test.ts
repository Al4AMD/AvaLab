/**
 * Tests for the typed API client.
 *
 * Node's `Request` rejects relative URLs, but the default base URL is
 * `/api/v1` by design (browser + reverse-proxy deployment). The Request
 * global is therefore replaced with a subclass that resolves relative
 * URLs against a dummy origin while recording the raw URL the client
 * built. The client module is imported dynamically after stubbing,
 * because openapi-fetch captures `globalThis.Request` and
 * `globalThis.fetch` when `createClient` runs at module load.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const RealRequest = globalThis.Request;

class RelativeUrlRequest extends RealRequest {
  readonly rawUrl: string;

  constructor(input: string | URL | Request, init?: RequestInit) {
    const raw = input instanceof RealRequest ? input.url : String(input);
    const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(raw);
    super(isAbsolute ? raw : new URL(raw, "http://localhost"), init);
    this.rawUrl = raw;
  }
}

const healthBody = { status: "ok", version: "0.1.0", ffmpeg: true };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("api client", () => {
  it("GET /health parses the typed body and targets /api/v1 by default", async () => {
    vi.stubGlobal("Request", RelativeUrlRequest);
    const fetchStub = vi.fn(async (_request: Request) => jsonResponse(healthBody));
    vi.stubGlobal("fetch", fetchStub);

    const { api, DEFAULT_API_BASE_URL } = await import("../src/api/client");
    const { data, error } = await api.GET("/health");

    expect(error).toBeUndefined();
    expect(data?.version).toBe("0.1.0");
    expect(data?.ffmpeg).toBe(true);
    expect(DEFAULT_API_BASE_URL).toBe("/api/v1");
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const sent = fetchStub.mock.calls[0]?.[0] as unknown as { rawUrl?: string };
    expect(sent.rawUrl).toBe("/api/v1/health");
  });

  it("honors a VITE_API_BASE_URL override at client creation time", async () => {
    vi.stubGlobal("Request", RelativeUrlRequest);
    vi.stubEnv("VITE_API_BASE_URL", "http://example.test/v9");
    const fetchStub = vi.fn(async (_request: Request) => jsonResponse(healthBody));
    vi.stubGlobal("fetch", fetchStub);

    const { createApiClient } = await import("../src/api/client");
    const client = createApiClient();
    const { data } = await client.GET("/health");

    expect(data?.status).toBe("ok");
    const sent = fetchStub.mock.calls[0]?.[0] as unknown as { rawUrl?: string };
    expect(sent.rawUrl).toBe("http://example.test/v9/health");
  });
});
