import { describe, expect, it, vi } from "vitest";
import {
  createLoudnessMatcher,
  type LoudnessMatchSnapshot,
  readLoudnessMatchEnabled,
  writeLoudnessMatchEnabled,
} from "./useLoudnessMatch";

type Deferred<T> = {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function lane(tag: number): { samples: Float32Array; sampleRateHz: number } {
  return { samples: Float32Array.of(tag), sampleRateHz: 48_000 };
}

function harness() {
  const pending = new Map<number, Deferred<number>>();
  const gainCalls: number[] = [];
  const updates: LoudnessMatchSnapshot[] = [];
  const measureLane = vi.fn((samples: Float32Array) => {
    const request = deferred<number>();
    pending.set(samples[0] ?? Number.NaN, request);
    return request.promise;
  });
  const matcher = createLoudnessMatcher({
    measureLane,
    setGainDb: (gainDb) => {
      gainCalls.push(gainDb);
    },
    onChange: (snapshot) => {
      updates.push(snapshot);
    },
  });
  return { matcher, pending, gainCalls, updates, measureLane };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("loudness match controller", () => {
  it("measures both lanes and applies the match gain", async () => {
    const { matcher, pending, gainCalls, updates, measureLane } = harness();
    matcher.run({ enabled: true, activeKind: "processed", original: lane(1), processed: lane(2) });

    expect(measureLane).toHaveBeenCalledTimes(2);
    expect(measureLane.mock.calls[0]?.[0]).not.toBe(measureLane.mock.calls[1]?.[0]);
    pending.get(1)?.resolve(-20);
    pending.get(2)?.resolve(-26);
    await flush();

    expect(gainCalls.at(-1)).toBe(6);
    expect(updates.at(-1)).toEqual({
      gainDb: 6,
      originalLufs: -20,
      processedLufs: -26,
      status: "ready",
    });
  });

  it("resets to 0 dB when the original lane is active or matching is disabled", () => {
    const original = harness();
    original.matcher.run({
      enabled: true,
      activeKind: "original",
      original: lane(1),
      processed: lane(2),
    });
    expect(original.gainCalls.at(-1)).toBe(0);
    expect(original.updates.at(-1)?.status).toBe("off");

    const disabled = harness();
    disabled.matcher.run({
      enabled: false,
      activeKind: "processed",
      original: lane(1),
      processed: lane(2),
    });
    expect(disabled.gainCalls.at(-1)).toBe(0);
    expect(disabled.updates.at(-1)?.status).toBe("off");
    expect(disabled.measureLane).not.toHaveBeenCalled();
  });

  it("ignores a stale measurement from a previous processed source", async () => {
    const { matcher, pending, gainCalls } = harness();
    matcher.run({
      enabled: true,
      activeKind: "processed",
      original: lane(10),
      processed: lane(2),
    });
    matcher.run({
      enabled: true,
      activeKind: "processed",
      original: lane(1),
      processed: lane(3),
    });

    pending.get(10)?.resolve(-20);
    pending.get(2)?.resolve(-50);
    await flush();
    expect(gainCalls.at(-1)).not.toBe(30);

    pending.get(1)?.resolve(-20);
    pending.get(3)?.resolve(-21);
    await flush();
    expect(gainCalls.at(-1)).toBe(1);
  });

  it("applies 0 dB for non-finite loudness and reports a measurement error", async () => {
    const nonFinite = harness();
    nonFinite.matcher.run({
      enabled: true,
      activeKind: "processed",
      original: lane(1),
      processed: lane(2),
    });
    nonFinite.pending.get(1)?.resolve(-20);
    nonFinite.pending.get(2)?.resolve(Number.NEGATIVE_INFINITY);
    await flush();
    expect(nonFinite.gainCalls.at(-1)).toBe(0);
    expect(nonFinite.updates.at(-1)?.status).toBe("ready");

    const failed = harness();
    failed.matcher.run({
      enabled: true,
      activeKind: "processed",
      original: lane(1),
      processed: lane(2),
    });
    failed.pending.get(1)?.reject(new Error("worker failed"));
    failed.pending.get(2)?.resolve(-20);
    await flush();
    expect(failed.gainCalls.at(-1)).toBe(0);
    expect(failed.updates.at(-1)?.status).toBe("error");
  });
});

describe("loudness match preference", () => {
  it("defaults to enabled and decodes only the explicit off value", () => {
    expect(readLoudnessMatchEnabled(null)).toBe(true);
    expect(readLoudnessMatchEnabled({ getItem: () => null })).toBe(true);
    expect(readLoudnessMatchEnabled({ getItem: () => "1" })).toBe(true);
    expect(readLoudnessMatchEnabled({ getItem: () => "0" })).toBe(false);
    expect(readLoudnessMatchEnabled({ getItem: () => "garbage" })).toBe(true);
  });

  it("writes through best-effort and survives storage failures", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    writeLoudnessMatchEnabled(false, storage);
    expect(readLoudnessMatchEnabled(storage)).toBe(false);
    writeLoudnessMatchEnabled(true, storage);
    expect(readLoudnessMatchEnabled(storage)).toBe(true);

    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => writeLoudnessMatchEnabled(false, storage)).not.toThrow();
    expect(readLoudnessMatchEnabled(null)).toBe(true);
  });
});
