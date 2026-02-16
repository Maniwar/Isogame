"""Prompt templates for isometric tile generation.

Supports multiple modes:
1. **Terrain texture generation (preferred)** — generates large seamless
   rectangular terrain textures. The game engine clips these to diamond
   shapes at render time using CanvasPattern fill, so adjacent tiles share
   the same continuous surface. No diamond shapes in the assets.
2. Terrain variant sheet generation (legacy) — 2×2 grid of diamond tiles
3. Individual tile generation (legacy)
4. Tile-set sheet generation (legacy)

For water, generates 4 animation frames as seamless rectangular textures,
enabling animated water tiles at runtime.
"""

# Base style preamble injected into every tile prompt
TILE_STYLE_PREAMBLE = (
    "Create a single isometric tile in the style of Fallout 2 (1998, Black Isle Studios). "
    "Top-down 3/4 isometric perspective. "
    "Desaturated post-nuclear color palette: dusty browns, rust oranges, "
    "weathered tan, faded olive, muted gray. NO bright or saturated colors. "
    "Art style: detailed pre-rendered 3D look with visible grit and texture — "
    "like original Fallout 2 tiles. NOT flat cartoon or pixel art. "
    "NO dark outlines or borders around the tile edges. "
    "The tile must be a perfect isometric diamond shape on a pure bright GREEN "
    "(#00FF00) chroma key background. Fill ALL space outside the diamond with "
    "solid RGB(0,255,0) green. DO NOT use transparent, checkered, gray, or white backgrounds. "
    "Tile edges should have a soft 1-2 pixel anti-aliased blend into the green. "
)

GROUND_TILE_TEMPLATE = (
    "{preamble}"
    "This is a GROUND tile ({width}x{height} pixels, isometric diamond). "
    "Subject: {description}. "
    "SEAMLESS EDGES ARE CRITICAL: The diamond edges must use soft, neutral tones "
    "(muted brown/tan) that blend naturally with ANY adjacent terrain type. "
    "Concentrate texture detail in the CENTER of the diamond. "
    "The outer 20% of each edge should FADE to a uniform neutral earth tone "
    "so tiles transition smoothly into neighbors without hard color boundaries. "
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
    "Pure bright GREEN (#00FF00) chroma key background. No text, no labels, no watermarks."
)

TERRAIN_FEATURE_TEMPLATE = (
    "{preamble}"
    "This is a TERRAIN FEATURE tile ({width}x{height} pixels, isometric). "
    "Subject: {description}. "
    "This is an object or feature placed on top of ground tiles. "
    "Pure bright GREEN (#00FF00) chroma key background — software will replace it "
    "with transparency for compositing over ground tiles. "
    "Maintain consistent isometric perspective and post-apocalyptic styling. "
    "Variation #{variant_num}. "
    "No text, no labels, no watermarks."
)

# ---------------------------------------------------------------------------
# Terrain Texture — seamless rectangular textures (preferred format)
#
# These are large, fully-opaque rectangular terrain surface images.
# The game engine uses them as repeating CanvasPattern fills clipped
# to isometric diamond shapes at render time. Because the pattern is
# continuous across world space, adjacent tiles show adjacent parts of
# the same texture — creating a cohesive landscape with no seams.
# ---------------------------------------------------------------------------

TERRAIN_TEXTURE_PREAMBLE = (
    "Create a SEAMLESS TILEABLE terrain texture in the style of Fallout 2 "
    "(1998, Black Isle Studios). "
    "Viewed from a top-down 3/4 isometric perspective (~30 degrees). "
    "Color palette: desaturated earth tones — dusty browns, rust oranges, "
    "weathered tan, faded olive, muted gray. NO bright or saturated colors. "
    "The ground looks sun-baked, irradiated, and neglected for decades. "
    "Art style: pre-rendered 3D look with visible grit and texture detail, "
    "like the original Fallout 2 terrain tiles. NOT flat or cartoon-like. "
    "Think: nuclear wasteland California desert, 80 years after the bombs fell. "
)

