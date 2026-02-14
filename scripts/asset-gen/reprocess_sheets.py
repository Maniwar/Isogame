#!/usr/bin/env python3
"""
Re-process existing sprite sheets from public/assets/sprites/ using the
fixed pipeline (unified bounding boxes + interior hole filling).

This script:
1. Finds all *-sheet.png files in public/assets/sprites/
2. Copies them to the expected output directory structure
3. Runs the fixed postprocess pipeline
4. Deploys the reprocessed assets back
"""

import shutil
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))

from postprocess import (
    load_config,
    slice_and_save_character_sheet,
)

PUBLIC_SPRITES = SCRIPT_DIR.parent.parent / "public" / "assets" / "sprites"
PROCESSED_DIR = SCRIPT_DIR / "processed" / "sprites"


def main():
    config = load_config()

    sheet_files = sorted(PUBLIC_SPRITES.glob("*-sheet.png"))
    if not sheet_files:
        print("No sheet files found in public/assets/sprites/")
        return

    print(f"Found {len(sheet_files)} sprite sheets to reprocess\n")

    all_frame_meta = {}

    for sheet_path in sheet_files:
        sprite_key = sheet_path.stem.replace("-sheet", "")
        print(f"\n=== Reprocessing: {sprite_key} ===")

        dst_dir = PROCESSED_DIR / sprite_key
        dst_dir.mkdir(parents=True, exist_ok=True)

        # Copy sheet to processed dir (the slicer expects it there)
        shutil.copy2(sheet_path, dst_dir / sheet_path.name)

        try:
            frame_meta = slice_and_save_character_sheet(
                sheet_path, sprite_key, config, dst_dir,
                apply_palette=True,
            )
            all_frame_meta[sprite_key] = frame_meta

            # Copy processed frames back to public/assets/sprites/
            for anim_data in frame_meta.values():
                for direction, filename in anim_data.items():
                    src = dst_dir / filename
                    if src.exists():
                        dest = PUBLIC_SPRITES / filename
                        shutil.copy2(src, dest)

            print(f"  -> Deployed {sum(len(d) for d in frame_meta.values())} frames")

        except Exception as e:
            print(f"  ERROR processing {sprite_key}: {e}")
            import traceback
            traceback.print_exc()

    # Write updated frame metadata
    if all_frame_meta:
        import json
        meta_path = PROCESSED_DIR / "_frame_meta.json"
        with open(meta_path, "w") as f:
            json.dump(all_frame_meta, f, indent=2)
        print(f"\nFrame metadata: {meta_path}")

    print(f"\n=== Done! Reprocessed {len(all_frame_meta)} sprite sheets ===")


if __name__ == "__main__":
    main()
