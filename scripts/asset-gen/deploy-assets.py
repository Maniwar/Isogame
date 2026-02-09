#!/usr/bin/env python3
"""
Deploy processed assets into the game's public/assets/ directory and
generate a manifest.json that the game's AssetManager loads at runtime.

Usage:
    python deploy-assets.py

    # Deploy from a custom processed directory
    python deploy-assets.py --source ./processed

    # Deploy to a custom target
    python deploy-assets.py --target ../../public/assets

This script:
1. Scans the processed/ directory for all generated PNGs
2. Copies them into public/assets/ with game-compatible paths
3. Generates public/assets/manifest.json mapping sprite keys to file paths
4. Includes animation frame metadata for sprite sheet-sliced characters
"""

import argparse
import json
import shutil
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
DEFAULT_SOURCE = SCRIPT_DIR / "processed"
DEFAULT_TARGET = SCRIPT_DIR.parent.parent / "public" / "assets"

# Maps tile variant names to the game's Terrain enum names
TILE_TERRAIN_MAP = {
    "cracked-earth": "CrackedEarth",
    "sand": "Sand",
    "dirt-road": "Road",
    "rubble": "Rubble",
    "dead-grass": "Grass",
    "asphalt-broken": "Road",
    "concrete-floor": "Concrete",
}

# Water tiles from terrain features
TERRAIN_OBJECT_MAP = {
    "water-puddle": "Water",
}

DIRECTIONS = ["s", "sw", "w", "nw", "n", "ne", "e", "se"]

# Animation names matching the sprite sheet layout
ANIMATIONS = ["idle", "walk_1", "walk_2", "attack"]


