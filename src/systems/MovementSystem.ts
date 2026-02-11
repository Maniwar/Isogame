import {
  GameState,
  GameMap,
  TilePos,
  Direction,
  Entity,
  Collision,
} from "../types";

/** A* pathfinding node */
interface PathNode {
  x: number;
  y: number;
  g: number;
  h: number;
  f: number;
  parent: PathNode | null;
}

export class MovementSystem {
  private moveSpeed = 0.004; // tiles per ms

  update(state: GameState, dt: number) {
    for (const entity of state.entities) {
      if (entity.dead) continue;
      this.moveEntity(entity, state, dt);
    }
  }

  private moveEntity(entity: Entity, _state: GameState, dt: number) {
    if (entity.path.length === 0) return;

    // Set facing direction toward the next waypoint BEFORE interpolating,
    // so the sprite faces the correct way during the entire movement leg.
    entity.direction = this.getDirection(entity.pos, entity.path[0]);

    entity.moveProgress += this.moveSpeed * dt;

    if (entity.moveProgress >= 1) {
      // Arrived at next tile
      const next = entity.path.shift()!;
      entity.pos = next;
      entity.moveProgress = 0;

      // Immediately face the next waypoint if path continues
      if (entity.path.length > 0) {
        entity.direction = this.getDirection(entity.pos, entity.path[0]);
      }
    }
  }

  /** Find a walkable tile adjacent to target, closest to origin */
  findAdjacentTile(map: GameMap, target: TilePos, origin: TilePos): TilePos | null {
    const neighbors = this.getNeighbors(target);
    let best: TilePos | null = null;
    let bestDist = Infinity;

    for (const n of neighbors) {
      if (!this.isWalkable(map, n)) continue;
      const d = this.heuristic(n, origin);
      if (d < bestDist) {
        bestDist = d;
        best = n;
      }
    }
    return best;
  }

  /** A* pathfinding */
  findPath(map: GameMap, start: TilePos, end: TilePos): TilePos[] {
    if (!this.isWalkable(map, end)) return [];
    if (start.x === end.x && start.y === end.y) return [];

    const open: PathNode[] = [];
    const closed = new Set<string>();
    const key = (x: number, y: number) => `${x},${y}`;

    open.push({
      x: start.x,
      y: start.y,
      g: 0,
      h: this.heuristic(start, end),
      f: this.heuristic(start, end),
      parent: null,
    });

    let iterations = 0;
    const maxIterations = 2000;

    while (open.length > 0 && iterations++ < maxIterations) {
      // Get node with lowest f
      open.sort((a, b) => a.f - b.f);
      const current = open.shift()!;

      if (current.x === end.x && current.y === end.y) {
        return this.reconstructPath(current);
      }

      closed.add(key(current.x, current.y));

      for (const n of this.getNeighbors(current)) {
        if (closed.has(key(n.x, n.y))) continue;
        if (!this.isWalkable(map, n)) continue;

        const g = current.g + (n.x !== current.x && n.y !== current.y ? 1.41 : 1);
        const existing = open.find((o) => o.x === n.x && o.y === n.y);

        if (existing) {
          if (g < existing.g) {
            existing.g = g;
            existing.f = g + existing.h;
            existing.parent = current;
          }
        } else {
          const h = this.heuristic(n, end);
          open.push({ x: n.x, y: n.y, g, h, f: g + h, parent: current });
        }
      }
    }

    return []; // No path found
  }

  private reconstructPath(node: PathNode): TilePos[] {
    const path: TilePos[] = [];
    let current: PathNode | null = node;
    while (current && current.parent) {
      path.unshift({ x: current.x, y: current.y });
      current = current.parent;
    }
    return path;
  }

  private getNeighbors(pos: TilePos | PathNode): TilePos[] {
    const { x, y } = pos;
    return [
      { x: x - 1, y },
      { x: x + 1, y },
      { x, y: y - 1 },
      { x, y: y + 1 },
      { x: x - 1, y: y - 1 },
      { x: x + 1, y: y - 1 },
      { x: x - 1, y: y + 1 },
      { x: x + 1, y: y + 1 },
    ];
  }

  private heuristic(a: TilePos, b: TilePos): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  private isWalkable(map: GameMap, pos: TilePos): boolean {
    if (pos.x < 0 || pos.y < 0 || pos.x >= map.width || pos.y >= map.height) {
      return false;
    }
    return map.tiles[pos.y][pos.x].collision === Collision.None;
  }

  /**
   * Convert tile-coordinate delta into a screen-space facing direction.
   *
   * Isometric projection rotates tile axes 45° from screen axes:
   *   screenX = (tileX - tileY) * 32
   *   screenY = (tileX + tileY) * 16
   *
   * So tile-east (dx=+1,dy=0) is screen-SE (down-right), and
   * tile-SE (dx=+1,dy=+1) is screen-S (straight down toward viewer).
   *
   * Sprite direction labels use screen-space:
   *   "S" = front view (facing camera), "N" = back view, etc.
   *
   * Public static so other systems (combat, dialogue) can compute facing.
   */
  static getDirectionBetween(from: TilePos, to: TilePos): Direction {
    const dx = Math.sign(to.x - from.x);
    const dy = Math.sign(to.y - from.y);

    // Map tile deltas → screen-space directions (45° CW rotation)
    if (dx === 0 && dy < 0) return "NE";   // tile-N → screen upper-right
    if (dx > 0 && dy < 0) return "E";      // tile-NE → screen right
    if (dx > 0 && dy === 0) return "SE";   // tile-E → screen lower-right
    if (dx > 0 && dy > 0) return "S";      // tile-SE → screen down (front view)
    if (dx === 0 && dy > 0) return "SW";   // tile-S → screen lower-left
    if (dx < 0 && dy > 0) return "W";      // tile-SW → screen left
    if (dx < 0 && dy === 0) return "NW";   // tile-W → screen upper-left
    return "N";                            // tile-NW → screen up (back view)
  }

  private getDirection(from: TilePos, to: TilePos): Direction {
    return MovementSystem.getDirectionBetween(from, to);
  }
}
