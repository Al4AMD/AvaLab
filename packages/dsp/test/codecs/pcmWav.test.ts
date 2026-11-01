import { describe, expect, it } from "vitest";
import {
  bytesToInt16Pcm,
  encodeWavPcm16,
  floatToInt16Pcm,
  int16PcmToBytes,
  int16PcmToFloat,
} from "../../src/index.js";

describe("floatToInt16Pcm", () => {
  it("maps the pinned conversion table", () => {
    const input = new Float32Array([-1, -0.5, 0, 0.5, 1]);
    expect(Array.from(floatToInt16Pcm(input))).toEqual([-32768, -16384, 0, 16384, 32767]);
  });

  it("clips samples outside full scale", () => {
    expect(Array.from(floatToInt16Pcm(new Float32Array([-2, 2])))).toEqual([-32768, 32767]);
  });

  it("accepts Float64Array input", () => {
    expect(Array.from(floatToInt16Pcm(new Float64Array([0.5, -0.5])))).toEqual([16384, -16384]);
  });

  it("rejects non-finite samples", () => {
    expect(() => floatToInt16Pcm(new Float32Array([Number.NaN]))).toThrow(TypeError);
    expect(() => floatToInt16Pcm(new Float32Array([Number.POSITIVE_INFINITY]))).toThrow(TypeError);
  });

  it("does not mutate the input", () => {
    const input = new Float32Array([-0.25, 0.25]);
    const before = Array.from(input);
    floatToInt16Pcm(input);
    expect(Array.from(input)).toEqual(before);
  });
});

describe("int16PcmToFloat", () => {
  it("divides by 32768 into a fresh Float32Array", () => {
    const input = new Int16Array([-32768, -16384, 0, 16384, 32767]);
    const output = int16PcmToFloat(input);
    expect(Array.from(output)).toEqual([-1, -0.5, 0, 0.5, 32767 / 32768]);
    expect(output).not.toBe(input);
  });

  it("does not mutate the input", () => {
    const input = new Int16Array([-1, 1]);
    const before = Array.from(input);
    int16PcmToFloat(input);
    expect(Array.from(input)).toEqual(before);
  });
});

describe("int16PcmToBytes", () => {
  it("writes little-endian pairs", () => {
    const bytes = int16PcmToBytes(new Int16Array([-32768, -1, 0, 1, 32767]));
    expect(Array.from(bytes)).toEqual([0x00, 0x80, 0xff, 0xff, 0x00, 0x00, 0x01, 0x00, 0xff, 0x7f]);
  });

  it("returns a fresh array and leaves the input alone", () => {
    const input = new Int16Array([1234]);
    const before = Array.from(input);
    const bytes = int16PcmToBytes(input);
    expect(bytes.length).toBe(2);
    expect(Array.from(input)).toEqual(before);
  });
});

describe("bytesToInt16Pcm", () => {
  it("round-trips int16 values through little-endian bytes", () => {
    const input = new Int16Array([-32768, -1, 0, 1, 32767]);
    expect(Array.from(bytesToInt16Pcm(int16PcmToBytes(input)))).toEqual(Array.from(input));
  });

  it("rejects an odd byte length with the pinned message", () => {
    expect(() => bytesToInt16Pcm(new Uint8Array([1]))).toThrow(
      RangeError("bytesToInt16Pcm: odd byte length"),
    );
  });

  it("returns a fresh array and leaves the input alone", () => {
    const input = new Uint8Array([0x34, 0x12]);
    const before = Array.from(input);
    const samples = bytesToInt16Pcm(input);
    expect(Array.from(samples)).toEqual([0x1234]);
    expect(Array.from(input)).toEqual(before);
  });
});

describe("encodeWavPcm16", () => {
  it("writes a valid 44-byte header for empty input", () => {
    const bytes = encodeWavPcm16(new Float32Array(0), { sampleRateHz: 48_000 });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(bytes.length).toBe(44);
    expect(readTag(bytes, 0)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(36);
    expect(readTag(bytes, 8)).toBe("WAVE");
    expect(readTag(bytes, 12)).toBe("fmt ");
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(48_000);
    expect(view.getUint32(28, true)).toBe(96_000);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(readTag(bytes, 36)).toBe("data");
    expect(view.getUint32(40, true)).toBe(0);
  });

  it("writes the mono 16-bit samples after the header", () => {
    const bytes = encodeWavPcm16(new Float32Array([0, 0.5, -1]), { sampleRateHz: 8_000 });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(bytes.length).toBe(50);
    expect(view.getUint32(4, true)).toBe(42);
    expect(view.getUint32(24, true)).toBe(8_000);
    expect(view.getUint32(28, true)).toBe(16_000);
    expect(view.getUint32(40, true)).toBe(6);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(16_384);
    expect(view.getInt16(48, true)).toBe(-32_768);
  });

  it("accepts the maximum rate and rejects invalid rates", () => {
    expect(() => encodeWavPcm16(new Float32Array(1), { sampleRateHz: 192_000 })).not.toThrow();
    for (const sampleRateHz of [0, -1, 1.5, 192_001, Number.NaN]) {
      expect(() => encodeWavPcm16(new Float32Array(1), { sampleRateHz })).toThrow(RangeError);
    }
  });
});

function readTag(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );
}
