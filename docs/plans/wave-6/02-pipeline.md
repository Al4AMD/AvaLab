# Wave 6 Plan 02 — F15 Branching Pipeline Builder

## Metadata

- Spec: [`design.md`](design.md) §7
- Depends on: plan 00
- Scope: versioned DAG DSL, pure engine, worker op, React Flow UI, save/load/share
- Out of scope: arbitrary cycles, graph merging, >2 audio outputs, >30 s excerpts

## Global constraints

- Graph execution runs only in the worker; no DSP in React Flow components.
- 24-node cap, 2-output cap, 30 s cap enforced in the worker, not only the UI.
- React Flow canvas coordinates stay LTR; labels and properties follow the locale.
- Existing tools remain the reference implementations; the pipeline reuses them.
- No commit.

## Review focus

1. **Graph validity:** no source, multiple sources, no output, cycles, merges, caps all reject with typed errors.
2. **Execution order:** topological order, not node-array order; fan-out produces independent branches.
3. **Memory:** intermediate PCM is not returned; only summaries and final outputs.
4. **Cache safety:** the excerpt range is part of the worker/cache key.
5. **UI honesty:** invalid graphs never dispatch; errors point at the offending node/edge.

## File map

Create:
- `packages/dsp/src/pipeline/types.ts`
- `packages/dsp/src/pipeline/validate.ts`
- `packages/dsp/src/pipeline/runPipeline.ts`
- `packages/dsp/src/pipeline/index.ts`
- `packages/dsp/test/pipeline/validate.test.ts`
- `packages/dsp/test/pipeline/runPipeline.test.ts`
- `apps/web/src/features/pipeline/pipelineState.ts`
- `apps/web/src/features/pipeline/pipelineState.test.ts`
- `apps/web/src/features/pipeline/pipelineView.tsx`
- `apps/web/src/features/pipeline/pipelineNode.tsx`
- `apps/web/src/features/pipeline/usePipelineRun.ts`
- `apps/web/src/features/pipeline/pipelineView.test.tsx`
- `apps/web/e2e/pipeline.spec.ts`
- `apps/web/src/features/pipeline/pipelineTheory.ts`

Modify:
- `packages/dsp/src/index.ts`
- `apps/web/package.json`
- `pnpm-lock.yaml`
- `apps/web/src/session/ops.ts`
- `apps/web/src/workers/dsp.worker.ts`
- `apps/web/src/session/ops.pipeline.test.ts`
- `apps/web/src/app/routes.tsx`
- `apps/web/src/app/sidebar.tsx`
- `apps/web/src/i18n/en.json`
- `apps/web/src/i18n/fa.json`
- `apps/web/src/features/theory/*`
- `docs/DECISIONS.md`
- `docs/THIRD_PARTY.md`
- `docs/PROGRESS.md`

## Task 1 — Add and record React Flow

**Files:** `apps/web/package.json`, `pnpm-lock.yaml`, `docs/DECISIONS.md`, `docs/THIRD_PARTY.md`

1. Add `@xyflow/react` to `apps/web` dependencies with the current stable version.
2. Record in `DECISIONS.md`:
   - Dependency: `@xyflow/react`.
   - License: MIT (verify from the installed package).
   - Why: branch/fan-out graph editing with stable node/edge IDs.
   - Alternatives rejected: hand-built SVG (too much interaction work), React Flow v11 (superseded).
3. Add the version, license, and URL to `THIRD_PARTY.md`.
4. Run `pnpm install` and confirm the lockfile changes only for this dependency and its transitive packages.
5. Import `@xyflow/react/dist/style.css` only from the lazy pipeline route, not the app shell.

## Task 2 — Versioned DSL and validation

**Files:** `packages/dsp/src/pipeline/types.ts`, `validate.ts`, `test/pipeline/validate.test.ts`

1. Implement exactly:
   ```ts
   export type XY = { readonly x: number; readonly y: number };
   export type PipelineNode =
     | { id: string; kind: "source"; params: Record<string, never>; position: XY }
     | { id: string; kind: "resample"; params: { targetRateHz: number; antiAlias: boolean }; position: XY }
     | { id: string; kind: "filter"; params: FilterApplyParams; position: XY }
     | { id: string; kind: "quantize"; params: { bits: number; dither: boolean; seed: number }; position: XY }
     | { id: string; kind: "codec"; params: { codec: CodecLabCodec; mdctBitsPerSecond: number; psychoacoustic: boolean; referenceSplDb: number }; position: XY }
     | { id: string; kind: "reverb"; params: ReverbProcessParams; position: XY }
     | { id: string; kind: "reverse"; params: Record<string, never>; position: XY }
     | { id: string; kind: "timeStretch"; params: { speedFactor: number; pitchSemitones: number }; position: XY }
     | { id: string; kind: "output"; params: { label: string }; position: XY };
   export type PipelineEdge = { readonly id: string; readonly from: string; readonly to: string };
   export type PipelineGraph = {
     readonly version: 1;
     readonly nodes: readonly PipelineNode[];
     readonly edges: readonly PipelineEdge[];
   };
   ```
   Avoid importing web-only codec types: move or alias `CodecLabCodec` in `packages/dsp/src/codecs/codecLabTypes.ts`; `apps/web/src/session/ops.ts` re-exports it.
