"""Prompt templates for weapon overlay sprite sheet generation.

Weapon sprites are generated as overlays — they show only the weapon and
the hands/arms holding it, designed to be composited on top of unarmed
character sprites at runtime.

NOTE: Weapon overlays are currently unused by the game engine. The game
uses weapon-variant character sprites (player_pistol, player_rifle, etc.)
instead of compositing overlays at runtime. This module is kept for
potential future use.

Generates a 4×4 sprite sheet per weapon inside a 1024×1024 image:
  4 columns = 4 viewing directions (front, front-left, back, back-left)
  4 rows    = 4 animation poses   (idle, walk A, walk B, attack)
  = 16 frames per weapon, each in a 256×256 cell

The reprocessor fills the remaining directions (SE, E, NE, W) via mirroring,
and the missing animations (walk_3, walk_4, attack_1, hit) via fallbacks,
producing the full 8×8 = 64 frames the game engine expects.
"""

from .characters import (
    DIRECTIONS, DIRECTION_LABELS, ANIMATIONS, ANIMATION_LABELS,
    GENERATED_DIRECTIONS, GENERATED_ANIMATIONS,
    GENERATED_DIRECTION_LABELS, GENERATED_ANIMATION_LABELS,
)

WEAPON_STYLE_PREAMBLE = (
    "Create a weapon overlay sprite in the style of classic Fallout 2. "
    "Top-down 3/4 isometric perspective. Detailed pixel art. "
    "Muted, desaturated post-apocalyptic color palette with earthy tones. "
    "CRITICAL: Use a pure bright green (#00FF00) chroma key background. "
    "Draw ONLY the weapon and the hands/arms holding it — NO full body, "
    "NO torso, NO head, NO legs. Just the weapon + forearms/hands. "
    "Position the hands at roughly chest/waist height where a character's "
    "hands would be. NO scenery, NO ground, NO shadows, NO text, NO labels. "
)

WEAPON_SHEET_TEMPLATE = (
    "{preamble}"
    "Generate a WEAPON OVERLAY SPRITE SHEET for: {name} — {description}.\n\n"
    "This weapon overlay will be composited on top of a character sprite.\n"
    "Show ONLY the weapon and the hands/forearms holding it.\n\n"
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
    "COLUMNS (left to right) — 4 viewing angles:\n"
    "  Column 1 — FRONT: Weapon seen from directly in front. Full front visible.\n"
    "  Column 2 — FRONT-LEFT: Weapon rotated 45°. Left side visible.\n"
    "  Column 3 — BACK: Weapon seen from behind. Back visible.\n"
    "  Column 4 — BACK-LEFT: Weapon rotated 135° away. Back and left side visible.\n\n"
    "ROWS (top to bottom) — 4 poses:\n"
    "  Row 1 — IDLE: {idle_desc}.\n"
    "  Row 2 — WALK STEP A: weapon swaying slightly, left foot forward motion.\n"
    "  Row 3 — WALK STEP B: weapon swaying slightly, right foot forward motion.\n"
    "  Row 4 — ATTACK: {attack_desc}.\n\n"
    "IMPORTANT RULES:\n"
    "- The image is EXACTLY 1024×1024. Each of the 16 cells is EXACTLY 256×256.\n"
    "- Leave 4–8 pixels of green gap between cells so they are clearly separated.\n"
    "- The weapon + hands fills ~60%% of each cell, centered in the cell.\n"
    "- The SAME weapon in ALL 16 cells — identical proportions and colors.\n"
    "- Only the POSE (row) and VIEWING ANGLE (column) change.\n"
    "- Pure bright GREEN (#00FF00) background in every cell and between cells.\n"
    "- NO full body, NO scenery, NO text, NO labels, NO watermarks.\n"
)

# Weapon archetypes — sprite_key must match WEAPON_SPRITE_MAP in Renderer.ts
WEAPON_ARCHETYPES = [
    {
        "sprite_key": "weapon_pistol",
        "name": "10mm Pistol",
        "description": (
            "A semi-automatic pistol held in one hand. Dark gunmetal gray "
            "with brown grip. Compact sidearm. Show the right hand gripping "
            "the pistol at waist level."
        ),
        "idle_desc": "weapon held at rest, relaxed grip at side",
        "attack_desc": "pistol raised and aimed forward, muzzle flash at barrel tip",
    },
    {
        "sprite_key": "weapon_rifle",
        "name": "Pipe Rifle",
        "description": (
            "A makeshift rifle made from pipes and scrap metal, held in both hands. "
            "Long barrel, rough welds visible. Show both hands gripping the rifle — "
            "right hand on trigger, left hand supporting the barrel."
        ),
        "idle_desc": "rifle held across chest at ready, relaxed grip",
        "attack_desc": "rifle shouldered and aimed, muzzle flash at barrel end",
    },
    {
        "sprite_key": "weapon_knife",
        "name": "Combat Knife",
        "description": (
            "A sturdy military combat knife with a dark blade and wrapped grip. "
            "Held in the right hand. Show the hand gripping the knife at waist level, "
            "blade pointing forward."
        ),
        "idle_desc": "knife held low at side, blade down, relaxed grip",
        "attack_desc": "knife thrust forward aggressively in a stabbing motion",
    },
    {
        "sprite_key": "weapon_bat",
        "name": "Baseball Bat",
        "description": (
            "A wooden baseball bat with nails hammered through the end. Held in "
            "both hands. Show both hands gripping the bat handle, bat resting "
            "on the shoulder or held at waist level."
        ),
        "idle_desc": "bat resting on shoulder, relaxed grip",
        "attack_desc": "bat swung in a wide horizontal arc, mid-swing",
    },
]


def build_weapon_spritesheet_prompt(
    name: str,
    description: str,
    attack_desc: str,
    config: dict,
    idle_desc: str = "weapon held at rest, relaxed grip",
) -> str:
    """Build a prompt for generating a weapon overlay sprite sheet.

    The sheet has 4 rows (idle, walk_1, walk_2, attack)
    × 4 columns (S, SW, N, NW) = 16 frames.
    The reprocessor mirrors and fills to produce the full 8×8.

    Targets 1024×1024 image (Gemini's native output size).
    """
    return WEAPON_SHEET_TEMPLATE.format(
        preamble=WEAPON_STYLE_PREAMBLE,
        name=name,
        description=description,
        idle_desc=idle_desc,
        attack_desc=attack_desc,
    )
