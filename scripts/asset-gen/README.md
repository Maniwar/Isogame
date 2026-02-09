# Isogame Asset Generator

AI-powered asset pipeline for generating Fallout 2-style isometric game art using Google's Gemini image generation API.

## Setup

```bash
cd scripts/asset-gen
pip install -r requirements.txt
```

Set your Gemini API key:

```bash
export GEMINI_API_KEY="your-api-key-here"
```

Get a key at [Google AI Studio](https://aistudio.google.com/apikey).

## Usage

### Dry Run (preview prompts, no API calls)

```bash
python generate.py --dry-run
python generate.py --dry-run --category tiles
```

### Generate Assets

```bash
# Generate everything
python generate.py

# Generate specific categories
python generate.py --category tiles
python generate.py --category characters
python generate.py --category items
python generate.py --category portraits
```

### Style References

For better consistency, provide reference images:

```bash
python generate.py --reference-dir ./references
```

Place 1-14 reference images (PNG/JPG) in the directory. These are sent alongside each prompt to guide the model's style output.

### Post-Processing

After generation, run the post-processor to enforce palette consistency, resize to exact dimensions, clean transparency, and assemble sprite sheets:

```bash
# Process everything
python postprocess.py

# Process specific category
python postprocess.py --category tiles
python postprocess.py --category sprites

# Skip palette reduction
python postprocess.py --no-palette
```

## Directory Structure

```
asset-gen/
├── config.yaml          # Style, palette, dimensions, batch definitions
├── generate.py          # Main generation script (Gemini API)
├── postprocess.py       # Palette reduction, resizing, sprite sheets
├── deploy-assets.py     # Copy processed assets into game's public/ + manifest
├── requirements.txt     # Python dependencies
├── prompts/
│   ├── tiles.py         # Tile prompt templates
│   ├── characters.py    # Character sprite prompt templates (sprite_key mapped to game)
│   ├── items.py         # Inventory icon prompt templates (icon_key mapped to game)
│   └── portraits.py     # NPC portrait prompt templates
├── output/              # Raw generated assets (gitignored)
└── processed/           # Post-processed assets (gitignored)
```

## Deploying to the Game

After generating and post-processing assets, deploy them into the game:

```bash
python deploy-assets.py
```

This copies processed PNGs into `../../public/assets/` and generates a `manifest.json`.
The game's `AssetManager` loads the manifest at startup and uses AI art for any asset
that has a PNG, falling back to procedural for the rest. No code changes needed.

## Configuration

Edit `config.yaml` to customize:

- **style** — Base style keywords and description
- **palette** — Target color palette (hex values)
- **tiles/sprites/items/portraits** — Dimensions and format settings
- **api** — Model name, rate limits, retry settings
- **batches** — What tiles to generate (variants and counts)

## Proof of Concept Scope

The default config generates:

| Category    | Count | Description                          |
|-------------|-------|--------------------------------------|
| Ground tiles| 20    | Cracked earth, sand, roads, rubble   |
| Wall tiles  | 10    | Brick, concrete, metal, sandbags     |
| Terrain     | 10    | Water, craters, waste, campfires     |
| Characters  | 24    | 3 archetypes x 8 directions          |
| Items       | 16    | Weapons, armor, consumables, misc    |
| Portraits   | 5     | NPC dialogue portraits               |
| **Total**   | **85**|                                      |

## Tips

- **Start small**: Run `--category tiles` first to validate style consistency before generating everything
- **Iterate on prompts**: Edit `prompts/*.py` to refine the style. Use `--dry-run` to preview
- **Reference images matter**: Even 2-3 good reference images dramatically improve consistency
- **Post-process always**: Raw AI output needs palette reduction and resizing for game-ready assets
- **Rate limits**: The default is 10 requests/minute. Adjust in `config.yaml` based on your API tier
