"""Recompress Spy card WebP in place when the new file is smaller."""
from __future__ import annotations

import io
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
WEBP_DIR = ROOT / "packageSpy" / "assets" / "interactionCards" / "webp"
QUALITY = 72
MAX_WIDTH = 800


def compress_one(path: Path) -> tuple[int, int]:
    original = path.read_bytes()
    image = Image.open(io.BytesIO(original))
    image.load()
    if image.width > MAX_WIDTH:
        height = round(image.height * MAX_WIDTH / image.width)
        image = image.resize((MAX_WIDTH, height), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    save_kwargs = {
        "format": "WEBP",
        "quality": QUALITY,
        "method": 6,
    }
    if "A" in image.mode:
        image.save(buffer, **save_kwargs)
    else:
        image.convert("RGB").save(buffer, **save_kwargs)
    compressed = buffer.getvalue()
    if len(compressed) < len(original):
        path.write_bytes(compressed)
        return len(original), len(compressed)
    return len(original), len(original)


def main() -> None:
    files = sorted(WEBP_DIR.glob("*.webp"))
    before_total = 0
    after_total = 0
    changed = 0
    for path in files:
        before, after = compress_one(path)
        before_total += before
        after_total += after
        if after < before:
            changed += 1
            print(f"{path.name}: {before / 1024:.1f}KB -> {after / 1024:.1f}KB")
    print(
        f"done files={len(files)} changed={changed} "
        f"{before_total / 1024 / 1024:.2f}MB -> {after_total / 1024 / 1024:.2f}MB"
    )


if __name__ == "__main__":
    main()