TERRAIN_TEXTURE_TEMPLATE = (
    "{preamble}"
    "Generate a SEAMLESS TILEABLE terrain texture.\n\n"
    "TERRAIN TYPE: {terrain_name} — {description}\n\n"
    "IMAGE SIZE: 1024 × 1024 pixels.\n\n"
    "The ENTIRE image must be filled with terrain surface — NO diamonds, "
    "NO transparent areas, NO green backgrounds. This is a flat rectangular "
    "texture that will be used as a repeating tile pattern.\n\n"
    "CRITICAL RULES:\n"
    "- SEAMLESS TILING: the left edge must match the right edge perfectly,\n"
    "  and the top edge must match the bottom edge perfectly, so the texture\n"
    "  can repeat infinitely without visible seams.\n"
    "- Fill the ENTIRE 1024×1024 area with terrain surface detail.\n"
    "- NO diamond shapes, NO transparent background, NO green background.\n"
    "- Consistent isometric 3/4 perspective across the entire texture.\n"
    "- Natural-looking variation: {detail_notes}\n"
    "- The texture should look like a continuous patch of ground surface,\n"
    "  as if you cut a window into a larger landscape.\n"
    "- NO text, NO labels, NO watermarks, NO borders.\n"
)

WATER_TEXTURE_TEMPLATE = (
    "{preamble}"
    "Generate 4 SEAMLESS TILEABLE water animation frames.\n\n"
    "WATER STYLE: {description}\n\n"
    "IMAGE SIZE: 1024 × 1024 pixels.\n"
    "GRID: 2 columns × 2 rows = 4 cells, each 512 × 512 pixels.\n\n"
    "Each cell is a rectangular water surface texture (NOT a diamond).\n"
    "The 4 frames show a LOOPING water animation sequence:\n"
    "  Frame 1 (top-left): Calm water, subtle small ripples beginning\n"
    "  Frame 2 (top-right): Ripples spreading, gentle wave movement\n"
    "  Frame 3 (bottom-left): Waves at peak, surface most disturbed\n"
    "  Frame 4 (bottom-right): Waves receding, settling back to calm\n\n"
    "CRITICAL RULES:\n"
    "- Each frame FILLS its entire 512×512 cell — NO diamonds, NO transparency\n"
    "- Each frame must be SEAMLESSLY TILEABLE (edges match when repeated)\n"
    "- SAME water color and style in all 4 frames — only ripple pattern changes\n"
    "- Changes between frames should be SUBTLE but VISIBLE for smooth animation\n"
    "- The animation must LOOP: frame 4 transitions smoothly back to frame 1\n"
    "- NO text, NO labels, NO watermarks\n"
)


def build_terrain_texture_prompt(archetype: dict, config: dict) -> str:
    """Build a prompt for generating a seamless rectangular terrain texture.

    This is the preferred generation mode. The texture is a large, fully-opaque
    rectangular image that tiles seamlessly. The game engine clips it to
    isometric diamonds at render time.
    """
    return TERRAIN_TEXTURE_TEMPLATE.format(
        preamble=TERRAIN_TEXTURE_PREAMBLE,
        terrain_name=archetype["terrain_name"],
        description=archetype["description"],
        detail_notes=archetype.get("texture_notes", archetype["variants"][0]),
    )


def build_water_texture_prompt(config: dict) -> str:
    """Build a prompt for generating seamless rectangular water animation frames.

    The 4 cells are animation frames. Each is a seamlessly tileable rectangular
    water surface (not a diamond).
    """
    return WATER_TEXTURE_TEMPLATE.format(
        preamble=TERRAIN_TEXTURE_PREAMBLE,
        description=WATER_ARCHETYPE["description"],
    )


# ---------------------------------------------------------------------------
# Legacy: Terrain Variant Sheet — 4 variants per terrain in a 2×2 grid (1024×1024)
# ---------------------------------------------------------------------------

