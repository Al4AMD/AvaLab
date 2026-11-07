"""Tests for the self-generated demo clips (including the stereo track)."""

from __future__ import annotations

import tempfile
import unittest
import wave
from pathlib import Path

import numpy as np

import generate

ASSET_DIR = generate.find_repo_root(Path(__file__)) / generate.OUTPUT_DIR
STEREO_NAME = "stereo-tones-440-660hz-5s.wav"


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as source:
        channels = source.getnchannels()
        rate = source.getframerate()
        samples = np.frombuffer(source.readframes(source.getnframes()), dtype="<i2")
    return samples.reshape(-1, channels) / 32768.0, rate


class GenerateTests(unittest.TestCase):
    def test_stereo_tones_are_deterministic_and_separated(self) -> None:
        first = generate.stereo_tones()
        second = generate.stereo_tones()
        self.assertEqual(first.shape, (generate.NUM_SAMPLES, 2))
        np.testing.assert_array_equal(first, second)
        left_peak = float(np.max(np.abs(first[:, 0])))
        right_peak = float(np.max(np.abs(first[:, 1])))
        self.assertAlmostEqual(left_peak, 0.8, places=6)
        self.assertAlmostEqual(right_peak, 0.8, places=6)
        self.assertGreater(float(np.max(np.abs(first[:, 0] - first[:, 1]))), 0.5)

    def test_write_wav_supports_mono_and_stereo(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            mono_path = Path(directory) / "mono.wav"
            stereo_path = Path(directory) / "stereo.wav"
            generate.write_wav(mono_path, np.array([0.0, 0.5, -0.5]))
            generate.write_wav(stereo_path, np.array([[0.0, 0.5], [-1.0, 1.0]]))
            mono, mono_rate = read_wav(mono_path)
            stereo, stereo_rate = read_wav(stereo_path)
            self.assertEqual(mono_rate, generate.SAMPLE_RATE_HZ)
            self.assertEqual(stereo_rate, generate.SAMPLE_RATE_HZ)
            self.assertEqual(mono.shape, (3, 1))
            self.assertEqual(stereo.shape, (2, 2))
            self.assertGreater(float(stereo[1, 1]), float(stereo[1, 0]))

    def test_committed_stereo_asset_matches_generator_and_frequencies(self) -> None:
        path = ASSET_DIR / STEREO_NAME
        self.assertTrue(path.exists(), f"missing {path}")
        with tempfile.TemporaryDirectory() as directory:
            fresh = Path(directory) / STEREO_NAME
            generate.write_wav(fresh, generate.stereo_tones())
            self.assertEqual(path.read_bytes(), fresh.read_bytes())

        samples, rate = read_wav(path)
        self.assertEqual(rate, generate.SAMPLE_RATE_HZ)
        self.assertEqual(samples.shape, (generate.NUM_SAMPLES, 2))
        spectrum = np.abs(np.fft.rfft(samples, axis=0))
        frequencies = np.fft.rfftfreq(samples.shape[0], d=1.0 / rate)
        self.assertAlmostEqual(float(frequencies[np.argmax(spectrum[:, 0])]), 440.0, delta=0.5)
        self.assertAlmostEqual(float(frequencies[np.argmax(spectrum[:, 1])]), 660.0, delta=0.5)


if __name__ == "__main__":
    unittest.main()
