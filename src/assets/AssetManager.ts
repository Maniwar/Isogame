import { Terrain, Direction, TILE_W, TILE_H, TILE_HALF_W, TILE_HALF_H } from "../types";

/**
 * Procedural asset generator and manager.
 *
 * Generates all game art programmatically at startup using Canvas 2D.
 * These serve as playable placeholders until AI-generated art is available.
 */
export class AssetManager {
  private tiles = new Map<Terrain, HTMLCanvasElement>();
  private sprites = new Map<string, Map<Direction, HTMLCanvasElement>>();
  private objects = new Map<string, HTMLCanvasElement>();
  private items = new Map<string, HTMLCanvasElement>();

  generateAll() {
    this.generateTiles();
    this.generateSprites();
    this.generateObjects();
    this.generateItems();
  }

  getTile(terrain: Terrain): HTMLCanvasElement | undefined {
    return this.tiles.get(terrain);
  }

  getSprite(key: string, dir: Direction): HTMLCanvasElement | undefined {
    return this.sprites.get(key)?.get(dir);
  }

  getObject(key: string): HTMLCanvasElement | undefined {
    return this.objects.get(key);
  }

  getItem(key: string): HTMLCanvasElement | undefined {
    return this.items.get(key);
  }

  // -----------------------------------------------------------------------
  // Tile generation
  // -----------------------------------------------------------------------

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

      // Draw isometric diamond
      this.drawIsoDiamond(ctx, colors.base);

      // Add noise/texture
      this.addTileNoise(ctx, colors.detail, colors.noise, terrain);

      this.tiles.set(terrain, canvas);
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

    // Subtle edge highlight
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(TILE_HALF_W, 0);
    ctx.lineTo(TILE_W, TILE_HALF_H);
    ctx.stroke();

