"""Prompt templates for NPC dialogue portrait generation."""

PORTRAIT_STYLE_PREAMBLE = (
    "Create a character portrait in the style of classic Fallout 2 dialogue screens. "
    "The portrait should be a head-and-shoulders shot, facing slightly to one side. "
    "Use a muted post-apocalyptic color palette. "
    "The art style should be detailed, painterly pixel art with visible brushwork. "
    "Dark, moody lighting with a neutral or slightly warm background. "
)

PORTRAIT_TEMPLATE = (
    "{preamble}"
    "Character: {name} — {description}. "
    "Expression: {expression}. "
    "Portrait size: {width}x{height} pixels. "
    "The portrait should convey the character's personality and role. "
    "Weathered, lived-in faces with character and history. "
    "No text, no labels, no watermarks."
)

# Pre-defined NPC portraits for proof of concept
NPC_PORTRAITS = [
    {
        "name": "Sheriff Morgan",
        "description": (
            "A grizzled older woman with short gray hair, a sheriff's star pinned "
            "to a leather duster, a scar across her left cheek, and piercing eyes"
        ),
        "expression": "stern but fair, slight squint",
    },
    {
        "name": "Doc Hendricks",
        "description": (
            "A middle-aged man with round glasses, thinning hair, a lab coat "
            "over a sweater vest, and ink-stained fingers"
        ),
        "expression": "thoughtful, slightly worried",
    },
    {
        "name": "Scrap",
        "description": (
            "A young mechanic with goggles on the forehead, oil-smudged face, "
            "messy red hair, and a wide grin. Wears a jumpsuit with rolled sleeves"
        ),
        "expression": "enthusiastic, friendly grin",
    },
    {
        "name": "The Overseer",
        "description": (
            "An imposing figure in a pristine vault-tec jumpsuit, slicked-back "
            "dark hair, clean-shaven, with an authoritative bearing"
        ),
        "expression": "cold, calculating, slight smirk",
    },
    {
        "name": "Rattlesnake",
        "description": (
            "A dangerous-looking raider leader with face tattoos, shaved head, "
            "multiple piercings, and a necklace of bottle caps"
        ),
        "expression": "threatening, predatory smile",
    },
]


def build_portrait_prompt(
    name: str,
    description: str,
    expression: str,
    config: dict,
) -> str:
    """Build a prompt for generating an NPC dialogue portrait."""
    return PORTRAIT_TEMPLATE.format(
        preamble=PORTRAIT_STYLE_PREAMBLE,
        name=name,
        description=description,
        expression=expression,
        width=config["portraits"]["width"],
        height=config["portraits"]["height"],
    )
