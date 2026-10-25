/**
 * Route-table tests without a DOM device: the Wave-2 pre-flight (progress.md)
 * allows exactly react-router + zustand as dependencies, so no jsdom —
 * `react-dom/server` renders RouterProvider statically instead, and the "/"
 * redirect is asserted on the data router's own state after loader init.
 *
 * The i18n bootstrap touches `document` at import time (it applies lang/dir
 * to <html>); a minimal document stub is installed by importAppModules() before
 * the app modules load (same avoid-real-globals pattern as test/client.test.ts).
 * react-router / react-dom/server are document-free, so they import statically.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, type DataRouter, RouterProvider } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
});

async function importAppModules(): Promise<{
  RouterProvider: typeof RouterProvider;
  appRoutes: typeof import("./routes").appRoutes;
  i18n: typeof import("../i18n/index").default;
}> {
  vi.stubGlobal("document", {
    documentElement: { lang: "", dir: "" },
    title: "",
  });
  const [routesModule, i18nModule] = await Promise.all([
    import("./routes"),
    import("../i18n/index"),
  ]);
  return {
    RouterProvider,
    appRoutes: routesModule.appRoutes,
    i18n: i18nModule.default,
  };
}

/** Wait until the memory router finished its initial navigation to `pathname`. */
async function waitUntilInitialised(router: DataRouter, pathname: string): Promise<void> {
  await vi.waitFor(() => {
    expect(router.state.initialized).toBe(true);
    expect(router.state.location.pathname).toBe(pathname);
  });
}

it("renders each /tools/* stub page through the data router with its i18n title", async () => {
  const { RouterProvider: Provider, appRoutes, i18n } = await importAppModules();

  const expected: Record<string, { title: string; stub: string }> = {
    "/tools/waveform": { title: i18n.t("tool.waveform.title"), stub: i18n.t("tool.waveform.stub") },
    "/tools/spectrogram": {
      title: i18n.t("tool.spectrogram.title"),
      stub: i18n.t("tool.spectrogram.stub"),
    },
    "/tools/fftview": { title: i18n.t("tool.fftview.title"), stub: i18n.t("tool.fftview.stub") },
    "/tools/generator": {
      title: i18n.t("tool.generator.title"),
      stub: i18n.t("tool.generator.stub"),
    },
  };

  for (const [path, expectedStub] of Object.entries(expected)) {
    const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
    await waitUntilInitialised(router, path);

    const markup = renderToStaticMarkup(<Provider router={router} />);
    expect(markup).toContain(expectedStub.title);
    expect(markup).toContain(expectedStub.stub); // "tool lands later this wave" body
    expect(markup).toContain(i18n.t("app.title")); // Wave-0 header preserved
    expect(markup).not.toContain("tool."); // no raw unresolved i18n keys render
  }
});

it("redirects / to /tools/waveform via the index loader before any render", async () => {
  const { appRoutes } = await importAppModules();
  const router = createMemoryRouter(appRoutes, { initialEntries: ["/"] });

  // The index loader calls redirect(); the data router resolves it during
  // initialization, so the location ends on the waveform tool with no render.
  await vi.waitFor(() => {
    expect(router.state.initialized).toBe(true);
    expect(router.state.location.pathname).toBe("/tools/waveform");
  });
});
