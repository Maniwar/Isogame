"""Prompt templates for NPC dialogue portrait generation."""

PORTRAIT_STYLE_PREAMBLE = (
    "Create a character portrait in the style of Fallout 2 (1998, Black Isle Studios) "
    "dialogue screens — the 'talking heads' aesthetic. "
    "Head-and-shoulders shot, facing slightly to one side, tight framing. "
    "Desaturated post-nuclear color palette: skin tones are weathered and sun-damaged, "
    "clothing is faded and dusty, lighting is harsh overhead like desert sun. "
    "Art style: realistic painted pre-rendered 3D look with visible texture and grit — "
    "NOT cartoon, NOT pixel art. Like a pre-rendered 3D character portrait from "
    "the late 1990s. NO dark outlines or borders around the character. "
    "Background: solid dark warm tone — RGB(60, 45, 30) dark brown or similar. "
    "NOT pure black. NOT transparent. A warm, muted earth-tone background that "
    "frames the character like the Fallout 2 dialogue screen. "
    "Faces show age, scars, dirt, sunburn — life in the wasteland is hard. "
)

PORTRAIT_TEMPLATE = (
    "{preamble}"
    "Character: {name} — {description}.\n"
    "Expression: {expression}.\n\n"
    "IMAGE SIZE: {width} × {height} pixels.\n\n"
    "FRAMING:\n"
    "- Head positioned in the upper third of the frame with ~15%% headroom above.\n"
    "- Shoulders visible at the bottom, cropped mid-chest.\n"
    "- Face is the focal point — eyes roughly 1/3 from the top.\n"
    "- Character fills ~80%% of the frame width. Centered or slightly off-center.\n"
    "- Head slightly turned to one side (3/4 view) for depth and personality.\n\n"
    "The portrait should convey the character's personality and role.\n"
    "Weathered, lived-in faces with character and history.\n\n"
    "RULES:\n"
    "- Solid dark warm-toned background — NOT transparent, NOT pure black\n"
    "- NO dark outlines or borders around the character\n"
    "- Pre-rendered 3D painted look, NOT flat cartoon\n"
    "- Harsh overhead desert lighting with visible highlights and deep shadows\n"
    "- NO text, NO labels, NO watermarks\n"
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
    {
        "name": "Guard Captain",
        "description": (
            "A battle-hardened settlement guard with a scarred face, combat helmet, "
            "and makeshift metal armor. Square jaw, alert eyes scanning for threats"
        ),
        "expression": "vigilant, stern, no-nonsense",
    },
    {
        "name": "Bone Feather",
        "description": (
            "A young tribal warrior with face paint in geometric patterns, "
            "bone piercings, feathers braided into long dark hair, and animal "
            "hide necklace. Sun-darkened skin"
        ),
        "expression": "proud, wary, intense gaze",
    },
    {
        "name": "Old Pete",
        "description": (
            "A grizzled caravan driver, deeply tanned with sun-crinkled eyes, "
            "a wide-brimmed leather hat, gray stubble, and a perpetual squint. "
            "Looks like he's seen every mile of wasteland road"
        ),
        "expression": "weary but friendly, knowing half-smile",
    },
    {
        "name": "Grim",
        "description": (
            "A civilized ghoul with patches of raw tissue where skin has "
            "sloughed off, sunken eyes, no nose, wearing a pre-war fedora "
            "and a surprisingly well-maintained suit jacket over a rotting shirt"
        ),
        "expression": "sardonic, world-weary, dark humor",
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
