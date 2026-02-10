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
import { GameState, GamePhase, Entity, BodyPart, BODY_PARTS, CombatAction, TILE_HALF_W, TILE_HALF_H } from "../types";

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
  private readonly AI_ACTION_DELAY = 500;

  // Queue execution pacing
  private queueExecTimer = 0;
  private readonly QUEUE_EXEC_DELAY = 400;

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
    await this.assets.init();

    const map = this.mapSystem.generateWastelandMap(40, 40);
    const player = this.entitySystem.createPlayer(
      map.spawnPoints["player"] ?? { x: 20, y: 20 },
    );

    const entities = [player];
    for (const npc of map.npcs) {
      entities.push(this.entitySystem.createNPC(npc));
    }

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
      gameTime: 8,
      vfx: [],
      combatLog: [],
      targetBodyPart: null,
      combatActionQueue: [],
      combatExecuting: false,
      combatTurnDelay: 0,
      lootTarget: null,
      bodyPartPanelOpen: false,
    };

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

    if (input.wheelDelta !== 0) camera.adjustZoom(input.wheelDelta);
    if (input.dragging) camera.pan(input.dragDelta.x, input.dragDelta.y);

    // Touch button handling
    const tapClick = input.leftClick();
    if (tapClick) {
      const btnKey = this.hud.handleTap(tapClick.x, tapClick.y, state.phase);
      if (btnKey) {
        input.injectKey(btnKey);
        input.mouseClicked.set("left", null);
      }
    }

    // Keyboard shortcuts
    if (input.pressed("Tab")) {
      if (state.lootTarget) {
        state.lootTarget = null;
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
      } else if (state.bodyPartPanelOpen) {
        state.bodyPartPanelOpen = false;
      } else if (state.combatActionQueue.length > 0 && !state.combatExecuting) {
        state.combatActionQueue = [];
        this.notify("Queue cleared.", "#d4c4a0");
      } else {
        state.phase = "explore";
        state.dialogueTree = null;
        state.dialogueNodeId = null;
        state.selectedEntity = null;
        state.combatQueue = [];
        state.targetBodyPart = null;
        state.combatActionQueue = [];
        state.combatExecuting = false;
        state.bodyPartPanelOpen = false;
      }
    }

    // Body part targeting keys (1-6) in combat
    if (state.phase === "combat") {
      const parts: BodyPart[] = ["head", "torso", "left_arm", "right_arm", "left_leg", "right_leg"];
      for (let i = 0; i < parts.length; i++) {
        if (input.pressed(`Digit${i + 1}`)) {
          state.targetBodyPart = parts[i];
          state.bodyPartPanelOpen = false;
          this.notify(`Targeting: ${BODY_PARTS[parts[i]].label}`, "#c4703a");
        }
      }
      // KeyG or Enter = execute queue (GO)
      if (input.pressed("KeyG") || input.pressed("Enter")) {
        this.executeActionQueue();
      }
      // Backspace = remove last action from queue
      if (input.pressed("Backspace")) {
        this.removeLastFromQueue();
      }
    }

    const worldMouse = camera.screenToTile(input.mouse);
    this.renderer.setHoveredTile(worldMouse);

    switch (state.phase) {
      case "explore": this.updateExplore(dt); break;
      case "combat": this.updateCombat(dt); break;
      case "dialogue": break;
      case "inventory": break;
    }

    this.movementSystem.update(state, dt);
    this.animationSystem.update(state, dt);
    camera.follow(state.player.pos);
    camera.update();

    state.notifications = state.notifications
      .map((n) => ({ ...n, timeLeft: n.timeLeft - dt }))
      .filter((n) => n.timeLeft > 0);

    state.vfx = state.vfx
      .map((v) => ({ ...v, timeLeft: v.timeLeft - dt }))
      .filter((v) => v.timeLeft > 0);
  }

  private updateExplore(dt: number) {
    const { state, input, camera } = this;

    const click = input.leftClick();
    if (click) {
      const tile = camera.screenToTile(click);

      // Check dead body for loot
      const corpse = state.entities.find(
        (e) => !e.isPlayer && e.dead && e.pos.x === tile.x && e.pos.y === tile.y && e.inventory.length > 0,
      );
      if (corpse) {
        const dist = Math.abs(state.player.pos.x - tile.x) + Math.abs(state.player.pos.y - tile.y);
        if (dist <= 1) {
          this.openLoot(corpse);
        } else {
          const adj = this.movementSystem.findAdjacentTile(state.map, corpse.pos, state.player.pos);
          if (adj) {
            const path = this.movementSystem.findPath(state.map, state.player.pos, adj);
            state.player.path = path;
            const checkArrival = () => {
              if (state.player.path.length === 0) this.openLoot(corpse);
              else setTimeout(checkArrival, 100);
            };
            setTimeout(checkArrival, 100);
          }
        }
        return;
      }

      // Check NPC
      const npc = state.entities.find(
        (e) => !e.isPlayer && !e.dead && e.pos.x === tile.x && e.pos.y === tile.y,
      );
      if (npc && !npc.isHostile && npc.dialogueId) {
        const adj = this.movementSystem.findAdjacentTile(state.map, npc.pos, state.player.pos);
        if (adj) {
          const path = this.movementSystem.findPath(state.map, state.player.pos, adj);
          state.player.path = path;
          const checkArrival = () => {
            if (state.player.path.length === 0) this.openDialogue(npc);
            else setTimeout(checkArrival, 100);
          };
          setTimeout(checkArrival, 100);
        } else {
          this.openDialogue(npc);
        }
      } else if (npc && npc.isHostile) {
        this.notify(`${npc.name} is hostile! Press [C] for combat mode.`, "rgb(184, 48, 48)");
      } else {
        if (tile.x >= 0 && tile.x < state.map.width && tile.y >= 0 && tile.y < state.map.height) {
          const path = this.movementSystem.findPath(state.map, state.player.pos, tile);
          if (path.length > 0) state.player.path = path;
        }
      }
    }

    // Item pickups
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

    state.gameTime += dt / 60000;
    if (state.gameTime >= 24) state.gameTime -= 24;
  }

  private updateCombat(dt: number) {
    const { state, input, camera } = this;

    if (state.combatQueue.length === 0) {
      this.combatSystem.initCombat(state);
      this.sound.combatStart();
      this.notify("COMBAT INITIATED. Queue actions, then press [G] or GO to execute.", "rgb(184, 48, 48)");
    }

    // Turn delay
    if (state.combatTurnDelay > 0) {
      state.combatTurnDelay -= dt;
      return;
    }

    const currentId = state.combatQueue[state.activeCombatIdx];
    const current = state.entities.find((e) => e.id === currentId);
    if (!current) { this.combatSystem.nextTurn(state); return; }

    if (current.isPlayer) {
      // If executing the queue, process one action at a time
      if (state.combatExecuting) {
        this.processQueueExecution(current, dt);
      } else {
        this.updatePlayerCombatInput(current, input, camera);
      }
    } else {
      this.updateAICombatTurn(current, dt);
    }
  }

  /** Player adds actions to queue by clicking */
  private updatePlayerCombatInput(player: Entity, input: Input, camera: Camera) {
    const { state } = this;

    // End turn (skip without executing)
    if (input.pressed("Space")) {
      state.combatActionQueue = [];
      this.combatSystem.nextTurn(state);
      this.notify("Turn ended.", "rgb(212, 196, 160)");
      return;
    }

    // Body part panel toggle (mobile "AIM" button injects KeyB)
    if (input.pressed("KeyB")) {
      state.bodyPartPanelOpen = !state.bodyPartPanelOpen;
      return;
    }

    const click = input.leftClick();
    if (!click) return;

    // Check if clicking body part panel buttons on mobile
    if (state.bodyPartPanelOpen) {
      const picked = this.handleBodyPartPanelClick(click.x, click.y);
      if (picked) return;
    }

    // Check if clicking queue panel to remove an action
    if (state.combatActionQueue.length > 0) {
      const removed = this.handleQueuePanelClick(click.x, click.y);
      if (removed) return;
    }

    const tile = camera.screenToTile(click);
    const target = state.entities.find(
      (e) => !e.isPlayer && !e.dead && e.pos.x === tile.x && e.pos.y === tile.y,
    );

    // Calculate remaining AP after queued actions
    const queuedAP = state.combatActionQueue.reduce((sum, a) => sum + a.apCost, 0);
    const remainingAP = player.stats.ap - queuedAP;

    if (target) {
      const apCost = this.combatSystem.getWeaponApCost(player);
      const bodyPart = state.targetBodyPart ?? "torso";
      const range = this.combatSystem.getWeaponRange(player);
      const dist = Math.abs(player.pos.x - target.pos.x) + Math.abs(player.pos.y - target.pos.y);

      if (dist > range) {
        this.notify(`Out of range! Need ${range}, target is ${dist} away.`, "#b83030");
        return;
      }
      if (remainingAP < apCost) {
        this.notify(`Not enough AP! Need ${apCost}, have ${remainingAP} remaining.`, "#b83030");
        return;
      }

      const partLabel = BODY_PARTS[bodyPart].label;
      const hitPct = Math.round(BODY_PARTS[bodyPart].hitMod * 100);
      const action: CombatAction = {
        type: "attack",
        targetTile: { x: tile.x, y: tile.y },
        targetEntity: target,
        apCost,
        bodyPart,
        label: `ATK ${target.name} → ${partLabel} (${apCost}AP, ~${hitPct}%)`,
      };
      state.combatActionQueue.push(action);
      this.notify(`Queued: Attack ${target.name}'s ${partLabel}. Press [G] to execute.`, "#c4703a");
    } else {
      // Movement
      if (tile.x < 0 || tile.x >= state.map.width || tile.y < 0 || tile.y >= state.map.height) return;
      const path = this.movementSystem.findPath(state.map, player.pos, tile);
      if (path.length === 0) return;

      const moveCost = this.combatSystem.getMoveCost(player);
      const maxSteps = Math.min(path.length, Math.floor(remainingAP / moveCost));
      if (maxSteps === 0) {
        this.notify("Not enough AP to move!", "#b83030");
        return;
      }

      const totalAP = maxSteps * moveCost;
      const action: CombatAction = {
        type: "move",
        targetTile: { x: tile.x, y: tile.y },
        apCost: totalAP,
        label: `MOVE ${maxSteps} tile${maxSteps > 1 ? "s" : ""} (${totalAP}AP)`,
      };
      state.combatActionQueue.push(action);
      this.notify(`Queued: Move ${maxSteps} tiles. Press [G] to execute.`, "#c4703a");
    }
  }

  /** Execute all queued actions one at a time */
  private executeActionQueue() {
    const { state } = this;
    if (state.combatActionQueue.length === 0) {
      this.notify("Queue is empty — click to add actions first.", "#999999");
      return;
    }
    if (state.combatExecuting) return;
    state.combatExecuting = true;
    this.queueExecTimer = 0;
  }

  /** Process one action from the queue per timer tick */
  private processQueueExecution(player: Entity, dt: number) {
    const { state } = this;

    this.queueExecTimer -= dt;
    if (this.queueExecTimer > 0) return;

    if (state.combatActionQueue.length === 0) {
      state.combatExecuting = false;
      return;
    }

    const action = state.combatActionQueue.shift()!;

    if (action.type === "attack" && action.targetEntity) {
      const target = action.targetEntity;
      if (target.dead) {
        // Target already dead from previous action in queue
        state.combatLog.push({ text: `${target.name} is already dead.`, color: "#999999", turn: state.turn });
      } else {
        const bodyPart = action.bodyPart ?? "torso";
        this.executePlayerAttack(player, target, bodyPart);
      }
    } else if (action.type === "move") {
      const path = this.movementSystem.findPath(state.map, player.pos, action.targetTile);
      const moveCost = this.combatSystem.getMoveCost(player);
      const maxSteps = Math.min(path.length, Math.floor(player.stats.ap / moveCost));
      if (maxSteps > 0) {
        player.path = path.slice(0, maxSteps);
        const totalAP = maxSteps * moveCost;
        player.stats.ap -= totalAP;
        state.combatLog.push({
          text: `You move ${maxSteps} tile${maxSteps > 1 ? "s" : ""} (${totalAP} AP).`,
          color: "#d4c4a0", turn: state.turn,
        });
      }
    }

    this.queueExecTimer = this.QUEUE_EXEC_DELAY;

    // If queue is empty after this action, finish execution
    if (state.combatActionQueue.length === 0) {
      state.combatExecuting = false;
    }
  }

  private removeLastFromQueue() {
    const { state } = this;
    if (state.combatActionQueue.length > 0 && !state.combatExecuting) {
      const removed = state.combatActionQueue.pop()!;
      this.notify(`Removed: ${removed.label}`, "#d4c4a0");
    }
  }

  private executePlayerAttack(player: Entity, target: Entity, bodyPart: BodyPart) {
    const { state } = this;

    if (this.combatSystem.isRangedWeapon(player)) {
      this.animationSystem.triggerShoot(player);
    } else {
      this.animationSystem.triggerAttack(player);
    }
    const result = this.combatSystem.attack(state, player, target, bodyPart);
    this.spawnAttackVFX(player, target, result);
    this.notify(result.message, result.hit ? "rgb(184, 48, 48)" : "rgb(212, 196, 160)");

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
        color: "#ff0000", turn: state.turn,
      });
      this.spawnSeverVFX(target);
    }

    if (target.dead) {
      this.notify(`${target.name} has been killed!`, "rgb(184, 48, 48)");
      state.combatLog.push({ text: `${target.name} is dead.`, color: "#b83030", turn: state.turn });

      // Log lootable items
      if (target.inventory.length > 0) {
        const itemNames = target.inventory.map(i => {
          const def = ITEM_DB[i.itemId];
          return def ? def.name : i.itemId;
        }).join(", ");
        state.combatLog.push({ text: `Loot: ${itemNames}`, color: "#c4703a", turn: state.turn });
      }
    }

    // Check combat end
    const hostiles = state.entities.filter((e) => e.isHostile && !e.dead);
    if (hostiles.length === 0) {
      state.phase = "explore";
      state.combatQueue = [];
      state.combatActionQueue = [];
      state.combatExecuting = false;
      state.targetBodyPart = null;
      state.bodyPartPanelOpen = false;
      this.notify("All enemies defeated! Click bodies to loot.", "rgb(64, 192, 64)");
    }
  }

  private updateAICombatTurn(npc: Entity, dt: number) {
    const { state } = this;

    this.aiActionTimer -= dt;
    if (this.aiActionTimer > 0) return;

    const playerHpBefore = state.player.stats.hp;
    const didAct = this.combatSystem.aiAct(state, npc);

    if (didAct) {
      const dmg = playerHpBefore - state.player.stats.hp;
      if (dmg > 0) {
        if (this.combatSystem.isRangedWeapon(npc)) {
          this.animationSystem.triggerShoot(npc);
        } else {
          this.animationSystem.triggerAttack(npc);
        }
        const lastLog = state.combatLog[state.combatLog.length - 1];
        const isCrit = lastLog?.text.includes("CRITICAL") ?? false;
        this.spawnAttackVFX(npc, state.player, {
          hit: true, damage: dmg, message: "", crit: isCrit,
          crippled: lastLog?.text.includes("CRIPPLED") ? "torso" : undefined,
          severed: lastLog?.text.includes("SEVERED"),
        });
      }
      this.aiActionTimer = this.AI_ACTION_DELAY;
      if (state.player.dead) {
        this.notify("You have been killed. Game Over.", "#ff0000");
        state.phase = "explore";
        state.combatQueue = [];
        return;
      }
    } else {
      this.combatSystem.nextTurn(state);
      this.aiActionTimer = 0;
    }
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

  lootItem(itemId: string) {
    const { state } = this;
    if (!state.lootTarget) return;
    const invItem = state.lootTarget.inventory.find((i) => i.itemId === itemId);
    if (!invItem) return;
    this.inventorySystem.addItem(state.player, itemId, invItem.count);
    state.lootTarget.inventory = state.lootTarget.inventory.filter((i) => i.itemId !== itemId);
    const def = ITEM_DB[itemId];
    this.notify(`Looted: ${def ? def.name : itemId} x${invItem.count}`, "rgb(64, 192, 64)");
    if (state.lootTarget.inventory.length === 0) {
      this.notify("Body is empty.", "#6e6e5e");
      state.lootTarget = null;
    }
  }

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
    if (response.giveItem) {
      this.inventorySystem.addItem(state.player, response.giveItem, 1);
      this.notify(`Received: ${response.giveItem}`, "rgb(64, 192, 64)");
    }
    if (response.removeItem) {
      this.inventorySystem.removeItem(state.player, response.removeItem, 1);
    }
    if (response.nextNodeId === null) {
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
    this.state.phase = this.state.phase === phase ? "explore" : phase;
  }

  notify(text: string, color: string) {
    this.state.notifications.unshift({ text, color, timeLeft: 4000 });
    if (this.state.notifications.length > 5) this.state.notifications.pop();
  }

  private getCrippleEffectMsg(part: BodyPart): string {
    switch (part) {
      case "head": return "Target blinded! Accuracy severely reduced.";
      case "left_arm": case "right_arm": return "Arm crippled! Attack damage reduced.";
      case "left_leg": case "right_leg": return "Leg crippled! Movement costs 2 AP per step.";
      default: return "";
    }
  }

  // ── Body part panel tap handling (mobile) ──

  private handleBodyPartPanelClick(screenX: number, screenY: number): boolean {
    const { state } = this;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const parts: BodyPart[] = ["head", "torso", "left_arm", "right_arm", "left_leg", "right_leg"];

    const cols = 2;
    const btnW = 120;
    const btnH = 44;
    const gap = 6;
    const panelW = cols * (btnW + gap) - gap;
    const panelH = 3 * (btnH + gap) - gap + 40;
    const px = (w - panelW) / 2;
    const py = (h - panelH) / 2;

    if (screenX < px || screenX > px + panelW || screenY < py || screenY > py + panelH) {
      state.bodyPartPanelOpen = false;
      return true;
    }

    const headerH = 30;
    for (let i = 0; i < parts.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const bx = px + col * (btnW + gap);
      const by = py + headerH + row * (btnH + gap);
      if (screenX >= bx && screenX <= bx + btnW && screenY >= by && screenY <= by + btnH) {
        state.targetBodyPart = parts[i];
        state.bodyPartPanelOpen = false;
        this.notify(`Targeting: ${BODY_PARTS[parts[i]].label}`, "#c4703a");
        return true;
      }
    }
    return false;
  }

  // ── Queue panel click handling (remove actions) ──

  private handleQueuePanelClick(screenX: number, screenY: number): boolean {
    const { state } = this;
    if (state.combatExecuting) return false;
    const w = this.canvas.width;
    const isMobile = Input.isTouchDevice();
    const maxW = isMobile ? w - 100 : w - 20;
    const queueW = Math.min(280, maxW);
    const queueX = isMobile ? 10 : (w - queueW) / 2;
    const lineH = 20;
    const headerH = 22;
    const queueY = 42;

    if (screenX < queueX || screenX > queueX + queueW) return false;

    for (let i = 0; i < state.combatActionQueue.length; i++) {
      const iy = queueY + headerH + i * lineH;
      if (screenY >= iy && screenY < iy + lineH) {
        const removed = state.combatActionQueue.splice(i, 1)[0];
        this.notify(`Removed: ${removed.label}`, "#d4c4a0");
        return true;
      }
    }

    // Check GO button
    const goY = queueY + headerH + state.combatActionQueue.length * lineH + 4;
    if (screenY >= goY && screenY <= goY + 26) {
      this.executeActionQueue();
      return true;
    }

    return false;
  }

  // ── Drawing ──

  private draw() {
    const { ctx } = this.canvas.getContext("2d")
      ? { ctx: this.canvas.getContext("2d")! }
      : { ctx: null as never };

    this.renderer.render(this.state);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    this.hud.draw(ctx, this.state, this.canvas.width, this.canvas.height);

    if (this.state.phase === "dialogue") {
      this.dialogueUI.draw(ctx, this.state, this.canvas.width, this.canvas.height, this, this.assets);
    }
    if (this.state.phase === "inventory") {
      this.inventoryUI.draw(ctx, this.state, this.canvas.width, this.canvas.height, this);
    }
    if (this.state.phase === "combat") {
      this.drawCombatUI(ctx);
    }
    if (this.state.lootTarget) {
      this.drawLootUI(ctx);
    }
  }

  private drawCombatUI(ctx: CanvasRenderingContext2D) {
    const { state } = this;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const isTouchDev = Input.isTouchDevice();

    // Top bar — narrower on mobile to avoid minimap overlap
    const topBarW = isTouchDev ? w - 90 : w;
    ctx.fillStyle = "rgba(184, 48, 48, 0.15)";
    ctx.fillRect(0, 0, topBarW, 36);
    ctx.fillStyle = "#b83030";
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "center";
    ctx.fillText("[ COMBAT MODE ]", topBarW / 2, 14);

    const weapon = state.player.inventory.find((i) => i.equipped);
    const weaponDef = weapon ? ITEM_DB[weapon.itemId] : null;
    const weaponName = weaponDef ? weaponDef.name : "Fists";
    const range = this.combatSystem.getWeaponRange(state.player);
    const apCost = this.combatSystem.getWeaponApCost(state.player);
    const bodyPart = state.targetBodyPart ?? "torso";
    const partLabel = BODY_PARTS[bodyPart].label;
    const queuedAP = state.combatActionQueue.reduce((s, a) => s + a.apCost, 0);
    const apLeft = state.player.stats.ap - queuedAP;

    const hint = isTouchDev
      ? `AP:${apLeft}/${state.player.stats.maxAp} | ${weaponName} (${apCost}AP) | ${partLabel}`
      : `AP: ${apLeft}/${state.player.stats.maxAp}  |  ${weaponName} (${apCost}AP, rng:${range})  |  ${partLabel}  |  [1-6] aim  [G] GO  [Bksp] undo`;

    ctx.font = isTouchDev ? "10px monospace" : "12px monospace";
    ctx.fillStyle = "#d4c4a0";
    ctx.fillText(hint, topBarW / 2, 30);

    // Action queue panel (left-aligned on mobile to avoid touch buttons, centered on desktop)
    if (state.combatActionQueue.length > 0) {
      this.drawActionQueue(ctx, w, isTouchDev);
    }

    // Body part selector — desktop: horizontal bar, mobile: hidden (use AIM button)
    if (!isTouchDev) {
      this.drawBodyPartSelector(ctx, w, h);
    }

    // Body part panel (mobile overlay)
    if (state.bodyPartPanelOpen) {
      this.drawBodyPartPanel(ctx, w, h);
    }

    // Combat log
    this.drawCombatLog(ctx, w, h, isTouchDev);
  }

  private drawActionQueue(ctx: CanvasRenderingContext2D, w: number, isMobile: boolean) {
    const { state } = this;
    // On mobile, leave 80px right margin for touch buttons
    const maxW = isMobile ? w - 100 : w - 20;
    const queueW = Math.min(280, maxW);
    const queueX = isMobile ? 10 : (w - queueW) / 2;
    const lineH = 20;
    const headerH = 22;
    const queueY = 42;
    const totalAP = state.combatActionQueue.reduce((s, a) => s + a.apCost, 0);
    const queueH = headerH + state.combatActionQueue.length * lineH + 36;

    ctx.fillStyle = "rgba(20, 20, 16, 0.9)";
    ctx.fillRect(queueX, queueY, queueW, queueH);
    ctx.strokeStyle = "#c4703a";
    ctx.lineWidth = 1;
    ctx.strokeRect(queueX, queueY, queueW, queueH);

    // Header
    ctx.fillStyle = "#c4703a";
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`QUEUE (${totalAP} AP)`, queueX + 8, queueY + 14);

    // Actions
    ctx.font = "9px monospace";
    const maxLabelLen = isMobile ? 28 : 36;
    for (let i = 0; i < state.combatActionQueue.length; i++) {
      const action = state.combatActionQueue[i];
      const iy = queueY + headerH + i * lineH;

      // Hover highlight
      const mx = InventoryUI._mouseX;
      const my = InventoryUI._mouseY;
      if (mx >= queueX && mx <= queueX + queueW && my >= iy && my < iy + lineH) {
        ctx.fillStyle = "rgba(184, 48, 48, 0.15)";
        ctx.fillRect(queueX + 2, iy, queueW - 4, lineH);
      }

      // Number
      ctx.fillStyle = "#b83030";
      ctx.fillText(`${i + 1}.`, queueX + 8, iy + 13);

      // Label
      ctx.fillStyle = action.type === "attack" ? "#ff6644" : "#d4c4a0";
      const label = action.label.length > maxLabelLen ? action.label.substring(0, maxLabelLen - 3) + "..." : action.label;
      ctx.fillText(label, queueX + 24, iy + 13);

      // Remove hint
      ctx.fillStyle = "#6e6e5e";
      ctx.textAlign = "right";
      ctx.fillText("[x]", queueX + queueW - 8, iy + 13);
      ctx.textAlign = "left";
    }

    // GO button
    const goY = queueY + headerH + state.combatActionQueue.length * lineH + 4;
    const goW = 80;
    const goX = queueX + (queueW - goW) / 2;

    ctx.fillStyle = state.combatExecuting ? "rgba(100, 100, 100, 0.5)" : "rgba(64, 192, 64, 0.3)";
    ctx.fillRect(goX, goY, goW, 26);
    ctx.strokeStyle = "#40c040";
    ctx.lineWidth = 2;
    ctx.strokeRect(goX, goY, goW, 26);
    ctx.fillStyle = "#40c040";
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "center";
    ctx.fillText(state.combatExecuting ? "..." : "GO [G]", goX + goW / 2, goY + 17);
  }

  private drawBodyPartSelector(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const { state } = this;
    const parts: BodyPart[] = ["head", "torso", "left_arm", "right_arm", "left_leg", "right_leg"];
    const selected = state.targetBodyPart ?? "torso";

    // 2 rows x 3 columns for a more compact layout
    const btnW = 80;
    const btnH = 22;
    const gapX = 4;
    const gapY = 3;
    const cols = 3;
    const totalW = cols * (btnW + gapX) - gapX;
    const startX = (w - totalW) / 2;
    const startY = h - 146;

    ctx.fillStyle = "#d4c4a0";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.fillText("TARGET [1-6]", w / 2, startY - 6);

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const mod = BODY_PARTS[part];
      const col = i % cols;
      const row = Math.floor(i / cols);
      const bx = startX + col * (btnW + gapX);
      const by = startY + row * (btnH + gapY);
      const isSelected = part === selected;

      ctx.fillStyle = isSelected ? "rgba(184, 48, 48, 0.4)" : "rgba(30, 30, 22, 0.85)";
      ctx.fillRect(bx, by, btnW, btnH);
      ctx.strokeStyle = isSelected ? "#b83030" : "#6e6e5e";
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.strokeRect(bx, by, btnW, btnH);
      ctx.fillStyle = isSelected ? "#ff6644" : "#d4c4a0";
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      ctx.fillText(`${i + 1}:${mod.label} ${Math.round(mod.hitMod * 100)}%`, bx + btnW / 2, by + 15);
    }
  }

  /** Large tappable body part panel for mobile */
  private drawBodyPartPanel(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const { state } = this;
    const parts: BodyPart[] = ["head", "torso", "left_arm", "right_arm", "left_leg", "right_leg"];
    const selected = state.targetBodyPart ?? "torso";

    const cols = 2;
    const btnW = 120;
    const btnH = 44;
    const gap = 6;
    const panelW = cols * (btnW + gap) - gap;
    const headerH = 30;
    const panelH = 3 * (btnH + gap) - gap + headerH + 10;
    const px = (w - panelW) / 2;
    const py = (h - panelH) / 2;

    // Dim background
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(0, 0, w, h);

    // Panel
    ctx.fillStyle = "rgba(20, 20, 16, 0.95)";
    ctx.fillRect(px - 10, py - 10, panelW + 20, panelH + 20);
    ctx.strokeStyle = "#c4703a";
    ctx.lineWidth = 2;
    ctx.strokeRect(px - 10, py - 10, panelW + 20, panelH + 20);

    // Title
    ctx.fillStyle = "#c4703a";
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.fillText("SELECT TARGET", w / 2, py + 14);

    // Buttons
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const mod = BODY_PARTS[part];
      const col = i % cols;
      const row = Math.floor(i / cols);
      const bx = px + col * (btnW + gap);
      const by = py + headerH + row * (btnH + gap);
      const isSelected = part === selected;

      ctx.fillStyle = isSelected ? "rgba(184, 48, 48, 0.5)" : "rgba(30, 30, 22, 0.9)";
      ctx.fillRect(bx, by, btnW, btnH);
      ctx.strokeStyle = isSelected ? "#b83030" : "#6e6e5e";
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.strokeRect(bx, by, btnW, btnH);

      ctx.fillStyle = isSelected ? "#ff6644" : "#d4c4a0";
      ctx.font = "bold 12px monospace";
      ctx.textAlign = "center";
      ctx.fillText(mod.label, bx + btnW / 2, by + 18);

      ctx.fillStyle = "#8ec44a";
      ctx.font = "10px monospace";
      ctx.fillText(`${Math.round(mod.hitMod * 100)}% hit  |  ${mod.damageMod}x dmg`, bx + btnW / 2, by + 34);
    }
  }

  private drawCombatLog(ctx: CanvasRenderingContext2D, w: number, h: number, isMobile: boolean) {
    const { state } = this;
    const log = state.combatLog;
    if (log.length === 0) return;

    const logX = 10;
    const logW = isMobile ? Math.min(240, w - 100) : 300;
    const lineH = isMobile ? 12 : 14;
    const maxLines = isMobile ? 6 : 10;
    const maxChars = isMobile ? 32 : 42;
    const visibleLog = log.slice(-maxLines);
    const logH = visibleLog.length * lineH + 20;
    // Position above HP/AP bars (which start at h - 90), with a gap
    const logY = h - 100 - logH;

    ctx.fillStyle = "rgba(20, 20, 16, 0.75)";
    ctx.fillRect(logX, logY, logW, logH);
    ctx.strokeStyle = "rgba(64, 192, 64, 0.3)";
    ctx.lineWidth = 1;
    ctx.strokeRect(logX, logY, logW, logH);

    ctx.fillStyle = "#40c040";
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "left";
    ctx.fillText("COMBAT LOG", logX + 5, logY + 11);

    ctx.font = isMobile ? "8px monospace" : "9px monospace";
    for (let i = 0; i < visibleLog.length; i++) {
      const entry = visibleLog[i];
      ctx.fillStyle = entry.color;
      const text = entry.text.length > maxChars ? entry.text.substring(0, maxChars - 3) + "..." : entry.text;
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

    ctx.fillStyle = "rgba(20, 20, 16, 0.95)";
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = "#c4703a";
    ctx.lineWidth = 2;
    ctx.strokeRect(px, py, pw, ph);

    ctx.fillStyle = "#c4703a";
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`LOOT: ${target.name}`, px + pw / 2, py + 25);

    ctx.strokeStyle = "rgba(196, 112, 58, 0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px + 10, py + 40);
    ctx.lineTo(px + pw - 10, py + 40);
    ctx.stroke();

    ctx.textAlign = "left";
    for (let i = 0; i < target.inventory.length; i++) {
      const item = target.inventory[i];
      const def = ITEM_DB[item.itemId];
      const iy = py + headerH + i * itemH;

      const mx = InventoryUI._mouseX;
      const my = InventoryUI._mouseY;
      if (mx >= px && mx <= px + pw && my >= iy && my < iy + itemH) {
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
      if (def) {
        ctx.textAlign = "right";
        ctx.fillStyle = "#6e6e5e";
        ctx.font = "10px monospace";
        ctx.fillText(`${def.value} caps`, px + pw - 15, iy + 15);
        ctx.textAlign = "left";
      }
    }

    ctx.fillStyle = "rgba(212, 196, 160, 0.5)";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.fillText("Click item to take  |  [ESC] close", px + pw / 2, py + ph - 12);

    this.ensureLootClickHandler();
  }

  // ── VFX (unchanged) ──

  private spawnAttackVFX(
    attacker: Entity, target: Entity,
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

    this.state.vfx.push({ type: isRanged ? "projectile" : "slash", fromX: ax, fromY: ay - 12, toX: tx, toY: ty - 12, color: isRanged ? "#ffcc44" : "#cccccc", timeLeft: 300, duration: 300 });
    if (isRanged) this.sound.gunshot(); else this.sound.slash();

    if (result.hit) {
      setTimeout(() => this.sound.impact(damage), isRanged ? 80 : 50);
      if (isCrit) setTimeout(() => this.sound.critical(), 100);

      this.state.vfx.push({ type: "hit_flash", fromX: tx, fromY: ty - 12, toX: tx, toY: ty - 12, color: isCrit ? "#ff2222" : "#ff6644", timeLeft: 150 + damage * 5, duration: 150 + damage * 5, intensity: damage });

      const particleCount = Math.min(25, 4 + damage * 1.5);
      const bloodParticles = [];
      for (let i = 0; i < particleCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        bloodParticles.push({ dx: Math.cos(angle) * (0.5 + Math.random()), dy: Math.sin(angle) * (0.5 + Math.random()) - 0.5, size: 1 + Math.random() * (1.5 + damage * 0.15), speed: 15 + Math.random() * 25 + damage });
      }
      this.state.vfx.push({ type: "blood_burst", fromX: tx, fromY: ty - 12, toX: tx, toY: ty, color: "#8b0000", timeLeft: 400 + damage * 20, duration: 400 + damage * 20, intensity: damage, particles: bloodParticles });

      if (damage >= 8) {
        const burst2 = [];
        for (let i = 0; i < Math.min(12, damage); i++) { const a = Math.random() * Math.PI * 2; burst2.push({ dx: Math.cos(a) * (0.3 + Math.random()), dy: Math.sin(a) * (0.3 + Math.random()) - 0.3, size: 0.8 + Math.random() * 1.5, speed: 20 + Math.random() * 15 }); }
        this.state.vfx.push({ type: "blood_burst", fromX: tx + (Math.random() - 0.5) * 6, fromY: ty - 10 + (Math.random() - 0.5) * 4, toX: tx, toY: ty, color: "#cc1111", timeLeft: 350 + damage * 15, duration: 350 + damage * 15, particles: burst2 });
      }

      if (isCrit || damage >= 12) {
        const chunks = [];
        for (let i = 0; i < Math.min(6, Math.floor(damage / 4)); i++) { const a = Math.random() * Math.PI * 2; chunks.push({ dx: Math.cos(a) * (0.5 + Math.random() * 0.8), dy: Math.sin(a) * (0.5 + Math.random() * 0.5) - 0.8, size: 2 + Math.random() * 3, speed: 20 + Math.random() * 20 }); }
        this.state.vfx.push({ type: "gore_chunk", fromX: tx, fromY: ty - 14, toX: tx, toY: ty, color: "#660000", timeLeft: 600, duration: 600, intensity: damage, particles: chunks });
      }

      if (damage >= 5) this.camera.shake(Math.min(8, 1 + damage * 0.4), Math.min(400, 100 + damage * 15));

      const bodyPartLabel = result.crippled ? ` [${BODY_PARTS[result.crippled].label}]` : "";
      this.state.vfx.push({ type: "damage_number", fromX: tx, fromY: ty - 24, toX: tx, toY: ty - 65, text: isCrit ? `CRIT -${damage}!${bodyPartLabel}` : `-${damage}${bodyPartLabel}`, color: isCrit ? "#ff0000" : damage >= 10 ? "#ff4444" : "#ffcc44", timeLeft: 1000, duration: 1000, intensity: damage });

      if (result.crippled) {
        this.state.vfx.push({ type: "damage_number", fromX: tx + 10, fromY: ty - 10, toX: tx + 10, toY: ty - 45, text: `${BODY_PARTS[result.crippled].label} CRIPPLED!`, color: "#ff6600", timeLeft: 1200, duration: 1200, intensity: 10 });
      }

      if (killed) {
        setTimeout(() => this.sound.death(), 150);
        this.camera.shake(6, 350);
        this.state.vfx.push({ type: "blood_pool", fromX: tx, fromY: ty, toX: tx, toY: ty, color: "#4a0000", timeLeft: 5000, duration: 5000, intensity: damage });
        const dp = []; for (let i = 0; i < 20; i++) { const a = Math.random() * Math.PI * 2; dp.push({ dx: Math.cos(a) * (0.5 + Math.random()), dy: Math.sin(a) * (0.3 + Math.random()) - 0.6, size: 1.5 + Math.random() * 2.5, speed: 25 + Math.random() * 30 }); }
        this.state.vfx.push({ type: "blood_burst", fromX: tx, fromY: ty - 8, toX: tx, toY: ty, color: "#990000", timeLeft: 700, duration: 700, intensity: 20, particles: dp });
        const dc = []; for (let i = 0; i < 4; i++) { const a = Math.random() * Math.PI * 2; dc.push({ dx: Math.cos(a) * (0.6 + Math.random()), dy: Math.sin(a) * (0.4 + Math.random()) - 1.0, size: 2.5 + Math.random() * 3, speed: 18 + Math.random() * 25 }); }
        this.state.vfx.push({ type: "gore_chunk", fromX: tx, fromY: ty - 10, toX: tx, toY: ty, color: "#551111", timeLeft: 800, duration: 800, particles: dc });
        this.state.vfx.push({ type: "damage_number", fromX: tx, fromY: ty - 35, toX: tx, toY: ty - 75, text: "KILLED", color: "#ff0000", timeLeft: 1200, duration: 1200, intensity: 20 });
      }
    } else {
      this.sound.miss();
      this.state.vfx.push({ type: "damage_number", fromX: tx, fromY: ty - 24, toX: tx, toY: ty - 50, text: "MISS", color: "#999999", timeLeft: 600, duration: 600 });
    }
  }

  private spawnSeverVFX(target: Entity) {
    const tx = (target.pos.x - target.pos.y) * TILE_HALF_W;
    const ty = (target.pos.x + target.pos.y) * TILE_HALF_H;
    this.camera.shake(8, 500);
    const chunks = []; for (let i = 0; i < 8; i++) { const a = Math.random() * Math.PI * 2; chunks.push({ dx: Math.cos(a) * (0.8 + Math.random()), dy: Math.sin(a) * (0.5 + Math.random()) - 1.2, size: 3 + Math.random() * 4, speed: 25 + Math.random() * 30 }); }
    this.state.vfx.push({ type: "gore_chunk", fromX: tx, fromY: ty - 12, toX: tx, toY: ty, color: "#880000", timeLeft: 1000, duration: 1000, intensity: 25, particles: chunks });
    this.state.vfx.push({ type: "damage_number", fromX: tx - 10, fromY: ty - 5, toX: tx - 10, toY: ty - 50, text: "SEVERED!", color: "#ff0000", timeLeft: 1500, duration: 1500, intensity: 20 });
  }

  // ── Click handlers ──

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
      if (e.changedTouches.length > 0) { const t = e.changedTouches[0]; handler(t.clientX, t.clientY); }
    }, { passive: true });
  }
}
