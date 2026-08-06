#!/usr/bin/env python3
"""Rebuild the extension zip the app offers for download.

The zip in frontend/downloads is a build artifact, not source. It was checked
in once and then never regenerated, so every edit to extension/ silently failed
to reach anyone who downloaded it from the app — the folder said one thing and
the download said another for weeks.

Run this after changing anything in extension/.
"""
import pathlib
import zipfile

ROOT = pathlib.Path(__file__).parent
SRC = ROOT / "extension"
DEST = ROOT / "frontend" / "downloads" / "momentum-tracker-extension.zip"


def main() -> None:
    files = [p for p in sorted(SRC.rglob("*")) if p.is_file() and not p.name.startswith(".")]
    if not files:
        raise SystemExit(f"No files found under {SRC}")
    DEST.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(DEST, "w", zipfile.ZIP_DEFLATED) as z:
        for p in files:
            z.write(p, p.relative_to(SRC).as_posix())
    print(f"Wrote {DEST.relative_to(ROOT)} ({len(files)} files, {DEST.stat().st_size // 1024}KB)")


if __name__ == "__main__":
    main()
