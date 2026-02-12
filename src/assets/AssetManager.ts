import { Terrain, Direction, TILE_W, TILE_H, TILE_HALF_W, TILE_HALF_H } from "../types";

/**
 * Asset manager with two-tier loading and animation support:
 *
 * 1. **AI-generated art** — PNGs in public/assets/ produced by the Gemini
 *    pipeline (scripts/asset-gen/) and deployed via deploy-assets.py.
 * 2. **Procedural fallbacks** — Canvas 2D-drawn placeholders generated at
 *    startup for any asset that doesn't have a PNG on disk.
 *
 * Animation frames are stored per-sprite, per-animation, per-direction.
 * The manifest.json "animations" section maps:
 *   spriteKey -> animName -> direction -> image path
 *
 * Frame keys (8 rows): "idle", "walk_1", "walk_2", "walk_3", "walk_4",
 *                       "attack_1", "attack_2", "hit"
 */

type DrawTarget = HTMLCanvasElement | HTMLImageElement;

interface AssetManifest {
  tiles?: Record<string, string | string[]>;
  sprites?: Record<string, Record<string, string>>;
  animations?: Record<string, Record<string, Record<string, string>>>;
  weapons?: Record<string, Record<string, Record<string, string>>>;
  objects?: Record<string, string>;
  items?: Record<string, string>;
  portraits?: Record<string, string>;
}

export class AssetManager {
  /** Tile variants: each terrain type has an array of visual variants */
  private tiles = new Map<Terrain, DrawTarget[]>();
  private sprites = new Map<string, Map<Direction, DrawTarget>>();
  private objects = new Map<string, DrawTarget>();
  private items = new Map<string, DrawTarget>();
  private portraits = new Map<string, HTMLImageElement>();

  /**
   * Maps AI-generated object keys (from manifest) to game object keys.
   * The game uses "wall", "barrel", "rock" but the pipeline generates
   * descriptive names like "brick-wall", "concrete-wall", etc.
   */
  private static readonly OBJECT_ALIAS: Record<string, string> = {
    "brick-wall": "wall",
    "concrete-wall": "wall",
    "corrugated-metal": "wall",
    "chain-link-fence": "wall",
    "sandbag": "wall",
  };

  /**
   * Animation frames: spriteKey -> animFrameKey -> direction -> image
   * animFrameKey is "idle" | "walk_1".."walk_4" | "attack_1" | "attack_2" | "hit"
   */
  private animFrames = new Map<string, Map<string, Map<Direction, DrawTarget>>>();

  /**
   * Weapon variant suffixes — when assets for "player_pistol" don't exist yet,
   * alias them to the base "player" animations so lookups always succeed.
   * Matches WEAPON_SPRITE_SUFFIX in EntitySystem.ts.
   */
  private static readonly WEAPON_SUFFIXES = ["unarmed", "pistol", "rifle", "knife", "bat"];

  /**
   * Weapon overlay frames: weaponKey -> animFrameKey -> direction -> image
   * Same layout as character animations but showing only the weapon + hands.
   */
  private weaponFrames = new Map<string, Map<string, Map<Direction, DrawTarget>>>();

  /** Whether animation data has been loaded from manifest */
  private hasAnimations = false;

  private loadedCount = 0;
  private totalToLoad = 0;

  /** Resolve a path relative to the app's base URL (handles GitHub Pages subpath) */
  private resolvePath(path: string): string {
    const base = import.meta.env.BASE_URL || "/";
    // Strip leading slash from path since base already ends with one
    const clean = path.startsWith("/") ? path.slice(1) : path;
    return `${base}${clean}`;
  }

  /**
   * Initialize: generate procedural fallbacks, then try to load AI art on top.
   */
  async init() {
    // Step 1: Generate procedural placeholders for everything
    this.generateAllProcedural();
    // Register weapon variant aliases for procedural sprites so
    // "player_pistol" etc. resolve even without AI assets loaded.
    this.registerWeaponAliases();

    // Step 2: Attempt to load manifest and override with real PNGs
    try {
      const manifestUrl = this.resolvePath("assets/manifest.json");
      console.log(`[AssetManager] Fetching manifest: ${manifestUrl}`);
      const resp = await fetch(manifestUrl);
      if (resp.ok) {
        const manifest: AssetManifest = await resp.json();
        console.log("[AssetManager] Manifest sections:", Object.keys(manifest).join(", "));
        await this.loadFromManifest(manifest);
        this.registerWeaponAliases();
        console.log(
          `[AssetManager] Loaded ${this.loadedCount}/${this.totalToLoad} AI-generated assets`,
        );
        if (this.loadedCount < this.totalToLoad) {
          console.warn(
            `[AssetManager] ${this.totalToLoad - this.loadedCount} assets failed to load`,
          );
        }
        if (this.hasAnimations) {
          const animKeys = [...this.animFrames.keys()];
          console.log(`[AssetManager] Animation frames loaded for: ${animKeys.join(", ")}`);
        }
        if (manifest.weapons) {
          const weaponKeys = Object.keys(manifest.weapons);
          console.log(`[AssetManager] Weapon sprites loaded for: ${weaponKeys.join(", ")}`);
        }
      } else {
        console.log(`[AssetManager] No manifest found (${resp.status}) — using procedural art`);
      }
    } catch (err) {
      console.log("[AssetManager] Could not load manifest — using procedural art", err);
    }
  }

