"""Prompt templates for character sprite sheet generation.

Generates a full 8×8 sprite sheet per character inside a 2048×2048 image:
  8 columns = 8 viewing directions (S, SW, W, NW, N, NE, E, SE)
  8 rows    = 8 animation poses   (idle, walk×4, attack×2, hit)
  = 64 frames per character, each in a 256×256 cell

Uses gemini-3-pro-image-preview with image_size="2K" for native 2048×2048
output. This model supports "thinking" for better layout adherence and can
produce up to 4096×4096 if image_size="4K" is configured.

All 8 directions and 8 animations are generated natively — no mirroring
or animation fallbacks needed.

Weapon variant system:
- Each character base can be combined with different weapons
- This produces separate sprite sheets per weapon (e.g., player_pistol, player_rifle)
- The game engine swaps spriteKey at runtime when weapons are equipped
"""

CHAR_STYLE_PREAMBLE = (
    "Create a character sprite in the style of Fallout 2 (1998, Black Isle Studios). "
    "Top-down 3/4 isometric perspective — the exact camera angle used in Fallout 2. "
    "Characters are small, proportional figures (not chibi, not exaggerated). "
    "Color palette: desaturated earth tones — dusty browns, olive drab, rust, "
    "faded khaki, weathered gray. NO bright or saturated colors. "
    "Everything is sun-bleached and worn. Leather is cracked, metal is rusted, "
    "fabric is frayed. The aesthetic is 1950s retro-futuristic Americana "
    "after nuclear war — Atomic Age design language decayed by 80 years of neglect. "
    "Art style: detailed pre-rendered 3D look (like original Fallout 2 sprites), "
    "slightly soft with visible texture detail, NOT flat cartoon pixel art. "
    "CRITICAL: Pure bright GREEN (#00FF00) chroma key background everywhere. "
    "Draw ONLY the character — NO scenery, NO ground, NO shadows, NO text, NO labels. "
)

# ---------------------------------------------------------------------------
# Direction & animation constants
# ---------------------------------------------------------------------------

# All 8 directions and 8 animations are generated natively at 2048×2048.
# gemini-3-pro-image-preview with image_size="2K" → 8×8 grid → 256×256 per cell.
DIRECTIONS = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"]
ANIMATIONS = [
    "idle", "walk_1", "walk_2", "walk_3", "walk_4",
    "attack_1", "attack_2", "hit",
]

# Aliases for backwards compatibility with other modules
GENERATED_DIRECTIONS = DIRECTIONS
GENERATED_ANIMATIONS = ANIMATIONS
SHEET_DIRECTIONS = DIRECTIONS
SHEET_ANIMATIONS = ANIMATIONS

# Visual descriptions for all 8 directions.
# Describes what the VIEWER SEES, not abstract compass labels.
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

# Visual descriptions for all 8 animation rows.
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

# Backwards-compatible aliases (all 8 are now generated natively)
GENERATED_DIRECTION_LABELS = DIRECTION_LABELS
GENERATED_ANIMATION_LABELS = ANIMATION_LABELS

# --- Sprite sheet prompt (8×8 grid, 2048×2048 via image_size="2K") ---

