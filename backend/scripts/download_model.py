#!/usr/bin/env python3
"""
Downloads a local Llama-family GGUF model for Momentum Tracker.

The model file itself is deliberately NOT committed to the repo: the
smallest useful one is ~2GB and the recommended one ~4.7GB, which doesn't
belong in version control. This script fetches it on demand instead.

    cd backend
    python scripts/download_model.py              # recommended 8B model
    python scripts/download_model.py --model small # 3B, for low-RAM machines
    python scripts/download_model.py --list

Downloads resume if interrupted, so a dropped connection on a 4.7GB file
doesn't mean starting over. Once the file is in backend/models/, the app
picks it up automatically on next start — no configuration needed.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
import urllib.request
import urllib.error

MODELS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")

# Instruction-tuned, Q4_K_M quantised (the usual quality/size sweet spot).
# Sizes are approximate and RAM figures assume the model plus a 4K context.
MODELS = {
    "small": {
        "name": "Llama 3.2 3B Instruct (Q4_K_M)",
        "file": "Llama-3.2-3B-Instruct-Q4_K_M.gguf",
        "url": "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
        "size_gb": 2.0,
        "ram_gb": 4,
        "note": "Fastest. Fine for extraction and short drafts; prose is noticeably stiffer.",
    },
    "recommended": {
        "name": "Llama 3.1 8B Instruct (Q4_K_M)",
        "file": "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
        "url": "https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
        "size_gb": 4.9,
        "ram_gb": 8,
        "note": "Best balance for cover letters and tailoring. Start here.",
    },
    "quality": {
        "name": "Llama 3.1 8B Instruct (Q5_K_M)",
        "file": "Meta-Llama-3.1-8B-Instruct-Q5_K_M.gguf",
        "url": "https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q5_K_M.gguf",
        "size_gb": 5.7,
        "ram_gb": 10,
        "note": "Slightly better writing than Q4 at ~15% more RAM and slower generation.",
    },
}


def human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if abs(n) < 1024:
            return f"{n:.1f}{unit}"
        n /= 1024
    return f"{n:.1f}TB"


def list_models() -> None:
    print("\nAvailable models:\n")
    for key, m in MODELS.items():
        mark = "  <- default" if key == "recommended" else ""
        print(f"  {key:<12} {m['name']}{mark}")
        print(f"  {'':<12} ~{m['size_gb']}GB download, needs ~{m['ram_gb']}GB free RAM")
        print(f"  {'':<12} {m['note']}\n")


def free_disk_gb(path: str) -> float:
    try:
        return shutil.disk_usage(path).free / (1024 ** 3)
    except OSError:
        return float("inf")


def download(url: str, dest: str) -> bool:
    """Streams to a .part file with resume support, then atomically renames."""
    part = dest + ".part"
    existing = os.path.getsize(part) if os.path.exists(part) else 0
    req = urllib.request.Request(url, headers={"User-Agent": "momentum-tracker/1.0"})
    if existing:
        req.add_header("Range", f"bytes={existing}-")
        print(f"  Resuming from {human(existing)}…")

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            # 200 on a resume request means the server ignored Range — restart
            if existing and resp.status == 200:
                existing = 0
                mode = "wb"
            else:
                mode = "ab" if existing else "wb"
            total = int(resp.headers.get("Content-Length", 0)) + existing
            done = existing
            with open(part, mode) as f:
                while True:
                    chunk = resp.read(1024 * 256)
                    if not chunk:
                        break
                    f.write(chunk)
                    done += len(chunk)
                    if total:
                        pct = done / total * 100
                        bar = "#" * int(pct / 2.5)
                        sys.stdout.write(f"\r  [{bar:<40}] {pct:5.1f}%  {human(done)} / {human(total)}")
                        sys.stdout.flush()
        print()
    except urllib.error.HTTPError as e:
        print(f"\n  Download failed: HTTP {e.code} {e.reason}")
        return False
    except (urllib.error.URLError, TimeoutError) as e:
        print(f"\n  Download failed: {e}")
        print("  Partial file kept — re-run this script to resume.")
        return False
    except KeyboardInterrupt:
        print("\n  Interrupted. Partial file kept — re-run to resume.")
        return False

    # A truncated GGUF loads as garbage or crashes llama.cpp with a confusing
    # error, so sanity-check the magic bytes before accepting the file.
    with open(part, "rb") as f:
        if f.read(4) != b"GGUF":
            print("  Downloaded file is not a valid GGUF (wrong magic bytes). Deleting.")
            os.remove(part)
            return False

    os.replace(part, dest)
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description="Download a local GGUF model for Momentum Tracker.")
    ap.add_argument("--model", default="recommended", choices=list(MODELS), help="which model to fetch")
    ap.add_argument("--list", action="store_true", help="list available models and exit")
    ap.add_argument("--force", action="store_true", help="re-download even if the file exists")
    args = ap.parse_args()

    if args.list:
        list_models()
        return 0

    spec = MODELS[args.model]
    os.makedirs(MODELS_DIR, exist_ok=True)
    dest = os.path.join(MODELS_DIR, spec["file"])

    print(f"\n  Model:  {spec['name']}")
    print(f"  Size:   ~{spec['size_gb']}GB   (needs ~{spec['ram_gb']}GB free RAM to run)")
    print(f"  Target: {dest}\n")

    if os.path.exists(dest) and not args.force:
        print(f"  Already present ({human(os.path.getsize(dest))}). Use --force to re-download.")
        return 0

    free = free_disk_gb(MODELS_DIR)
    if free < spec["size_gb"] * 1.1:
        print(f"  Not enough disk space: {free:.1f}GB free, need ~{spec['size_gb'] * 1.1:.1f}GB.")
        return 1

    if not download(spec["url"], dest):
        return 1

    print(f"\n  Done — saved to {dest}")
    print("  Restart the backend; it will detect the model and switch from")
    print("  'Smart template' to 'AI-generated' automatically.\n")
    print("  If generation is slow, try:  --model small")
    print("  With an NVIDIA GPU, reinstall llama-cpp-python with CUDA support and set")
    print("  MOMENTUM_LLM_GPU_LAYERS=35 to offload most layers to the GPU.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
