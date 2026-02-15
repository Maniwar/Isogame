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
  terrain_textures?: Record<string, string | string[]>;
  sprites?: Record<string, Record<string, string>>;
  animations?: Record<string, Record<string, Record<string, string>>>;
  weapons?: Record<string, Record<string, Record<string, string>>>;
  objects?: Record<string, string>;
  items?: Record<string, string>;
  portraits?: Record<string, string>;
}

export class AssetManager {
  /** Legacy diamond tile variants (kept for backward compatibility) */
  private tiles = new Map<Terrain, DrawTarget[]>();
  /**
   * Rectangular terrain textures — the correct tile format.
   * These are seamless tileable textures used as CanvasPattern fills.
   * The renderer clips the continuous pattern to diamond shapes at draw time,
   * so adjacent tiles share the same texture surface seamlessly.
   */
  private terrainTextures = new Map<Terrain, DrawTarget[]>();
  /** Cached CanvasPattern objects for each terrain (created lazily) */
  private terrainPatterns = new Map<Terrain, CanvasPattern>();
  /** Cached water animation patterns by frame index */
  private waterPatternCache = new Map<string, CanvasPattern>();
  /** Whether terrain textures (rectangular) are available */
  private hasTerrainTextures = false;

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
        // Log tile variant details to diagnose loading issues
        console.log(`[AssetManager] Terrain texture mode: ${this.hasTerrainTextures}`);
        for (const [terrainVal, variants] of this.tiles) {
          const name = Terrain[terrainVal] ?? terrainVal;
          console.log(`[AssetManager] Tile variants for ${name}: ${variants.length} (1 procedural + ${variants.length - 1} AI)`);
        }
        if (this.hasAnimations) {
          const animKeys = [...this.animFrames.keys()];
          console.log(`[AssetManager] Animation frames loaded for: ${animKeys.join(", ")}`);
          // Validate sprite dimensions at load time
          this.validateSpriteDimensions();
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
  /** Whether rectangular terrain textures are loaded (pattern-fill mode) */
  hasTerrainTextureMode(): boolean {
    return this.hasTerrainTextures;
  }

  /**
   * Get a CanvasPattern for a terrain type. The pattern tiles seamlessly
   * in world space, so adjacent tiles show continuous terrain.
   *
   * For water, returns a time-varying pattern to animate the surface.
   * Non-water patterns are cached for performance.
   */
  getTerrainPattern(terrain: Terrain, ctx: CanvasRenderingContext2D): CanvasPattern | null {
    const textures = this.terrainTextures.get(terrain);
    if (!textures || textures.length === 0) return null;

    // Water animates — cycle through frames with cached patterns per frame
    if (terrain === Terrain.Water && textures.length > 1) {
      const frameIndex = Math.floor(Date.now() / 800) % textures.length;
      const cacheKey = `water_${frameIndex}`;
      const cached = this.waterPatternCache.get(cacheKey);
      if (cached) return cached;
      const pat = ctx.createPattern(textures[frameIndex] as CanvasImageSource, "repeat");
      if (pat) this.waterPatternCache.set(cacheKey, pat);
      return pat;
    }

    // Other terrains: return cached pattern
    const cached = this.terrainPatterns.get(terrain);
    if (cached) return cached;

    const pattern = ctx.createPattern(textures[0] as CanvasImageSource, "repeat");
    if (pattern) this.terrainPatterns.set(terrain, pattern);
    return pattern;
  }

  /** Number of tile variants for a terrain (1 = procedural only, >1 = has AI tiles) */
  getTileVariantCount(terrain: Terrain): number {
    return this.tiles.get(terrain)?.length ?? 0;
  }

  getTile(terrain: Terrain, tileX = 0, tileY = 0, neighborSig = 0): DrawTarget | undefined {
    const variants = this.tiles.get(terrain);
    if (!variants || variants.length === 0) return undefined;
    if (variants.length === 1) return variants[0];

    if (terrain === Terrain.Water) {
      // Animate water: stagger per-tile so adjacent tiles don't all flip at once.
      // Each tile gets a phase offset based on its position, creating a wave effect.
      const posHash = ((tileX * 73856093) ^ (tileY * 19349663)) >>> 0;
      const offset = posHash % variants.length;
      const frameIndex = (Math.floor(Date.now() / 800) + offset) % variants.length;
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
    "walk_2": ["walk_1"],            // mid-stride → contact fallback
    "walk_3": ["walk_1"],            // 4-frame walk → 2-frame walk
    "walk_4": ["walk_3", "walk_2", "walk_1"],  // passing → best available
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

    // Terrain textures — rectangular seamless textures used as CanvasPattern fills.
    // This is the preferred format: the renderer clips patterns to diamond shapes
    // at draw time, so adjacent tiles share continuous terrain surfaces.
    if (manifest.terrain_textures) {
      this.hasTerrainTextures = true;
      for (const [terrainName, pathOrPaths] of Object.entries(manifest.terrain_textures)) {
        const terrain = Terrain[terrainName as keyof typeof Terrain];
        if (terrain === undefined) continue;

        const paths = Array.isArray(pathOrPaths) ? pathOrPaths : [pathOrPaths];
        if (!this.terrainTextures.has(terrain)) {
          this.terrainTextures.set(terrain, []);
        }

        for (const path of paths) {
          this.totalToLoad++;
          promises.push(
            this.loadImage(path).then((img) => {
              if (img) {
                this.terrainTextures.get(terrain)!.push(img);
                this.loadedCount++;
              }
            }),
          );
        }
      }
    }

    // Legacy diamond tiles — fallback for assets that haven't been regenerated.
    // Skip Water: it uses procedural animated frames; AI tiles would break the animation.
    if (manifest.tiles) {
      for (const [terrainName, pathOrPaths] of Object.entries(manifest.tiles)) {
        const terrain = Terrain[terrainName as keyof typeof Terrain];
        if (terrain === undefined || terrain === Terrain.Water) continue;

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

    // Character sprites are already properly sized (64x96) and hole-filled
    // by the Python postprocess pipeline. No runtime normalization needed.
  }

  /**
   * Validate loaded sprite dimensions at startup.
   * Logs warnings for any sprites that don't match the expected 64x96.
   * This helps diagnose rendering issues where sprites appear split or distorted.
   */
  private validateSpriteDimensions() {
    const expected = { w: 64, h: 96 };
    let issues = 0;

    for (const [spriteKey, anims] of this.animFrames) {
      // Skip weapon aliases (they share the same image instances)
      if (AssetManager.WEAPON_SUFFIXES.some((s) => spriteKey.endsWith(`_${s}`))) continue;

      for (const [animName, dirMap] of anims) {
        for (const [dir, img] of dirMap) {
          const w = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
          const h = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
          if (w !== expected.w || h !== expected.h) {
            console.warn(
              `[AssetManager] Sprite dimension mismatch: ${spriteKey}/${animName}/${dir} ` +
              `is ${w}x${h}, expected ${expected.w}x${expected.h}`,
            );
            issues++;
          }
        }
      }
    }

    if (issues === 0) {
      console.log("[AssetManager] All sprite dimensions validated: 64x96 ✓");
    } else {
      console.warn(`[AssetManager] ${issues} sprites have unexpected dimensions`);
    }
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
   * Composite an AI tile onto the procedural base, clipped to the
   * isometric diamond so no rectangular overflow is visible.
   */
  private compositeAiTile(img: HTMLImageElement, base?: DrawTarget): HTMLCanvasElement {
    const canvas = this.createCanvas(TILE_W, TILE_H);
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    (ctx as any).imageSmoothingQuality = "high";
    if (base) ctx.drawImage(base, 0, 0, TILE_W, TILE_H);
    // Clip to diamond so AI tiles with corner bleed don't overflow
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(TILE_HALF_W, 0);
    ctx.lineTo(TILE_W, TILE_HALF_H);
    ctx.lineTo(TILE_HALF_W, TILE_H);
    ctx.lineTo(0, TILE_HALF_H);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, 0, 0, TILE_W, TILE_H);
    ctx.restore();
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

  /** Load a sprite image. */
  private async loadSpriteImage(path: string): Promise<HTMLImageElement | null> {
    return this.loadImage(path);
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

  /** Procedural terrain texture size — large enough for natural variation */
  private static readonly PROC_TEX_SIZE = 128;

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

    const sz = AssetManager.PROC_TEX_SIZE;

    for (const [terrainStr, colors] of Object.entries(terrainColors)) {
      const terrain = Number(terrainStr) as Terrain;

      if (terrain === Terrain.Water) {
        // Generate multiple water frames with shifted wave patterns for animation
        const waterFrameCount = 4;
        const texFrames: DrawTarget[] = [];
        const tileFrames: DrawTarget[] = [];
        for (let f = 0; f < waterFrameCount; f++) {
          const texCanvas = this.createCanvas(sz, sz);
          const texCtx = texCanvas.getContext("2d")!;
          texCtx.fillStyle = colors.base;
          texCtx.fillRect(0, 0, sz, sz);
          this.addWaterTextureFrame(texCtx, sz, sz, f, waterFrameCount);
          texFrames.push(texCanvas);

          const canvas = this.createCanvas(TILE_W, TILE_H);
          const ctx = canvas.getContext("2d")!;
          this.drawIsoDiamond(ctx, colors.base);
          this.addWaterTileFrame(ctx, f, waterFrameCount);
          tileFrames.push(canvas);
        }
        this.terrainTextures.set(terrain, texFrames);
        this.tiles.set(terrain, tileFrames);
        continue;
      }

      // Generate a rectangular seamless terrain texture (no diamond shape).
      // The renderer uses this as a CanvasPattern fill clipped to diamonds.
      const texCanvas = this.createCanvas(sz, sz);
      const texCtx = texCanvas.getContext("2d")!;
      texCtx.fillStyle = colors.base;
      texCtx.fillRect(0, 0, sz, sz);
      this.addTerrainTextureNoise(texCtx, sz, sz, colors.detail, colors.noise, terrain);
      this.terrainTextures.set(terrain, [texCanvas]);

      // Also generate legacy diamond tile for backward compatibility
      const canvas = this.createCanvas(TILE_W, TILE_H);
      const ctx = canvas.getContext("2d")!;
      this.drawIsoDiamond(ctx, colors.base);
      this.addTileNoise(ctx, colors.detail, colors.noise, terrain);
      this.tiles.set(terrain, [canvas]);
    }
  }

  /** Draw a filled isometric diamond — no edge strokes for a clean look */
  private drawIsoDiamond(ctx: CanvasRenderingContext2D, color: string) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(TILE_HALF_W, 0);
    ctx.lineTo(TILE_W, TILE_HALF_H);
    ctx.lineTo(TILE_HALF_W, TILE_H);
    ctx.lineTo(0, TILE_HALF_H);
    ctx.closePath();
    ctx.fill();
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

  /**
   * Add noise/detail to a rectangular terrain texture.
   * Unlike addTileNoise (which clips to a diamond), this fills the entire
   * rectangular canvas so the texture tiles seamlessly as a CanvasPattern.
   */
  private addTerrainTextureNoise(
    ctx: CanvasRenderingContext2D, w: number, h: number,
    detail: string, noise: string, terrain: Terrain,
  ) {
    const rng = this.seededRng(terrain * 1000 + 77);

    switch (terrain) {
      case Terrain.Sand:
        for (let i = 0; i < 20; i++) {
          ctx.strokeStyle = detail;
          ctx.lineWidth = 0.5;
          ctx.globalAlpha = 0.15 + rng() * 0.1;
          const y = rng() * h;
          ctx.beginPath();
          ctx.moveTo(rng() * w, y);
          ctx.quadraticCurveTo(w * 0.5, y + 2 + rng() * 4, w - rng() * w * 0.2, y + rng() * 3);
          ctx.stroke();
        }
        for (let i = 0; i < 20; i++) {
          ctx.fillStyle = rng() > 0.5 ? detail : noise;
          ctx.globalAlpha = 0.1 + rng() * 0.15;
          ctx.fillRect(rng() * w, rng() * h, 1, 1);
        }
        break;

      case Terrain.Dirt:
        for (let i = 0; i < 30; i++) {
          ctx.fillStyle = rng() > 0.5 ? detail : noise;
          ctx.globalAlpha = 0.12 + rng() * 0.2;
          const sz = 1 + rng() * 3;
          ctx.beginPath();
          ctx.ellipse(rng() * w, rng() * h, sz, sz * 0.6, rng() * Math.PI, 0, Math.PI * 2);
          ctx.fill();
        }
        break;

      case Terrain.CrackedEarth:
        ctx.strokeStyle = noise;
        ctx.lineWidth = 0.7;
        ctx.globalAlpha = 0.45;
        for (let i = 0; i < 10; i++) {
          const sx = rng() * w;
          const sy = rng() * h;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          for (let j = 0; j < 4; j++) {
            ctx.lineTo(sx + (rng() - 0.3) * 30, sy + (rng() - 0.3) * 20);
          }
          ctx.stroke();
        }
        for (let i = 0; i < 15; i++) {
          ctx.fillStyle = detail;
          ctx.globalAlpha = 0.1 + rng() * 0.1;
          ctx.fillRect(rng() * w, rng() * h, 1 + rng(), 1);
        }
        break;

      case Terrain.Rubble:
        for (let i = 0; i < 25; i++) {
          ctx.fillStyle = rng() > 0.4 ? detail : noise;
          ctx.globalAlpha = 0.15 + rng() * 0.25;
          const sz = 1 + rng() * 4;
          ctx.fillRect(rng() * w, rng() * h, sz, sz * (0.5 + rng() * 0.5));
        }
        break;

      case Terrain.Road:
        ctx.strokeStyle = "#b8a67c";
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.2;
        ctx.setLineDash([4, 8]);
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();
        ctx.setLineDash([]);
        for (let i = 0; i < 15; i++) {
          ctx.fillStyle = noise;
          ctx.globalAlpha = 0.08 + rng() * 0.1;
          ctx.fillRect(rng() * w, rng() * h, 1 + rng() * 3, 1);
        }
        break;

      case Terrain.Concrete:
        ctx.strokeStyle = noise;
        ctx.lineWidth = 0.5;
        ctx.globalAlpha = 0.12;
        ctx.beginPath();
        ctx.moveTo(w * 0.3, 0);
        ctx.lineTo(w * 0.7, h);
        ctx.stroke();
        for (let i = 0; i < 12; i++) {
          ctx.fillStyle = rng() > 0.5 ? detail : noise;
          ctx.globalAlpha = 0.08 + rng() * 0.1;
          ctx.fillRect(rng() * w, rng() * h, 1 + rng(), 1);
        }
        break;

      case Terrain.Grass:
        ctx.strokeStyle = "#7a8b5a";
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.5;
        for (let i = 0; i < 30; i++) {
          const gx = rng() * w;
          const gy = rng() * h;
          ctx.beginPath();
          ctx.moveTo(gx, gy);
          ctx.lineTo(gx + (rng() - 0.5) * 4, gy - 2 - rng() * 5);
          ctx.stroke();
        }
        for (let i = 0; i < 12; i++) {
          ctx.fillStyle = detail;
          ctx.globalAlpha = 0.1;
          ctx.beginPath();
          ctx.ellipse(rng() * w, rng() * h, 2 + rng() * 3, 1 + rng(), 0, 0, Math.PI * 2);
          ctx.fill();
        }
        break;

      case Terrain.Water:
        ctx.strokeStyle = "#5a8a8a";
        ctx.lineWidth = 0.5;
        ctx.globalAlpha = 0.35;
        for (let i = 0; i < 8; i++) {
          const y = rng() * h;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.quadraticCurveTo(w * 0.5, y + 4 * (rng() - 0.5), w, y + rng() * 3);
          ctx.stroke();
        }
        break;

      default:
        for (let i = 0; i < 25; i++) {
          ctx.fillStyle = rng() > 0.5 ? detail : noise;
          ctx.globalAlpha = 0.15 + rng() * 0.25;
          ctx.fillRect(rng() * w, rng() * h, 1 + rng() * 2, 1 + rng() * 2);
        }
        break;
    }
    ctx.globalAlpha = 1;
  }

  /** Generate a single water rectangular texture frame with phase-shifted waves */
  private addWaterTextureFrame(
    ctx: CanvasRenderingContext2D, w: number, h: number,
    frame: number, totalFrames: number,
  ) {
    const phase = (frame / totalFrames) * Math.PI * 2;

    // Subtle depth gradient
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "rgba(74, 112, 112, 0.15)");
    grad.addColorStop(1, "rgba(42, 74, 74, 0.1)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Wave lines shifted by phase
    ctx.strokeStyle = "#5a9a9a";
    ctx.lineWidth = 0.8;
    ctx.globalAlpha = 0.3;
    for (let i = 0; i < 6; i++) {
      const baseY = (i + 0.5) * (h / 6);
      ctx.beginPath();
      for (let x = 0; x <= w; x += 4) {
        const y = baseY + Math.sin((x / w) * Math.PI * 3 + phase + i * 0.7) * 2.5;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Specular highlights
    ctx.fillStyle = "#7ababa";
    ctx.globalAlpha = 0.12;
    for (let i = 0; i < 5; i++) {
      const hx = ((i * 29 + frame * 17) % w);
      const hy = ((i * 37 + frame * 13) % h);
      ctx.beginPath();
      ctx.ellipse(hx, hy, 3, 1.5, phase + i, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** Generate a single water diamond tile frame with phase-shifted waves */
  private addWaterTileFrame(
    ctx: CanvasRenderingContext2D,
    frame: number, totalFrames: number,
  ) {
    const phase = (frame / totalFrames) * Math.PI * 2;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(TILE_HALF_W, 1);
    ctx.lineTo(TILE_W - 1, TILE_HALF_H);
    ctx.lineTo(TILE_HALF_W, TILE_H - 1);
    ctx.lineTo(1, TILE_HALF_H);
    ctx.closePath();
    ctx.clip();

    // Wave lines
    ctx.strokeStyle = "#5a9a9a";
    ctx.lineWidth = 0.7;
    ctx.globalAlpha = 0.35;
    for (let i = 0; i < 3; i++) {
      const baseY = 8 + i * 8;
      ctx.beginPath();
      for (let x = 10; x <= 54; x += 3) {
        const y = baseY + Math.sin((x / 64) * Math.PI * 4 + phase + i * 0.8) * 1.5;
        if (x === 10) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Small highlight
    ctx.fillStyle = "#7ababa";
    ctx.globalAlpha = 0.1;
    const hx = 25 + Math.cos(phase) * 6;
    const hy = 14 + Math.sin(phase) * 2;
    ctx.beginPath();
    ctx.ellipse(hx, hy, 3, 1, 0, 0, Math.PI * 2);
    ctx.fill();

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
