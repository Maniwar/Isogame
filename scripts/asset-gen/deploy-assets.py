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
    "dirt": "Dirt",
    "dirt-road": "Road",
    "rubble": "Rubble",
    "dead-grass": "Grass",
    "asphalt-broken": "Road",
    "concrete-floor": "Concrete",
}

# Maps terrain sheet keys (from TERRAIN_ARCHETYPES) to game Terrain enum names
TILE_SHEET_TERRAIN_MAP = {
    "sand": "Sand",
    "dirt": "Dirt",
    "cracked-earth": "CrackedEarth",
    "rubble": "Rubble",
    "road": "Road",
    "concrete": "Concrete",
    "grass": "Grass",
    "water": "Water",
}

# Water tiles from terrain features
TERRAIN_OBJECT_MAP = {
    "water-puddle": "Water",
}

DIRECTIONS = ["s", "sw", "w", "nw", "n", "ne", "e", "se"]

# Animation names matching the 8-row sprite sheet layout
ANIMATIONS = ["idle", "walk_1", "walk_2", "walk_3", "walk_4", "attack_1", "attack_2", "hit"]


def deploy(source: Path, target: Path) -> dict:
    """Copy assets and build manifest.

    Merges with any existing manifest.json in the target directory so that
    deploying a single category (e.g. tiles) doesn't erase entries from
    a previous category (e.g. characters).
    """
    # Load existing manifest to preserve entries from earlier runs
    existing_manifest_path = target / "manifest.json"
    if existing_manifest_path.exists():
        with open(existing_manifest_path) as f:
            manifest: dict = json.load(f)
        print(f"  Loaded existing manifest with sections: {list(manifest.keys())}")
    else:
        manifest = {}

    # Ensure all sections exist
    for section in ("tiles", "terrain_textures", "sprites", "animations", "weapons", "objects", "items", "portraits"):
        manifest.setdefault(section, {})

    # Ensure target directories exist
    for subdir in ["tiles", "sprites", "weapons", "objects", "items", "portraits"]:
        (target / subdir).mkdir(parents=True, exist_ok=True)

    deployed = 0

    # --- Terrain textures (preferred: seamless rectangular textures) ---
    texture_meta_path = source / "tiles" / "_texture_meta.json"
    if texture_meta_path.exists():
        with open(texture_meta_path) as f:
            texture_meta = json.load(f)

        for sheet_key, file_or_files in texture_meta.items():
            terrain_name = TILE_SHEET_TERRAIN_MAP.get(sheet_key)
            if not terrain_name:
                print(f"  WARNING: Unknown texture key: {sheet_key}")
                continue

            if isinstance(file_or_files, list):
                # Water: array of animation frame filenames
                paths = []
                for filename in file_or_files:
                    src_file = source / "tiles" / "textures" / filename
                    if src_file.exists():
                        dest = target / "tiles" / filename
                        shutil.copy2(src_file, dest)
                        paths.append(f"/assets/tiles/{filename}")
                        deployed += 1
                if paths:
                    manifest["terrain_textures"][terrain_name] = paths
                    print(f"  Texture: {terrain_name} ({len(paths)} frames)")
            else:
                # Single texture file
                filename = file_or_files
                src_file = source / "tiles" / "textures" / filename
                if src_file.exists():
                    dest = target / "tiles" / filename
                    shutil.copy2(src_file, dest)
                    manifest["terrain_textures"][terrain_name] = f"/assets/tiles/{filename}"
                    deployed += 1
                    print(f"  Texture: {terrain_name} -> {filename}")

    # --- Tile variant sheets (legacy: diamond tile arrays per terrain) ---
    tile_meta_path = source / "tiles" / "_tile_meta.json"
    if tile_meta_path.exists():
        with open(tile_meta_path) as f:
            tile_meta = json.load(f)

        for sheet_key, variant_files in tile_meta.items():
            terrain_name = TILE_SHEET_TERRAIN_MAP.get(sheet_key)
            if not terrain_name:
                print(f"  WARNING: Unknown tile sheet key: {sheet_key}")
                continue

            paths = []
            for filename in variant_files:
                src_file = source / "tiles" / "ground" / filename
                if src_file.exists():
                    dest = target / "tiles" / filename
                    shutil.copy2(src_file, dest)
                    paths.append(f"/assets/tiles/{filename}")
                    deployed += 1

            if paths:
                manifest["tiles"][terrain_name] = paths
                print(f"  Tile: {terrain_name} ({len(paths)} variants)")

    # --- Legacy tiles (single images, backwards compatibility) ---
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
                    # Legacy: single string path (AssetManager handles both formats)
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

                # Also deploy the original sheet for reference
                sheet_file = char_dir / f"{sprite_key}-sheet.png"
                if sheet_file.exists():
                    dest = target / "sprites" / f"{sprite_key}-sheet.png"
                    shutil.copy2(sheet_file, dest)
                    deployed += 1
                    print(f"  Sheet: {sprite_key}-sheet.png (kept)")
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

    # --- Weapons (overlay sprite sheets with animations) ---
    weapons_dir = source / "weapons"
    if weapons_dir.exists():
        weapon_meta_path = weapons_dir / "_frame_meta.json"
        weapon_meta = {}
        if weapon_meta_path.exists():
            with open(weapon_meta_path) as f:
                weapon_meta = json.load(f)

        for weapon_dir in sorted(weapons_dir.iterdir()):
            if not weapon_dir.is_dir():
                continue
            weapon_key = weapon_dir.name

            if weapon_key in weapon_meta:
                anim_data = weapon_meta[weapon_key]
                manifest["weapons"][weapon_key] = {}

                for anim_name, directions in anim_data.items():
                    manifest["weapons"][weapon_key][anim_name] = {}
                    for direction, filename in directions.items():
                        src_file = weapon_dir / filename
                        if src_file.exists():
                            dest_name = f"{weapon_key}-{anim_name}-{direction.lower()}.png"
                            dest = target / "weapons" / dest_name
                            shutil.copy2(src_file, dest)
                            path = f"/assets/weapons/{dest_name}"
                            manifest["weapons"][weapon_key][anim_name][direction] = path
                            deployed += 1

                    print(f"  Weapon: {weapon_key}/{anim_name} ({len(directions)} dirs)")

                # Keep original sheet
                sheet_file = weapon_dir / f"{weapon_key}-sheet.png"
                if sheet_file.exists():
                    dest = target / "weapons" / f"{weapon_key}-sheet.png"
                    shutil.copy2(sheet_file, dest)
                    deployed += 1
                    print(f"  Sheet: {weapon_key}-sheet.png (kept)")

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
    # Map portrait filenames to the spriteKey used by game entities so the
    # runtime can look up portraits by entity.spriteKey directly.
    portrait_to_sprite_key = {
        "sheriff-morgan": "npc_sheriff",
        "doc-hendricks": "npc_doc",
        "scrap": "npc_merchant",
    }
    portraits_dir = source / "portraits"
    if portraits_dir.exists():
        for png in sorted(portraits_dir.glob("*.png")):
            portrait_key = png.stem  # e.g., "sheriff-morgan"
            dest = target / "portraits" / png.name
            shutil.copy2(png, dest)
            path = f"/assets/portraits/{png.name}"
            manifest["portraits"][portrait_key] = path
            # Also register under the spriteKey so entity lookups work
            sprite_key = portrait_to_sprite_key.get(portrait_key)
            if sprite_key:
                manifest["portraits"][sprite_key] = path
            deployed += 1
            print(f"  Portrait: {png.name} -> {portrait_key}"
                  + (f" (also {sprite_key})" if sprite_key else ""))

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
    weapon_count = sum(
        sum(len(dirs) for dirs in anims.values())
        for anims in manifest.get("weapons", {}).values()
    )
    other_count = sum(
        len(v) for k, v in manifest.items() if k not in ("sprites", "animations", "weapons")
    )
    total = sprite_count + anim_count + weapon_count + other_count
    print(f"\n=== Deployed {total} assets ===")
    if anim_count > 0:
        print(f"  Character animation frames: {anim_count}")
    if weapon_count > 0:
        print(f"  Weapon overlay frames: {weapon_count}")
    print("The game will automatically load these on next refresh.")


if __name__ == "__main__":
    main()