TERRAIN_VARIANT_SHEET_PREAMBLE = (
    "Create an isometric TERRAIN VARIANT SHEET in the style of Fallout 2 "
    "(1998, Black Isle Studios). Top-down 3/4 isometric perspective. "
    "Muted, desaturated post-apocalyptic color palette: earthy browns, "
    "rust oranges, dusty yellows, faded greens. "
    "Art style: detailed pre-rendered 3D look with gritty, weathered texture — "
    "NOT flat cartoon or pixel art. NO dark outlines on tile edges. "
)

TERRAIN_VARIANT_SHEET_TEMPLATE = (
    "{preamble}"
    "Generate a TERRAIN VARIANT SHEET with 4 isometric tile variants.\n\n"
    "TERRAIN TYPE: {terrain_name} — {description}\n\n"
    "IMAGE SIZE: 1024 × 1024 pixels.\n"
    "GRID: 2 columns × 2 rows = 4 cells, each 512 × 512 pixels.\n\n"
    "Each cell contains ONE isometric diamond tile:\n"
    "- The diamond shape is approximately 512 wide × 256 tall (2:1 ratio)\n"
    "- Centered within its 512×512 cell\n"
    "- Pure GREEN (#00FF00) background behind and around each diamond\n\n"
    "All 4 tiles are the SAME terrain type but with DIFFERENT visual details:\n"
    "  Cell 1 (top-left): {v1}\n"
    "  Cell 2 (top-right): {v2}\n"
    "  Cell 3 (bottom-left): {v3}\n"
    "  Cell 4 (bottom-right): {v4}\n\n"
    "CRITICAL RULES:\n"
    "- Each tile is a perfect isometric DIAMOND (2:1 width-to-height ratio)\n"
    "- Same color palette and base material across all 4 tiles\n"
    "- DIFFERENT details: crack patterns, debris, texture, slight color shifts\n"
    "- SEAMLESS EDGES: The outer 20%% of each diamond edge MUST fade to a soft,\n"
    "  neutral earth tone (muted tan/brown) so tiles blend with ANY neighbor\n"
    "- Concentrate rich texture detail in the CENTER of each diamond\n"
    "- Flat ground viewed from above at roughly 30 degrees\n"
    "- Pure bright GREEN (#00FF00) background everywhere outside the diamonds\n"
    "- NO text, NO labels, NO watermarks, NO grid lines\n"
)

WATER_ANIMATION_SHEET_TEMPLATE = (
    "{preamble}"
    "Generate an ANIMATED WATER TILE SHEET with 4 animation frames.\n\n"
    "WATER STYLE: {description}\n\n"
    "IMAGE SIZE: 1024 × 1024 pixels.\n"
    "GRID: 2 columns × 2 rows = 4 cells, each 512 × 512 pixels.\n\n"
    "Each cell contains ONE isometric diamond water tile:\n"
    "- Diamond shape: approximately 512 wide × 256 tall (2:1 ratio)\n"
    "- Centered within its 512×512 cell\n"
    "- Pure GREEN (#00FF00) background behind and around each diamond\n\n"
    "The 4 frames show a LOOPING water animation sequence:\n"
    "  Frame 1 (top-left): Calm water, subtle small ripples beginning to form\n"
    "  Frame 2 (top-right): Ripples spreading, gentle wave movement visible\n"
    "  Frame 3 (bottom-left): Waves at peak, surface most disturbed, light reflections shift\n"
    "  Frame 4 (bottom-right): Waves receding, settling back toward calm\n\n"
    "CRITICAL RULES:\n"
    "- Each frame is a perfect isometric DIAMOND (2:1 width-to-height ratio)\n"
    "- SAME water color and style in all 4 frames — only the ripple/wave pattern changes\n"
    "- Changes between frames should be SUBTLE but VISIBLE for smooth animation\n"
    "- The animation must LOOP: frame 4 should transition smoothly back to frame 1\n"
    "- SEAMLESS EDGES: diamond edges fade to allow blending with adjacent land tiles\n"
    "- Pure bright GREEN (#00FF00) background outside each diamond\n"
    "- NO text, NO labels, NO watermarks\n"
)