  /** Legacy sync init — procedural only, no manifest loading */
  generateAll() {
    this.generateAllProcedural();
  }

  /**
   * Get a tile variant for the given terrain at a specific map position.
   *
   * Content-aware selection: neighborSig encodes which cardinal neighbors
   * have different terrain (bit 0=N, 1=E, 2=S, 3=W). Mixing this into
   * the hash ensures interior tiles and border tiles get consistently
   * different variants, creating natural visual patterns.
   */
  getTile(terrain: Terrain, tileX = 0, tileY = 0, neighborSig = 0): DrawTarget | undefined {
    const variants = this.tiles.get(terrain);
    if (!variants || variants.length === 0) return undefined;
    if (variants.length === 1) return variants[0];

    if (terrain === Terrain.Water) {
      // Animate water: cycle through frames at ~500ms per frame
      const frameIndex = Math.floor(Date.now() / 500) % variants.length;
      return variants[frameIndex];
    }

    // Content-aware variant selection: mix position + neighbor context
    // so tiles at terrain borders use different variants than interior tiles
    const hash = ((tileX * 73856093) ^ (tileY * 19349663) ^ (neighborSig * 83492791)) >>> 0;
    return variants[hash % variants.length];
  }

  getSprite(key: string, dir: Direction): DrawTarget | undefined {
    return this.sprites.get(key)?.get(dir);
  }

  /**
   * Get an animation frame for an entity.
   * Falls back to the static sprite if no animation data exists.
   *
   * @param spriteKey - entity sprite key (e.g., "player")
   * @param frameKey - animation frame key (e.g., "walk_1") from AnimationSystem.getFrameKey()
   * @param dir - facing direction
   */
  /**
   * Legacy frame key fallbacks: when new 8-row frame keys are requested but
   * only old 4-row data exists (or vice versa), try equivalent keys.
   */
  private static readonly FRAME_FALLBACKS: Record<string, string[]> = {
    "walk_3": ["walk_1"],            // 4-frame walk → 2-frame walk
    "walk_4": ["walk_2"],
    "attack_1": ["attack"],          // 2-frame attack → legacy single "attack"
    "attack_2": ["attack"],
    "attack": ["attack_2"],          // legacy "attack" → new strike frame
    "hit": ["idle"],                 // hit → idle if no hit frame
  };

  getAnimFrame(spriteKey: string, frameKey: string, dir: Direction): DrawTarget | undefined {
    const animData = this.animFrames.get(spriteKey);
    if (animData) {
      const frameDir = animData.get(frameKey);
      if (frameDir) {
        const img = frameDir.get(dir);
        if (img) return img;
      }
      // Try fallback frame keys for backward/forward compatibility
      const fallbacks = AssetManager.FRAME_FALLBACKS[frameKey];
      if (fallbacks) {
        for (const fb of fallbacks) {
          const fbDir = animData.get(fb);
          if (fbDir) {
            const img = fbDir.get(dir);
            if (img) return img;
          }
        }
      }
      // Fall back to idle for this direction if specific frame missing
      const idleDir = animData.get("idle");
      if (idleDir) {
        const img = idleDir.get(dir);
        if (img) return img;
      }
    }
    // Final fallback: static sprite
    return this.getSprite(spriteKey, dir);
  }

  /** Check if animation frames have been loaded for a sprite key */
  hasAnimData(spriteKey: string): boolean {
    return this.animFrames.has(spriteKey);
  }

  /**
   * Get a weapon overlay frame to draw on top of a character.
   * Returns the weapon sprite for the given animation frame and direction.
   */
  getWeaponFrame(weaponKey: string, frameKey: string, dir: Direction): DrawTarget | undefined {
    const weaponData = this.weaponFrames.get(weaponKey);
    if (!weaponData) return undefined;
    const frameDir = weaponData.get(frameKey);
    if (frameDir) {
      const img = frameDir.get(dir);
      if (img) return img;
    }
    // Fall back to idle if specific frame not found
    const idleDir = weaponData.get("idle");
    return idleDir?.get(dir);
  }

  /** Check if weapon overlay sprites have been loaded */
  hasWeaponData(weaponKey: string): boolean {
    return this.weaponFrames.has(weaponKey);
  }

  getObject(key: string): DrawTarget | undefined {
    return this.objects.get(key);
  }

  getItem(key: string): DrawTarget | undefined {
    return this.items.get(key);
  }

  /**
   * Maps spriteKey (used by entities) to portrait key (used in manifest).
   * The pipeline generates portraits with descriptive names (e.g., "sheriff-morgan")
   * but entities reference them by spriteKey (e.g., "npc_sheriff").
   */
  private static readonly PORTRAIT_KEY_MAP: Record<string, string> = {
    npc_sheriff: "sheriff-morgan",
    npc_doc: "doc-hendricks",
    npc_merchant: "scrap",
  };

  getPortrait(key: string): DrawTarget | undefined {
    // Try direct key first
    let portrait = this.portraits.get(key);
    // Try mapped portrait name (spriteKey → portrait filename)
    if (!portrait) {
      const mapped = AssetManager.PORTRAIT_KEY_MAP[key];
      if (mapped) portrait = this.portraits.get(mapped);
    }
    if (portrait) return portrait;
    return this.getAnimFrame(key, "idle", "S");
  }

