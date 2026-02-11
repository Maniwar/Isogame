"""Prompt templates for character sprite sheet generation.

Generates a 4×4 sprite sheet per character inside a 1024×1024 image:
  4 columns = 4 viewing directions (front, front-left, back, back-left)
  4 rows    = 4 animation poses   (idle, walk A, walk B, attack)
  = 16 frames per character, each in a 256×256 cell

The reprocessor fills the remaining directions (SE, E, NE, W) via mirroring,
and the missing animations (walk_3, walk_4, attack_1, hit) via fallbacks,
producing the full 8×8 = 64 frames the game engine expects.

Why 4 columns, not 8:
  Gemini outputs 1024×1024 images. Cramming 8 columns into that produces
  tiny 128px-wide cells with too little detail.  4 columns at 256×256 gives
  the AI enough space per cell, and mirroring covers the other 4 directions.

Why 4 rows, not 8:
  Asking for 8 distinct poses overwhelms the AI — it produces duplicates.
  4 rows covers the essential poses: idle, two walk phases, and attack.

Weapon variant system:
- Each character base can be combined with different weapons
- This produces separate sprite sheets per weapon (e.g., player_pistol, player_rifle)
- The game engine swaps spriteKey at runtime when weapons are equipped
"""

CHAR_STYLE_PREAMBLE = (
    "Create a character sprite in the style of classic Fallout 2. "
    "Top-down 3/4 isometric perspective. "
    "Muted, desaturated post-apocalyptic color palette with earthy tones. "
    "Detailed pixel art with a gritty, weathered feel. "
    "CRITICAL: Pure bright GREEN (#00FF00) chroma key background everywhere. "
    "Draw ONLY the character — NO scenery, NO ground, NO shadows, NO text, NO labels. "
)

# ---------------------------------------------------------------------------
# Direction & animation constants
# ---------------------------------------------------------------------------

# What we ASK Gemini to generate (4 directions, 4 animations).
# Gemini outputs 1024×1024 → 4×4 grid → 256×256 per cell — enough detail.
GENERATED_DIRECTIONS = ["S", "SW", "N", "NW"]
GENERATED_ANIMATIONS = ["idle", "walk_1", "walk_2", "attack_2"]

# Visual descriptions for the 4 generated directions.
# Describes what the VIEWER SEES, not abstract compass labels.
GENERATED_DIRECTION_LABELS = {
    "S":  "FRONT VIEW — character faces directly toward the camera, full face visible",
    "SW": "FRONT-LEFT 3/4 — character turned 45° to their right, left shoulder toward camera",
    "N":  "BACK VIEW — character faces directly away from camera, back of head visible",
    "NW": "BACK-LEFT 3/4 — character turned 135° away, showing back and left shoulder",
}

# Visual descriptions for the 4 generated animation rows.
GENERATED_ANIMATION_LABELS = {
    "idle":     "STANDING IDLE — relaxed stance, weapon held at side or lowered",
    "walk_1":   "WALK STEP A — LEFT foot forward, body leaning into the stride",
    "walk_2":   "WALK STEP B — RIGHT foot forward, body leaning into the stride",
    "attack_2": "ATTACK — weapon actively striking forward or firing",
}

# Full 8-direction / 8-animation sets for the GAME ENGINE.
# The reprocessor fills these from the 4×4 generated grid via mirroring + fallbacks.
SHEET_DIRECTIONS = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"]
SHEET_ANIMATIONS = [
    "idle", "walk_1", "walk_2", "walk_3", "walk_4",
    "attack_1", "attack_2", "hit",
]

# Aliases used by other modules
DIRECTIONS = SHEET_DIRECTIONS
ANIMATIONS = SHEET_ANIMATIONS

# Full direction labels (for legacy single-direction prompts)
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

# Full animation labels (for reference)
ANIMATION_LABELS = {
    "idle":     "standing idle, weapon held at ready (lowered or holstered), weight evenly balanced",
    "walk_1":   "walking pose: LEFT foot FORWARD (contact), body leaning slightly forward, weapon in hand",
    "walk_2":   "walking pose: RIGHT foot FORWARD (contact), body leaning slightly forward, weapon in hand",
    "walk_3":   "walking pose: mid-stride PASSING position, body upright, feet close together, transitioning",
    "walk_4":   "walking pose: mid-stride PASSING position (opposite), body upright, transitioning back",
    "attack_1": "attack WIND-UP: weapon drawn back or raised, body coiled, preparing to strike",
    "attack_2": "attack STRIKE: weapon fully extended forward (melee thrust/swing) or aimed and firing (ranged)",
    "hit":      "HIT REACTION: recoiling from damage, body leaning back, staggered, pain expression",
}

# --- Sprite sheet prompt (4×4 grid, 1024×1024) ---