# ---------------------------------------------------------------------------
# Terrain archetypes — defines each terrain type with 4 variant descriptions
# Key maps to game Terrain enum name. Used by generate_tile_sheets().
# ---------------------------------------------------------------------------

TERRAIN_ARCHETYPES = [
    {
        "key": "sand",
        "terrain_name": "Sand",
        "description": "Sandy wasteland terrain, wind-swept and sun-bleached",
        "texture_notes": (
            "Fine wind-blown sand with subtle dune ripples, tiny shadow lines, "
            "scattered small pebbles, and faint erosion channels"
        ),
        "variants": [
            "Fine wind-blown sand with subtle dune ripples and tiny shadow lines",
            "Sand with scattered small pebbles and bleached bone fragments",
            "Coarser granular sand with visible wind-carved patterns",
            "Flat compacted sand with faint erosion channels and dust patches",
        ],
    },
    {
        "key": "dirt",
        "terrain_name": "Dirt",
        "description": "Hard-packed brown earth, dry and dusty",
        "texture_notes": (
            "Smooth hard-packed dirt with hairline surface cracks, small embedded "
            "rocks, dried root traces, and scattered dust patches"
        ),
        "variants": [
            "Smooth hard-packed dirt with hairline surface cracks",
            "Dirt with small embedded rocks and dried root traces",
            "Uneven dirt surface with slight mounding and footprints",
            "Dry dirt with scattered dust patches and minor erosion lines",
        ],
    },
    {
        "key": "cracked-earth",
        "terrain_name": "CrackedEarth",
        "description": "Severely dried and cracked earth, deep fissures in parched ground",
        "texture_notes": (
            "Large irregular cracks forming a mosaic of dried mud plates, "
            "deep fissures with shadows, scattered dust and small debris"
        ),
        "variants": [
            "Large irregular cracks forming a mosaic of dried mud plates",
            "Dense network of fine cracks with curling edges on the plates",
            "Deep wide fissures with shadows visible in the cracks",
            "Cracked earth with scattered dust and small debris in the gaps",
        ],
    },
    {
        "key": "rubble",
        "terrain_name": "Rubble",
        "description": "Broken concrete and brick rubble from demolished buildings",
        "texture_notes": (
            "Mix of concrete chunks with rebar, brick fragments, mortar dust, "
            "gravel, faded paint fragments, and rusted metal scraps"
        ),
        "variants": [
            "Large concrete chunks with visible rebar and broken edges",
            "Mixed brick and concrete fragments with dust and mortar",
            "Fine rubble and gravel with scattered larger pieces",
            "Rubble with faded paint fragments and rusted metal scraps",
        ],
    },
    {
        "key": "road",
        "terrain_name": "Road",
        "description": "Cracked asphalt road surface, worn and deteriorating",
        "texture_notes": (
            "Dark asphalt with a network of surface cracks, potholes, "
            "faded markings, weeds pushing through cracks, and oil stains"
        ),
        "variants": [
            "Dark asphalt with a network of surface cracks and patching",
            "Broken road with potholes exposing dirt underneath",
            "Faded road with a barely visible center line marking",
            "Asphalt with weeds pushing through cracks and oil stains",
        ],
    },
    {
        "key": "concrete",
        "terrain_name": "Concrete",
        "description": "Indoor/settlement concrete floor, stained and cracked",
        "texture_notes": (
            "Smooth gray concrete with water stains, hairline cracks, "
            "expansion joints, scuff marks, and rust discoloration"
        ),
        "variants": [
            "Smooth gray concrete with water stains and hairline cracks",
            "Concrete with expansion joints and slight discoloration",
            "Worn concrete with scuff marks and embedded gravel spots",
            "Stained concrete with rust marks from old machinery",
        ],
    },
    {
        "key": "grass",
        "terrain_name": "Grass",
        "description": "Sparse, dying grass patches on dry earth",
        "texture_notes": (
            "Thin brown-green grass tufts on bare dirt, dying yellow-brown "
            "patches, sparse blades with exposed earth between clumps"
        ),
        "variants": [
            "Thin brown-green grass tufts scattered on bare dirt",
            "Denser but dying grass with yellow-brown patches",
            "Sparse grass blades with exposed dry earth between clumps",
            "Dead grass mat with a few green survivors poking through",
        ],
    },
]

