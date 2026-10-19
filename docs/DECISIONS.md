# DECISIONS.md — ADR log

> Every deviation from AGENTS.md and every owner decision from AGENTS.md §16 is recorded here.
> Format: ID, date, status, context, decision, consequences.

## D-001 — Open-source license: GPL-3.0

- Date: 2026-10-19
- Status: accepted (owner — `LICENSE` file exists in repo root)
- Context: AGENTS.md §16 Q0.
- Decision: **GPL-3.0**.
- Consequences: Copyleft. All bundled dependencies must be GPLv3-compatible (MIT/Apache-2.0/BSD are compatible; each recorded in `docs/THIRD_PARTY.md`). Do NOT bundle CC-BY-NC or other non-commercial model weights — they conflict with GPLv3's commercial-use freedom. ffmpeg stays a separate process, never linked (AGENTS.md §14).

## D-002 — Compute device policy: CPU floor, GPU optional

- Date: 2026-10-19
- Status: accepted (owner)
- Context: AGENTS.md §16 Q1. Owner's laptop has both GPU and CPU. Final hosting unknown (university).
- Decision: ML code is device-agnostic (`torch.device` autodetect). Everything MUST run CPU-only — that is the mandatory floor. GPU is an optional accelerator: docker compose gets an optional GPU profile; model selection must never require GPU.
- Consequences: Job ETA estimates must handle both devices. CI runs CPU-only.

## D-003 — Project deliverables: PDF report + slides

- Date: 2026-10-19
- Status: accepted (owner)
- Context: AGENTS.md §16 Q2.
- Decision: Final project deliverables to the instructor are a **PDF report** and **presentation slides**. In-app export (F16) remains the PDF/HTML lab report for students — separate concern.
- Consequences: M5 (Wave 6) includes report + slides production tasks. `docs/PROGRESS.md` and `docs/DECISIONS.md` double as report source material; keep them precise.

## D-004 — Guided experiments: comprehensive coverage

- Date: 2026-10-19
- Status: accepted (owner — "everything professional")
- Context: AGENTS.md §16 Q3.
- Decision: Every P0/P1 tool ships 5–8 guided experiments with expected observations. Agents draft fa+en; owner reviews Persian.
- Consequences: F16 content is a continuous track, not a single task. Persian drafts flagged in `docs/PROGRESS.md`.

## D-005 — Perceptual metric: deferred; fallback chosen

- Date: 2026-10-19
- Status: accepted (agent decision, delegated by owner — "if necessary")
- Context: AGENTS.md §16 Q4.
- Decision: Not needed for MVP. The rate–distortion plot uses already-implemented SNR/MSE. If a perceptual axis is later wanted: single candidate **`pystoi` (MIT, pure Python, speech-only)**. Do NOT add PESQ (ITU reference implementation license is restrictive).
- Consequences: F05 perceptual item stays optional (P2). Revisit in M5.

## D-006 — WebAssembly DSP: benchmark-gated

- Date: 2026-10-19
- Status: accepted (owner — "if necessary")
- Context: AGENTS.md §16 Q5.
- Decision: Keep the escape hatch only. Optimize TypeScript first (typed arrays, precomputed twiddles, in-place). WASM is added ONLY after a recorded benchmark shows the §9 budgets are missed.
- Consequences: No WASM in Wave 1. Benchmarks run when a budget fails or during M5.

## D-007 — Range serving semantics deviate from the Task 8 brief wording

- Date: 2026-10-19
- Status: accepted (agent, empirically verified against installed starlette 1.9.0; revised in Task 8 fix rounds 1–3)
- Context: Task 8 brief expected malformed ranges (`bytes=50-10`, `bytes=abc`) → 416 `range_not_satisfiable`, and multi-range → "first range only". Empirical testing of `FileResponse` showed: malformed/inverted → plain-text 400 raised inside the send phase (bypasses FastAPI exception handlers); multi-range → RFC 9110 `multipart/byteranges` (206, all ranges); unsatisfiable → correct 416 + `Content-Range: bytes */<size>` but as a bare text response with no API error envelope.
- Decision: the route pre-validates every Range header; all rejections are API envelopes. Accepted grammar: a single `bytes=(\d*)-(\d*)` spec with at least one non-empty group, or a comma-joined list of such specs (no whitespace inside the list). Malformed headers (`bytes=abc`, `bytes=`, trailing/empty comma parts, spaced multi-ranges, `bytes=0-9,abc`, wrong unit) → **400 envelope `invalid_request`** (was starlette's plain-text 400). Any spec with a digit run longer than 18 characters → **400 envelope `invalid_request`**, checked before every `int()`; this keeps CPython's 4300-digit conversion limit unreachable from both the route (uncaught `ValueError` → 500) and starlette's parser (`ValueError`-skipped parts → empty ranges → plain-text 400). Inverted single ranges (`end < start`, checked before `start >= size` so the answer is file-size independent) → **416 envelope `range_not_satisfiable`** + `Content-Range: bytes */<size>` (was starlette's plain-text 400). Grammar-valid sets with any non-servable part (start >= size, zero-valued suffix — compared numerically so any zero-padding matches, any range on a zero-byte file) → 416 envelope + header; more than `FileResponse.max_ranges` parts → 400 envelope. Valid single ranges → 206; valid multi-ranges → RFC 9110 `multipart/byteranges` (not "first range only") — both delegated to `FileResponse`.
- Consequences: `GET /audio/{id}` error bodies are always envelopes; no plain-text error path remains for this endpoint (grammar, digit-length cap, unsatisfiable parts and excessive part counts are all rejected route-side before starlette; re-verified in fix round 3 across suffix forms with zero-padding, single ranges, multi-ranges and the digit-cap boundaries). `stat()` failures of any kind (`OSError`) answer the 404 envelope. Tests pin the grammar, statuses and headers so a starlette upgrade cannot silently change semantics.
