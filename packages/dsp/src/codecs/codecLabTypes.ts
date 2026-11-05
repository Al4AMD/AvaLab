/**
 * Purpose: codec identifiers shared by the web codec lab and the F15 pipeline
 * DSL. Kept in the pure DSP package so `@avalab/dsp` never imports web code.
 */

export type CodecLabCodec = "rle" | "huffman" | "deltaHuffman" | "mulaw" | "alaw" | "mdct";
