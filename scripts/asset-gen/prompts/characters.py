"""Prompt templates for character sprite sheet generation.

Instead of generating one direction at a time, we generate full sprite sheets:
- One image contains ALL frames for a character
- Layout: rows = animations (idle, walk_1, walk_2, attack), columns = 8 directions
- The post-processor slices this into individual frames for the game engine
"""

CHAR_STYLE_PREAMBLE = (
    "Create a character sprite sheet in the style of classic Fallout 2. "
    "The characters should be viewed from a top-down 3/4 isometric perspective. "
    "Use a muted, desaturated post-apocalyptic color palette. "
    "The art style should be detailed pixel art. "
    "Transparent background. "
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
ANIMATIONS = ["idle", "walk_1", "walk_2", "attack"]

ANIMATION_LABELS = {
    "idle":    "standing idle, relaxed posture",
    "walk_1":  "mid-stride walking pose, left foot forward",
    "walk_2":  "mid-stride walking pose, right foot forward",
    "attack":  "attacking / swinging weapon forward aggressively",
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
    "- Every cell must show the SAME character with identical outfit, proportions, and colors.\n"
    "- Only the POSE (row) and VIEWING ANGLE (column) change between cells.\n"
    "- Keep the character centered in each cell.\n"
    "- Transparent background in every cell.\n"
    "- No text, no labels, no watermarks, no grid lines.\n"
    "- The grid should be precise — characters aligned in their cells.\n"
)

# --- Single-direction prompt (fallback for individual generation) ---

SINGLE_DIRECTION_TEMPLATE = (
    "{preamble}"
    "Character: {name} — {description}. "
    "Pose: {pose}. "
    "Direction: The character is {direction_desc}. "
    "Sprite size: {width}x{height} pixels. "
    "The proportions and outfit must be identical across all directional variants — "
    "only the viewing angle changes. "
    "No text, no labels, no watermarks."
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
CHARACTER_ARCHETYPES = [
    {
        "sprite_key": "player",
        "name": "Wanderer",
        "description": (
            "A rugged wasteland survivor wearing patched leather armor, "
            "a dusty duster coat, and a gas mask hanging around the neck. "
            "Carries a makeshift rifle on the back. Green-tinted goggles on forehead."
        ),
        "pose": "standing idle",
    },
    {
        "sprite_key": "npc_sheriff",
        "name": "Sheriff Morgan",
        "description": (
            "A grizzled older woman with short gray hair, a sheriff's star pinned "
            "to a leather duster, a scar across her left cheek, and a holstered "
            "revolver on her hip. Sturdy boots, weathered but authoritative."
        ),
        "pose": "standing idle, hands near belt",
    },
    {
        "sprite_key": "npc_merchant",
        "name": "Scrapper Joe",
        "description": (
            "A traveling merchant wearing a wide-brimmed hat, heavy backpack "
            "full of goods, and a worn but clean outfit. Friendly posture. "
            "Belts with pouches and trinkets hanging off them."
        ),
        "pose": "standing idle",
    },
    {
        "sprite_key": "npc_doc",
        "name": "Doc Hendricks",
        "description": (
            "A middle-aged man with round glasses, thinning hair, a stained lab coat "
            "over a sweater vest, and ink-stained fingers. Carries a medical bag."
        ),
        "pose": "standing idle",
    },
    {
        "sprite_key": "npc_raider",
        "name": "Raider",
        "description": (
            "An aggressive raider with spiked shoulder pads, torn clothing, "
            "face paint, and a mohawk. Carries a lead pipe. "
            "Red cloth armband, menacing posture."
        ),
        "pose": "standing idle, menacing stance",
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
