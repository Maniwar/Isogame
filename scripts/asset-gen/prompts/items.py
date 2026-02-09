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

# Pre-defined item categories for proof of concept
ITEM_CATALOG = [
    # Weapons
    {"name": "Pipe Rifle", "description": "A makeshift rifle assembled from pipes and scrap metal, held together with duct tape", "category": "weapons"},
    {"name": "Combat Knife", "description": "A sturdy military combat knife with a worn leather grip", "category": "weapons"},
    {"name": "Molotov Cocktail", "description": "A glass bottle filled with fuel, rag stuffed in the neck", "category": "weapons"},
    {"name": "10mm Pistol", "description": "A well-used semi-automatic pistol, scratched and dented", "category": "weapons"},
    {"name": "Baseball Bat", "description": "A wooden baseball bat with nails driven through the head", "category": "weapons"},

    # Armor
    {"name": "Leather Armor", "description": "Patched leather chest armor with metal studs", "category": "armor"},
    {"name": "Metal Helmet", "description": "A dented military-style metal helmet with scratches", "category": "armor"},
    {"name": "Combat Boots", "description": "Heavy-duty military boots, worn but sturdy", "category": "armor"},

    # Consumables
    {"name": "Stimpak", "description": "A medical syringe with a red cross label, futuristic 1950s design", "category": "consumables"},
    {"name": "Rad-Away", "description": "An IV bag filled with amber anti-radiation fluid", "category": "consumables"},
    {"name": "Canned Food", "description": "A dented tin can with a faded, peeling food label", "category": "consumables"},
    {"name": "Dirty Water", "description": "A plastic bottle of murky, slightly greenish water", "category": "consumables"},
    {"name": "Nuka-Cola", "description": "A retro-futuristic glass soda bottle with a rocket-shaped logo, glowing slightly", "category": "consumables"},

    # Misc
    {"name": "Bottle Caps", "description": "A small pile of metal bottle caps used as currency", "category": "misc"},
    {"name": "Bobby Pin", "description": "A bent hair pin used for lockpicking", "category": "misc"},
    {"name": "Holotape", "description": "A small retro-futuristic data cassette tape", "category": "misc"},
]


def build_item_prompt(name: str, description: str, config: dict) -> str:
    """Build a prompt for generating an inventory item icon."""
    return ITEM_TEMPLATE.format(
        preamble=ITEM_STYLE_PREAMBLE,
        name=name,
        description=description,
        size=config["items"]["icon_size"],
    )
