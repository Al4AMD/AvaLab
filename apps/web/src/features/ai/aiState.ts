/**
 * AI-lab URL state (F14, Wave-5 Plan 01 Task 5).
 *
 * The task is the only shareable field for now: `?task=`. The public task ids
 * use hyphens, while the backend route and model registry use underscores
 * (`neural_codec`); the mapping lives here so callers never guess.
 */
import { type LastUsedStorage, readLastUsed } from "../../lib/lastUsed";
import { decodeParams, encodeParams } from "../../lib/url-state";

export const AI_STORAGE_KEY = "avalab.ai.last";

export const AI_TASKS = [
  "denoise",
  "superres",
  "separation",
  "asr",
  "neural-codec",
  "classification",
  "pitch",
  "beat",
] as const;
export type AiTask = (typeof AI_TASKS)[number];

/** Six visible tabs; pitch and beat share the `pitchBeat` tab. */
export const AI_TABS = [
  "denoise",
  "superres",
  "separation",
  "asr",
  "neural-codec",
  "classification",
  "pitchBeat",
] as const;
export type AiTab = (typeof AI_TABS)[number];

export type AnalysisTask = Extract<AiTask, "pitch" | "beat">;

export function isAnalysisTask(task: AiTask): task is AnalysisTask {
  return task === "pitch" || task === "beat";
}

export function aiTabForTask(task: AiTask): AiTab {
  return isAnalysisTask(task) ? "pitchBeat" : task;
}

const BACKEND_TASK: Record<AiTask, string> = {
  denoise: "denoise",
  superres: "superres",
  separation: "separation",
  asr: "asr",
  "neural-codec": "neural_codec",
  classification: "classification",
  pitch: "pitch",
  beat: "beat",
};

/** Public id → backend path/registry id. */
export function backendTask(task: AiTask): string {
  return BACKEND_TASK[task];
}

/** Backend id → public id; unknown ids return null (protocol mismatch). */
export function aiTaskFromBackend(value: string): AiTask | null {
  const task = AI_TASKS.find((candidate) => BACKEND_TASK[candidate] === value);
  return task ?? null;
}

export function isAiTask(value: unknown): value is AiTask {
  return typeof value === "string" && (AI_TASKS as readonly string[]).includes(value);
}

/** Parse `?task=`; missing or unknown values fall back to denoise. */
export function aiTaskFromSearch(search: string): AiTask {
  const value = decodeParams(search).task;
  return typeof value === "string" && isAiTask(value) ? value : "denoise";
}

/** Encode the task as a bare query string (no leading "?"). */
export function aiTaskToSearch(task: AiTask): string {
  return encodeParams({ task });
}

/** Last-used task; missing/invalid storage falls back to denoise. */
export function loadAiTask(storage?: LastUsedStorage | null): AiTask {
  const stored = readLastUsed(AI_STORAGE_KEY, storage);
  return stored === null ? "denoise" : aiTaskFromSearch(stored);
}
