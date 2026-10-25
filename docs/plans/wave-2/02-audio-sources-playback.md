# Wave 2 · Plan 02 — Audio sources (F01) and the dock player

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** A session gets a source: upload (backend ingest lane), bundled demo clips and `decodeAudioData` (offline lane), microphone recording (backend lane), or the generator (Plan 04, seam only) — and the dock player plays it.

**Architecture:** Spec §2.4 (two lanes, `backendOnline` detection) + §2.7 (player = AudioContext/AudioBufferSourceNode, `playbackRate` seam). Store owns lifecycle; features compose store actions; no direct `fetch`/`AudioContext` from view code.

**Tech Stack:** As Plan 01. New deps: none.

**Spec:** `AGENTS.md` §7 (limits, codes, privacy), §9 (offline lane, memory), F01/F02; existing API client `apps/web/src/api/client.ts` + `HealthStatus` patterns; error model from Wave 0 Task 5.

## Review Focus

1. **Limits are the backend's truth** — uploads go through `/api/v1/ingest`; a >5-min file is rejected with the backend's translated error, never silently truncated (F01) — client-side size pre-check is a courtesy only; the offline lane enforces the 300 s / 96 kHz caps in `loadSource` guards.
2. **Memory discipline (§9)** — at most two full-length held buffers ever (original PCM + the playing AudioBuffer); loading a new source releases the previous AudioBufferSourceNode and its buffer; no leaked listeners/URL.createObjectURL (revoke in cleanup).
3. **Lane honesty** — the UI always states which lane produced the audio (ingest/offline/demo/generated); `backendOnline` flips only on real failed API call evidence, then the input UI disables backend-only affordances with an explanation.
4. **Recording is honest** — MediaRecorder start/stop state machine (idle/recording→ingest), mic-permission errors surfaced translated, cancel stops tracks (indicator light off), the ingest flow reuses Task 1's loader (no second implementation).
5. **i18n/RTL + a11y** — every control keyboard-operable, translated ARIA labels, focus visible; both locales; zero console errors.

---
### Task 1: Upload → ingest → session

**Files:** Create `apps/web/src/features/input/{ingest.ts,upload.tsx}`; dropzone + file button on `/tools/waveform` empty state (shared "no source" empty-state block); i18n keys `input.*`.

**Interfaces:**
- `ingestFile(file: File): Promise<LoadedSource>` — POST `/ingest` (multipart), then GET `/audio/{id}` (canonical WAV) → `decodeAudioData` → `loadSource(...)`; maps backend error `code` → translated `input.error.*` (unknown codes keep the code verbatim).
- Client pre-check: file.size > configured max → immediate translated rejection without hitting the API; duration violations surface only from the backend truth.
- The player dock consumes the same `LoadedReader` — no player changes.

**Tests:** unit loaders against a stubbed client (ok / rate-too-high / too-long / backend-offline→promise rejects with lane error); no truncated audio ever; store integration (source set, cache cleared); Playwright (backend-absent CI): upload attempt shows the offline-lane message with recovery hint; console clean.

- [ ] Commit `feat(F01): upload ingest lane with translated limit errors`

### Task 2: Offline lane + demo clips

**Files:** Create `apps/web/src/features/input/{offline.ts,demo.tsx}`; sidebar empty-state picks up demo cards (`apps/web/public/demo/*.wav`, three clips from D-016).

**Interfaces:**
- `loadOfflineFile(file: File)` — `decodeAudioData` directly → `loadSource` with `sourceKind: "offlineBrowser"`; lane badge shows "browser decode (offline lane)".
- `loadDemoClip(clipId)` — fetch `/demo/<file>.wav` → offline lane loader.
- `backendOnline` becomes observable: `HealthStatus` becomes the consumer of a store flag (single source of truth), its UI unchanged otherwise.

**Tests:** loaders unit-tested offline (jsdom + FA decode stub where real WebAudio is absent — decode shim behind a seam interface); Playwright: demo card loads → waveform stub shows real sample count; store guards still apply (a >300 s file offline → typed cap error); both locales; zero console errors.

- [ ] Commit `feat(F01): offline decode lane and demo clip cards`

### Task 3: Microphone recording

**Files:** Create `apps/web/src/features/input/record.tsx` (+ `lib/media.ts` for the recorder seam); button placement in the input empty state.

**Interfaces:**
- `media.ts`: `createRecorder(onChunk)` wraps MediaRecorder with a typed state machine (`idle | requesting | recording | processing | error`) — injectable seam for tests (no mic in CI).
- Start requests permission (translated errors on `NotAllowedError` etc.); stop sends the recorded blob down Task 1's `ingestFile` (`sourceKind: "recording"`); cancel stops tracks + resets state.
- Recording cap: client-side stop at 5 min with the same translated limit message (backend rejects anyway; honest UX beats a surprise).

**Tests:** state-machine unit tests with fake recorder; permission-denied path; Playwright: recording button disabled (no media devices in CI) without crashing, ARIA intact; i18n parity.

- [ ] Commit `feat(F01): microphone recording via media recorder to ingest`

### Task 4: Dock player

**Files:** Create `apps/web/src/features/player/{player.tsx,usePlayer.ts,transport.ts}`; dock fills Plan 01's placeholder on every tool page.

**Interfaces:**
- `usePlayer`: builds/maintains one `AudioBuffer` for the current source (mono+stereo channels input), play/pause/toggle, `seekTo(sample)`, `seekBySeconds(±5 | ±10)`, `currentTimeSample` via rAF-sampled state (throttled to a store slice), end-of-source stop; cleanup on source change (§9 rule: exactly one live source node).
- Selection region (from store) is highlighted on the transport; loop-region toggle reserved but disabled until a derived source exists (Wave 3+).
- `playbackRate` field exists and is pinned 1 (F06 seam).
- Playhead: single pub-sub (`playhead.ts` tiny event target) — Plan 03 subscribes; the player never re-renders canvases directly.

**Tests:** transport state machine unit tests with a fake AudioContext (jsdom seam); Playwright: demo clip loaded → play → head moves (store slice), pause/seek/±5 s keys and buttons; console clean in both locales.

- [ ] Commit `feat(F02): dock player with transport and playhead`