SPRITESHEET_TEMPLATE = (
    "{preamble}"
    "Generate a CHARACTER SPRITE SHEET for: {name}\n"
    "{description}\n\n"
    "IMAGE SIZE: 1024 × 1024 pixels.\n"
    "GRID: 4 columns × 4 rows = 16 cells, each exactly 256 × 256 pixels.\n\n"
    "The grid must look like this (4 columns, 4 rows):\n"
    "┌─────────────┬─────────────┬─────────────┬─────────────┐\n"
    "│ Idle, Front  │ Idle, F-L   │ Idle, Back  │ Idle, B-L   │\n"
    "├─────────────┼─────────────┼─────────────┼─────────────┤\n"
    "│ WalkA, Front │ WalkA, F-L  │ WalkA, Back │ WalkA, B-L  │\n"
    "├─────────────┼─────────────┼─────────────┼─────────────┤\n"
    "│ WalkB, Front │ WalkB, F-L  │ WalkB, Back │ WalkB, B-L  │\n"
    "├─────────────┼─────────────┼─────────────┼─────────────┤\n"
    "│ Attack,Front │ Attack, F-L │ Attack, Back│ Attack, B-L │\n"
    "└─────────────┴─────────────┴─────────────┴─────────────┘\n\n"
    "COLUMNS (left to right) — 4 viewing angles of the SAME character:\n"
    "  Column 1 — FRONT: Character faces directly toward the camera. Full face visible.\n"
    "  Column 2 — FRONT-LEFT: Character rotated 45°. Left shoulder comes toward camera.\n"
    "  Column 3 — BACK: Character faces away from camera. Back of head and body visible.\n"
    "  Column 4 — BACK-LEFT: Character rotated 135° away. Back and left shoulder visible.\n\n"
    "ROWS (top to bottom) — 4 poses:\n"
    "  Row 1 — IDLE: Standing still. {idle_desc}.\n"
    "  Row 2 — WALK STEP A: Mid-stride, LEFT foot forward, body leaning slightly.\n"
    "  Row 3 — WALK STEP B: Mid-stride, RIGHT foot forward, body leaning slightly.\n"
    "  Row 4 — ATTACK: {attack_desc}.\n\n"
    "IMPORTANT RULES:\n"
    "- The image is EXACTLY 1024×1024. Each of the 16 cells is EXACTLY 256×256.\n"
    "- Leave 4–8 pixels of green gap between cells so they are clearly separated.\n"
    "- The character fills ~80%% of each cell's height, centered in the cell.\n"
    "- The SAME character in ALL 16 cells — identical outfit, weapon, build, colors.\n"
    "- Only the POSE (row) and VIEWING ANGLE (column) change.\n"
    "- Walk Step A and Walk Step B MUST show clearly DIFFERENT leg positions.\n"
    "- Pure bright GREEN (#00FF00) background in every cell and between cells.\n"
    "- NO scenery, NO ground shadows, NO text, NO labels, NO watermarks.\n"
    "- If a reference image is provided, match face, hair, outfit, and colors exactly.\n"
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
        "attack_desc": "fists punching forward aggressively",
    },
    "pistol": {
        "label": "10mm Pistol",
        "held_desc": "Holding a 10mm semi-automatic pistol in the right hand",
        "idle_pose": "pistol held low at side",
        "attack_desc": "pistol raised and aimed forward, firing",
    },
    "rifle": {
        "label": "Pipe Rifle",
        "held_desc": "Holding a crude pipe rifle in both hands",
        "idle_pose": "rifle held across chest at ready",
        "attack_desc": "rifle shouldered and aimed forward, firing",
    },
    "knife": {
        "label": "Combat Knife",
        "held_desc": "Gripping a military combat knife in the right hand",
        "idle_pose": "knife held low at side, blade down",
        "attack_desc": "knife thrust forward in a stabbing motion",
    },
    "bat": {
        "label": "Baseball Bat",
        "held_desc": "Holding a nail-studded baseball bat over one shoulder",
        "idle_pose": "bat resting on right shoulder",
        "attack_desc": "bat swung in a wide horizontal arc",
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
            "weapon_idle_desc": weapon["idle_pose"],
            "weapon_attack_desc": weapon["attack_desc"],
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
            "weapon_idle_desc": weapon["idle_pose"],
            "weapon_attack_desc": weapon["attack_desc"],
        })

    return archetypes

CHARACTER_ARCHETYPES = _build_archetypes()


def build_spritesheet_prompt(
    name: str,
    description: str,
    config: dict,
    weapon_idle_desc: str = "weapon held at side, relaxed",
    weapon_attack_desc: str = "weapon swung or fired forward",
) -> str:
    """Build a prompt for generating a 4×4 character sprite sheet.

    The sheet has 4 rows (idle, walk_1, walk_2, attack)
    × 4 columns (S, SW, N, NW) = 16 frames.
    The reprocessor mirrors SW→SE, NW→NE, and falls back for W/E,
    producing the full 8×8 the game engine expects.

    Targets 1024×1024 image (Gemini's native output size).
    """
    return SPRITESHEET_TEMPLATE.format(
        preamble=CHAR_STYLE_PREAMBLE,
        name=name,
        description=description,
        idle_desc=weapon_idle_desc,
        attack_desc=weapon_attack_desc,
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
