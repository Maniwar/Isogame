# CLAUDE.md — Isogame

> Reference guide for AI assistants working in this repository.

## Project Overview

**Isogame** is an isometric RPG game project inspired by classic titles like Fallout 2. The project aims to deliver a post-apocalyptic isometric role-playing experience with tile-based maps, character sprites, turn-based or real-time combat, dialogue systems, and inventory management.

**Repository status:** Early-stage / greenfield — the project is being bootstrapped and conventions below should be followed as code is added.

## Repository Structure

```
Isogame/
├── CLAUDE.md              # This file — AI assistant reference
├── src/                   # Application source code (to be created)
│   ├── engine/            # Core game engine (rendering, input, game loop)
│   ├── systems/           # ECS or game systems (combat, dialogue, inventory)
│   ├── entities/          # Game entities and components
│   ├── ui/                # HUD, menus, dialogue UI
│   ├── maps/              # Map loading, tile management, pathfinding
│   └── utils/             # Shared utilities and helpers
├── assets/                # Game assets
│   ├── tiles/             # Isometric tilesets (ground, walls, terrain)
│   ├── sprites/           # Character and NPC sprite sheets
│   ├── items/             # Inventory and item icons
│   ├── portraits/         # Dialogue character portraits
│   ├── ui/                # UI elements (HUD frames, buttons)
│   └── audio/             # Sound effects and music
├── scripts/               # Build scripts, asset pipelines, tooling
├── tests/                 # Test files
├── docs/                  # Additional documentation
└── config/                # Game configuration files
```

## Tech Stack

To be finalized. Likely candidates based on project goals:

- **Language:** TypeScript or Python
- **Rendering:** HTML5 Canvas / WebGL, or a framework like Phaser / Pixi.js
- **Build tool:** Vite, Webpack, or similar bundler
- **Package manager:** npm or yarn
- **Testing:** Jest, Vitest, or pytest depending on language choice
- **Asset pipeline:** Custom scripts (Python) for batch processing and sprite sheet generation

## Development Workflow

### Getting Started

```bash
# Clone the repository
git clone <repo-url>
cd Isogame

# Install dependencies (once package.json exists)
npm install   # or: pip install -r requirements.txt

# Run in development mode (once configured)
npm run dev   # or: python main.py
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

### Asset Conventions

- Isometric tiles should use a consistent base size (e.g., 64x32 or 128x64 pixels)
- Sprite sheets should follow a standardized layout per entity type
- Use a consistent, muted post-apocalyptic color palette
- Asset file names: lowercase, hyphen-separated (e.g., `wasteland-ground-01.png`)
- Keep raw/source assets separate from processed/optimized assets

### Map & Tile System

- Maps are tile-based with isometric projection
- Tile coordinates use a standard isometric grid system
- Map data should be stored in a structured format (JSON or custom format)
- Support for multiple layers (ground, objects, overhead)

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

## Useful Commands

Commands will be added here as the build system is configured:

```bash
# Placeholder — update once tooling is set up
npm run dev          # Start development server
npm run build        # Production build
npm run test         # Run test suite
npm run lint         # Lint source code
```
