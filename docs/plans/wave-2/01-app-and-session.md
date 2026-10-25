# Wave 2 · Plan 01 — App skeleton: router, session store, DSP worker, RPC

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** The foundation every Wave 2 view runs on: React Router routes + sidebar/player layout, the Zustand audio-session store (AGENTS §10), and a long-lived DSP worker driven by a typed message protocol (no Comlink).

**Architecture:** Spec `docs/superpowers/specs/2026-10-25-wave-2-core-visuals-design.md` §2.1–2.3 is the binding design. Worker ops live in one op table; the RPC layer is a thin typed adapter; the store is the only caller of RPC from the view tree.

**Tech Stack:** React 19, TypeScript strict, zustand, react-router (data APIs), Vite module workers, Vitest + Playwright. New deps exactly: `react-router`, `zustand` (uPlot arrives with Plan 04).

**Spec:** `AGENTS.md` §3, §6, §9, §10 + `docs/DECISIONS.md` D-009/D-010/D-013/D-015.

## Review Focus

1. **No main-thread DSP** — grep the view tree: nothing imports `packages/dsp` except the worker module and pure helpers (deterministically: bucketing math is in dsp, the worker calls it; components never do).
2. **Transfers, not copies** — every worker response carrying a typed array must put the buffer in the transfer list (structured clone of a 5-min Float32Array is the §9 memory killer); the RPC types make omitting it a compile-time-visible mistake (`TransferablePayload` wrapper on the wire).
3. **Cache correctness** — derived cache keys canonicalize params (stable field order; no `Date`/function params), so identical semantics always hit and distinct semantics never collide; new source → cache emptied.
4. **Cancel semantics** — a superseded job id can never deliver its result after `cancel` (store drops late frames; unit test with a delayed worker echo).
5. **i18n/RTL** — every new string goes through i18next (checker wired); layout uses logical properties; per-screen fa/en visual sanity (Playwright two locales, no console errors).

---
### Task 1: Router + layout shell

**Files:** Modify `apps/web/src/App.tsx` (becomes router + layout), create `apps/web/src/app/{routes.tsx,layout.tsx,sidebar.tsx}`, params helpers `apps/web/src/lib/url-state.ts`; i18n keys (`nav.*`) in both locales.

**Interfaces:**
- Routes: `/` redirects to `/tools/waveform`; `/tools/waveform|spectrogram|fftview|generator` each render a stub page header + "tool coming in this wave" body.
- Layout shell: sidebar (logical `ms/me` classes only), docked player placeholder (empty box, Wave 2 Plan 02 fills it), header keeps Wave-0 health + language toggle.
- `url-state.ts`: `encodeParams(record): string`, `decodeParams(search): record` — stable key ordering, URLSearchParams only; no audio in URLs ever.

**Tests:** route render test (each path → expected stub title), `url-state` round-trip incl. arrays/numbers (`vitest`); Playwright: `/tools/*` navigation smoke in both locales, zero console errors.

- [ ] Commit `feat(app): router and layout shell with sidebar`

### Task 2: Typed DSP worker + RPC client

**Files:** Create `apps/web/src/workers/dsp.worker.ts` (module worker), `apps/web/src/session/rpc.ts`, `apps/web/src/session/{protocol.d.ts,ops.ts}` (op table), used by the store in Task 3.

**Interfaces:**
- Wire protocol exactly as spec §2.3: request `{id, op, params, payload?}` where `payload?` is `{ buffer: ArrayBuffer, byteOffset, byteLength }` (explicit slice — transfer promotes it); response `{id, ok, result | error}` with `result = {meta, payload?}` (same wrapper back).
- Op table: `Record<OpName, {handler(params, payloadTransfer): {result, transfers}}>` — handlers are pure over the `@avalab/dsp` barrel. Initial ops: `sessionPing` (round-trips a Float32Array, exercising transfer).
- RPC client: `call(op, params?, payload?: TransferablePayload): Promise<Result>` + `cancel(id)`; jsdom/Vitest path injects a `MessageChannel`-based transport (no real Worker in node).
- Superseded ids: client-side dedup table keyed by `op + params`; a superseded call resolves `{cancelled: true}` and never feeds the store.

**Tests:** RPC round-trip via MessageChannel (both ok and typed-error paths); transfer byte-offset/length honored; cancel-before-complete resolves cancelled (delayed transport); protocol type-level test (discriminated union exhaustive in the worker switch via `satisfies`).

- [ ] Commit `feat(app): typed message dsp worker and rpc client`

### Task 3: Audio session store (zustand)

**Files:** Create `apps/web/src/session/store.ts`, `packages/dsp/src/utils/hash.ts` (FNV-1a 64), test both sides (`packages/dsp/test/utils/hash.test.ts`, `apps/web/src/session/store.test.tsx`).

**Interfaces:**
- State/actions exactly per spec §2.2 (`original`, `derived` Map, `jobs`, `selection`, `backendOnline`).
- `loadSource(samples: Float32Array, sampleRateHz, name, sourceKind)` — sanity-guards (finite values, max 96 kHz, ≤ 300 s @ sample rate), empties the derived cache, returns validation errors typed (`SourceError` code union: `tooLong`, `rateTooHigh`, `notFinite`).
- `derive(opKey, params)`: canonical key = `opKey + "|" + canonicalJson(params) + "|" + inputHash(original)`; cache hit → synchronous resolve; miss → job with `progressPct`, `cancel()` detaching the job id.
- `setSelection(startSample, endSample)` clamps and orders; store exposes typed selectors only.

**Tests:** hash golden (fixed input → known hex; avalanche sanity on random); cache key canonicalization (param order irrelevant, numeric/locale-stable via explicit stringification — no `toLocaleString`); cache invalidation on new source; cancel drops late result; selection clamping; store guards reject bad sources with exact error codes.

- [ ] Commit `feat(app): audio session store with derived cache and jobs`

### Task 4: Waveform overview op (exercise the pipeline, not the paint)

**Files:** Create `packages/dsp/src/utils/peaks.ts` (`computePeakBuckets(x: Float32Array, bucketCount: number): {minMax: Float32Array} `, header: purpose/formula/complexity/edge cases per AGENTS §11) + dsp test; register op `waveformOverview` in the worker op table; rpc type + store wiring (no canvas yet — a debug readout in the waveform stub page proves the op end-to-end and unblocks Plan 03).

**Interfaces:**
- `computePeakBuckets` returns interleaved `min[k], max[k]` Float32Array (2×bucketCount), clamps bucketCount to `max(1, min(count, sampleCount))`; no allocation per sample; zero-length input → empty.
- `waveformOverview` op params: `{bucketCount}`; result `{minMax, sampleCount, sampleRateHz}` transferred.

**Tests:** dsp golden-lite (tiny hand-computed vectors + property: bucket min ≤ max; boundary bucket counts; empty); worker op end-to-end via the RPC adapter in a store test; chunked? (deliberately simple — max 5-min mono Float32 through one op is ~115 MB transfer, fine once, documented).

- [ ] Commit `feat(app): waveform overview buckets op in the dsp worker`
