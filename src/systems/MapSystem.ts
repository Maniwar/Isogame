import {
  GameMap,
  Tile,
  Terrain,
  Collision,
  NpcSpawn,
  ItemSpawn,
  TilePos,
} from "../types";

/** Seeded pseudo-random number generator */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MapSystem {
  /** Generate a procedural wasteland map */
  generateWastelandMap(width: number, height: number): GameMap {
    const rng = mulberry32(42);
    const tiles: Tile[][] = [];

    // Generate terrain with noise-like patterns
    for (let y = 0; y < height; y++) {
      tiles[y] = [];
      for (let x = 0; x < width; x++) {
        const terrain = this.pickTerrain(x, y, width, height, rng);
        const collision = terrain === Terrain.Water ? Collision.Water : Collision.None;
        tiles[y][x] = {
          terrain,
          collision,
          elevation: 0,
        };
      }
    }

    // Place some walls/objects
    this.placeStructures(tiles, width, height, rng);

    // Place roads
    this.placeRoads(tiles, width, height);

    // Define NPC spawns
    const npcs: NpcSpawn[] = [
      // --- Settlement NPCs ---
      {
        id: "sheriff",
        name: "Sheriff Morgan",
        pos: { x: 23, y: 18 },  // Inside sheriff_office (interior tile)
        spriteKey: "npc_sheriff",
        isHostile: false,
        dialogueId: "sheriff_intro",
        stats: { hp: 50, maxHp: 50, ap: 8, maxAp: 8, strength: 7, perception: 8, endurance: 6, charisma: 5, intelligence: 6, agility: 6, luck: 5 },
        inventory: [{ itemId: "10mm_pistol", count: 1 }],
      },
      {
        id: "merchant",
        name: "Scrapper Joe",
        pos: { x: 18, y: 22 },
        spriteKey: "npc_merchant",
        isHostile: false,
        dialogueId: "merchant_intro",
        stats: { hp: 30, maxHp: 30, ap: 6, maxAp: 6, strength: 4, perception: 6, endurance: 4, charisma: 8, intelligence: 7, agility: 5, luck: 6 },
        inventory: [
          { itemId: "stimpak", count: 3 },
          { itemId: "nuka_cola", count: 5 },
        ],
      },
      {
        id: "doc",
        name: "Doc Hendricks",
        pos: { x: 21, y: 23 },  // Just south of the clinic
        spriteKey: "npc_doc",
        isHostile: false,
        dialogueId: "doc_intro",
        stats: { hp: 25, maxHp: 25, ap: 6, maxAp: 6, strength: 3, perception: 7, endurance: 3, charisma: 6, intelligence: 9, agility: 4, luck: 5 },
        inventory: [{ itemId: "stimpak", count: 5 }],
      },
      // --- Settlement visitors / wanderers ---
      {
        id: "settler1",
        name: "Dusty Pete",
        pos: { x: 16, y: 18 },
        spriteKey: "npc_settler",
        isHostile: false,
        dialogueId: "settler_dusty_pete",
        stats: { hp: 20, maxHp: 20, ap: 6, maxAp: 6, strength: 4, perception: 5, endurance: 4, charisma: 6, intelligence: 5, agility: 5, luck: 5 },
        inventory: [
          { itemId: "canned_food", count: 2 },
          { itemId: "bottle_caps", count: 15 },
        ],
      },
      {
        id: "settler2",
        name: "Martha",
        pos: { x: 20, y: 16 },
        spriteKey: "npc_martha",
        isHostile: false,
        dialogueId: "settler_martha",
        stats: { hp: 18, maxHp: 18, ap: 6, maxAp: 6, strength: 3, perception: 5, endurance: 3, charisma: 7, intelligence: 6, agility: 4, luck: 6 },
        inventory: [
          { itemId: "nuka_cola", count: 1 },
          { itemId: "bobby_pin", count: 2 },
        ],
      },
      {
        id: "guard1",
        name: "Settlement Guard",
        pos: { x: 15, y: 20 },
        spriteKey: "npc_guard",
        isHostile: false,
        dialogueId: "guard_intro",
        stats: { hp: 35, maxHp: 35, ap: 7, maxAp: 7, strength: 6, perception: 6, endurance: 5, charisma: 3, intelligence: 4, agility: 5, luck: 5 },
        inventory: [{ itemId: "pipe_rifle", count: 1 }],
      },
      // --- NW Raider Camp ---
      {
        id: "raider1",
        name: "Raider",
        pos: { x: 10, y: 8 },
        spriteKey: "npc_raider",
        isHostile: true,
        stats: { hp: 25, maxHp: 25, ap: 6, maxAp: 6, strength: 6, perception: 5, endurance: 5, charisma: 2, intelligence: 3, agility: 6, luck: 4 },
        inventory: [
          { itemId: "pipe_rifle", count: 1 },
          { itemId: "bottle_caps", count: 12 },
        ],
      },
      {
        id: "raider2",
        name: "Raider Thug",
        pos: { x: 12, y: 9 },
        spriteKey: "npc_raider",
        isHostile: true,
        stats: { hp: 20, maxHp: 20, ap: 6, maxAp: 6, strength: 7, perception: 4, endurance: 6, charisma: 1, intelligence: 2, agility: 5, luck: 3 },
        inventory: [
          { itemId: "baseball_bat", count: 1 },
          { itemId: "bottle_caps", count: 8 },
        ],
      },
      {
        id: "raider3",
        name: "Raider Scrounger",
        pos: { x: 8, y: 10 },
        spriteKey: "npc_raider",
        isHostile: true,
        stats: { hp: 18, maxHp: 18, ap: 6, maxAp: 6, strength: 5, perception: 6, endurance: 4, charisma: 2, intelligence: 4, agility: 6, luck: 4 },
        inventory: [
          { itemId: "combat_knife", count: 1 },
          { itemId: "stimpak", count: 1 },
          { itemId: "bottle_caps", count: 6 },
        ],
      },
      // --- SE Raider Camp ---
      {
        id: "raider4",
        name: "Raider Scout",
        pos: { x: 30, y: 30 },
        spriteKey: "npc_raider",
        isHostile: true,
        stats: { hp: 18, maxHp: 18, ap: 7, maxAp: 7, strength: 5, perception: 7, endurance: 4, charisma: 2, intelligence: 4, agility: 7, luck: 4 },
        inventory: [
          { itemId: "combat_knife", count: 1 },
          { itemId: "bottle_caps", count: 5 },
        ],
      },
      {
        id: "raider5",
        name: "Raider Brute",
        pos: { x: 32, y: 31 },
        spriteKey: "npc_raider",
        isHostile: true,
        stats: { hp: 30, maxHp: 30, ap: 5, maxAp: 5, strength: 8, perception: 4, endurance: 7, charisma: 1, intelligence: 2, agility: 4, luck: 3 },
        inventory: [
          { itemId: "baseball_bat", count: 1 },
          { itemId: "canned_food", count: 1 },
          { itemId: "bottle_caps", count: 10 },
        ],
      },
      // --- Lone wandering hostiles ---
      {
        id: "raider6",
        name: "Road Bandit",
        pos: { x: 6, y: 25 },
        spriteKey: "npc_raider",
        isHostile: true,
        stats: { hp: 22, maxHp: 22, ap: 7, maxAp: 7, strength: 5, perception: 6, endurance: 5, charisma: 2, intelligence: 3, agility: 7, luck: 5 },
        inventory: [
          { itemId: "10mm_pistol", count: 1 },
          { itemId: "bottle_caps", count: 18 },
        ],
      },
      {
        id: "raider7",
        name: "Scavenger",
        pos: { x: 35, y: 12 },
        spriteKey: "npc_raider",
        isHostile: true,
        stats: { hp: 20, maxHp: 20, ap: 6, maxAp: 6, strength: 5, perception: 5, endurance: 4, charisma: 2, intelligence: 4, agility: 6, luck: 5 },
        inventory: [
          { itemId: "pipe_rifle", count: 1 },
          { itemId: "rad_away", count: 1 },
          { itemId: "bottle_caps", count: 7 },
        ],
      },
    ];

    // Item spawns scattered around the map
    const items: ItemSpawn[] = [
      // Settlement area
      { itemId: "stimpak", pos: { x: 15, y: 17 }, count: 1 },
      { itemId: "bottle_caps", pos: { x: 23, y: 15 }, count: 25 },
      { itemId: "nuka_cola", pos: { x: 16, y: 25 }, count: 2 },
      { itemId: "canned_food", pos: { x: 19, y: 14 }, count: 2 },
      { itemId: "bobby_pin", pos: { x: 22, y: 25 }, count: 3 },
      { itemId: "holotape", pos: { x: 24, y: 19 }, count: 1 },
      // Near NW raider camp
      { itemId: "pipe_rifle", pos: { x: 8, y: 12 }, count: 1 },
      { itemId: "stimpak", pos: { x: 13, y: 7 }, count: 1 },
      { itemId: "bottle_caps", pos: { x: 9, y: 11 }, count: 15 },
      { itemId: "canned_food", pos: { x: 11, y: 7 }, count: 1 },
      // Near SE raider camp
      { itemId: "combat_knife", pos: { x: 25, y: 28 }, count: 1 },
      { itemId: "rad_away", pos: { x: 30, y: 15 }, count: 1 },
      { itemId: "stimpak", pos: { x: 31, y: 32 }, count: 2 },
      { itemId: "nuka_cola", pos: { x: 28, y: 29 }, count: 1 },
      // Outer wasteland finds
      { itemId: "leather_armor", pos: { x: 14, y: 30 }, count: 1 },
      { itemId: "10mm_pistol", pos: { x: 5, y: 15 }, count: 1 },
      { itemId: "stimpak", pos: { x: 33, y: 8 }, count: 1 },
      { itemId: "bottle_caps", pos: { x: 7, y: 33 }, count: 30 },
      { itemId: "rad_away", pos: { x: 36, y: 25 }, count: 1 },
      { itemId: "canned_food", pos: { x: 27, y: 5 }, count: 2 },
      { itemId: "nuka_cola", pos: { x: 12, y: 35 }, count: 1 },
      { itemId: "bobby_pin", pos: { x: 34, y: 18 }, count: 2 },
      { itemId: "holotape", pos: { x: 6, y: 7 }, count: 1 },
      { itemId: "baseball_bat", pos: { x: 15, y: 33 }, count: 1 },
    ];

    // Validate NPC spawn positions — nudge any that landed on solid/water tiles
    for (const npc of npcs) {
      if (!this.isSpawnable(tiles, npc.pos, width, height)) {
        const alt = this.findNearbyWalkable(tiles, npc.pos, width, height);
        if (alt) npc.pos = alt;
      }
    }

    // Validate item spawn positions
    const validItems = items.filter(item =>
      this.isSpawnable(tiles, item.pos, width, height),
    );

    return {
      name: "Dusty Springs",
      width,
      height,
      tiles,
      spawnPoints: {
        player: { x: 20, y: 20 },
      },
      npcs,
      items: validItems,
    };
  }

  private pickTerrain(
    x: number,
    y: number,
    w: number,
    h: number,
    rng: () => number,
  ): Terrain {
    // Zone-based terrain with smooth Perlin-like noise for natural clustering.
    // Uses layered noise (large + small scale) so similar terrains group
    // together instead of random salt-and-pepper.
    const cx = w / 2;
    const cy = h / 2;
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);

    // Water border (2 tiles wide)
    if (x <= 1 || y <= 1 || x >= w - 2 || y >= h - 2) return Terrain.Water;

    // Settlement core (radius 6) — concrete and rubble
    if (dist < 6) {
      const n = this.noise2d(x, y, 0.3, rng);
      if (n < 0.3) return Terrain.Concrete;
      if (n < 0.55) return Terrain.Rubble;
      return Terrain.Dirt;
    }

    // Roads (cross pattern through center)
    if ((Math.abs(x - cx) <= 1 && y > 4 && y < h - 4) ||
        (Math.abs(y - cy) <= 1 && x > 4 && x < h - 4)) {
      return Terrain.Road;
    }

    // Outer terrain — use noise to cluster similar terrains together
    const n1 = this.noise2d(x, y, 0.12, rng);  // Large-scale zones
    const n2 = this.noise2d(x + 100, y + 100, 0.25, rng);  // Detail variation

    // Zone distribution based on distance from center
    if (dist < 12) {
      // Near settlement: dirt, cracked earth, some rubble
      if (n1 < 0.3) return Terrain.CrackedEarth;
      if (n1 < 0.5) return Terrain.Dirt;
      if (n1 < 0.7) return Terrain.Rubble;
      return n2 < 0.5 ? Terrain.Sand : Terrain.Dirt;
    }

    // Outer wasteland: large patches of sand, dirt, cracked earth, sparse grass
    if (n1 < 0.25) return Terrain.Sand;
    if (n1 < 0.45) return Terrain.CrackedEarth;
    if (n1 < 0.65) return Terrain.Dirt;
    if (n1 < 0.78) return n2 < 0.3 ? Terrain.Grass : Terrain.Sand;
    if (n1 < 0.92) return Terrain.Sand;
    return Terrain.Grass;
  }

  /** Simple hash-based 2D noise for terrain clustering.
   *  Returns 0-1.  freq controls patch size (lower = larger patches). */
  private noise2d(x: number, y: number, freq: number, _rng: () => number): number {
    const fx = x * freq;
    const fy = y * freq;
    // Integer lattice points
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const dx = fx - ix;
    const dy = fy - iy;
    // Hash corners
    const h00 = this.hash(ix, iy);
    const h10 = this.hash(ix + 1, iy);
    const h01 = this.hash(ix, iy + 1);
    const h11 = this.hash(ix + 1, iy + 1);
    // Smooth interpolation (hermite)
    const sx = dx * dx * (3 - 2 * dx);
    const sy = dy * dy * (3 - 2 * dy);
    const top = h00 + (h10 - h00) * sx;
    const bottom = h01 + (h11 - h01) * sx;
    return top + (bottom - top) * sy;
  }

  private hash(x: number, y: number): number {
    let h = (x * 374761393 + y * 668265263 + 1013904223) | 0;
    h = ((h >> 13) ^ h) | 0;
    h = (h * 1274126177 + 1013904223) | 0;
    return ((h >> 16) & 0x7fff) / 0x7fff;
  }

  private placeStructures(
    tiles: Tile[][],
    w: number,
    h: number,
    rng: () => number,
  ) {
    // Small building near center (the settlement)
    const buildings = [
      { x: 22, y: 17, bw: 3, bh: 3, name: "sheriff_office" },
      { x: 17, y: 21, bw: 3, bh: 2, name: "trading_post" },
      { x: 21, y: 22, bw: 2, bh: 2, name: "clinic" },
    ];

    for (const b of buildings) {
      for (let dy = 0; dy < b.bh; dy++) {
        for (let dx = 0; dx < b.bw; dx++) {
          const tx = b.x + dx;
          const ty = b.y + dy;
          if (tx >= 0 && tx < w && ty >= 0 && ty < h) {
            tiles[ty][tx].terrain = Terrain.Concrete;
            // Walls on perimeter, floor inside
            if (dx === 0 || dx === b.bw - 1 || dy === 0 || dy === b.bh - 1) {
              // Leave doorway
              if (dx === Math.floor(b.bw / 2) && dy === b.bh - 1) {
                continue;
              }
              tiles[ty][tx].collision = Collision.Solid;
              tiles[ty][tx].object = "wall";
            }
          }
        }
      }
    }

    // Scatter environmental objects for Fallout 2 wasteland feel
    // Weighted object pools per zone: settlement core vs outer wasteland
    const settlementObjects: { key: string; weight: number; solid: boolean }[] = [
      { key: "barrel", weight: 3, solid: true },
      { key: "crate", weight: 3, solid: true },
      { key: "dumpster", weight: 1, solid: true },
      { key: "footlocker", weight: 2, solid: false },
      { key: "scrap_pile", weight: 2, solid: false },
      { key: "tire_pile", weight: 1, solid: false },
      { key: "street_lamp", weight: 2, solid: true },
      { key: "sign_post", weight: 1, solid: false },
      { key: "fire_hydrant", weight: 1, solid: false },
    ];
    const wastelandObjects: { key: string; weight: number; solid: boolean }[] = [
      { key: "rock", weight: 4, solid: true },
      { key: "dead_tree", weight: 3, solid: true },
      { key: "cactus", weight: 2, solid: true },
      { key: "bones", weight: 3, solid: false },
      { key: "destroyed_car", weight: 1, solid: true },
      { key: "scrap_pile", weight: 2, solid: false },
      { key: "rubble_pile", weight: 2, solid: true },
      { key: "crater", weight: 1, solid: false },
      { key: "tire_pile", weight: 1, solid: false },
      { key: "fence_post", weight: 1, solid: false },
    ];
    const hazardObjects: { key: string; weight: number; solid: boolean }[] = [
      { key: "toxic_barrel", weight: 2, solid: true },
      { key: "crater", weight: 2, solid: false },
      { key: "bones", weight: 3, solid: false },
    ];

    const pickWeighted = (
      pool: { key: string; weight: number; solid: boolean }[],
      r: number,
    ) => {
      const totalWeight = pool.reduce((sum, o) => sum + o.weight, 0);
      let cumulative = 0;
      const target = r * totalWeight;
      for (const obj of pool) {
        cumulative += obj.weight;
        if (target <= cumulative) return obj;
      }
      return pool[pool.length - 1];
    };

    const cx = w / 2;
    const cy = h / 2;

    // Place ~60 objects (double the old count for denser maps)
    for (let i = 0; i < 60; i++) {
      const x = Math.floor(rng() * w);
      const y = Math.floor(rng() * h);
      if (
        x > 2 &&
        x < w - 2 &&
        y > 2 &&
        y < h - 2 &&
        tiles[y][x].collision === Collision.None &&
        tiles[y][x].terrain !== Terrain.Water &&
        !tiles[y][x].object
      ) {
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        let pool: { key: string; weight: number; solid: boolean }[];
        if (dist < 8) {
          pool = settlementObjects;
        } else if (rng() < 0.15) {
          pool = hazardObjects;
        } else {
          pool = wastelandObjects;
        }
        const picked = pickWeighted(pool, rng());
        tiles[y][x].object = picked.key;
        if (picked.solid) {
          tiles[y][x].collision = Collision.Solid;
        }
      }
    }

    // Place a few campfires at specific spots (raider camps, settlement edge)
    const campfireSpots = [
      { x: 11, y: 9 },  // raider camp NW
      { x: 29, y: 31 }, // raider camp SE
      { x: 15, y: 15 }, // settlement edge
    ];
    for (const spot of campfireSpots) {
      if (
        spot.x > 0 && spot.x < w &&
        spot.y > 0 && spot.y < h &&
        tiles[spot.y][spot.x].collision === Collision.None
      ) {
        tiles[spot.y][spot.x].object = "campfire";
      }
    }

    // Place tents near raider camps
    const tentSpots = [
      { x: 9, y: 8 },
      { x: 31, y: 29 },
    ];
    for (const spot of tentSpots) {
      if (
        spot.x > 0 && spot.x < w &&
        spot.y > 0 && spot.y < h &&
        tiles[spot.y][spot.x].collision === Collision.None
      ) {
        tiles[spot.y][spot.x].object = "tent";
        tiles[spot.y][spot.x].collision = Collision.Solid;
      }
    }
  }

  private placeRoads(tiles: Tile[][], w: number, h: number) {
    // Horizontal road through middle
    const cy = Math.floor(h / 2);
    for (let x = 3; x < w - 3; x++) {
      for (let dy = -1; dy <= 0; dy++) {
        const y = cy + dy;
        if (tiles[y][x].collision === Collision.None) {
          tiles[y][x].terrain = Terrain.Road;
          tiles[y][x].object = undefined;
        }
      }
    }

    // Vertical road
    const cx = Math.floor(w / 2);
    for (let y = 3; y < h - 3; y++) {
      for (let dx = -1; dx <= 0; dx++) {
        const x = cx + dx;
        if (tiles[y][x].collision === Collision.None) {
          tiles[y][x].terrain = Terrain.Road;
          tiles[y][x].object = undefined;
        }
      }
    }
  }

  /** Check if a position is valid for spawning (walkable, not water) */
  private isSpawnable(tiles: Tile[][], pos: TilePos, w: number, h: number): boolean {
    if (pos.x < 0 || pos.y < 0 || pos.x >= w || pos.y >= h) return false;
    const tile = tiles[pos.y][pos.x];
    return tile.collision === Collision.None && tile.terrain !== Terrain.Water;
  }

  /** Find the nearest walkable tile to a position (spiral search) */
  private findNearbyWalkable(tiles: Tile[][], pos: TilePos, w: number, h: number): TilePos | null {
    for (let r = 1; r <= 5; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const np = { x: pos.x + dx, y: pos.y + dy };
          if (this.isSpawnable(tiles, np, w, h)) return np;
        }
      }
    }
    return null;
  }

  /** Check if a tile is walkable */
  isWalkable(map: GameMap, pos: TilePos): boolean {
    if (pos.x < 0 || pos.y < 0 || pos.x >= map.width || pos.y >= map.height) {
      return false;
    }
    return map.tiles[pos.y][pos.x].collision === Collision.None;
  }
}
