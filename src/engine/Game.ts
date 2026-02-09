import { Camera } from "./Camera";
import { Input } from "./Input";
import { Renderer } from "./Renderer";
import { AssetManager } from "../assets/AssetManager";
import { MapSystem } from "../systems/MapSystem";
import { EntitySystem } from "../systems/EntitySystem";
import { MovementSystem } from "../systems/MovementSystem";
import { CombatSystem } from "../systems/CombatSystem";
import { AnimationSystem } from "../systems/AnimationSystem";
import { DialogueSystem } from "../systems/DialogueSystem";
import { InventorySystem, ITEM_DB } from "../systems/InventorySystem";
import { HUD } from "../ui/HUD";
import { DialogueUI } from "../ui/DialogueUI";
import { InventoryUI } from "../ui/InventoryUI";
import { Sound } from "./Sound";
import { GameState, GamePhase, Entity, BodyPart, BODY_PARTS, TILE_HALF_W, TILE_HALF_H } from "../types";

export class Game {
  private canvas: HTMLCanvasElement;
  private camera: Camera;
  private input: Input;
  private renderer: Renderer;
  private assets: AssetManager;

  // Systems
  private mapSystem: MapSystem;
  private entitySystem: EntitySystem;
  private movementSystem: MovementSystem;
  private combatSystem: CombatSystem;
  private animationSystem: AnimationSystem;
  private dialogueSystem: DialogueSystem;
  private inventorySystem: InventorySystem;

  // UI
  private hud: HUD;
  private dialogueUI: DialogueUI;
  private inventoryUI: InventoryUI;

  // Audio
  private sound: Sound;

  // AI turn pacing
  private aiActionTimer = 0;
  private readonly AI_ACTION_DELAY = 500; // ms between AI actions

  // State
  state!: GameState;
  private running = false;
  private lastTime = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.camera = new Camera();
    this.input = new Input(canvas);
    this.assets = new AssetManager();

    this.renderer = new Renderer(canvas, this.camera, this.assets);

    this.mapSystem = new MapSystem();
    this.entitySystem = new EntitySystem();
    this.movementSystem = new MovementSystem();
    this.combatSystem = new CombatSystem();
    this.animationSystem = new AnimationSystem();
    this.dialogueSystem = new DialogueSystem();
    this.inventorySystem = new InventorySystem();

    this.hud = new HUD();
    this.dialogueUI = new DialogueUI();
    this.inventoryUI = new InventoryUI();
    this.sound = new Sound();

    // Init audio on first user interaction (required by browsers)
    const initAudio = () => {
      this.sound.init();
      window.removeEventListener("click", initAudio);
      window.removeEventListener("touchstart", initAudio);
    };
    window.addEventListener("click", initAudio);
    window.addEventListener("touchstart", initAudio);