WATER_ARCHETYPE = {
    "key": "water",
    "terrain_name": "Water",
    "description": (
        "Irradiated wasteland water — murky dark blue-green with a subtle "
        "toxic glow. Semi-opaque surface with floating debris specks. "
        "Slightly luminescent green tinge from radiation contamination."
    ),
}


def build_terrain_variant_sheet_prompt(archetype: dict, config: dict) -> str:
    """Build a prompt for generating a 2×2 terrain variant sheet (1024×1024).

    Each of the 4 cells contains one isometric diamond tile variant.
    All variants from the same API call ensures consistent style.
    """
    return TERRAIN_VARIANT_SHEET_TEMPLATE.format(
        preamble=TERRAIN_VARIANT_SHEET_PREAMBLE,
        terrain_name=archetype["terrain_name"],
        description=archetype["description"],
        v1=archetype["variants"][0],
        v2=archetype["variants"][1],
        v3=archetype["variants"][2],
        v4=archetype["variants"][3],
    )


def build_water_animation_sheet_prompt(config: dict) -> str:
    """Build a prompt for generating a 2×2 animated water tile sheet (1024×1024).

    The 4 cells are animation frames (not variants), creating a looping
    water surface animation. The game cycles through these at runtime.
    """
    return WATER_ANIMATION_SHEET_TEMPLATE.format(
        preamble=TERRAIN_VARIANT_SHEET_PREAMBLE,
        description=WATER_ARCHETYPE["description"],
    )


# ---------------------------------------------------------------------------
# Legacy prompts (kept for backwards compatibility)
# ---------------------------------------------------------------------------

# --- Tile Set Sheet (all variants in one image) ---

TILE_SET_PREAMBLE = (
    "Create an isometric TILE SET in the style of Fallout 2 "
    "(1998, Black Isle Studios). "
    "Use a muted, desaturated post-apocalyptic color palette with earthy browns, "
    "rust oranges, dusty yellows, and faded greens. "
    "Art style: detailed pre-rendered 3D look with gritty, weathered texture — "
    "NOT flat cartoon or pixel art. NO dark outlines on tile edges. "
    "Each tile is a perfect isometric diamond on a pure bright GREEN (#00FF00) "
    "chroma key background. Fill ALL space outside diamonds with solid green. "
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
    "- Pure bright GREEN (#00FF00) chroma key background around each diamond\n"
    "- Consistent perspective (top-down 3/4 view)\n"
    "- Tiles MUST seamlessly connect: edges should fade to neutral earth tones\n"
    "- Concentrate detail in the CENTER; the outer 20% of edges should be soft/blended\n"
    "- No text, no labels, no watermarks, no grid lines\n"
)

ITEM_SET_TEMPLATE = (
    "Create an INVENTORY ICON SHEET in the style of Fallout 2 "
    "(1998, Black Isle Studios).\n"
    "Art style: pre-rendered 3D look — NOT flat cartoon or pixel art.\n"
    "Muted, desaturated post-apocalyptic color palette.\n\n"
    "LAYOUT: {count} item icons in a single row.\n"
    "Each icon is {size}x{size} pixels.\n"
    "Total image size: {sheet_w}x{size} pixels.\n\n"
    "Items from left to right:\n{item_list}\n\n"
    "RULES:\n"
    "- Each item centered in its {size}x{size} cell with ~10%% padding on all sides\n"
    "- Pure bright GREEN (#00FF00) chroma key background — NOT transparent, NOT checkered\n"
    "- Fill ALL empty space with solid RGB(0,255,0) green\n"
    "- NO dark outlines or borders around items\n"
    "- Items look worn, used, and weathered\n"
    "- Slightly angled top-down perspective, like items on a table\n"
    "- NO text, NO labels, NO watermarks\n"
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
