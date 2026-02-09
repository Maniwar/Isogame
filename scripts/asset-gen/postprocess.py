#!/usr/bin/env python3
"""
Isogame Asset Post-Processor.

Applies post-processing to AI-generated assets:
  - Palette reduction to enforce visual consistency
  - Resize/crop to exact target dimensions
  - Sprite sheet SLICING — cuts generated sheets into individual frames
  - Sprite sheet assembly from individual frames
  - Edge cleanup for tile seamlessness
  - Transparency cleanup

Usage:
    # Process all generated assets
    python postprocess.py

    # Process a specific category
    python postprocess.py --category tiles
    python postprocess.py --category sprites

    # Only slice sprite sheets into frames
    python postprocess.py --category sprites --step slice

    # Assemble sprite sheets from individual frames
    python postprocess.py --step spritesheet
"""

import argparse
import json
import math
from pathlib import Path

import yaml

try:
    from PIL import Image, ImageQuantize
except ImportError:
    from PIL import Image

import numpy as np

SCRIPT_DIR = Path(__file__).parent
CONFIG_PATH = SCRIPT_DIR / "config.yaml"
OUTPUT_DIR = SCRIPT_DIR / "output"
PROCESSED_DIR = SCRIPT_DIR / "processed"


def load_config() -> dict:
    with open(CONFIG_PATH) as f:
        return yaml.safe_load(f)


def hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    """Convert a hex color string to an RGB tuple."""
    h = hex_color.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def build_palette_image(config: dict) -> Image.Image:
    """
    Build a PIL palette image from the config's color definitions.
    Used as the target palette for quantization.
    """
    palette_colors = [hex_to_rgb(color) for color in config["palette"].values()]

    # Expand palette to 256 colors by repeating (PIL requirement)
    while len(palette_colors) < 256:
        palette_colors.append((0, 0, 0))

    # Flatten to a 768-byte list (256 * RGB)
    flat_palette = []
    for r, g, b in palette_colors:
        flat_palette.extend([r, g, b])

    palette_img = Image.new("P", (1, 1))
    palette_img.putpalette(flat_palette)
    return palette_img


def reduce_palette(
    image: Image.Image,
    palette_img: Image.Image,
    num_colors: int = 32,
    preserve_alpha: bool = True,
) -> Image.Image:
    """
    Reduce an image's colors to match the target palette.

    Uses a two-step approach:
    1. Quantize to N colors
    2. Map each resulting color to the nearest palette color

    Preserves alpha channel if present.
    """
    has_alpha = image.mode == "RGBA"

    if has_alpha and preserve_alpha:
        # Separate alpha channel
        alpha = image.split()[3]
        rgb = image.convert("RGB")
    else:
        rgb = image.convert("RGB")
        alpha = None

    # Quantize to target number of colors
    quantized = rgb.quantize(colors=num_colors, method=Image.Quantize.MEDIANCUT)
    result = quantized.convert("RGB")

    # Map to closest palette colors
    result_array = np.array(result, dtype=np.float32)
    palette_colors = [hex_to_rgb(c) for c in list(load_config()["palette"].values())]
    palette_array = np.array(palette_colors, dtype=np.float32)

    # Reshape for broadcasting: (H, W, 1, 3) vs (1, 1, N, 3)
    h, w, _ = result_array.shape
    pixels = result_array.reshape(h, w, 1, 3)
    palette_expanded = palette_array.reshape(1, 1, -1, 3)

    # Find nearest palette color for each pixel (Euclidean distance)
    distances = np.sqrt(np.sum((pixels - palette_expanded) ** 2, axis=3))
    nearest_indices = np.argmin(distances, axis=2)

    # Map pixels to palette colors
    mapped = palette_array[nearest_indices].astype(np.uint8)
    result = Image.fromarray(mapped, "RGB")

    # Restore alpha
    if alpha is not None:
        result = result.convert("RGBA")
        result.putalpha(alpha)

    return result


