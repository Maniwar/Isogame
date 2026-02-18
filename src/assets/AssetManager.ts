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
   * Covers legacy hyphen-named wall assets and any naming mismatches.
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
        // Log terrain details to diagnose loading issues
        console.log(`[AssetManager] Terrain texture mode: ${this.hasTerrainTextures}`);
        if (this.hasTerrainTextures) {
          for (const [terrainVal, textures] of this.terrainTextures) {
            const name = Terrain[terrainVal] ?? terrainVal;
            const source = textures.length > 0 && textures[0] instanceof HTMLImageElement ? "AI" : "procedural";
            console.log(`[AssetManager] Terrain texture ${name}: ${textures.length} (${source})`);
          }
        }
        for (const [terrainVal, variants] of this.tiles) {
          const name = Terrain[terrainVal] ?? terrainVal;
          const aiCount = variants.filter(v => v instanceof HTMLImageElement || (v instanceof HTMLCanvasElement && v.width > 64)).length;
          console.log(`[AssetManager] Tile variants for ${name}: ${variants.length} total (${aiCount} AI)`);
        }
        // Log loaded sprites count
        const spriteEntries = [...this.sprites.entries()];
        const spriteAiCount = spriteEntries.reduce((sum, [, dirMap]) => {
          for (const img of dirMap.values()) {
            if (img instanceof HTMLImageElement) return sum + 1;
          }
          return sum;
        }, 0);
        console.log(`[AssetManager] Sprites: ${spriteEntries.length} keys, ${spriteAiCount} AI directions`);
        console.log(`[AssetManager] Objects: ${this.objects.size} keys`);
        console.log(`[AssetManager] Items: ${this.items.size} keys`);
        console.log(`[AssetManager] Portraits: ${this.portraits.size} keys`);

        if (this.hasAnimations) {
          const animKeys = [...this.animFrames.keys()];
          console.log(`[AssetManager] Animation frames loaded for: ${animKeys.join(", ")}`);
          // Validate sprite dimensions at load time
          this.validateSpriteDimensions();
          // Normalize frame sizes so all animations for a character are consistent
          this.normalizeAnimFrames();

          // Diagnostic: verify player_pistol animation data is populated
          for (const diagKey of ["player_pistol", "player"]) {
            const diagAnims = this.animFrames.get(diagKey);
            if (diagAnims) {
              const animNames = [...diagAnims.keys()];
              const dirCounts = animNames.map(a => `${a}:${diagAnims.get(a)?.size ?? 0}`);
              console.log(`[AssetManager] ${diagKey} anim dirs: ${dirCounts.join(", ")}`);
            } else {
              console.warn(`[AssetManager] ${diagKey} has NO animation data!`);
            }
          }
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

  /** Maps game item IDs to manifest icon keys */
  private static readonly ITEM_ICON_MAP: Record<string, string> = {
    "10mm_pistol": "item_pistol",
    "pipe_rifle": "item_rifle",
    "combat_knife": "item_knife",
    "baseball_bat": "item_bat",
    "leather_armor": "item_armor",
    "stimpak": "item_stimpak",
    "rad_away": "item_radaway",
    "nuka_cola": "item_nuka",
    "canned_food": "item_food",
    "bottle_caps": "item_caps",
    "bobby_pin": "item_pin",
    "holotape": "item_holotape",
  };

  getItem(key: string): DrawTarget | undefined {
    return this.items.get(key)
        ?? this.items.get(AssetManager.ITEM_ICON_MAP[key] ?? "");
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

        // Replace procedural textures with AI-generated ones.
        this.terrainTextures.set(terrain, []);
        this.terrainPatterns.delete(terrain);
        if (terrain === Terrain.Water) {
          this.waterPatternCache.clear();
        }

        for (const path of paths) {
          this.totalToLoad++;
          promises.push(
            this.loadImage(path).then((img) => {
              if (img) {
                // Mirror-tile the texture to eliminate edge seams.
                // Creates a 2x2 grid where adjacent copies are flipped,
                // so edges always match their mirrored neighbor perfectly.
                const seamless = this.makeMirrorTile(img);
                this.terrainTextures.get(terrain)!.push(seamless);
                this.loadedCount++;
              }
            }),
          );
        }
      }
    }

    // Legacy diamond tiles — fallback for assets that haven't been regenerated.
    // Skip Water: it uses procedural animated frames; AI tiles would break the animation.
    // AI tiles replace procedural: we collect AI tiles into a separate array,
    // then after all loads complete we swap them in (keeping procedural only
    // if zero AI tiles loaded for that terrain).
    const aiTileCollectors: { terrain: Terrain; tiles: DrawTarget[] }[] = [];
    if (manifest.tiles) {
      for (const [terrainName, pathOrPaths] of Object.entries(manifest.tiles)) {
        const terrain = Terrain[terrainName as keyof typeof Terrain];
        if (terrain === undefined || terrain === Terrain.Water) continue;

        const paths = Array.isArray(pathOrPaths) ? pathOrPaths : [pathOrPaths];
        const proceduralBase = this.tiles.get(terrain)?.[0];
        const collector: DrawTarget[] = [];
        aiTileCollectors.push({ terrain, tiles: collector });

        for (const path of paths) {
          this.totalToLoad++;
          promises.push(
            this.loadImage(path).then((img) => {
              if (img) {
                collector.push(this.compositeAiTile(img, proceduralBase));
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
    // When AI animations exist for a sprite, replace the entire animation map
    // (discarding procedural frames) to avoid mixing different content proportions
    // which would cause normalizeAnimFrames to scale sprites incorrectly.
    if (manifest.animations) {
      this.hasAnimations = true;
      for (const [spriteKey, anims] of Object.entries(manifest.animations)) {
        // Always create a fresh map — don't merge with procedural frames
        this.animFrames.set(spriteKey, new Map());
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

    // Objects — register under both the manifest key and the game alias.
    // AI-generated object images often have opaque backgrounds that need
    // to be removed so they composite correctly over terrain tiles.
    if (manifest.objects) {
      for (const [key, path] of Object.entries(manifest.objects)) {
        this.totalToLoad++;
        promises.push(
          this.loadImage(path).then((img) => {
            if (img) {
              const cleaned = this.cleanObjectAlpha(img);
              this.objects.set(key, cleaned);
              const alias = AssetManager.OBJECT_ALIAS[key];
              if (alias && !this.objects.has(alias)) {
                this.objects.set(alias, cleaned);
              }
              this.loadedCount++;
            }
          }),
        );
      }
    }

    // Items — keys are icon keys: "item_pistol", etc.
    // AI-generated item icons may have opaque backgrounds (same as objects).
    if (manifest.items) {
      for (const [key, path] of Object.entries(manifest.items)) {
        this.totalToLoad++;
        promises.push(
          this.loadImage(path).then((img) => {
            if (img) {
              const cleaned = this.cleanObjectAlpha(img);
              this.items.set(key, cleaned);
              this.loadedCount++;
            }
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

    // Replace procedural diamond tiles with AI tiles (if any loaded).
    // Done after Promise.all so all collector arrays are fully populated.
    for (const { terrain, tiles } of aiTileCollectors) {
      if (tiles.length > 0) {
        this.tiles.set(terrain, tiles);
      }
    }

    // If any AI terrain textures failed to load, fall back to procedural
    // for that terrain so getTerrainPattern doesn't return null.
    for (const [terrain, textures] of this.terrainTextures) {
      if (textures.length === 0) {
        // All AI textures failed — regenerate procedural for this terrain
        console.warn(`[AssetManager] AI terrain textures failed for ${Terrain[terrain]}, using procedural`);
        this.terrainTextures.delete(terrain);
        this.terrainPatterns.delete(terrain);
      }
    }
    // If ALL terrain textures were removed, disable texture mode entirely
    if (this.hasTerrainTextures && this.terrainTextures.size === 0) {
      this.hasTerrainTextures = false;
    }
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
   * Normalize animation frames so all frames for a character have consistent
   * content size and positioning. Fixes two issues:
   *
   * 1. Intra-character inconsistency: Some frames have wildly different content
   *    sizes (e.g. raider idle=32x58 but walk_2=64x64) due to sprite sheet
   *    slicing artifacts. This causes visible size jumping during animation.
   *
   * 2. Inter-character inconsistency: Player fills ~100% of 64x96 frame while
   *    NPCs only fill ~60%. This makes NPCs look tiny next to the player.
   *
   * Strategy: For each character, compute the median content height across all
   * frames. Replace outlier frames (content height deviates >25% from median)
   * with the nearest "normal" frame. Then scale all frames so content fills
   * a target proportion of the frame height.
   */
  private normalizeAnimFrames() {
    const FRAME_W = 64;
    const FRAME_H = 96;
    const TARGET_CONTENT_H = 88; // Target: content fills ~92% of frame
    const MIN_CONTENT_H = 40;    // Don't normalize very small/broken content

    let charsNormalized = 0;
    let framesFixed = 0;

    for (const [spriteKey, anims] of this.animFrames) {
      // Skip weapon variants that are aliases (same Map reference as their base key).
      // Weapon variants with their OWN loaded data (from manifest) need normalization.
      const isVariant = AssetManager.WEAPON_SUFFIXES.some(s => spriteKey.endsWith(`_${s}`));
      if (isVariant) {
        // Find the base key and check if this variant shares its Map reference
        const basePart = spriteKey.replace(/_[^_]+$/, "");
        const baseAnims = this.animFrames.get(basePart);
        if (baseAnims === anims) continue; // alias — skip (base handles normalization)
      }

      // Measure content bounds for every frame
      type FrameInfo = {
        animName: string; dir: string;
        contentH: number; contentW: number; top: number; bottom: number;
      };
      const frameInfos: FrameInfo[] = [];

      for (const [animName, dirMap] of anims) {
        for (const [dir, img] of dirMap) {
          const bounds = this.measureContent(img);
          if (bounds) {
            frameInfos.push({
              animName, dir,
              contentH: bounds.bottom - bounds.top,
              contentW: bounds.right - bounds.left,
              top: bounds.top, bottom: bounds.bottom,
            });
          }
        }
      }

      if (frameInfos.length === 0) continue;

      // Find median content height
      const heights = frameInfos.map(f => f.contentH).sort((a, b) => a - b);
      const medianH = heights[Math.floor(heights.length / 2)];

      if (medianH < MIN_CONTENT_H) continue;

      // Replace outlier frames (content height deviates >25% from median)
      // with the idle frame for that direction (most stable pose)
      const outlierThreshold = medianH * 0.25;
      for (const [, dirMap] of anims) {
        for (const [dir, img] of dirMap) {
          const bounds = this.measureContent(img);
          if (!bounds) continue;
          const contentH = bounds.bottom - bounds.top;
          if (Math.abs(contentH - medianH) > outlierThreshold) {
            // Find idle frame for this direction as replacement
            const idleDir = anims.get("idle");
            const replacement = idleDir?.get(dir as Direction);
            if (replacement && replacement !== img) {
              dirMap.set(dir as Direction, replacement);
              framesFixed++;
            }
          }
        }
      }

      // Scale character content to fill target proportion of frame
      if (medianH < TARGET_CONTENT_H * 0.85) {
        const scale = TARGET_CONTENT_H / medianH;
        for (const [, dirMap] of anims) {
          for (const [dir, img] of dirMap) {
            const normalized = this.scaleFrameContent(img, scale, FRAME_W, FRAME_H);
            if (normalized) {
              dirMap.set(dir as Direction, normalized);
            }
          }
        }
        charsNormalized++;
      }
    }

    if (charsNormalized > 0 || framesFixed > 0) {
      console.log(
        `[AssetManager] Frame normalization: ${charsNormalized} characters scaled, ` +
        `${framesFixed} outlier frames replaced`,
      );
    }

    // Walk-direction quality check: AI-generated walk sprites sometimes show
    // the character facing the same direction (usually S/front) regardless of
    // the nominal direction. Detect this by comparing walk frames across
    // directions and replace directionally-uniform walk frames with the
    // correctly-facing idle frame.
    let walkDirFixes = 0;
    const WALK_KEYS = ["walk_1", "walk_2", "walk_3", "walk_4"];
    const ALL_DIRS: Direction[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

    for (const [_spriteKey, anims] of this.animFrames) {
      const walk1Dir = anims.get("walk_1");
      const idleDir = anims.get("idle");
      if (!walk1Dir || !idleDir) continue;

      const refFrame = walk1Dir.get("S" as Direction);
      if (!refFrame) continue;

      // Compare each non-S direction's walk_1 frame with the S frame
      for (const dir of ALL_DIRS) {
        if (dir === "S") continue;
        const testFrame = walk1Dir.get(dir);
        if (!testFrame) continue;

        const similarity = this.computeImageSimilarity(refFrame, testFrame);
        if (similarity > 0.80) {
          // Walk frame is too similar to S — replace ALL walk frames for this
          // direction with the idle frame (which IS correctly directional)
          const idleFrame = idleDir.get(dir);
          if (!idleFrame) continue;
          for (const walkKey of WALK_KEYS) {
            const walkDirMap = anims.get(walkKey);
            if (walkDirMap) {
              walkDirMap.set(dir, idleFrame);
              walkDirFixes++;
            }
          }
        }
      }
    }
    if (walkDirFixes > 0) {
      console.log(`[AssetManager] Walk-direction fix: ${walkDirFixes} frames replaced with idle`);
    }
  }

  /**
   * Compare two images and return a similarity score (0.0 = totally different, 1.0 = identical).
   * Uses a fast downsampled pixel comparison to avoid expensive full-resolution checks.
   */
  private computeImageSimilarity(a: DrawTarget, b: DrawTarget): number {
    // Downsample to 16x24 for fast comparison
    const sw = 16;
    const sh = 24;
    const canvasA = this.createCanvas(sw, sh);
    const ctxA = canvasA.getContext("2d")!;
    ctxA.drawImage(a, 0, 0, sw, sh);
    const dataA = ctxA.getImageData(0, 0, sw, sh).data;

    const canvasB = this.createCanvas(sw, sh);
    const ctxB = canvasB.getContext("2d")!;
    ctxB.drawImage(b, 0, 0, sw, sh);
    const dataB = ctxB.getImageData(0, 0, sw, sh).data;

    let matchCount = 0;
    let totalPixels = 0;
    const colorThreshold = 30; // Allow some variance in color matching

    for (let i = 0; i < dataA.length; i += 4) {
      const aAlpha = dataA[i + 3];
      const bAlpha = dataB[i + 3];

      // Both transparent = match
      if (aAlpha < 20 && bAlpha < 20) {
        matchCount++;
        totalPixels++;
        continue;
      }
      // One transparent one not = no match
      if (aAlpha < 20 || bAlpha < 20) {
        totalPixels++;
        continue;
      }

      totalPixels++;
      const dr = Math.abs(dataA[i] - dataB[i]);
      const dg = Math.abs(dataA[i + 1] - dataB[i + 1]);
      const db = Math.abs(dataA[i + 2] - dataB[i + 2]);
      if (dr <= colorThreshold && dg <= colorThreshold && db <= colorThreshold) {
        matchCount++;
      }
    }

    return totalPixels > 0 ? matchCount / totalPixels : 0;
  }

  /** Measure the non-transparent content bounds of a sprite. */
  private measureContent(img: DrawTarget): { top: number; bottom: number; left: number; right: number } | null {
    const w = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
    const h = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
    if (w === 0 || h === 0) return null;

    const canvas = this.createCanvas(w, h);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;

    let top = h, bottom = 0, left = w, right = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 10) {
          if (y < top) top = y;
          if (y + 1 > bottom) bottom = y + 1;
          if (x < left) left = x;
          if (x + 1 > right) right = x + 1;
        }
      }
    }
    if (bottom <= top) return null;
    return { top, bottom, left, right };
  }

  /** Scale content within a frame to a new size, maintaining bottom-center alignment. */
  private scaleFrameContent(
    img: DrawTarget, scale: number, frameW: number, frameH: number,
  ): HTMLCanvasElement | null {
    const bounds = this.measureContent(img);
    if (!bounds) return null;

    const contentW = bounds.right - bounds.left;
    const contentH = bounds.bottom - bounds.top;

    // Extract content region
    const extract = this.createCanvas(contentW, contentH);
    const ectx = extract.getContext("2d")!;
    ectx.drawImage(img, -bounds.left, -bounds.top);

    // Scale content
    const newW = Math.min(frameW, Math.round(contentW * scale));
    const newH = Math.min(frameH, Math.round(contentH * scale));

    // Place on new frame canvas: center horizontally, bottom-align
    const canvas = this.createCanvas(frameW, frameH);
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    (ctx as any).imageSmoothingQuality = "high";

    const dx = Math.round((frameW - newW) / 2);
    const dy = frameH - newH;
    ctx.drawImage(extract, 0, 0, contentW, contentH, dx, dy, newW, newH);

    return canvas;
  }

  /**
   * Register weapon variant aliases so that lookups like "player_pistol" resolve
   * to "player" animation/sprite data when per-weapon assets haven't been generated.
   * Only processes true base keys — skips keys that are themselves weapon variants
   * to prevent creating nonsense like "player_pistol_pistol".
   * Preserves manifest-loaded variant data: if the manifest provided specific
   * assets for a variant (e.g., player_pistol with weapon-specific art), those
   * are kept. Only empty or missing variants get the base key's data.
   */
  private registerWeaponAliases() {
    // Helper: check if a key is itself a weapon variant (ends with a suffix)
    const isVariantKey = (key: string) =>
      AssetManager.WEAPON_SUFFIXES.some((s) => key.endsWith(`_${s}`));

    // Helper: check if an anim map has actual loaded content (non-empty direction maps)
    const hasContent = (map: Map<string, Map<string, unknown>> | undefined): boolean => {
      if (!map || map.size === 0) return false;
      for (const dirMap of map.values()) {
        if (dirMap.size > 0) return true;
      }
      return false;
    };

    // Alias animation frames: player → player_pistol, player_rifle, etc.
    const animBaseKeys = [...this.animFrames.keys()].filter((k) => !isVariantKey(k));
    for (const baseKey of animBaseKeys) {
      const baseData = this.animFrames.get(baseKey)!;
      for (const suffix of AssetManager.WEAPON_SUFFIXES) {
        const variantKey = `${baseKey}_${suffix}`;
        const existing = this.animFrames.get(variantKey);
        // Only alias if the variant doesn't already have manifest-loaded content
        if (!hasContent(existing)) {
          this.animFrames.set(variantKey, baseData);
        }
      }
    }
    // Alias static sprites the same way
    const spriteBaseKeys = [...this.sprites.keys()].filter((k) => !isVariantKey(k));
    for (const baseKey of spriteBaseKeys) {
      const baseData = this.sprites.get(baseKey)!;
      for (const suffix of AssetManager.WEAPON_SUFFIXES) {
        const variantKey = `${baseKey}_${suffix}`;
        const existing = this.sprites.get(variantKey);
        // Only alias if the variant doesn't have its own data
        if (!existing || existing.size === 0) {
          this.sprites.set(variantKey, baseData);
        }
      }
    }
  }

  /**
   * Create a seamless mirror-tiled version of a texture.
   * Draws the image in a 2x2 grid with alternating H/V flips so that
   * edges always meet their mirror image — guaranteeing zero seams.
   * The result is 2x the original size and tiles perfectly.
   */
  private makeMirrorTile(img: HTMLImageElement): HTMLCanvasElement {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const canvas = this.createCanvas(w * 2, h * 2);
    const ctx = canvas.getContext("2d")!;

    // Top-left: normal
    ctx.drawImage(img, 0, 0);
    // Top-right: flip horizontal
    ctx.save();
    ctx.translate(w * 2, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
    // Bottom-left: flip vertical
    ctx.save();
    ctx.translate(0, h * 2);
    ctx.scale(1, -1);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
    // Bottom-right: flip both
    ctx.save();
    ctx.translate(w * 2, h * 2);
    ctx.scale(-1, -1);
    ctx.drawImage(img, 0, 0);
    ctx.restore();

    return canvas;
  }

  /**
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

  /**
   * Remove opaque backgrounds from AI-generated object images.
   *
   * Uses flood-fill from all border pixels to identify connected background
   * regions, then makes them transparent. Handles:
   *  - Solid backgrounds (single color)
   *  - Checkerboard "transparency" patterns (two alternating colors)
   *  - Green chroma key backgrounds
   *
   * Only removes pixels connected to the image border (flood-fill),
   * so interior pixels of similar color are preserved.
   */
  private cleanObjectAlpha(img: HTMLImageElement): HTMLCanvasElement {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const canvas = this.createCanvas(w, h);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);

    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    // Collect all border pixel colors (opaque ones only)
    const borderColors: [number, number, number][] = [];
    const addBorder = (x: number, y: number) => {
      const idx = (y * w + x) * 4;
      if (data[idx + 3] > 180) {
        borderColors.push([data[idx], data[idx + 1], data[idx + 2]]);
      }
    };
    for (let x = 0; x < w; x++) { addBorder(x, 0); addBorder(x, h - 1); }
    for (let y = 1; y < h - 1; y++) { addBorder(0, y); addBorder(w - 1, y); }

    // If most border pixels are already transparent, image is fine
    if (borderColors.length < Math.floor((w + h) * 0.5)) return canvas;

    // Find up to 2 dominant border colors (handles checkerboard patterns)
    // Simple k-means with k=2
    const bgColors = this.findDominantColors(borderColors, 2);
    if (bgColors.length === 0) return canvas;

    const threshold = 80;
    const featherRange = 40;

    // Check if pixel matches any background color
    const isBg = (r: number, g: number, b: number): number => {
      let minDist = Infinity;
      for (const [br, bg, bb] of bgColors) {
        const d = Math.abs(r - br) + Math.abs(g - bg) + Math.abs(b - bb);
        if (d < minDist) minDist = d;
      }
      return minDist;
    };

    // Flood-fill from border pixels: BFS to find all connected background
    const visited = new Uint8Array(w * h);
    const bgMask = new Uint8Array(w * h); // 1 = background, 2 = feather
    const queue: number[] = [];

    // Seed from all border pixels that match background colors
    for (let x = 0; x < w; x++) {
      for (const y of [0, h - 1]) {
        const idx = (y * w + x) * 4;
        if (data[idx + 3] < 10) continue; // already transparent
        const dist = isBg(data[idx], data[idx + 1], data[idx + 2]);
        if (dist < threshold + featherRange) {
          const pi = y * w + x;
          visited[pi] = 1;
          bgMask[pi] = dist < threshold ? 1 : 2;
          queue.push(pi);
        }
      }
    }
    for (let y = 1; y < h - 1; y++) {
      for (const x of [0, w - 1]) {
        const idx = (y * w + x) * 4;
        if (data[idx + 3] < 10) continue;
        const dist = isBg(data[idx], data[idx + 1], data[idx + 2]);
        if (dist < threshold + featherRange) {
          const pi = y * w + x;
          if (!visited[pi]) {
            visited[pi] = 1;
            bgMask[pi] = dist < threshold ? 1 : 2;
            queue.push(pi);
          }
        }
      }
    }

    // BFS flood-fill: expand from border into connected background pixels
    let head = 0;
    while (head < queue.length) {
      const pi = queue[head++];
      const px = pi % w;
      const py = (pi - px) / w;

      for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]) {
        const nx = px + dx;
        const ny = py + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const ni = ny * w + nx;
        if (visited[ni]) continue;
        visited[ni] = 1;

        const idx = ni * 4;
        if (data[idx + 3] < 10) continue; // already transparent

        const dist = isBg(data[idx], data[idx + 1], data[idx + 2]);
        if (dist < threshold) {
          bgMask[ni] = 1;
          queue.push(ni);
        } else if (dist < threshold + featherRange) {
          bgMask[ni] = 2; // feather edge — don't expand further
        }
      }
    }

    // Apply mask: make background transparent, feather edges
    for (let i = 0; i < w * h; i++) {
      if (bgMask[i] === 1) {
        data[i * 4 + 3] = 0; // fully transparent
      } else if (bgMask[i] === 2) {
        const idx = i * 4;
        const dist = isBg(data[idx], data[idx + 1], data[idx + 2]);
        const blend = Math.min(1, (dist - threshold) / featherRange);
        data[idx + 3] = Math.round(data[idx + 3] * blend);
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  /** Find up to k dominant colors from a set of RGB samples using simple clustering. */
  private findDominantColors(
    samples: [number, number, number][], k: number
  ): [number, number, number][] {
    if (samples.length === 0) return [];
    if (samples.length <= k) return samples;

    // Initialize centroids: first sample + most distant sample
    const centroids: [number, number, number][] = [samples[0]];
    if (k >= 2) {
      let maxDist = 0;
      let farthest = samples[0];
      for (const s of samples) {
        const d = Math.abs(s[0] - centroids[0][0]) + Math.abs(s[1] - centroids[0][1]) + Math.abs(s[2] - centroids[0][2]);
        if (d > maxDist) { maxDist = d; farthest = s; }
      }
      // Only use 2 centroids if there's meaningful color variation
      if (maxDist > 40) {
        centroids.push(farthest);
      }
    }

    // 5 iterations of k-means
    for (let iter = 0; iter < 5; iter++) {
      const sums = centroids.map(() => [0, 0, 0, 0] as [number, number, number, number]); // r, g, b, count
      for (const [r, g, b] of samples) {
        let bestC = 0;
        let bestD = Infinity;
        for (let c = 0; c < centroids.length; c++) {
          const d = Math.abs(r - centroids[c][0]) + Math.abs(g - centroids[c][1]) + Math.abs(b - centroids[c][2]);
          if (d < bestD) { bestD = d; bestC = c; }
        }
        sums[bestC][0] += r; sums[bestC][1] += g; sums[bestC][2] += b; sums[bestC][3]++;
      }
      for (let c = 0; c < centroids.length; c++) {
        if (sums[c][3] > 0) {
          centroids[c] = [
            Math.round(sums[c][0] / sums[c][3]),
            Math.round(sums[c][1] / sums[c][3]),
            Math.round(sums[c][2] / sums[c][3]),
          ];
        }
      }
    }
    return centroids;
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
      [Terrain.Water]:       { base: "#1E3A5A", detail: "#2A5080", noise: "#162E48" },
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

    // Depth gradient — darker at bottom, lighter at top
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "rgba(42, 80, 128, 0.2)");
    grad.addColorStop(1, "rgba(22, 46, 72, 0.15)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Primary wave lines — broader, more visible
    ctx.strokeStyle = "#3A6A9A";
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.35;
    for (let i = 0; i < 6; i++) {
      const baseY = (i + 0.5) * (h / 6);
      ctx.beginPath();
      for (let x = 0; x <= w; x += 3) {
        const y = baseY + Math.sin((x / w) * Math.PI * 3 + phase + i * 0.7) * 3
                        + Math.sin((x / w) * Math.PI * 5 + phase * 1.3 + i) * 1.2;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Secondary ripples — thinner, offset phase
    ctx.strokeStyle = "#4A80B0";
    ctx.lineWidth = 0.6;
    ctx.globalAlpha = 0.2;
    for (let i = 0; i < 4; i++) {
      const baseY = (i + 1) * (h / 5);
      ctx.beginPath();
      for (let x = 0; x <= w; x += 4) {
        const y = baseY + Math.sin((x / w) * Math.PI * 4 + phase * 0.7 + i * 1.2) * 2;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Specular highlights — small bright spots
    ctx.fillStyle = "#7AC0E0";
    ctx.globalAlpha = 0.15;
    for (let i = 0; i < 6; i++) {
      const hx = ((i * 29 + frame * 17) % w);
      const hy = ((i * 37 + frame * 13) % h);
      ctx.beginPath();
      ctx.ellipse(hx, hy, 3.5, 1.5, phase + i, 0, Math.PI * 2);
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

    // Primary wave lines
    ctx.strokeStyle = "#3A6A9A";
    ctx.lineWidth = 1.0;
    ctx.globalAlpha = 0.4;
    for (let i = 0; i < 3; i++) {
      const baseY = 8 + i * 8;
      ctx.beginPath();
      for (let x = 10; x <= 54; x += 3) {
        const y = baseY + Math.sin((x / 64) * Math.PI * 4 + phase + i * 0.8) * 2
                        + Math.sin((x / 64) * Math.PI * 6 + phase * 1.3) * 0.8;
        if (x === 10) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Secondary ripples
    ctx.strokeStyle = "#4A80B0";
    ctx.lineWidth = 0.5;
    ctx.globalAlpha = 0.25;
    for (let i = 0; i < 2; i++) {
      const baseY = 12 + i * 10;
      ctx.beginPath();
      for (let x = 14; x <= 50; x += 3) {
        const y = baseY + Math.sin((x / 64) * Math.PI * 5 + phase * 0.8 + i * 1.2) * 1.5;
        if (x === 14) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Specular highlight
    ctx.fillStyle = "#7AC0E0";
    ctx.globalAlpha = 0.15;
    const hx = 25 + Math.cos(phase) * 6;
    const hy = 14 + Math.sin(phase) * 2;
    ctx.beginPath();
    ctx.ellipse(hx, hy, 3.5, 1.2, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  private generateSprites() {
    const configs: Record<string, { body: string; head: string; accent: string }> = {
      player:          { body: "#6b5340", head: "#d4c4a0", accent: "#40c040" },
      npc_sheriff:     { body: "#5a4a3a", head: "#d4c4a0", accent: "#c4703a" },
      npc_merchant:    { body: "#7a6b5a", head: "#d4c4a0", accent: "#8ec44a" },
      npc_doc:         { body: "#8e8e7e", head: "#d4c4a0", accent: "#4a8ab0" },
      npc_raider:      { body: "#4a3a2a", head: "#c4a080", accent: "#b83030" },
      npc_guard:       { body: "#4a5a4a", head: "#c4b490", accent: "#6a8a5a" },
      npc_caravan:     { body: "#8b7355", head: "#c4a880", accent: "#b89060" },
      npc_wastelander: { body: "#6a5a6a", head: "#d4b8a0", accent: "#9070a0" },
      npc_tribal:      { body: "#7a6040", head: "#b8a070", accent: "#a08040" },
      npc_ghoul:       { body: "#5a5a4a", head: "#8a8a6a", accent: "#6a7a5a" },
      npc_mutant:      { body: "#4a6a3a", head: "#6a8a5a", accent: "#3a5a2a" },
    };
    const dirs: Direction[] = ["N","NE","E","SE","S","SW","W","NW"];
    const frameKeys = ["idle", "walk_1", "walk_2", "walk_3", "walk_4", "attack_1", "attack_2", "hit"];

    for (const [key, colors] of Object.entries(configs)) {
      // Static sprites (backward compat)
      const m = new Map<Direction, HTMLCanvasElement>();
      for (const d of dirs) m.set(d, this.genCharFrame(colors, d, key === "player", "idle"));
      this.sprites.set(key, m);

      // Animation frames
      const animData = new Map<string, Map<Direction, HTMLCanvasElement>>();
      for (const fk of frameKeys) {
        const dirMap = new Map<Direction, HTMLCanvasElement>();
        for (const d of dirs) {
          dirMap.set(d, this.genCharFrame(colors, d, key === "player", fk));
        }
        animData.set(fk, dirMap);
      }
      this.animFrames.set(key, animData);
    }
    this.hasAnimations = true;
  }

  /**
   * Generate a single procedural character frame.
   * frameKey controls pose: idle, walk_1-4, attack_1-2, hit.
   */
  private genCharFrame(
    c: {body:string;head:string;accent:string},
    dir: Direction, isPlayer: boolean, frameKey: string,
  ): HTMLCanvasElement {
    const canvas=this.createCanvas(64,96), ctx=canvas.getContext("2d")!;
    ctx.scale(64/24, 96/36);
    const w=24, h=36, cx=w/2;
    const bs=this.dirOff(dir);

    // Leg stride offsets per walk frame
    // [leftLegDx, leftLegDy, rightLegDx, rightLegDy]
    let legOff = [0, 0, 0, 0];
    let bodyBob = 0;
    let armSwing = 0; // for walk arm counter-swing

    switch (frameKey) {
      case "walk_1": // left foot forward
        legOff = [-2, -1, 2, 1]; bodyBob = -0.5; armSwing = 1;
        break;
      case "walk_2": // passing (legs together, body higher)
        legOff = [0, 0, 0, 0]; bodyBob = -1;
        break;
      case "walk_3": // right foot forward
        legOff = [2, 1, -2, -1]; bodyBob = -0.5; armSwing = -1;
        break;
      case "walk_4": // passing opposite
        legOff = [0, 0, 0, 0]; bodyBob = -1;
        break;
      case "attack_1": // wind-up
        armSwing = -2;
        break;
      case "attack_2": // strike
        armSwing = 3;
        break;
      case "hit": // recoil
        bodyBob = 1;
        break;
    }

    // Shadow
    ctx.fillStyle="rgba(0,0,0,0.25)";
    ctx.beginPath(); ctx.ellipse(cx,h-3,8,3,0,0,Math.PI*2); ctx.fill();

    // Body (torso)
    ctx.fillStyle=c.body;
    ctx.fillRect(cx-5+bs*1.5, 14+bodyBob, 10, 14);

    // Belt accent
    ctx.fillStyle=c.accent;
    ctx.fillRect(cx-5+bs*1.5, 20+bodyBob, 10, 2);

    // Arms (subtle swing during walk/attack)
    if (armSwing !== 0) {
      ctx.fillStyle=this.darken(c.body, 0.8);
      const armY = 16 + bodyBob;
      // Left arm
      ctx.fillRect(cx-6+bs*1.5 - armSwing*0.5, armY, 2, 8);
      // Right arm
      ctx.fillRect(cx+5+bs*1.5 + armSwing*0.5, armY, 2, 8);
    }

    // Legs with stride offsets
    const ls=Math.abs(bs)>0?2:0;
    ctx.fillStyle=this.darken(c.body,0.7);
    // Left leg
    ctx.fillRect(cx-3+bs-ls + legOff[0], 28+bodyBob + legOff[1], 3, 5 - legOff[1]);
    // Right leg
    ctx.fillRect(cx+bs+ls + legOff[2], 28+bodyBob + legOff[3], 3, 5 - legOff[3]);

    // Boots
    ctx.fillStyle="#3a3a2e";
    ctx.fillRect(cx-3+bs-ls + legOff[0], 32 + Math.max(0, legOff[1]), 3, 2);
    ctx.fillRect(cx+bs+ls + legOff[2], 32 + Math.max(0, legOff[3]), 3, 2);

    // Head
    ctx.fillStyle=c.head;
    ctx.beginPath(); ctx.arc(cx+bs, 10+bodyBob, 5, 0, Math.PI*2); ctx.fill();

    // Eyes (front-facing only)
    if(dir!=="N"&&dir!=="NW"&&dir!=="NE"){
      ctx.fillStyle="#1e1e16";
      const eo=bs*0.5;
      ctx.fillRect(cx-2+eo, 9+bodyBob, 1, 1);
      ctx.fillRect(cx+1+eo, 9+bodyBob, 1, 1);
    }

    // Player glow ring
    if(isPlayer){
      ctx.strokeStyle="rgba(64,192,64,0.5)"; ctx.lineWidth=0.5;
      ctx.beginPath(); ctx.arc(cx+bs, 10+bodyBob, 6, 0, Math.PI*2); ctx.stroke();
    }

    // Raider weapon
    if(c.accent==="#b83030"){
      ctx.strokeStyle="#9e9e8e"; ctx.lineWidth=1;
      ctx.beginPath();
      ctx.moveTo(cx+5+bs + armSwing*0.5, 16+bodyBob);
      ctx.lineTo(cx+10+bs + armSwing, 12+bodyBob);
      ctx.stroke();
    }

    return canvas;
  }

  private dirOff(d: Direction): number { return d==="E"||d==="NE"||d==="SE"?2:d==="W"||d==="NW"||d==="SW"?-2:0; }

  private generateObjects() {
    // Wall — isometric 3D box
    const wall=this.createCanvas(TILE_W,32), wc=wall.getContext("2d")!;
    wc.fillStyle="#7a6a5a"; wc.beginPath(); wc.moveTo(TILE_HALF_W,0); wc.lineTo(TILE_W,8); wc.lineTo(TILE_W,24); wc.lineTo(TILE_HALF_W,32); wc.lineTo(0,24); wc.lineTo(0,8); wc.closePath(); wc.fill();
    wc.fillStyle="#8e7e6e"; wc.beginPath(); wc.moveTo(TILE_HALF_W,0); wc.lineTo(TILE_W,8); wc.lineTo(TILE_HALF_W,16); wc.lineTo(0,8); wc.closePath(); wc.fill();
    this.objects.set("wall",wall);

    // Barrel — rusted 55-gallon drum
    const barrel=this.createCanvas(16,20), bc=barrel.getContext("2d")!;
    bc.fillStyle="#7a3b1e"; bc.fillRect(2,4,12,14); bc.fillStyle="#a0522d"; bc.beginPath(); bc.ellipse(8,4,6,3,0,0,Math.PI*2); bc.fill();
    bc.fillStyle="#c4703a"; bc.fillRect(2,8,12,2); bc.fillRect(2,14,12,2);
    this.objects.set("barrel",barrel);

    // Rock — irregular boulder
    const rock=this.createCanvas(18,14), rc=rock.getContext("2d")!;
    rc.fillStyle="#6e6e5e"; rc.beginPath(); rc.moveTo(3,12); rc.lineTo(1,8); rc.lineTo(4,3); rc.lineTo(10,1); rc.lineTo(16,4); rc.lineTo(17,10); rc.lineTo(13,13); rc.closePath(); rc.fill();
    rc.fillStyle="#8e8e7e"; rc.beginPath(); rc.moveTo(4,3); rc.lineTo(10,1); rc.lineTo(16,4); rc.lineTo(10,6); rc.closePath(); rc.fill();
    this.objects.set("rock",rock);

    // Destroyed car — rusted car husk
    const car=this.createCanvas(40,24), cc=car.getContext("2d")!;
    cc.fillStyle="#6b5340"; cc.fillRect(4,10,32,10); // body
    cc.fillStyle="#5c4a3a"; cc.fillRect(8,4,24,8); // roof
    cc.fillStyle="#3a3a2e"; cc.fillRect(10,6,8,4); cc.fillRect(22,6,8,4); // windows
    cc.fillStyle="#4a4a3e"; cc.beginPath(); cc.arc(10,20,3,0,Math.PI*2); cc.fill(); // wheels
    cc.beginPath(); cc.arc(30,20,3,0,Math.PI*2); cc.fill();
    cc.fillStyle="#7a3b1e"; cc.fillRect(4,12,32,1); // rust stripe
    this.objects.set("destroyed_car",car);

    // Scrap pile — tangled metal
    const scrap=this.createCanvas(20,16), sc=scrap.getContext("2d")!;
    sc.fillStyle="#6e6e5e"; sc.fillRect(3,8,14,6); // base
    sc.fillStyle="#5a5a4a"; sc.fillRect(5,5,4,8); sc.fillRect(11,4,3,9); // pieces
    sc.fillStyle="#7a3b1e"; sc.fillRect(7,6,6,2); // rust
    sc.fillStyle="#9e9e8e"; sc.fillRect(4,10,2,3); // shiny bit
    this.objects.set("scrap_pile",scrap);

    // Tire pile — stacked tires
    const tire=this.createCanvas(18,14), tc=tire.getContext("2d")!;
    tc.fillStyle="#3a3a2e"; tc.beginPath(); tc.ellipse(9,10,7,4,0,0,Math.PI*2); tc.fill();
    tc.beginPath(); tc.ellipse(9,7,6,3,0,0,Math.PI*2); tc.fill();
    tc.fillStyle="#4a4a3e"; tc.beginPath(); tc.ellipse(9,7,4,2,0,0,Math.PI*2); tc.fill();
    this.objects.set("tire_pile",tire);

    // Rubble pile — concrete chunks
    const rub=this.createCanvas(22,14), rbc=rub.getContext("2d")!;
    rbc.fillStyle="#7a7a6e"; rbc.fillRect(2,8,8,5); rbc.fillRect(10,6,6,7); rbc.fillRect(14,9,6,4);
    rbc.fillStyle="#6e6e5e"; rbc.fillRect(4,5,5,4); rbc.fillRect(12,4,4,3);
    rbc.fillStyle="#5c4a3a"; rbc.fillRect(3,10,2,2); rbc.fillRect(16,10,2,2); // rebar
    this.objects.set("rubble_pile",rub);

    // Crate — wooden shipping crate
    const crate=this.createCanvas(18,18), crc=crate.getContext("2d")!;
    crc.fillStyle="#8b7355"; crc.fillRect(2,4,14,12); // body
    crc.fillStyle="#6b5340"; crc.fillRect(2,4,14,2); // top
    crc.fillRect(2,9,14,1); // plank line
    crc.fillStyle="#5c4a3a"; crc.fillRect(4,4,1,12); crc.fillRect(13,4,1,12); // nails/edges
    this.objects.set("crate",crate);

    // Dumpster — large metal container
    const dump=this.createCanvas(26,20), dc=dump.getContext("2d")!;
    dc.fillStyle="#4a5b3a"; dc.fillRect(2,6,22,12); // body (olive drab)
    dc.fillStyle="#3a4a2e"; dc.fillRect(2,6,22,2); // lid
    dc.fillStyle="#5c4a3a"; dc.fillRect(4,9,18,1); dc.fillRect(4,14,18,1); // rust bands
    this.objects.set("dumpster",dump);

    // Footlocker — military chest
    const fl=this.createCanvas(18,12), fc=fl.getContext("2d")!;
    fc.fillStyle="#4a5b3a"; fc.fillRect(2,3,14,8); // olive drab body
    fc.fillStyle="#3a4a2e"; fc.fillRect(2,3,14,2); // lid
    fc.fillStyle="#9e9e8e"; fc.fillRect(8,5,2,1); // latch
    this.objects.set("footlocker",fl);

    // Dead tree — leafless trunk with branches
    const tree=this.createCanvas(24,36), trc=tree.getContext("2d")!;
    trc.fillStyle="#5c4a3a"; trc.fillRect(10,12,4,24); // trunk
    trc.fillStyle="#6b5340";
    trc.fillRect(6,10,4,2); trc.fillRect(3,6,4,2); // left branch
    trc.fillRect(14,8,4,2); trc.fillRect(17,4,4,2); // right branch
    trc.fillRect(8,4,3,2); // top branch
    this.objects.set("dead_tree",tree);

    // Cactus — saguaro style
    const cact=this.createCanvas(16,28), cac=cact.getContext("2d")!;
    cac.fillStyle="#4a5b3a"; cac.fillRect(6,8,4,20); // trunk
    cac.fillRect(2,10,4,2); cac.fillRect(2,10,2,8); // left arm
    cac.fillRect(10,14,4,2); cac.fillRect(12,12,2,6); // right arm
    cac.fillStyle="#7a8b5a"; cac.fillRect(7,8,2,2); // highlight
    this.objects.set("cactus",cact);

    // Bones — scattered skeleton remains
    const bone=this.createCanvas(20,12), bnc=bone.getContext("2d")!;
    bnc.fillStyle="#d4c4a0";
    bnc.beginPath(); bnc.arc(6,4,3,0,Math.PI*2); bnc.fill(); // skull
    bnc.fillRect(8,5,8,1); bnc.fillRect(8,7,6,1); // ribs
    bnc.fillRect(14,4,4,1); bnc.fillRect(3,8,5,1); // long bones
    bnc.fillStyle="#b8a67c"; bnc.fillRect(5,3,2,1); // eye sockets
    this.objects.set("bones",bone);

    // Street lamp — bent post with broken globe
    const lamp=this.createCanvas(12,34), lc=lamp.getContext("2d")!;
    lc.fillStyle="#6e6e5e"; lc.fillRect(5,8,2,26); // post
    lc.fillRect(5,8,6,2); // arm
    lc.fillStyle="#9e9e8e"; lc.beginPath(); lc.arc(10,7,3,0,Math.PI*2); lc.fill(); // globe
    lc.fillStyle="#6e6e5e"; lc.fillRect(4,32,4,2); // base
    this.objects.set("street_lamp",lamp);

    // Sign post — bent post with faded sign
    const sign=this.createCanvas(14,26), sgc=sign.getContext("2d")!;
    sgc.fillStyle="#6e6e5e"; sgc.fillRect(6,10,2,16); // post
    sgc.fillStyle="#7a3b1e"; sgc.fillRect(2,2,10,8); // sign face (rusted)
    sgc.fillStyle="#b8a67c"; sgc.fillRect(4,4,6,1); sgc.fillRect(4,6,4,1); // faded text lines
    this.objects.set("sign_post",sign);

    // Mailbox — rusted blue mailbox
    const mb=this.createCanvas(12,16), mbc=mb.getContext("2d")!;
    mbc.fillStyle="#3a4a6a"; mbc.fillRect(2,4,8,8); // body (faded blue)
    mbc.fillStyle="#2a3a5a"; mbc.fillRect(2,4,8,2); // top curve
    mbc.fillStyle="#7a3b1e"; mbc.fillRect(2,8,8,1); // rust band
    mbc.fillStyle="#6e6e5e"; mbc.fillRect(4,12,4,4); // post
    this.objects.set("mailbox",mb);

    // Fire hydrant — squat red/yellow
    const fh=this.createCanvas(10,14), fhc=fh.getContext("2d")!;
    fhc.fillStyle="#b83030"; fhc.fillRect(3,4,4,8); // body
    fhc.fillStyle="#c4703a"; fhc.fillRect(2,6,6,2); // nozzle
    fhc.fillStyle="#b8a67c"; fhc.fillRect(3,4,4,1); // cap
    fhc.fillStyle="#6e6e5e"; fhc.fillRect(3,12,4,2); // base
    this.objects.set("fire_hydrant",fh);

    // Fence post — broken wooden fence
    const fp=this.createCanvas(22,18), fpc=fp.getContext("2d")!;
    fpc.fillStyle="#6b5340"; fpc.fillRect(3,2,2,16); fpc.fillRect(17,4,2,14); // posts
    fpc.fillStyle="#8b7355"; fpc.fillRect(5,6,12,2); fpc.fillRect(5,12,8,2); // planks
    this.objects.set("fence_post",fp);

    // Tent — makeshift shelter
    const tent=this.createCanvas(28,22), tnc=tent.getContext("2d")!;
    tnc.fillStyle="#6b5340";
    tnc.beginPath(); tnc.moveTo(14,2); tnc.lineTo(26,18); tnc.lineTo(2,18); tnc.closePath(); tnc.fill();
    tnc.fillStyle="#5c4a3a";
    tnc.beginPath(); tnc.moveTo(14,2); tnc.lineTo(2,18); tnc.lineTo(14,14); tnc.closePath(); tnc.fill();
    tnc.fillStyle="#8b7355"; tnc.fillRect(10,12,8,6); // opening
    this.objects.set("tent",tent);

    // Toxic barrel — hazard drum with green glow
    const tb=this.createCanvas(16,22), tbc=tb.getContext("2d")!;
    tbc.fillStyle="#5c4a3a"; tbc.fillRect(2,4,12,14); // drum body
    tbc.fillStyle="#6b5340"; tbc.beginPath(); tbc.ellipse(8,4,6,3,0,0,Math.PI*2); tbc.fill(); // top
    tbc.fillStyle="#b8a67c"; tbc.fillRect(5,8,6,3); // hazard label
    tbc.fillStyle="#8ec44a"; tbc.fillRect(6,9,4,1); // trefoil
    tbc.fillStyle="rgba(142,196,74,0.4)"; tbc.fillRect(4,18,8,4); // green puddle
    this.objects.set("toxic_barrel",tb);

    // Crater — blast crater in ground
    const crater=this.createCanvas(22,12), crc2=crater.getContext("2d")!;
    crc2.fillStyle="#5c4a3a"; crc2.beginPath(); crc2.ellipse(11,7,10,5,0,0,Math.PI*2); crc2.fill();
    crc2.fillStyle="#3a3a2e"; crc2.beginPath(); crc2.ellipse(11,7,7,3,0,0,Math.PI*2); crc2.fill();
    crc2.fillStyle="#6b5340"; crc2.beginPath(); crc2.ellipse(11,6,3,1.5,0,0,Math.PI*2); crc2.fill();
    this.objects.set("crater",crater);

    // Campfire — ring of stones with embers
    const cf=this.createCanvas(18,14), cfc=cf.getContext("2d")!;
    cfc.fillStyle="#6e6e5e"; // stones
    const stoneAngles = [0, 0.8, 1.6, 2.4, 3.2, 4.0, 4.8, 5.6];
    for (const a of stoneAngles) {
      cfc.fillRect(9 + Math.cos(a)*6 - 1, 7 + Math.sin(a)*4 - 1, 3, 3);
    }
    cfc.fillStyle="#7a3b1e"; cfc.fillRect(7,6,4,3); // charred wood
    cfc.fillStyle="#c4703a"; cfc.fillRect(8,6,2,2); // embers
    cfc.fillStyle="rgba(184,48,48,0.3)"; cfc.beginPath(); cfc.arc(9,7,2,0,Math.PI*2); cfc.fill(); // glow
    this.objects.set("campfire",cf);
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
