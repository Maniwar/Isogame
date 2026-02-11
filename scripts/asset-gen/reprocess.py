#!/usr/bin/env python3
"""
Reprocess deployed assets in public/assets/ to fix broken geometry.

Root causes this fixes:
  1. TILES: resize_to_target letterboxed square AI images into 128x64,
     creating a 64x64 centered square instead of filling the canvas.
     The diamond mask then only covers the center overlap.
     FIX: Extract content, scale to FILL 64x32, apply proper diamond mask.

  2. SPRITES: Green background removal was incomplete — postprocessor removed
     some green, palette reduction changed the colors, then game-side removal
     used wrong thresholds.  Individual frames still have ~3000 green pixels.
     FIX: Re-slice from 1024x1024 sheets with thorough green removal.

  3. WEAPONS: extract_and_center recentered each weapon on its own content,
     destroying spatial alignment with character frames.
     FIX: Use uniform cell extraction (no recentering) so weapon position
     within the 64x96 frame matches the character coordinate space.

Usage:
    python reprocess.py              # Fix everything
    python reprocess.py --category tiles
    python reprocess.py --category sprites
    python reprocess.py --category weapons
    python reprocess.py --dry-run    # Audit only, no writes
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ASSETS_DIR = Path(__file__).parent.parent.parent / "public" / "assets"
CONFIG_PATH = Path(__file__).parent / "config.yaml"

# Game constants
TILE_W = 64
TILE_H = 32
SPRITE_W = 64
SPRITE_H = 96

# All 8 directions the game engine expects (column order in the sprite sheet prompt)
ALL_DIRECTIONS = ["s", "sw", "w", "nw", "n", "ne", "e", "se"]
# The 4 animation rows the AI actually generates (row order in the sprite sheet).
# The prompt asks for 6 rows (+ shoot, reload) but the AI consistently produces
# only 4.  The game's AnimationSystem maps shoot→attack and reload→idle at
# runtime, so we only need to output these 4.
REAL_ANIMATIONS = ["idle", "walk_1", "walk_2", "attack"]

# Mirror mapping: missing direction → source direction to horizontally flip.
# The prompt asks S,SW,W,NW,N,NE,E,SE but AI typically generates only the
# first 4–6 columns.  Mirroring exploits bilateral symmetry.
MIRROR_PAIRS = {
    "se": "sw",
    "e":  "w",
    "ne": "nw",
}

# Fallout 2 palette for color mapping
PALETTE_HEX = {
    "sand_light": "#D4C4A0", "sand_dark": "#B8A67C",
    "dirt": "#8B7355", "dirt_dark": "#6B5340", "mud": "#5C4A3A",
    "rust_light": "#C4703A", "rust": "#A0522D", "rust_dark": "#7A3B1E",
    "metal_light": "#9E9E8E", "metal_dark": "#6E6E5E",
    "green_faded": "#7A8B5A", "green_dark": "#4A5B3A", "brown_green": "#6B7B4A",
    "sky_haze": "#C8BFA0", "shadow": "#3A3A2E", "black": "#1E1E16",
    "nuclear_glow": "#8EC44A", "warning_red": "#B83030", "pip_green": "#40C040",
}


def hex_to_rgb(h: str) -> tuple:
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


PALETTE_RGB = np.array([hex_to_rgb(v) for v in PALETTE_HEX.values()], dtype=np.float32)


# ---------------------------------------------------------------------------
# Shared utilities
# ---------------------------------------------------------------------------

def remove_green_bg(image: Image.Image) -> Image.Image:
    """Remove green chroma-key background from an RGBA image.

    Uses multiple strategies to catch all green variants:
    1. Color distance to measured mean green (R≈121, G≈185, B≈71)
    2. General green-dominant detection (G > R+20, G > B+30)
    3. Flood-fill from edges to catch connected green regions
    """
    arr = np.array(image.convert("RGBA")).copy()
    r = arr[:, :, 0].astype(np.int16)
    g = arr[:, :, 1].astype(np.int16)
    b = arr[:, :, 2].astype(np.int16)

    # Strategy 1: distance to known green background mean
    dr = r - 121
    dg = g - 185
    db = b - 71
    dist_sq = dr * dr + dg * dg + db * db
    close_to_bg = dist_sq < 5000

    # Strategy 2: general green dominance (catches variations)
    green_dominant = (g > 100) & (g > r + 20) & (g > b + 30)

    # Combine: anything that's green-dominant OR close to bg mean
    is_green = close_to_bg | green_dominant
    arr[is_green, 3] = 0

    return Image.fromarray(arr, "RGBA")


def defringe(image: Image.Image, passes: int = 2, dark_threshold: int = 35) -> Image.Image:
    """Remove dark fringe pixels around content edges.

    The palette reduction maps semi-transparent edge pixels (created by
    LANCZOS resize blending content with transparent black) to the darkest
    palette color (#1E1E16 = RGB 30,30,22).  The binary alpha threshold
    then makes them fully opaque, creating a visible dark outline.

    This function iteratively removes opaque very-dark pixels that border
    transparent regions.  Interior dark pixels (eyes, shadows) are not
    affected because they are surrounded by other opaque pixels.

    Args:
        image: RGBA image to defringe
        passes: Number of erosion passes (2 handles 2px-wide borders)
        dark_threshold: max(R,G,B) below this is considered "dark fringe"
    """
    arr = np.array(image.convert("RGBA")).copy()

    for _ in range(passes):
        h, w = arr.shape[:2]
        alpha = arr[:, :, 3]
        rgb_max = np.max(arr[:, :, :3], axis=2)

        # Find transparent pixels
        is_transparent = alpha == 0

        # Find opaque pixels adjacent to at least one transparent pixel
        near_transparent = np.zeros((h, w), dtype=bool)
        near_transparent[1:, :] |= is_transparent[:-1, :]
        near_transparent[:-1, :] |= is_transparent[1:, :]
        near_transparent[:, 1:] |= is_transparent[:, :-1]
        near_transparent[:, :-1] |= is_transparent[:, 1:]

        # Remove dark edge pixels
        dark_edge = (alpha > 0) & (rgb_max <= dark_threshold) & near_transparent
        arr[dark_edge, 3] = 0

    return Image.fromarray(arr, "RGBA")


def resize_premultiplied(image: Image.Image, new_size: tuple,
                         resample=Image.Resampling.LANCZOS) -> Image.Image:
    """Resize an RGBA image using premultiplied alpha to prevent dark halos.

    Standard LANCZOS on non-premultiplied RGBA blends RGB values of
    transparent pixels (0,0,0,0) with content, creating dark fringes.
    Premultiplied alpha avoids this by scaling RGB by alpha before resize.
    """
    arr = np.array(image).astype(np.float64)
    alpha = arr[:, :, 3:4] / 255.0

    # Premultiply: RGB *= alpha
    premul = arr.copy()
    premul[:, :, :3] *= alpha
    premul_img = Image.fromarray(premul.astype(np.uint8), "RGBA")

    # Resize in premultiplied space
    resized = premul_img.resize(new_size, resample)

    # Un-premultiply: RGB /= alpha
    out = np.array(resized).astype(np.float64)
    out_alpha = out[:, :, 3:4] / 255.0
    safe_alpha = np.maximum(out_alpha, 1.0 / 255.0)
    out[:, :, :3] = np.clip(out[:, :, :3] / safe_alpha, 0, 255)

    return Image.fromarray(out.astype(np.uint8), "RGBA")


def reduce_palette(image: Image.Image, num_colors: int = 32) -> Image.Image:
    """Reduce to Fallout 2 palette, preserving alpha."""
    arr = np.array(image.convert("RGBA"))
    alpha = arr[:, :, 3].copy()
    rgb = arr[:, :, :3].astype(np.float32)

    # Quantize first
    rgb_img = Image.fromarray(arr[:, :, :3], "RGB")
    quantized = rgb_img.quantize(colors=num_colors, method=Image.Quantize.MEDIANCUT)
    result = np.array(quantized.convert("RGB"), dtype=np.float32)

    # Map each pixel to nearest palette color
    h, w, _ = result.shape
    pixels = result.reshape(h, w, 1, 3)
    palette = PALETTE_RGB.reshape(1, 1, -1, 3)
    distances = np.sum((pixels - palette) ** 2, axis=3)
    nearest = np.argmin(distances, axis=2)
    mapped = PALETTE_RGB[nearest].astype(np.uint8)

    # Restore alpha
    out = np.dstack([mapped, alpha])
    return Image.fromarray(out, "RGBA")


def make_diamond_mask(w: int, h: int) -> np.ndarray:
    """Create a boolean diamond mask for dimensions w x h.
    True = inside diamond, False = outside."""
    hw, hh = w / 2.0, h / 2.0
    ys, xs = np.mgrid[0:h, 0:w]
    # Use center of each pixel
    return (np.abs(xs + 0.5 - hw) / hw + np.abs(ys + 0.5 - hh) / hh) <= 1.0


# ---------------------------------------------------------------------------
# TILE REPROCESSING
# ---------------------------------------------------------------------------

def fix_tile(src_path: Path, dst_path: Path) -> dict:
    """Fix a single tile image.

    The broken tiles are 128x64 with content in a 64x64 centered square
    (cols 32-95, rows 0-63).  The art within that square is painted to
    look like an isometric diamond when viewed at 1:1 aspect.

    Fix: extract the 64x64 content, scale to 64x32 (squashes the visual
    diamond into proper 2:1 iso proportions), clip to diamond mask.
    """
    img = Image.open(src_path).convert("RGBA")
    arr = np.array(img)

    # Find the actual content region
    alpha = arr[:, :, 3]
    cols_any = np.any(alpha > 0, axis=0)
    rows_any = np.any(alpha > 0, axis=1)

    if not np.any(cols_any) or not np.any(rows_any):
        return {"status": "empty", "file": src_path.name}

    left = int(np.argmax(cols_any))
    right = int(len(cols_any) - np.argmax(cols_any[::-1]))
    top = int(np.argmax(rows_any))
    bottom = int(len(rows_any) - np.argmax(rows_any[::-1]))

    # Extract content region
    content = img.crop((left, top, right, bottom))
    cw, ch = content.size

    # Scale to FILL the 64x32 tile (cover mode, crop excess)
    scale = max(TILE_W / cw, TILE_H / ch)
    scaled_w = int(cw * scale)
    scaled_h = int(ch * scale)
    scaled = content.resize((scaled_w, scaled_h), Image.Resampling.LANCZOS)

    # Crop to exact 64x32 from center
    cx = (scaled_w - TILE_W) // 2
    cy = (scaled_h - TILE_H) // 2
    tile = scaled.crop((cx, cy, cx + TILE_W, cy + TILE_H))

    # Apply diamond mask
    tile_arr = np.array(tile)
    diamond = make_diamond_mask(TILE_W, TILE_H)
    tile_arr[~diamond, 3] = 0

    # Clean up: fully opaque inside diamond, fully transparent outside
    tile_arr[diamond & (tile_arr[:, :, 3] > 10), 3] = 255
    tile_arr[~diamond, 3] = 0

    result = Image.fromarray(tile_arr, "RGBA")
    result.save(dst_path, "PNG")

    # Verify
    out_arr = np.array(result)
    opaque = int(np.sum(out_arr[:, :, 3] > 0))
    expected = int(np.sum(diamond))
    return {
        "status": "ok",
        "file": src_path.name,
        "content_region": f"({left},{top})-({right},{bottom})",
        "output_size": f"{TILE_W}x{TILE_H}",
        "diamond_fill": f"{opaque}/{expected} ({opaque*100//max(1,expected)}%)",
    }


def fix_tiles(dry_run: bool = False) -> list:
    """Fix all tile images."""
    tile_dir = ASSETS_DIR / "tiles"
    results = []
    for path in sorted(tile_dir.glob("*.png")):
        if dry_run:
            img = Image.open(path)
            results.append({"status": "audit", "file": path.name, "size": img.size})
        else:
            result = fix_tile(path, path)  # Fix in-place
            results.append(result)
    return results


# ---------------------------------------------------------------------------
# SPRITE SHEET RE-SLICING
# ---------------------------------------------------------------------------

def detect_grid_auto(sheet: Image.Image) -> tuple:
    """Auto-detect actual grid dimensions in a sprite sheet.

    The AI generates variable grids (typically 4-6 cols × 4 rows) inside a
    1024×1024 image.  Instead of assuming a fixed 8×6 layout, we find the
    real cell boundaries by analysing content-density gaps.

    Returns (cells, actual_rows, actual_cols) where cells is a 2D list of
    (x, y, w, h) tuples.
    """
    sw, sh = sheet.size
    arr = np.array(sheet.convert("RGBA"))

    # Classify each pixel as content (True) or background (False)
    g = arr[:, :, 1].astype(int)
    r = arr[:, :, 0].astype(int)
    b = arr[:, :, 2].astype(int)
    is_content = ~((g > 100) & (g > r + 20) & (g > b + 30))

    row_density = np.mean(is_content, axis=1)
    col_density = np.mean(is_content, axis=0)

    def find_natural_splits(density, total_size, min_cell=120):
        """Find actual cell boundaries by detecting runs of low-density pixels.

        Uses a smoothed density profile to avoid splitting on noise within
        large gaps (e.g., a few pixels of content between two empty regions).
        min_cell=120 prevents splitting a real column (typically 170-256px in
        a 4-6 column 1024px sheet) while still allowing up to ~8 real columns.
        """
        # Smooth with a wide kernel to merge small blips in gaps
        kernel_size = 40
        kernel = np.ones(kernel_size) / kernel_size
        smoothed = np.convolve(density, kernel, mode="same")

        threshold = 0.10  # smoothed density below this = gap
        in_gap = smoothed < threshold
        splits = [0]

        i = 0
        while i < total_size:
            if in_gap[i]:
                gap_start = i
                while i < total_size and in_gap[i]:
                    i += 1
                gap_end = i
                gap_mid = (gap_start + gap_end) // 2

                # Only count as a split if the cell on either side is big enough
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
                filtered[-1] = s  # merge into previous
        return filtered

    row_splits = find_natural_splits(row_density, sh)
    col_splits = find_natural_splits(col_density, sw)

    actual_rows = len(row_splits) - 1
    actual_cols = len(col_splits) - 1

    cells = []
    for ri in range(actual_rows):
        row_cells = []
        for ci in range(actual_cols):
            x = col_splits[ci]
            y = row_splits[ri]
            w = col_splits[ci + 1] - x
            h = row_splits[ri + 1] - y
            row_cells.append((x, y, w, h))
        cells.append(row_cells)

    return cells, actual_rows, actual_cols


def measure_content_bbox(region: Image.Image) -> tuple:
    """Remove green bg from a cell and return (cleaned_image, content_w, content_h).

    Returns (None, 0, 0) if the cell is empty after green removal.
    """
    clean = remove_green_bg(region)
    arr = np.array(clean)
    alpha = arr[:, :, 3]
    mask = alpha > 10
    if not mask.any():
        return None, 0, 0

    rows_any = np.any(mask, axis=1)
    cols_any = np.any(mask, axis=0)
    top = int(np.argmax(rows_any))
    bottom = int(len(rows_any) - np.argmax(rows_any[::-1]))
    left = int(np.argmax(cols_any))
    right = int(len(cols_any) - np.argmax(cols_any[::-1]))

    return clean, right - left, bottom - top


def extract_sprite_frame(region: Image.Image, target_w: int, target_h: int,
                         center_content: bool = True,
                         uniform_scale: float | None = None) -> Image.Image:
    """Extract a sprite frame from a grid cell region.

    Args:
        region: The raw cell region from the sheet
        target_w, target_h: Output dimensions
        center_content: If True, center on content bbox. If False, scale
                       uniformly preserving position (for weapon overlays).
        uniform_scale: If provided, use this scale factor for ALL frames of a
                      character instead of computing per-frame. This ensures
                      the character stays the same size across animation frames.
    """
    # Remove green bg from this cell
    clean = remove_green_bg(region)
    arr = np.array(clean)
    alpha = arr[:, :, 3]

    # Find content bounding box
    mask = alpha > 10
    if not mask.any():
        return Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))

    rows_any = np.any(mask, axis=1)
    cols_any = np.any(mask, axis=0)
    top = int(np.argmax(rows_any))
    bottom = int(len(rows_any) - np.argmax(rows_any[::-1]))
    left = int(np.argmax(cols_any))
    right = int(len(cols_any) - np.argmax(cols_any[::-1]))

    if center_content:
        # Crop to content, scale to fit target, bottom-center anchor
        content = clean.crop((left, top, right, bottom))
        cw, ch = content.size

        if uniform_scale is not None:
            # Use the pre-computed uniform scale for consistent character sizing
            scale = uniform_scale
        else:
            # Legacy per-frame scaling (only used if uniform_scale not provided)
            scale = min(target_w / cw, target_h / ch, 1.0)

        new_w = max(1, int(cw * scale))
        new_h = max(1, int(ch * scale))
        if (new_w, new_h) != (cw, ch):
            content = resize_premultiplied(
                content, (new_w, new_h),
            )

        cw, ch = content.size
        canvas = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
        # Anchor to bottom-center (feet on ground)
        ox = (target_w - cw) // 2
        oy = target_h - ch
        canvas.paste(content, (ox, oy), content)
        return canvas
    else:
        # Uniform scale: preserve relative position within cell
        rw, rh = region.size
        scale = min(target_w / rw, target_h / rh)
        scaled = resize_premultiplied(
            clean, (max(1, int(rw * scale)), max(1, int(rh * scale))),
        )
        canvas = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
        sw, sh = scaled.size
        ox = (target_w - sw) // 2
        oy = (target_h - sh) // 2
        canvas.paste(scaled, (ox, oy), scaled)
        return canvas



def validate_sheet(sheet_path: Path) -> dict:
    """Validate a sprite sheet before processing.

    Checks:
      1. Image loads and is RGBA
      2. Grid detection finds ≥4 cols × ≥4 rows
      3. Each cell has substantial content (not empty)
      4. Content is character-sized (not tiny fragments)

    Returns {"ok": True/False, "errors": [...], "grid": (rows, cols)}
    """
    errors = []

    try:
        sheet = Image.open(sheet_path).convert("RGBA")
    except Exception as e:
        return {"ok": False, "errors": [f"Cannot open: {e}"], "grid": (0, 0)}

    sw, sh = sheet.size
    if sw < 256 or sh < 256:
        errors.append(f"Image too small: {sw}x{sh} (need ≥256x256)")

    grid, actual_rows, actual_cols = detect_grid_auto(sheet)

    if actual_rows < 4:
        errors.append(f"Only {actual_rows} rows detected (need ≥4)")
    if actual_cols < 4:
        errors.append(f"Only {actual_cols} columns detected (need ≥4)")

    # Check each cell has content
    min_content_pixels = 200  # at least 200 opaque pixels per cell
    empty_cells = 0
    total_cells = 0

    for ri in range(min(actual_rows, 4)):
        for ci in range(min(actual_cols, 4)):
            x, y, w, h = grid[ri][ci]
            region = sheet.crop((x, y, x + w, y + h))
            clean = remove_green_bg(region)
            arr = np.array(clean)
            opaque = int(np.sum(arr[:, :, 3] > 10))
            total_cells += 1
            if opaque < min_content_pixels:
                empty_cells += 1

    if empty_cells > 0:
        errors.append(
            f"{empty_cells}/{total_cells} cells have <{min_content_pixels} "
            f"opaque pixels (may be empty or fragmented)"
        )

    return {
        "ok": len(errors) == 0,
        "errors": errors,
        "grid": (actual_rows, actual_cols),
        "size": (sw, sh),
    }


def reslice_sheet(sheet_path: Path, sprite_key: str, dst_dir: Path,
                  center_content: bool = True,
                  apply_palette: bool = True) -> dict:
    """Re-slice a 1024x1024 sprite sheet into individual frames.

    The AI generates 4-6 columns (directions) × 4 rows (animations: idle,
    walk_1, walk_2, attack).  This function:
      1. Auto-detects the actual grid layout
      2. Measures all content bboxes to compute uniform scale
      3. Extracts all cells with consistent sizing
      4. Mirrors missing directions (SW→SE, W→E, NW→NE)

    Only outputs the 4 real animation rows.  The game's AnimationSystem maps
    shoot→attack and reload→idle at runtime (no synthetic frames needed).

    Returns frame metadata dict for manifest.
    """
    sheet = Image.open(sheet_path).convert("RGBA")
    grid, actual_rows, actual_cols = detect_grid_auto(sheet)

    print(f"    Grid detected: {actual_cols} cols x {actual_rows} rows "
          f"(expected 8x6, image {sheet.size[0]}x{sheet.size[1]})")

    # Map actual columns → direction names.
    # The prompt orders columns as S, SW, W, NW, N, NE, E, SE.
    # If the AI only generated N columns, take the first N from that list.
    detected_dirs = ALL_DIRECTIONS[:actual_cols]

    # Map actual rows → animation names (first N of REAL_ANIMATIONS)
    detected_anims = REAL_ANIMATIONS[:actual_rows]

    # ---- Pass 1: Measure all content bboxes to find uniform scale ----
    # This ensures the character stays the same size across ALL animation frames.
    max_content_w = 0
    max_content_h = 0
    cell_regions = {}  # (row, col) -> cropped region Image

    for row_idx, anim in enumerate(detected_anims):
        for col_idx, direction in enumerate(detected_dirs):
            x, y, w, h = grid[row_idx][col_idx]
            region = sheet.crop((x, y, x + w, y + h))
            cell_regions[(row_idx, col_idx)] = region

            if center_content:
                _, cw, ch = measure_content_bbox(region)
                if cw > 0 and ch > 0:
                    max_content_w = max(max_content_w, cw)
                    max_content_h = max(max_content_h, ch)

    # Compute uniform scale: primarily HEIGHT-based for character body consistency.
    # Weapons extending far horizontally (e.g., rifle in attack pose) shouldn't
    # shrink the whole character.  Width overflow is allowed up to 50% — the
    # content gets center-cropped to the frame, clipping only weapon extremities.
    uniform_scale = None
    if center_content and max_content_w > 0 and max_content_h > 0:
        height_scale = min(SPRITE_H / max_content_h, 1.0)
        max_allowed_width = SPRITE_W * 1.5
        if max_content_w * height_scale > max_allowed_width:
            # Width overflow too extreme — cap to 150% of frame width
            uniform_scale = min(max_allowed_width / max_content_w, 1.0)
        else:
            uniform_scale = height_scale
        print(f"    Uniform scale: {uniform_scale:.3f} "
              f"(max content {max_content_w}x{max_content_h} → "
              f"{int(max_content_w * uniform_scale)}x{int(max_content_h * uniform_scale)} "
              f"in {SPRITE_W}x{SPRITE_H})")

    # ---- Pass 2: Extract all actually-present cells ----
    # Store as {anim: {direction: Image}}
    extracted: dict[str, dict[str, Image.Image]] = {}
    stats = {"total": 0, "empty": 0, "mirrored": 0}

    for row_idx, anim in enumerate(detected_anims):
        extracted[anim] = {}
        for col_idx, direction in enumerate(detected_dirs):
            region = cell_regions[(row_idx, col_idx)]

            frame = extract_sprite_frame(
                region, SPRITE_W, SPRITE_H,
                center_content=center_content,
                uniform_scale=uniform_scale,
            )

            # Check if empty
            frame_arr = np.array(frame)
            if np.sum(frame_arr[:, :, 3] > 10) < 50:
                stats["empty"] += 1
                frame = None
            else:
                extracted[anim][direction] = frame

    # Phase 2: Fill missing directions via mirroring
    for anim in list(extracted.keys()):
        for target_dir, source_dir in MIRROR_PAIRS.items():
            if target_dir not in extracted[anim] and source_dir in extracted[anim]:
                mirrored = extracted[anim][source_dir].transpose(
                    Image.Transpose.FLIP_LEFT_RIGHT
                )
                extracted[anim][target_dir] = mirrored
                stats["mirrored"] += 1

    # If N direction is missing, try to derive it
    for anim in list(extracted.keys()):
        if "n" not in extracted[anim]:
            # Use nw or ne if available
            for fallback in ["nw", "ne"]:
                if fallback in extracted[anim]:
                    extracted[anim]["n"] = extracted[anim][fallback]
                    break

    # Phase 3: Save all frames (only the 4 real animations)
    frame_meta = {}

    for anim in REAL_ANIMATIONS:
        frame_meta[anim] = {}
        anim_frames = extracted.get(anim, {})

        for direction in ALL_DIRECTIONS:
            frame = anim_frames.get(direction)

            if frame is None:
                # Last resort: use idle of any available direction
                if "idle" in extracted:
                    for d in ALL_DIRECTIONS:
                        if d in extracted["idle"]:
                            frame = extracted["idle"][d]
                            break
                if frame is None:
                    frame = Image.new("RGBA", (SPRITE_W, SPRITE_H), (0, 0, 0, 0))

            # Palette reduction
            if apply_palette:
                frame = reduce_palette(frame)

            # Clean transparency: binary alpha threshold
            frame_arr = np.array(frame)
            frame_arr[:, :, 3] = np.where(
                frame_arr[:, :, 3] < 30, 0, 255
            ).astype(np.uint8)
            frame = Image.fromarray(frame_arr, "RGBA")

            # Remove dark fringe pixels at content edges
            frame = defringe(frame, passes=2, dark_threshold=35)

            filename = f"{sprite_key}-{anim}-{direction}.png"
            frame.save(dst_dir / filename, "PNG")
            frame_meta[anim][direction] = filename
            stats["total"] += 1

    print(f"    Saved {stats['total']} frames "
          f"({stats['mirrored']} mirrored, {stats['empty']} empty cells)")

    return {"meta": frame_meta, "stats": stats}


def fix_sprites(dry_run: bool = False) -> list:
    """Re-slice all character sprite sheets and update the manifest."""
    sprite_dir = ASSETS_DIR / "sprites"
    manifest_path = ASSETS_DIR / "manifest.json"
    results = []
    all_meta: dict[str, dict] = {}

    for path in sorted(sprite_dir.glob("*-sheet.png")):
        sprite_key = path.stem.replace("-sheet", "")
        print(f"  Re-slicing: {sprite_key}")

        # QA gate: validate sheet before processing (warn but still process)
        validation = validate_sheet(path)
        r, c = validation["grid"]
        if not validation["ok"]:
            print(f"    VALIDATION WARNING (processing anyway):")
            for err in validation["errors"]:
                print(f"      - {err}")
            print(f"    Grid: {c} cols × {r} rows, {validation['size'][0]}x{validation['size'][1]}")
        else:
            print(f"    Validation OK: {c} cols × {r} rows, {validation['size'][0]}x{validation['size'][1]}")

        if dry_run:
            results.append({"status": "audit", "file": path.name})
            continue

        result = reslice_sheet(
            path, sprite_key, sprite_dir,
            center_content=True,
            apply_palette=True,
        )
        all_meta[sprite_key] = result["meta"]
        results.append({
            "status": "ok",
            "file": path.name,
            "sprite_key": sprite_key,
            **result["stats"],
        })

    # Update the manifest with new sprite/animation entries
    if not dry_run and all_meta:
        manifest = {}
        if manifest_path.exists():
            manifest = json.loads(manifest_path.read_text())

        # Rebuild sprites and animations sections from frame metadata
        sprites_section = manifest.get("sprites", {})
        anims_section = manifest.get("animations", {})

        for sprite_key, meta in all_meta.items():
            # Static sprites = idle direction images
            if "idle" in meta:
                dir_map = {}
                for d, filename in meta["idle"].items():
                    dir_map[d.upper()] = f"/assets/sprites/{filename}"
                sprites_section[sprite_key] = dir_map

            # Animations = all anim/direction combos
            anim_map = {}
            for anim_name, dirs in meta.items():
                dir_map = {}
                for d, filename in dirs.items():
                    dir_map[d.upper()] = f"/assets/sprites/{filename}"
                anim_map[anim_name] = dir_map
            anims_section[sprite_key] = anim_map

        manifest["sprites"] = sprites_section
        manifest["animations"] = anims_section

        # Remove deprecated weapons section if present
        manifest.pop("weapons", None)

        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
        print(f"\n  Updated manifest: {len(all_meta)} sprite keys, "
              f"{sum(len(a) for a in anims_section.values())} anim entries")

    return results


def fix_weapons(dry_run: bool = False) -> list:
    """Re-slice all weapon sprite sheets with position preservation."""
    weapon_dir = ASSETS_DIR / "weapons"
    results = []

    for path in sorted(weapon_dir.glob("*-sheet.png")):
        sprite_key = path.stem.replace("-sheet", "")
        print(f"  Re-slicing weapon: {sprite_key}")

        if dry_run:
            results.append({"status": "audit", "file": path.name})
            continue

        result = reslice_sheet(
            path, sprite_key, weapon_dir,
            center_content=False,  # Preserve position for overlay alignment
            apply_palette=True,
        )
        results.append({
            "status": "ok",
            "file": path.name,
            "sprite_key": sprite_key,
            **result["stats"],
        })

    return results


# ---------------------------------------------------------------------------
# QA VALIDATION
# ---------------------------------------------------------------------------

def qa_validate() -> bool:
    """Validate all reprocessed assets meet the game's requirements."""
    print("\n" + "=" * 60)
    print("QA VALIDATION")
    print("=" * 60)
    ok = True

    # Validate tiles
    print("\n--- Tiles ---")
    tile_dir = ASSETS_DIR / "tiles"
    diamond = make_diamond_mask(TILE_W, TILE_H)
    expected_opaque = int(np.sum(diamond))

    for path in sorted(tile_dir.glob("*.png")):
        img = Image.open(path)
        arr = np.array(img.convert("RGBA"))
        w, h = img.size

        checks = []
        # Size check
        if (w, h) != (TILE_W, TILE_H):
            checks.append(f"FAIL size={w}x{h} expected {TILE_W}x{TILE_H}")
            ok = False
        else:
            checks.append(f"OK size={w}x{h}")

        # Diamond fill check
        opaque = int(np.sum(arr[:, :, 3] > 0))
        fill_pct = opaque * 100 // max(1, expected_opaque)
        if fill_pct < 90:
            checks.append(f"FAIL diamond fill={fill_pct}%")
            ok = False
        else:
            checks.append(f"OK fill={fill_pct}%")

        # Corner transparency check
        if arr[0, 0, 3] > 0 or arr[0, w - 1, 3] > 0:
            checks.append("FAIL corners not transparent")
            ok = False
        else:
            checks.append("OK corners transparent")

        # Center opacity check
        if arr[TILE_H // 2, TILE_W // 2, 3] == 0:
            checks.append("FAIL center transparent")
            ok = False
        else:
            checks.append("OK center opaque")

        print(f"  {path.name}: {', '.join(checks)}")

    # Validate sprites
    print("\n--- Sprites ---")
    sprite_dir = ASSETS_DIR / "sprites"
    for path in sorted(sprite_dir.glob("*-idle-s.png")):
        sprite_key = path.stem.replace("-idle-s", "")
        img = Image.open(path)
        arr = np.array(img.convert("RGBA"))
        w, h = img.size

        checks = []
        if (w, h) != (SPRITE_W, SPRITE_H):
            checks.append(f"FAIL size={w}x{h}")
            ok = False
        else:
            checks.append(f"OK size={w}x{h}")

        # Green pixel check
        g = arr[:, :, 1].astype(int)
        r = arr[:, :, 0].astype(int)
        b = arr[:, :, 2].astype(int)
        a = arr[:, :, 3]
        green_opaque = int(np.sum((a > 0) & (g > 100) & (g > r + 20) & (g > b + 30)))
        if green_opaque > 50:
            checks.append(f"FAIL {green_opaque} green pixels")
            ok = False
        else:
            checks.append(f"OK green={green_opaque}")

        # Content presence check
        opaque = int(np.sum(a > 0))
        total = w * h
        if opaque < total * 0.1:
            checks.append(f"FAIL too sparse ({opaque}/{total})")
            ok = False
        else:
            checks.append(f"OK content={opaque*100//total}%")

        print(f"  {sprite_key}: {', '.join(checks)}")

    # Validate weapons
    print("\n--- Weapons ---")
    weapon_dir = ASSETS_DIR / "weapons"
    for path in sorted(weapon_dir.glob("*-idle-s.png")):
        sprite_key = path.stem.replace("-idle-s", "")
        img = Image.open(path)
        arr = np.array(img.convert("RGBA"))
        w, h = img.size

        checks = []
        if (w, h) != (SPRITE_W, SPRITE_H):
            checks.append(f"FAIL size={w}x{h}")
            ok = False
        else:
            checks.append(f"OK size={w}x{h}")

        a = arr[:, :, 3]
        g_ch = arr[:, :, 1].astype(int)
        r_ch = arr[:, :, 0].astype(int)
        b_ch = arr[:, :, 2].astype(int)
        green_opaque = int(np.sum((a > 0) & (g_ch > 100) & (g_ch > r_ch + 20) & (g_ch > b_ch + 30)))
        if green_opaque > 50:
            checks.append(f"FAIL {green_opaque} green pixels")
            ok = False
        else:
            checks.append(f"OK green={green_opaque}")

        print(f"  {sprite_key}: {', '.join(checks)}")

    print(f"\n{'ALL CHECKS PASSED' if ok else 'SOME CHECKS FAILED'}")
    return ok


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Reprocess deployed game assets")
    parser.add_argument("--category", choices=["tiles", "sprites", "weapons", "all"],
                        default="all")
    parser.add_argument("--dry-run", action="store_true", help="Audit only, no writes")
    parser.add_argument("--no-palette", action="store_true")
    parser.add_argument("--validate-only", action="store_true", help="Run QA validation only")
    args = parser.parse_args()

    if args.validate_only:
        ok = qa_validate()
        sys.exit(0 if ok else 1)

    categories = ["tiles", "sprites", "weapons"] if args.category == "all" else [args.category]

    print("=" * 60)
    print("ASSET REPROCESSOR")
    print(f"Categories: {', '.join(categories)}")
    print(f"Dry run: {args.dry_run}")
    print("=" * 60)

    for cat in categories:
        print(f"\n--- {cat.upper()} ---")
        if cat == "tiles":
            results = fix_tiles(args.dry_run)
        elif cat == "sprites":
            results = fix_sprites(args.dry_run)
        elif cat == "weapons":
            results = fix_weapons(args.dry_run)
        else:
            continue

        for r in results:
            print(f"  {r}")

    if not args.dry_run:
        qa_validate()


if __name__ == "__main__":
    main()
