"""Prompt templates for character sprite sheet generation.

Instead of generating one direction at a time, we generate full sprite sheets:
- One image contains ALL frames for a character
- Layout: rows = animations (idle, walk_1, walk_2, attack), columns = 8 directions
- The post-processor slices this into individual frames for the game engine
"""

CHAR_STYLE_PREAMBLE = (
    "Create a character sprite in the style of classic Fallout 2. "
    "The character should be viewed from a top-down 3/4 isometric perspective. "
    "Use a muted, desaturated post-apocalyptic color palette with earthy tones. "
    "The art style should be detailed pixel art. "
    "CRITICAL: Use a pure bright green (#00FF00) chroma key background "
    "so the background can be removed in post-processing. "
    "Draw ONLY the character on a flat bright green background — NO scenery, NO ground textures, "
    "NO shadows on the ground, NO text, NO labels. "
)

# Direction labels for 8-directional sprites (column order in the sheet)
DIRECTIONS = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"]

DIRECTION_LABELS = {
    "S":  "facing directly toward the camera (south)",
    "SW": "facing toward the bottom-right (southwest)",
    "W":  "facing to the right (west)",
    "NW": "facing toward the top-right (northwest)",
    "N":  "facing directly away from the camera (north)",
    "NE": "facing toward the top-left (northeast)",
    "E":  "facing to the left (east)",
    "SE": "facing toward the bottom-left (southeast)",
}

# Animation types (row order in the sheet)
ANIMATIONS = ["idle", "walk_1", "walk_2", "attack", "shoot", "reload"]

ANIMATION_LABELS = {
    "idle":    "standing idle, weapon held at ready (lowered or holstered)",
    "walk_1":  "mid-stride walking pose, left foot forward, weapon in hand",
    "walk_2":  "mid-stride walking pose, right foot forward, weapon in hand",
    "attack":  "melee attack — swinging weapon or punching forward aggressively",
    "shoot":   "firing ranged weapon — gun raised and aimed, muzzle flash visible",
    "reload":  "reloading weapon — gun lowered, hands working the action/magazine",
}

# --- Full sprite sheet prompt (all frames in one image) ---

SPRITESHEET_TEMPLATE = (
    "{preamble}"
    "Generate a COMPLETE CHARACTER SPRITE SHEET for: {name} — {description}.\n\n"
    "LAYOUT: The sprite sheet is a grid with {num_rows} rows and {num_cols} columns.\n"
    "Each cell is {cell_w}x{cell_h} pixels.\n"
    "Total image size: {sheet_w}x{sheet_h} pixels.\n\n"
    "ROWS (top to bottom — each row is one animation pose):\n"
    "{row_descriptions}\n\n"
    "COLUMNS (left to right — each column is one facing direction):\n"
    "{col_descriptions}\n\n"
    "CRITICAL RULES:\n"
    "- Every cell must show the SAME character with identical outfit, weapon, proportions, and colors.\n"
    "- The character MUST be holding their weapon in EVERY frame (idle, walk, attack, shoot, reload).\n"
    "- Only the POSE (row) and VIEWING ANGLE (column) change between cells.\n"
    "- Keep the character centered in each cell.\n"
    "- Use a pure bright green (#00FF00) chroma key background in every cell — NO scenery, NO ground shadows.\n"
    "- No text, no labels, no watermarks, no grid lines.\n"
    "- The grid should be precise — characters aligned in their cells.\n"
)

# --- Single-direction prompt (fallback for individual generation) ---

SINGLE_DIRECTION_TEMPLATE = (
    "{preamble}"
    "Character: {name} — {description}\n"
    "Pose: {pose}.\n"
    "Direction: The character is {direction_desc}.\n"
    "Target sprite size: {width}x{height} pixels.\n"
    "The proportions, outfit, weapon, and colors must be identical across all "
    "directional variants — only the viewing angle changes.\n"
    "IMPORTANT: Use a pure bright green (#00FF00) chroma key background. "
    "No ground, no shadow, no text, no labels, no watermarks. "
    "Just the character on a flat bright green background."
)

REFERENCE_FOLLOW_UP = (
    "{preamble}"
    "Generate the SAME character shown in the reference image, but now {direction_desc}. "
    "Keep the exact same outfit, proportions, colors, and equipment. "
    "Only change the viewing angle. "
    "Sprite size: {width}x{height} pixels. "
    "No text, no labels, no watermarks."
)


