"""Prompt templates for weapon overlay sprite sheet generation.

Weapon sprites are generated as overlays — they show only the weapon and
the hands/arms holding it, designed to be composited on top of unarmed
character sprites at runtime.

Layout matches character sheets: 8 rows (animations) x 8 columns (directions).
Uses a chroma key green (#00FF00) background for reliable alpha extraction.
"""

from .characters import DIRECTIONS, DIRECTION_LABELS, ANIMATIONS, ANIMATION_LABELS

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
    "LAYOUT: The sprite sheet is a grid with {num_rows} rows and {num_cols} columns.\n"
    "Each cell is {cell_w}x{cell_h} pixels.\n"
    "Total image size: {sheet_w}x{sheet_h} pixels.\n\n"
    "ROWS (top to bottom — each row is one weapon pose):\n"
    "{row_descriptions}\n\n"
    "COLUMNS (left to right — each column is one viewing direction):\n"
    "{col_descriptions}\n\n"
    "CRITICAL RULES:\n"
    "- Every cell must show the SAME weapon with identical proportions and colors.\n"
    "- Only the POSE (row) and VIEWING ANGLE (column) change between cells.\n"
    "- The weapon + hands should be centered in each cell at chest/waist height.\n"
    "- Use pure bright green (#00FF00) chroma key background in every cell.\n"
    "- Draw ONLY the weapon + hands/forearms — nothing else.\n"
    "- No text, no labels, no watermarks, no grid lines.\n"
)

WEAPON_ANIMATION_LABELS = {
    "idle":      "weapon held at rest, relaxed grip at side or in front",
    "walk_1":    "weapon swaying slightly with walking motion, left foot forward",
    "walk_2":    "weapon swaying mid-stride, transitioning between steps",
    "walk_3":    "weapon swaying slightly with walking motion, right foot forward",
    "walk_4":    "weapon swaying mid-stride, transitioning back",
    "attack_1":  "weapon drawn back in wind-up, preparing to strike",
    "attack_2":  "{attack_desc}",
    "hit":       "weapon lowered, recoiling from incoming damage",
}

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
        "attack_desc": "bat swung in a wide horizontal arc, mid-swing",
    },
]


def build_weapon_spritesheet_prompt(
    name: str,
    description: str,
    attack_desc: str,
    config: dict,
) -> str:
    """Build a prompt for generating a weapon overlay sprite sheet.

    Same 8 rows x 8 columns layout as character sheets.
    """
    cell_w = config["sprites"]["base_width"]
    cell_h = config["sprites"]["base_height"]
    num_cols = len(DIRECTIONS)
    num_rows = len(ANIMATIONS)
    sheet_w = cell_w * num_cols
    sheet_h = cell_h * num_rows

    row_descriptions = []
    for i, anim in enumerate(ANIMATIONS):
        label = WEAPON_ANIMATION_LABELS[anim]
        if "{attack_desc}" in label:
            label = label.format(attack_desc=attack_desc)
        row_descriptions.append(f"  Row {i + 1}: {label}")
    row_desc_str = "\n".join(row_descriptions)

    col_descriptions = "\n".join(
        f"  Column {i + 1}: {DIRECTION_LABELS[d]}"
        for i, d in enumerate(DIRECTIONS)
    )

    return WEAPON_SHEET_TEMPLATE.format(
        preamble=WEAPON_STYLE_PREAMBLE,
        name=name,
        description=description,
        num_rows=num_rows,
        num_cols=num_cols,
        cell_w=cell_w,
        cell_h=cell_h,
        sheet_w=sheet_w,
        sheet_h=sheet_h,
        row_descriptions=row_desc_str,
        col_descriptions=col_descriptions,
    )
