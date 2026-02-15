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
    "ABSOLUTELY NO dark outlines or black borders around the character silhouette. "
    "NO cel-shading outlines. NO ink outlines. The character edges should have "
    "natural soft transitions — the silhouette blends directly into the background "
    "with NO drawn border of any kind. Think 3D render, not comic book art. "
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

    "═══════════════════════════════════════════\n"
    "TECHNICAL SPECIFICATION — READ CAREFULLY\n"
    "═══════════════════════════════════════════\n\n"

    "OUTPUT IMAGE: Exactly 2048 × 2048 pixels.\n\n"

    "GRID LAYOUT:\n"
    "- 8 columns × 8 rows = 64 cells total.\n"
    "- Each cell is exactly 256 × 256 pixels (2048 ÷ 8 = 256).\n"
    "- Cell boundaries are a STRICT pixel grid:\n"
    "    Column 1: x=0–255    Column 2: x=256–511   Column 3: x=512–767   Column 4: x=768–1023\n"
    "    Column 5: x=1024–1279  Column 6: x=1280–1535  Column 7: x=1536–1791  Column 8: x=1792–2047\n"
    "    Row 1: y=0–255  Row 2: y=256–511  Row 3: y=512–767  Row 4: y=768–1023\n"
    "    Row 5: y=1024–1279  Row 6: y=1280–1535  Row 7: y=1536–1791  Row 8: y=1792–2047\n"
    "- The software will slice this image into 64 individual 256×256 cells using these "
    "exact pixel coordinates. Every cell MUST contain exactly one character pose.\n\n"

    "BACKGROUND & TRANSPARENCY:\n"
    "- The ENTIRE image background must be pure bright GREEN: RGB(0, 255, 0) / #00FF00.\n"
    "- This green is a chroma key. Software will replace it with transparency.\n"
    "- Fill ALL empty space with this exact green — inside cells, between cells, everywhere.\n"
    "- The character must be painted DIRECTLY on the green background with NO border, "
    "NO outline, and NO dark edge around the character's silhouette.\n"
    "- Character edges should transition DIRECTLY from skin/clothing/armor color to green.\n"
    "- DO NOT draw any black or dark outline around the character shape.\n"
    "- DO NOT draw ground shadows, cast shadows, or drop shadows.\n\n"

    "CHARACTER SIZING (CRITICAL — prevents cut-off sprites):\n"
    "- Each character pose must fit within a 200 × 200 pixel area CENTERED within the "
    "256 × 256 cell. This gives 28 pixels of green padding on every side.\n"
    "- The character is vertically anchored to the BOTTOM of the 200px area "
    "(feet at the bottom, head at the top). Horizontally centered.\n"
    "- NO part of the character may extend beyond this 200 × 200 safe zone.\n"
    "- Arms, weapons, feet, hats, shoulder pads — EVERYTHING stays inside the safe zone.\n"
    "- The character should be approximately 170–200 pixels tall (head to toe) in the "
    "idle pose. Attack and hit poses may be shorter due to crouching/leaning.\n"
    "- ALL 64 cells must have the character at the SAME SIZE. Do not make some cells "
    "bigger or smaller than others.\n\n"

    "═══════════════════════════════════════════\n"
    "COLUMNS — 8 VIEWING DIRECTIONS (left to right)\n"
    "═══════════════════════════════════════════\n\n"

    "Each column shows the character from a different camera angle, rotating 45° clockwise:\n\n"
    "  Col 1 (S)  — FRONT VIEW: Character faces directly toward the camera. Both eyes, "
    "full face, and chest visible. Arms visible on both sides. This is the 'default' view.\n"
    "  Col 2 (SW) — FRONT-LEFT: Character rotated 45° clockwise. Left shoulder closer to "
    "camera. See 3/4 of face (left cheek, nose, right eye partially hidden).\n"
    "  Col 3 (W)  — LEFT PROFILE: Character's left side faces camera. Full side silhouette. "
    "See left arm, left leg, left ear. Right side completely hidden behind body.\n"
    "  Col 4 (NW) — BACK-LEFT: Character turned 135° away. See back of left shoulder, "
    "back-left of head. Face NOT visible.\n"
    "  Col 5 (N)  — BACK VIEW: Character faces directly AWAY from camera. See full back, "
    "back of head, both shoulders from behind. Face NOT visible.\n"
    "  Col 6 (NE) — BACK-RIGHT: Character turned 135° the other way. See back of right "
    "shoulder, back-right of head. Face NOT visible. Mirror of Col 4.\n"
    "  Col 7 (E)  — RIGHT PROFILE: Character's right side faces camera. Full side silhouette. "
    "Mirror of Col 3 — see right arm, right leg, right ear.\n"
    "  Col 8 (SE) — FRONT-RIGHT: Character rotated 45° counter-clockwise. Right shoulder "
    "closer to camera. See 3/4 of face from other side. Mirror of Col 2.\n\n"

    "IMPORTANT: Columns 6–8 should be approximate horizontal mirrors of Columns 4–2. "
    "The character's left side and right side should look consistent.\n\n"

    "═══════════════════════════════════════════\n"
    "ROWS — 8 ANIMATION POSES (top to bottom)\n"
    "═══════════════════════════════════════════\n\n"

    "Each row shows a DIFFERENT body pose. The character, outfit, and colors stay identical "
    "— ONLY the body position changes between rows. Each pose is described in detail below:\n\n"

    "  Row 1 — IDLE (standing still):\n"
    "    Body upright, weight evenly on both feet, shoulders relaxed.\n"
    "    {idle_desc}.\n"
    "    This is the default resting pose. Feet shoulder-width apart on the ground.\n\n"

    "  Row 2 — WALK FRAME 1 (left foot forward):\n"
    "    LEFT leg extended forward (heel just touching ground), RIGHT leg behind.\n"
    "    Body leans slightly forward. Arms swing naturally: right arm forward, left arm back.\n"
    "    This is the \"contact\" pose — the moment the front foot lands.\n\n"

    "  Row 3 — WALK FRAME 2 (right foot forward):\n"
    "    RIGHT leg extended forward (heel just touching ground), LEFT leg behind.\n"
    "    OPPOSITE of Row 2 — mirror the leg positions. Right arm back, left arm forward.\n"
    "    The legs MUST be visibly different from Row 2.\n\n"

    "  Row 4 — WALK FRAME 3 (passing position A):\n"
    "    Both feet close together under the body, weight on the back foot.\n"
    "    The front leg is lifting and swinging forward. Body upright.\n"
    "    This is the mid-stride transition between contact poses.\n"
    "    Legs closer together than Rows 2–3. Body slightly taller.\n\n"

    "  Row 5 — WALK FRAME 4 (passing position B):\n"
    "    Both feet close together, weight on the opposite foot from Row 4.\n"
    "    The other leg is now swinging forward. Body upright.\n"
    "    Subtle difference from Row 4 — weight shifted to the other side.\n"
    "    Together, Rows 2→4→3→5 create a smooth 4-frame walk cycle.\n\n"

    "  Row 6 — ATTACK WIND-UP (preparing to strike):\n"
    "    Body coiled, weight shifted back. Knees slightly bent.\n"
    "    Weapon drawn BACK or RAISED — preparing for a powerful strike.\n"
    "    Arms pulled back, torso twisted slightly. Tense, ready to strike.\n"
    "    This pose should look like the moment BEFORE the attack connects.\n\n"

    "  Row 7 — ATTACK STRIKE (weapon extended):\n"
    "    {attack_desc}.\n"
    "    Body lunged forward, weight on front foot. Weapon fully EXTENDED.\n"
    "    This is the moment of IMPACT — maximum reach of the attack.\n"
    "    MUST be visibly different from Row 6 (weapon position completely changed).\n\n"

    "  Row 8 — HIT REACTION (taking damage):\n"
    "    Body recoiling BACKWARD from an impact to the chest.\n"
    "    Head snapped back, one arm up defensively, weight stumbling backward.\n"
    "    Knees bent, off-balance. Expression of pain or surprise.\n"
    "    This should look like the character was just punched or shot.\n\n"

    "═══════════════════════════════════════════\n"
    "CONSISTENCY RULES\n"
    "═══════════════════════════════════════════\n\n"

    "- SAME CHARACTER in all 64 cells. Same face, same hair, same outfit, same colors, "
    "same build, same weapon. Only pose and angle change.\n"
    "- SAME SIZE in all 64 cells. The character should be approximately the same height "
    "across all poses (idle ≈ walk ≈ attack). Do not draw some poses larger or smaller.\n"
    "- SAME POSITION within each cell. Character always centered horizontally, feet anchored "
    "at the same vertical position (bottom of the 200px safe zone).\n"
    "- NO text, labels, numbers, or annotations anywhere in the image.\n"
    "- NO watermarks, signatures, or logos.\n"
    "- If a reference image is provided, match the reference character's face, hair, outfit, "
    "and colors exactly across all 64 cells.\n"
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

    # NPCs: combatants get multiple weapon variants, others get one signature.
    # The first weapon in each list is the "default" used when no weapon is equipped.
    npc_weapons: dict[str, list[str]] = {
        "npc_sheriff":     ["pistol", "rifle"],                 # law enforcement
        "npc_merchant":    ["rifle"],                           # self-defense
        "npc_doc":         ["unarmed"],                         # non-combatant
        "npc_raider":      ["rifle", "pistol", "knife", "bat"], # uses whatever
        "npc_guard":       ["rifle", "pistol"],                 # standard guard
        "npc_tribal":      ["knife", "unarmed"],                # tribal weapons
        "npc_caravan":     ["pistol"],                          # protection
        "npc_wastelander": ["unarmed"],                         # passive
        "npc_mutant":      ["bat", "unarmed"],                  # brute force
        "npc_ghoul":       ["pistol"],                          # basic defense
    }
    for npc_key, weapon_keys in npc_weapons.items():
        base = CHARACTER_BASES[npc_key]
        for i, weapon_key in enumerate(weapon_keys):
            weapon = WEAPON_VARIANTS[weapon_key]
            # First (default) weapon uses bare npc_key; extras get suffix
            if i == 0:
                sprite_key = npc_key
            else:
                sprite_key = f"{npc_key}_{weapon_key}"
            archetypes.append({
                "sprite_key": sprite_key,
                "base_key": npc_key,
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
