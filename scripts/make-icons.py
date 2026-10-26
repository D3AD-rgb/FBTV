"""Generates the webOS app icons and splash screen (geometric artwork, no fonts).

Usage: python scripts/make-icons.py
Writes src/app/public/icons/icon-80.png, icon-130.png, icon-400.png and splash.png.
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "src" / "app" / "public" / "icons"
CANVAS = (14, 16, 19)
TOP = (24, 34, 58)
ACCENT = (138, 180, 255)
LIVE = (229, 72, 77)
SS = 4  # supersampling factor for smooth edges


def mark(size: int) -> Image.Image:
    """Rounded tile with a TV screen outline, a play glyph and a live dot."""
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    grad = Image.new("RGBA", (s, s))
    gd = ImageDraw.Draw(grad)
    for y in range(s):
        t = y / (s - 1)
        c = tuple(int(TOP[i] * (1 - t) + CANVAS[i] * t) for i in range(3))
        gd.line([(0, y), (s, y)], fill=c + (255,))
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=255)
    img.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(img)
    w = int(s * 0.055)
    left, top, right, bottom = int(s * 0.18), int(s * 0.24), int(s * 0.82), int(s * 0.68)
    d.rounded_rectangle([left, top, right, bottom], radius=int(s * 0.07), outline=ACCENT + (255,), width=w)
    d.line([(int(s * 0.38), int(s * 0.78)), (int(s * 0.62), int(s * 0.78))], fill=ACCENT + (255,), width=w)
    cx, cy, r = (left + right) / 2, (top + bottom) / 2, s * 0.11
    d.polygon([(cx - r * 0.7, cy - r), (cx - r * 0.7, cy + r), (cx + r * 1.0, cy)], fill=(242, 244, 247, 255))
    dot = s * 0.05
    d.ellipse([right - dot * 2.6, top + dot * 0.9, right - dot * 0.6, top + dot * 2.9], fill=LIVE + (255,))
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (80, 130, 400):
        mark(size).save(OUT / f"icon-{size}.png")
    splash = Image.new("RGB", (1920, 1080), CANVAS)
    m = mark(260)
    splash.paste(m, ((1920 - 260) // 2, (1080 - 260) // 2), m)
    splash.save(OUT / "splash.png")
    print("icons written to", OUT)


if __name__ == "__main__":
    main()
