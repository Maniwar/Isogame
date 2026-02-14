#!/usr/bin/env python3
"""
Isogame Asset Generator — Gemini API batch image generation pipeline.

Generates Fallout 2-style isometric game assets using Google's Gemini
image generation model. Reads batch definitions from config.yaml and
produces organized asset files in output/.

Usage:
    # Generate all asset types
    python generate.py

    # Generate specific category
    python generate.py --category tiles
    python generate.py --category characters
    python generate.py --category items
    python generate.py --category portraits

    # Dry run — print prompts without calling the API
    python generate.py --dry-run

    # Use reference images for style consistency
    python generate.py --reference-dir ./references

Environment:
    GEMINI_API_KEY  — Your Google AI Studio API key (required)
"""

import argparse
import io
import os
import sys
import time
from pathlib import Path

import yaml

try:
    from google import genai
    from google.genai import types
except ImportError:
    print("ERROR: google-genai package not installed.")
    print("Run: pip install google-genai")
    sys.exit(1)

try:
    from PIL import Image
except ImportError:
    print("ERROR: Pillow package not installed.")
    print("Run: pip install Pillow")
    sys.exit(1)

from prompts.tiles import (
    build_ground_prompt,
    build_wall_prompt,
    build_terrain_prompt,
    build_tileset_prompt,
    build_itemset_prompt,
    build_terrain_variant_sheet_prompt,
    build_water_animation_sheet_prompt,
    build_terrain_texture_prompt,
    build_water_texture_prompt,
    TERRAIN_ARCHETYPES,
    WATER_ARCHETYPE,
)
from prompts.characters import (
    build_character_prompt,
    build_spritesheet_prompt,
    CHARACTER_ARCHETYPES,
    DIRECTIONS,
)
from prompts.weapons import (
    build_weapon_spritesheet_prompt,
    WEAPON_ARCHETYPES,
)
from prompts.items import build_item_prompt, ITEM_CATALOG
from prompts.portraits import build_portrait_prompt, NPC_PORTRAITS

SCRIPT_DIR = Path(__file__).parent
CONFIG_PATH = SCRIPT_DIR / "config.yaml"
OUTPUT_DIR = SCRIPT_DIR / "output"


def load_config() -> dict:
    """Load pipeline configuration from config.yaml."""
    with open(CONFIG_PATH) as f:
        return yaml.safe_load(f)


def create_client(api_key: str) -> genai.Client:
    """Create and return a Gemini API client."""
    return genai.Client(api_key=api_key)


def generate_image(
    client: genai.Client,
    prompt: str,
    model: str,
    reference_images: list | None = None,
    image_size: str | None = None,
) -> Image.Image | None:
    """
    Call Gemini to generate a single image from a text prompt.

    Args:
        client: Gemini API client.
        prompt: The text prompt describing the image.
        model: Model name to use.
        reference_images: Optional list of PIL Images to use as style references.
        image_size: Output resolution tier — "1K", "2K", or "4K".
                    Supported by gemini-3-pro-image-preview and imagen-4.
                    If None, the model uses its default (typically 1K).

    Returns:
        A PIL Image on success, or None on failure.
    """
    contents = []

    # Add reference images if provided (for style consistency)
    if reference_images:
        contents.append("Use these reference images as a style guide. "
                        "Match their art style, color palette, and level of detail:")
        for ref_img in reference_images:
            contents.append(ref_img)
        contents.append("Now generate the following new asset in the same style:")

    contents.append(prompt)

    config = load_config()
    retry_attempts = config.get("api", {}).get("retry_attempts", 3)
    retry_delay = config.get("api", {}).get("retry_delay_seconds", 5)

    # Build image config with resolution tier if specified
    image_config = None
    if image_size:
        image_config = types.ImageConfig(
            image_size=image_size,
        )

    for attempt in range(1, retry_attempts + 1):
        try:
            gen_config = types.GenerateContentConfig(
                response_modalities=["IMAGE"],
            )
            if image_config:
                gen_config.image_config = image_config

            response = client.models.generate_content(
                model=model,
                contents=contents,
                config=gen_config,
            )

            # Extract image from response parts
            if response.candidates:
                for part in response.candidates[0].content.parts:
                    if part.inline_data and part.inline_data.mime_type.startswith("image/"):
                        return Image.open(io.BytesIO(part.inline_data.data))

            # Check for blocked content
            if response.candidates and response.candidates[0].finish_reason:
                reason = response.candidates[0].finish_reason
                print(f"  WARNING: No image — finish_reason={reason}")
            else:
                print("  WARNING: No image in response (no candidates)")

            if attempt < retry_attempts:
                print(f"  Retrying ({attempt}/{retry_attempts}) in {retry_delay}s...")
                time.sleep(retry_delay)
                continue
            return None

        except Exception as e:
            print(f"  ERROR (attempt {attempt}/{retry_attempts}): {e}")
            if attempt < retry_attempts:
                print(f"  Retrying in {retry_delay}s...")
                time.sleep(retry_delay)
            else:
                return None

    return None