def resize_to_target(image: Image.Image, width: int, height: int) -> Image.Image:
    """Resize image to exact target dimensions, maintaining aspect ratio with padding."""
    if image.size == (width, height):
        return image

    # Calculate scale to fit within target while maintaining aspect ratio
    img_w, img_h = image.size
    scale = min(width / img_w, height / img_h)
    new_w = int(img_w * scale)
    new_h = int(img_h * scale)

    resized = image.resize((new_w, new_h), Image.Resampling.NEAREST)

    # Create target-size canvas and center the image
    if image.mode == "RGBA":
        canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    else:
        canvas = Image.new("RGB", (width, height), (0, 0, 0))

    offset_x = (width - new_w) // 2
    offset_y = (height - new_h) // 2
    canvas.paste(resized, (offset_x, offset_y))

    return canvas


def cleanup_transparency(image: Image.Image, threshold: int = 10) -> Image.Image:
    """Clean up semi-transparent pixels — make them fully opaque or fully transparent."""
    if image.mode != "RGBA":
        return image

    arr = np.array(image)
    alpha = arr[:, :, 3]

    # Threshold: pixels with alpha < threshold become fully transparent
    # Pixels with alpha >= threshold become fully opaque
    alpha = np.where(alpha < threshold, 0, 255).astype(np.uint8)
    arr[:, :, 3] = alpha

    return Image.fromarray(arr, "RGBA")


def assemble_spritesheet(
    frames: list[Image.Image],
    columns: int | None = None,
) -> Image.Image:
    """
    Assemble individual sprite frames into a sprite sheet.

    Args:
        frames: List of PIL Images (all same size).
        columns: Number of columns. Defaults to ceil(sqrt(count)).

    Returns:
        A single sprite sheet image.
    """
    if not frames:
        raise ValueError("No frames to assemble")

    frame_w, frame_h = frames[0].size
    count = len(frames)

    if columns is None:
        columns = math.ceil(math.sqrt(count))
    rows = math.ceil(count / columns)

    mode = frames[0].mode
    if mode == "RGBA":
        sheet = Image.new("RGBA", (columns * frame_w, rows * frame_h), (0, 0, 0, 0))
    else:
        sheet = Image.new("RGB", (columns * frame_w, rows * frame_h), (0, 0, 0))

    for idx, frame in enumerate(frames):
        col = idx % columns
        row = idx // columns
        sheet.paste(frame, (col * frame_w, row * frame_h))

    return sheet


# ---------------------------------------------------------------------------
# Sprite Sheet Slicer — cuts AI-generated sheets into individual frames
# ---------------------------------------------------------------------------

def slice_spritesheet(
    sheet: Image.Image,
    cell_w: int,
    cell_h: int,
    rows: int,
    cols: int,
) -> list[list[Image.Image]]:
    """
    Slice a sprite sheet into a 2D grid of individual frames.

    Args:
        sheet: The full sprite sheet image.
        cell_w: Width of each cell in pixels.
        cell_h: Height of each cell in pixels.
        rows: Number of rows (animations).
        cols: Number of columns (directions).

    Returns:
        2D list: result[row][col] = individual frame Image.
    """
    sheet_w, sheet_h = sheet.size

    # If the sheet isn't exactly the expected size, resize it
    expected_w = cell_w * cols
    expected_h = cell_h * rows
    if sheet_w != expected_w or sheet_h != expected_h:
        sheet = sheet.resize((expected_w, expected_h), Image.Resampling.NEAREST)

    frames = []
    for r in range(rows):
        row_frames = []
        for c in range(cols):
            x = c * cell_w
            y = r * cell_h
            frame = sheet.crop((x, y, x + cell_w, y + cell_h))
            row_frames.append(frame)
        frames.append(row_frames)

    return frames


