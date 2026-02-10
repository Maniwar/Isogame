import { Entity, AnimationName, GameState } from "../types";

/**
 * Manages animation state for all entities.
 *
 * Animation names map to sprite sheet rows:
 *   - "idle"   -> row 0 (single frame)
 *   - "walk"   -> rows 1-2 (walk_1, walk_2 — 2-frame cycle)
 *   - "attack" -> row 3 (single frame, held briefly then returns to idle)
 *
 * The walk animation alternates between walk_1 and walk_2 frames.
 * The AssetManager stores these as separate keys: "idle", "walk_1", "walk_2", "attack".
 */

/** Walk cycle frame keys — alternated during walk animation */
const WALK_FRAMES = ["walk_1", "walk_2"];

/** How long attack pose is held before returning to idle (ms) */
const ATTACK_HOLD_MS = 600;

/** How long the shoot pose is held (ms) */
const SHOOT_HOLD_MS = 400;

/** How long the reload animation plays (ms) */
const RELOAD_HOLD_MS = 1000;

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
        // 2-frame walk cycle
        if (anim.elapsed >= anim.speed) {
          anim.elapsed -= anim.speed;
          anim.frame = (anim.frame + 1) % WALK_FRAMES.length;
        }
        break;

      case "attack":
        // Hold attack frame, then auto-return to idle
        if (anim.elapsed >= ATTACK_HOLD_MS) {
          anim.current = "idle";
          anim.frame = 0;
          anim.elapsed = 0;
        }
        break;

      case "shoot":
        // Hold shoot frame, then auto-return to idle
        if (anim.elapsed >= SHOOT_HOLD_MS) {
          anim.current = "idle";
          anim.frame = 0;
          anim.elapsed = 0;
        }
        break;

      case "reload":
        // Hold reload animation, then auto-return to idle
        if (anim.elapsed >= RELOAD_HOLD_MS) {
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

    // If currently in attack/shoot/reload animation, let it finish
    if (entity.anim.current === "attack" ||
        entity.anim.current === "shoot" ||
        entity.anim.current === "reload") {
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
   * Get the sprite sheet row key for the current animation frame.
   * This maps to the keys used in the manifest's animations section.
   *
   * Returns: "idle" | "walk_1" | "walk_2" | "attack"
   */
  static getFrameKey(entity: Entity): string {
    const anim = entity.anim;
    switch (anim.current) {
      case "walk":
        return WALK_FRAMES[anim.frame] ?? "walk_1";
      case "attack":
        return "attack";
      case "shoot":
        return "shoot";
      case "reload":
        return "reload";
      case "idle":
      default:
        return "idle";
    }
  }
}
