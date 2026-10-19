"""Generate AvaLab's bundled demo audio clips.

Purpose
-------
Produce three small, deterministic mono WAV files used by the web app's demo
buttons and by e2e tests. Clips are self-generated (no third-party audio), so
they are committed to the repository and licensed CC0/public domain along with
the project (see ``docs/THIRD_PARTY.md``).

Contract
--------
Every clip: 48000 Hz, 16-bit PCM, mono, 5.0 s (480000 PCM payload bytes +
44-byte WAV header). All randomness uses fixed seeds and all parameters are
constants, so two runs are byte-identical. Output directory is
``<repo-root>/apps/web/public/demo`` where the repo root is found by walking
up from this file until a directory containing ``.git`` is reached (same
convention as ``tools/golden``).

Clips
-----
- ``chirp-log-100to8000hz-5s.wav`` — logarithmic sine sweep 100 Hz → 8000 Hz.
  Instantaneous frequency ``f(t) = f0 * (f1/f0)**(t/T)``; the phase is its
  time integral ``phi(t) = 2*pi*f0*T/ln(f1/f0) * ((f1/f0)**(t/T) - 1)``.
- ``pink-noise-5s.wav`` — white Gaussian noise (seed 20261019) shaped in the
  frequency domain: each rFFT bin is scaled by ``1/sqrt(f)`` so power spectral
  density falls as ``1/f``; scaled to peak 0.7.
- ``clicks-2hz-5s.wav`` — impulse train at 2 clicks/s (every 0.5 s), each click
  a 2 kHz tone with exponential decay ``exp(-t/4ms)``, 40 ms long, amplitude 0.9.

Usage::

    uv run --directory tools/demo_clips python generate.py
"""

from __future__ import annotations

import wave
from pathlib import Path

import numpy as np

SAMPLE_RATE_HZ = 48000
DURATION_SECONDS = 5.0
NUM_SAMPLES = int(SAMPLE_RATE_HZ * DURATION_SECONDS)
OUTPUT_DIR = Path("apps/web/public/demo")


def find_repo_root(start: Path) -> Path:
    """Return the closest ancestor of *start* (inclusive) containing ``.git``."""
    resolved = start.resolve()
    for candidate in (resolved, *resolved.parents):
        if (candidate / ".git").exists():
            return candidate
    raise FileNotFoundError(f"no .git directory found above {start}")


def chirp_log_100to8000hz() -> np.ndarray:
    """Logarithmic sweep 100 Hz → 8000 Hz, amplitude 0.8."""
    t = np.arange(NUM_SAMPLES) / SAMPLE_RATE_HZ
    f0_hz, f1_hz = 100.0, 8000.0
    ratio = f1_hz / f0_hz
    phase = 2.0 * np.pi * f0_hz * DURATION_SECONDS / np.log(ratio) * (
        ratio ** (t / DURATION_SECONDS) - 1.0
    )
    return 0.8 * np.sin(phase)


def pink_noise() -> np.ndarray:
    """Deterministic pink noise via seeded white noise shaped with ``1/sqrt(f)``."""
    rng = np.random.default_rng(20261019)
    spectrum = np.fft.rfft(rng.standard_normal(NUM_SAMPLES))
    freqs_hz = np.fft.rfftfreq(NUM_SAMPLES, d=1.0 / SAMPLE_RATE_HZ)
    shape = np.ones_like(freqs_hz)
    shape[1:] = 1.0 / np.sqrt(freqs_hz[1:])
    pink = np.fft.irfft(spectrum * shape, n=NUM_SAMPLES)
    return 0.7 * pink / np.max(np.abs(pink))


def clicks_2hz() -> np.ndarray:
    """Impulse train at 2 clicks/s; each click decays exponentially (never clips)."""
    samples = np.zeros(NUM_SAMPLES)
    interval_samples = SAMPLE_RATE_HZ // 2
    click_samples = int(0.04 * SAMPLE_RATE_HZ)
    click_time = np.arange(click_samples) / SAMPLE_RATE_HZ
    click = np.exp(-click_time / 0.004) * np.sin(2.0 * np.pi * 2000.0 * click_time)
    click = 0.9 * click / np.max(np.abs(click))
    for start in range(0, NUM_SAMPLES - click_samples + 1, interval_samples):
        samples[start : start + click_samples] += click
    return samples


def write_wav(path: Path, samples: np.ndarray) -> None:
    """Write float samples in [-1, 1] as 16-bit PCM mono WAV."""
    pcm = np.clip(np.round(samples * 32767.0), -32768, 32767).astype("<i2")
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE_HZ)
        wav.writeframes(pcm.tobytes())


def main() -> int:
    out_dir = find_repo_root(Path(__file__)) / OUTPUT_DIR
    clips = {
        "chirp-log-100to8000hz-5s.wav": chirp_log_100to8000hz(),
        "pink-noise-5s.wav": pink_noise(),
        "clicks-2hz-5s.wav": clicks_2hz(),
    }
    for name, samples in clips.items():
        path = out_dir / name
        write_wav(path, samples)
        print(f"wrote {path} ({path.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