def slice_and_save_character_sheet(
    sheet_path: Path,
    sprite_key: str,
    config: dict,
    dst_dir: Path,
    apply_palette: bool = True,
) -> dict:
    """
    Slice a character sprite sheet and save individual frames.

    Expected layout: 4 rows (idle, walk_1, walk_2, attack) x 8 cols (S,SW,W,NW,N,NE,E,SE).

    Returns a frame metadata dict for the manifest.
    """
    from prompts.characters import DIRECTIONS, ANIMATIONS

    cell_w = config["sprites"]["base_width"]
    cell_h = config["sprites"]["base_height"]
    num_cols = len(DIRECTIONS)
    num_rows = len(ANIMATIONS)

    sheet = Image.open(sheet_path).convert("RGBA")
    frames = slice_spritesheet(sheet, cell_w, cell_h, num_rows, num_cols)

    frame_meta = {}

    for row_idx, anim_name in enumerate(ANIMATIONS):
        frame_meta[anim_name] = {}
        for col_idx, direction in enumerate(DIRECTIONS):
            frame = frames[row_idx][col_idx]

            # Post-process each frame
            frame = cleanup_transparency(frame)
            if apply_palette:
                palette_img = build_palette_image(config)
                frame = reduce_palette(frame, palette_img)

            # Save individual frame
            filename = f"{sprite_key}-{anim_name}-{direction.lower()}.png"
            frame.save(dst_dir / filename, "PNG")
            frame_meta[anim_name][direction] = filename

    print(f"    Sliced {num_rows * num_cols} frames from {sheet_path.name}")
    return frame_meta


# ---------------------------------------------------------------------------
# Processing pipelines
# ---------------------------------------------------------------------------

def process_tiles(config: dict, apply_palette: bool = True) -> int:
    """Process all tile images: resize, palette reduce, clean transparency."""
    tile_w = config["tiles"]["base_width"]
    tile_h = config["tiles"]["base_height"]
    wall_h = config["tiles"]["wall_height"]
    processed = 0

    for subdir in ("ground", "walls", "terrain"):
        src_dir = OUTPUT_DIR / "tiles" / subdir
        dst_dir = PROCESSED_DIR / "tiles" / subdir

        if not src_dir.exists():
            continue

        dst_dir.mkdir(parents=True, exist_ok=True)
        target_h = wall_h if subdir == "walls" else tile_h

        for img_path in sorted(src_dir.glob("*.png")):
            print(f"  Processing: {img_path.name}")
            img = Image.open(img_path).convert("RGBA")

            # Resize to target dimensions
            img = resize_to_target(img, tile_w, target_h)

            # Clean transparency
            img = cleanup_transparency(img)

            # Palette reduction
            if apply_palette:
                palette_img = build_palette_image(config)
                img = reduce_palette(img, palette_img)

            img.save(dst_dir / img_path.name, "PNG")
            processed += 1

    return processed


def process_sprites(config: dict, apply_palette: bool = True) -> int:
    """Process character sprites — slice sheets or process individual frames."""
    sprite_w = config["sprites"]["base_width"]
    sprite_h = config["sprites"]["base_height"]
    processed = 0

    sprites_dir = OUTPUT_DIR / "sprites"
    if not sprites_dir.exists():
        return 0

    # Metadata for all sliced sprite sheets
    all_frame_meta = {}

    for char_dir in sorted(sprites_dir.iterdir()):
        if not char_dir.is_dir():
            continue

        sprite_key = char_dir.name
        print(f"  Processing character: {sprite_key}")
        dst_dir = PROCESSED_DIR / "sprites" / sprite_key
        dst_dir.mkdir(parents=True, exist_ok=True)

        # Check for a sprite sheet first (generated by the sheet prompt)
        sheet_files = list(char_dir.glob("*-sheet.png")) + list(char_dir.glob("*-spritesheet.png"))
        if sheet_files:
            for sheet_path in sheet_files:
                frame_meta = slice_and_save_character_sheet(
                    sheet_path, sprite_key, config, dst_dir, apply_palette
                )
                all_frame_meta[sprite_key] = frame_meta
                processed += sum(len(dirs) for dirs in frame_meta.values())
        else:
            # Fallback: process individual direction images
            frames = []
            for img_path in sorted(char_dir.glob("*.png")):
                img = Image.open(img_path).convert("RGBA")
                img = resize_to_target(img, sprite_w, sprite_h)
                img = cleanup_transparency(img)

                if apply_palette:
                    palette_img = build_palette_image(config)
                    img = reduce_palette(img, palette_img)

                img.save(dst_dir / img_path.name, "PNG")
                frames.append(img)
                processed += 1

            # Assemble sprite sheet (8 directions in a row)
            if frames:
                sheet = assemble_spritesheet(frames, columns=len(frames))
                sheet_path = dst_dir / f"{sprite_key}-spritesheet.png"
                sheet.save(sheet_path, "PNG")
                print(f"    Sprite sheet: {sheet_path.name}")

    # Save frame metadata for deploy step
    if all_frame_meta:
        meta_path = PROCESSED_DIR / "sprites" / "_frame_meta.json"
        with open(meta_path, "w") as f:
            json.dump(all_frame_meta, f, indent=2)
        print(f"\n  Frame metadata: {meta_path}")

    return processed


