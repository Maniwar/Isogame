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
import { GameState, GamePhase, Entity } from "../types";

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

    window.addEventListener("resize", () => this.renderer.resize());
  }

  async init() {
    this.renderer.resize();

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
    };

    // Center camera on player
    this.camera.centerOn(player.pos);

    this.notify("Welcome to the Wasteland. Click to move. [TAB] inventory, [C] combat mode.", "rgb(64, 192, 64)");
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
      // AI turn
      this.combatSystem.aiTurn(state, current);
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

  private drawCombatUI(ctx: CanvasRenderingContext2D) {
    const { state } = this;
    const w = this.canvas.width;

    ctx.fillStyle = "rgba(184, 48, 48, 0.15)";
    ctx.fillRect(0, 0, w, 36);

    ctx.fillStyle = "#b83030";
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "center";
    ctx.fillText("[ COMBAT MODE ]", w / 2, 14);

    ctx.font = "12px monospace";
    ctx.fillStyle = "#d4c4a0";
    ctx.fillText(
      `AP: ${state.player.stats.ap} / ${state.player.stats.maxAp}  |  [CLICK] attack  [SPACE] end turn  [ESC] flee`,
      w / 2,
      30,
    );
  }
}
