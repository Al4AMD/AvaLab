"""Fetch and derive the Wave-5 F14 demo assets.

Purpose
-------
Build the four CC0 audio assets used by the Wave-5 AI tools.  The source
recordings are third-party CC0 files; this script downloads them, verifies
their recorded SHA-256, derives deterministic mono 48 kHz 16-bit WAV files,
and writes the exact reference transcript.

Outputs (in ``apps/web/public/demo`` unless ``--out`` is given)
---------------------------------------------------------------
- ``speech-kathleen-19s.wav``: three Kathleen utterances, 0.4 s silence
  between them, mono, 48 kHz, 16-bit PCM.
- ``speech-kathleen-19s.txt``: the three reference sentences separated by
  spaces (ASR reference).
- ``speech-kathleen-noisy-5db-19s.wav``: the speech asset plus seeded pink
  noise at a measured 5 dB SNR, clipped to [-1, 1].
- ``music-life-turns-15s.wav``: 15 s of "Life Turns to History" from 75 s,
  mono, 48 kHz, 16-bit PCM, peak-normalized to -1 dBFS.

The noisy derivative uses ``numpy.random.default_rng(20261103)``; the music
excerpt start is pinned so reruns select the same section.  ``--check`` never
downloads and only validates existing outputs.

Usage::

    uv run --directory tools/demo_clips python fetch_f14.py
    uv run --directory tools/demo_clips python fetch_f14.py --check
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import wave
from pathlib import Path

import numpy as np

SAMPLE_RATE_HZ = 48000
OUTPUT_DIR = Path("apps/web/public/demo")
MUSIC_START_SECONDS = 75.0
MUSIC_DURATION_SECONDS = 15.0
NOISE_SEED = 20261103
NOISE_SNR_DB = 5.0
SILENCE_SECONDS = 0.4

SPEECH_SOURCES = (
    (
        "https://raw.githubusercontent.com/rhasspy/dataset-voice-kathleen/master/data/arctic_a0407_1592707592.wav",
        "53fc54eacb75cf5db35aba8dc28b56e6ab0eea7ff8b38c5a910ccfba11a4a8a1",
        "arctic_a0407_1592707592.wav",
    ),
    (
        "https://raw.githubusercontent.com/rhasspy/dataset-voice-kathleen/master/data/arctic_b0496_1592526615.wav",
        "43c4d9ae1aa570cc8d875076b58cee11e649c473aac449d310e4337ec84d5962",
        "arctic_b0496_1592526615.wav",
    ),
    (
        "https://raw.githubusercontent.com/rhasspy/dataset-voice-kathleen/master/data/arctic_a0507_1592703857.wav",
        "3113542e210f6a803ae419be50d8faea063b316400e79ec3b408a8dead8e8072",
        "arctic_a0507_1592703857.wav",
    ),
)
MUSIC_SOURCE = (
    "https://opengameart.org/sites/default/files/09_life_turns_to_history.flac",
    "22273ebd073fda1ab5f827d2ae128e5e4ebdf7a9add5c3de9d295232c91be5e0",
    "life-turns-to-history.flac",
)
TRANSCRIPT = (
    "Mercedes screamed, cried, laughed, and manifested the chaotic abandonment of hysteria. "
    "I have seen myself that one man contemplated by Pascal's philosophic eye. "
    "In short, my joyous individualism was dominated by the orthodox bourgeois ethics."
)

ASSET_NAMES = (
    "speech-kathleen-19s.wav",
    "speech-kathleen-19s.txt",
    "speech-kathleen-noisy-5db-19s.wav",
    "music-life-turns-15s.wav",
)


def find_repo_root(start: Path) -> Path:
    """Return the closest ancestor of *start* (inclusive) containing ``.git``."""
    resolved = start.resolve()
    for candidate in (resolved, *resolved.parents):
        if (candidate / ".git").exists():
            return candidate
    raise FileNotFoundError(f"no .git directory found above {start}")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(url: str, expected_sha256: str, destination: Path) -> None:
    """Download *url*, verify its SHA-256, and write it to *destination*."""
    request = urllib.request.Request(url, headers={"User-Agent": "avalab-f14-assets/1"})
    with urllib.request.urlopen(request, timeout=120) as response:
        data = response.read()
    actual = hashlib.sha256(data).hexdigest()
    if actual != expected_sha256:
        raise RuntimeError(f"SHA-256 mismatch for {url}: expected {expected_sha256}, got {actual}")
    destination.write_bytes(data)


def read_speech_wav(path: Path) -> np.ndarray:
    """Read a 16-bit stereo 48 kHz WAV as a mono float64 array."""
    with wave.open(str(path), "rb") as source:
        if source.getnchannels() != 2 or source.getsampwidth() != 2:
            raise RuntimeError(f"unexpected speech format in {path.name}: expected stereo 16-bit")
        if source.getframerate() != SAMPLE_RATE_HZ:
            raise RuntimeError(
                f"unexpected speech rate in {path.name}: expected {SAMPLE_RATE_HZ} Hz"
            )
        frames = source.readframes(source.getnframes())
    pcm = np.frombuffer(frames, dtype="<i2").reshape(-1, 2)
    return pcm.astype(np.float64).mean(axis=1) / 32768.0


def decode_excerpt(path: Path, start_s: float, duration_s: float) -> np.ndarray:
    """Decode a mono 48 kHz excerpt with ffmpeg and return float64 samples."""
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        raise RuntimeError("ffmpeg is required to decode the music source")
    command = [
        ffmpeg,
        "-v",
        "error",
        "-i",
        str(path),
        "-ss",
        f"{start_s:.3f}",
        "-t",
        f"{duration_s:.3f}",
        "-ac",
        "1",
        "-ar",
        str(SAMPLE_RATE_HZ),
        "-f",
        "f32le",
        "-acodec",
        "pcm_f32le",
        "pipe:1",
    ]
    result = subprocess.run(command, check=True, capture_output=True)
    return np.frombuffer(result.stdout, dtype="<f4").astype(np.float64)


def pink_noise(length: int, rng: np.random.Generator) -> np.ndarray:
    """White noise shaped to 1/sqrt(f), normalized to unit RMS."""
    spectrum = np.fft.rfft(rng.standard_normal(length))
    frequencies = np.fft.rfftfreq(length, d=1.0 / SAMPLE_RATE_HZ)
    shape = np.ones_like(frequencies)
    shape[1:] = 1.0 / np.sqrt(frequencies[1:])
    noise = np.fft.irfft(spectrum * shape, n=length)
    return noise / np.sqrt(np.mean(noise * noise))


def write_wav(path: Path, samples: np.ndarray) -> None:
    """Write float samples in [-1, 1] as 16-bit PCM mono WAV."""
    pcm = np.clip(np.round(samples * 32767.0), -32768, 32767).astype("<i2")
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as destination:
        destination.setnchannels(1)
        destination.setsampwidth(2)
        destination.setframerate(SAMPLE_RATE_HZ)
        destination.writeframes(pcm.tobytes())


def build_assets(out_dir: Path) -> list[Path]:
    """Download sources and write the four F14 assets; return their paths."""
    out_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="avalab-f14-") as temporary:
        temp_dir = Path(temporary)
        speech_parts: list[np.ndarray] = []
        silence = np.zeros(int(SILENCE_SECONDS * SAMPLE_RATE_HZ), dtype=np.float64)
        for url, expected_sha256, name in SPEECH_SOURCES:
            source_path = temp_dir / name
            download(url, expected_sha256, source_path)
            speech_parts.extend((read_speech_wav(source_path), silence))
        speech = np.concatenate(speech_parts[:-1])

        music_path = temp_dir / MUSIC_SOURCE[2]
        download(MUSIC_SOURCE[0], MUSIC_SOURCE[1], music_path)
        music = decode_excerpt(music_path, MUSIC_START_SECONDS, MUSIC_DURATION_SECONDS)
        peak = float(np.max(np.abs(music)))
        if peak > 0:
            music *= 10.0 ** (-1.0 / 20.0) / peak

    speech_path = out_dir / "speech-kathleen-19s.wav"
    transcript_path = out_dir / "speech-kathleen-19s.txt"
    noisy_path = out_dir / "speech-kathleen-noisy-5db-19s.wav"
    music_out_path = out_dir / "music-life-turns-15s.wav"

    write_wav(speech_path, speech)
    transcript_path.write_text(TRANSCRIPT + "\n", encoding="utf-8")

    speech_rms = float(np.sqrt(np.mean(speech * speech)))
    noise = pink_noise(speech.size, np.random.default_rng(NOISE_SEED))
    noise *= speech_rms / (10.0 ** (NOISE_SNR_DB / 20.0))
    write_wav(noisy_path, np.clip(speech + noise, -1.0, 1.0))
    write_wav(music_out_path, music)

    return [speech_path, transcript_path, noisy_path, music_out_path]


def check_assets(out_dir: Path) -> list[str]:
    """Return a list of problems with the existing output assets."""
    problems: list[str] = []
    for name in ASSET_NAMES:
        path = out_dir / name
        if not path.exists():
            problems.append(f"missing {path}")
    if problems:
        return problems

    def wav_info(path: Path) -> tuple[int, int, int, float]:
        with wave.open(str(path), "rb") as source:
            return (
                source.getnchannels(),
                source.getsampwidth(),
                source.getframerate(),
                source.getnframes() / source.getframerate(),
            )

    for name, minimum, maximum in (
        ("speech-kathleen-19s.wav", 18.5, 20.5),
        ("speech-kathleen-noisy-5db-19s.wav", 18.5, 20.5),
        ("music-life-turns-15s.wav", 14.5, 15.5),
    ):
        channels, width, rate, duration = wav_info(out_dir / name)
        if (channels, width, rate) != (1, 2, SAMPLE_RATE_HZ):
            problems.append(f"{name}: expected mono 16-bit 48 kHz, got {channels}/{width}/{rate}")
        if not minimum <= duration <= maximum:
            problems.append(f"{name}: duration {duration:.3f}s outside {minimum}-{maximum}s")

    transcript = (out_dir / "speech-kathleen-19s.txt").read_text(encoding="utf-8").strip()
    if transcript != TRANSCRIPT:
        problems.append("speech-kathleen-19s.txt: transcript does not match the pinned sentences")
    return problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        type=Path,
        default=find_repo_root(Path(__file__)) / OUTPUT_DIR,
        help="output directory (default: apps/web/public/demo)",
    )
    parser.add_argument("--check", action="store_true", help="validate existing assets; never download")
    arguments = parser.parse_args(argv)

    if arguments.check:
        problems = check_assets(arguments.out)
        if problems:
            for problem in problems:
                print(f"FAIL: {problem}", file=sys.stderr)
            return 1
        print(f"OK: {len(ASSET_NAMES)} assets in {arguments.out}")
        return 0

    for path in build_assets(arguments.out):
        print(f"wrote {path} ({path.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
