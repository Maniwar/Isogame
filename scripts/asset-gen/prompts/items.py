"""Prompt templates for inventory item icon generation."""

ITEM_STYLE_PREAMBLE = (
    "Create an inventory icon in the style of Fallout 2 (1998, Black Isle Studios). "
    "The icon should be a clear, recognizable depiction of the item. "
    "Desaturated post-nuclear color palette: rusty browns, olive drab, "
    "weathered metal grays, faded labels. Nothing looks new or clean. "
    "Art style: pre-rendered 3D look with visible wear and texture detail — "
    "matching the Fallout 2 inventory screen aesthetic. "
    "NOT flat cartoon or pixel art. "
    "NO dark outlines or black borders around the item. "
    "Item edges transition directly from the object surface to the green background "
    "with a soft 1-2 pixel anti-aliased blend — NO hard pixel-perfect cutouts. "
    "Slightly angled top-down perspective, like items laid on a table. "
    "CRITICAL: Pure bright GREEN (#00FF00) chroma key background everywhere. "
    "The ENTIRE background must be solid bright green RGB(0, 255, 0). "
    "This green is a chroma key — software will replace it with transparency. "
    "Fill ALL empty space with this exact green. "
    "DO NOT use a checkered pattern, gray, white, or any other background color. "
    "DO NOT attempt to make the background transparent — use SOLID GREEN instead. "
)

ITEM_TEMPLATE = (
    "{preamble}"
    "Item: {name} — {description}.\n\n"
    "IMAGE SIZE: {size} × {size} pixels.\n"
    "SIZING: The item must fit within a {safe_size} × {safe_size} pixel area "
    "centered in the {size} × {size} frame. This leaves {padding} pixels of "
    "transparent padding on every side. The item MUST NOT touch the image edges.\n\n"
    "The item should look worn, used, and weathered — fitting for a post-apocalyptic setting.\n"
    "RULES:\n"
    "- Pure bright GREEN (#00FF00) background — NOT transparent, NOT checkered, NOT gray\n"
    "- Fill ALL empty space with solid RGB(0,255,0) green — this is a chroma key\n"
    "- NO ground plane, NO drop shadows, NO cast shadows\n"
    "- NO dark outlines or borders around the item edges\n"
    "- Item edges transition from surface material to green with soft anti-aliased blend\n"
    "- Pre-rendered 3D look, NOT flat cartoon\n"
    "- NO text, NO labels, NO watermarks\n"
)

# Item catalog — icon_key must match the game's ITEM_DB icon values in InventorySystem.ts
ITEM_CATALOG = [
    # Weapons
    {"name": "10mm Pistol", "icon_key": "item_pistol", "description": "A well-used semi-automatic pistol, scratched and dented", "category": "weapons"},
    {"name": "Pipe Rifle", "icon_key": "item_rifle", "description": "A makeshift rifle assembled from pipes and scrap metal, held together with duct tape", "category": "weapons"},
    {"name": "Combat Knife", "icon_key": "item_knife", "description": "A sturdy military combat knife with a worn leather grip", "category": "weapons"},
    {"name": "Baseball Bat", "icon_key": "item_bat", "description": "A wooden baseball bat with nails driven through the head", "category": "weapons"},

    # Armor
    {"name": "Leather Armor", "icon_key": "item_armor", "description": "Patched leather chest armor with metal studs", "category": "armor"},

    # Consumables
    {"name": "Stimpak", "icon_key": "item_stimpak", "description": "A medical syringe with a red cross label, futuristic 1950s design", "category": "consumables"},
    {"name": "Rad-Away", "icon_key": "item_radaway", "description": "An IV bag filled with amber anti-radiation fluid", "category": "consumables"},
    {"name": "Nuka-Cola", "icon_key": "item_nuka", "description": "A retro-futuristic glass soda bottle with a rocket-shaped logo, glowing slightly", "category": "consumables"},
    {"name": "Canned Food", "icon_key": "item_food", "description": "A dented tin can with a faded, peeling food label", "category": "consumables"},

    # Misc
    {"name": "Bottle Caps", "icon_key": "item_caps", "description": "A small pile of metal bottle caps used as currency", "category": "misc"},
    {"name": "Bobby Pin", "icon_key": "item_pin", "description": "A bent hair pin used for lockpicking", "category": "misc"},
    {"name": "Holotape", "icon_key": "item_holotape", "description": "A small retro-futuristic data cassette tape", "category": "misc"},
]


def build_item_prompt(name: str, description: str, config: dict) -> str:
    """Build a prompt for generating an inventory item icon."""
    size = config["items"]["icon_size"]
    padding = max(size // 8, 4)  # ~12% padding, minimum 4px
    safe_size = size - 2 * padding
    return ITEM_TEMPLATE.format(
        preamble=ITEM_STYLE_PREAMBLE,
        name=name,
        description=description,
        size=size,
        safe_size=safe_size,
        padding=padding,
    )
