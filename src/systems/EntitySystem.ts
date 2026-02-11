import { Entity, Stats, TilePos, NpcSpawn, AnimState, CrippleState, InventoryItem } from "../types";

/** Maps item IDs to weapon sprite key suffixes */
const WEAPON_SPRITE_SUFFIX: Record<string, string> = {
  "10mm_pistol": "pistol",
  "pipe_rifle": "rifle",
  "combat_knife": "knife",
  "baseball_bat": "bat",
};

/** Compute the weapon-specific spriteKey for an entity based on equipped weapon */
export function getWeaponSpriteKey(baseSpriteKey: string, inventory: InventoryItem[]): string {
  const equipped = inventory.find((i) => i.equipped);
  if (equipped) {
    const suffix = WEAPON_SPRITE_SUFFIX[equipped.itemId];
    if (suffix) return `${baseSpriteKey}_${suffix}`;
  }
  return `${baseSpriteKey}_unarmed`;
}

const DEFAULT_CRIPPLE: CrippleState = {
  head: false,
  left_arm: false,
  right_arm: false,
  left_leg: false,
  right_leg: false,
};

const DEFAULT_ANIM: AnimState = {
  current: "idle",
  frame: 0,
  elapsed: 0,
  speed: 150,     // ms per frame for walk cycle (~6.7 fps)
};

const DEFAULT_STATS: Stats = {
  hp: 40,
  maxHp: 40,
  ap: 8,
  maxAp: 8,
  strength: 5,
  perception: 5,
  endurance: 5,
  charisma: 5,
  intelligence: 5,
  agility: 5,
  luck: 5,
};

export class EntitySystem {
  private nextId = 0;

  createPlayer(pos: TilePos): Entity {
    const inventory: InventoryItem[] = [
      { itemId: "10mm_pistol", count: 1, equipped: true },
      { itemId: "stimpak", count: 2 },
      { itemId: "bottle_caps", count: 50 },
    ];
    const baseSpriteKey = "player";
    return {
      id: `player_${this.nextId++}`,
      name: "Wanderer",
      pos: { ...pos },
      targetPos: null,
      path: [],
      direction: "S",
      spriteKey: getWeaponSpriteKey(baseSpriteKey, inventory),
      baseSpriteKey,
      stats: {
        ...DEFAULT_STATS,
        hp: 50,
        maxHp: 50,
        ap: 10,
        maxAp: 10,
        agility: 7,
        perception: 6,
      },
      inventory,
      isPlayer: true,
      isHostile: false,
      moveProgress: 0,
      dead: false,
      anim: { ...DEFAULT_ANIM },
      crippled: { ...DEFAULT_CRIPPLE },
    };
  }

  createNPC(spawn: NpcSpawn): Entity {
    const stats: Stats = { ...DEFAULT_STATS, ...spawn.stats };
    const inventory = spawn.inventory ? [...spawn.inventory] : [];
    return {
      id: `npc_${spawn.id}_${this.nextId++}`,
      name: spawn.name,
      pos: { ...spawn.pos },
      targetPos: null,
      path: [],
      direction: "S",
      spriteKey: spawn.spriteKey,
      baseSpriteKey: spawn.spriteKey,
      stats,
      inventory,
      isPlayer: false,
      isHostile: spawn.isHostile,
      dialogueId: spawn.dialogueId,
      moveProgress: 0,
      dead: false,
      anim: { ...DEFAULT_ANIM },
      crippled: { ...DEFAULT_CRIPPLE },
    };
  }
}
