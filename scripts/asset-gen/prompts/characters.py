"""Prompt templates for character sprite sheet generation.

Instead of generating one direction at a time, we generate full sprite sheets:
- One image contains ALL frames for a character
- Layout: 4 rows (animations) × 4 columns (directions) = 16 frames
- The reprocessor slices this into individual frames and mirrors for 8 directions

Why 4×4 instead of 8×6:
  The AI consistently produces 4 cols × 4 rows regardless of what we request.
  Asking for 48 cells (8×6) in 1024×1024 gives ~128×170px per cell — too small
  for detail. A 4×4 grid gives 256×256 per cell — plenty of room.
  Missing directions (SE, E, NE) are mirrored from SW, W, NW.
  The game's AnimationSystem maps shoot→attack and reload→idle at runtime.

Weapon variant system:
- Each character base can be combined with different weapons
- This produces separate sprite sheets per weapon (e.g., player_pistol, player_rifle)
- The game engine swaps spriteKey at runtime when weapons are equipped
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

# The 4 directions we generate (columns). The other 4 are mirrored.
SHEET_DIRECTIONS = ["S", "SW", "W", "NW"]

# All 8 directions the game engine uses
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

# The 4 animation rows we generate. The game maps shoot→attack, reload→idle.
SHEET_ANIMATIONS = ["idle", "walk_1", "walk_2", "attack"]

# Legacy: full 6-animation list (kept for backwards compatibility)
ANIMATIONS = ["idle", "walk_1", "walk_2", "attack", "shoot", "reload"]

ANIMATION_LABELS = {
    "idle":    "standing idle, weapon held at ready (lowered or holstered)",
    "walk_1":  "mid-stride walking pose, left foot forward, weapon in hand",
    "walk_2":  "mid-stride walking pose, right foot forward, weapon in hand",
    "attack":  "attack pose — weapon swung/thrust forward (melee) or raised and aimed (ranged)",
}

# --- Full sprite sheet prompt (4×4 grid) ---

SPRITESHEET_TEMPLATE = (
    "{preamble}"
    "Generate a COMPLETE CHARACTER SPRITE SHEET for: {name} — {description}.\n\n"
    "LAYOUT: The sprite sheet is a grid with EXACTLY {num_rows} rows and {num_cols} columns.\n"
    "The total image is {sheet_size}x{sheet_size} pixels.\n"
    "Each cell is {cell_size}x{cell_size} pixels ({sheet_size}/{num_cols} = {cell_size}).\n\n"
    "ROWS (top to bottom — each row is one animation pose):\n"
    "{row_descriptions}\n\n"
    "COLUMNS (left to right — each column is one facing direction):\n"
    "{col_descriptions}\n\n"
    "CRITICAL RULES:\n"
    "- The image MUST be exactly {sheet_size}x{sheet_size} pixels.\n"
    "- The grid MUST be exactly {num_rows} rows × {num_cols} columns with equal-sized cells.\n"
    "- Every cell must show the SAME character with identical outfit, weapon, proportions, and colors.\n"
    "- The character MUST be holding their weapon in EVERY frame.\n"
    "- Only the POSE (row) and VIEWING ANGLE (column) change between cells.\n"
    "- Keep the character CENTERED in each cell, filling most of the cell.\n"
    "- Use a pure bright green (#00FF00) chroma key background in every cell.\n"
    "- NO scenery, NO ground shadows, NO text, NO labels, NO watermarks, NO grid lines.\n"
    "- The walk_1 and walk_2 rows must show DIFFERENT leg positions (alternating stride).\n"
    "- The attack row must show a clearly different pose with the weapon extended.\n"
    "- If a reference image of this character is provided, match their face, hair, "
    "body type, outfit, and colors EXACTLY — only the weapon changes.\n"
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


# ---------------------------------------------------------------------------
# Character base appearances (without weapon — combined with WEAPON_VARIANTS)
# ---------------------------------------------------------------------------
CHARACTER_BASES = {
    "player": {
        "name": "Wanderer",
        "description": (
            "A rugged wasteland survivor wearing patched leather armor and "
            "a dusty duster coat. Green-tinted goggles on forehead. "
            "Full body visible from head to boots."
        ),
    },
    "npc_sheriff": {
        "name": "Sheriff Morgan",
        "description": (
            "A grizzled older woman with short gray hair, a sheriff's star pinned "
            "to a leather duster, a scar across her left cheek. Sturdy boots. "
            "Full body visible from head to boots."
        ),
    },
    "npc_merchant": {
        "name": "Scrapper Joe",
        "description": (
            "A traveling merchant wearing a wide-brimmed hat, heavy backpack "
            "full of goods, and a worn outfit. Belts with pouches and trinkets. "
            "Full body visible from head to boots."
        ),
    },
    "npc_doc": {
        "name": "Doc Hendricks",
        "description": (
            "A middle-aged man with round glasses, thinning hair, a stained lab coat "
            "over a sweater vest. Carrying a medical bag in one hand. "
            "Full body visible from head to shoes."
        ),
    },
    "npc_raider": {
        "name": "Raider",
        "description": (
            "An aggressive raider with spiked shoulder pads, torn clothing, "
            "face paint, and a mohawk. Red cloth armband. "
            "Full body visible from head to boots."
        ),
    },
}

# ---------------------------------------------------------------------------
# Weapon variants — visual descriptions for sprite generation
# ---------------------------------------------------------------------------
WEAPON_VARIANTS = {
    "unarmed": {
        "label": "Unarmed",
        "held_desc": "Empty hands, fists clenched and ready",
        "idle_pose": "standing with fists at sides",
    },
    "pistol": {
        "label": "10mm Pistol",
        "held_desc": "Holding a 10mm semi-automatic pistol in the right hand",
        "idle_pose": "pistol held low at side",
    },
    "rifle": {
        "label": "Pipe Rifle",
        "held_desc": "Holding a crude pipe rifle in both hands",
        "idle_pose": "rifle held across chest at ready",
    },
    "knife": {
        "label": "Combat Knife",
        "held_desc": "Gripping a military combat knife in the right hand",
        "idle_pose": "knife held low at side, blade down",
    },
    "bat": {
        "label": "Baseball Bat",
        "held_desc": "Holding a nail-studded baseball bat over one shoulder",
        "idle_pose": "bat resting on right shoulder",
    },
}

# Maps game item IDs to weapon variant keys
ITEM_TO_WEAPON_KEY = {
    "10mm_pistol": "pistol",
    "pipe_rifle": "rifle",
    "combat_knife": "knife",
    "baseball_bat": "bat",
}

# ---------------------------------------------------------------------------
# Character+weapon combos to generate
# Player gets all weapon variants; NPCs get their signature weapon only
# ---------------------------------------------------------------------------
CHARACTER_ARCHETYPES = []

def _build_archetypes():
    """Build CHARACTER_ARCHETYPES from base characters × weapon variants."""
    archetypes = []

    # Player gets every weapon variant
    player_base = CHARACTER_BASES["player"]
    for weapon_key, weapon in WEAPON_VARIANTS.items():
        sprite_key = f"player_{weapon_key}"
        archetypes.append({
            "sprite_key": sprite_key,
            "base_key": "player",       # groups variants of same character
            "name": f"{player_base['name']} ({weapon['label']})",
            "description": (
                f"{player_base['description']} "
                f"{weapon['held_desc']}."
            ),
            "pose": f"standing idle, {weapon['idle_pose']}",
        })

    # NPCs: one signature weapon each
    npc_weapons = {
        "npc_sheriff": "pistol",
        "npc_merchant": "rifle",
        "npc_doc": "unarmed",
        "npc_raider": "rifle",
    }
    for npc_key, weapon_key in npc_weapons.items():
        base = CHARACTER_BASES[npc_key]
        weapon = WEAPON_VARIANTS[weapon_key]
        archetypes.append({
            "sprite_key": npc_key,
            "base_key": npc_key,        # single-variant NPCs reference themselves
            "name": f"{base['name']} ({weapon['label']})",
            "description": (
                f"{base['description']} "
                f"{weapon['held_desc']}."
            ),
            "pose": f"standing idle, {weapon['idle_pose']}",
        })

    return archetypes

CHARACTER_ARCHETYPES = _build_archetypes()


def build_spritesheet_prompt(
    name: str,
    description: str,
    config: dict,
) -> str:
    """Build a prompt for generating a 4×4 character sprite sheet.

    The sheet has 4 rows (idle, walk_1, walk_2, attack)
    × 4 columns (S, SW, W, NW) = 16 frames.
    Missing directions (SE, E, NE) are mirrored in post-processing.
    """
    sheet_size = config["sprites"].get("sheet_size", 1024)
    num_cols = len(SHEET_DIRECTIONS)
    num_rows = len(SHEET_ANIMATIONS)
    cell_size = sheet_size // max(num_cols, num_rows)

    row_descriptions = "\n".join(
        f"  Row {i + 1}: {ANIMATION_LABELS[anim]}"
        for i, anim in enumerate(SHEET_ANIMATIONS)
    )
    col_descriptions = "\n".join(
        f"  Column {i + 1}: {DIRECTION_LABELS[d]}"
        for i, d in enumerate(SHEET_DIRECTIONS)
    )

    return SPRITESHEET_TEMPLATE.format(
        preamble=CHAR_STYLE_PREAMBLE,
        name=name,
        description=description,
        num_rows=num_rows,
        num_cols=num_cols,
        cell_size=cell_size,
        sheet_size=sheet_size,
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
