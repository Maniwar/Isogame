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

  // Screen shake
  private shakeIntensity = 0;
  private shakeDuration = 0;
  private shakeElapsed = 0;
  shakeOffsetX = 0;
  shakeOffsetY = 0;

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

    // Update screen shake
    if (this.shakeElapsed < this.shakeDuration) {
      this.shakeElapsed += 16; // ~60fps
      const decay = 1 - this.shakeElapsed / this.shakeDuration;
      const intensity = this.shakeIntensity * decay;
      this.shakeOffsetX = (Math.random() * 2 - 1) * intensity;
      this.shakeOffsetY = (Math.random() * 2 - 1) * intensity;
    } else {
      this.shakeOffsetX = 0;
      this.shakeOffsetY = 0;
    }
  }

  /** Trigger screen shake. Intensity in pixels, duration in ms. */
  shake(intensity: number, duration: number) {
    // Stack with existing shake if stronger
    if (intensity > this.shakeIntensity * (1 - this.shakeElapsed / this.shakeDuration)) {
      this.shakeIntensity = intensity;
      this.shakeDuration = duration;
      this.shakeElapsed = 0;
    }
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

  /** Apply camera transform to canvas context (includes shake and DPR) */
  applyTransform(ctx: CanvasRenderingContext2D, dpr = 1) {
    const sx = this.shakeOffsetX;
    const sy = this.shakeOffsetY;
    const scale = this.zoom * dpr;
    ctx.setTransform(
      scale, 0, 0, scale,
      -(this.x + sx) * scale,
      -(this.y + sy) * scale,
    );
  }
}
