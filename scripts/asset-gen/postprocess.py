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


def extract_and_center(region: Image.Image, target_w: int, target_h: int,
                       unified_bbox: tuple[int, int, int, int] | None = None) -> Image.Image:
    """Extract content from a region and place it bottom-center in a target-size canvas.
    Bottom-center anchoring keeps character feet at a consistent position
    for correct placement on isometric tiles.

    If unified_bbox is provided, crop to that region instead of auto-detecting.
    This ensures all frames of a character use the same crop window for
    consistent sizing and positioning across animation frames.
    """
    if unified_bbox is not None:
        bbox = unified_bbox
    else:
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


def detect_actual_grid_size(
    sheet: Image.Image,
    min_cell: int = 120,
    expected_rows: int = 8,
    expected_cols: int = 8,
) -> tuple[int, int]:
    """Detect the actual number of rows and columns in a sprite sheet.

    Gemini often ignores the requested grid size (e.g. 8×8) and produces
    anything from 4×1 to 6×6.  This function analyses alpha-channel density
    to find natural gaps between cells and counts the real grid dimensions.

    For sheets whose dimensions match the expected grid (e.g. 2048×2048 for
    8×8), the expected size is used directly.  Alpha-based gap detection is
    unreliable when characters have dense overlapping content — it detected
    7 rows instead of 8 for the raider sheet, causing misaligned slicing
    that "splits" characters.

    Returns (actual_rows, actual_cols).
    """
    sw, sh = sheet.size

    # For sheets matching the expected grid dimensions (2048×2048 → 8×8),
    # skip unreliable gap detection and use the known grid directly.
    # The Gemini pipeline always requests 8×8 at 2048×2048.
    # Only apply this for large sheets (cell >= 200px) to avoid forcing
    # 8×8 on smaller sheets (e.g. 1024×1024) that genuinely have fewer cells.
    expected_cell_w = sw / expected_cols
    expected_cell_h = sh / expected_rows
    min_expected_cell = 200  # 2048/8 = 256 passes; 1024/8 = 128 doesn't
    if (expected_cell_w == int(expected_cell_w) and
            expected_cell_h == int(expected_cell_h) and
            int(expected_cell_w) >= min_expected_cell and
            int(expected_cell_h) >= min_expected_cell):
        return expected_rows, expected_cols

    # For non-standard sheet sizes, fall back to alpha-density detection
    arr = np.array(sheet.convert("RGBA"))
    alpha = arr[:, :, 3]
    ah, aw = alpha.shape

    row_density = np.mean(alpha > 10, axis=1)
    col_density = np.mean(alpha > 10, axis=0)

    def count_cells(density: np.ndarray, total_size: int) -> tuple[int, list[int]]:
        """Count cells using multi-pass gap detection.

        Starts with a narrow kernel to catch even 5-10px gaps between cells,
        then tries progressively wider kernels.  Gemini sheets often have
        very narrow transparent gaps that a single wide kernel smooths away.
        """
        best_filtered = [0, total_size]

        for kernel_size, threshold in [(5, 0.03), (12, 0.06), (25, 0.08), (40, 0.10)]:
            ks = min(kernel_size, max(1, total_size // 5))
            if ks < 1:
                ks = 1
            kernel = np.ones(ks) / ks
            smoothed = np.convolve(density, kernel, mode="same")

            in_gap = smoothed < threshold
            splits = [0]

            i = 0
            while i < total_size:
                if in_gap[i]:
                    gap_start = i
                    while i < total_size and in_gap[i]:
                        i += 1
                    gap_mid = (gap_start + i) // 2
                    if gap_mid - splits[-1] >= min_cell:
                        splits.append(gap_mid)
                else:
                    i += 1
            splits.append(total_size)

            # Filter out tiny trailing cells
            filtered = [splits[0]]
            for s in splits[1:]:
                if s - filtered[-1] >= min_cell:
                    filtered.append(s)
                else:
                    filtered[-1] = s

            if len(filtered) > len(best_filtered):
                best_filtered = filtered

            if len(best_filtered) - 1 >= 8:
                break

        return len(best_filtered) - 1, best_filtered

    actual_rows, row_splits = count_cells(row_density, ah)
    actual_cols, col_splits = count_cells(col_density, aw)

    return actual_rows, actual_cols


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


def _strip_spillover(region: Image.Image, threshold: int = 10, gap_rows: int = 5) -> Image.Image:
    """Remove spillover content from neighboring cells.

    AI-generated sprite sheets have characters that extend beyond their
    grid cell (~280px tall in 256px cells).  After equal-grid slicing,
    each cell may contain:
      - Small boot/head fragments from an adjacent row (spillover)
      - The main character body for this cell

    Strategy: find vertical bands separated by transparent gaps, then
    keep the band closest to the BOTTOM of the cell.  Characters stand
    on the ground, so the main body is always in the bottom portion
    while spillover from the row above appears near the top.

    Only strips when the top band is significantly smaller than the
    bottom band (< 40% its height) to avoid removing legitimate content.
    """
    arr = np.array(region.convert("RGBA"))
    alpha = arr[:, :, 3]
    h, w = alpha.shape
    row_has_content = np.any(alpha > threshold, axis=1)

    # Find contiguous bands of content separated by transparent gaps
    bands: list[tuple[int, int]] = []  # (start_y, end_y)
    in_band = False
    band_start = 0

    for y in range(h):
        if row_has_content[y]:
            if not in_band:
                band_start = y
                in_band = True
        else:
            if in_band:
                bands.append((band_start, y))
                in_band = False
    if in_band:
        bands.append((band_start, h))

    if len(bands) <= 1:
        return region  # single band or empty — nothing to strip

    # Merge bands that are very close together (< gap_rows)
    merged: list[tuple[int, int]] = [bands[0]]
    for start, end in bands[1:]:
        prev_start, prev_end = merged[-1]
        if start - prev_end < gap_rows:
            merged[-1] = (prev_start, end)  # merge close bands
        else:
            merged.append((start, end))

    if len(merged) <= 1:
        return region  # all bands are close together

    # Keep ONLY the bottom-most band (where the character body is).
    # Characters are bottom-aligned (feet on ground) in each cell, so
    # the main body is always at the bottom.  Spillover from the row
    # above always appears near the top of the cell.  Erase everything
    # above the bottom band.
    bottom_band = merged[-1]

    result = region.copy()
    result_arr = np.array(result)
    for start, end in merged[:-1]:
        result_arr[start:end, :, 3] = 0  # erase top spillover
    return Image.fromarray(result_arr, "RGBA")


def _premultiplied_resize(
    image: Image.Image, new_w: int, new_h: int
) -> Image.Image:
    """Resize an RGBA image using LANCZOS with premultiplied alpha.

    Standard LANCZOS on non-premultiplied RGBA creates dark halos: fully
    transparent pixels have RGB=(0,0,0), and the interpolation bleeds that
    black into neighboring opaque edges.

    Fix: premultiply RGB by alpha before resize, then un-premultiply after.
    This ensures transparent pixels contribute zero color to the blend.
    """
    arr = np.array(image, dtype=np.float64)
    alpha = arr[:, :, 3:4] / 255.0

    # Premultiply: RGB * (A/255)
    arr[:, :, :3] *= alpha
    premul = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")

    # Resize all channels together
    scaled = premul.resize((new_w, new_h), Image.Resampling.LANCZOS)

    # Un-premultiply: RGB / (A/255), only where A > 0
    arr2 = np.array(scaled, dtype=np.float64)
    a2 = arr2[:, :, 3:4]
    # Replace zero alpha with 1 to avoid division by zero, then mask result
    safe_a = np.where(a2 > 0, a2, 1.0)
    arr2[:, :, :3] = np.where(a2 > 0, arr2[:, :, :3] / (safe_a / 255.0), 0)

    return Image.fromarray(np.clip(arr2, 0, 255).astype(np.uint8), "RGBA")


def slice_spritesheet(
    sheet: Image.Image,
    cell_w: int,
    cell_h: int,
    rows: int,
    cols: int,
) -> list[list[Image.Image]]:
    """
    Sprite sheet slicer: equal grid cells, premultiplied-alpha resize.

    Uses plain equal-sized grid cells (sheet_size / rows/cols).  Scales
    each cell proportionally by height to fit the target frame, preserving
    character proportions across ALL characters.

    Returns:
        2D list: result[row][col] = individual frame Image (target size).
    """
    sheet = sheet.convert("RGBA")
    sw, sh = sheet.size

    # Equal grid: every cell is exactly the same size
    src_cell_w = sw // cols
    src_cell_h = sh // rows

    # Single scale factor: map cell height → target height.
    # This is the same for ALL characters (since 2048/8=256 for all NPC
    # sheets), which keeps their relative proportions from the AI art.
    scale = cell_h / src_cell_h

    frames = []
    for r in range(rows):
        row_frames = []
        for c in range(cols):
            # Extract cell from equal grid
            x = c * src_cell_w
            y = r * src_cell_h
            region = sheet.crop((x, y, x + src_cell_w, y + src_cell_h))

            # Remove fragments from neighboring cells bleeding across the boundary.
            # Characters in AI-generated sheets often extend beyond their 256px
            # grid cell, so adjacent cells contain boot/head spillover separated
            # by 10-30px transparent gaps.  Use gap_rows=8 to catch these gaps
            # (verified: rows 3-7 in all sheets have 0 internal gaps, so no
            # false positives; only rows 1-2 in some sheets have real spillover).
            region = _strip_spillover(region, gap_rows=8)

            # Scale proportionally using premultiplied alpha to prevent dark halos
            new_w = max(1, int(src_cell_w * scale))
            new_h = max(1, int(src_cell_h * scale))
            scaled = _premultiplied_resize(region, new_w, new_h)

            # Aggressive transparency cleanup: snap semi-transparent fringe to fully
            # opaque or fully transparent.  Threshold=128 catches all visible fringes
            # that LANCZOS creates at character edges.
            scaled = cleanup_transparency(scaled, threshold=128)

            # Place onto target canvas: center horizontally, align bottom
            canvas = Image.new("RGBA", (cell_w, cell_h), (0, 0, 0, 0))

            # Horizontal: center, crop if wider than target
            if new_w <= cell_w:
                paste_x = (cell_w - new_w) // 2
                src_crop_x = 0
                paste_w = new_w
            else:
                paste_x = 0
                src_crop_x = (new_w - cell_w) // 2
                paste_w = cell_w

            # Vertical: bottom-align (feet on ground), crop top if taller
            if new_h <= cell_h:
                paste_y = cell_h - new_h
                src_crop_y = 0
                paste_h = new_h
            else:
                paste_y = 0
                src_crop_y = new_h - cell_h
                paste_h = cell_h

            cropped = scaled.crop((src_crop_x, src_crop_y,
                                   src_crop_x + paste_w, src_crop_y + paste_h))
            canvas.paste(cropped, (paste_x, paste_y), cropped)
            row_frames.append(canvas)
        frames.append(row_frames)

    return frames


def force_transparent_bg(image: Image.Image) -> Image.Image:
    """Remove background from AI-generated images.

    Handles three types of backgrounds that Gemini produces:

    1. Green chroma key (#00FF00): Detected by green-dominant heuristic
    2. Solid-color backgrounds: Detected by border pixel median analysis
    3. Checkerboard "transparency" patterns: Detected by analyzing
       alternating pixel colors on borders — Gemini renders a visible
       checkerboard instead of actual alpha transparency

    This runs BEFORE palette reduction so the raw Gemini colors
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

    # Second pass: detect dominant border color(s) and remove them.
    # Only run if borders are actually opaque (not already transparent).
    h, w = arr.shape[:2]
    border_alpha = np.concatenate([
        arr[0, :, 3], arr[h-1, :, 3], arr[:, 0, 3], arr[:, w-1, 3]
    ])
    border_opaque_fraction = np.mean(border_alpha > 10)

    if border_opaque_fraction > 0.5:
        # Collect opaque border pixels
        border_pixels = np.concatenate([
            arr[0, :, :3], arr[h-1, :, :3], arr[:, 0, :3], arr[:, w-1, :3]
        ], axis=0).astype(np.float32)
        border_alpha_flat = np.concatenate([
            arr[0, :, 3], arr[h-1, :, 3], arr[:, 0, 3], arr[:, w-1, 3]
        ])
        opaque_mask = border_alpha_flat > 10
        opaque_border = border_pixels[opaque_mask]

        if len(opaque_border) > 0:
            # Check for checkerboard pattern: analyze color variance
            # Checkerboards have two distinct clusters; solid backgrounds have one
            # Simple 2-cluster detection using numpy (no sklearn needed):
            # Split border pixels into two groups by distance from median
            median_color = np.median(opaque_border, axis=0)
            dists = np.sqrt(np.sum((opaque_border - median_color) ** 2, axis=1))
            mean_dist = np.mean(dists)

            if mean_dist > 20:
                # High variance suggests checkerboard or multi-color background
                # Find two cluster centers: pixels above/below median distance
                far = opaque_border[dists > mean_dist]
                near = opaque_border[dists <= mean_dist]
                bg_colors = []
                if len(near) > 0:
                    bg_colors.append(np.median(near, axis=0))
                if len(far) > 0:
                    bg_colors.append(np.median(far, axis=0))

                # Remove pixels matching either background color
                all_bg = np.zeros((h, w), dtype=bool)
                for bg_color in bg_colors:
                    diff = np.sqrt(np.sum((arr[:, :, :3].astype(np.float32) - bg_color) ** 2, axis=2))
                    all_bg |= diff < 45

                bg_fraction = np.sum(all_bg) / (h * w)
                if bg_fraction > 0.25:
                    arr[all_bg, 3] = 0
            else:
                # Low variance: single solid background color
                diff = np.sqrt(np.sum((arr[:, :, :3].astype(np.float32) - median_color) ** 2, axis=2))
                is_bg = diff < 40
                bg_fraction = np.sum(is_bg) / (h * w)
                if bg_fraction > 0.30:
                    arr[is_bg, 3] = 0

    return Image.fromarray(arr, "RGBA")


def slice_and_save_character_sheet(
    sheet_path: Path,
    sprite_key: str,
    config: dict,
    dst_dir: Path,
    apply_palette: bool = True,
) -> dict:
    """
    Content-aware sprite sheet slicer with auto grid detection.

    Gemini often ignores the requested 8×8 grid and produces anything from
    4×1 to 6×6.  This function:

    1. Opens the sheet and forces transparent background
    2. Auto-detects the ACTUAL grid dimensions (not hardcoded 8×8)
    3. Slices using the detected grid
    4. Maps actual rows/cols to animation names and directions
    5. Fills missing directions via horizontal mirroring
    6. Falls back to idle for missing animation rows
    7. Outputs all 8 animations × 8 directions (with fallbacks)

    Returns a frame metadata dict for the manifest.
    """
    from prompts.characters import SHEET_DIRECTIONS, SHEET_ANIMATIONS

    cell_w = config["sprites"]["base_width"]
    cell_h = config["sprites"]["base_height"]

    sheet = Image.open(sheet_path).convert("RGBA")

    # Force green backgrounds to transparent (Gemini often ignores alpha requests)
    sheet = force_transparent_bg(sheet)

    # Auto-detect actual grid dimensions — Gemini produces uneven grids
    actual_rows, actual_cols = detect_actual_grid_size(sheet)

    print(f"    Sheet size: {sheet.size[0]}x{sheet.size[1]}, "
          f"detected grid: {actual_cols} cols x {actual_rows} rows "
          f"(expected 8x8), frame target: {cell_w}x{cell_h}")

    # Keep the original sheet (cleaned up) for reprocess.py to re-slice later
    sheet_copy_name = f"{sprite_key}-sheet.png"
    sheet.save(dst_dir / sheet_copy_name, "PNG")
    print(f"    Kept original sheet: {sheet_copy_name}")

    # Direction mapping based on actual column count.
    # The AI generates a front-to-back rotation — not always matching prompt order.
    DIRECTION_MAP = {
        1: ["S"],
        2: ["S", "N"],
        3: ["S", "SW", "N"],
        4: ["S", "SW", "N", "NW"],
        5: ["S", "SW", "W", "N", "NW"],
        6: ["S", "SW", "W", "NW", "N", "NE"],
        7: ["S", "SW", "W", "NW", "N", "NE", "E"],
        8: list(SHEET_DIRECTIONS),
    }
    actual_dirs = DIRECTION_MAP.get(actual_cols, list(SHEET_DIRECTIONS[:actual_cols]))

    # Animation mapping: use first N of SHEET_ANIMATIONS for the detected row count
    actual_anims = list(SHEET_ANIMATIONS[:min(actual_rows, len(SHEET_ANIMATIONS))])

    # Slice using detected grid dimensions
    frames = slice_spritesheet(sheet, cell_w, cell_h, actual_rows, actual_cols)

    # Mirror pairs for filling missing directions
    MIRROR_PAIRS = {"SE": "SW", "E": "W", "NE": "NW"}

    # Build extracted dict: {anim: {direction: Image}}
    extracted: dict[str, dict[str, Image.Image]] = {}
    empty_cells = 0

    for row_idx, anim_name in enumerate(actual_anims):
        extracted[anim_name] = {}
        for col_idx, direction in enumerate(actual_dirs):
            frame = frames[row_idx][col_idx]
            bbox = find_content_bbox(frame)
            if bbox is not None:
                extracted[anim_name][direction] = frame
            else:
                empty_cells += 1

    actual_count = sum(len(dirs) for dirs in extracted.values())

    # Fill missing directions via mirroring (SE←SW, E←W, NE←NW)
    for anim_name in list(extracted.keys()):
        for target, source in MIRROR_PAIRS.items():
            if target not in extracted[anim_name] and source in extracted[anim_name]:
                extracted[anim_name][target] = extracted[anim_name][source].transpose(
                    Image.Transpose.FLIP_LEFT_RIGHT
                )

    # Output all 8 animations × 8 directions, with fallbacks for missing data
    frame_meta: dict[str, dict[str, str]] = {}

    for anim_name in SHEET_ANIMATIONS:
        frame_meta[anim_name] = {}
        for direction in SHEET_DIRECTIONS:
            # Try: exact match → idle same direction → any idle → empty
            frame = None
            if anim_name in extracted and direction in extracted[anim_name]:
                frame = extracted[anim_name][direction]
            elif "idle" in extracted and direction in extracted["idle"]:
                frame = extracted["idle"][direction]
            else:
                # Last resort: any available frame
                for a in extracted.values():
                    for f in a.values():
                        frame = f
                        break
                    if frame:
                        break

            if frame is None:
                frame = Image.new("RGBA", (cell_w, cell_h), (0, 0, 0, 0))

            # Post-process each frame (match slicer threshold for crisp edges)
            frame = cleanup_transparency(frame, threshold=128)
            if apply_palette:
                palette_img = build_palette_image(config)
                frame = reduce_palette(frame, palette_img)

            filename = f"{sprite_key}-{anim_name}-{direction.lower()}.png"
            frame.save(dst_dir / filename, "PNG")
            frame_meta[anim_name][direction] = filename

    total = len(SHEET_ANIMATIONS) * len(SHEET_DIRECTIONS)
    print(f"    Extracted {actual_count} real frames → output {total} "
          f"({empty_cells} empty cells, rest filled from mirroring/fallbacks)")
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


def process_tile_sheets(config: dict, apply_palette: bool = True) -> int:
    """Slice 2×2 terrain variant sheets into individual diamond tiles.

    Each sheet is 1024×1024 with a 2×2 grid of 512×512 cells.
    Each cell contains one isometric diamond tile variant on green background.

    Output:
      - 4 individual tiles per terrain at game resolution (64×32)
      - Diamond-masked with transparent background
      - _tile_meta.json mapping terrain keys to variant filenames
    """
    game_tile_w = 64
    game_tile_h = 32
    processed = 0

    sheets_dir = OUTPUT_DIR / "tiles" / "sheets"
    dst_dir = PROCESSED_DIR / "tiles" / "ground"

    if not sheets_dir.exists():
        return 0

    dst_dir.mkdir(parents=True, exist_ok=True)
    tile_meta: dict[str, list[str]] = {}

    for sheet_path in sorted(sheets_dir.glob("*-sheet.png")):
        key = sheet_path.stem.replace("-sheet", "")
        print(f"  Processing tile sheet: {sheet_path.name} ({key})")

        sheet = Image.open(sheet_path).convert("RGBA")

        # Remove green chroma-key background
        sheet = force_transparent_bg(sheet)

        sw, sh = sheet.size
        cell_w = sw // 2
        cell_h = sh // 2

        variant_files = []
        for idx in range(4):
            row = idx // 2
            col = idx % 2
            x = col * cell_w
            y = row * cell_h

            # Extract cell
            cell = sheet.crop((x, y, x + cell_w, y + cell_h))

            # Resize to game tile size using fill mode (cover)
            cell = resize_to_fill(cell, game_tile_w, game_tile_h)

            # Clean up transparency
            cell = cleanup_transparency(cell)

            # Apply diamond mask
            cell = mask_to_diamond(cell)

            # Palette reduction
            if apply_palette:
                palette_img = build_palette_image(config)
                cell = reduce_palette(cell, palette_img)

            filename = f"{key}-{idx + 1:02d}.png"
            cell.save(dst_dir / filename, "PNG")
            variant_files.append(filename)
            processed += 1

        tile_meta[key] = variant_files
        print(f"    Sliced {len(variant_files)} variants: {', '.join(variant_files)}")

    # Save metadata for deploy step
    if tile_meta:
        meta_path = PROCESSED_DIR / "tiles" / "_tile_meta.json"
        meta_path.parent.mkdir(parents=True, exist_ok=True)
        with open(meta_path, "w") as f:
            json.dump(tile_meta, f, indent=2)
        print(f"\n  Tile metadata: {meta_path}")

    return processed


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


def process_objects(config: dict, apply_palette: bool = True) -> int:
    """Process environmental object sprites.

    Handles two cases:
    1. Single object PNGs — resize, remove background, palette reduction
    2. Object variant sheets (*-sheet.png) — slice into individual variants,
       then resize and palette-reduce each
    """
    obj_size = config.get("objects", {}).get("size", 256)
    # Target size for objects in the game (rendered at ~32-40px wide)
    target_size = 64
    processed = 0

    objects_dir = OUTPUT_DIR / "objects"
    if not objects_dir.exists():
        return 0

    for cat_dir in sorted(objects_dir.iterdir()):
        if not cat_dir.is_dir():
            continue

        dst_dir = PROCESSED_DIR / "objects" / cat_dir.name
        dst_dir.mkdir(parents=True, exist_ok=True)

        for img_path in sorted(cat_dir.glob("*.png")):
            img = Image.open(img_path).convert("RGBA")

            if "-sheet" in img_path.stem:
                # Variant sheet — slice into individual object images
                key = img_path.stem.replace("-sheet", "")
                w, h = img.size

                # Detect grid: 2×2 for 4 variants, 3×3 for up to 9
                if w > h * 1.3:
                    cols, rows = 4, 1
                elif h > w * 1.3:
                    cols, rows = 1, 4
                else:
                    # Square-ish: try 2×2
                    cols, rows = 2, 2

                cell_w = w // cols
                cell_h = h // rows

                for row in range(rows):
                    for col in range(cols):
                        idx = row * cols + col
                        x0 = col * cell_w
                        y0 = row * cell_h
                        cell = img.crop((x0, y0, x0 + cell_w, y0 + cell_h))

                        # Skip empty cells
                        bbox = cell.getbbox()
                        if not bbox:
                            continue

                        cell = force_transparent_bg(cell)
                        cell = cleanup_transparency(cell)
                        cell = resize_to_target(cell, target_size, target_size)

                        if apply_palette:
                            palette_img = build_palette_image(config)
                            cell = reduce_palette(cell, palette_img)

                        variant_name = f"{key}_{idx + 1}.png"
                        cell.save(dst_dir / variant_name, "PNG")
                        processed += 1
                        print(f"  Sliced: {img_path.name} -> {variant_name}")

                # Also save first variant as the base key name
                base_path = dst_dir / f"{key}.png"
                first_variant = dst_dir / f"{key}_1.png"
                if first_variant.exists() and not base_path.exists():
                    import shutil
                    shutil.copy2(first_variant, base_path)

            else:
                # Single object — resize + cleanup
                print(f"  Processing: {img_path.name}")
                img = force_transparent_bg(img)
                img = cleanup_transparency(img)
                img = resize_to_target(img, target_size, target_size)

                if apply_palette:
                    palette_img = build_palette_image(config)
                    img = reduce_palette(img, palette_img)

                img.save(dst_dir / img_path.name, "PNG")
                processed += 1

    return processed


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def process_terrain_textures(config: dict, apply_palette: bool = True) -> int:
    """Process seamless rectangular terrain textures (preferred format).

    These are large rectangular textures — NOT diamond-shaped.
    The game engine uses them as CanvasPattern fills, clipping to diamond
    shapes at render time. This produces a cohesive, continuous landscape
    instead of individually stamped tiles.

    Input: output/tiles/textures/{terrain}-texture.png (1024×1024)
    Output: processed/tiles/textures/{terrain}-texture.png (256×256)
    Water input: output/tiles/textures/water-texture.png (1024×1024, 2×2 grid)
    Water output: 4 individual frames at 256×256 each

    No diamond masking, no transparency — fully opaque rectangular images.
    """
    target_size = 256
    processed = 0

    textures_dir = OUTPUT_DIR / "tiles" / "textures"
    dst_dir = PROCESSED_DIR / "tiles" / "textures"

    if not textures_dir.exists():
        return 0

    dst_dir.mkdir(parents=True, exist_ok=True)
    texture_meta: dict[str, str | list[str]] = {}

    for tex_path in sorted(textures_dir.glob("*-texture.png")):
        key = tex_path.stem.replace("-texture", "")
        print(f"  Processing terrain texture: {tex_path.name} ({key})")

        img = Image.open(tex_path).convert("RGB")

        if key == "water":
            # Water: 2×2 grid of animation frames
            sw, sh = img.size
            cell_w = sw // 2
            cell_h = sh // 2
            frame_files = []

            for idx in range(4):
                row = idx // 2
                col = idx % 2
                x = col * cell_w
                y = row * cell_h

                cell = img.crop((x, y, x + cell_w, y + cell_h))
                cell = cell.resize((target_size, target_size), Image.Resampling.LANCZOS)

                if apply_palette:
                    palette_img = build_palette_image(config)
                    cell_rgba = cell.convert("RGBA")
                    cell_rgba = reduce_palette(cell_rgba, palette_img)
                    cell = cell_rgba.convert("RGB")

                filename = f"water-{idx + 1:02d}.png"
                cell.save(dst_dir / filename, "PNG")
                frame_files.append(filename)
                processed += 1

            texture_meta["water"] = frame_files
            print(f"    Water: {len(frame_files)} animation frames")
        else:
            # Standard terrain: single seamless texture
            img = img.resize((target_size, target_size), Image.Resampling.LANCZOS)

            if apply_palette:
                palette_img = build_palette_image(config)
                img_rgba = img.convert("RGBA")
                img_rgba = reduce_palette(img_rgba, palette_img)
                img = img_rgba.convert("RGB")

            filename = f"{key}-texture.png"
            img.save(dst_dir / filename, "PNG")
            texture_meta[key] = filename
            processed += 1

    # Save metadata for deploy step
    if texture_meta:
        meta_path = PROCESSED_DIR / "tiles" / "_texture_meta.json"
        meta_path.parent.mkdir(parents=True, exist_ok=True)
        with open(meta_path, "w") as f:
            json.dump(texture_meta, f, indent=2)
        print(f"\n  Texture metadata: {meta_path}")

    return processed


STEP_MAP = {
    "tiles": process_tiles,
    "tile_sheets": process_tile_sheets,
    "terrain_textures": process_terrain_textures,
    "sprites": process_sprites,
    "weapons": process_weapons,
    "items": process_items,
    "objects": process_objects,
    "portraits": process_portraits,
}

# Default categories when --category=all
DEFAULT_CATEGORIES = ["terrain_textures", "sprites", "objects", "items", "portraits"]


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
