# D-056 Phase 6 — Async full-file codecs and 200 MB upload cap

Status: Done 2026-11-07. No commit (owner gate).

## Scope

Implement F01 full-file real codecs without replacing the existing 30 s synchronous excerpt path:

- whole-file 16-bit PCM WAV upload through `/ingest`;
- `POST /api/v1/codec/jobs`, SSE progress at `/codec/jobs/{job_id}/events`, and `DELETE /codec/jobs/{job_id}`;
- bounded `CodecJobManager` (concurrency 1, queue cap 8, TTL cleanup, cancels ffmpeg);
- the same mono-reference alignment and all-channel bit-exactness as the sync route;
- raise `AVALAB_MAX_UPLOAD_BYTES` default to 200 MB;
- Codec Lab whole-file action with progress, cancel, errors, playback, and export;
- fa/en copy, theory note, docs, backend tests, unit tests, and e2e.

Non-goals: joint stereo, per-channel codec params, changing the excerpt path, new dependencies.

## Tasks

1. **Backend execution seam.** Move the shared encode/decode/align/store orchestration behind `encode_and_store(settings, request, *, progress, cancel)` while keeping `POST /codec/encode` synchronous. Add cancellation to `encode_audio` with a `Popen` poll loop; keep `subprocess.run` when no cancel check is supplied.
2. **Job manager.** Add `CodecJobManager` with a worker pool, queue cap, progress event queue, terminal events, cancel, persisted-result cleanup, and TTL purge. Add `job_busy`; reuse `job_not_found` and `job_cancelled`.
3. **Routes and wiring.** Add submit/SSE/cancel routes and app lifespan construction. Validate audio id, codec, and params before queueing. SSE emits one snapshot, progress, then a terminal event.
4. **Upload cap.** Set the backend default, mirrored browser default, `.env.example`, Compose default, docs, and tests to 200 MB.
5. **Frontend job client.** Add `runWholeFileCodec` with initial `/ingest` upload, job submit, SSE parsing via `fetch`, abort-triggered DELETE, progress callback, result fetch, and the shared decode/align path.
6. **Codec Lab UI.** Add whole-file and cancel actions, progress percent plus phase label, translated errors, playback/export through the existing result panel, and a TTL privacy hint. Keep the excerpt controls unchanged.
7. **Tests and docs.** API tests cover lifecycle, queue capacity, cancellation, TTL, SSE, validation, and the 200 MB default; web tests cover success, cancel, and `job_busy`; Playwright covers the whole-file flow. Update `ALGORITHMS.md`, `DECISIONS.md`, `PROGRESS.md`, and this backlog.

## Acceptance

- `uv run pytest`, ruff, and mypy pass.
- `pnpm check` and the web build pass.
- Targeted Codec Lab and stereo e2e pass with zero console errors.
- Mono and excerpt behavior, URLs, DOM ids, and tests remain compatible.

## Notes

- Cancellation is cooperative between phases and kills the running ffmpeg process; a result persisted at the same instant is deleted by the manager.
- SSE uses only numeric progress; the frontend maps thresholds to encode/decode/align/store labels because the stage split is deterministic in the runner.
