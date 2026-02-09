import { GameState } from "../types";

export class HUD {
  draw(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    screenW: number,
    screenH: number,
  ) {
    const { player } = state;

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

    // Controls hint (top-left)
    ctx.fillStyle = "rgba(212, 196, 160, 0.5)";
    ctx.font = "10px monospace";
    ctx.textAlign = "left";
    ctx.fillText("[TAB] Inventory  [C] Combat  [ESC] Cancel  [Scroll] Zoom  [Right-drag] Pan", 10, 20);

    // Phase indicator
    if (state.phase !== "explore") {
      ctx.fillStyle = state.phase === "combat" ? "#b83030" : "#40c040";
      ctx.font = "bold 11px monospace";
      ctx.textAlign = "right";
      ctx.fillText(`[ ${state.phase.toUpperCase()} ]`, screenW - 20, screenH - 20);
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