def save_image(image: Image.Image, output_path: Path) -> None:
    """Save a PIL Image to disk."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path, "PNG")
    print(f"  Saved: {output_path}")


def load_reference_images(reference_dir: Path | None) -> list:
    """Load reference images from a directory for style consistency."""
    if not reference_dir or not reference_dir.exists():
        return []

    refs = []
    for ext in ("*.png", "*.jpg", "*.jpeg"):
        for path in sorted(reference_dir.glob(ext)):
            try:
                img = Image.open(path)
                refs.append(img)
                print(f"  Loaded reference: {path.name}")
            except Exception as e:
                print(f"  WARNING: Could not load reference {path}: {e}")

    # Gemini supports up to 14 reference images
    if len(refs) > 14:
        print(f"  NOTE: Limiting to 14 reference images (found {len(refs)})")
        refs = refs[:14]

    return refs


def rate_limit(rpm: int) -> None:
    """Sleep to respect the configured requests-per-minute limit."""
    delay = 60.0 / rpm
    time.sleep(delay)


# ---------------------------------------------------------------------------
# Category generators
# ---------------------------------------------------------------------------

def generate_tiles(client: genai.Client, config: dict, dry_run: bool,
                   reference_images: list) -> int:
    """Generate all tile batches defined in config."""
    model = config["api"]["model"]
    rpm = config["api"]["requests_per_minute"]
    generated = 0

    for batch_name in ("ground_tiles", "wall_tiles", "terrain_tiles"):
        batch = config["batches"].get(batch_name)
        if not batch:
            continue

        category = batch["category"]
        print(f"\n--- Generating {batch_name} ({batch['count']} tiles) ---")

        for variant in batch["variants"]:
            for i in range(1, variant["count"] + 1):
                filename = f"{variant['name']}-{i:02d}.png"
                output_path = OUTPUT_DIR / category / filename

                # Choose the right prompt builder
                if "ground" in batch_name:
                    prompt = build_ground_prompt(variant["description"], i, config)
                elif "wall" in batch_name:
                    prompt = build_wall_prompt(variant["description"], i, config)
                else:
                    prompt = build_terrain_prompt(variant["description"], i, config)

                if dry_run:
                    print(f"  [DRY RUN] {filename}")
                    print(f"    Prompt: {prompt[:120]}...")
                    generated += 1
                    continue

                print(f"  Generating: {filename}")
                image = generate_image(client, prompt, model, reference_images)
                if image:
                    save_image(image, output_path)
                    generated += 1
                rate_limit(rpm)

    return generated


def generate_tile_sheets(client: genai.Client, config: dict, dry_run: bool,
                         reference_images: list) -> int:
    """Generate terrain variant sheets — 4 variants per terrain in a 2×2 grid.

    Each terrain type produces a single 1024×1024 image containing 4 isometric
    diamond tile variants.  Water gets a special animation sheet with 4 frames.
    Uses image_size="1K" for 1024×1024 output.
    """
    model = config["api"]["model"]
    rpm = config["api"]["requests_per_minute"]
    generated = 0

    sheets_dir = OUTPUT_DIR / "tiles" / "sheets"

    print(f"\n--- Generating terrain variant sheets ({len(TERRAIN_ARCHETYPES)} terrain + water) ---")

    # Generate each terrain type's 4-variant sheet
    for archetype in TERRAIN_ARCHETYPES:
        key = archetype["key"]
        filename = f"{key}-sheet.png"
        output_path = sheets_dir / filename

        prompt = build_terrain_variant_sheet_prompt(archetype, config)

        if dry_run:
            print(f"  [DRY RUN] {filename} (4 variants, 1024×1024, image_size=1K)")
            print(f"    Prompt: {prompt[:200]}...")
            generated += 1
            continue

        print(f"  Generating: {filename} (4 variants of {archetype['terrain_name']})")
        image = generate_image(client, prompt, model, reference_images, image_size="1K")
        if image:
            save_image(image, output_path)
            generated += 1
        rate_limit(rpm)

    # Generate animated water sheet (4 animation frames)
    water_filename = "water-sheet.png"
    water_path = sheets_dir / water_filename
    water_prompt = build_water_animation_sheet_prompt(config)

    if dry_run:
        print(f"  [DRY RUN] {water_filename} (4 anim frames, 1024×1024, image_size=1K)")
        print(f"    Prompt: {water_prompt[:200]}...")
        generated += 1
    else:
        print(f"  Generating: {water_filename} (4 animation frames)")
        image = generate_image(client, water_prompt, model, reference_images, image_size="1K")
        if image:
            save_image(image, water_path)
            generated += 1
        rate_limit(rpm)

    return generated


def generate_terrain_textures(client: genai.Client, config: dict, dry_run: bool,
                              reference_images: list) -> int:
    """Generate seamless rectangular terrain textures (preferred format).

    Each terrain type produces a single 1024×1024 seamless tileable texture.
    These are full rectangular images — no diamond shapes, no transparency.
    The game engine uses them as repeating CanvasPattern fills clipped to
    isometric diamonds at render time, creating a cohesive landscape.

    Water produces a 2×2 grid of 4 animation frames (same sheet layout
    as tile_sheets, but rectangular fills instead of diamonds).
    """
    model = config["api"]["model"]
    rpm = config["api"]["requests_per_minute"]
    generated = 0

    textures_dir = OUTPUT_DIR / "tiles" / "textures"

    print(f"\n--- Generating terrain textures ({len(TERRAIN_ARCHETYPES)} terrain + water) ---")

    for archetype in TERRAIN_ARCHETYPES:
        key = archetype["key"]
        filename = f"{key}-texture.png"
        output_path = textures_dir / filename

        prompt = build_terrain_texture_prompt(archetype, config)

        if dry_run:
            print(f"  [DRY RUN] {filename} (1024×1024, seamless texture)")
            print(f"    Prompt: {prompt[:200]}...")
            generated += 1
            continue

        print(f"  Generating: {filename} ({archetype['terrain_name']})")
        image = generate_image(client, prompt, model, reference_images, image_size="1K")
        if image:
            save_image(image, output_path)
            generated += 1
        rate_limit(rpm)

    # Generate animated water texture (4 frames in 2×2 grid)
    water_filename = "water-texture.png"
    water_path = textures_dir / water_filename
    water_prompt = build_water_texture_prompt(config)

    if dry_run:
        print(f"  [DRY RUN] {water_filename} (1024×1024, 4 frames)")
        print(f"    Prompt: {water_prompt[:200]}...")
        generated += 1
    else:
        print(f"  Generating: {water_filename} (4 animation frames)")
        image = generate_image(client, water_prompt, model, reference_images, image_size="1K")
        if image:
            save_image(image, water_path)
            generated += 1
        rate_limit(rpm)

    return generated


def generate_characters(client: genai.Client, config: dict, dry_run: bool,
                        reference_images: list, use_sheets: bool = True) -> int:
    """Generate character sprites — either as full sprite sheets or individual images.

    When use_sheets=True (default), generates one 8×8 sprite sheet per character:
    8 animation rows × 8 direction columns = 64 frames per sheet.
    Uses gemini-3-pro-image-preview at 2K (2048×2048) for 256×256 per cell.

    For characters with multiple weapon variants (e.g., player_pistol, player_rifle),
    the first variant's sheet is passed as a reference image to subsequent variants
    to maintain visual consistency (same face, outfit, proportions).
    """
    model = config["api"]["model"]
    rpm = config["api"]["requests_per_minute"]
    image_size = config["sprites"].get("image_size")
    generated = 0

    # Track generated sheets per base character for cross-referencing
    base_reference_sheets: dict[str, Image.Image] = {}

    print(f"\n--- Generating character sprites ({'sheet mode' if use_sheets else 'individual mode'}) ---")

    for char in CHARACTER_ARCHETYPES:
        sprite_key = char.get("sprite_key", char["name"].lower().replace(" ", "-"))
        base_key = char.get("base_key", sprite_key)
        char_dir = OUTPUT_DIR / "sprites" / sprite_key
        print(f"\n  Character: {char['name']} (sprite_key: {sprite_key}, base: {base_key})")

        if use_sheets:
            # Generate full sprite sheet (all anims + directions in one image)
            filename = f"{sprite_key}-sheet.png"
            output_path = char_dir / filename

            prompt = build_spritesheet_prompt(
                name=char["name"],
                description=char["description"],
                config=config,
                weapon_idle_desc=char.get("weapon_idle_desc", "weapon held at side, relaxed"),
                weapon_attack_desc=char.get("weapon_attack_desc", "weapon swung or fired forward"),
            )

            sheet_size = config["sprites"].get("sheet_size", 2048)
            n_cols = config["sprites"].get("sheet_cols", 8)
            n_rows = config["sprites"].get("sheet_rows", 8)

            if dry_run:
                print(f"    [DRY RUN] {filename} ({n_rows} anims x {n_cols} dirs = {n_rows*n_cols} frames, {sheet_size}×{sheet_size}px, image_size={image_size})")
                if base_key in base_reference_sheets:
                    print(f"    + using {base_key} reference sheet for consistency")
                print(f"    Prompt: {prompt[:200]}...")
                generated += 1
                continue

            # Build references: global refs + base character sheet (if we have one)
            char_refs = list(reference_images)
            if base_key in base_reference_sheets:
                print(f"    + using {base_key} reference sheet for character consistency")
                char_refs.append(base_reference_sheets[base_key])

            print(f"    Generating sprite sheet: {filename} ({sheet_size}×{sheet_size}px)")
            image = generate_image(client, prompt, model, char_refs if char_refs else None, image_size=image_size)
            if image:
                save_image(image, output_path)
                generated += 1
                # Store first generated sheet as reference for this base character
                if base_key not in base_reference_sheets:
                    base_reference_sheets[base_key] = image
            rate_limit(rpm)
        else:
            # Legacy: generate each direction separately (idle only)
            for direction in DIRECTIONS:
                filename = f"{sprite_key}-{direction.lower()}.png"
                output_path = char_dir / filename

                prompt = build_character_prompt(
                    name=char["name"],
                    description=char["description"],
                    pose=char["pose"],
                    direction=direction,
                    config=config,
                )

                if dry_run:
                    print(f"    [DRY RUN] {filename}")
                    generated += 1
                    continue

                print(f"    Generating: {filename} ({direction})")
                image = generate_image(client, prompt, model, reference_images)
                if image:
                    save_image(image, output_path)
                    generated += 1
                rate_limit(rpm)

    return generated


def generate_weapons(client: genai.Client, config: dict, dry_run: bool,
                     reference_images: list) -> int:
    """Generate weapon overlay sprite sheets.

    Each weapon gets an 8×8 sprite sheet (2048×2048, 256×256 per cell)
    showing only the weapon + hands, designed to overlay on character sprites.

    NOTE: Weapon overlays are currently unused — the game uses weapon-variant
    character sprites instead. Kept for potential future use.
    """
    model = config["api"]["model"]
    rpm = config["api"]["requests_per_minute"]
    image_size = config["sprites"].get("image_size")
    generated = 0

    sheet_size = config["sprites"].get("sheet_size", 2048)
    n_cols = config["sprites"].get("sheet_cols", 8)
    n_rows = config["sprites"].get("sheet_rows", 8)

    print(f"\n--- Generating weapon overlay sprites ({len(WEAPON_ARCHETYPES)} weapons) ---")

    for weapon in WEAPON_ARCHETYPES:
        sprite_key = weapon["sprite_key"]
        weapon_dir = OUTPUT_DIR / "weapons" / sprite_key
        print(f"\n  Weapon: {weapon['name']} (sprite_key: {sprite_key})")

        filename = f"{sprite_key}-sheet.png"
        output_path = weapon_dir / filename

        prompt = build_weapon_spritesheet_prompt(
            name=weapon["name"],
            description=weapon["description"],
            attack_desc=weapon["attack_desc"],
            config=config,
            idle_desc=weapon.get("idle_desc", "weapon held at rest, relaxed grip"),
        )

        if dry_run:
            print(f"    [DRY RUN] {filename} ({n_rows} anims x {n_cols} dirs = {n_rows*n_cols} frames, {sheet_size}×{sheet_size}px, image_size={image_size})")
            print(f"    Prompt: {prompt[:200]}...")
            generated += 1
            continue

        print(f"    Generating weapon sheet: {filename} ({sheet_size}×{sheet_size}px)")
        image = generate_image(client, prompt, model, reference_images, image_size=image_size)
        if image:
            save_image(image, output_path)
            generated += 1
        rate_limit(rpm)

    return generated


def generate_items(client: genai.Client, config: dict, dry_run: bool,
                   reference_images: list) -> int:
    """Generate inventory item icons."""
    model = config["api"]["model"]
    rpm = config["api"]["requests_per_minute"]
    generated = 0

    print(f"\n--- Generating item icons ({len(ITEM_CATALOG)} items) ---")

    for item in ITEM_CATALOG:
        cat_dir = OUTPUT_DIR / "items" / item["category"]
        icon_key = item.get("icon_key", item["name"].lower().replace(" ", "-"))
        filename = f"{icon_key}.png"
        output_path = cat_dir / filename

        prompt = build_item_prompt(item["name"], item["description"], config)

        if dry_run:
            print(f"  [DRY RUN] {filename}")
            generated += 1
            continue

        print(f"  Generating: {filename}")
        image = generate_image(client, prompt, model, reference_images)
        if image:
            save_image(image, output_path)
            generated += 1
        rate_limit(rpm)

    return generated


def generate_portraits(client: genai.Client, config: dict, dry_run: bool,
                       reference_images: list) -> int:
    """Generate NPC dialogue portraits."""
    model = config["api"]["model"]
    rpm = config["api"]["requests_per_minute"]
    generated = 0

    print(f"\n--- Generating NPC portraits ({len(NPC_PORTRAITS)} portraits) ---")

    for npc in NPC_PORTRAITS:
        filename = f"{npc['name'].lower().replace(' ', '-')}.png"
        output_path = OUTPUT_DIR / "portraits" / filename

        prompt = build_portrait_prompt(
            name=npc["name"],
            description=npc["description"],
            expression=npc["expression"],
            config=config,
        )

        if dry_run:
            print(f"  [DRY RUN] {filename}")
            generated += 1
            continue

        print(f"  Generating: {filename}")
        image = generate_image(client, prompt, model, reference_images)
        if image:
            save_image(image, output_path)
            generated += 1
        rate_limit(rpm)

    return generated


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

# Categories available for generation.
# NOTE: "weapons" is kept for backwards compatibility but is deprecated.
# Weapons are now generated as part of character sprite sheets (weapon variants).
CATEGORY_MAP = {
    "tiles": generate_tiles,
    "tile_sheets": generate_tile_sheets,
    "terrain_textures": generate_terrain_textures,
    "characters": generate_characters,
    "weapons": generate_weapons,
    "items": generate_items,
    "portraits": generate_portraits,
}

# Default categories when --category=all
# terrain_textures is preferred over tile_sheets for terrain generation
DEFAULT_CATEGORIES = ["terrain_textures", "characters", "items", "portraits"]


def main():
    parser = argparse.ArgumentParser(
        description="Generate Fallout 2-style isometric game assets via Gemini API."
    )
    parser.add_argument(
        "--category",
        choices=list(CATEGORY_MAP.keys()) + ["all"],
        default="all",
        help="Asset category to generate (default: all)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print prompts without calling the API",
    )
    parser.add_argument(
        "--reference-dir",
        type=Path,
        default=None,
        help="Directory containing reference images for style consistency",
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=None,
        help="Path to config.yaml (default: same directory as this script)",
    )
    parser.add_argument(
        "--no-sheets",
        action="store_true",
        help="Generate individual sprites instead of sprite sheets (legacy mode)",
    )
    args = parser.parse_args()

    # Load config
    global CONFIG_PATH
    if args.config:
        CONFIG_PATH = args.config
    config = load_config()

    # Load .env file (project root or scripts/asset-gen/)
    for env_path in (SCRIPT_DIR / ".env", SCRIPT_DIR.parent.parent / ".env"):
        if env_path.exists():
            with open(env_path) as ef:
                for line in ef:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        key, _, val = line.partition("=")
                        val = val.strip().strip("'\"")
                        os.environ.setdefault(key.strip(), val)
            break

    # Check API key
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key and not args.dry_run:
        print("ERROR: GEMINI_API_KEY not found.")
        print("Set it in .env (project root or scripts/asset-gen/) or as env var:")
        print("  echo 'GEMINI_API_KEY=your-key' > .env")
        print("  — or —")
        print("  export GEMINI_API_KEY=your-key")
        print("\nGet your key at https://aistudio.google.com/apikey")
        sys.exit(1)

    # Create output directory
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Load reference images
    reference_images = load_reference_images(args.reference_dir)
    if reference_images:
        print(f"Using {len(reference_images)} reference image(s) for style consistency\n")

    # Create client (None for dry runs)
    client = create_client(api_key) if not args.dry_run else None

    # Run generation
    total = 0
    categories = DEFAULT_CATEGORIES if args.category == "all" else [args.category]

    print(f"=== Isogame Asset Generator ===")
    print(f"Model: {config['api']['model']}")
    print(f"Categories: {', '.join(categories)}")
    print(f"Dry run: {args.dry_run}")
    print(f"Output: {OUTPUT_DIR}")

    for cat in categories:
        if cat == "characters":
            count = generate_characters(
                client, config, args.dry_run, reference_images,
                use_sheets=not args.no_sheets,
            )
        else:
            count = CATEGORY_MAP[cat](client, config, args.dry_run, reference_images)
        total += count

    # Check output directory for actual files
    png_count = len(list(OUTPUT_DIR.rglob("*.png")))
    print(f"\n=== Done! Generated {total} assets ({png_count} PNG files on disk) ===")
    if total == 0 and not args.dry_run:
        print("WARNING: No assets were generated!")
        print("Check your API key and model access above for errors.")
        sys.exit(1)


if __name__ == "__main__":
    main()