2. `validatePipeline(graph): { ok: true } | { ok: false; code: PipelineErrorCode; nodeId?: string; edgeId?: string }` with codes:
   - `badVersion`, `duplicateNodeId`, `duplicateEdgeId`, `emptyNodeId`, `emptyEdgeId`,
   - `noSource`, `multipleSources`, `noOutput`, `cycle`, `merge`, `disconnected`,
   - `tooManyNodes`, `tooManyOutputs`, `badPosition`, `unknownEndpoint`, `selfEdge`.
3. Rules:
   - exactly one source; at least one output; every non-source has exactly one incoming edge;
   - no cycles; every node reachable from the source; every edge endpoint exists;
   - max 24 nodes; max 2 outputs; positions finite;
   - source has no incoming edge; output may have one incoming edge;
   - `from !== to`.
4. Tests cover every code, plus a valid linear graph and a valid fan-out graph.
5. Run `pnpm --filter @avalab/dsp exec vitest run test/pipeline/validate.test.ts`.

## Task 3 — Pure execution engine

**Files:** `runPipeline.ts`, `index.ts`, `test/pipeline/runPipeline.test.ts`

1. Define:
   ```ts
   export interface PipelineStageSummary {
     readonly nodeId: string;
     readonly kind: PipelineNode["kind"];
     readonly sampleCount: number;
     readonly sampleRateHz: number;
     readonly durationSeconds: number;
     readonly peak: number;
     readonly rms: number;
     readonly elapsedMs: number;
     readonly envelope: Float32Array;
   }
   export interface PipelineOutput {
     readonly nodeId: string;
     readonly label: string;
     readonly sampleCount: number;
     readonly sampleRateHz: number;
     readonly offsetSamples: number;
   }
   export interface PipelineRunResult {
     readonly stages: readonly PipelineStageSummary[];
     readonly outputs: readonly PipelineOutput[];
     readonly samples: Float32Array; // concatenated outputs, transferable
     readonly totalElapsedMs: number;
   }
   export function runPipeline(
     samples: Float32Array,
     sampleRateHz: number,
     graph: PipelineGraph,
     options?: { readonly envelopeBuckets?: number },
   ): PipelineRunResult;
   ```
2. Validate first; throw `PipelineRunError` with the validation code. Guard finite samples/rate.
3. Topological sort:
   - source first; stable tie-break by node array order;
   - execute each node once, even with fan-out;
   - cache each node’s output internally, release it after its last consumer (or at the end) — no return of intermediate PCM.
4. Node execution:
   - `resample`: `resampleRational` with `filter: antiAlias ? "kaiserSinc" : "none"`; update rate.
   - `filter`: `applyFilter` with the node’s `b/a/fir/compensateDelay`; `sampleRateHz` comes from upstream; keep rate.
   - `quantize`: `quantizeUniform` or `quantizeWithTpdfDither`; keep rate.
   - `codec`: use the same encode/decode paths as `codecLabProcess`; for `mdct`, use `encodeMdctPsycho` when `psychoacoustic`, else `encodeMdct`; keep rate.
   - `reverb`: `reverbProcess` with `sampleRateHz` from upstream; keep rate.
   - `reverse`: `reverse`.
   - `timeStretch`: `timeStretch` then `pitchShift`; validate speed in `[0.25, 4]`, semitones in `[-12, 12]`; keep rate.
5. Summary:
   - `envelope` length `2 * envelopeBuckets` (default 200) using one-pass min/max.
   - `peak`, `rms` finite; `elapsedMs` from `performance.now()`.
   - `durationSeconds = sampleCount / sampleRateHz`.
6. Outputs:
   - Collect output node PCM in node order.
   - `offsetSamples` is the running offset in the concatenated buffer.
   - At most 2 outputs; total samples must be finite.
7. Tests:
   - linear chain source → reverse → output; fan-out to two outputs; reverb; resample; codec; time-stretch.
   - output order and offsets match concatenation.
   - stage summaries count and envelope length.
   - a graph with an intermediate output only returns final output PCM.
   - memory: no stage summary contains sample arrays.
