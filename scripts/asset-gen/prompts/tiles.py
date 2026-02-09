"""Prompt templates for isometric tile generation.

Supports both individual tile generation and tile-set sheet generation
(multiple variants in a single image for consistency).
"""

# Base style preamble injected into every tile prompt
TILE_STYLE_PREAMBLE = (
    "Create a single isometric tile in the style of classic Fallout 2. "
    "The tile should be viewed from a top-down 3/4 isometric perspective. "
    "Use a muted, desaturated post-apocalyptic color palette with earthy browns, "
    "rust oranges, dusty yellows, and faded greens. "
    "The art style should be detailed pixel art with a gritty, weathered feel. "
    "The tile must be a perfect isometric diamond shape on a transparent background. "
)

GROUND_TILE_TEMPLATE = (
    "{preamble}"
    "This is a GROUND tile ({width}x{height} pixels, isometric diamond). "
    "Subject: {description}. "
    "The tile should seamlessly connect with other ground tiles. "
    "Keep the perspective consistent — flat ground viewed from above at roughly 30 degrees. "
    "Variation #{variant_num} of this terrain type — make it visually distinct from other "
    "variants while maintaining the same material and mood. "
    "No text, no labels, no watermarks."
)

WALL_TILE_TEMPLATE = (
    "{preamble}"
    "This is a WALL tile ({width}x{wall_height} pixels). "
    "The wall rises vertically from an isometric ground plane. "
    "Subject: {description}. "
    "Show the wall from the standard isometric 3/4 view with visible front and top faces. "
    "The wall should look weathered and post-apocalyptic — damaged, patched, or deteriorating. "
    "Variation #{variant_num} — visually distinct but same material. "
    "Transparent background. No text, no labels, no watermarks."
)

TERRAIN_FEATURE_TEMPLATE = (
    "{preamble}"
    "This is a TERRAIN FEATURE tile ({width}x{height} pixels, isometric). "
    "Subject: {description}. "
    "This is an object or feature placed on top of ground tiles. "
    "It should have a transparent background so it can be composited over ground tiles. "
    "Maintain consistent isometric perspective and post-apocalyptic styling. "
    "Variation #{variant_num}. "
    "No text, no labels, no watermarks."
)

# --- Tile Set Sheet (all variants in one image) ---

TILE_SET_PREAMBLE = (
    "Create an isometric TILE SET in the style of classic Fallout 2. "
    "Use a muted, desaturated post-apocalyptic color palette with earthy browns, "
    "rust oranges, dusty yellows, and faded greens. "
    "Detailed pixel art with a gritty, weathered feel. "
    "Each tile is a perfect isometric diamond on a transparent background. "
)

TILE_SET_TEMPLATE = (
    "{preamble}"
    "Generate a TILE SET SHEET with {count} tile variants in a single row.\n\n"
    "LAYOUT: {count} tiles arranged horizontally, each {width}x{height} pixels.\n"
    "Total image size: {sheet_w}x{height} pixels.\n\n"
    "Subject: {description}.\n"
    "Each variant should be visually distinct but clearly the same terrain type.\n"
    "Variations can include different crack patterns, debris placement, color shifts, etc.\n\n"
    "Tiles from left to right:\n{variant_list}\n\n"
    "RULES:\n"
    "- Every tile must be an isometric diamond shape\n"
    "- Transparent background around each diamond\n"
    "- Consistent perspective (top-down 3/4 view)\n"
    "- Tiles should seamlessly connect when placed adjacent to each other\n"
    "- No text, no labels, no watermarks, no grid lines\n"
)

ITEM_SET_TEMPLATE = (
    "Create an INVENTORY ICON SHEET in the style of classic Fallout 2.\n"
    "Use a muted post-apocalyptic color palette. Detailed pixel art.\n\n"
    "LAYOUT: {count} item icons in a single row.\n"
    "Each icon is {size}x{size} pixels.\n"
    "Total image size: {sheet_w}x{size} pixels.\n\n"
    "Items from left to right:\n{item_list}\n\n"
    "RULES:\n"
    "- Each item centered in its {size}x{size} cell\n"
    "- Transparent background\n"
    "- Items look worn, used, and weathered\n"
    "- No text, no labels, no watermarks\n"
)


def build_ground_prompt(description: str, variant_num: int, config: dict) -> str:
    """Build a prompt for generating an isometric ground tile."""
    return GROUND_TILE_TEMPLATE.format(
        preamble=TILE_STYLE_PREAMBLE,
        width=config["tiles"]["base_width"],
        height=config["tiles"]["base_height"],
        description=description,
        variant_num=variant_num,
    )


def build_wall_prompt(description: str, variant_num: int, config: dict) -> str:
    """Build a prompt for generating an isometric wall tile."""
    return WALL_TILE_TEMPLATE.format(
        preamble=TILE_STYLE_PREAMBLE,
        width=config["tiles"]["base_width"],
        wall_height=config["tiles"]["wall_height"],
        description=description,
        variant_num=variant_num,
    )


def build_terrain_prompt(description: str, variant_num: int, config: dict) -> str:
    """Build a prompt for generating an isometric terrain feature."""
    return TERRAIN_FEATURE_TEMPLATE.format(
        preamble=TILE_STYLE_PREAMBLE,
        width=config["tiles"]["base_width"],
        height=config["tiles"]["base_height"],
        description=description,
        variant_num=variant_num,
    )


def build_tileset_prompt(
    description: str,
    count: int,
    config: dict,
    variant_descriptions: list[str] | None = None,
) -> str:
    """Build a prompt for generating a tile set sheet (all variants in one image).

    Args:
        description: Base terrain description.
        count: Number of tile variants.
        config: Config dict.
        variant_descriptions: Optional per-variant descriptions. If None,
            generates generic "Variant N" descriptions.
    """
    width = config["tiles"]["base_width"]
    height = config["tiles"]["base_height"]

    if variant_descriptions:
        variant_list = "\n".join(
            f"  {i + 1}. {desc}" for i, desc in enumerate(variant_descriptions)
        )
    else:
        variant_list = "\n".join(
            f"  {i + 1}. Variation {i + 1} of {description}"
            for i in range(count)
        )

    return TILE_SET_TEMPLATE.format(
        preamble=TILE_SET_PREAMBLE,
        count=count,
        width=width,
        height=height,
        sheet_w=width * count,
        description=description,
        variant_list=variant_list,
    )


def build_itemset_prompt(
    items: list[dict],
    config: dict,
) -> str:
    """Build a prompt for generating an item icon sheet (all items in one image).

    Args:
        items: List of item dicts with "name" and "description" keys.
        config: Config dict.
    """
    size = config["items"]["icon_size"]

    item_list = "\n".join(
        f"  {i + 1}. {item['name']} — {item['description']}"
        for i, item in enumerate(items)
    )

    return ITEM_SET_TEMPLATE.format(
        count=len(items),
        size=size,
        sheet_w=size * len(items),
        item_list=item_list,
    )
