import { Entity, AnimationName, GameState } from "../types";

/**
 * Manages animation state for all entities.
 *
 * Animation names map to sprite sheet rows (8 rows total):
 *   Row 0: "idle"     — standing still
 *   Row 1: "walk_1"   — left foot forward (contact)
 *   Row 2: "walk_2"   — mid-stride passing
 *   Row 3: "walk_3"   — right foot forward (contact)
 *   Row 4: "walk_4"   — mid-stride passing (opposite)
 *   Row 5: "attack_1" — wind-up / preparation
 *   Row 6: "attack_2" — strike / impact
 *   Row 7: "hit"      — recoiling from damage
 *
 * Walk: 4-frame cycle (walk_1 → walk_2 → walk_3 → walk_4)
 * Attack: 2-frame sequence (attack_1 wind-up → attack_2 strike → idle)
 * Hit: single frame held briefly then returns to idle
 */

/** Walk cycle frame keys — full 4-frame cycle for smooth movement.
 *  walk_1 (left contact) → walk_2 (passing) → walk_3 (right contact) → walk_4 (passing) */
const WALK_FRAMES = ["walk_1", "walk_2", "walk_3", "walk_4"];

/** Attack frame keys — wind-up then strike */
const ATTACK_FRAMES = ["attack_1", "attack_2"];

/** Time spent on attack wind-up before transitioning to strike (ms) */
const ATTACK_WINDUP_MS = 250;

/** Time spent on attack strike before returning to idle (ms) */
const ATTACK_STRIKE_MS = 350;

/** Total attack animation duration */
const ATTACK_TOTAL_MS = ATTACK_WINDUP_MS + ATTACK_STRIKE_MS;

/** How long the shoot animation plays (same 2-frame sequence as attack) */
const SHOOT_WINDUP_MS = 150;
const SHOOT_STRIKE_MS = 250;
const SHOOT_TOTAL_MS = SHOOT_WINDUP_MS + SHOOT_STRIKE_MS;

/** How long the reload animation plays (ms) */
const RELOAD_HOLD_MS = 1000;

/** How long the hit reaction is held before returning to idle (ms) */
const HIT_HOLD_MS = 400;

export class AnimationSystem {
  /**
   * Update animation state for all entities each frame.
   */
  update(state: GameState, dt: number) {
    for (const entity of state.entities) {
      if (entity.dead) continue;
      this.updateEntity(entity, dt);
    }
  }

  private updateEntity(entity: Entity, dt: number) {
    const anim = entity.anim;

    // Determine what animation should be playing based on entity state
    const desired = this.getDesiredAnimation(entity);

    if (desired !== anim.current) {
      // Transition to new animation
      anim.current = desired;
      anim.frame = 0;
      anim.elapsed = 0;
    }

    // Advance frame timer
    anim.elapsed += dt;

    switch (anim.current) {
      case "idle":
        // Single frame, no cycling needed
        anim.frame = 0;
        break;

      case "walk":
        // 4-frame walk cycle
        if (anim.elapsed >= anim.speed) {
          anim.elapsed -= anim.speed;
          anim.frame = (anim.frame + 1) % WALK_FRAMES.length;
        }
        break;

      case "attack":
        // 2-frame attack: wind-up → strike → idle
        if (anim.elapsed < ATTACK_WINDUP_MS) {
          anim.frame = 0; // attack_1 (wind-up)
        } else if (anim.elapsed < ATTACK_TOTAL_MS) {
          anim.frame = 1; // attack_2 (strike)
        } else {
          anim.current = "idle";
          anim.frame = 0;
          anim.elapsed = 0;
        }
        break;

      case "shoot":
        // 2-frame shoot: wind-up → strike → idle (faster than melee)
        if (anim.elapsed < SHOOT_WINDUP_MS) {
          anim.frame = 0; // attack_1 (aim)
        } else if (anim.elapsed < SHOOT_TOTAL_MS) {
          anim.frame = 1; // attack_2 (fire)
        } else {
          anim.current = "idle";
          anim.frame = 0;
          anim.elapsed = 0;
        }
        break;

      case "reload":
        // Hold idle-like pose during reload, then return to idle
        if (anim.elapsed >= RELOAD_HOLD_MS) {
          anim.current = "idle";
          anim.frame = 0;
          anim.elapsed = 0;
        }
        break;

      case "hit":
        // Hold hit reaction frame, then return to idle
        if (anim.elapsed >= HIT_HOLD_MS) {
          anim.current = "idle";
          anim.frame = 0;
          anim.elapsed = 0;
        }
        break;
    }
  }

  private getDesiredAnimation(entity: Entity): AnimationName {
    // If entity is moving (has path and is interpolating), play walk
    if (entity.path.length > 0 || entity.moveProgress > 0) {
      return "walk";
    }

    // If currently in attack/shoot/reload/hit animation, let it finish
    if (entity.anim.current === "attack" ||
        entity.anim.current === "shoot" ||
        entity.anim.current === "reload" ||
        entity.anim.current === "hit") {
      return entity.anim.current;
    }

    return "idle";
  }

  /**
   * Trigger a melee attack animation on an entity.
   * Call this from CombatSystem when an entity does a melee attack.
   */
  triggerAttack(entity: Entity) {
    entity.anim.current = "attack";
    entity.anim.frame = 0;
    entity.anim.elapsed = 0;
  }

  /**
   * Trigger a shooting animation on an entity.
   * Call this from CombatSystem when an entity fires a ranged weapon.
   */
  triggerShoot(entity: Entity) {
    entity.anim.current = "shoot";
    entity.anim.frame = 0;
    entity.anim.elapsed = 0;
  }

  /**
   * Trigger a reload animation on an entity.
   */
  triggerReload(entity: Entity) {
    entity.anim.current = "reload";
    entity.anim.frame = 0;
    entity.anim.elapsed = 0;
  }

  /**
   * Trigger a hit reaction animation on an entity.
   * Call this from CombatSystem when an entity takes damage.
   */
  triggerHit(entity: Entity) {
    entity.anim.current = "hit";
    entity.anim.frame = 0;
    entity.anim.elapsed = 0;
  }

  /**
   * Get the sprite sheet row key for the current animation frame.
   * Maps to the keys used in the manifest's animations section.
   *
   * Frame keys returned:
   *   "idle"     — idle pose
   *   "walk_1"   — walk frame 1 (left foot forward)
   *   "walk_2"   — walk frame 2 (mid-stride)
   *   "walk_3"   — walk frame 3 (right foot forward)
   *   "walk_4"   — walk frame 4 (mid-stride opposite)
   *   "attack_1" — attack wind-up
   *   "attack_2" — attack strike
   *   "hit"      — hit reaction
   */
  static getFrameKey(entity: Entity): string {
    const anim = entity.anim;
    switch (anim.current) {
      case "walk":
        return WALK_FRAMES[anim.frame] ?? "walk_1";
      case "attack":
        return ATTACK_FRAMES[anim.frame] ?? "attack_1";
      case "shoot":
        return ATTACK_FRAMES[anim.frame] ?? "attack_1";
      case "reload":
        return "idle";
      case "hit":
        return "hit";
      case "idle":
      default:
        return "idle";
    }
  }
}