# Character archetypes — sprite_key must match the game's entity spriteKey values
# Characters are generated WITH their signature weapon in every frame
CHARACTER_ARCHETYPES = [
    {
        "sprite_key": "player",
        "name": "Wanderer (10mm Pistol)",
        "description": (
            "A rugged wasteland survivor wearing patched leather armor and "
            "a dusty duster coat. Green-tinted goggles on forehead. "
            "Holding a 10mm semi-automatic pistol in the right hand. "
            "Full body visible from head to boots."
        ),
        "pose": "standing idle, pistol held low at side",
    },
    {
        "sprite_key": "npc_sheriff",
        "name": "Sheriff Morgan (Revolver)",
        "description": (
            "A grizzled older woman with short gray hair, a sheriff's star pinned "
            "to a leather duster, a scar across her left cheek. "
            "Holding a revolver in the right hand. Sturdy boots. "
            "Full body visible from head to boots."
        ),
        "pose": "standing alert, revolver held at side",
    },
    {
        "sprite_key": "npc_merchant",
        "name": "Scrapper Joe (Shotgun)",
        "description": (
            "A traveling merchant wearing a wide-brimmed hat, heavy backpack "
            "full of goods, and a worn outfit. Belts with pouches and trinkets. "
            "Carrying a sawed-off shotgun in one hand. "
            "Full body visible from head to boots."
        ),
        "pose": "standing idle, shotgun held low",
    },
    {
        "sprite_key": "npc_doc",
        "name": "Doc Hendricks (Medical Bag)",
        "description": (
            "A middle-aged man with round glasses, thinning hair, a stained lab coat "
            "over a sweater vest. Carrying a medical bag in one hand, "
            "a small derringer pistol visible in belt holster. "
            "Full body visible from head to shoes."
        ),
        "pose": "standing idle, holding medical bag",
    },
    {
        "sprite_key": "npc_raider",
        "name": "Raider (Pipe Rifle)",
        "description": (
            "An aggressive raider with spiked shoulder pads, torn clothing, "
            "face paint, and a mohawk. Red cloth armband. "
            "Holding a crude pipe rifle in both hands. "
            "Full body visible from head to boots."
        ),
        "pose": "standing menacing, pipe rifle held across chest",
    },
]


def build_spritesheet_prompt(
    name: str,
    description: str,
    config: dict,
) -> str:
    """Build a prompt for generating a full character sprite sheet.

    The sheet has 4 rows (idle, walk_1, walk_2, attack) x 8 columns (directions).
    """
    cell_w = config["sprites"]["base_width"]
    cell_h = config["sprites"]["base_height"]
    num_cols = len(DIRECTIONS)
    num_rows = len(ANIMATIONS)
    sheet_w = cell_w * num_cols
    sheet_h = cell_h * num_rows

    row_descriptions = "\n".join(
        f"  Row {i + 1}: {ANIMATION_LABELS[anim]}"
        for i, anim in enumerate(ANIMATIONS)
    )
    col_descriptions = "\n".join(
        f"  Column {i + 1}: {DIRECTION_LABELS[d]}"
        for i, d in enumerate(DIRECTIONS)
    )

    return SPRITESHEET_TEMPLATE.format(
        preamble=CHAR_STYLE_PREAMBLE,
        name=name,
        description=description,
        num_rows=num_rows,
        num_cols=num_cols,
        cell_w=cell_w,
        cell_h=cell_h,
        sheet_w=sheet_w,
        sheet_h=sheet_h,
        row_descriptions=row_descriptions,
        col_descriptions=col_descriptions,
    )


def build_character_prompt(
    name: str,
    description: str,
    pose: str,
    direction: str,
    config: dict,
) -> str:
    """Build a prompt for generating a single character sprite in a given direction."""
    return SINGLE_DIRECTION_TEMPLATE.format(
        preamble=CHAR_STYLE_PREAMBLE,
        name=name,
        description=description,
        pose=pose,
        direction_desc=DIRECTION_LABELS[direction],
        width=config["sprites"]["base_width"],
        height=config["sprites"]["base_height"],
    )


def build_reference_prompt(direction: str, config: dict) -> str:
    """Build a follow-up prompt that references a previously generated sprite."""
    return REFERENCE_FOLLOW_UP.format(
        preamble=CHAR_STYLE_PREAMBLE,
        direction_desc=DIRECTION_LABELS[direction],
        width=config["sprites"]["base_width"],
        height=config["sprites"]["base_height"],
    )
