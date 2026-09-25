"""ffmpeg steps: concat uploaded 30s chunks -> full.opus (32kbps mono) + a
16kHz mono wav per STT chunk (split at settings.stt_chunk_sec boundaries).
All ffmpeg calls go through asyncio subprocess (no blocking).
"""

import asyncio
import os


async def _run_ffmpeg(args: list[str]) -> None:
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y", *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed ({proc.returncode}): {stderr.decode(errors='replace')[-2000:]}")


async def concat_to_opus(chunk_paths: list[str], out_path: str) -> str:
    """Concatenate ordered chunk files (webm/opus or mp4/m4a — mixed
    containers are possible across a recording) into one 32kbps mono opus
    file. Uses ffmpeg's concat *filter* (decodes every input) rather than the
    concat *demuxer* stream-copy, because demuxer concat requires all inputs
    to share one codec/container and would break on a webm+mp4 mix.
    """
    if not chunk_paths:
        raise ValueError("no chunk paths to concatenate")

    inputs: list[str] = []
    filter_inputs = []
    for i, p in enumerate(chunk_paths):
        inputs += ["-i", p]
        filter_inputs.append(f"[{i}:a]")
    filter_complex = "".join(filter_inputs) + f"concat=n={len(chunk_paths)}:v=0:a=1[out]"

    await _run_ffmpeg(
        [*inputs, "-filter_complex", filter_complex, "-map", "[out]", "-ac", "1", "-b:a", "32k", "-c:a", "libopus", out_path]
    )
    return out_path


async def to_wav_16k(in_path: str, out_path: str) -> str:
    await _run_ffmpeg(["-i", in_path, "-ac", "1", "-ar", "16000", out_path])
    return out_path


async def split_stt_chunks(full_wav_path: str, out_dir: str, chunk_sec: int) -> list[str]:
    """Split the full wav into fixed-length chunk_sec segments for STT."""
    os.makedirs(out_dir, exist_ok=True)
    pattern = os.path.join(out_dir, "stt_%04d.wav")
    await _run_ffmpeg(
        ["-i", full_wav_path, "-f", "segment", "-segment_time", str(chunk_sec), "-ac", "1", "-ar", "16000", pattern]
    )
    files = sorted(f for f in os.listdir(out_dir) if f.startswith("stt_") and f.endswith(".wav"))
    return [os.path.join(out_dir, f) for f in files]


async def probe_duration_ms(path: str) -> int:
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", path,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {stderr.decode(errors='replace')}")
    return int(float(stdout.decode().strip()) * 1000)
