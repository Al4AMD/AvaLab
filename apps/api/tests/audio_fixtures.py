"""Session-scoped audio fixtures generated with the ffmpeg CLI.

Files are generated into a pytest-managed temporary directory (never the repo
tree) and reused across tests to keep the suite fast. Generation commands use
argument arrays only; no shell interpolation (AGENTS.md section 7).
"""

import subprocess
from pathlib import Path

import pytest

FFMPEG_GENERATE_TIMEOUT_SECONDS = 120.0


def generate_with_ffmpeg(dst: Path, lavfi_input: str, encode_args: list[str]) -> Path:
    """Run ffmpeg once to synthesize ``lavfi_input`` into ``dst``."""
    subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-hide_banner",
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            lavfi_input,
            *encode_args,
            str(dst),
        ],
        check=True,
        capture_output=True,
        timeout=FFMPEG_GENERATE_TIMEOUT_SECONDS,
    )
    return dst


@pytest.fixture(scope="session")
def audio_fixture_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Session-wide directory holding the generated audio fixtures."""
    return tmp_path_factory.mktemp("audio_fixtures")


@pytest.fixture(scope="session")
def wav_2s_44k1_mono(audio_fixture_dir: Path) -> Path:
    """Valid baseline: 2 s 44.1 kHz mono 16-bit PCM WAV."""
    return generate_with_ffmpeg(
        audio_fixture_dir / "sine_2s_44100_mono.wav",
        "sine=frequency=440:sample_rate=44100:duration=2",
        ["-ac", "1", "-c:a", "pcm_s16le"],
    )


@pytest.fixture(scope="session")
def wav_2s_44k1_mono_with_title_metadata(audio_fixture_dir: Path) -> Path:
    """2 s 44.1 kHz mono WAV carrying a source ``title`` tag (metadata stripping)."""
    return generate_with_ffmpeg(
        audio_fixture_dir / "sine_2s_44100_mono_title.wav",
        "sine=frequency=440:sample_rate=44100:duration=2",
        ["-ac", "1", "-c:a", "pcm_s16le", "-metadata", "title=SECRET"],
    )


@pytest.fixture(scope="session")
def wav_2s_192k_mono(audio_fixture_dir: Path) -> Path:
    """2 s mono at 192 kHz — above the 96000 Hz cap, must be resampled."""
    return generate_with_ffmpeg(
        audio_fixture_dir / "sine_2s_192000_mono.wav",
        "sine=frequency=440:sample_rate=192000:duration=2",
        ["-ac", "1", "-c:a", "pcm_s24le"],
    )


@pytest.fixture(scope="session")
def wav_2s_44k1_quad(audio_fixture_dir: Path) -> Path:
    """2 s 4-channel (quad) WAV — above the 2-channel cap, must be downmixed."""
    return generate_with_ffmpeg(
        audio_fixture_dir / "sine_2s_44100_quad.wav",
        (
            "aevalsrc=0.1*sin(440*2*PI*t)|0.1*sin(441*2*PI*t)"
            "|0.1*sin(442*2*PI*t)|0.1*sin(443*2*PI*t):s=44100:d=2:c=quad"
        ),
        ["-c:a", "pcm_s16le"],
    )


@pytest.fixture(scope="session")
def wav_301s_8k_mono(audio_fixture_dir: Path) -> Path:
    """301 s 8 kHz mono WAV — one second beyond the 300 s duration cap."""
    return generate_with_ffmpeg(
        audio_fixture_dir / "sine_301s_8000_mono.wav",
        "sine=frequency=440:sample_rate=8000:duration=301",
        ["-ac", "1", "-c:a", "pcm_s16le"],
    )


@pytest.fixture(scope="session")
def fake_wav_with_text_content(audio_fixture_dir: Path) -> Path:
    """A text file carrying a .wav extension: ffprobe must reject it."""
    path = audio_fixture_dir / "not_really_audio.wav"
    path.write_bytes(b"This is plain text, not an audio stream.\n")
    return path
