# CLAUDE.md — Isogame

> Reference guide for AI assistants working in this repository.

## Project Overview

**Isogame** is an isometric RPG game project inspired by classic titles like Fallout 2. The project aims to deliver a post-apocalyptic isometric role-playing experience with tile-based maps, character sprites, turn-based or real-time combat, dialogue systems, and inventory management.

## Repository Structure

```
Isogame/
├── CLAUDE.md              # This file — AI assistant reference
├── index.html             # Entry HTML — loads the game canvas
├── package.json           # Node dependencies (vite, typescript)
├── tsconfig.json          # TypeScript strict config
├── vite.config.ts         # Vite dev server + build config
├── src/
│   ├── main.ts            # Boot sequence — init, load, start game loop
│   ├── types.ts           # All shared types, enums, constants (TILE_W=64, TILE_H=32)
│   ├── engine/
│   │   ├── Game.ts        # Main game class — loop, phase routing, update/draw
│   │   ├── Renderer.ts    # Isometric tile + entity + UI rendering
│   │   ├── Camera.ts      # Pan, zoom, smooth follow, iso coordinate transforms
│   │   └── Input.ts       # Keyboard + mouse state, drag, wheel, click tracking
│   ├── systems/
│   │   ├── MapSystem.ts   # Procedural map generation (40x40 wasteland)
│   │   ├── EntitySystem.ts    # Entity factory (player + NPCs)
│   │   ├── MovementSystem.ts  # A* pathfinding + smooth movement interpolation
│   │   ├── CombatSystem.ts    # Turn-based combat (initiative, attack, AI)
│   │   ├── DialogueSystem.ts  # Dialogue trees with branching + item rewards
│   │   └── InventorySystem.ts # Item database, add/remove/use/equip
│   ├── ui/
│   │   ├── HUD.ts         # Health/AP bars, equipped weapon, game time, controls
│   │   ├── DialogueUI.ts  # Full-screen dialogue panel with clickable responses
│   │   └── InventoryUI.ts # Categorized inventory with use/equip on click
│   └── assets/
│       └── AssetManager.ts    # Procedural art generator (tiles, sprites, objects, items)
├── scripts/
│   └── asset-gen/         # AI asset generation pipeline (Gemini API)
│       ├── config.yaml    # Style, palette, dimensions, batch definitions
│       ├── generate.py    # Main generation script
│       ├── postprocess.py # Palette reduction, resizing, sprite sheets
│       └── prompts/       # Prompt templates per asset category
└── dist/                  # Production build output (gitignored)
```

## Tech Stack

- **Language:** TypeScript (strict mode)
- **Rendering:** HTML5 Canvas 2D — raw API, no framework
- **Build tool:** Vite 5
- **Package manager:** npm
- **Isometric engine:** Custom — 64x32 diamond tiles, 2:1 projection
- **Asset pipeline:** Python scripts using Gemini API for AI-generated art, plus Pillow/NumPy for post-processing
- **Procedural placeholders:** All art generated at runtime via Canvas 2D (no external images required)

## Development Workflow

### Getting Started

```bash
npm install          # Install dependencies
npm run dev          # Start dev server at localhost:3000
npm run build        # Production build to dist/
npx tsc --noEmit     # Type-check without emitting
```

### Branch Strategy

- `main` — stable, release-ready code
- `claude/*` — AI-assisted feature branches
- Feature branches should be short-lived and merged via pull request

### Commit Conventions

- Use clear, imperative commit messages: `Add tile rendering system`, `Fix pathfinding diagonal movement`
- Prefix with category when helpful: `engine:`, `assets:`, `ui:`, `docs:`
- Keep commits atomic — one logical change per commit

### Code Quality

- Run linting before committing (once configured)
- Write tests for game systems and utilities
- Avoid committing generated or binary files that can be reproduced from source

## Key Conventions

### Code Style

- Prefer clarity over cleverness — game code should be readable
- Use descriptive variable and function names
- Keep files focused on a single responsibility
- Add comments only where logic is non-obvious

### Architecture Principles

- **Separation of concerns:** Keep rendering, game logic, and data/state separate
- **Data-driven design:** Game content (maps, items, dialogue) should be defined in data files (JSON/YAML), not hardcoded
- **Modularity:** Systems should be independently testable and loosely coupled

### Isometric Coordinate System

