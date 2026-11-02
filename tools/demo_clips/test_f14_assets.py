"""Tests for the Wave-5 F14 demo assets and their provenance script."""

from __future__ import annotations

import unittest
import wave
from pathlib import Path

import numpy as np

from fetch_f14 import (
    ASSET_NAMES,
    OUTPUT_DIR,
    SAMPLE_RATE_HZ,
    TRANSCRIPT,
    check_assets,
    find_repo_root,
)

ASSET_DIR = find_repo_root(Path(__file__)) / OUTPUT_DIR


def read_mono_wav(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as source:
        if source.getnchannels() != 1 or source.getsampwidth() != 2:
            raise AssertionError(f"{path.name}: expected mono 16-bit PCM")
        rate = source.getframerate()
        frames = source.readframes(source.getnframes())
    return np.frombuffer(frames, dtype="<i2").astype(np.float64) / 32768.0, rate


class DemoAssetTests(unittest.TestCase):
    def test_all_assets_exist(self) -> None:
        missing = [name for name in ASSET_NAMES if not (ASSET_DIR / name).exists()]
        self.assertEqual(missing, [], f"missing assets: {missing}")

    def test_wav_format_and_duration(self) -> None:
        for name, minimum_seconds, maximum_seconds in (
            ("speech-kathleen-19s.wav", 18.5, 20.5),
            ("speech-kathleen-noisy-5db-19s.wav", 18.5, 20.5),
            ("music-life-turns-15s.wav", 14.5, 15.5),
        ):
            path = ASSET_DIR / name
            with wave.open(str(path), "rb") as source:
                self.assertEqual(source.getnchannels(), 1, name)
                self.assertEqual(source.getsampwidth(), 2, name)
                self.assertEqual(source.getframerate(), SAMPLE_RATE_HZ, name)
                duration = source.getnframes() / source.getframerate()
            self.assertGreaterEqual(duration, minimum_seconds, name)
            self.assertLessEqual(duration, maximum_seconds, name)

    def test_transcript_matches_pinned_sentences(self) -> None:
        transcript = (ASSET_DIR / "speech-kathleen-19s.txt").read_text(encoding="utf-8").strip()
        self.assertEqual(transcript, TRANSCRIPT)

    def test_noisy_snr_is_about_five_db(self) -> None:
        speech, speech_rate = read_mono_wav(ASSET_DIR / "speech-kathleen-19s.wav")
        noisy, noisy_rate = read_mono_wav(ASSET_DIR / "speech-kathleen-noisy-5db-19s.wav")
        self.assertEqual(speech_rate, noisy_rate)
        self.assertEqual(speech.shape, noisy.shape)
        signal_power = float(np.mean(speech * speech))
        residual_power = float(np.mean((noisy - speech) ** 2))
        snr_db = 10.0 * np.log10(signal_power / residual_power)
        self.assertAlmostEqual(snr_db, 5.0, delta=0.5)

    def test_music_does_not_clip(self) -> None:
        music, rate = read_mono_wav(ASSET_DIR / "music-life-turns-15s.wav")
        self.assertEqual(rate, SAMPLE_RATE_HZ)
        self.assertLessEqual(float(np.max(np.abs(music))), 1.0)

    def test_check_assets_accepts_generated_files(self) -> None:
        self.assertEqual(check_assets(ASSET_DIR), [])


if __name__ == "__main__":
    unittest.main()
