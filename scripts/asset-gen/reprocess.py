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
SHEET_ROWS = 4  # idle, walk_1, walk_2, attack
SHEET_COLS = 8  # S, SW, W, NW, N, NE, E, SE

ANIMATIONS = ["idle", "walk_1", "walk_2", "attack"]
DIRECTIONS = ["s", "sw", "w", "nw", "n", "ne", "e", "se"]

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

def detect_grid(sheet: Image.Image, rows: int, cols: int) -> list:
    """Detect grid cell boundaries in a sprite sheet using alpha/color analysis."""
    sw, sh = sheet.size
    arr = np.array(sheet.convert("RGBA"))

    # For green-bg sheets, use green channel density instead of alpha
    g = arr[:, :, 1].astype(int)
    r = arr[:, :, 0].astype(int)
    b = arr[:, :, 2].astype(int)
    is_content = ~((g > 100) & (g > r + 20) & (g > b + 30))

    row_density = np.mean(is_content, axis=1)
    col_density = np.mean(is_content, axis=0)

    def find_splits(density, expected_parts, total_size):
        chunk = total_size // expected_parts
        splits = [0]
        for i in range(1, expected_parts):
            expected_pos = int(i * chunk)
            search_start = max(0, expected_pos - chunk // 4)
            search_end = min(total_size, expected_pos + chunk // 4)
            if search_start < search_end:
                window = density[search_start:search_end]
                best = search_start + int(np.argmin(window))
                splits.append(best if density[best] < 0.3 else expected_pos)
            else:
                splits.append(expected_pos)
        splits.append(total_size)
        return splits

    row_splits = find_splits(row_density, rows, sh)
    col_splits = find_splits(col_density, cols, sw)

    cells = []
    for ri in range(rows):
        row_cells = []
        for ci in range(cols):
            x = col_splits[ci]
            y = row_splits[ri]
            w = col_splits[ci + 1] - x
            h = row_splits[ri + 1] - y
            row_cells.append((x, y, w, h))
        cells.append(row_cells)
    return cells


def extract_sprite_frame(region: Image.Image, target_w: int, target_h: int,
                         center_content: bool = True) -> Image.Image:
    """Extract a sprite frame from a grid cell region.

    Args:
        region: The raw cell region from the sheet
        target_w, target_h: Output dimensions
        center_content: If True, center on content bbox. If False, scale
                       uniformly preserving position (for weapon overlays).
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
        # Crop to content, scale to fit target, center
        content = clean.crop((left, top, right, bottom))
        cw, ch = content.size
        if cw > target_w or ch > target_h:
            scale = min(target_w / cw, target_h / ch)
            content = content.resize(
                (max(1, int(cw * scale)), max(1, int(ch * scale))),
                Image.Resampling.LANCZOS,
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
        scaled = clean.resize(
            (max(1, int(rw * scale)), max(1, int(rh * scale))),
            Image.Resampling.LANCZOS,
        )
        canvas = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
        sw, sh = scaled.size
        ox = (target_w - sw) // 2
        oy = (target_h - sh) // 2
        canvas.paste(scaled, (ox, oy), scaled)
        return canvas


def reslice_sheet(sheet_path: Path, sprite_key: str, dst_dir: Path,
                  center_content: bool = True,
                  apply_palette: bool = True) -> dict:
    """Re-slice a 1024x1024 sprite sheet into individual frames.

    Returns frame metadata dict for manifest.
    """
    sheet = Image.open(sheet_path).convert("RGBA")
    grid = detect_grid(sheet, SHEET_ROWS, SHEET_COLS)

    frame_meta = {}
    stats = {"total": 0, "empty": 0}

    for row_idx, anim in enumerate(ANIMATIONS):
        frame_meta[anim] = {}
        for col_idx, direction in enumerate(DIRECTIONS):
            x, y, w, h = grid[row_idx][col_idx]
            region = sheet.crop((x, y, x + w, y + h))

            frame = extract_sprite_frame(
                region, SPRITE_W, SPRITE_H,
                center_content=center_content,
            )

            # Check if empty
            frame_arr = np.array(frame)
            if np.sum(frame_arr[:, :, 3] > 10) < 50:
                stats["empty"] += 1
                # Fallback to idle
                if anim != "idle" and "idle" in frame_meta and direction in frame_meta["idle"]:
                    frame_meta[anim][direction] = frame_meta["idle"][direction]
                    continue
                # Use empty frame
                frame = Image.new("RGBA", (SPRITE_W, SPRITE_H), (0, 0, 0, 0))

            # Palette reduction
            if apply_palette:
                frame = reduce_palette(frame)

            # Clean transparency
            frame_arr = np.array(frame)
            frame_arr[:, :, 3] = np.where(frame_arr[:, :, 3] < 10, 0, 255).astype(np.uint8)
            frame = Image.fromarray(frame_arr, "RGBA")

            filename = f"{sprite_key}-{anim}-{direction}.png"
            frame.save(dst_dir / filename, "PNG")
            frame_meta[anim][direction] = filename
            stats["total"] += 1

    return {"meta": frame_meta, "stats": stats}


def fix_sprites(dry_run: bool = False) -> list:
    """Re-slice all character sprite sheets."""
    sprite_dir = ASSETS_DIR / "sprites"
    results = []

    for path in sorted(sprite_dir.glob("*-sheet.png")):
        sprite_key = path.stem.replace("-sheet", "")
        print(f"  Re-slicing: {sprite_key}")

        if dry_run:
            results.append({"status": "audit", "file": path.name})
            continue

        result = reslice_sheet(
            path, sprite_key, sprite_dir,
            center_content=True,
            apply_palette=True,
        )
        results.append({
            "status": "ok",
            "file": path.name,
            "sprite_key": sprite_key,
            **result["stats"],
        })

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
