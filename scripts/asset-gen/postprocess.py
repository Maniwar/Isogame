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
    """Resize image to exact target dimensions, maintaining aspect ratio with padding.
    Use for sprites and items where centering within a fixed canvas is correct."""
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


def resize_to_fill(image: Image.Image, width: int, height: int) -> Image.Image:
    """Resize image to FILL target dimensions (cover mode), cropping excess.
    Use for tiles where every pixel in the target area must have content.
    This prevents the letterboxing bug where square AI images get padded
    into the target canvas, leaving empty regions around the content."""
    if image.size == (width, height):
        return image

    img_w, img_h = image.size
    # Scale to cover: the LARGER scale factor ensures full coverage
    scale = max(width / img_w, height / img_h)
    new_w = int(img_w * scale)
    new_h = int(img_h * scale)

    resized = image.resize((new_w, new_h), Image.Resampling.LANCZOS)

    # Crop from center to exact target size
    cx = (new_w - width) // 2
    cy = (new_h - height) // 2
    return resized.crop((cx, cy, cx + width, cy + height))


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

def find_content_bbox(image: Image.Image, threshold: int = 10) -> tuple[int, int, int, int] | None:
    """Find the bounding box of non-transparent content in an RGBA image.
    Returns (left, top, right, bottom) or None if empty."""
    if image.mode != "RGBA":
        return image.getbbox()
    arr = np.array(image)
    alpha = arr[:, :, 3]
    mask = alpha > threshold
    if not mask.any():
        return None
    rows_any = np.any(mask, axis=1)
    cols_any = np.any(mask, axis=0)
    top = int(np.argmax(rows_any))
    bottom = int(len(rows_any) - np.argmax(rows_any[::-1]))
    left = int(np.argmax(cols_any))
    right = int(len(cols_any) - np.argmax(cols_any[::-1]))
    return (left, top, right, bottom)


def extract_and_center(region: Image.Image, target_w: int, target_h: int) -> Image.Image:
    """Extract content from a region and place it bottom-center in a target-size canvas.
    Bottom-center anchoring keeps character feet at a consistent position
    for correct placement on isometric tiles."""
    bbox = find_content_bbox(region)
    if bbox is None:
        return Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))

    # Crop to content
    content = region.crop(bbox)
    cw, ch = content.size

    # Scale down if content is larger than target
    if cw > target_w or ch > target_h:
        scale = min(target_w / cw, target_h / ch)
        new_w = max(1, int(cw * scale))
        new_h = max(1, int(ch * scale))
        content = content.resize((new_w, new_h), Image.Resampling.LANCZOS)
        cw, ch = content.size

    # Place bottom-center on transparent canvas (feet on ground)
    canvas = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
    offset_x = (target_w - cw) // 2
    offset_y = target_h - ch
    canvas.paste(content, (offset_x, offset_y), content)
    return canvas


