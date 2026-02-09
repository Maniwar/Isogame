import { Camera } from "./Camera";
import {
  GameState,
  Tile,
  TilePos,
  TILE_W,
  TILE_H,
  TILE_HALF_W,
  TILE_HALF_H,
  Entity,
  Notification,
} from "../types";
import { AssetManager } from "../assets/AssetManager";

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private camera: Camera;
  private assets: AssetManager;
  private canvas: HTMLCanvasElement;
  private hoveredTile: TilePos | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    camera: Camera,
    assets: AssetManager,
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.camera = camera;
    this.assets = assets;

    // Disable smoothing for crisp pixel art
    this.ctx.imageSmoothingEnabled = false;
  }

  setHoveredTile(tile: TilePos | null) {
    this.hoveredTile = tile;
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.camera.resize(this.canvas.width, this.canvas.height);
    this.ctx.imageSmoothingEnabled = false;
  }

  render(state: GameState) {
    const { ctx } = this;

    // Clear
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#1e1e16";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Apply camera
    this.camera.applyTransform(ctx);

    // Determine visible tile range for culling
    const tl = this.camera.screenToTile({ x: 0, y: 0 });
    const br = this.camera.screenToTile({
      x: this.canvas.width,
      y: this.canvas.height,
    });
    const pad = 3;
    const minX = Math.max(0, tl.x - pad);
    const minY = Math.max(0, tl.y - pad);
    const maxX = Math.min(state.map.width - 1, br.x + pad);
    const maxY = Math.min(state.map.height - 1, br.y + pad);

    // Draw tiles (painter's order: back to front)
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (!state.map.tiles[y] || !state.map.tiles[y][x]) continue;
        const tile = state.map.tiles[y][x];
        this.drawTile(x, y, tile);
      }
    }

    // Draw hovered tile highlight
    if (this.hoveredTile) {
      this.drawTileHighlight(this.hoveredTile);
    }

    // Draw item pickups on ground
    for (const item of state.map.items) {
      this.drawGroundItem(item.pos, item.itemId);
    }

    // Draw entities sorted by depth (y+x for isometric)
    const sorted = [...state.entities]
      .filter((e) => !e.dead)
      .sort((a, b) => (a.pos.y + a.pos.x) - (b.pos.y + b.pos.x));

    for (const entity of sorted) {
      this.drawEntity(entity);
    }

    // Reset transform for UI
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Draw notifications
    this.drawNotifications(state.notifications);
  }

  private drawTile(x: number, y: number, tile: Tile) {
    const { ctx, assets } = this;
    const wx = (x - y) * TILE_HALF_W;
    const wy = (x + y) * TILE_HALF_H;

    const sprite = assets.getTile(tile.terrain);
    if (sprite) {
      ctx.drawImage(sprite, wx - TILE_HALF_W, wy - TILE_HALF_H, TILE_W, TILE_H);
    }

    // Draw tile object if present
    if (tile.object) {
      const obj = assets.getObject(tile.object);
      if (obj) {
        ctx.drawImage(obj, wx - obj.width / 2, wy - obj.height + TILE_HALF_H);
      }
    }
  }

  private drawTileHighlight(pos: TilePos) {
    const { ctx } = this;
    const wx = (pos.x - pos.y) * TILE_HALF_W;
    const wy = (pos.x + pos.y) * TILE_HALF_H;

    ctx.strokeStyle = "rgba(64, 192, 64, 0.6)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(wx, wy - TILE_HALF_H);
    ctx.lineTo(wx + TILE_HALF_W, wy);
    ctx.lineTo(wx, wy + TILE_HALF_H);
    ctx.lineTo(wx - TILE_HALF_W, wy);
    ctx.closePath();
    ctx.stroke();
  }

  private drawEntity(entity: Entity) {
    const { ctx, assets } = this;

    // Interpolate position for smooth movement
    let drawX: number, drawY: number;
    if (entity.path.length > 0 && entity.moveProgress > 0) {
      const from = entity.pos;
      const to = entity.path[0];
      const t = entity.moveProgress;
      const fx = (from.x - from.y) * TILE_HALF_W;
      const fy = (from.x + from.y) * TILE_HALF_H;
      const tx = (to.x - to.y) * TILE_HALF_W;
      const ty = (to.x + to.y) * TILE_HALF_H;
      drawX = fx + (tx - fx) * t;
      drawY = fy + (ty - fy) * t;
    } else {
      drawX = (entity.pos.x - entity.pos.y) * TILE_HALF_W;
      drawY = (entity.pos.x + entity.pos.y) * TILE_HALF_H;
    }

    const sprite = assets.getSprite(entity.spriteKey, entity.direction);
    if (sprite) {
      const sw = sprite.width;
      const sh = sprite.height;
      ctx.drawImage(sprite, drawX - sw / 2, drawY - sh + TILE_HALF_H, sw, sh);
    }

    // Draw name tag
    ctx.fillStyle = entity.isPlayer
      ? "#40c040"
      : entity.isHostile
        ? "#b83030"
        : "#d4c4a0";
    ctx.font = "7px monospace";
    ctx.textAlign = "center";
    ctx.fillText(entity.name, drawX, drawY - 36);

    // Health bar for non-player entities
    if (!entity.isPlayer && entity.stats.hp < entity.stats.maxHp) {
      const barW = 24;
      const barH = 3;
      const bx = drawX - barW / 2;
      const by = drawY - 32;
      const ratio = entity.stats.hp / entity.stats.maxHp;

      ctx.fillStyle = "#3a3a2e";
      ctx.fillRect(bx, by, barW, barH);
      ctx.fillStyle = ratio > 0.5 ? "#40c040" : ratio > 0.25 ? "#c4703a" : "#b83030";
      ctx.fillRect(bx, by, barW * ratio, barH);
    }
  }

  private drawGroundItem(pos: TilePos, itemId: string) {
    const { ctx, assets } = this;
    const wx = (pos.x - pos.y) * TILE_HALF_W;
    const wy = (pos.x + pos.y) * TILE_HALF_H;

    const icon = assets.getItem(itemId);
    if (icon) {
      const size = 12;
      ctx.drawImage(icon, wx - size / 2, wy - size / 2 - 4, size, size);
    }

    // Pulse indicator
    const pulse = Math.sin(Date.now() / 300) * 0.3 + 0.7;
    ctx.fillStyle = `rgba(64, 192, 64, ${pulse * 0.4})`;
    ctx.beginPath();
    ctx.arc(wx, wy - 4, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawNotifications(notifications: Notification[]) {
    const { ctx } = this;
    ctx.textAlign = "center";
    ctx.font = "14px monospace";

    notifications.forEach((n, i) => {
      const alpha = Math.min(1, n.timeLeft / 500);
      ctx.fillStyle = n.color.replace(")", `, ${alpha})`).replace("rgb", "rgba");
      ctx.fillText(n.text, this.canvas.width / 2, this.canvas.height - 60 - i * 22);
    });
  }
}