  // -----------------------------------------------------------------------
  // PNG loading from manifest
  // -----------------------------------------------------------------------

  private async loadFromManifest(manifest: AssetManifest) {
    const promises: Promise<void>[] = [];

    // Tiles — supports both single path (legacy) and array of paths (variant system).
    // AI tiles are pre-diamond-masked by postprocess.py.  Drawing the procedural
    // tile first fills any edge gaps from clip anti-aliasing.
    if (manifest.tiles) {
      for (const [terrainName, pathOrPaths] of Object.entries(manifest.tiles)) {
        const terrain = Terrain[terrainName as keyof typeof Terrain];
        if (terrain === undefined) continue;

        const paths = Array.isArray(pathOrPaths) ? pathOrPaths : [pathOrPaths];
        const proceduralBase = this.tiles.get(terrain)?.[0];

        for (const path of paths) {
          this.totalToLoad++;
          promises.push(
            this.loadImage(path).then((img) => {
              if (img) {
                const composited = this.compositeAiTile(img, proceduralBase);
                if (!this.tiles.has(terrain)) {
                  this.tiles.set(terrain, []);
                }
                this.tiles.get(terrain)!.push(composited);
                this.loadedCount++;
              }
            }),
          );
        }
      }
    }

    // Sprites — keys are sprite keys, values are {direction: path}
    if (manifest.sprites) {
      for (const [spriteKey, directions] of Object.entries(manifest.sprites)) {
        if (!this.sprites.has(spriteKey)) {
          this.sprites.set(spriteKey, new Map());
        }
        for (const [dir, path] of Object.entries(directions)) {
          this.totalToLoad++;
          promises.push(
            this.loadSpriteImage(path).then((img) => {
              if (img) {
                this.sprites.get(spriteKey)!.set(dir as Direction, img);
                this.loadedCount++;
              }
            }),
          );
        }
      }
    }

    // Animations — spriteKey -> animName -> direction -> path
    if (manifest.animations) {
      this.hasAnimations = true;
      for (const [spriteKey, anims] of Object.entries(manifest.animations)) {
        if (!this.animFrames.has(spriteKey)) {
          this.animFrames.set(spriteKey, new Map());
        }
        const spriteAnims = this.animFrames.get(spriteKey)!;

        for (const [animName, directions] of Object.entries(anims)) {
          if (!spriteAnims.has(animName)) {
            spriteAnims.set(animName, new Map());
          }
          const dirMap = spriteAnims.get(animName)!;

          for (const [dir, path] of Object.entries(directions)) {
            this.totalToLoad++;
            promises.push(
              this.loadSpriteImage(path).then((img) => {
                if (img) {
                  dirMap.set(dir as Direction, img);
                  this.loadedCount++;
                }
              }),
            );
          }
        }
      }
    }

    // Weapons — weaponKey -> animName -> direction -> path
    if (manifest.weapons) {
      for (const [weaponKey, anims] of Object.entries(manifest.weapons)) {
        if (!this.weaponFrames.has(weaponKey)) {
          this.weaponFrames.set(weaponKey, new Map());
        }
        const weaponAnims = this.weaponFrames.get(weaponKey)!;

        for (const [animName, directions] of Object.entries(anims)) {
          if (!weaponAnims.has(animName)) {
            weaponAnims.set(animName, new Map());
          }
          const dirMap = weaponAnims.get(animName)!;

          for (const [dir, path] of Object.entries(directions)) {
            this.totalToLoad++;
            promises.push(
              this.loadSpriteImage(path).then((img) => {
                if (img) {
                  dirMap.set(dir as Direction, img);
                  this.loadedCount++;
                }
              }),
            );
          }
        }
      }
    }

    // Objects — register under both the manifest key and the game alias
    if (manifest.objects) {
      for (const [key, path] of Object.entries(manifest.objects)) {
        this.totalToLoad++;
        promises.push(
          this.loadImage(path).then((img) => {
            if (img) {
              this.objects.set(key, img);
              const alias = AssetManager.OBJECT_ALIAS[key];
              if (alias && !this.objects.has(alias)) {
                this.objects.set(alias, img);
              }
              this.loadedCount++;
            }
          }),
        );
      }
    }

    // Items — keys are icon keys: "item_pistol", etc.
    if (manifest.items) {
      for (const [key, path] of Object.entries(manifest.items)) {
        this.totalToLoad++;
        promises.push(
          this.loadImage(path).then((img) => {
            if (img) { this.items.set(key, img); this.loadedCount++; }
          }),
        );
      }
    }

    // Portraits
    if (manifest.portraits) {
      for (const [key, path] of Object.entries(manifest.portraits)) {
        this.totalToLoad++;
        promises.push(
          this.loadImage(path).then((img) => {
            if (img) { this.portraits.set(key, img); this.loadedCount++; }
          }),
        );
      }
    }

    await Promise.all(promises);

    // Post-process: normalize character sprite sizes using per-key scaling
    // (must happen before registerWeaponAliases so aliases inherit normalized frames)
    this.normalizeCharacterSprites();
  }

