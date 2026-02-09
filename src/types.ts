// ---------------------------------------------------------------------------
// Core types for Isogame
// ---------------------------------------------------------------------------

/** 2D position in tile coordinates */
export interface TilePos {
  x: number;
  y: number;
}

/** 2D position in screen/pixel coordinates */
export interface ScreenPos {
  x: number;
  y: number;
}

/** Cardinal + ordinal directions (isometric 8-way) */
export type Direction = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

/** Tile terrain types */
export enum Terrain {
  Sand = 0,
  Dirt = 1,
  CrackedEarth = 2,
  Rubble = 3,
  Road = 4,
  Concrete = 5,
  Grass = 6,
  Water = 7,
}

/** What blocks movement on a tile */
export enum Collision {
  None = 0,
  Solid = 1,     // Full block
  Water = 2,     // Impassable water
}

/** A single tile in the map */
export interface Tile {
  terrain: Terrain;
  collision: Collision;
  elevation: number;       // 0 = ground level
  object?: string;         // optional object sprite key
}

/** Map layer data */
export interface GameMap {
  name: string;
  width: number;
  height: number;
  tiles: Tile[][];          // [y][x]
  spawnPoints: Record<string, TilePos>;
  npcs: NpcSpawn[];
  items: ItemSpawn[];
}

/** Entity stats (player + NPCs) */
export interface Stats {
  hp: number;
  maxHp: number;
  ap: number;
  maxAp: number;
  strength: number;
  perception: number;
  endurance: number;
  charisma: number;
  intelligence: number;
  agility: number;
  luck: number;
}

/** Animation state names */
export type AnimationName = "idle" | "walk" | "attack";

/** Animation playback state for an entity */
export interface AnimState {
  current: AnimationName;
  frame: number;              // current frame index within animation
  elapsed: number;            // ms elapsed in current frame
  speed: number;              // ms per frame
}

/** An entity in the world */
export interface Entity {
  id: string;
  name: string;
  pos: TilePos;
  targetPos: TilePos | null;
  path: TilePos[];
  direction: Direction;
  spriteKey: string;
  stats: Stats;
  inventory: InventoryItem[];
  isPlayer: boolean;
  isHostile: boolean;
  dialogueId?: string;
  moveProgress: number;      // 0..1 interpolation between tiles
  dead: boolean;
  anim: AnimState;
}

/** Item definition */
export interface ItemDef {
  id: string;
  name: string;
  description: string;
  category: "weapon" | "armor" | "consumable" | "misc";
  icon: string;              // sprite key
  damage?: number;
  healing?: number;
  armorValue?: number;
  apCost?: number;
  value: number;             // trade value in caps
}

/** Item in an inventory (with stack count) */
export interface InventoryItem {
  itemId: string;
  count: number;
  equipped?: boolean;
}

/** NPC spawn definition in map data */
export interface NpcSpawn {
  id: string;
  name: string;
  pos: TilePos;
  spriteKey: string;
  isHostile: boolean;
  dialogueId?: string;
  stats: Partial<Stats>;
  inventory?: InventoryItem[];
}

/** Item pickup in map data */
export interface ItemSpawn {
  itemId: string;
  pos: TilePos;
  count: number;
}

/** Dialogue node */
export interface DialogueNode {
  id: string;
  speaker: string;
  text: string;
  responses: DialogueResponse[];
}

/** Player response option in dialogue */
export interface DialogueResponse {
  text: string;
  nextNodeId: string | null;  // null = end conversation
  skillCheck?: { skill: string; threshold: number };
  giveItem?: string;
  removeItem?: string;
}

/** Dialogue tree (a complete conversation) */
export interface DialogueTree {
  id: string;
  startNodeId: string;
  nodes: Record<string, DialogueNode>;
}

/** Game state phases */
export type GamePhase = "explore" | "dialogue" | "combat" | "inventory" | "menu";

/** Overall game state */
export interface GameState {
  phase: GamePhase;
  map: GameMap;
  entities: Entity[];
  player: Entity;
  selectedEntity: Entity | null;
  turn: number;
  combatQueue: string[];     // entity IDs in turn order
  activeCombatIdx: number;
  dialogueTree: DialogueTree | null;
  dialogueNodeId: string | null;
  notifications: Notification[];
  gameTime: number;          // in-game hours elapsed
}

export interface Notification {
  text: string;
  color: string;
  timeLeft: number;
}

/** Isometric constants */
export const TILE_W = 64;
export const TILE_H = 32;
export const TILE_HALF_W = TILE_W / 2;
export const TILE_HALF_H = TILE_H / 2;
