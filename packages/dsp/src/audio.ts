/**
 * Purpose: shared playback-channel vocabulary for the session and WAV
 * boundary. The analysis lane stays a single mono Float32Array; this type
 * only describes the one- or two-channel playback data.
 *
 * Formula: n/a (type declaration).
 *
 * Reference: AGENTS section 10 (session state) and F01 (stereo playback).
 *
 * Complexity: n/a.
 *
 * Edge cases: runtime validation belongs to the consumers (store, WAV
 * encoder); the type itself cannot enforce 1–2 equal-length lanes.
 */

/** Playback channels: one or two equal-length Float32 lanes. */
export type AudioChannels = readonly Float32Array[];
