import { Entity, Stats, TilePos, NpcSpawn, AnimState } from "../types";

const DEFAULT_ANIM: AnimState = {
  current: "idle",
  frame: 0,
  elapsed: 0,
  speed: 250,     // ms per frame for walk cycle
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
    return {
      id: `player_${this.nextId++}`,
      name: "Wanderer",
      pos: { ...pos },
      targetPos: null,
      path: [],
      direction: "S",
      spriteKey: "player",
      stats: {
        ...DEFAULT_STATS,
        hp: 50,
        maxHp: 50,
        ap: 10,
        maxAp: 10,
        agility: 7,
        perception: 6,
      },
      inventory: [
        { itemId: "10mm_pistol", count: 1, equipped: true },
        { itemId: "stimpak", count: 2 },
        { itemId: "bottle_caps", count: 50 },
      ],
      isPlayer: true,
      isHostile: false,
      moveProgress: 0,
      dead: false,
      anim: { ...DEFAULT_ANIM },
    };
  }

  createNPC(spawn: NpcSpawn): Entity {
    const stats: Stats = { ...DEFAULT_STATS, ...spawn.stats };
    return {
      id: `npc_${spawn.id}_${this.nextId++}`,
      name: spawn.name,
      pos: { ...spawn.pos },
      targetPos: null,
      path: [],
      direction: "S",
      spriteKey: spawn.spriteKey,
      stats,
      inventory: spawn.inventory ? [...spawn.inventory] : [],
      isPlayer: false,
      isHostile: spawn.isHostile,
      dialogueId: spawn.dialogueId,
      moveProgress: 0,
      dead: false,
      anim: { ...DEFAULT_ANIM },
    };
  }
}
