"""Prompt templates for inventory item icon generation."""

ITEM_STYLE_PREAMBLE = (
    "Create an inventory icon in the style of classic Fallout 2. "
    "The icon should be a clear, recognizable depiction of the item "
    "on a transparent background. "
    "Use a muted post-apocalyptic color palette with earthy tones. "
    "The style should be detailed pixel art, slightly isometric perspective. "
)

ITEM_TEMPLATE = (
    "{preamble}"
    "Item: {name} — {description}. "
    "Icon size: {size}x{size} pixels. "
    "The item should look worn, used, and weathered — fitting for a post-apocalyptic setting. "
    "Centered in the frame with a small margin. "
    "No text, no labels, no watermarks."
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
    return ITEM_TEMPLATE.format(
        preamble=ITEM_STYLE_PREAMBLE,
        name=name,
        description=description,
        size=config["items"]["icon_size"],
    )
