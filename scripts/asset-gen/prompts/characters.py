"""Prompt templates for character sprite generation."""

CHAR_STYLE_PREAMBLE = (
    "Create an isometric character sprite in the style of classic Fallout 2. "
    "The character should be viewed from a top-down 3/4 isometric perspective. "
    "Use a muted, desaturated post-apocalyptic color palette. "
    "The art style should be detailed pixel art. "
    "Transparent background. "
)

# Direction labels for 8-directional sprites
DIRECTIONS = {
    "S":  "facing directly toward the camera (south)",
    "SW": "facing toward the bottom-right (southwest)",
    "W":  "facing to the right (west)",
    "NW": "facing toward the top-right (northwest)",
    "N":  "facing directly away from the camera (north)",
    "NE": "facing toward the top-left (northeast)",
    "E":  "facing to the left (east)",
    "SE": "facing toward the bottom-left (southeast)",
}

CHARACTER_TEMPLATE = (
    "{preamble}"
    "Character: {name} — {description}. "
    "Pose: {pose}. "
    "Direction: The character is {direction_desc}. "
    "Sprite size: {width}x{height} pixels. "
    "The proportions and outfit must be identical across all directional variants — "
    "only the viewing angle changes. "
    "No text, no labels, no watermarks."
)

REFERENCE_FOLLOW_UP = (
    "{preamble}"
    "Generate the SAME character shown in the reference image, but now {direction_desc}. "
    "Keep the exact same outfit, proportions, colors, and equipment. "
    "Only change the viewing angle. "
    "Sprite size: {width}x{height} pixels. "
    "No text, no labels, no watermarks."
)


# Pre-defined character archetypes for the proof of concept
CHARACTER_ARCHETYPES = [
    {
        "name": "Wastelander",
        "description": (
            "A rugged wasteland survivor wearing patched leather armor, "
            "a dusty duster coat, and a gas mask hanging around the neck. "
            "Carries a makeshift rifle on the back."
        ),
        "pose": "standing idle",
    },
    {
        "name": "Raider",
        "description": (
            "An aggressive raider with spiked shoulder pads, torn clothing, "
            "face paint, and a mohawk. Carries a lead pipe."
        ),
        "pose": "standing idle, menacing stance",
    },
    {
        "name": "Merchant",
        "description": (
            "A traveling merchant wearing a wide-brimmed hat, heavy backpack "
            "full of goods, and a worn but clean outfit. Friendly posture."
        ),
        "pose": "standing idle",
    },
]


def build_character_prompt(
    name: str,
    description: str,
    pose: str,
    direction: str,
    config: dict,
) -> str:
    """Build a prompt for generating a character sprite in a given direction."""
    return CHARACTER_TEMPLATE.format(
        preamble=CHAR_STYLE_PREAMBLE,
        name=name,
        description=description,
        pose=pose,
        direction_desc=DIRECTIONS[direction],
        width=config["sprites"]["base_width"],
        height=config["sprites"]["base_height"],
    )


def build_reference_prompt(direction: str, config: dict) -> str:
    """Build a follow-up prompt that references a previously generated sprite."""
    return REFERENCE_FOLLOW_UP.format(
        preamble=CHAR_STYLE_PREAMBLE,
        direction_desc=DIRECTIONS[direction],
        width=config["sprites"]["base_width"],
        height=config["sprites"]["base_height"],
    )
