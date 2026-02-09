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
import { InventorySystem } from "../systems/InventorySystem";
import { HUD } from "../ui/HUD";
import { DialogueUI } from "../ui/DialogueUI";
import { InventoryUI } from "../ui/InventoryUI";
import { Sound } from "./Sound";
import { GameState, GamePhase, Entity, TILE_HALF_W, TILE_HALF_H } from "../types";

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
      this.togglePhase("inventory");
    }
    if (input.pressed("KeyC") && state.phase !== "dialogue") {
      this.togglePhase("combat");
    }
    if (input.pressed("Escape")) {
      state.phase = "explore";
      state.dialogueTree = null;
      state.dialogueNodeId = null;
      state.selectedEntity = null;
      state.combatQueue = [];
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
          // Queue dialogue after arriving
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
      this.inventorySystem.addItem(state.player, item.itemId, item.count);
      state.map.items.splice(itemIdx, 1);
      this.notify(`Picked up: ${item.itemId} x${item.count}`, "rgb(64, 192, 64)");
    }

    // Advance game time slowly while exploring
    state.gameTime += dt / 60000; // 1 real minute = 1 game hour
    if (state.gameTime >= 24) state.gameTime -= 24;
  }

  private updateCombat(_dt: number) {
    const { state, input, camera } = this;

    // Init combat if needed
    if (state.combatQueue.length === 0) {
      this.combatSystem.initCombat(state);
      this.sound.combatStart();
      this.notify("COMBAT INITIATED. Click enemies to attack. [SPACE] end turn.", "rgb(184, 48, 48)");
    }

    // Player's turn
    const currentId = state.combatQueue[state.activeCombatIdx];
    const current = state.entities.find((e) => e.id === currentId);

    if (!current) {
      this.combatSystem.nextTurn(state);
      return;
    }

    if (current.isPlayer) {
      // End turn
      if (input.pressed("Space")) {
        this.combatSystem.nextTurn(state);
        this.notify("Turn ended.", "rgb(212, 196, 160)");
        return;
      }

      const click = input.leftClick();
      if (click) {
        const tile = camera.screenToTile(click);
        const target = state.entities.find(
          (e) => !e.isPlayer && !e.dead && e.pos.x === tile.x && e.pos.y === tile.y,
        );

        if (target) {
          this.animationSystem.triggerAttack(current);
          const result = this.combatSystem.attack(state, current, target);
          this.spawnAttackVFX(current, target, result.hit, result.damage);
          this.notify(result.message, result.hit ? "rgb(184, 48, 48)" : "rgb(212, 196, 160)");

          if (target.dead) {
            this.notify(`${target.name} has been killed!`, "rgb(184, 48, 48)");
            // Drop loot
            for (const item of target.inventory) {
              state.map.items.push({
                itemId: item.itemId,
                pos: { ...target.pos },
                count: item.count,
              });
            }
          }

          // Check combat end
          const hostiles = state.entities.filter((e) => e.isHostile && !e.dead);
          if (hostiles.length === 0) {
            state.phase = "explore";
            state.combatQueue = [];
            this.notify("All enemies defeated! Returning to exploration.", "rgb(64, 192, 64)");
          }
        } else {
          // Move in combat (costs AP)
          if (current.stats.ap > 0) {
            const path = this.movementSystem.findPath(state.map, current.pos, tile);
            const maxSteps = Math.min(path.length, current.stats.ap);
            current.path = path.slice(0, maxSteps);
            current.stats.ap -= maxSteps;
          }
        }
      }
    } else {
      // AI turn — track HP before to detect hits
      const playerHpBefore = state.player.stats.hp;
      this.combatSystem.aiTurn(state, current);

      // Spawn VFX for AI attacks on player
      const dmg = playerHpBefore - state.player.stats.hp;
      if (dmg > 0) {
        this.animationSystem.triggerAttack(current);
        this.spawnAttackVFX(current, state.player, true, dmg);
      }

      this.combatSystem.nextTurn(state);
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
  }

  private spawnAttackVFX(attacker: Entity, target: Entity, hit: boolean, damage: number) {
    const ax = (attacker.pos.x - attacker.pos.y) * TILE_HALF_W;
    const ay = (attacker.pos.x + attacker.pos.y) * TILE_HALF_H;
    const tx = (target.pos.x - target.pos.y) * TILE_HALF_W;
    const ty = (target.pos.x + target.pos.y) * TILE_HALF_H;

    const weapon = attacker.inventory.find((i) => i.equipped);
    const isRanged = weapon && (weapon.itemId === "10mm_pistol" || weapon.itemId === "pipe_rifle");
    const isCrit = damage >= 15;
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

    if (hit) {
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

      // Second burst in brighter red for heavy hits
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
      this.state.vfx.push({
        type: "damage_number",
        fromX: tx, fromY: ty - 24,
        toX: tx, toY: ty - 65,
        text: isCrit ? `CRIT -${damage}!` : `-${damage}`,
        color: isCrit ? "#ff0000" : damage >= 10 ? "#ff4444" : "#ffcc44",
        timeLeft: 1000,
        duration: 1000,
        intensity: damage,
      });

      // --- Death effects ---
      if (killed) {
        setTimeout(() => this.sound.death(), 150);

        // Big screen shake
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

        // Death burst — extra blood spray
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

  private drawCombatUI(ctx: CanvasRenderingContext2D) {
    const { state } = this;
    const w = this.canvas.width;

    ctx.fillStyle = "rgba(184, 48, 48, 0.15)";
    ctx.fillRect(0, 0, w, 36);

    ctx.fillStyle = "#b83030";
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "center";
    ctx.fillText("[ COMBAT MODE ]", w / 2, 14);

    const weapon = state.player.inventory.find((i) => i.equipped);
    const weaponName = weapon ? weapon.itemId.replace(/_/g, " ") : "Fists";
    const isTouchDev = Input.isTouchDevice();
    const hint = isTouchDev
      ? `AP: ${state.player.stats.ap}/${state.player.stats.maxAp}  |  ${weaponName}  |  Tap enemy to attack`
      : `AP: ${state.player.stats.ap}/${state.player.stats.maxAp}  |  ${weaponName}  |  Click enemy  [SPACE] end turn  [ESC] flee`;

    ctx.font = "12px monospace";
    ctx.fillStyle = "#d4c4a0";
    ctx.fillText(hint, w / 2, 30);
  }
}
