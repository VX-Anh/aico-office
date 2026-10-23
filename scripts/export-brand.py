#!/usr/bin/env python3
"""Xuất icon từ logo AX 512; chỉ cần Pillow==11.3.0.

python -m venv .venv
.venv/bin/python -m pip install Pillow==11.3.0
.venv/bin/python scripts/export-brand.py          # chỉ ba icon
.venv/bin/python scripts/export-brand.py --logos  # chỉ logo trong suốt

Không đưa Pillow vào dependencies của ứng dụng. Chạy từ thư mục bất kỳ.
"""

import argparse
from collections import deque
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter, ImageDraw, __version__


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "art/brand/logo-ax-source-black.png"
OUTPUT = ROOT / "public/brand"
SIZES = (512, 192, 64, 32, 16)
BACKGROUND = (14, 16, 22)
ICONS = ((16, 13, 2), (32, 26, 4), (180, 144, 0))


def extract(source):
    """Giữ vùng đục, ước lượng coverage riêng ở mép đã trộn nền đen."""
    width, height = source.size
    pixels = list(source.getdata())
    strength = ImageChops.lighter(
        ImageChops.lighter(*source.split()[:2]), source.split()[2]
    )
    mask = strength.point(lambda value: 255 if value >= 40 else 0)

    # Chỉ giữ các mảng lớn của logo, bỏ chấm rời và nền gần đen.
    candidates = bytearray(mask.tobytes())
    clean = bytearray(width * height)
    for start in range(len(candidates)):
        if not candidates[start]:
            continue
        candidates[start] = 0
        component = [start]
        queue = deque([start])
        while queue:
            index = queue.popleft()
            x, y = index % width, index // width
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= nx < width and 0 <= ny < height:
                    neighbor = ny * width + nx
                    if candidates[neighbor]:
                        candidates[neighbor] = 0
                        component.append(neighbor)
                        queue.append(neighbor)
        if len(component) >= 100:
            for index in component:
                clean[index] = 255
    mask = Image.frombytes("L", source.size, bytes(clean))
    core = mask.filter(ImageFilter.MinFilter(5))
    region = mask.filter(ImageFilter.MaxFilter(5))
    core_bytes, region_bytes = core.tobytes(), region.tobytes()

    # Lan màu từ ruột đục tới mép: không lấy độ sáng làm alpha cho cả logo.
    nearest = [-1] * len(pixels)
    queue = deque()
    for index, value in enumerate(core_bytes):
        if value:
            nearest[index] = index
            queue.append(index)
    while queue:
        index = queue.popleft()
        x, y = index % width, index // width
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height:
                neighbor = ny * width + nx
                if region_bytes[neighbor] and nearest[neighbor] < 0:
                    nearest[neighbor] = nearest[index]
                    queue.append(neighbor)
    result = []
    for index, color in enumerate(pixels):
        if core_bytes[index]:
            result.append((*color, 255))
        elif nearest[index] >= 0:
            reference = pixels[nearest[index]]
            coverage = min(1, sum(a * b for a, b in zip(color, reference)) /
                           max(1, sum(value * value for value in reference)))
            alpha = round(255 * coverage)
            # Nền có nhiễu lượng tử rất nhỏ; không để thành chấm alpha rời.
            if alpha < 8:
                result.append((0, 0, 0, 0))
            else:
                unblack = tuple(min(255, round(value / coverage)) for value in color)
                result.append((*unblack, alpha))
        else:
            result.append((0, 0, 0, 0))
    image = Image.new("RGBA", source.size)
    image.putdata(result)
    bounds = image.getbbox()
    if bounds is None:
        raise ValueError("Không tìm được logo trong ảnh nguồn")
    cropped = image.crop(bounds)
    # Lề 2% hai phía theo cạnh dài, giữ nguyên tỉ lệ và không cắt nét.
    side = max(cropped.size)
    padding = round(side * 0.02)
    square = Image.new("RGBA", (side + 2 * padding,) * 2)
    square.paste(cropped, ((square.width - cropped.width) // 2,
                          (square.height - cropped.height) // 2))
    print(f"Nguồn {source.size}, crop {bounds}, khung {square.size}")
    return square


def export_logos():
    with Image.open(SOURCE) as source:
        if source.mode != "RGB":
            raise ValueError("Nguồn chính phải là RGB nền đen")
        master = extract(source)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    print(f"Pillow {__version__}")
    for size in SIZES:
        # RGBa là alpha nhân trước: LANCZOS không kéo màu đen vào mép.
        content = master.convert("RGBa").resize(
            (size - 2, size - 2), Image.Resampling.LANCZOS
        ).convert("RGBA")
        image = Image.new("RGBA", (size, size))
        image.paste(content, (1, 1))
        # Bỏ ringing gần 0/255 của bộ lọc, chỉ giữ coverage hữu ích ở mép.
        image.putalpha(image.getchannel("A").point(
            lambda value: 0 if value < 8 else 255 if value > 247 else value
        ))
        name = f"logo-ax-{size}.png"
        image.save(OUTPUT / name, optimize=True)
        alpha = image.getchannel("A")
        bounds = alpha.getbbox()
        assert bounds is not None and image.size == (size, size)
        assert alpha.getextrema() == (0, 255)
        assert not any(alpha.crop((0, 0, size, 1)).getdata())
        assert not any(alpha.crop((0, size - 1, size, size)).getdata())
        assert not any(alpha.crop((0, 0, 1, size)).getdata())
        assert not any(alpha.crop((size - 1, 0, size, size)).getdata())
        left, top, right, bottom = bounds
        assert abs(left - (size - right)) <= 1
        assert abs(top - (size - bottom)) <= 1
        histogram = alpha.histogram()
        print(f"{name}: {size}×{size}, bbox={bounds}, "
              f"alpha 0/255/mép={histogram[0]}/{histogram[255]}/"
              f"{sum(histogram[1:255])}")


def icon_mask(size, radius):
    """Lấy mẫu lớn để mép bo mượt, không tạo ringing ngoài góc."""
    scale = 8
    mask = Image.new("L", (size * scale,) * 2, 255 if radius == 0 else 0)
    if radius:
        ImageDraw.Draw(mask).rounded_rectangle(
            (0, 0, size * scale - 1, size * scale - 1),
            radius=radius * scale, fill=255
        )
    mask = mask.resize((size, size), Image.Resampling.BOX)
    if radius:
        for point in ((0, 0), (size - 1, 0), (0, size - 1), (size - 1, size - 1)):
            mask.putpixel(point, 0)
    return mask


def validate_icon(image, size, radius):
    assert image.mode == "RGBA" and image.size == (size, size)
    alpha = image.getchannel("A")
    assert alpha.tobytes() == icon_mask(size, radius).tobytes()
    if radius:
        assert alpha.getextrema() == (0, 255)
        assert all(alpha.getpixel(point) == 0 for point in
                   ((0, 0), (size - 1, 0), (0, size - 1), (size - 1, size - 1)))
    else:
        assert alpha.getextrema() == (255, 255)
    assert image.getpixel((size // 2, 0)) == (*BACKGROUND, 255)
    # Màu RGB dưới alpha của góc cũng giữ đúng nền, tránh viền khi ghép.
    assert image.getpixel((0, 0))[:3] == BACKGROUND
    print(f"{size}×{size}: nền={BACKGROUND}, alpha={alpha.getextrema()}, bo={radius}")


def export_icons():
    # Không tái xuất logo: giữ nguyên byte các tài sản trong suốt đã duyệt.
    with Image.open(OUTPUT / "logo-ax-512.png") as source:
        master = source.convert("RGBA")
    bounds = master.getchannel("A").getbbox()
    if bounds is None:
        raise ValueError("Logo nguồn không có nội dung")
    master = master.crop(bounds)
    for size, extent, radius in ICONS:
        ratio = extent / max(master.size)
        dimensions = tuple(max(1, round(side * ratio)) for side in master.size)
        content = master.convert("RGBa").resize(
            dimensions, Image.Resampling.LANCZOS
        ).convert("RGBA")
        offset = tuple((size - side) // 2 for side in dimensions)
        assert max(dimensions) == extent
        assert all(abs(start - (size - start - side)) <= 1
                   for start, side in zip(offset, dimensions))
        image = Image.new("RGBA", (size, size), (*BACKGROUND, 255))
        image.alpha_composite(content, offset)
        image.putalpha(icon_mask(size, radius))
        validate_icon(image, size, radius)
        name = "apple-touch-icon.png" if size == 180 else f"favicon-{size}.png"
        image.save(OUTPUT / name, optimize=True)
        print(f"{name}: logo={dimensions}, vị trí={offset}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--logos", action="store_true",
                        help="chỉ tái xuất logo trong suốt từ nguồn nền đen")
    args = parser.parse_args()
    print(f"Pillow {__version__}")
    if args.logos:
        export_logos()
    else:
        export_icons()