SPRITESHEET_TEMPLATE = (
    "{preamble}"
    "Generate a CHARACTER SPRITE SHEET for: {name}\n"
    "{description}\n\n"
    "IMAGE SIZE: 2048 × 2048 pixels.\n"
    "GRID: 8 columns × 8 rows = 64 cells, each exactly 256 × 256 pixels.\n\n"
    "COLUMNS (left to right) — 8 viewing angles, rotating clockwise:\n"
    "  Col 1 — FRONT: Character faces directly toward the camera. Full face visible.\n"
    "  Col 2 — FRONT-LEFT 3/4: Turned 45° to their right. Left shoulder toward camera.\n"
    "  Col 3 — LEFT PROFILE: Character's left side facing camera. Full side silhouette.\n"
    "  Col 4 — BACK-LEFT 3/4: Turned 135° away. Back and left shoulder visible.\n"
    "  Col 5 — BACK: Faces away from camera. Back of head and body visible.\n"
    "  Col 6 — BACK-RIGHT 3/4: Turned 135° the other way. Back and right shoulder.\n"
    "  Col 7 — RIGHT PROFILE: Character's right side facing camera. Full side silhouette.\n"
    "  Col 8 — FRONT-RIGHT 3/4: Turned 45° to their left. Right shoulder toward camera.\n\n"
    "ROWS (top to bottom) — 8 animation poses:\n"
    "  Row 1 — IDLE: Standing still, relaxed. {idle_desc}.\n"
    "  Row 2 — WALK 1: LEFT foot forward (contact position), body leaning slightly forward.\n"
    "  Row 3 — WALK 2: RIGHT foot forward (contact position), body leaning slightly forward.\n"
    "  Row 4 — WALK 3: Mid-stride passing position, body upright, feet close together.\n"
    "  Row 5 — WALK 4: Mid-stride passing (opposite), body upright, transitioning.\n"
    "  Row 6 — ATTACK WIND-UP: Weapon drawn back or raised, body coiled, preparing to strike.\n"
    "  Row 7 — ATTACK STRIKE: {attack_desc}.\n"
    "  Row 8 — HIT REACTION: Recoiling from damage, body leaning back, staggered.\n\n"
    "IMPORTANT RULES:\n"
    "- The image is EXACTLY 2048×2048 pixels. Each of the 64 cells is 256×256.\n"
    "- Leave 4–8 pixels of green gap between cells so they are clearly separated.\n"
    "- The character fills ~80%% of each cell's height, centered horizontally.\n"
    "- The SAME character in ALL 64 cells — identical outfit, weapon, build, colors.\n"
    "- Only the POSE (row) and VIEWING ANGLE (column) change between cells.\n"
    "- Walk poses MUST show clearly DIFFERENT leg positions from each other.\n"
    "- Attack wind-up and attack strike MUST be visibly different poses.\n"
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
    "npc_guard": {
        "name": "Settlement Guard",
        "description": (
            "A stoic guard wearing makeshift metal armor plates over leather, "
            "a combat helmet with scratches, and a dusty bandana around the neck. "
            "Sturdy build, alert posture. "
            "Full body visible from head to boots."
        ),
    },
    "npc_tribal": {
        "name": "Tribal Warrior",
        "description": (
            "A lean tribal warrior with body paint, bone jewelry, "
            "and patched animal hide clothing. Feathers braided into dark hair. "
            "Carries a sharpened spear. Desert-adapted tribal survivor. "
            "Full body visible from head to bare feet."
        ),
    },
    "npc_caravan": {
        "name": "Caravan Driver",
        "description": (
            "A weathered caravan trader wearing a wide-brimmed leather hat, "
            "a long dust coat with many pockets, and heavy boots. "
            "Tanned and wind-burned face, rope belt with canteen. "
            "Full body visible from head to boots."
        ),
    },
    "npc_wastelander": {
        "name": "Wastelander",
        "description": (
            "A generic wasteland survivor in ragged, patched clothing. "
            "Faded t-shirt, worn jeans, makeshift sandals. Thin and sun-weathered. "
            "Carries a small satchel. Looks tired but surviving. "
            "Full body visible from head to feet."
        ),
    },
    "npc_mutant": {
        "name": "Super Mutant",
        "description": (
            "A large, hulking super mutant with greenish-yellow skin, "
            "massive muscles, and a crude outfit of scrap metal and leather straps. "
            "Bald, heavy brow, small angry eyes. Towering and intimidating. "
            "Full body visible from head to feet."
        ),
    },
    "npc_ghoul": {
        "name": "Ghoul",
        "description": (
            "A radiation-scarred ghoul with patches of missing skin revealing "
            "raw tissue, a raspy thin frame, and tattered pre-war clothing. "
            "Sunken eyes, no nose, lipless mouth. Still intelligent and civilized. "
            "Full body visible from head to worn shoes."
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
        "npc_guard": "rifle",
        "npc_tribal": "knife",
        "npc_caravan": "pistol",
        "npc_wastelander": "unarmed",
        "npc_mutant": "bat",
        "npc_ghoul": "pistol",
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
    """Build a prompt for generating a full 8×8 character sprite sheet.

    The sheet has 8 rows (idle, walk_1-4, attack_1-2, hit)
    × 8 columns (S, SW, W, NW, N, NE, E, SE) = 64 frames.

    Uses gemini-3-pro-image-preview with image_size="2K" for native
    2048×2048 output (256×256 per cell).
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