- Tile size: 64x32 pixels (2:1 ratio diamond)
- Tile-to-screen: `screenX = (tileX - tileY) * 32`, `screenY = (tileX + tileY) * 16`
- Rendering order: iterate `y` then `x` (painter's algorithm, back-to-front)
- Constants defined in `src/types.ts`: `TILE_W`, `TILE_H`, `TILE_HALF_W`, `TILE_HALF_H`

### Asset Conventions

- Tile sprites: 64x32 isometric diamonds with transparent backgrounds
- Character sprites: 24x36, generated for 8 directions (N, NE, E, SE, S, SW, W, NW)
- Item icons: 20x20
- All placeholder art is procedurally generated in `AssetManager.ts`
- File names: lowercase, underscore-separated for sprite keys (e.g., `npc_sheriff`)

### Map System

- Maps are 2D arrays of `Tile` objects (`tiles[y][x]`)
- Terrain enum: Sand, Dirt, CrackedEarth, Rubble, Road, Concrete, Grass, Water
- Collision enum: None (walkable), Solid (blocked), Water (impassable)
- Tiles can have optional `object` keys (wall, barrel, rock)
- Maps define spawn points, NPC spawns, and item pickups

## Testing

- Test game systems (combat calculations, inventory logic, pathfinding) with unit tests
- Integration tests for system interactions where needed
- Manual playtesting for rendering and UX — document test scenarios in `docs/`

## AI Assistant Guidelines

When working in this repository:

1. **Read before modifying** — always read existing files before making changes
2. **Follow existing patterns** — match the style and architecture already in place
3. **Keep changes focused** — do not refactor unrelated code or add unrequested features
4. **Test your changes** — run the test suite after modifications
5. **Use data-driven approaches** — game content belongs in data files, not source code
6. **Avoid large binary commits** — do not commit large generated assets without discussion
7. **Document new systems** — add brief inline comments for complex game logic
8. **Preserve save compatibility** — be cautious with changes to serialized data structures

## Asset Generation Pipeline

The `scripts/asset-gen/` directory contains a complete AI-powered asset pipeline using Google's Gemini API.

### Quick Start

```bash
cd scripts/asset-gen
pip install -r requirements.txt
export GEMINI_API_KEY="your-key"

# Preview prompts (no API calls)
python generate.py --dry-run

# Generate a specific category
python generate.py --category tiles

# Post-process generated assets
python postprocess.py
```

### Pipeline Overview

1. **generate.py** — Calls Gemini API with crafted prompts to produce raw images
2. **postprocess.py** — Enforces palette consistency, resizes to exact dimensions, cleans transparency, assembles sprite sheets
3. **config.yaml** — Central config for palette colors, tile dimensions, batch definitions, and API settings
4. **prompts/** — Modular prompt templates for tiles, characters, items, and portraits

### Style Consistency

- Feed reference images via `--reference-dir` (up to 14 images) for multi-reference style guidance
- Post-processor maps all colors to the defined Fallout 2 palette
- Character sprites are generated per-direction with consistent prompt phrasing

See `scripts/asset-gen/README.md` for full documentation.

## Useful Commands

```bash
# Asset generation
cd scripts/asset-gen
python generate.py --dry-run              # Preview all prompts
python generate.py --category tiles       # Generate tile assets
python generate.py --category characters  # Generate character sprites
python generate.py --category items       # Generate item icons
python generate.py --category portraits   # Generate NPC portraits
python generate.py                        # Generate everything
python postprocess.py                     # Post-process all output

# Game
npm run dev                               # Dev server on localhost:3000
npm run build                             # Production build
npx tsc --noEmit                          # Type-check
```

## Game Controls

- **Left click** — Move player / interact with NPCs / attack in combat
- **Right drag** — Pan camera
- **Scroll wheel** — Zoom in/out
- **TAB** — Toggle inventory
- **C** — Toggle combat mode
- **SPACE** — End turn (combat)
- **ESC** — Cancel / return to explore mode

## Game Content

### Current Map: "Dusty Springs" (40x40)
- Settlement in center with 3 buildings (sheriff office, trading post, clinic)
- Roads cross through the middle
- Water borders, scattered rocks/barrels, varied terrain

### NPCs
- **Sheriff Morgan** — Quest giver (raider clearing quest, gives stimpak)
- **Scrapper Joe** — Merchant (sells stimpaks, Nuka-Cola)
- **Doc Hendricks** — Healer (free stimpak on first visit)
- **3 Raiders** — Hostile, northwest and southeast of settlement

### Items (12 types)
- Weapons: 10mm Pistol, Pipe Rifle, Combat Knife, Baseball Bat
- Armor: Leather Armor
- Consumables: Stimpak, Rad-Away, Nuka-Cola, Canned Food
- Misc: Bottle Caps, Bobby Pin, Holotape
