"""Prompt templates for isometric environmental object generation.

Generates Fallout 2-style environmental objects and props for the wasteland map.
Objects are rendered on top of terrain tiles at isometric perspective.

Each object is a single transparent-background PNG showing one prop:
  - Viewed from top-down 3/4 isometric perspective (matching terrain)
  - Sized to fit within an isometric tile (64×32 game pixels)
  - Generation at 256×256 for quality, downscaled in post-processing

Object categories:
  - Debris: destroyed vehicles, rubble piles, scrap heaps
  - Containers: crates, lockers, dumpsters, barrels
  - Nature: dead trees, cacti, boulders, bones
  - Structures: fences, posts, signs, lamp posts
  - Hazards: toxic barrels, craters, mine fields
"""

OBJECT_STYLE_PREAMBLE = (
    "Create a single environmental object in the style of classic Fallout 2. "
    "Isometric top-down 3/4 perspective, matching a 2:1 diamond tile grid. "
    "Muted, desaturated post-apocalyptic palette: earthy browns, rust oranges, "
    "faded olive drab, dusty yellows, weathered grays. "
    "The art style is detailed pixel art with a gritty, sun-bleached, "
    "radioactive wasteland feel — like Fallout 2 (1998) environment art. "
    "Everything looks old, damaged, and decaying. Metal is rusted. "
    "Wood is splintered. Paint is peeling. Nothing is clean or new. "
    "CRITICAL: Transparent background (alpha channel). "
    "Draw ONLY the object — NO ground plane, NO shadows, NO text, NO labels. "
)

OBJECT_TEMPLATE = (
    "{preamble}"
    "Object: {name} — {description}\n\n"
    "IMAGE SIZE: {size} × {size} pixels.\n"
    "The object should be centered in the frame, occupying roughly "
    "60-80% of the image area.\n"
    "Isometric perspective: the viewer looks down at ~30 degrees.\n"
    "The object sits ON a ground plane (but don't draw the ground).\n\n"
    "RULES:\n"
    "- Transparent PNG background — no ground, no shadows\n"
    "- Match Fallout 2's art style: gritty, weathered, post-nuclear\n"
    "- Everything is old and damaged — rust, dents, scratches, wear\n"
    "- Consistent isometric 3/4 top-down viewing angle\n"
    "- No text, no labels, no watermarks\n"
)

OBJECT_SHEET_TEMPLATE = (
    "{preamble}"
    "Generate an OBJECT VARIANT SHEET with {count} variants of the same object.\n\n"
    "OBJECT: {name} — {description}\n\n"
    "IMAGE SIZE: 1024 × 1024 pixels.\n"
    "GRID: {cols} columns × {rows} rows = {count} cells, "
    "each {cell_size} × {cell_size} pixels.\n\n"
    "Each cell contains ONE variant of the object on a transparent background.\n"
    "All variants are the SAME type of object but with DIFFERENT visual details:\n"
    "{variant_list}\n\n"
    "RULES:\n"
    "- Each variant centered in its cell, ~60-80% of cell area\n"
    "- Transparent background in every cell\n"
    "- Same object type, different wear/damage/orientation\n"
    "- Consistent isometric 3/4 top-down perspective\n"
    "- Gritty Fallout 2 post-apocalyptic style\n"
    "- No text, no labels, no watermarks\n"
)


# ---------------------------------------------------------------------------
# Environmental object catalog — Fallout 2 wasteland props
#
# Each entry defines:
#   key: unique ID used in MapSystem (tile.object = key)
#   name: display name for prompts
#   description: visual description for AI generation
#   category: grouping for pipeline organization
#   blocking: whether this object blocks movement (Collision.Solid)
#   variants: optional list of variant descriptions for sheet generation
# ---------------------------------------------------------------------------

