"""Prompt templates for weapon overlay sprite sheet generation.

Weapon sprites are generated as overlays — they show only the weapon and
the hands/arms holding it, designed to be composited on top of unarmed
character sprites at runtime.

NOTE: Weapon overlays are currently unused by the game engine. The game
uses weapon-variant character sprites (player_pistol, player_rifle, etc.)
instead of compositing overlays at runtime. This module is kept for
potential future use.

Generates a full 8×8 sprite sheet per weapon inside a 2048×2048 image:
  8 columns = 8 viewing directions (S, SW, W, NW, N, NE, E, SE)
  8 rows    = 8 animation poses   (idle, walk×4, attack×2, hit)
  = 64 frames per weapon, each in a 256×256 cell

Uses gemini-3-pro-image-preview with image_size="2K" for native 2048×2048.
"""

from .characters import DIRECTIONS, DIRECTION_LABELS, ANIMATIONS, ANIMATION_LABELS

WEAPON_STYLE_PREAMBLE = (
    "Create a weapon overlay sprite in the style of Fallout 2 "
    "(1998, Black Isle Studios). "
    "Top-down 3/4 isometric perspective. "
    "Art style: detailed pre-rendered 3D look — NOT flat cartoon or pixel art. "
    "Muted, desaturated post-apocalyptic color palette with earthy tones. "
    "NO dark outlines or black borders around the weapon or hands. "
    "Edges transition directly from surface material to green background "
    "with a soft 1-2 pixel anti-aliased blend — NO hard pixel-perfect cutouts. "
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
    "IMAGE SIZE: 2048 × 2048 pixels.\n"
    "GRID: 8 columns × 8 rows = 64 cells, each exactly 256 × 256 pixels.\n\n"
    "COLUMNS (left to right) — 8 viewing angles, rotating clockwise:\n"
    "  Col 1 — FRONT: Weapon seen from directly in front.\n"
    "  Col 2 — FRONT-LEFT 3/4: Weapon rotated 45°. Left side visible.\n"
    "  Col 3 — LEFT PROFILE: Weapon seen from the left side.\n"
    "  Col 4 — BACK-LEFT 3/4: Weapon rotated 135° away.\n"
    "  Col 5 — BACK: Weapon seen from behind.\n"
    "  Col 6 — BACK-RIGHT 3/4: Weapon rotated 135° the other way.\n"
    "  Col 7 — RIGHT PROFILE: Weapon seen from the right side.\n"
    "  Col 8 — FRONT-RIGHT 3/4: Weapon rotated 45° the other way.\n\n"
    "ROWS (top to bottom) — 8 poses:\n"
    "  Row 1 — IDLE: {idle_desc}.\n"
    "  Row 2 — WALK 1: Weapon swaying slightly, left foot forward motion.\n"
    "  Row 3 — WALK 2: Weapon swaying slightly, right foot forward motion.\n"
    "  Row 4 — WALK 3: Weapon mid-sway, passing position.\n"
    "  Row 5 — WALK 4: Weapon mid-sway, opposite passing.\n"
    "  Row 6 — ATTACK WIND-UP: Weapon drawn back, preparing to strike.\n"
    "  Row 7 — ATTACK STRIKE: {attack_desc}.\n"
    "  Row 8 — HIT REACTION: Weapon lowered, recoiling from incoming damage.\n\n"
    "GRID LAYOUT:\n"
    "- Cell boundaries are a strict pixel grid — 256px per cell:\n"
    "    Columns: x=0–255, 256–511, 512–767, 768–1023, 1024–1279, 1280–1535, 1536–1791, 1792–2047\n"
    "    Rows: y=0–255, 256–511, 512–767, 768–1023, 1024–1279, 1280–1535, 1536–1791, 1792–2047\n"
    "- Software will slice this image into 64 individual cells at these exact coordinates.\n\n"
    "IMPORTANT RULES:\n"
    "- The image is EXACTLY 2048×2048. Each of the 64 cells is EXACTLY 256×256.\n"
    "- SIZING: The weapon + hands must fit within a 180 × 180 pixel area CENTERED "
    "in each 256×256 cell. This leaves 38px of green padding on every side. "
    "No part of the weapon may touch the cell edges.\n"
    "- The SAME weapon in ALL 64 cells — identical proportions and colors.\n"
    "- Only the POSE (row) and VIEWING ANGLE (column) change.\n"
    "- Pure bright GREEN (#00FF00) background in every cell and between cells.\n"
    "- NO dark outlines or borders around the weapon or hands.\n"
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
    """Build a prompt for generating a full 8×8 weapon overlay sprite sheet.

    The sheet has 8 rows (animations) × 8 columns (directions) = 64 frames.
    Uses gemini-3-pro-image-preview at 2K (2048×2048) for 256×256 per cell.
    """
    return WEAPON_SHEET_TEMPLATE.format(
        preamble=WEAPON_STYLE_PREAMBLE,
        name=name,
        description=description,
        idle_desc=idle_desc,
        attack_desc=attack_desc,
    )
