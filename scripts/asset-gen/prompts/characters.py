"""Prompt templates for character sprite sheet generation.

Instead of generating one direction at a time, we generate full sprite sheets:
- One image contains ALL frames for a character
- Layout: 8 rows (animations) × 8 columns (directions) = 64 frames
- Uses 2048×2048 images for 256×256 per cell — good detail per frame
- Each column is a specific facing direction with explicit visual description
- The reprocessor slices this into individual frames

Animation layout (8 rows):
  Row 1: idle        — standing still, weapon at ready
  Row 2: walk_1      — left foot forward (contact)
  Row 3: walk_2      — upright mid-stride transition (passing)
  Row 4: walk_3      — right foot forward (contact)
  Row 5: walk_4      — upright mid-stride transition (passing, opposite)
  Row 6: attack_1    — wind-up / preparation (weapon drawn back)
  Row 7: attack_2    — strike / impact (weapon extended forward)
  Row 8: hit         — recoiling from damage / stagger

Why 8 columns instead of 4+mirror:
  Mirroring only works for bilaterally symmetric characters (no asymmetric
  weapons, scars, badges). Generating all 8 directions gives proper side views
  (W/E) that mirroring from front/back views can never produce. At 2048px
  with 8×8 cells, each cell is 256×256.

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

# All 8 directions — we now generate ALL of them (no more mirroring).
# Order matters: this is the column order in the sprite sheet.
SHEET_DIRECTIONS = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"]

# Same list, used by other modules
DIRECTIONS = SHEET_DIRECTIONS

# Explicit visual descriptions for each direction.
# These describe what the VIEWER SEES, not abstract compass directions.
# This prevents the AI from confusing "west" (side view) with "north" (back view).
DIRECTION_LABELS = {
    "S":  "FRONT VIEW — character faces directly toward the viewer, full face visible",
    "SW": "FRONT-LEFT 3/4 VIEW — character turned 45° to their right, left shoulder toward viewer",
    "W":  "LEFT PROFILE — character's LEFT side facing the viewer, a full side silhouette",
    "NW": "BACK-LEFT 3/4 VIEW — character turned away 135°, showing back of left shoulder",
    "N":  "BACK VIEW — character faces directly away from the viewer, back of head and body visible",
    "NE": "BACK-RIGHT 3/4 VIEW — character turned away 135° the other way, showing back of right shoulder",
    "E":  "RIGHT PROFILE — character's RIGHT side facing the viewer, a full side silhouette",
    "SE": "FRONT-RIGHT 3/4 VIEW — character turned 45° to their left, right shoulder toward viewer",
}

# The 8 animation rows in the sprite sheet (one per row, top to bottom).
SHEET_ANIMATIONS = [
    "idle", "walk_1", "walk_2", "walk_3", "walk_4",
    "attack_1", "attack_2", "hit",
]

# All animation keys the game engine uses
ANIMATIONS = SHEET_ANIMATIONS

ANIMATION_LABELS = {
    "idle":     "standing idle, weapon held at ready (lowered or holstered), weight evenly balanced",
    "walk_1":   "walking pose: LEFT foot FORWARD (contact), body leaning slightly forward, weapon in hand",
    "walk_2":   "walking pose: mid-stride PASSING position, body upright, feet close together, transitioning",
    "walk_3":   "walking pose: RIGHT foot FORWARD (contact), body leaning slightly forward, weapon in hand",
    "walk_4":   "walking pose: mid-stride PASSING position (opposite), body upright, transitioning back",
    "attack_1": "attack WIND-UP: weapon drawn back or raised, body coiled, preparing to strike",
    "attack_2": "attack STRIKE: weapon fully extended forward (melee thrust/swing) or aimed and firing (ranged)",
    "hit":      "HIT REACTION: recoiling from damage, body leaning back, staggered, pain expression",
}

# --- Full sprite sheet prompt (4×4 grid) ---

SPRITESHEET_TEMPLATE = (
    "{preamble}"
    "Generate a COMPLETE CHARACTER SPRITE SHEET for: {name} — {description}.\n\n"
    "LAYOUT: The sprite sheet is a grid with EXACTLY {num_rows} rows and {num_cols} columns.\n"
    "The total image is {sheet_size}x{sheet_size} pixels.\n"
    "Each cell is {cell_w}x{cell_h} pixels (width×height).\n\n"
    "ROWS (top to bottom — each row is one animation pose):\n"
    "{row_descriptions}\n\n"
    "COLUMNS (left to right — each column is one facing direction, rotating 45° per step):\n"
    "{col_descriptions}\n\n"
    "CRITICAL RULES:\n"
    "- The image MUST be exactly {sheet_size}x{sheet_size} pixels.\n"
    "- The grid MUST be exactly {num_rows} rows × {num_cols} columns.\n"
    "- Each cell is {cell_w} pixels wide and {cell_h} pixels tall.\n"
    "- Every cell must show the SAME character with identical outfit, weapon, proportions, and colors.\n"
    "- The character MUST be holding their weapon in EVERY frame.\n"
    "- Only the POSE (row) and VIEWING ANGLE (column) change between cells.\n"
    "- The 8 columns show a FULL 360° rotation of the character in 45° increments.\n"
    "- Columns 3 (W) and 7 (E) MUST show clear SIDE PROFILE views — not front or back.\n"
    "- Column 5 (N) shows the character's BACK — this is the only back-facing column.\n"
    "- Keep the character CENTERED in each cell, filling most of the cell height.\n"
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
    """Build a prompt for generating an 8×4 character sprite sheet.

    The sheet has 4 rows (idle, walk_1, walk_2, attack)
    × 8 columns (S, SW, W, NW, N, NE, E, SE) = 32 frames.
    All 8 directions are generated — no mirroring needed.
    Uses 2048×2048 for 256×512 per cell.
    """
    sheet_size = config["sprites"].get("sheet_size", 2048)
    num_cols = len(SHEET_DIRECTIONS)
    num_rows = len(SHEET_ANIMATIONS)
    cell_w = sheet_size // num_cols   # 2048/8 = 256
    cell_h = sheet_size // num_rows   # 2048/4 = 512

    row_descriptions = "\n".join(
        f"  Row {i + 1}: {ANIMATION_LABELS[anim]}"
        for i, anim in enumerate(SHEET_ANIMATIONS)
    )
    col_descriptions = "\n".join(
        f"  Column {i + 1} ({d}): {DIRECTION_LABELS[d]}"
        for i, d in enumerate(SHEET_DIRECTIONS)
    )

    return SPRITESHEET_TEMPLATE.format(
        preamble=CHAR_STYLE_PREAMBLE,
        name=name,
        description=description,
        num_rows=num_rows,
        num_cols=num_cols,
        cell_w=cell_w,
        cell_h=cell_h,
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