OBJECT_CATALOG = [
    # --- Debris ---
    {
        "key": "destroyed_car",
        "name": "Destroyed Car",
        "description": (
            "A rusted, burned-out husk of a 1950s-style retro-futuristic car. "
            "Shattered windows, flat tires, hood buckled open, paint completely "
            "stripped to bare rusted metal. Fallout-style rounded atomic-age design."
        ),
        "category": "debris",
        "blocking": True,
        "variants": [
            "Sedan with collapsed roof and missing doors",
            "Station wagon with open trunk, debris spilling out",
            "Compact car flipped on its side, undercarriage exposed",
            "Car with hood open, engine stripped for parts",
        ],
    },
    {
        "key": "scrap_pile",
        "name": "Scrap Metal Pile",
        "description": (
            "A heap of twisted scrap metal, bent rebar, corrugated sheet metal, "
            "rusted pipes, and broken machine parts. Salvageable junk pile."
        ),
        "category": "debris",
        "blocking": False,
        "variants": [
            "Tangled rebar and sheet metal scraps",
            "Pile of old pipes and mechanical parts",
            "Stack of crushed metal containers",
            "Mixed scrap with visible wiring and springs",
        ],
    },
    {
        "key": "tire_pile",
        "name": "Tire Pile",
        "description": (
            "A stack of old rubber tires, cracked and sun-bleached. "
            "Some stacked, some scattered. Dry-rotted and flattened."
        ),
        "category": "debris",
        "blocking": False,
    },
    {
        "key": "rubble_pile",
        "name": "Rubble Pile",
        "description": (
            "A mound of broken concrete chunks, brick fragments, and rebar. "
            "Collapsed building debris with dust and mortar powder."
        ),
        "category": "debris",
        "blocking": True,
    },

    # --- Containers ---
    {
        "key": "crate",
        "name": "Wooden Crate",
        "description": (
            "A weathered wooden shipping crate with faded military stencil markings. "
            "Boards are warped and split, nails rusting. Pre-war supply crate."
        ),
        "category": "containers",
        "blocking": True,
        "variants": [
            "Intact crate with faded US Army markings",
            "Half-broken crate with boards pried off, contents visible",
            "Stack of two crates, top one tilted",
            "Open crate with straw packing visible inside",
        ],
    },
    {
        "key": "dumpster",
        "name": "Dumpster",
        "description": (
            "A large rusted metal dumpster with dented sides, peeling paint, "
            "and a bent lid. Overflowing with trash and debris."
        ),
        "category": "containers",
        "blocking": True,
    },
    {
        "key": "footlocker",
        "name": "Footlocker",
        "description": (
            "A military-style metal footlocker, olive drab paint mostly "
            "chipped off, revealing rusted steel beneath. Dented corners, "
            "latch broken or missing."
        ),
        "category": "containers",
        "blocking": False,
    },
    {
        "key": "barrel",
        "name": "Metal Barrel",
        "description": (
            "A 55-gallon steel drum, rust-brown with dents and scrapes. "
            "Generic industrial barrel, no hazard markings."
        ),
        "category": "containers",
        "blocking": True,
    },

    # --- Nature ---
    {
        "key": "dead_tree",
        "name": "Dead Tree",
        "description": (
            "A leafless, gnarled dead tree with twisted bare branches. "
            "Bark is cracked and peeling, trunk gray and bleached by sun. "
            "Post-nuclear wasteland vegetation — completely lifeless."
        ),
        "category": "nature",
        "blocking": True,
        "variants": [
            "Tall dead tree with reaching skeletal branches",
            "Short twisted stump with one broken branch",
            "Forked dead tree, one trunk snapped off",
            "Thin dead tree leaning to one side",
        ],
    },
    {
        "key": "cactus",
        "name": "Wasteland Cactus",
        "description": (
            "A hardy desert cactus, one of the few living plants in the wasteland. "
            "Saguaro-style with arms, slightly yellowed and scarred but alive. "
            "Dusty green-brown color."
        ),
        "category": "nature",
        "blocking": True,
    },
    {
        "key": "bones",
        "name": "Skeleton Remains",
        "description": (
            "Bleached human or animal bones scattered on the ground. "
            "A partial skeleton — ribcage, skull, and scattered long bones. "
            "Sun-bleached white, half-buried in dirt."
        ),
        "category": "nature",
        "blocking": False,
    },
    {
        "key": "rock",
        "name": "Boulder",
        "description": (
            "A large weathered desert boulder, sandstone tan with reddish-brown "
            "iron staining. Rough, wind-eroded surface with visible layers."
        ),
        "category": "nature",
        "blocking": True,
        "variants": [
            "Large rounded boulder with wind-carved grooves",
            "Flat-topped rock with smaller stones around base",
            "Cluster of two medium rocks leaning together",
            "Angular broken rock slab, sharp edges",
        ],
    },

    # --- Structures ---
    {
        "key": "street_lamp",
        "name": "Broken Street Lamp",
        "description": (
            "A retro-futuristic 1950s-style street lamp post, bent and broken. "
            "Art deco design, rusted metal, shattered glass globe on top. "
            "The post leans at an angle. Atomic-age Americana gone to ruin."
        ),
        "category": "structures",
        "blocking": True,
    },
    {
        "key": "sign_post",
        "name": "Road Sign",
        "description": (
            "A damaged road sign on a bent metal post. The sign is faded, "
            "rusted, and riddled with bullet holes. Text barely readable. "
            "Could be a speed limit, town name, or warning sign."
        ),
        "category": "structures",
        "blocking": False,
    },
    {
        "key": "mailbox",
        "name": "Pre-War Mailbox",
        "description": (
            "A classic American blue mailbox, heavily rusted and dented. "
            "Door hanging open, paint almost completely gone. "
            "Retro 1950s US Postal Service style, atomic-age design."
        ),
        "category": "structures",
        "blocking": False,
    },
    {
        "key": "fire_hydrant",
        "name": "Fire Hydrant",
        "description": (
            "A squat fire hydrant with peeling red/yellow paint over heavy rust. "
            "Bolts corroded, one nozzle cap missing. Slightly tilted."
        ),
        "category": "structures",
        "blocking": False,
    },
    {
        "key": "fence_post",
        "name": "Broken Fence",
        "description": (
            "A section of broken wooden fence — two leaning posts with "
            "a few cracked planks still nailed on. Most boards missing or snapped. "
            "Gray weathered wood."
        ),
        "category": "structures",
        "blocking": False,
    },
    {
        "key": "tent",
        "name": "Makeshift Tent",
        "description": (
            "A crude shelter made from tarp and scavenged poles. "
            "Patched canvas in faded olive and brown, ropes fraying. "
            "A wastelander's temporary camp shelter."
        ),
        "category": "structures",
        "blocking": True,
    },

    # --- Hazards ---
    {
        "key": "toxic_barrel",
        "name": "Toxic Waste Barrel",
        "description": (
            "A cracked 55-gallon drum leaking glowing green radioactive waste. "
            "Yellow hazard trefoil symbol on the side, partially obscured by rust. "
            "Luminous green-yellow puddle seeping from the base."
        ),
        "category": "hazards",
        "blocking": True,
    },
    {
        "key": "crater",
        "name": "Impact Crater",
        "description": (
            "A small blast crater in the ground, roughly 3-4 feet across. "
            "Scorched earth, upturned dirt, and scattered debris around the rim. "
            "Could be from a mortar, grenade, or small explosive."
        ),
        "category": "hazards",
        "blocking": False,
    },
    {
        "key": "campfire",
        "name": "Campfire",
        "description": (
            "A ring of stones surrounding a small campfire with charred wood "
            "and glowing embers. A few sticks propped up for cooking. "
            "Recently used — thin smoke wisps visible."
        ),
        "category": "hazards",
        "blocking": False,
    },
]


def build_object_prompt(name: str, description: str, config: dict) -> str:
    """Build a prompt for generating a single environmental object."""
    size = config.get("objects", {}).get("size", 256)
    return OBJECT_TEMPLATE.format(
        preamble=OBJECT_STYLE_PREAMBLE,
        name=name,
        description=description,
        size=size,
    )


def build_object_sheet_prompt(
    name: str,
    description: str,
    variants: list[str],
    config: dict,
) -> str:
    """Build a prompt for generating an object variant sheet.

    Produces a grid image with multiple variants of the same object type.
    """
    count = len(variants)
    if count <= 4:
        cols, rows = 2, 2
    else:
        cols, rows = 3, 3

    cell_size = 1024 // max(cols, rows)

    variant_list = "\n".join(
        f"  {i + 1}. {desc}" for i, desc in enumerate(variants)
    )

    return OBJECT_SHEET_TEMPLATE.format(
        preamble=OBJECT_STYLE_PREAMBLE,
        name=name,
        description=description,
        count=count,
        cols=cols,
        rows=rows,
        cell_size=cell_size,
        variant_list=variant_list,
    )
