import { GameState } from "../types";
import { Input } from "../engine/Input";

/** On-screen button definition */
interface TouchButton {
  label: string;
  key: string;       // key code to inject when tapped
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  /** Only show in these phases (empty = always) */
  phases: string[];
}

export class HUD {
  private buttons: TouchButton[] = [];
  private isTouchDevice = false;
  private lastScreenW = 0;
  private lastScreenH = 0;

  /** Call once after the canvas is ready */
  initTouchButtons(screenW: number, screenH: number) {
    this.isTouchDevice = Input.isTouchDevice();
    if (!this.isTouchDevice) return;

    this.layoutButtons(screenW, screenH);
  }

  private layoutButtons(screenW: number, screenH: number) {
    this.lastScreenW = screenW;
    this.lastScreenH = screenH;

    const bw = 64;
    const bh = 44;
    const gap = 8;
    const rightX = screenW - bw - 12;
    const bottomY = screenH - 100;

    this.buttons = [
      {
        label: "BAG",
        key: "Tab",
        x: rightX,
        y: bottomY - (bh + gap) * 2,
        w: bw, h: bh,
        color: "#40c040",
        phases: ["explore", "inventory"],
      },
      {
        label: "FIGHT",
        key: "KeyC",
        x: rightX,
        y: bottomY - (bh + gap),
        w: bw, h: bh,
        color: "#b83030",
        phases: ["explore"],
      },
      {
        label: "END",
        key: "Space",
        x: rightX,
        y: bottomY - (bh + gap),
        w: bw, h: bh,
        color: "#c4703a",
        phases: ["combat"],
      },
      {
        label: "BACK",
        key: "Escape",
        x: rightX,
        y: bottomY,
        w: bw, h: bh,
        color: "#9e9e8e",
        phases: ["combat", "inventory", "dialogue"],
      },
    ];
  }

  /**
   * Check if a screen tap hit any on-screen button.
   * Returns the key code to inject, or null.
   */
  handleTap(x: number, y: number, phase: string): string | null {
    if (!this.isTouchDevice) return null;
    for (const btn of this.buttons) {
      if (btn.phases.length > 0 && !btn.phases.includes(phase)) continue;
      if (x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
        return btn.key;
      }
    }
    return null;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    screenW: number,
    screenH: number,
  ) {
    const { player } = state;

    // Re-layout buttons if screen size changed
    if (this.isTouchDevice && (screenW !== this.lastScreenW || screenH !== this.lastScreenH)) {
      this.layoutButtons(screenW, screenH);
    }

    // Bottom-left: health + AP bar (pip-boy style)
    this.drawPanel(ctx, 10, screenH - 90, 260, 80);

    // Player name
    ctx.fillStyle = "#40c040";
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "left";
    ctx.fillText(player.name, 20, screenH - 72);

    // HP bar
    ctx.fillStyle = "#d4c4a0";
    ctx.font = "10px monospace";
    ctx.fillText("HP", 20, screenH - 54);
    this.drawBar(
      ctx,
      50,
      screenH - 62,
      150,
      10,
      player.stats.hp / player.stats.maxHp,
      "#40c040",
      "#b83030",
    );
    ctx.fillStyle = "#d4c4a0";
    ctx.fillText(`${player.stats.hp}/${player.stats.maxHp}`, 210, screenH - 54);

    // AP bar
    ctx.fillText("AP", 20, screenH - 38);
    this.drawBar(
      ctx,
      50,
      screenH - 46,
      150,
      10,
      player.stats.ap / player.stats.maxAp,
      "#8ec44a",
      "#6e6e5e",
    );
    ctx.fillText(`${player.stats.ap}/${player.stats.maxAp}`, 210, screenH - 38);

    // Equipped weapon
    const weapon = player.inventory.find((i) => i.equipped);
    ctx.fillStyle = "#c4703a";
    ctx.font = "10px monospace";
    ctx.fillText(
      `Weapon: ${weapon ? weapon.itemId.replace(/_/g, " ") : "Fists"}`,
      20,
      screenH - 18,
    );

    // Top-right: minimap info
    this.drawPanel(ctx, screenW - 210, 10, 200, 50);
    ctx.fillStyle = "#40c040";
    ctx.font = "10px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`${state.map.name}`, screenW - 200, 30);

    const hour = Math.floor(state.gameTime);
    const min = Math.floor((state.gameTime % 1) * 60);
    const timeStr = `${hour.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;
    ctx.fillText(`Time: ${timeStr}`, screenW - 200, 48);

    // Controls hint (top-left) — only on desktop
    if (!this.isTouchDevice) {
      ctx.fillStyle = "rgba(212, 196, 160, 0.5)";
      ctx.font = "10px monospace";
      ctx.textAlign = "left";
      ctx.fillText("[TAB] Inventory  [C] Combat  [ESC] Cancel  [Scroll] Zoom  [Right-drag] Pan", 10, 20);
    }

    // Phase indicator
    if (state.phase !== "explore") {
      ctx.fillStyle = state.phase === "combat" ? "#b83030" : "#40c040";
      ctx.font = "bold 11px monospace";
      ctx.textAlign = "right";
      const phaseX = this.isTouchDevice ? screenW - 90 : screenW - 20;
      ctx.fillText(`[ ${state.phase.toUpperCase()} ]`, phaseX, screenH - 20);
    }

    // Notifications
    this.drawNotifications(ctx, state, screenW);

    // On-screen touch buttons
    if (this.isTouchDevice) {
      this.drawTouchButtons(ctx, state.phase);
    }
  }

  private drawNotifications(ctx: CanvasRenderingContext2D, state: GameState, screenW: number) {
    ctx.font = "11px monospace";
    ctx.textAlign = "center";
    for (let i = 0; i < state.notifications.length; i++) {
      const n = state.notifications[i];
      const alpha = Math.min(1, n.timeLeft / 500);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "rgba(30, 30, 22, 0.7)";
      const ny = 70 + i * 20;
      ctx.fillRect(screenW / 2 - 200, ny - 12, 400, 18);
      ctx.fillStyle = n.color;
      ctx.fillText(n.text, screenW / 2, ny);
    }
    ctx.globalAlpha = 1;
  }

  private drawTouchButtons(ctx: CanvasRenderingContext2D, phase: string) {
    for (const btn of this.buttons) {
      if (btn.phases.length > 0 && !btn.phases.includes(phase)) continue;

      // Button background
      ctx.fillStyle = "rgba(30, 30, 22, 0.85)";
      ctx.fillRect(btn.x, btn.y, btn.w, btn.h);

      // Border
      ctx.strokeStyle = btn.color;
      ctx.lineWidth = 2;
      ctx.strokeRect(btn.x, btn.y, btn.w, btn.h);

      // Label
      ctx.fillStyle = btn.color;
      ctx.font = "bold 13px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(btn.label, btn.x + btn.w / 2, btn.y + btn.h / 2);
      ctx.textBaseline = "alphabetic";
    }
  }

  private drawPanel(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
  ) {
    ctx.fillStyle = "rgba(30, 30, 22, 0.85)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(64, 192, 64, 0.4)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
  }

  private drawBar(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    ratio: number,
    goodColor: string,
    badColor: string,
  ) {
    ctx.fillStyle = "#1e1e16";
    ctx.fillRect(x, y, w, h);
    const r = Math.max(0, Math.min(1, ratio));
    ctx.fillStyle = r > 0.25 ? goodColor : badColor;
    ctx.fillRect(x, y, w * r, h);
    ctx.strokeStyle = "rgba(64, 192, 64, 0.3)";
    ctx.strokeRect(x, y, w, h);
  }
}