    window.addEventListener("resize", () => {
      this.renderer.resize();
      this.hud.initTouchButtons(this.canvas.width, this.canvas.height);
    });
  }

  async init() {
    this.renderer.resize();
    this.hud.initTouchButtons(this.canvas.width, this.canvas.height);

    // Load assets: tries AI-generated PNGs first, falls back to procedural
    await this.assets.init();

    // Build map
    const map = this.mapSystem.generateWastelandMap(40, 40);

    // Create player
    const player = this.entitySystem.createPlayer(
      map.spawnPoints["player"] ?? { x: 20, y: 20 },
    );

    // Create NPCs from map data
    const entities = [player];
    for (const npc of map.npcs) {
      entities.push(this.entitySystem.createNPC(npc));
    }

    // Init state
    this.state = {
      phase: "explore",
      map,
      entities,
      player,
      selectedEntity: null,
      turn: 0,
      combatQueue: [],
      activeCombatIdx: 0,
      dialogueTree: null,
      dialogueNodeId: null,
      notifications: [],
      gameTime: 8, // 8:00 AM
      vfx: [],
      combatLog: [],
      targetBodyPart: null,
      combatPending: null,
      combatTurnDelay: 0,
      lootTarget: null,
    };

    // Center camera on player
    this.camera.centerOn(player.pos);

    if (Input.isTouchDevice()) {
      this.notify("Welcome to the Wasteland. Tap to move. Use buttons for actions.", "rgb(64, 192, 64)");
    } else {
      this.notify("Welcome to the Wasteland. Click to move. [TAB] inventory, [C] combat mode.", "rgb(64, 192, 64)");
    }
  }

  start() {
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  private loop(time: number) {
    if (!this.running) return;

    const dt = time - this.lastTime;
    this.lastTime = time;

    this.update(dt);
    this.draw();

    this.input.flush();
    requestAnimationFrame((t) => this.loop(t));
  }

  private update(dt: number) {
    const { state, input, camera } = this;

    // Camera controls
    if (input.wheelDelta !== 0) {
      camera.adjustZoom(input.wheelDelta);
    }
    if (input.dragging) {
      camera.pan(input.dragDelta.x, input.dragDelta.y);
    }

    // On-screen touch button handling — intercept taps before game processes them
    const tapClick = input.leftClick();
    if (tapClick) {
      const btnKey = this.hud.handleTap(tapClick.x, tapClick.y, state.phase);
      if (btnKey) {
        input.injectKey(btnKey);
        // Clear the click so game systems don't also process it
        input.mouseClicked.set("left", null);
      }
    }

    // Keyboard shortcuts
    if (input.pressed("Tab")) {
      if (state.lootTarget) {
        state.lootTarget = null; // close loot window
      } else {
        this.togglePhase("inventory");
      }
    }
    if (input.pressed("KeyC") && state.phase !== "dialogue") {
      this.togglePhase("combat");
    }
    if (input.pressed("Escape")) {
      if (state.lootTarget) {
        state.lootTarget = null;
      } else if (state.combatPending) {
        state.combatPending = null;
        this.notify("Action cancelled.", "#d4c4a0");
      } else {
        state.phase = "explore";
        state.dialogueTree = null;
        state.dialogueNodeId = null;
        state.selectedEntity = null;
        state.combatQueue = [];
        state.targetBodyPart = null;
        state.combatPending = null;
      }
    }

    // Body part targeting keys (1-6) in combat
    if (state.phase === "combat") {
      const parts: BodyPart[] = ["head", "torso", "left_arm", "right_arm", "left_leg", "right_leg"];
      for (let i = 0; i < parts.length; i++) {
        if (input.pressed(`Digit${i + 1}`)) {
          state.targetBodyPart = state.targetBodyPart === parts[i] ? null : parts[i];
          const label = state.targetBodyPart ? BODY_PARTS[state.targetBodyPart].label : "Torso (default)";
          this.notify(`Targeting: ${label}`, "#c4703a");
        }
      }
    }

    // Hovered tile
    const worldMouse = camera.screenToTile(input.mouse);
    this.renderer.setHoveredTile(worldMouse);

    // Phase-specific updates
    switch (state.phase) {
      case "explore":
        this.updateExplore(dt);
        break;
      case "combat":
        this.updateCombat(dt);
        break;
      case "dialogue":
        this.updateDialogue();
        break;
      case "inventory":
        this.updateInventory();
        break;
    }

    // Movement (always runs for smooth animation)
    this.movementSystem.update(state, dt);

    // Animation frame cycling
    this.animationSystem.update(state, dt);

    // Camera follow player
    camera.follow(state.player.pos);
    camera.update();

    // Update notifications
    state.notifications = state.notifications
      .map((n) => ({ ...n, timeLeft: n.timeLeft - dt }))
      .filter((n) => n.timeLeft > 0);

    // Update VFX
    state.vfx = state.vfx
      .map((v) => ({ ...v, timeLeft: v.timeLeft - dt }))
      .filter((v) => v.timeLeft > 0);
  }

  private updateExplore(dt: number) {
    const { state, input, camera } = this;

    const click = input.leftClick();
    if (click) {
      const tile = camera.screenToTile(click);

      // Check if clicking on a dead body (loot)
      const corpse = state.entities.find(
        (e) => !e.isPlayer && e.dead && e.pos.x === tile.x && e.pos.y === tile.y,
      );

      if (corpse && corpse.inventory.length > 0) {
        // Walk to corpse first, then loot
        const dist = Math.abs(state.player.pos.x - tile.x) + Math.abs(state.player.pos.y - tile.y);
        if (dist <= 1) {
          this.openLoot(corpse);
        } else {
          const adj = this.movementSystem.findAdjacentTile(state.map, corpse.pos, state.player.pos);
          if (adj) {
            const path = this.movementSystem.findPath(state.map, state.player.pos, adj);
            state.player.path = path;
            const checkArrival = () => {
              if (state.player.path.length === 0) {
                this.openLoot(corpse);
              } else {
                setTimeout(checkArrival, 100);
              }
            };
            setTimeout(checkArrival, 100);
          }
        }
        return;
      }

      // Check if clicking on an NPC
      const npc = state.entities.find(
        (e) => !e.isPlayer && !e.dead && e.pos.x === tile.x && e.pos.y === tile.y,
      );

      if (npc && !npc.isHostile && npc.dialogueId) {
        // Walk to NPC first, then open dialogue
        const adj = this.movementSystem.findAdjacentTile(state.map, npc.pos, state.player.pos);
        if (adj) {
          const path = this.movementSystem.findPath(state.map, state.player.pos, adj);
          state.player.path = path;
          const checkArrival = () => {
            if (state.player.path.length === 0) {
              this.openDialogue(npc);
            } else {
              setTimeout(checkArrival, 100);
            }
          };
          setTimeout(checkArrival, 100);
        } else {
          this.openDialogue(npc);
        }
      } else if (npc && npc.isHostile) {
        this.notify(`${npc.name} is hostile! Press [C] for combat mode.`, "rgb(184, 48, 48)");
      } else {
        // Move to tile
        if (
          tile.x >= 0 &&
          tile.x < state.map.width &&
          tile.y >= 0 &&
          tile.y < state.map.height
        ) {
          const path = this.movementSystem.findPath(
            state.map,
            state.player.pos,
            tile,
          );
          if (path.length > 0) {
            state.player.path = path;
          }
        }
      }
    }

    // Check for item pickups
    const playerPos = state.player.pos;
    const itemIdx = state.map.items.findIndex(
      (i) => i.pos.x === playerPos.x && i.pos.y === playerPos.y,
    );
    if (itemIdx >= 0 && state.player.path.length === 0) {
      const item = state.map.items[itemIdx];
      const def = ITEM_DB[item.itemId];
      const name = def ? def.name : item.itemId;
      this.inventorySystem.addItem(state.player, item.itemId, item.count);
      state.map.items.splice(itemIdx, 1);
      this.notify(`Picked up: ${name} x${item.count}`, "rgb(64, 192, 64)");
    }

    // Advance game time slowly while exploring
    state.gameTime += dt / 60000; // 1 real minute = 1 game hour
    if (state.gameTime >= 24) state.gameTime -= 24;
  }

  private updateCombat(dt: number) {
    const { state, input, camera } = this;

    // Init combat if needed
    if (state.combatQueue.length === 0) {
      this.combatSystem.initCombat(state);
      this.sound.combatStart();
      this.notify("COMBAT INITIATED. Click enemies to attack. [SPACE] end turn.", "rgb(184, 48, 48)");
    }

    // Turn delay timer — prevents spam by forcing a pause between turns
    if (state.combatTurnDelay > 0) {
      state.combatTurnDelay -= dt;
      return; // don't process any actions during delay
    }

    // Current combatant
    const currentId = state.combatQueue[state.activeCombatIdx];
    const current = state.entities.find((e) => e.id === currentId);

    if (!current) {
      this.combatSystem.nextTurn(state);
      return;
    }

    if (current.isPlayer) {
      this.updatePlayerCombatTurn(current, input, camera);
    } else {
      this.updateAICombatTurn(current, dt);
    }
  }

  private updatePlayerCombatTurn(player: Entity, input: Input, camera: Camera) {
    const { state } = this;

    // End turn
    if (input.pressed("Space")) {
      state.combatPending = null;
      this.combatSystem.nextTurn(state);
      this.notify("Turn ended.", "rgb(212, 196, 160)");
      return;
    }

    const click = input.leftClick();
    if (!click) return;

    const tile = camera.screenToTile(click);

    // Check if clicking on an enemy
    const target = state.entities.find(
      (e) => !e.isPlayer && !e.dead && e.pos.x === tile.x && e.pos.y === tile.y,
    );

    if (target) {
      const apCost = this.combatSystem.getWeaponApCost(player);
      const bodyPart = state.targetBodyPart ?? "torso";
      const range = this.combatSystem.getWeaponRange(player);
      const dist = Math.abs(player.pos.x - target.pos.x) + Math.abs(player.pos.y - target.pos.y);

      // Check range
      if (dist > range) {
        this.notify(`Out of range! Need ${range} tiles, target is ${dist} away.`, "#b83030");
        return;
      }

      // Check AP
      if (player.stats.ap < apCost) {
        this.notify(`Not enough AP! Need ${apCost}, have ${player.stats.ap}.`, "#b83030");
        return;
      }

      // If we have a pending attack on the same target, confirm it
      if (
        state.combatPending &&
        state.combatPending.type === "attack" &&
        state.combatPending.targetEntity === target &&
        state.combatPending.bodyPart === bodyPart
      ) {
        // CONFIRMED — execute the attack
        this.executePlayerAttack(player, target, bodyPart);
        state.combatPending = null;
        return;
      }

      // First click — show AP cost preview, require second click to confirm
      const partLabel = BODY_PARTS[bodyPart].label;
      const hitMod = BODY_PARTS[bodyPart].hitMod;
      const hitPct = Math.round(hitMod * 100);
      state.combatPending = {
        type: "attack",
        targetTile: { x: tile.x, y: tile.y },
        targetEntity: target,
        apCost,
        bodyPart,
      };
      this.notify(
        `Attack ${target.name}'s ${partLabel}? (${apCost} AP, ~${hitPct}% accuracy) Click again to confirm.`,
        "#c4703a",
      );
    } else {
      // Clicking empty ground — movement preview/confirm
      if (
        tile.x < 0 || tile.x >= state.map.width ||
        tile.y < 0 || tile.y >= state.map.height
      ) return;

      const path = this.movementSystem.findPath(state.map, player.pos, tile);
      if (path.length === 0) return;

      const moveCost = this.combatSystem.getMoveCost(player);
      const maxSteps = Math.min(path.length, Math.floor(player.stats.ap / moveCost));

      if (maxSteps === 0) {
        this.notify("Not enough AP to move!", "#b83030");
        return;
      }

      const totalAP = maxSteps * moveCost;

      // If pending move to same tile, confirm it
      if (
        state.combatPending &&
        state.combatPending.type === "move" &&
        state.combatPending.targetTile.x === tile.x &&
        state.combatPending.targetTile.y === tile.y
      ) {
        // CONFIRMED — execute movement
        player.path = path.slice(0, maxSteps);
        player.stats.ap -= totalAP;
        state.combatPending = null;
        state.combatLog.push({
          text: `You move ${maxSteps} tile${maxSteps > 1 ? "s" : ""} (${totalAP} AP).`,
          color: "#d4c4a0",
          turn: state.turn,
        });
        return;
      }

      // First click — show preview
      state.combatPending = {
        type: "move",
        targetTile: { x: tile.x, y: tile.y },
        apCost: totalAP,
      };
      this.notify(
        `Move ${maxSteps} tile${maxSteps > 1 ? "s" : ""}? (${totalAP} AP) Click again to confirm.`,
        "#c4703a",
      );
    }
  }

  private executePlayerAttack(player: Entity, target: Entity, bodyPart: BodyPart) {
    const { state } = this;

    this.animationSystem.triggerAttack(player);
    const result = this.combatSystem.attack(state, player, target, bodyPart);
    this.spawnAttackVFX(player, target, result);
    this.notify(result.message, result.hit ? "rgb(184, 48, 48)" : "rgb(212, 196, 160)");

    // Log to combat log
    state.combatLog.push({
      text: result.message,
      color: result.hit ? "#b83030" : "#999999",
      turn: state.turn,
    });

    if (result.crippled) {
      const effectMsg = this.getCrippleEffectMsg(result.crippled);
      state.combatLog.push({ text: effectMsg, color: "#ff6600", turn: state.turn });
      this.notify(effectMsg, "#ff6600");
    }

    if (result.severed) {
      state.combatLog.push({
        text: `${target.name}'s ${BODY_PARTS[bodyPart].label} has been severed!`,
        color: "#ff0000",
        turn: state.turn,
      });
      // Extra gore for severed limb
      this.spawnSeverVFX(target);
    }

    if (target.dead) {
      this.notify(`${target.name} has been killed!`, "rgb(184, 48, 48)");
      state.combatLog.push({
        text: `${target.name} is dead.`,
        color: "#b83030",
        turn: state.turn,
      });
    }

    // Check combat end
    const hostiles = state.entities.filter((e) => e.isHostile && !e.dead);
    if (hostiles.length === 0) {
      state.phase = "explore";
      state.combatQueue = [];
      state.combatPending = null;
      state.targetBodyPart = null;
      this.notify("All enemies defeated! Search bodies for loot.", "rgb(64, 192, 64)");
    }
  }

  private updateAICombatTurn(npc: Entity, dt: number) {
    const { state } = this;

    // Pace AI actions with a timer
    this.aiActionTimer -= dt;
    if (this.aiActionTimer > 0) return;

    // AI does one action at a time with delays between them
    const playerHpBefore = state.player.stats.hp;
    const didAct = this.combatSystem.aiAct(state, npc);

    if (didAct) {
      const dmg = playerHpBefore - state.player.stats.hp;
      if (dmg > 0) {
        this.animationSystem.triggerAttack(npc);
        // Find the last combat log entry for the attack result details
        const lastLog = state.combatLog[state.combatLog.length - 1];
        const isCrit = lastLog?.text.includes("CRITICAL") ?? false;
        const crippled = lastLog?.text.includes("CRIPPLED") ? true : false;
        // Create a synthetic result for VFX
        this.spawnAttackVFX(npc, state.player, {
          hit: true,
          damage: dmg,
          message: "",
          crit: isCrit,
          crippled: crippled ? "torso" : undefined,
          severed: lastLog?.text.includes("SEVERED"),
        });
      }

      // Set delay before next AI action
      this.aiActionTimer = this.AI_ACTION_DELAY;

      // Check if player died
      if (state.player.dead) {
        this.notify("You have been killed. Game Over.", "#ff0000");
        state.phase = "explore";
        state.combatQueue = [];
        return;
      }
    } else {
      // AI has no more actions — end their turn
      this.combatSystem.nextTurn(state);
      this.aiActionTimer = 0;
    }
  }

  private updateDialogue() {
    // Handled by DialogueUI click events
  }

  private updateInventory() {
    // Handled by InventoryUI
  }

  private openDialogue(npc: Entity) {
    const tree = this.dialogueSystem.getDialogue(npc.dialogueId!);
    if (tree) {
      this.state.phase = "dialogue";
      this.state.dialogueTree = tree;
      this.state.dialogueNodeId = tree.startNodeId;
      this.state.selectedEntity = npc;
    }
  }

  private openLoot(corpse: Entity) {
    this.state.lootTarget = corpse;
    this.notify(`Searching ${corpse.name}'s body...`, "#c4703a");
  }

  /** Transfer an item from loot target to player */
  lootItem(itemId: string) {
    const { state } = this;
    if (!state.lootTarget) return;

    const invItem = state.lootTarget.inventory.find((i) => i.itemId === itemId);
    if (!invItem) return;

    this.inventorySystem.addItem(state.player, itemId, invItem.count);
    state.lootTarget.inventory = state.lootTarget.inventory.filter((i) => i.itemId !== itemId);

    const def = ITEM_DB[itemId];
    const name = def ? def.name : itemId;
    this.notify(`Looted: ${name} x${invItem.count}`, "rgb(64, 192, 64)");

    // Close loot window if body is empty
    if (state.lootTarget.inventory.length === 0) {
      this.notify("Body is empty.", "#6e6e5e");
      state.lootTarget = null;
    }
  }

  /** Take all items from loot target */
  lootAll() {
    const { state } = this;
    if (!state.lootTarget) return;

    for (const item of [...state.lootTarget.inventory]) {
      this.inventorySystem.addItem(state.player, item.itemId, item.count);
    }
    const count = state.lootTarget.inventory.length;
    state.lootTarget.inventory = [];
    this.notify(`Looted ${count} item${count > 1 ? "s" : ""}.`, "rgb(64, 192, 64)");
    state.lootTarget = null;
  }

  selectDialogueResponse(index: number) {
    const { state } = this;
    if (!state.dialogueTree || !state.dialogueNodeId) return;

    const node = state.dialogueTree.nodes[state.dialogueNodeId];
    if (!node || index >= node.responses.length) return;

    const response = node.responses[index];

    // Handle item give/take
    if (response.giveItem) {
      this.inventorySystem.addItem(state.player, response.giveItem, 1);
      this.notify(`Received: ${response.giveItem}`, "rgb(64, 192, 64)");
    }
    if (response.removeItem) {
      this.inventorySystem.removeItem(state.player, response.removeItem, 1);
    }

    if (response.nextNodeId === null) {
      // End dialogue
      state.phase = "explore";
      state.dialogueTree = null;
      state.dialogueNodeId = null;
      state.selectedEntity = null;
    } else {
      state.dialogueNodeId = response.nextNodeId;
    }
  }

  useItem(itemId: string) {
    this.inventorySystem.useItem(this.state, itemId);
  }

  private togglePhase(phase: GamePhase) {
    if (this.state.phase === phase) {
      this.state.phase = "explore";
    } else {
      this.state.phase = phase;
    }
  }

  notify(text: string, color: string) {
    this.state.notifications.unshift({ text, color, timeLeft: 4000 });
    if (this.state.notifications.length > 5) {
      this.state.notifications.pop();
    }
  }

  private getCrippleEffectMsg(part: BodyPart): string {
    switch (part) {
      case "head": return "Target blinded! Accuracy severely reduced.";
      case "left_arm":
      case "right_arm": return "Arm crippled! Attack damage reduced.";
      case "left_leg":
      case "right_leg": return "Leg crippled! Movement costs 2 AP per step.";
      default: return "";
    }
  }

  private draw() {
    const { ctx } = this.canvas.getContext("2d")
      ? { ctx: this.canvas.getContext("2d")! }
      : { ctx: null as never };

    this.renderer.render(this.state);

    // Draw UI overlay
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    this.hud.draw(ctx, this.state, this.canvas.width, this.canvas.height);

    if (this.state.phase === "dialogue") {
      this.dialogueUI.draw(ctx, this.state, this.canvas.width, this.canvas.height, this);
    }

    if (this.state.phase === "inventory") {
      this.inventoryUI.draw(ctx, this.state, this.canvas.width, this.canvas.height, this);
    }

    if (this.state.phase === "combat") {
      this.drawCombatUI(ctx);
    }

    // Loot overlay (can appear in any phase)
    if (this.state.lootTarget) {
      this.drawLootUI(ctx);
    }
  }

  private spawnAttackVFX(
    attacker: Entity,
    target: Entity,
    result: { hit: boolean; damage: number; crit: boolean; crippled?: BodyPart; severed?: boolean; message: string },
  ) {
    const ax = (attacker.pos.x - attacker.pos.y) * TILE_HALF_W;
    const ay = (attacker.pos.x + attacker.pos.y) * TILE_HALF_H;
    const tx = (target.pos.x - target.pos.y) * TILE_HALF_W;
    const ty = (target.pos.x + target.pos.y) * TILE_HALF_H;

    const isRanged = this.combatSystem.isRangedWeapon(attacker);
    const damage = result.damage;
    const isCrit = result.crit;
    const killed = target.dead;

    // --- Weapon effect (projectile or slash) ---
    this.state.vfx.push({
      type: isRanged ? "projectile" : "slash",
      fromX: ax, fromY: ay - 12,
      toX: tx, toY: ty - 12,
      color: isRanged ? "#ffcc44" : "#cccccc",
      timeLeft: 300,
      duration: 300,
    });

    // --- Sound ---
    if (isRanged) {
      this.sound.gunshot();
    } else {
      this.sound.slash();
    }

    if (result.hit) {
      // Impact sound (scales with damage)
      setTimeout(() => this.sound.impact(damage), isRanged ? 80 : 50);

      if (isCrit) {
        setTimeout(() => this.sound.critical(), 100);
      }

      // --- Hit flash ---
      this.state.vfx.push({
        type: "hit_flash",
        fromX: tx, fromY: ty - 12,
        toX: tx, toY: ty - 12,
        color: isCrit ? "#ff2222" : "#ff6644",
        timeLeft: 150 + damage * 5,
        duration: 150 + damage * 5,
        intensity: damage,
      });

      // --- Blood burst (scales with damage) ---
      const particleCount = Math.min(25, 4 + damage * 1.5);
      const bloodParticles = [];
      for (let i = 0; i < particleCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 15 + Math.random() * 25 + damage;
        bloodParticles.push({
          dx: Math.cos(angle) * (0.5 + Math.random()),
          dy: Math.sin(angle) * (0.5 + Math.random()) - 0.5,
          size: 1 + Math.random() * (1.5 + damage * 0.15),
          speed,
        });
      }
      this.state.vfx.push({
        type: "blood_burst",
        fromX: tx, fromY: ty - 12,
        toX: tx, toY: ty,
        color: "#8b0000",
        timeLeft: 400 + damage * 20,
        duration: 400 + damage * 20,
        intensity: damage,
        particles: bloodParticles,
      });

      // Second burst for heavy hits
      if (damage >= 8) {
        const burst2 = [];
        for (let i = 0; i < Math.min(12, damage); i++) {
          const angle = Math.random() * Math.PI * 2;
          burst2.push({
            dx: Math.cos(angle) * (0.3 + Math.random()),
            dy: Math.sin(angle) * (0.3 + Math.random()) - 0.3,
            size: 0.8 + Math.random() * 1.5,
            speed: 20 + Math.random() * 15,
          });
        }
        this.state.vfx.push({
          type: "blood_burst",
          fromX: tx + (Math.random() - 0.5) * 6,
          fromY: ty - 10 + (Math.random() - 0.5) * 4,
          toX: tx, toY: ty,
          color: "#cc1111",
          timeLeft: 350 + damage * 15,
          duration: 350 + damage * 15,
          particles: burst2,
        });
      }

      // --- Gore chunks for critical/heavy damage ---
      if (isCrit || damage >= 12) {
        const chunkCount = Math.min(6, Math.floor(damage / 4));
        const chunks = [];
        for (let i = 0; i < chunkCount; i++) {
          const angle = Math.random() * Math.PI * 2;
          chunks.push({
            dx: Math.cos(angle) * (0.5 + Math.random() * 0.8),
            dy: Math.sin(angle) * (0.5 + Math.random() * 0.5) - 0.8,
            size: 2 + Math.random() * 3,
            speed: 20 + Math.random() * 20,
          });
        }
        this.state.vfx.push({
          type: "gore_chunk",
          fromX: tx, fromY: ty - 14,
          toX: tx, toY: ty,
          color: "#660000",
          timeLeft: 600,
          duration: 600,
          intensity: damage,
          particles: chunks,
        });
      }

      // --- Screen shake (scales with damage) ---
      if (damage >= 5) {
        const shakeIntensity = Math.min(8, 1 + damage * 0.4);
        const shakeDuration = Math.min(400, 100 + damage * 15);
        this.camera.shake(shakeIntensity, shakeDuration);
      }

      // --- Floating damage number ---
      const bodyPartLabel = result.crippled ? ` [${BODY_PARTS[result.crippled].label}]` : "";
      this.state.vfx.push({
        type: "damage_number",
        fromX: tx, fromY: ty - 24,
        toX: tx, toY: ty - 65,
        text: isCrit ? `CRIT -${damage}!${bodyPartLabel}` : `-${damage}${bodyPartLabel}`,
        color: isCrit ? "#ff0000" : damage >= 10 ? "#ff4444" : "#ffcc44",
        timeLeft: 1000,
        duration: 1000,
        intensity: damage,
      });

      // --- Cripple text ---
      if (result.crippled) {
        this.state.vfx.push({
          type: "damage_number",
          fromX: tx + 10, fromY: ty - 10,
          toX: tx + 10, toY: ty - 45,
          text: `${BODY_PARTS[result.crippled].label} CRIPPLED!`,
          color: "#ff6600",
          timeLeft: 1200,
          duration: 1200,
          intensity: 10,
        });
      }

      // --- Death effects ---
      if (killed) {
        setTimeout(() => this.sound.death(), 150);

        this.camera.shake(6, 350);

        // Blood pool under corpse
        this.state.vfx.push({
          type: "blood_pool",
          fromX: tx, fromY: ty,
          toX: tx, toY: ty,
          color: "#4a0000",
          timeLeft: 5000,
          duration: 5000,
          intensity: damage,
        });

        // Death burst
        const deathParticles = [];
        for (let i = 0; i < 20; i++) {
          const angle = Math.random() * Math.PI * 2;
          deathParticles.push({
            dx: Math.cos(angle) * (0.5 + Math.random()),
            dy: Math.sin(angle) * (0.3 + Math.random()) - 0.6,
            size: 1.5 + Math.random() * 2.5,
            speed: 25 + Math.random() * 30,
          });
        }
        this.state.vfx.push({
          type: "blood_burst",
          fromX: tx, fromY: ty - 8,
          toX: tx, toY: ty,
          color: "#990000",
          timeLeft: 700,
          duration: 700,
          intensity: 20,
          particles: deathParticles,
        });

        // Gore chunks on death
        const deathChunks = [];
        for (let i = 0; i < 4; i++) {
          const angle = Math.random() * Math.PI * 2;
          deathChunks.push({
            dx: Math.cos(angle) * (0.6 + Math.random()),
            dy: Math.sin(angle) * (0.4 + Math.random()) - 1.0,
            size: 2.5 + Math.random() * 3,
            speed: 18 + Math.random() * 25,
          });
        }
        this.state.vfx.push({
          type: "gore_chunk",
          fromX: tx, fromY: ty - 10,
          toX: tx, toY: ty,
          color: "#551111",
          timeLeft: 800,
          duration: 800,
          particles: deathChunks,
        });

        // "KILLED" text
        this.state.vfx.push({
          type: "damage_number",
          fromX: tx, fromY: ty - 35,
          toX: tx, toY: ty - 75,
          text: "KILLED",
          color: "#ff0000",
          timeLeft: 1200,
          duration: 1200,
          intensity: 20,
        });
      }
    } else {
      // --- Miss ---
      this.sound.miss();

      this.state.vfx.push({
        type: "damage_number",
        fromX: tx, fromY: ty - 24,
        toX: tx, toY: ty - 50,
        text: "MISS",
        color: "#999999",
        timeLeft: 600,
        duration: 600,
      });
    }
  }

  /** Extra gore VFX for severed limbs */
  private spawnSeverVFX(target: Entity) {
    const tx = (target.pos.x - target.pos.y) * TILE_HALF_W;
    const ty = (target.pos.x + target.pos.y) * TILE_HALF_H;

    this.camera.shake(8, 500);

    // Big blood spray
    const chunks = [];
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      chunks.push({
        dx: Math.cos(angle) * (0.8 + Math.random()),
        dy: Math.sin(angle) * (0.5 + Math.random()) - 1.2,
        size: 3 + Math.random() * 4,
        speed: 25 + Math.random() * 30,
      });
    }
    this.state.vfx.push({
      type: "gore_chunk",
      fromX: tx, fromY: ty - 12,
      toX: tx, toY: ty,
      color: "#880000",
      timeLeft: 1000,
      duration: 1000,
      intensity: 25,
      particles: chunks,
    });

    // "SEVERED!" text
    this.state.vfx.push({
      type: "damage_number",
      fromX: tx - 10, fromY: ty - 5,
      toX: tx - 10, toY: ty - 50,
      text: "SEVERED!",
      color: "#ff0000",
      timeLeft: 1500,
      duration: 1500,
      intensity: 20,
    });
  }

  private drawCombatUI(ctx: CanvasRenderingContext2D) {
    const { state } = this;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Top bar
    ctx.fillStyle = "rgba(184, 48, 48, 0.15)";
    ctx.fillRect(0, 0, w, 36);

    ctx.fillStyle = "#b83030";
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "center";
    ctx.fillText("[ COMBAT MODE ]", w / 2, 14);

    const weapon = state.player.inventory.find((i) => i.equipped);
    const weaponDef = weapon ? ITEM_DB[weapon.itemId] : null;
    const weaponName = weaponDef ? weaponDef.name : "Fists";
    const range = this.combatSystem.getWeaponRange(state.player);
    const apCost = this.combatSystem.getWeaponApCost(state.player);
    const bodyPart = state.targetBodyPart ?? "torso";
    const partLabel = BODY_PARTS[bodyPart].label;

    const isTouchDev = Input.isTouchDevice();
    const hint = isTouchDev
      ? `AP: ${state.player.stats.ap}/${state.player.stats.maxAp}  |  ${weaponName} (${apCost}AP, rng:${range})  |  Target: ${partLabel}`
      : `AP: ${state.player.stats.ap}/${state.player.stats.maxAp}  |  ${weaponName} (${apCost}AP, rng:${range})  |  Target: ${partLabel}  |  [1-6] body part  [SPACE] end`;

    ctx.font = "12px monospace";
    ctx.fillStyle = "#d4c4a0";
    ctx.fillText(hint, w / 2, 30);

    // Pending action indicator
    if (state.combatPending) {
      const pendText = state.combatPending.type === "attack"
        ? `CONFIRM ATTACK (${state.combatPending.apCost} AP) — Click again or [ESC] cancel`
        : `CONFIRM MOVE (${state.combatPending.apCost} AP) — Click again or [ESC] cancel`;
      ctx.fillStyle = "rgba(196, 112, 58, 0.2)";
      ctx.fillRect(0, 36, w, 20);
      ctx.fillStyle = "#c4703a";
      ctx.font = "bold 11px monospace";
      ctx.fillText(pendText, w / 2, 50);
    }

    // Body part selector (bottom of screen)
    this.drawBodyPartSelector(ctx, w, h);

    // Combat log (left side)
    this.drawCombatLog(ctx, h);
  }

  private drawBodyPartSelector(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const { state } = this;
    const parts: BodyPart[] = ["head", "torso", "left_arm", "right_arm", "left_leg", "right_leg"];
    const selected = state.targetBodyPart ?? "torso";

    const btnW = 70;
    const btnH = 24;
    const gap = 4;
    const totalW = parts.length * (btnW + gap) - gap;
    const startX = (w - totalW) / 2;
    const startY = h - 130;

    // Label
    ctx.fillStyle = "#d4c4a0";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.fillText("TARGET BODY PART [1-6]", w / 2, startY - 6);

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const mod = BODY_PARTS[part];
      const bx = startX + i * (btnW + gap);
      const isSelected = part === selected;

      // Button background
      ctx.fillStyle = isSelected ? "rgba(184, 48, 48, 0.4)" : "rgba(30, 30, 22, 0.85)";
      ctx.fillRect(bx, startY, btnW, btnH);

      // Border
      ctx.strokeStyle = isSelected ? "#b83030" : "#6e6e5e";
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.strokeRect(bx, startY, btnW, btnH);

      // Label
      ctx.fillStyle = isSelected ? "#ff6644" : "#d4c4a0";
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      ctx.fillText(`${i + 1}:${mod.label}`, bx + btnW / 2, startY + 10);

      // Hit chance modifier
      ctx.fillStyle = "#8ec44a";
      ctx.font = "8px monospace";
      ctx.fillText(`${Math.round(mod.hitMod * 100)}%`, bx + btnW / 2, startY + 20);
    }
  }

  private drawCombatLog(ctx: CanvasRenderingContext2D, h: number) {
    const { state } = this;
    const log = state.combatLog;
    if (log.length === 0) return;

    const logX = 10;
    const logW = 320;
    const lineH = 14;
    const maxLines = 12;
    const visibleLog = log.slice(-maxLines);
    const logH = visibleLog.length * lineH + 20;
    const logY = h - 160 - logH;

    // Background panel
    ctx.fillStyle = "rgba(20, 20, 16, 0.8)";
    ctx.fillRect(logX, logY, logW, logH);
    ctx.strokeStyle = "rgba(64, 192, 64, 0.3)";
    ctx.lineWidth = 1;
    ctx.strokeRect(logX, logY, logW, logH);

    // Title
    ctx.fillStyle = "#40c040";
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "left";
    ctx.fillText("COMBAT LOG", logX + 5, logY + 11);

    // Entries
    ctx.font = "9px monospace";
    for (let i = 0; i < visibleLog.length; i++) {
      const entry = visibleLog[i];
      ctx.fillStyle = entry.color;
      // Truncate long lines
      const text = entry.text.length > 45 ? entry.text.substring(0, 42) + "..." : entry.text;
      ctx.fillText(text, logX + 5, logY + 24 + i * lineH);
    }
  }

  private drawLootUI(ctx: CanvasRenderingContext2D) {
    const { state } = this;
    const target = state.lootTarget;
    if (!target) return;

    const w = this.canvas.width;
    const h = this.canvas.height;
    const pw = Math.min(350, w - 20);
    const itemH = 32;
    const headerH = 50;
    const footerH = 40;
    const ph = Math.min(headerH + target.inventory.length * itemH + footerH + 20, h - 40);
    const px = (w - pw) / 2;
    const py = (h - ph) / 2;

    // Background
    ctx.fillStyle = "rgba(20, 20, 16, 0.95)";
    ctx.fillRect(px, py, pw, ph);

    // Border
    ctx.strokeStyle = "#c4703a";
    ctx.lineWidth = 2;
    ctx.strokeRect(px, py, pw, ph);

    // Title
    ctx.fillStyle = "#c4703a";
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`LOOT: ${target.name}`, px + pw / 2, py + 25);

    // Divider
    ctx.strokeStyle = "rgba(196, 112, 58, 0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px + 10, py + 40);
    ctx.lineTo(px + pw - 10, py + 40);
    ctx.stroke();

    // Items
    ctx.textAlign = "left";
    for (let i = 0; i < target.inventory.length; i++) {
      const item = target.inventory[i];
      const def = ITEM_DB[item.itemId];
      const iy = py + headerH + i * itemH;

      // Hover check
      const mx = InventoryUI._mouseX;
      const my = InventoryUI._mouseY;
      const isHovered = mx >= px && mx <= px + pw && my >= iy && my < iy + itemH;

      if (isHovered) {
        ctx.fillStyle = "rgba(196, 112, 58, 0.15)";
        ctx.fillRect(px + 5, iy, pw - 10, itemH);
      }

      ctx.fillStyle = "#d4c4a0";
      ctx.font = "12px monospace";
      ctx.fillText(def ? def.name : item.itemId, px + 15, iy + 15);

      if (item.count > 1) {
        ctx.fillStyle = "#8ec44a";
        ctx.font = "10px monospace";
        ctx.fillText(`x${item.count}`, px + 15, iy + 28);
      }

      // Value on right
      if (def) {
        ctx.textAlign = "right";
        ctx.fillStyle = "#6e6e5e";
        ctx.font = "10px monospace";
        ctx.fillText(`${def.value} caps`, px + pw - 15, iy + 15);
        ctx.textAlign = "left";
      }
    }

    // Footer
    ctx.fillStyle = "rgba(212, 196, 160, 0.5)";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.fillText("Click item to take  |  [ESC] close", px + pw / 2, py + ph - 12);

    this.ensureLootClickHandler();
  }

  private lootClickBound = false;
  private ensureLootClickHandler() {
    if (this.lootClickBound) return;
    this.lootClickBound = true;

    const handler = (clientX: number, clientY: number) => {
      const { state } = this;
      if (!state.lootTarget) return;

      const w = this.canvas.width;
      const h = this.canvas.height;
      const pw = Math.min(350, w - 20);
      const itemH = 32;
      const headerH = 50;
      const footerH = 40;
      const ph = Math.min(headerH + state.lootTarget.inventory.length * itemH + footerH + 20, h - 40);
      const px = (w - pw) / 2;
      const py = (h - ph) / 2;

      if (clientX < px || clientX > px + pw || clientY < py || clientY > py + ph) return;

      for (let i = 0; i < state.lootTarget.inventory.length; i++) {
        const iy = py + headerH + i * itemH;
        if (clientY >= iy && clientY < iy + itemH) {
          this.lootItem(state.lootTarget.inventory[i].itemId);
          return;
        }
      }
    };

    window.addEventListener("click", (e) => handler(e.clientX, e.clientY));
    window.addEventListener("touchend", (e) => {
      if (e.changedTouches.length > 0) {
        const t = e.changedTouches[0];
        handler(t.clientX, t.clientY);
      }
    }, { passive: true });
  }
}