def deploy(source: Path, target: Path) -> dict:
    """Copy assets and build manifest."""
    manifest: dict = {
        "tiles": {},
        "sprites": {},
        "animations": {},
        "objects": {},
        "items": {},
        "portraits": {},
    }

    # Ensure target directories exist
    for subdir in ["tiles", "sprites", "objects", "items", "portraits"]:
        (target / subdir).mkdir(parents=True, exist_ok=True)

    deployed = 0

    # --- Tiles ---
    tiles_dir = source / "tiles"
    if tiles_dir.exists():
        for subdir in ["ground", "walls", "terrain"]:
            src = tiles_dir / subdir
            if not src.exists():
                continue
            for png in sorted(src.glob("*.png")):
                # Extract variant name from filename (e.g., "cracked-earth-01.png")
                stem = png.stem
                # Strip trailing number: "cracked-earth-01" -> "cracked-earth"
                parts = stem.rsplit("-", 1)
                variant = parts[0] if len(parts) > 1 and parts[1].isdigit() else stem

                terrain_name = TILE_TERRAIN_MAP.get(variant) or TERRAIN_OBJECT_MAP.get(variant)
                if terrain_name and terrain_name not in manifest["tiles"]:
                    dest = target / "tiles" / png.name
                    shutil.copy2(png, dest)
                    manifest["tiles"][terrain_name] = f"/assets/tiles/{png.name}"
                    deployed += 1
                    print(f"  Tile: {png.name} -> {terrain_name}")

                # Also deploy as object if it's a wall or terrain feature
                if subdir == "walls":
                    dest = target / "objects" / png.name
                    shutil.copy2(png, dest)
                    obj_key = variant  # e.g., "brick-wall"
                    if obj_key not in manifest["objects"]:
                        manifest["objects"][obj_key] = f"/assets/objects/{png.name}"
                        deployed += 1

    # --- Sprites (with animation support) ---
    sprites_dir = source / "sprites"
    if sprites_dir.exists():
        # Check for frame metadata from the slicer
        frame_meta_path = sprites_dir / "_frame_meta.json"
        frame_meta = {}
        if frame_meta_path.exists():
            with open(frame_meta_path) as f:
                frame_meta = json.load(f)

        for char_dir in sorted(sprites_dir.iterdir()):
            if not char_dir.is_dir():
                continue
            sprite_key = char_dir.name
            manifest["sprites"][sprite_key] = {}

            if sprite_key in frame_meta:
                # Deploy animation frames from sliced sprite sheets
                anim_data = frame_meta[sprite_key]
                manifest["animations"][sprite_key] = {}

                for anim_name, directions in anim_data.items():
                    manifest["animations"][sprite_key][anim_name] = {}
                    for direction, filename in directions.items():
                        src_file = char_dir / filename
                        if src_file.exists():
                            dest_name = f"{sprite_key}-{anim_name}-{direction.lower()}.png"
                            dest = target / "sprites" / dest_name
                            shutil.copy2(src_file, dest)
                            path = f"/assets/sprites/{dest_name}"
                            manifest["animations"][sprite_key][anim_name][direction] = path
                            deployed += 1

                            # Also populate the main sprites map with idle frames
                            if anim_name == "idle":
                                manifest["sprites"][sprite_key][direction] = path

                    print(f"  Anim: {sprite_key}/{anim_name} ({len(directions)} dirs)")
            else:
                # Legacy: individual direction images without animations
                for png in sorted(char_dir.glob("*.png")):
                    if "spritesheet" in png.name:
                        continue

                    stem = png.stem
                    for d in DIRECTIONS:
                        if stem.endswith(f"-{d}"):
                            direction = d.upper()
                            dest_name = f"{sprite_key}-{d}.png"
                            dest = target / "sprites" / dest_name
                            shutil.copy2(png, dest)
                            manifest["sprites"][sprite_key][direction] = f"/assets/sprites/{dest_name}"
                            deployed += 1
                            print(f"  Sprite: {png.name} -> {sprite_key}/{direction}")
                            break

    # --- Items ---
    items_dir = source / "items"
    if items_dir.exists():
        for cat_dir in sorted(items_dir.iterdir()):
            if not cat_dir.is_dir():
                continue
            for png in sorted(cat_dir.glob("*.png")):
                icon_key = png.stem  # e.g., "item_pistol"
                dest = target / "items" / png.name
                shutil.copy2(png, dest)
                manifest["items"][icon_key] = f"/assets/items/{png.name}"
                deployed += 1
                print(f"  Item: {png.name} -> {icon_key}")

    # --- Portraits ---
    portraits_dir = source / "portraits"
    if portraits_dir.exists():
        for png in sorted(portraits_dir.glob("*.png")):
            portrait_key = png.stem  # e.g., "sheriff-morgan"
            dest = target / "portraits" / png.name
            shutil.copy2(png, dest)
            manifest["portraits"][portrait_key] = f"/assets/portraits/{png.name}"
            deployed += 1
            print(f"  Portrait: {png.name} -> {portrait_key}")

    # Remove empty categories from manifest
    manifest = {k: v for k, v in manifest.items() if v}

    # Write manifest
    manifest_path = target / "manifest.json"
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"\n  Manifest: {manifest_path}")

    return manifest


def main():
    parser = argparse.ArgumentParser(
        description="Deploy AI-generated assets into the game's public directory."
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=DEFAULT_SOURCE,
        help=f"Source directory with processed assets (default: {DEFAULT_SOURCE})",
    )
    parser.add_argument(
        "--target",
        type=Path,
        default=DEFAULT_TARGET,
        help=f"Target public/assets directory (default: {DEFAULT_TARGET})",
    )
    args = parser.parse_args()

    print("=== Isogame Asset Deployer ===")
    print(f"Source: {args.source}")
    print(f"Target: {args.target}\n")

    if not args.source.exists():
        print(f"ERROR: Source directory does not exist: {args.source}")
        print("Run generate.py and postprocess.py first.")
        return

    manifest = deploy(args.source, args.target)

    # Count deployed assets
    sprite_count = sum(
        len(dirs) for dirs in manifest.get("sprites", {}).values()
    )
    anim_count = sum(
        sum(len(dirs) for dirs in anims.values())
        for anims in manifest.get("animations", {}).values()
    )
    other_count = sum(
        len(v) for k, v in manifest.items() if k not in ("sprites", "animations")
    )
    print(f"\n=== Deployed {sprite_count + anim_count + other_count} assets ===")
    if anim_count > 0:
        print(f"  Animation frames: {anim_count}")
    print("The game will automatically load these on next refresh.")


if __name__ == "__main__":
    main()
