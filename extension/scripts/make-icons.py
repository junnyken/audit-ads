"""Draw the extension's toolbar and store icons into `icons/`.

    python3 scripts/make-icons.py

Deterministic: shapes only, no font, so the same PNGs come out on every machine. The mark is a
rounded square with three bars (an account list being watched); it makes no claim about safety
or approval (rule 6). Drawn at 8x and downsampled so the small sizes stay crisp.
"""
from pathlib import Path

from PIL import Image, ImageDraw

SIZES = (16, 32, 48, 128)
BACKGROUND = (30, 58, 138, 255)  # deep blue
BAR = (255, 255, 255, 255)
SCALE = 8

out = Path(__file__).resolve().parent.parent / "icons"
out.mkdir(exist_ok=True)

for size in SIZES:
    big = size * SCALE
    image = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((0, 0, big - 1, big - 1), radius=big // 5, fill=BACKGROUND)
    # Three bars of rising height, bottom-aligned, inside a 20% margin.
    margin = big * 0.2
    inner = big - 2 * margin
    bar_width = inner / 5
    gap = (inner - 3 * bar_width) / 2
    for index, height in enumerate((0.45, 0.7, 1.0)):
        left = margin + index * (bar_width + gap)
        top = margin + inner * (1 - height)
        draw.rounded_rectangle(
            (left, top, left + bar_width, big - margin), radius=bar_width / 4, fill=BAR
        )
    image.resize((size, size), Image.LANCZOS).save(out / f"icon-{size}.png")
    print(f"icons/icon-{size}.png")