8. Run `pnpm --filter @avalab/dsp exec vitest run test/pipeline/runPipeline.test.ts`.

## Task 4 — Worker op and cache key

**Files:** `ops.ts`, `dsp.worker.ts`, `ops.pipeline.test.ts`

1. Add `pipelineRun` op:
   ```ts
   params: {
     graph: PipelineGraph;
     sampleRateHz: number;
     startSample: number;
     endSample: number;
   };
   payload: source excerpt Float32;
   result: PipelineRunResult;
   ```
2. Handler:
   - Validate `sampleRateHz`, range, and payload alignment/length.
   - Enforce `sampleCount <= 30 * sampleRateHz` and `endSample - startSample <= cap`.
   - Call `runPipeline`.
   - Return the concatenated `samples` as the payload; stage envelopes stay in meta.
3. Store usage:
   - `deriveWithSourceSlice("pipelineRun", { graph, sampleRateHz, startSample, endSample }, start, end)`.
   - The params include the range, so cache keys cannot collide.
4. Register in `dspOps`, worker handler map, and switch.
5. Tests:
   - valid graph returns outputs and summaries;
   - >30 s payload rejects `badParams`;
   - cache key differs for different ranges;
   - invalid graph rejects with the validation code;
   - payload is transferred, not cloned.
6. Run `pnpm --filter @avalab/web exec vitest run src/session/ops.pipeline.test.ts`.

## Task 5 — Pipeline UI

**Files:** `pipelineState.ts`, `pipelineNode.tsx`, `usePipelineRun.ts`, `pipelineView.tsx`, tests

1. State:
   - `graph: PipelineGraph` with initial source → output.
   - `selectedNodeId`, `validation`, `runState`, `selectedOutputId`.
   - URL key `pg`: URL-safe base64 of JSON. Cap the encoded string at 8192 chars; over-cap or malformed input falls back to the default graph with a translated warning.
   - `pipelineStateToSearch` / `pipelineStateFromSearch` total decode.
2. React Flow:
   - `ReactFlow` with `nodes`/`edges` derived from the graph; `onNodesChange` updates positions; `onConnect` adds an edge only if validation allows.
   - `nodeTypes` includes `PipelineNodeCard` for every kind.
   - `Background`, `Controls`, `MiniMap`; `dir="ltr"` wrapper.
   - No DSP imports in this file.
3. Node palette adds nodes at a stable grid position; disable when validation would exceed 24 nodes or 2 outputs.
4. Properties panel:
   - Locale labels; numeric inputs with units; technical values `dir="ltr"`.
   - Invalid values show translated inline errors before dispatch.
   - Delete node/edge buttons keep at least one source/output.
5. Run:
   - `usePipelineRun` calls `deriveWithSourceSlice` with the current graph and selection/default 30 s.
   - Shows per-stage cards (kind, duration, peak, RMS, elapsed) and a canvas envelope.
   - Cancel calls `store.cancel(ticket.key)`.
   - Result outputs: select an output and install it with `setProcessed(samples, rate, "pipeline:<label>")`; no source offset (output starts at excerpt start).
6. Save/load:
   - Download JSON with version, nodes, edges, positions.
   - File input parses and validates; errors are translated.
7. Tests:
   - State round-trip, over-cap URL fallback, invalid JSON fallback.
   - Add/connect/delete updates validation.
   - `pipelineView.test.tsx` static render shows palette and source/output nodes.
   - Run disabled while validation fails.
8. Run `pnpm --filter @avalab/web exec vitest run src/features/pipeline`.

## Task 6 — Route, bundle, docs, and e2e

1. Add `"pipeline"` to `TOOL_IDS`; route `/tools/pipeline` lazy-loads `PipelineView` with a translated suspense fallback.
2. Add sidebar link and i18n keys under `nav.pipeline`, `tool.pipeline`, `pipeline.*` in both locales.
3. Theory panel: sampling, filtering, quantization, codec, reverb, time-stretch, order effects, and why fan-out creates parallel experiments. Add to `docs/ALGORITHMS.md` the pipeline execution order and caps.
4. Playwright `pipeline.spec.ts`:
   - `fa` and `en`: open route, add filter, connect to output, run, assert stage cards and no console errors.
   - Reload the URL and assert the graph persists.
   - Try a cycle and assert a translated validation message; no worker call.
5. Run `pnpm check`, `pnpm --filter @avalab/web e2e -- pipeline.spec.ts`, `pnpm --filter @avalab/web build` (check lazy chunk).
6. Update `docs/PROGRESS.md`; do not commit.
