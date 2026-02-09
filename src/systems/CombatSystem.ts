import { GameState, Entity, BodyPart, BODY_PARTS } from "../types";
import { ITEM_DB } from "./InventorySystem";

export interface AttackResult {
  hit: boolean;
  damage: number;
  message: string;
  crit: boolean;
  crippled?: BodyPart;   // body part that got crippled
  severed?: boolean;      // extreme damage = severed limb
  bodyPart?: BodyPart;
}

export class CombatSystem {
  /** Initialize combat — build turn queue sorted by agility */
  initCombat(state: GameState) {
    const combatants = state.entities
      .filter((e) => !e.dead && (e.isPlayer || e.isHostile))
      .sort((a, b) => b.stats.agility - a.stats.agility);

    state.combatQueue = combatants.map((e) => e.id);
    state.activeCombatIdx = 0;
    state.combatLog = [];
    state.targetBodyPart = null;
    state.combatActionQueue = [];
    state.combatExecuting = false;
    state.combatTurnDelay = 0;
    state.bodyPartPanelOpen = false;

    // Reset AP for all combatants
    for (const e of combatants) {
      e.stats.ap = e.stats.maxAp;
    }

    this.log(state, "Combat initiated! Initiative order determined.", "#b83030");
  }

  /** Advance to next turn */
  nextTurn(state: GameState) {
    state.activeCombatIdx++;
    if (state.activeCombatIdx >= state.combatQueue.length) {
      state.activeCombatIdx = 0;
      state.turn++;

      // Refresh AP
      for (const id of state.combatQueue) {
        const e = state.entities.find((en) => en.id === id);
        if (e && !e.dead) {
          e.stats.ap = e.stats.maxAp;
          // Crippled legs reduce max effective AP
          const legPenalty = (e.crippled.left_leg ? 1 : 0) + (e.crippled.right_leg ? 1 : 0);
          if (legPenalty > 0) {
            e.stats.ap = Math.max(2, e.stats.ap - legPenalty);
          }
        }
      }

      this.log(state, `--- Round ${state.turn + 1} ---`, "#d4c4a0");
    }

    // Skip dead entities
    const currentId = state.combatQueue[state.activeCombatIdx];
    const current = state.entities.find((e) => e.id === currentId);
    if (current?.dead) {
      this.nextTurn(state);
      return;
    }

    // Clear action queue on turn change
    state.combatActionQueue = [];
    state.combatExecuting = false;

    // Add delay between turns so player can see what's happening
    if (current && !current.isPlayer) {
      state.combatTurnDelay = 600; // 600ms delay before AI acts
      this.log(state, `${current.name}'s turn.`, "#c4703a");
    } else if (current) {
      this.log(state, `Your turn. AP: ${current.stats.ap}`, "#40c040");
    }
  }

  /** Perform a targeted attack */
  attack(
    _state: GameState,
    attacker: Entity,
    target: Entity,
    bodyPart: BodyPart = "torso",
  ): AttackResult {
    const apCost = this.getWeaponApCost(attacker);
    if (attacker.stats.ap < apCost) {
      return { hit: false, damage: 0, message: "Not enough AP!", crit: false };
    }

    attacker.stats.ap -= apCost;

    const partMod = BODY_PARTS[bodyPart];

    // Hit chance: base + perception bonus - distance penalty, modified by body part
    const dist = Math.abs(attacker.pos.x - target.pos.x) + Math.abs(attacker.pos.y - target.pos.y);
    let baseHitChance = 0.7 + attacker.stats.perception * 0.03 - dist * 0.05;

    // Crippled head (blinded) reduces hit chance
    if (attacker.crippled.head) {
      baseHitChance -= 0.25;
    }

    const hitChance = baseHitChance * partMod.hitMod;
    const hitRoll = Math.random();

    if (hitRoll > hitChance) {
      return {
        hit: false,
        damage: 0,
        message: `${attacker.name} aimed for ${partMod.label} but missed!`,
        crit: false,
        bodyPart,
      };
    }

    // Damage calculation
    let baseDamage = this.getWeaponDamage(attacker);

    // Crippled arms reduce damage
    if (attacker.crippled.left_arm || attacker.crippled.right_arm) {
      baseDamage = Math.floor(baseDamage * 0.7);
    }

    const strengthBonus = Math.floor(attacker.stats.strength / 3);
    const variance = Math.floor(Math.random() * 4) - 2;
    const rawDamage = Math.max(1, baseDamage + strengthBonus + variance);
    const damage = Math.max(1, Math.floor(rawDamage * partMod.damageMod));

    // Critical hit
    const critChance = attacker.stats.luck * 0.02 + partMod.critBonus;
    const isCrit = Math.random() < critChance;
    const finalDamage = isCrit ? damage * 2 : damage;

    target.stats.hp -= finalDamage;

    // Cripple check
    let crippledPart: BodyPart | undefined;
    let severed = false;

    if (bodyPart !== "torso" && partMod.crippleChance > 0) {
      const crippleRoll = Math.random();
      const crippleThreshold = partMod.crippleChance + (isCrit ? 0.3 : 0);

      if (crippleRoll < crippleThreshold && !this.isPartCrippled(target, bodyPart)) {
        this.cripplePart(target, bodyPart);
        crippledPart = bodyPart;

        // Extreme damage on crippled limb = severed
        if (isCrit && finalDamage >= 15 && (bodyPart.includes("arm") || bodyPart.includes("leg"))) {
          severed = true;
        }
      }
    }

    if (target.stats.hp <= 0) {
      target.stats.hp = 0;
      target.dead = true;
    }

    // Build message
    const critStr = isCrit ? " CRITICAL!" : "";
    let msg = `${attacker.name} hits ${target.name}'s ${partMod.label} for ${finalDamage}!${critStr}`;
    if (severed) {
      msg += ` ${partMod.label} SEVERED!`;
    } else if (crippledPart) {
      msg += ` ${partMod.label} CRIPPLED!`;
    }

    return {
      hit: true,
      damage: finalDamage,
      message: msg,
      crit: isCrit,
      crippled: crippledPart,
      severed,
      bodyPart,
    };
  }