def detect_grid(sheet: Image.Image, expected_rows: int, expected_cols: int) -> list[list[tuple[int, int, int, int]]]:
    """Detect the grid cell boundaries in a sprite sheet.

    Uses alpha channel analysis to find natural dividers, then falls back
    to uniform grid division if no clear gutters are found.

    Returns a 2D list of (x, y, w, h) cell regions.
    """
    sheet_w, sheet_h = sheet.size
    arr = np.array(sheet.convert("RGBA"))
    alpha = arr[:, :, 3]

    # Try to find horizontal gutters (rows of mostly-transparent pixels)
    row_density = np.mean(alpha > 10, axis=1)  # fraction of opaque pixels per row
    col_density = np.mean(alpha > 10, axis=0)  # fraction of opaque pixels per col

    def find_splits(density: np.ndarray, expected_parts: int, total_size: int) -> list[int]:
        """Find split points in a density profile."""
        # Look for valleys (low-density regions) that divide the image
        chunk_size = total_size // expected_parts
        splits = [0]

        for i in range(1, expected_parts):
            # Search around the expected split point for a low-density region
            expected_pos = int(i * chunk_size)
            search_start = max(0, expected_pos - chunk_size // 4)
            search_end = min(total_size, expected_pos + chunk_size // 4)

            if search_start < search_end:
                window = density[search_start:search_end]
                # Find the position with lowest density in the search window
                best_offset = int(np.argmin(window))
                best_pos = search_start + best_offset

                # Only use the detected split if it's in a low-density area
                if density[best_pos] < 0.3:
                    splits.append(best_pos)
                else:
                    splits.append(expected_pos)
            else:
                splits.append(expected_pos)

        splits.append(total_size)
        return splits

    row_splits = find_splits(row_density, expected_rows, sheet_h)
    col_splits = find_splits(col_density, expected_cols, sheet_w)

    cells = []
    for r in range(expected_rows):
        row_cells = []
        for c in range(expected_cols):
            x = col_splits[c]
            y = row_splits[r]
            w = col_splits[c + 1] - x
            h = row_splits[r + 1] - y
            row_cells.append((x, y, w, h))
        cells.append(row_cells)

    return cells


def slice_spritesheet(
    sheet: Image.Image,
    cell_w: int,
    cell_h: int,
    rows: int,
    cols: int,
) -> list[list[Image.Image]]:
    """
    Content-aware sprite sheet slicer.

    Instead of blindly cutting a grid, this:
    1. Detects natural grid boundaries using alpha channel analysis
    2. Extracts each cell region
    3. Finds the actual character content within each cell
    4. Centers the content in the target cell size

    Returns:
        2D list: result[row][col] = individual frame Image (target size).
    """
    sheet = sheet.convert("RGBA")

    # Detect the grid structure
    grid = detect_grid(sheet, rows, cols)

    frames = []
    for r in range(rows):
        row_frames = []
        for c in range(cols):
            x, y, w, h = grid[r][c]
            # Extract the raw region from the sheet
            region = sheet.crop((x, y, x + w, y + h))
            # Find content and center it in target cell
            frame = extract_and_center(region, cell_w, cell_h)
            row_frames.append(frame)
        frames.append(row_frames)

    return frames


def force_transparent_bg(image: Image.Image) -> Image.Image:
    """Remove green chroma-key background pixels.

    Gemini generates a wide range of green shades — not just pure #00FF00.
    Measured mean on raw sheets: R≈121, G≈185, B≈71.  These thresholds
    are tuned to catch that range while preserving brown/tan character
    details.  This runs BEFORE palette reduction so the raw Gemini colors
    are still present.
    """
    arr = np.array(image.convert("RGBA"))
    r = arr[:, :, 0].astype(np.int16)
    g = arr[:, :, 1].astype(np.int16)
    b = arr[:, :, 2].astype(np.int16)
    # Green-dominant: G must be bright and clearly above both R and B.
    # Using int16 to avoid overflow when multiplying.
    is_green = (g > 100) & (g > r + 20) & (g > b + 30)
    arr[is_green, 3] = 0
    return Image.fromarray(arr, "RGBA")


def slice_and_save_character_sheet(
    sheet_path: Path,
    sprite_key: str,
    config: dict,
    dst_dir: Path,
    apply_palette: bool = True,
) -> dict:
    """
    Content-aware sprite sheet slicer.

    1. Opens the sheet and forces transparent background
    2. Uses smart grid detection to find cell boundaries
    3. Extracts and centers each character in the target cell size
    4. Saves individual frames AND keeps the original sheet

    Returns a frame metadata dict for the manifest.
    """
    from prompts.characters import DIRECTIONS, ANIMATIONS

    cell_w = config["sprites"]["base_width"]
    cell_h = config["sprites"]["base_height"]
    num_cols = len(DIRECTIONS)
    num_rows = len(ANIMATIONS)

    sheet = Image.open(sheet_path).convert("RGBA")

    # Force white backgrounds to transparent (Gemini often ignores alpha requests)
    sheet = force_transparent_bg(sheet)

    print(f"    Sheet size: {sheet.size[0]}x{sheet.size[1]}, target grid: {num_cols}x{num_rows} cells of {cell_w}x{cell_h}")

    # Keep the original sheet (cleaned up)
    sheet_copy_name = f"{sprite_key}-sheet.png"
    sheet.save(dst_dir / sheet_copy_name, "PNG")
    print(f"    Kept original sheet: {sheet_copy_name}")

    # Smart slice
    frames = slice_spritesheet(sheet, cell_w, cell_h, num_rows, num_cols)

    frame_meta = {}
    empty_cells = 0

    for row_idx, anim_name in enumerate(ANIMATIONS):
        frame_meta[anim_name] = {}
        for col_idx, direction in enumerate(DIRECTIONS):
            frame = frames[row_idx][col_idx]

            # Check if cell has any content
            bbox = find_content_bbox(frame)
            if bbox is None:
                empty_cells += 1
                # Try to reuse idle frame for empty cells
                if anim_name != "idle" and "idle" in frame_meta:
                    if direction in frame_meta["idle"]:
                        frame_meta[anim_name][direction] = frame_meta["idle"][direction]
                        continue

            # Post-process each frame
            frame = cleanup_transparency(frame)
            if apply_palette:
                palette_img = build_palette_image(config)
                frame = reduce_palette(frame, palette_img)

            # Save individual frame
            filename = f"{sprite_key}-{anim_name}-{direction.lower()}.png"
            frame.save(dst_dir / filename, "PNG")
            frame_meta[anim_name][direction] = filename

    total = num_rows * num_cols
    print(f"    Sliced {total - empty_cells}/{total} frames ({empty_cells} empty, using fallbacks)")
    return frame_meta


# ---------------------------------------------------------------------------
# Processing pipelines
# ---------------------------------------------------------------------------

def mask_to_diamond(image: Image.Image) -> Image.Image:
    """Mask a tile image to the isometric diamond shape.
    Pixels outside the diamond become fully transparent.
    This prevents rectangular AI-generated tiles from overlapping neighbours."""
    w, h = image.size
    hw, hh = w // 2, h // 2
    arr = np.array(image.convert("RGBA"))

    # Build a diamond mask: for each pixel (x, y), inside iff
    #   |x - hw| / hw + |y - hh| / hh <= 1
    ys, xs = np.mgrid[0:h, 0:w]
    outside = (np.abs(xs - hw).astype(np.float64) / hw +
               np.abs(ys - hh).astype(np.float64) / hh) > 1.0
    arr[outside, 3] = 0
    return Image.fromarray(arr, "RGBA")


def process_tiles(config: dict, apply_palette: bool = True) -> int:
    """Process all tile images: resize, palette reduce, clean transparency.

    Ground and terrain tiles use resize_to_fill (cover mode) to ensure
    the texture fills the entire target area before diamond masking.
    This prevents the letterboxing bug where square AI images get padded
    into the canvas, leaving the diamond mask only partially filled.

    Output is at GAME tile size (64x32), not double-res, so no runtime
    scaling is needed.
    """
    # Game tile size — output directly at what the engine expects
    game_tile_w = 64
    game_tile_h = 32
    wall_h = config["tiles"]["wall_height"]
    processed = 0

    for subdir in ("ground", "walls", "terrain"):
        src_dir = OUTPUT_DIR / "tiles" / subdir
        dst_dir = PROCESSED_DIR / "tiles" / subdir

        if not src_dir.exists():
            continue

        dst_dir.mkdir(parents=True, exist_ok=True)

        for img_path in sorted(src_dir.glob("*.png")):
            print(f"  Processing: {img_path.name}")
            img = Image.open(img_path).convert("RGBA")

            if subdir == "walls":
                # Walls are taller, use fit-with-padding (they sit above tiles)
                img = resize_to_target(img, game_tile_w, wall_h)
            else:
                # Ground/terrain: FILL to cover entire target, then clip
                img = resize_to_fill(img, game_tile_w, game_tile_h)

            # Clean transparency
            img = cleanup_transparency(img)

            # Apply diamond mask to ground and terrain tiles
            if subdir != "walls":
                img = mask_to_diamond(img)

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


def process_weapons(config: dict, apply_palette: bool = True) -> int:
    """Process weapon overlay sprites — same sheet slicing as characters."""
    processed = 0

    weapons_dir = OUTPUT_DIR / "weapons"
    if not weapons_dir.exists():
        return 0

    # Metadata for all sliced weapon sheets
    all_frame_meta = {}

    for weapon_dir in sorted(weapons_dir.iterdir()):
        if not weapon_dir.is_dir():
            continue

        sprite_key = weapon_dir.name
        print(f"  Processing weapon: {sprite_key}")
        dst_dir = PROCESSED_DIR / "weapons" / sprite_key
        dst_dir.mkdir(parents=True, exist_ok=True)

        sheet_files = list(weapon_dir.glob("*-sheet.png"))
        for sheet_path in sheet_files:
            frame_meta = slice_and_save_character_sheet(
                sheet_path, sprite_key, config, dst_dir, apply_palette
            )
            all_frame_meta[sprite_key] = frame_meta
            processed += sum(len(dirs) for dirs in frame_meta.values())

    # Save frame metadata for deploy step
    if all_frame_meta:
        meta_path = PROCESSED_DIR / "weapons" / "_frame_meta.json"
        with open(meta_path, "w") as f:
            json.dump(all_frame_meta, f, indent=2)
        print(f"\n  Weapon frame metadata: {meta_path}")

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
    "weapons": process_weapons,
    "items": process_items,
    "portraits": process_portraits,
}

# Default categories when --category=all (excludes deprecated weapons)
DEFAULT_CATEGORIES = ["tiles", "sprites", "items", "portraits"]


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

    categories = DEFAULT_CATEGORIES if args.category == "all" else [args.category]
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