  /**
   * Register weapon variant aliases so that lookups like "player_pistol" resolve
   * to "player" animation/sprite data when per-weapon assets haven't been generated.
   * Once weapon-variant assets exist in the manifest, they take priority (already loaded).
   */
  private registerWeaponAliases() {
    // Alias animation frames: player → player_pistol, player_rifle, etc.
    const animBaseKeys = [...this.animFrames.keys()];
    for (const baseKey of animBaseKeys) {
      for (const suffix of AssetManager.WEAPON_SUFFIXES) {
        const variantKey = `${baseKey}_${suffix}`;
        if (!this.animFrames.has(variantKey)) {
          this.animFrames.set(variantKey, this.animFrames.get(baseKey)!);
        }
      }
    }
    // Alias static sprites the same way
    const spriteBaseKeys = [...this.sprites.keys()];
    for (const baseKey of spriteBaseKeys) {
      for (const suffix of AssetManager.WEAPON_SUFFIXES) {
        const variantKey = `${baseKey}_${suffix}`;
        if (!this.sprites.has(variantKey)) {
          this.sprites.set(variantKey, this.sprites.get(baseKey)!);
        }
      }
    }
  }

  /**
   * Composite an AI tile onto the procedural base tile.
   * AI tiles are now pre-processed to exactly TILE_W x TILE_H (64x32)
   * with a proper diamond mask.  The procedural base shows through any
   * edge gaps from anti-aliasing.
   */
  private compositeAiTile(img: HTMLImageElement, base?: DrawTarget): HTMLCanvasElement {
    const canvas = this.createCanvas(TILE_W, TILE_H);
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    if (base) ctx.drawImage(base, 0, 0, TILE_W, TILE_H);
    ctx.drawImage(img, 0, 0, TILE_W, TILE_H);
    return canvas;
  }