  /** Simple AI behavior — attacks one action at a time, returns true if did something */
  aiAct(state: GameState, npc: Entity): boolean {
    if (npc.dead) return false;

    const player = state.player;
    const dist = Math.abs(npc.pos.x - player.pos.x) + Math.abs(npc.pos.y - player.pos.y);
    const range = this.getWeaponRange(npc);
    const apCost = this.getWeaponApCost(npc);

    // If close enough and have AP, attack once
    if (dist <= range && npc.stats.ap >= apCost) {
      // AI targets randomly but prefers torso
      const parts: BodyPart[] = ["torso", "torso", "torso", "head", "left_arm", "right_arm", "left_leg", "right_leg"];
      const part = parts[Math.floor(Math.random() * parts.length)];
      const result = this.attack(state, npc, player, part);

      this.log(
        state,
        result.message,
        result.hit ? "#b83030" : "#999999",
      );

      return true;
    }

    // Move closer (one step, costs 1 AP)
    if (dist > range && npc.stats.ap > 0) {
      const moveCost = (npc.crippled.left_leg || npc.crippled.right_leg) ? 2 : 1;
      if (npc.stats.ap >= moveCost) {
        const dx = Math.sign(player.pos.x - npc.pos.x);
        const dy = Math.sign(player.pos.y - npc.pos.y);
        const newPos = { x: npc.pos.x + dx, y: npc.pos.y + dy };

        if (
          newPos.x >= 0 &&
          newPos.y >= 0 &&
          newPos.x < state.map.width &&
          newPos.y < state.map.height &&
          state.map.tiles[newPos.y][newPos.x].collision === 0
        ) {
          npc.pos = newPos;
          npc.stats.ap -= moveCost;
          return true;
        }
      }
    }

    return false; // nothing left to do
  }

  getWeaponDamage(entity: Entity): number {
    const weapon = entity.inventory.find((i) => i.equipped);
    if (weapon) {
      const def = ITEM_DB[weapon.itemId];
      if (def?.damage) return def.damage;
    }
    return 3; // unarmed
  }

  getWeaponApCost(entity: Entity): number {
    const weapon = entity.inventory.find((i) => i.equipped);
    if (weapon) {
      const def = ITEM_DB[weapon.itemId];
      if (def?.apCost) return def.apCost;
    }
    return 2; // unarmed
  }

  getWeaponRange(entity: Entity): number {
    const weapon = entity.inventory.find((i) => i.equipped);
    if (weapon) {
      switch (weapon.itemId) {
        case "10mm_pistol": return 8;
        case "pipe_rifle": return 12;
        case "combat_knife": return 1;
        case "baseball_bat": return 1;
      }
    }
    return 1; // unarmed
  }

  isRangedWeapon(entity: Entity): boolean {
    const weapon = entity.inventory.find((i) => i.equipped);
    return !!(weapon && (weapon.itemId === "10mm_pistol" || weapon.itemId === "pipe_rifle"));
  }

  getMoveCost(entity: Entity): number {
    return (entity.crippled.left_leg || entity.crippled.right_leg) ? 2 : 1;
  }

  private isPartCrippled(entity: Entity, part: BodyPart): boolean {
    switch (part) {
      case "head": return entity.crippled.head;
      case "left_arm": return entity.crippled.left_arm;
      case "right_arm": return entity.crippled.right_arm;
      case "left_leg": return entity.crippled.left_leg;
      case "right_leg": return entity.crippled.right_leg;
      default: return false;
    }
  }

  private cripplePart(entity: Entity, part: BodyPart) {
    switch (part) {
      case "head": entity.crippled.head = true; break;
      case "left_arm": entity.crippled.left_arm = true; break;
      case "right_arm": entity.crippled.right_arm = true; break;
      case "left_leg": entity.crippled.left_leg = true; break;
      case "right_leg": entity.crippled.right_leg = true; break;
    }
  }

  private log(state: GameState, text: string, color: string) {
    state.combatLog.push({ text, color, turn: state.turn });
    // Keep last 50 entries
    if (state.combatLog.length > 50) {
      state.combatLog.shift();
    }
  }
}
