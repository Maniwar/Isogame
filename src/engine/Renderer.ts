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
  VFX,
} from "../types";
import { AssetManager } from "../assets/AssetManager";
import { AnimationSystem } from "../systems/AnimationSystem";

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

    // Combat overlays (range tiles, enemy highlights)
    if (state.phase === "combat") {
      this.drawCombatOverlays(state, minX, minY, maxX, maxY);
    }

    // Draw hovered tile highlight
    if (this.hoveredTile) {
      this.drawTileHighlight(this.hoveredTile, state.phase === "combat");
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
      this.drawEntity(entity, state.phase === "combat");
    }

    // Draw VFX (projectiles, damage numbers) — in world space
    this.drawVFX(state.vfx);

    // Reset transform for UI
    ctx.setTransform(1, 0, 0, 1, 0, 0);
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

  private drawCombatOverlays(state: GameState, minX: number, minY: number, maxX: number, maxY: number) {
    const { ctx } = this;
    const player = state.player;
    const px = player.pos.x;
    const py = player.pos.y;

    // Draw attack range overlay on tiles (manhattan distance 5)
    const attackRange = 5;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dist = Math.abs(x - px) + Math.abs(y - py);
        if (dist > 0 && dist <= attackRange) {
          const wx = (x - y) * TILE_HALF_W;
          const wy = (x + y) * TILE_HALF_H;

          // Subtle red tint for attack range
          ctx.fillStyle = "rgba(184, 48, 48, 0.08)";
          ctx.beginPath();
          ctx.moveTo(wx, wy - TILE_HALF_H);
          ctx.lineTo(wx + TILE_HALF_W, wy);
          ctx.lineTo(wx, wy + TILE_HALF_H);
          ctx.lineTo(wx - TILE_HALF_W, wy);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // Draw range border diamond around player
    const borderDist = attackRange;
    ctx.strokeStyle = "rgba(184, 48, 48, 0.3)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    // Draw a diamond outline at range distance
    const centerWx = (px - py) * TILE_HALF_W;
    const centerWy = (px + py) * TILE_HALF_H;
    const rangeW = borderDist * TILE_HALF_W;
    const rangeH = borderDist * TILE_HALF_H;
    ctx.beginPath();
    ctx.moveTo(centerWx, centerWy - rangeH);
    ctx.lineTo(centerWx + rangeW, centerWy);
    ctx.lineTo(centerWx, centerWy + rangeH);
    ctx.lineTo(centerWx - rangeW, centerWy);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawTileHighlight(pos: TilePos, isCombat: boolean) {
    const { ctx } = this;
    const wx = (pos.x - pos.y) * TILE_HALF_W;
    const wy = (pos.x + pos.y) * TILE_HALF_H;

    ctx.strokeStyle = isCombat ? "rgba(184, 48, 48, 0.8)" : "rgba(64, 192, 64, 0.6)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(wx, wy - TILE_HALF_H);
    ctx.lineTo(wx + TILE_HALF_W, wy);
    ctx.lineTo(wx, wy + TILE_HALF_H);
    ctx.lineTo(wx - TILE_HALF_W, wy);
    ctx.closePath();
    ctx.stroke();
  }

  private drawEntity(entity: Entity, isCombat: boolean) {
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

    // Combat: highlight hostile enemies with pulsing red circle
    if (isCombat && entity.isHostile && !entity.dead) {
      const pulse = Math.sin(Date.now() / 200) * 0.2 + 0.5;
      ctx.strokeStyle = `rgba(184, 48, 48, ${pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(drawX, drawY - 10, 16, 0, Math.PI * 2);
      ctx.stroke();

      // Red target marker on tile
      ctx.fillStyle = `rgba(184, 48, 48, ${pulse * 0.3})`;
      ctx.beginPath();
      ctx.moveTo(drawX, drawY - TILE_HALF_H);
      ctx.lineTo(drawX + TILE_HALF_W, drawY);
      ctx.lineTo(drawX, drawY + TILE_HALF_H);
      ctx.lineTo(drawX - TILE_HALF_W, drawY);
      ctx.closePath();
      ctx.fill();
    }

    // Use animation frame if available, otherwise static sprite
    const frameKey = AnimationSystem.getFrameKey(entity);
    const sprite = assets.getAnimFrame(entity.spriteKey, frameKey, entity.direction);
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

    // Health bar (always show in combat, or when damaged)
    if (!entity.isPlayer && (isCombat || entity.stats.hp < entity.stats.maxHp)) {
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

  private drawVFX(vfxList: VFX[]) {
    const { ctx } = this;

    for (const vfx of vfxList) {
      const progress = 1 - vfx.timeLeft / vfx.duration;
      const alpha = Math.min(1, vfx.timeLeft / (vfx.duration * 0.3));

      switch (vfx.type) {
        case "projectile": {
          // Yellow bullet trail from attacker to target
          ctx.globalAlpha = alpha;
          ctx.strokeStyle = vfx.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          // Animate: trail sweeps from source to target
          const headX = vfx.fromX + (vfx.toX - vfx.fromX) * Math.min(1, progress * 2);
          const headY = vfx.fromY + (vfx.toY - vfx.fromY) * Math.min(1, progress * 2);
          const tailProgress = Math.max(0, progress * 2 - 0.5);
          const tailX = vfx.fromX + (vfx.toX - vfx.fromX) * tailProgress;
          const tailY = vfx.fromY + (vfx.toY - vfx.fromY) * tailProgress;
          ctx.moveTo(tailX, tailY);
          ctx.lineTo(headX, headY);
          ctx.stroke();

          // Muzzle flash at source (early in animation)
          if (progress < 0.3) {
            const flashAlpha = (0.3 - progress) / 0.3;
            ctx.fillStyle = `rgba(255, 200, 60, ${flashAlpha})`;
            ctx.beginPath();
            ctx.arc(vfx.fromX, vfx.fromY, 4 + progress * 8, 0, Math.PI * 2);
            ctx.fill();
          }

          // Impact spark at target (late in animation)
          if (progress > 0.5) {
            const sparkAlpha = alpha * 0.8;
            ctx.fillStyle = `rgba(255, 100, 50, ${sparkAlpha})`;
            ctx.beginPath();
            ctx.arc(vfx.toX, vfx.toY, 3, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
          break;
        }

        case "slash": {
          // Melee slash arc
          ctx.globalAlpha = alpha;
          ctx.strokeStyle = vfx.color;
          ctx.lineWidth = 3;

          const midX = (vfx.fromX + vfx.toX) / 2;
          const midY = (vfx.fromY + vfx.toY) / 2;
          const angle = Math.atan2(vfx.toY - vfx.fromY, vfx.toX - vfx.fromX);
          const sweep = progress * Math.PI * 0.6;

          ctx.beginPath();
          ctx.arc(midX, midY, 12, angle - sweep / 2, angle + sweep / 2);
          ctx.stroke();

          // Impact sparks
          if (progress > 0.3) {
            const numSparks = 3;
            for (let i = 0; i < numSparks; i++) {
              const sparkAngle = angle + (i - 1) * 0.4;
              const dist = 6 + progress * 10;
              const sx = vfx.toX + Math.cos(sparkAngle) * dist;
              const sy = vfx.toY + Math.sin(sparkAngle) * dist;
              ctx.fillStyle = `rgba(255, 255, 200, ${alpha * 0.6})`;
              ctx.fillRect(sx - 1, sy - 1, 2, 2);
            }
          }
          ctx.globalAlpha = 1;
          break;
        }

        case "damage_number": {
          // Float upward with fade
          const curX = vfx.fromX + (vfx.toX - vfx.fromX) * progress;
          const curY = vfx.fromY + (vfx.toY - vfx.fromY) * progress;

          ctx.globalAlpha = alpha;
          ctx.fillStyle = vfx.color;
          ctx.font = "bold 10px monospace";
          ctx.textAlign = "center";
          ctx.fillText(vfx.text ?? "", curX, curY);
          ctx.globalAlpha = 1;
          break;
        }
      }
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
}