  private loadImage(path: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => {
        console.warn(`[AssetManager] Failed to load: ${path}`);
        resolve(null);
      };
      // Resolve path relative to base URL for GitHub Pages compatibility
      img.src = this.resolvePath(path);
    });
  }

  /**
   * Load a sprite image (no per-frame processing — normalization is done
   * post-load in normalizeCharacterSprites for consistent per-key scaling).
   */
  private async loadSpriteImage(path: string): Promise<HTMLImageElement | null> {
    return this.loadImage(path);
  }

  /**
   * Post-load normalization: for each sprite key, compute a single scale
   * factor from the idle-S reference frame and apply it uniformly to ALL
   * frames. Normalizes both up AND down so all characters render at a
   * consistent size on screen.
   */
  private normalizeCharacterSprites() {
    for (const [spriteKey, animData] of this.animFrames) {
      const idleDir = animData.get("idle");
      if (!idleDir) continue;

      const refFrame = idleDir.get("S" as Direction) ?? [...idleDir.values()][0];
      if (!refFrame) continue;

      const refH = this.measureContentHeight(refFrame);
      if (refH <= 0) continue;

      const sh = refFrame instanceof HTMLCanvasElement
        ? refFrame.height
        : (refFrame as HTMLImageElement).naturalHeight || (refFrame as HTMLImageElement).height;
      const sw = refFrame instanceof HTMLCanvasElement
        ? refFrame.width
        : (refFrame as HTMLImageElement).naturalWidth || (refFrame as HTMLImageElement).width;

      // Target: content should fill 85% of frame height so all characters
      // are the same size on screen regardless of how much padding is in the PNG.
      const targetH = sh * 0.85;
      const rawScale = targetH / refH;

      // Skip if already within 5% of target (avoid unnecessary reprocessing)
      if (rawScale > 0.95 && rawScale < 1.05) continue;

      // Clamp scale to avoid overflow: ensure scaled content fits within frame
      const refW = this.measureContentWidth(refFrame);
      const maxScaleW = refW > 0 ? (sw * 0.95) / refW : 2.0;
      const scale = Math.min(1.5, maxScaleW, Math.max(0.6, rawScale));

      // Apply the SAME scale to every animation frame for this sprite key
      for (const [, dirMap] of animData) {
        for (const [dir, frame] of dirMap) {
          dirMap.set(dir, this.rescaleSprite(frame, scale));
        }
      }

      // Also normalize static sprites for this key
      const staticMap = this.sprites.get(spriteKey);
      if (staticMap) {
        for (const [dir, frame] of staticMap) {
          staticMap.set(dir, this.rescaleSprite(frame, scale));
        }
      }
    }
  }

  /** Alpha threshold for content detection — low enough to catch anti-aliased edges */
  private static readonly ALPHA_THRESH = 10;

  /** Measure the height of non-transparent content in a sprite */
  private measureContentHeight(frame: DrawTarget): number {
    const sw = frame instanceof HTMLCanvasElement
      ? frame.width : (frame as HTMLImageElement).naturalWidth || (frame as HTMLImageElement).width;
    const sh = frame instanceof HTMLCanvasElement
      ? frame.height : (frame as HTMLImageElement).naturalHeight || (frame as HTMLImageElement).height;
    if (sw === 0 || sh === 0) return 0;

    const temp = this.createCanvas(sw, sh);
    const tempCtx = temp.getContext("2d")!;
    tempCtx.drawImage(frame, 0, 0);

    let data: ImageData;
    try { data = tempCtx.getImageData(0, 0, sw, sh); }
    catch { return 0; }

    let minY = sh, maxY = 0;
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        if (data.data[(y * sw + x) * 4 + 3] > AssetManager.ALPHA_THRESH) {
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return maxY > minY ? maxY - minY + 1 : 0;
  }

  /** Measure the width of non-transparent content in a sprite */
  private measureContentWidth(frame: DrawTarget): number {
    const sw = frame instanceof HTMLCanvasElement
      ? frame.width : (frame as HTMLImageElement).naturalWidth || (frame as HTMLImageElement).width;
    const sh = frame instanceof HTMLCanvasElement
      ? frame.height : (frame as HTMLImageElement).naturalHeight || (frame as HTMLImageElement).height;
    if (sw === 0 || sh === 0) return 0;

    const temp = this.createCanvas(sw, sh);
    const tempCtx = temp.getContext("2d")!;
    tempCtx.drawImage(frame, 0, 0);

    let data: ImageData;
    try { data = tempCtx.getImageData(0, 0, sw, sh); }
    catch { return 0; }

    let minX = sw, maxX = 0;
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        if (data.data[(y * sw + x) * 4 + 3] > AssetManager.ALPHA_THRESH) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
    }
    return maxX > minX ? maxX - minX + 1 : 0;
  }

  /** Rescale a sprite by extracting the content region, scaling it, and
   *  placing it centered + bottom-anchored in a fresh canvas.
   *  Previous version scaled the ENTIRE image, causing clipping when the
   *  scaled dimensions exceeded the canvas (e.g. 64*1.23 = 79 > 64). */
  private rescaleSprite(frame: DrawTarget, scale: number): HTMLCanvasElement {
    const sw = frame instanceof HTMLCanvasElement
      ? frame.width : (frame as HTMLImageElement).naturalWidth || (frame as HTMLImageElement).width;
    const sh = frame instanceof HTMLCanvasElement
      ? frame.height : (frame as HTMLImageElement).naturalHeight || (frame as HTMLImageElement).height;

    const temp = this.createCanvas(sw, sh);
    const tempCtx = temp.getContext("2d")!;
    tempCtx.drawImage(frame, 0, 0);

    let data: ImageData;
    try { data = tempCtx.getImageData(0, 0, sw, sh); }
    catch { return temp; }

    let minY = sh, maxY = 0, minX = sw, maxX = 0;
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        if (data.data[(y * sw + x) * 4 + 3] > AssetManager.ALPHA_THRESH) {
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
    }
    if (minY >= maxY || minX >= maxX) return temp;

    // Content region dimensions
    const contentW = maxX - minX + 1;
    const contentH = maxY - minY + 1;

    // Scaled content dimensions
    const scaledW = contentW * scale;
    const scaledH = contentH * scale;

    const result = this.createCanvas(sw, sh);
    const ctx = result.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;

    // Place scaled content: centered horizontally, feet anchored at bottom (sh - 4)
    const destX = (sw - scaledW) / 2;
    const destY = (sh - 4) - scaledH;

    // Draw only the content region from the source, scaled into the output
    ctx.drawImage(
      frame as CanvasImageSource,
      minX, minY, contentW, contentH,   // source: content region only
      destX, destY, scaledW, scaledH    // dest: scaled and positioned
    );
    return result;
  }

  // -----------------------------------------------------------------------
  // Procedural fallback generation
  // -----------------------------------------------------------------------

  private generateAllProcedural() {
    this.generateTiles();
    this.generateSprites();
    this.generateObjects();
    this.generateItems();
  }

  private generateTiles() {
    const terrainColors: Record<Terrain, { base: string; detail: string; noise: string }> = {
      [Terrain.Sand]:        { base: "#b8a67c", detail: "#d4c4a0", noise: "#a0926a" },
      [Terrain.Dirt]:        { base: "#8b7355", detail: "#9e8668", noise: "#6b5340" },
      [Terrain.CrackedEarth]:{ base: "#9e8e6e", detail: "#6b5b40", noise: "#b8a87e" },
      [Terrain.Rubble]:      { base: "#7a7a6a", detail: "#9e9e8e", noise: "#5a5a4a" },
      [Terrain.Road]:        { base: "#6e6e5e", detail: "#5a5a4a", noise: "#8e8e7e" },
      [Terrain.Concrete]:    { base: "#8e8e7e", detail: "#a0a090", noise: "#6e6e5e" },
      [Terrain.Grass]:       { base: "#6b7b4a", detail: "#7a8b5a", noise: "#4a5b3a" },
      [Terrain.Water]:       { base: "#3a5a5a", detail: "#4a7070", noise: "#2a4a4a" },
    };
    for (const [terrainStr, colors] of Object.entries(terrainColors)) {
      const terrain = Number(terrainStr) as Terrain;
      const canvas = this.createCanvas(TILE_W, TILE_H);
      const ctx = canvas.getContext("2d")!;
      this.drawIsoDiamond(ctx, colors.base);
      this.addTileNoise(ctx, colors.detail, colors.noise, terrain);
      this.tiles.set(terrain, [canvas]);
    }
  }

  private drawIsoDiamond(ctx: CanvasRenderingContext2D, color: string) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(TILE_HALF_W, 0);
    ctx.lineTo(TILE_W, TILE_HALF_H);
    ctx.lineTo(TILE_HALF_W, TILE_H);
    ctx.lineTo(0, TILE_HALF_H);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(TILE_HALF_W, 0);
    ctx.lineTo(TILE_W, TILE_HALF_H);
    ctx.stroke();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.15)";
    ctx.beginPath();
    ctx.moveTo(0, TILE_HALF_H);
    ctx.lineTo(TILE_HALF_W, TILE_H);
    ctx.lineTo(TILE_W, TILE_HALF_H);
    ctx.stroke();
  }

  private addTileNoise(ctx: CanvasRenderingContext2D, detail: string, noise: string, terrain: Terrain) {
    const rng = this.seededRng(terrain * 1000);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(TILE_HALF_W, 1); ctx.lineTo(TILE_W - 1, TILE_HALF_H);
    ctx.lineTo(TILE_HALF_W, TILE_H - 1); ctx.lineTo(1, TILE_HALF_H);
    ctx.closePath();
    ctx.clip();

    switch (terrain) {
      case Terrain.Sand:
        // Subtle sand ripple lines for dune texture
        ctx.strokeStyle = detail;
        ctx.lineWidth = 0.5;
        ctx.globalAlpha = 0.2;
        for (let i = 0; i < 4; i++) {
          const y = 5 + i * 7;
          ctx.beginPath();
          ctx.moveTo(10 + rng() * 6, y + rng() * 2);
          ctx.quadraticCurveTo(32, y + 2 + rng() * 3, 54 - rng() * 6, y + rng() * 2);
          ctx.stroke();
        }
        // Scattered pebbles
        for (let i = 0; i < 5; i++) {
          ctx.fillStyle = rng() > 0.5 ? detail : noise;
          ctx.globalAlpha = 0.15 + rng() * 0.15;
          ctx.fillRect(10 + rng() * 44, 4 + rng() * 24, 1, 1);
        }
        break;

      case Terrain.Dirt:
        // Patchy earth texture with small irregular spots
        for (let i = 0; i < 10; i++) {
          ctx.fillStyle = rng() > 0.5 ? detail : noise;
          ctx.globalAlpha = 0.15 + rng() * 0.25;
          const px = 8 + rng() * 48;
          const py = 4 + rng() * 24;
          const sz = 1 + rng() * 2.5;
          ctx.beginPath();
          ctx.ellipse(px, py, sz, sz * 0.6, rng() * Math.PI, 0, Math.PI * 2);
          ctx.fill();
        }
        break;

      case Terrain.CrackedEarth:
        // Visible crack lines radiating outward
        ctx.strokeStyle = noise;
        ctx.lineWidth = 0.7;
        ctx.globalAlpha = 0.5;
        for (let i = 0; i < 3; i++) {
          const sx = 15 + rng() * 30;
          const sy = 6 + rng() * 16;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          for (let j = 0; j < 3; j++) {
            ctx.lineTo(sx + (rng() - 0.3) * 18, sy + (rng() - 0.3) * 10);
          }
          ctx.stroke();
        }
        // Surface texture dots
        for (let i = 0; i < 6; i++) {
          ctx.fillStyle = detail;
          ctx.globalAlpha = 0.12 + rng() * 0.12;
          ctx.fillRect(8 + rng() * 48, 4 + rng() * 24, 1 + rng(), 1);
        }
        break;

      case Terrain.Rubble:
        // Scattered debris fragments
        for (let i = 0; i < 8; i++) {
          ctx.fillStyle = rng() > 0.4 ? detail : noise;
          ctx.globalAlpha = 0.2 + rng() * 0.3;
          const px = 8 + rng() * 48;
          const py = 4 + rng() * 24;
          const sz = 1 + rng() * 3;
          ctx.fillRect(px, py, sz, sz * (0.5 + rng() * 0.5));
        }
        break;

      case Terrain.Road:
        // Center line dashes
        ctx.strokeStyle = "#b8a67c";
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.25;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(TILE_HALF_W - 14, TILE_HALF_H);
        ctx.lineTo(TILE_HALF_W + 14, TILE_HALF_H);
        ctx.stroke();
        ctx.setLineDash([]);
        // Subtle surface wear
        for (let i = 0; i < 5; i++) {
          ctx.fillStyle = noise;
          ctx.globalAlpha = 0.1 + rng() * 0.1;
          ctx.fillRect(12 + rng() * 40, 6 + rng() * 20, 1 + rng() * 2, 1);
        }
        break;

      case Terrain.Concrete:
        // Clean surface with subtle seam lines
        ctx.strokeStyle = noise;
        ctx.lineWidth = 0.5;
        ctx.globalAlpha = 0.15;
        ctx.beginPath();
        ctx.moveTo(20, 8); ctx.lineTo(44, 24);
        ctx.stroke();
        // Few surface marks
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = rng() > 0.5 ? detail : noise;
          ctx.globalAlpha = 0.1 + rng() * 0.12;
          ctx.fillRect(12 + rng() * 40, 6 + rng() * 20, 1 + rng(), 1);
        }
        break;

      case Terrain.Grass:
        // Grass tufts - short vertical strokes
        ctx.strokeStyle = "#7a8b5a";
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.6;
        for (let i = 0; i < 10; i++) {
          const gx = 10 + rng() * 44;
          const gy = 5 + rng() * 22;
          ctx.beginPath();
          ctx.moveTo(gx, gy);
          ctx.lineTo(gx + (rng() - 0.5) * 3, gy - 2 - rng() * 4);
          ctx.stroke();
        }
        // Ground color patches
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = detail;
          ctx.globalAlpha = 0.12;
          ctx.beginPath();
          ctx.ellipse(12 + rng() * 40, 6 + rng() * 20, 2 + rng() * 2, 1 + rng(), 0, 0, Math.PI * 2);
          ctx.fill();
        }
        break;

      case Terrain.Water:
        // Gentle wave lines
        ctx.strokeStyle = "#5a8a8a";
        ctx.lineWidth = 0.5;
        ctx.globalAlpha = 0.4;
        for (let i = 0; i < 3; i++) {
          const y = 8 + i * 8;
          ctx.beginPath();
          ctx.moveTo(14 + rng() * 8, y);
          ctx.quadraticCurveTo(32, y + 2 * (rng() - 0.5), 50 - rng() * 8, y);
          ctx.stroke();
        }
        break;

      default:
        // Generic noise fallback
        for (let i = 0; i < 12; i++) {
          ctx.fillStyle = rng() > 0.5 ? detail : noise;
          ctx.globalAlpha = 0.2 + rng() * 0.3;
          ctx.fillRect(rng() * TILE_W, rng() * TILE_H, 1 + rng() * 2, 1 + rng() * 2);
        }
        break;
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  private generateSprites() {
    const configs: Record<string, { body: string; head: string; accent: string }> = {
      player:       { body: "#6b5340", head: "#d4c4a0", accent: "#40c040" },
      npc_sheriff:  { body: "#5a4a3a", head: "#d4c4a0", accent: "#c4703a" },
      npc_merchant: { body: "#7a6b5a", head: "#d4c4a0", accent: "#8ec44a" },
      npc_doc:      { body: "#8e8e7e", head: "#d4c4a0", accent: "#4a8ab0" },
      npc_raider:   { body: "#4a3a2a", head: "#c4a080", accent: "#b83030" },
    };
    const dirs: Direction[] = ["N","NE","E","SE","S","SW","W","NW"];
    for (const [key, colors] of Object.entries(configs)) {
      const m = new Map<Direction, HTMLCanvasElement>();
      for (const d of dirs) m.set(d, this.genChar(colors, d, key === "player"));
      this.sprites.set(key, m);
    }
  }

  private genChar(c: {body:string;head:string;accent:string}, dir: Direction, isPlayer: boolean): HTMLCanvasElement {
    // Use 64x96 canvas (matching AI sprite dimensions) so procedural fallback
    // renders at the same visual size when drawn at the fixed display size.
    const canvas=this.createCanvas(64,96), ctx=canvas.getContext("2d")!;
    ctx.scale(64/24, 96/36); // Scale original 24x36 coordinate space to 64x96
    const w=24, h=36, cx=w/2;
    ctx.fillStyle="rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.ellipse(cx,h-3,8,3,0,0,Math.PI*2); ctx.fill();
    const bs=this.dirOff(dir);
    ctx.fillStyle=c.body; ctx.fillRect(cx-5+bs*1.5,14,10,14);
    ctx.fillStyle=c.accent; ctx.fillRect(cx-5+bs*1.5,20,10,2);
    ctx.fillStyle=this.darken(c.body,0.7); const ls=Math.abs(bs)>0?2:0;
    ctx.fillRect(cx-3+bs-ls,28,3,5); ctx.fillRect(cx+bs+ls,28,3,5);
    ctx.fillStyle="#3a3a2e"; ctx.fillRect(cx-3+bs-ls,32,3,2); ctx.fillRect(cx+bs+ls,32,3,2);
    ctx.fillStyle=c.head; ctx.beginPath(); ctx.arc(cx+bs,10,5,0,Math.PI*2); ctx.fill();
    if(dir!=="N"&&dir!=="NW"&&dir!=="NE"){ctx.fillStyle="#1e1e16";const eo=bs*0.5;ctx.fillRect(cx-2+eo,9,1,1);ctx.fillRect(cx+1+eo,9,1,1);}
    if(isPlayer){ctx.strokeStyle="rgba(64,192,64,0.5)";ctx.lineWidth=0.5;ctx.beginPath();ctx.arc(cx+bs,10,6,0,Math.PI*2);ctx.stroke();}
    if(c.accent==="#b83030"){ctx.strokeStyle="#9e9e8e";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(cx+5+bs,16);ctx.lineTo(cx+10+bs,12);ctx.stroke();}
    return canvas;
  }

  private dirOff(d: Direction): number { return d==="E"||d==="NE"||d==="SE"?2:d==="W"||d==="NW"||d==="SW"?-2:0; }

  private generateObjects() {
    const wall=this.createCanvas(TILE_W,32), wc=wall.getContext("2d")!;
    wc.fillStyle="#7a6a5a"; wc.beginPath(); wc.moveTo(TILE_HALF_W,0); wc.lineTo(TILE_W,8); wc.lineTo(TILE_W,24); wc.lineTo(TILE_HALF_W,32); wc.lineTo(0,24); wc.lineTo(0,8); wc.closePath(); wc.fill();
    wc.fillStyle="#8e7e6e"; wc.beginPath(); wc.moveTo(TILE_HALF_W,0); wc.lineTo(TILE_W,8); wc.lineTo(TILE_HALF_W,16); wc.lineTo(0,8); wc.closePath(); wc.fill();
    this.objects.set("wall",wall);
    const barrel=this.createCanvas(16,20), bc=barrel.getContext("2d")!;
    bc.fillStyle="#7a3b1e"; bc.fillRect(2,4,12,14); bc.fillStyle="#a0522d"; bc.beginPath(); bc.ellipse(8,4,6,3,0,0,Math.PI*2); bc.fill();
    bc.fillStyle="#c4703a"; bc.fillRect(2,8,12,2); bc.fillRect(2,14,12,2);
    this.objects.set("barrel",barrel);
    const rock=this.createCanvas(18,14), rc=rock.getContext("2d")!;
    rc.fillStyle="#6e6e5e"; rc.beginPath(); rc.moveTo(3,12); rc.lineTo(1,8); rc.lineTo(4,3); rc.lineTo(10,1); rc.lineTo(16,4); rc.lineTo(17,10); rc.lineTo(13,13); rc.closePath(); rc.fill();
    rc.fillStyle="#8e8e7e"; rc.beginPath(); rc.moveTo(4,3); rc.lineTo(10,1); rc.lineTo(16,4); rc.lineTo(10,6); rc.closePath(); rc.fill();
    this.objects.set("rock",rock);
  }

  private generateItems() {
    this.genItem("item_pistol", (c) => { c.fillStyle="#6e6e5e"; c.fillRect(4,6,12,4); c.fillRect(8,6,4,10); c.fillStyle="#5a5a4a"; c.fillRect(4,6,3,3); });
    this.genItem("item_rifle", (c) => { c.fillStyle="#6e6e5e"; c.fillRect(2,8,16,3); c.fillRect(10,8,4,8); c.fillStyle="#8b7355"; c.fillRect(2,8,6,3); });
    this.genItem("item_knife", (c) => { c.fillStyle="#9e9e8e"; c.fillRect(8,2,2,10); c.fillStyle="#6b5340"; c.fillRect(7,12,4,4); });
    this.genItem("item_bat", (c) => { c.fillStyle="#8b7355"; c.fillRect(9,2,3,14); c.fillStyle="#6b5340"; c.fillRect(8,2,5,4); });
    this.genItem("item_armor", (c) => { c.fillStyle="#6b5340"; c.fillRect(5,4,10,12); c.fillStyle="#8b7355"; c.fillRect(6,5,8,4); });
    this.genItem("item_stimpak", (c) => { c.fillStyle="#9e9e8e"; c.fillRect(8,3,4,12); c.fillStyle="#b83030"; c.fillRect(9,5,2,4); c.fillStyle="#d4c4a0"; c.fillRect(7,3,6,2); });
    this.genItem("item_radaway", (c) => { c.fillStyle="#c4703a"; c.fillRect(6,4,8,10); c.fillStyle="#d4c4a0"; c.fillRect(7,5,6,8); });
    this.genItem("item_nuka", (c) => { c.fillStyle="#b83030"; c.fillRect(7,3,6,12); c.fillStyle="#d4c4a0"; c.fillRect(8,8,4,1); c.fillStyle="#9e9e8e"; c.fillRect(9,2,2,2); });
    this.genItem("item_food", (c) => { c.fillStyle="#9e9e8e"; c.fillRect(5,5,10,10); c.fillStyle="#b8a67c"; c.fillRect(6,6,8,3); });
    this.genItem("item_caps", (c) => { c.fillStyle="#c4703a"; for(let i=0;i<3;i++){c.beginPath();c.arc(8+i*2,10-i*2,4,0,Math.PI*2);c.fill();c.fillStyle="#a0522d";} });
    this.genItem("item_pin", (c) => { c.strokeStyle="#9e9e8e"; c.lineWidth=1.5; c.beginPath(); c.moveTo(10,4); c.lineTo(10,14); c.lineTo(7,12); c.stroke(); });
    this.genItem("item_holotape", (c) => { c.fillStyle="#5a5a4a"; c.fillRect(4,5,12,10); c.fillStyle="#8ec44a"; c.fillRect(6,7,8,2); });
  }

  private genItem(key: string, draw: (ctx: CanvasRenderingContext2D) => void) {
    const canvas = this.createCanvas(20, 20);
    draw(canvas.getContext("2d")!);
    this.items.set(key, canvas);
  }

  private createCanvas(w: number, h: number): HTMLCanvasElement {
    const c = document.createElement("canvas"); c.width = w; c.height = h; return c;
  }
  private darken(hex: string, f: number): string {
    return `rgb(${Math.floor(parseInt(hex.slice(1,3),16)*f)},${Math.floor(parseInt(hex.slice(3,5),16)*f)},${Math.floor(parseInt(hex.slice(5,7),16)*f)})`;
  }
  private seededRng(seed: number) {
    return () => { seed|=0; seed=(seed+0x6d2b79f5)|0; let t=Math.imul(seed^(seed>>>15),1|seed); t=(t+Math.imul(t^(t>>>7),61|t))^t; return((t^(t>>>14))>>>0)/4294967296; };
  }
}