    // Shadow edge
    ctx.strokeStyle = "rgba(0, 0, 0, 0.15)";
    ctx.beginPath();
    ctx.moveTo(0, TILE_HALF_H);
    ctx.lineTo(TILE_HALF_W, TILE_H);
    ctx.lineTo(TILE_W, TILE_HALF_H);
    ctx.stroke();
  }

  private addTileNoise(
    ctx: CanvasRenderingContext2D,
    detail: string,
    noise: string,
    terrain: Terrain,
  ) {
    const rng = this.seededRng(terrain * 1000);

    // Clip to diamond
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(TILE_HALF_W, 1);
    ctx.lineTo(TILE_W - 1, TILE_HALF_H);
    ctx.lineTo(TILE_HALF_W, TILE_H - 1);
    ctx.lineTo(1, TILE_HALF_H);
    ctx.closePath();
    ctx.clip();

    // Scatter dots for texture
    const dotCount = terrain === Terrain.Water ? 8 : 25;
    for (let i = 0; i < dotCount; i++) {
      const x = rng() * TILE_W;
      const y = rng() * TILE_H;
      const size = 1 + rng() * 2;
      ctx.fillStyle = rng() > 0.5 ? detail : noise;
      ctx.globalAlpha = 0.3 + rng() * 0.4;
      ctx.fillRect(x, y, size, size);
    }

    // Terrain-specific details
    if (terrain === Terrain.CrackedEarth) {
      ctx.strokeStyle = noise;
      ctx.lineWidth = 0.5;
      ctx.globalAlpha = 0.6;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(10 + rng() * 44, 5 + rng() * 22);
        ctx.lineTo(10 + rng() * 44, 5 + rng() * 22);
        ctx.lineTo(10 + rng() * 44, 5 + rng() * 22);
        ctx.stroke();
      }
    }

    if (terrain === Terrain.Road) {
      // Dashed center line
      ctx.strokeStyle = "#b8a67c";
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.3;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(TILE_HALF_W - 10, TILE_HALF_H);
      ctx.lineTo(TILE_HALF_W + 10, TILE_HALF_H);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (terrain === Terrain.Water) {
      // Shimmer lines
      ctx.strokeStyle = "#5a8a8a";
      ctx.lineWidth = 0.5;
      ctx.globalAlpha = 0.5;
      for (let i = 0; i < 3; i++) {
        const y = 8 + i * 8;
        ctx.beginPath();
        ctx.moveTo(15 + rng() * 10, y);
        ctx.quadraticCurveTo(32, y + 2 * (rng() - 0.5), 49 - rng() * 10, y);
        ctx.stroke();
      }
    }

    if (terrain === Terrain.Grass) {
      // Small grass blades
      ctx.strokeStyle = "#7a8b5a";
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.7;
      for (let i = 0; i < 8; i++) {
        const gx = 10 + rng() * 44;
        const gy = 5 + rng() * 22;
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(gx + (rng() - 0.5) * 3, gy - 3 - rng() * 3);
        ctx.stroke();
      }
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // -----------------------------------------------------------------------
  // Sprite generation
  // -----------------------------------------------------------------------

  private generateSprites() {
    const spriteConfigs: Record<string, { body: string; head: string; accent: string }> = {
      player:       { body: "#6b5340", head: "#d4c4a0", accent: "#40c040" },
      npc_sheriff:  { body: "#5a4a3a", head: "#d4c4a0", accent: "#c4703a" },
      npc_merchant: { body: "#7a6b5a", head: "#d4c4a0", accent: "#8ec44a" },
      npc_doc:      { body: "#8e8e7e", head: "#d4c4a0", accent: "#4a8ab0" },
      npc_raider:   { body: "#4a3a2a", head: "#c4a080", accent: "#b83030" },
    };

    const directions: Direction[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

    for (const [key, colors] of Object.entries(spriteConfigs)) {
      const dirMap = new Map<Direction, HTMLCanvasElement>();
      for (const dir of directions) {
        dirMap.set(dir, this.generateCharacterSprite(colors, dir, key === "player"));
      }
      this.sprites.set(key, dirMap);
    }
  }

  private generateCharacterSprite(
    colors: { body: string; head: string; accent: string },
    direction: Direction,
    isPlayer: boolean,
  ): HTMLCanvasElement {
    const w = 24;
    const h = 36;
    const canvas = this.createCanvas(w, h);
    const ctx = canvas.getContext("2d")!;

    const cx = w / 2;

    // Shadow
    ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
    ctx.beginPath();
    ctx.ellipse(cx, h - 3, 8, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body (rectangle with direction offset)
    const bodyShift = this.directionOffset(direction);
    ctx.fillStyle = colors.body;
    ctx.fillRect(cx - 5 + bodyShift * 1.5, 14, 10, 14);

    // Accent (belt / stripe)
    ctx.fillStyle = colors.accent;
    ctx.fillRect(cx - 5 + bodyShift * 1.5, 20, 10, 2);

    // Legs
    ctx.fillStyle = this.darken(colors.body, 0.7);
    const legSpread = Math.abs(bodyShift) > 0 ? 2 : 0;
    ctx.fillRect(cx - 3 + bodyShift - legSpread, 28, 3, 5);
    ctx.fillRect(cx + bodyShift + legSpread, 28, 3, 5);

    // Boots
    ctx.fillStyle = "#3a3a2e";
    ctx.fillRect(cx - 3 + bodyShift - legSpread, 32, 3, 2);
    ctx.fillRect(cx + bodyShift + legSpread, 32, 3, 2);

    // Head
    ctx.fillStyle = colors.head;
    ctx.beginPath();
    ctx.arc(cx + bodyShift, 10, 5, 0, Math.PI * 2);
    ctx.fill();

    // Face features (tiny eyes based on direction)
    if (direction !== "N" && direction !== "NW" && direction !== "NE") {
      ctx.fillStyle = "#1e1e16";
      const eyeOff = bodyShift * 0.5;
      ctx.fillRect(cx - 2 + eyeOff, 9, 1, 1);
      ctx.fillRect(cx + 1 + eyeOff, 9, 1, 1);
    }

    // Player indicator (green border glow)
    if (isPlayer) {
      ctx.strokeStyle = "rgba(64, 192, 64, 0.5)";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.arc(cx + bodyShift, 10, 6, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Weapon hint for raiders (small line)
    if (colors.accent === "#b83030") {
      ctx.strokeStyle = "#9e9e8e";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx + 5 + bodyShift, 16);
      ctx.lineTo(cx + 10 + bodyShift, 12);
      ctx.stroke();
    }

    return canvas;
  }

  private directionOffset(dir: Direction): number {
    switch (dir) {
      case "E": case "NE": case "SE": return 2;
      case "W": case "NW": case "SW": return -2;
      default: return 0;
    }
  }

  // -----------------------------------------------------------------------
  // Object generation
  // -----------------------------------------------------------------------

  private generateObjects() {
    // Wall
    const wall = this.createCanvas(TILE_W, 32);
    const wCtx = wall.getContext("2d")!;
    wCtx.fillStyle = "#7a6a5a";
    // Isometric wall face
    wCtx.beginPath();
    wCtx.moveTo(TILE_HALF_W, 0);
    wCtx.lineTo(TILE_W, 8);
    wCtx.lineTo(TILE_W, 24);
    wCtx.lineTo(TILE_HALF_W, 32);
    wCtx.lineTo(0, 24);
    wCtx.lineTo(0, 8);
    wCtx.closePath();
    wCtx.fill();
    // Top face
    wCtx.fillStyle = "#8e7e6e";
    wCtx.beginPath();
    wCtx.moveTo(TILE_HALF_W, 0);
    wCtx.lineTo(TILE_W, 8);
    wCtx.lineTo(TILE_HALF_W, 16);
    wCtx.lineTo(0, 8);
    wCtx.closePath();
    wCtx.fill();
    // Edge
    wCtx.strokeStyle = "rgba(0,0,0,0.2)";
    wCtx.lineWidth = 0.5;
    wCtx.beginPath();
    wCtx.moveTo(TILE_HALF_W, 16);
    wCtx.lineTo(TILE_HALF_W, 32);
    wCtx.stroke();
    this.objects.set("wall", wall);

    // Barrel
    const barrel = this.createCanvas(16, 20);
    const bCtx = barrel.getContext("2d")!;
    bCtx.fillStyle = "#7a3b1e";
    bCtx.fillRect(2, 4, 12, 14);
    bCtx.fillStyle = "#a0522d";
    bCtx.beginPath();
    bCtx.ellipse(8, 4, 6, 3, 0, 0, Math.PI * 2);
    bCtx.fill();
    bCtx.fillStyle = "#c4703a";
    bCtx.fillRect(2, 8, 12, 2);
    bCtx.fillRect(2, 14, 12, 2);
    this.objects.set("barrel", barrel);

    // Rock
    const rock = this.createCanvas(18, 14);
    const rCtx = rock.getContext("2d")!;
    rCtx.fillStyle = "#6e6e5e";
    rCtx.beginPath();
    rCtx.moveTo(3, 12);
    rCtx.lineTo(1, 8);
    rCtx.lineTo(4, 3);
    rCtx.lineTo(10, 1);
    rCtx.lineTo(16, 4);
    rCtx.lineTo(17, 10);
    rCtx.lineTo(13, 13);
    rCtx.closePath();
    rCtx.fill();
    rCtx.fillStyle = "#8e8e7e";
    rCtx.beginPath();
    rCtx.moveTo(4, 3);
    rCtx.lineTo(10, 1);
    rCtx.lineTo(16, 4);
    rCtx.lineTo(10, 6);
    rCtx.closePath();
    rCtx.fill();
    this.objects.set("rock", rock);
  }

  // -----------------------------------------------------------------------
  // Item icon generation
  // -----------------------------------------------------------------------

  private generateItems() {
    this.generateItemIcon("item_pistol", (ctx) => {
      ctx.fillStyle = "#6e6e5e";
      ctx.fillRect(4, 6, 12, 4);
      ctx.fillRect(8, 6, 4, 10);
      ctx.fillStyle = "#5a5a4a";
      ctx.fillRect(4, 6, 3, 3);
    });

    this.generateItemIcon("item_rifle", (ctx) => {
      ctx.fillStyle = "#6e6e5e";
      ctx.fillRect(2, 8, 16, 3);
      ctx.fillRect(10, 8, 4, 8);
      ctx.fillStyle = "#8b7355";
      ctx.fillRect(2, 8, 6, 3);
    });

    this.generateItemIcon("item_knife", (ctx) => {
      ctx.fillStyle = "#9e9e8e";
      ctx.fillRect(8, 2, 2, 10);
      ctx.fillStyle = "#6b5340";
      ctx.fillRect(7, 12, 4, 4);
    });

    this.generateItemIcon("item_bat", (ctx) => {
      ctx.fillStyle = "#8b7355";
      ctx.fillRect(9, 2, 3, 14);
      ctx.fillStyle = "#6b5340";
      ctx.fillRect(8, 2, 5, 4);
      // Nails
      ctx.fillStyle = "#9e9e8e";
      ctx.fillRect(7, 3, 1, 1);
      ctx.fillRect(13, 4, 1, 1);
    });

    this.generateItemIcon("item_armor", (ctx) => {
      ctx.fillStyle = "#6b5340";
      ctx.fillRect(5, 4, 10, 12);
      ctx.fillStyle = "#8b7355";
      ctx.fillRect(6, 5, 8, 4);
      ctx.fillStyle = "#9e9e8e";
      ctx.fillRect(7, 6, 2, 2);
      ctx.fillRect(11, 6, 2, 2);
    });

    this.generateItemIcon("item_stimpak", (ctx) => {
      ctx.fillStyle = "#9e9e8e";
      ctx.fillRect(8, 3, 4, 12);
      ctx.fillStyle = "#b83030";
      ctx.fillRect(9, 5, 2, 4);
      ctx.fillStyle = "#d4c4a0";
      ctx.fillRect(7, 3, 6, 2);
      // Needle
      ctx.fillStyle = "#c0c0c0";
      ctx.fillRect(9, 15, 2, 2);
    });

    this.generateItemIcon("item_radaway", (ctx) => {
      ctx.fillStyle = "#c4703a";
      ctx.fillRect(6, 4, 8, 10);
      ctx.fillStyle = "#d4c4a0";
      ctx.fillRect(7, 5, 6, 8);
      ctx.strokeStyle = "#9e9e8e";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(10, 4);
      ctx.lineTo(10, 2);
      ctx.stroke();
    });

    this.generateItemIcon("item_nuka", (ctx) => {
      ctx.fillStyle = "#b83030";
      ctx.fillRect(7, 3, 6, 12);
      ctx.fillStyle = "#6e3020";
      ctx.fillRect(8, 4, 4, 3);
      ctx.fillStyle = "#d4c4a0";
      ctx.fillRect(8, 8, 4, 1);
      ctx.fillStyle = "#9e9e8e";
      ctx.fillRect(9, 2, 2, 2);
    });

    this.generateItemIcon("item_food", (ctx) => {
      ctx.fillStyle = "#9e9e8e";
      ctx.fillRect(5, 5, 10, 10);
      ctx.fillStyle = "#b8a67c";
      ctx.fillRect(6, 6, 8, 3);
      ctx.beginPath();
      ctx.arc(10, 5, 5, Math.PI, 0);
      ctx.fillStyle = "#9e9e8e";
      ctx.fill();
    });

    this.generateItemIcon("item_caps", (ctx) => {
      ctx.fillStyle = "#c4703a";
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(8 + i * 2, 10 - i * 2, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#a0522d";
      }
    });

    this.generateItemIcon("item_pin", (ctx) => {
      ctx.strokeStyle = "#9e9e8e";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(10, 4);
      ctx.lineTo(10, 14);
      ctx.lineTo(7, 12);
      ctx.stroke();
    });

    this.generateItemIcon("item_holotape", (ctx) => {
      ctx.fillStyle = "#5a5a4a";
      ctx.fillRect(4, 5, 12, 10);
      ctx.fillStyle = "#8ec44a";
      ctx.fillRect(6, 7, 8, 2);
      ctx.fillStyle = "#6e6e5e";
      ctx.fillRect(5, 12, 10, 2);
    });
  }

  private generateItemIcon(
    key: string,
    draw: (ctx: CanvasRenderingContext2D) => void,
  ) {
    const size = 20;
    const canvas = this.createCanvas(size, size);
    const ctx = canvas.getContext("2d")!;
    draw(ctx);
    this.items.set(key, canvas);
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private createCanvas(w: number, h: number): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }

  private darken(hex: string, factor: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${Math.floor(r * factor)}, ${Math.floor(g * factor)}, ${Math.floor(b * factor)})`;
  }

  private seededRng(seed: number) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
}
