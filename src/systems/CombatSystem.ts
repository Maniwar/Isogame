import { GameState, Entity } from "../types";

export interface AttackResult {
  hit: boolean;
  damage: number;
  message: string;
}

export class CombatSystem {
  /** Initialize combat — build turn queue sorted by agility */
  initCombat(state: GameState) {
    const combatants = state.entities
      .filter((e) => !e.dead && (e.isPlayer || e.isHostile))
      .sort((a, b) => b.stats.agility - a.stats.agility);

    state.combatQueue = combatants.map((e) => e.id);
    state.activeCombatIdx = 0;

    // Reset AP for all combatants
    for (const e of combatants) {
      e.stats.ap = e.stats.maxAp;
    }
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
        }
      }
    }

    // Skip dead entities
    const currentId = state.combatQueue[state.activeCombatIdx];
    const current = state.entities.find((e) => e.id === currentId);
    if (current?.dead) {
      this.nextTurn(state);
    }
  }

  /** Perform an attack */
  attack(_state: GameState, attacker: Entity, target: Entity): AttackResult {
    const apCost = this.getWeaponApCost(attacker);
    if (attacker.stats.ap < apCost) {
      return { hit: false, damage: 0, message: "Not enough AP!" };
    }

    attacker.stats.ap -= apCost;

    // Hit chance based on perception and distance
    const dist = Math.abs(attacker.pos.x - target.pos.x) + Math.abs(attacker.pos.y - target.pos.y);
    const baseHitChance = 0.7 + attacker.stats.perception * 0.03 - dist * 0.05;
    const hitRoll = Math.random();

    if (hitRoll > baseHitChance) {
      return { hit: false, damage: 0, message: `${attacker.name} missed ${target.name}!` };
    }

    // Damage
    const baseDamage = this.getWeaponDamage(attacker);
    const strengthBonus = Math.floor(attacker.stats.strength / 3);
    const variance = Math.floor(Math.random() * 4) - 2;
    const damage = Math.max(1, baseDamage + strengthBonus + variance);

    // Critical hit
    const critChance = attacker.stats.luck * 0.02;
    const isCrit = Math.random() < critChance;
    const finalDamage = isCrit ? damage * 2 : damage;

    target.stats.hp -= finalDamage;
    if (target.stats.hp <= 0) {
      target.stats.hp = 0;
      target.dead = true;
    }

    const critStr = isCrit ? " CRITICAL HIT!" : "";
    return {
      hit: true,
      damage: finalDamage,
      message: `${attacker.name} hits ${target.name} for ${finalDamage} damage!${critStr}`,
    };
  }

  /** Simple AI behavior for hostile NPCs */
  aiTurn(state: GameState, npc: Entity) {
    if (npc.dead) return;

    const player = state.player;
    const dist = Math.abs(npc.pos.x - player.pos.x) + Math.abs(npc.pos.y - player.pos.y);

    // If close enough, attack
    if (dist <= 5) {
      while (npc.stats.ap >= this.getWeaponApCost(npc)) {
        const result = this.attack(state, npc, player);
        if (result.hit) {
          state.notifications.unshift({
            text: result.message,
            color: "rgb(184, 48, 48)",
            timeLeft: 3000,
          });
        }
        if (player.dead) break;
      }
    }
    // Otherwise try to move closer (simplified — just step toward player)
    else if (npc.stats.ap > 0) {
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
        npc.stats.ap--;
      }
    }
  }

  private getWeaponDamage(entity: Entity): number {
    const weapon = entity.inventory.find((i) => i.equipped);
    // Rough damage lookup
    if (weapon) {
      switch (weapon.itemId) {
        case "10mm_pistol": return 8;
        case "pipe_rifle": return 10;
        case "combat_knife": return 6;
        case "baseball_bat": return 7;
      }
    }
    return 3; // unarmed
  }

  private getWeaponApCost(entity: Entity): number {
    const weapon = entity.inventory.find((i) => i.equipped);
    if (weapon) {
      switch (weapon.itemId) {
        case "10mm_pistol": return 4;
        case "pipe_rifle": return 5;
        case "combat_knife": return 3;
        case "baseball_bat": return 3;
      }
    }
    return 2; // unarmed
  }
}