def process_items(config: dict, apply_palette: bool = True) -> int:
    """Process item icons."""
    icon_size = config["items"]["icon_size"]
    processed = 0

    items_dir = OUTPUT_DIR / "items"
    if not items_dir.exists():
        return 0

    for cat_dir in sorted(items_dir.iterdir()):
        if not cat_dir.is_dir():
            continue

        dst_dir = PROCESSED_DIR / "items" / cat_dir.name
        dst_dir.mkdir(parents=True, exist_ok=True)

        for img_path in sorted(cat_dir.glob("*.png")):
            print(f"  Processing: {img_path.name}")
            img = Image.open(img_path).convert("RGBA")
            img = resize_to_target(img, icon_size, icon_size)
            img = cleanup_transparency(img)

            if apply_palette:
                palette_img = build_palette_image(config)
                img = reduce_palette(img, palette_img)

            img.save(dst_dir / img_path.name, "PNG")
            processed += 1

    return processed


def process_portraits(config: dict, apply_palette: bool = True) -> int:
    """Process NPC portraits."""
    pw = config["portraits"]["width"]
    ph = config["portraits"]["height"]
    processed = 0

    portraits_dir = OUTPUT_DIR / "portraits"
    if not portraits_dir.exists():
        return 0

    dst_dir = PROCESSED_DIR / "portraits"
    dst_dir.mkdir(parents=True, exist_ok=True)

    for img_path in sorted(portraits_dir.glob("*.png")):
        print(f"  Processing: {img_path.name}")
        img = Image.open(img_path).convert("RGBA")
        img = resize_to_target(img, pw, ph)

        if apply_palette:
            palette_img = build_palette_image(config)
            img = reduce_palette(img, palette_img, num_colors=48)

        img.save(dst_dir / img_path.name, "PNG")
        processed += 1

    return processed


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

STEP_MAP = {
    "tiles": process_tiles,
    "sprites": process_sprites,
    "items": process_items,
    "portraits": process_portraits,
}


def main():
    parser = argparse.ArgumentParser(
        description="Post-process AI-generated game assets."
    )
    parser.add_argument(
        "--category",
        choices=list(STEP_MAP.keys()) + ["all"],
        default="all",
        help="Asset category to process (default: all)",
    )
    parser.add_argument(
        "--no-palette",
        action="store_true",
        help="Skip palette reduction step",
    )
    args = parser.parse_args()

    config = load_config()
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    categories = list(STEP_MAP.keys()) if args.category == "all" else [args.category]
    apply_palette = not args.no_palette

    print("=== Isogame Asset Post-Processor ===")
    print(f"Categories: {', '.join(categories)}")
    print(f"Palette reduction: {'enabled' if apply_palette else 'disabled'}")
    print(f"Output: {PROCESSED_DIR}\n")

    total = 0
    for cat in categories:
        print(f"\n--- Processing {cat} ---")
        count = STEP_MAP[cat](config, apply_palette)
        total += count

    print(f"\n=== Done! Processed {total} assets ===")


if __name__ == "__main__":
    main()
