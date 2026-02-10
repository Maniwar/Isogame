import { Entity, GameState, ItemDef } from "../types";
import { getWeaponSpriteKey } from "./EntitySystem";

/** Item definitions database */
export const ITEM_DB: Record<string, ItemDef> = {
  "10mm_pistol": {
    id: "10mm_pistol",
    name: "10mm Pistol",
    description: "A reliable semi-automatic pistol. Standard wasteland sidearm.",
    category: "weapon",
    icon: "item_pistol",
    damage: 8,
    apCost: 4,
    value: 75,
  },
  pipe_rifle: {
    id: "pipe_rifle",
    name: "Pipe Rifle",
    description: "A makeshift rifle cobbled together from pipes and scrap.",
    category: "weapon",
    icon: "item_rifle",
    damage: 10,
    apCost: 5,
    value: 50,
  },
  combat_knife: {
    id: "combat_knife",
    name: "Combat Knife",
    description: "A sturdy military knife. Good for close encounters.",
    category: "weapon",
    icon: "item_knife",
    damage: 6,
    apCost: 3,
    value: 40,
  },
  baseball_bat: {
    id: "baseball_bat",
    name: "Baseball Bat",
    description: "A wooden bat with nails through the business end.",
    category: "weapon",
    icon: "item_bat",
    damage: 7,
    apCost: 3,
    value: 30,
  },
  leather_armor: {
    id: "leather_armor",
    name: "Leather Armor",
    description: "Patched leather chest armor with metal studs.",
    category: "armor",
    icon: "item_armor",
    armorValue: 5,
    value: 100,
  },
  stimpak: {
    id: "stimpak",
    name: "Stimpak",
    description: "A medical syringe that rapidly heals wounds.",
    category: "consumable",
    icon: "item_stimpak",
    healing: 25,
    apCost: 2,
    value: 25,
  },
  rad_away: {
    id: "rad_away",
    name: "Rad-Away",
    description: "Intravenous chemical solution that removes radiation.",
    category: "consumable",
    icon: "item_radaway",
    healing: 10,
    value: 20,
  },
  nuka_cola: {
    id: "nuka_cola",
    name: "Nuka-Cola",
    description: "A refreshing pre-war soft drink. Slightly irradiated.",
    category: "consumable",
    icon: "item_nuka",
    healing: 5,
    value: 10,
  },
  canned_food: {
    id: "canned_food",
    name: "Canned Food",
    description: "A dented tin of mystery meat. Still edible... probably.",
    category: "consumable",
    icon: "item_food",
    healing: 8,
    value: 8,
  },
  bottle_caps: {
    id: "bottle_caps",
    name: "Bottle Caps",
    description: "The currency of the wasteland.",
    category: "misc",
    icon: "item_caps",
    value: 1,
  },
  bobby_pin: {
    id: "bobby_pin",
    name: "Bobby Pin",
    description: "Useful for picking locks.",
    category: "misc",
    icon: "item_pin",
    value: 3,
  },
  holotape: {
    id: "holotape",
    name: "Holotape",
    description: "A small data storage device. Might contain useful information.",
    category: "misc",
    icon: "item_holotape",
    value: 15,
  },
};

export class InventorySystem {
  addItem(entity: Entity, itemId: string, count: number) {
    const existing = entity.inventory.find((i) => i.itemId === itemId);
    if (existing) {
      existing.count += count;
    } else {
      entity.inventory.push({ itemId, count });
    }
  }

  removeItem(entity: Entity, itemId: string, count: number): boolean {
    const existing = entity.inventory.find((i) => i.itemId === itemId);
    if (!existing || existing.count < count) return false;

    existing.count -= count;
    if (existing.count <= 0) {
      entity.inventory = entity.inventory.filter((i) => i.itemId !== itemId);
    }
    return true;
  }

  useItem(state: GameState, itemId: string) {
    const def = ITEM_DB[itemId];
    if (!def) return;

    const player = state.player;

    if (def.category === "consumable" && def.healing) {
      const had = this.removeItem(player, itemId, 1);
      if (had) {
        player.stats.hp = Math.min(player.stats.maxHp, player.stats.hp + def.healing);
        state.notifications.unshift({
          text: `Used ${def.name}: +${def.healing} HP`,
          color: "rgb(64, 192, 64)",
          timeLeft: 3000,
        });
      }
    } else if (def.category === "weapon") {
      // Toggle equip
      for (const item of player.inventory) {
        item.equipped = false;
      }
      const inv = player.inventory.find((i) => i.itemId === itemId);
      if (inv) {
        inv.equipped = true;
        // Swap to the weapon-specific sprite sheet
        player.spriteKey = getWeaponSpriteKey(player.baseSpriteKey, player.inventory);
        state.notifications.unshift({
          text: `Equipped: ${def.name}`,
          color: "rgb(212, 196, 160)",
          timeLeft: 2000,
        });
      }
    }
  }

  getItemDef(id: string): ItemDef | undefined {
    return ITEM_DB[id];
  }
}
