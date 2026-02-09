import { ScreenPos, TilePos, TILE_HALF_W, TILE_HALF_H } from "../types";

export class Camera {
  x = 0;
  y = 0;
  zoom = 2;
  private targetX = 0;
  private targetY = 0;
  private smoothing = 0.08;
  screenW = 800;
  screenH = 600;

  resize(w: number, h: number) {
    this.screenW = w;
    this.screenH = h;
  }

  /** Instantly center on a tile */
  centerOn(tile: TilePos) {
    const screen = this.tileToWorld(tile);
    this.x = screen.x - this.screenW / (2 * this.zoom);
    this.y = screen.y - this.screenH / (2 * this.zoom);
    this.targetX = this.x;
    this.targetY = this.y;
  }

  /** Smoothly follow a tile position */
  follow(tile: TilePos) {
    const screen = this.tileToWorld(tile);
    this.targetX = screen.x - this.screenW / (2 * this.zoom);
    this.targetY = screen.y - this.screenH / (2 * this.zoom);
  }

  update() {
    this.x += (this.targetX - this.x) * this.smoothing;
    this.y += (this.targetY - this.y) * this.smoothing;
  }

  /** Pan camera by pixel delta (for drag) */
  pan(dx: number, dy: number) {
    this.targetX -= dx / this.zoom;
    this.targetY -= dy / this.zoom;
    this.x = this.targetX;
    this.y = this.targetY;
  }

  /** Zoom in/out clamped */
  adjustZoom(delta: number) {
    this.zoom = Math.max(1, Math.min(4, this.zoom + delta));
  }

  /** Convert tile coords to world pixel coords (before camera transform) */
  tileToWorld(tile: TilePos): ScreenPos {
    return {
      x: (tile.x - tile.y) * TILE_HALF_W,
      y: (tile.x + tile.y) * TILE_HALF_H,
    };
  }

  /** Convert screen pixel to world coords */
  screenToWorld(screen: ScreenPos): ScreenPos {
    return {
      x: screen.x / this.zoom + this.x,
      y: screen.y / this.zoom + this.y,
    };
  }

  /** Convert world coords to tile coords */
  worldToTile(world: ScreenPos): TilePos {
    const tx = (world.x / TILE_HALF_W + world.y / TILE_HALF_H) / 2;
    const ty = (world.y / TILE_HALF_H - world.x / TILE_HALF_W) / 2;
    return { x: Math.floor(tx), y: Math.floor(ty) };
  }

  /** Convert screen pixel directly to tile */
  screenToTile(screen: ScreenPos): TilePos {
    return this.worldToTile(this.screenToWorld(screen));
  }

  /** Apply camera transform to canvas context */
  applyTransform(ctx: CanvasRenderingContext2D) {
    ctx.setTransform(this.zoom, 0, 0, this.zoom, -this.x * this.zoom, -this.y * this.zoom);
  }
}
