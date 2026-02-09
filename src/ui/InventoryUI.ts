import { GameState } from "../types";
import { ITEM_DB } from "../systems/InventorySystem";
import type { Game } from "../engine/Game";

export class InventoryUI {
  private boundClick: ((e: MouseEvent) => void) | null = null;
  private lastState: GameState | null = null;

  private readonly panelW = 400;
  private readonly panelH = 450;
  private readonly itemH = 36;
  private readonly headerH = 50;

  draw(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    screenW: number,
    screenH: number,
    game: Game,
  ) {
    this.lastState = state;

    const px = (screenW - this.panelW) / 2;
    const py = (screenH - this.panelH) / 2;

    // Background
    ctx.fillStyle = "rgba(20, 20, 16, 0.95)";
    ctx.fillRect(px, py, this.panelW, this.panelH);

    // Border
    ctx.strokeStyle = "#40c040";
    ctx.lineWidth = 2;
    ctx.strokeRect(px, py, this.panelW, this.panelH);

    // Header
    ctx.fillStyle = "#40c040";
    ctx.font = "bold 16px monospace";
    ctx.textAlign = "center";
    ctx.fillText("INVENTORY", px + this.panelW / 2, py + 30);

    // Divider
    ctx.strokeStyle = "rgba(64, 192, 64, 0.3)";
    ctx.beginPath();
    ctx.moveTo(px + 10, py + this.headerH);
    ctx.lineTo(px + this.panelW - 10, py + this.headerH);
    ctx.stroke();

    // Items
    const { inventory } = state.player;

    ctx.textAlign = "left";

    // Category grouping
    const categories = ["weapon", "armor", "consumable", "misc"] as const;
    let yOff = py + this.headerH + 10;

    for (const cat of categories) {
      const items = inventory.filter((i) => {
        const def = ITEM_DB[i.itemId];
        return def && def.category === cat;
      });

      if (items.length === 0) continue;

      // Category header
      ctx.fillStyle = "#c4703a";
      ctx.font = "bold 11px monospace";
      ctx.fillText(cat.toUpperCase(), px + 15, yOff + 12);
      yOff += 20;

      for (const item of items) {
        const def = ITEM_DB[item.itemId];
        if (!def) continue;

        const itemY = yOff;
        const isHovered =
          InventoryUI._mouseX >= px &&
          InventoryUI._mouseX <= px + this.panelW &&
          InventoryUI._mouseY >= itemY &&
          InventoryUI._mouseY < itemY + this.itemH;

        if (isHovered) {
          ctx.fillStyle = "rgba(64, 192, 64, 0.1)";
          ctx.fillRect(px + 5, itemY, this.panelW - 10, this.itemH);
        }

        // Equipped indicator
        if (item.equipped) {
          ctx.fillStyle = "#40c040";
          ctx.font = "10px monospace";
          ctx.fillText("[E]", px + 15, itemY + 20);
        }

        // Item name
        ctx.fillStyle = item.equipped ? "#40c040" : "#d4c4a0";
        ctx.font = "12px monospace";
        ctx.fillText(def.name, px + 40, itemY + 15);

        // Count
        if (item.count > 1) {
          ctx.fillStyle = "#8ec44a";
          ctx.fillText(`x${item.count}`, px + 40, itemY + 30);
        }

        // Item stats on right side
        ctx.textAlign = "right";
        ctx.fillStyle = "#6e6e5e";
        ctx.font = "10px monospace";
        if (def.damage) ctx.fillText(`DMG: ${def.damage}`, px + this.panelW - 15, itemY + 15);
        if (def.healing) ctx.fillText(`HEAL: +${def.healing}`, px + this.panelW - 15, itemY + 15);
        if (def.armorValue) ctx.fillText(`DEF: ${def.armorValue}`, px + this.panelW - 15, itemY + 15);
        ctx.fillText(`${def.value} caps`, px + this.panelW - 15, itemY + 30);
        ctx.textAlign = "left";

        yOff += this.itemH;
      }
    }

    // Description at bottom
    if (inventory.length === 0) {
      ctx.fillStyle = "#6e6e5e";
      ctx.font = "12px monospace";
      ctx.textAlign = "center";
      ctx.fillText("Inventory is empty.", px + this.panelW / 2, py + this.panelH / 2);
    }

    // Footer hint
    ctx.fillStyle = "rgba(212, 196, 160, 0.5)";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.fillText(
      "[Click] Use/Equip  [TAB] Close",
      px + this.panelW / 2,
      py + this.panelH - 12,
    );

    this.ensureClickHandler(game);
  }

  static _mouseY = 0;
  static _mouseX = 0;
  static {
    window.addEventListener("mousemove", (e) => {
      InventoryUI._mouseY = e.clientY;
      InventoryUI._mouseX = e.clientX;
    });
  }

  private ensureClickHandler(game: Game) {
    if (this.boundClick) return;

    this.boundClick = (e: MouseEvent) => {
      const state = this.lastState;
      if (!state || state.phase !== "inventory") return;

      const screenW = window.innerWidth;
      const screenH = window.innerHeight;
      const px = (screenW - this.panelW) / 2;
      const py = (screenH - this.panelH) / 2;

      // Check if click is inside panel
      if (
        e.clientX < px ||
        e.clientX > px + this.panelW ||
        e.clientY < py ||
        e.clientY > py + this.panelH
      ) {
        return;
      }

      // Find which item was clicked
      const categories = ["weapon", "armor", "consumable", "misc"] as const;
      let yOff = py + this.headerH + 10;

      for (const cat of categories) {
        const items = state.player.inventory.filter((i) => {
          const def = ITEM_DB[i.itemId];
          return def && def.category === cat;
        });

        if (items.length === 0) continue;
        yOff += 20; // category header

        for (const item of items) {
          if (e.clientY >= yOff && e.clientY < yOff + this.itemH) {
            game.useItem(item.itemId);
            return;
          }
          yOff += this.itemH;
        }
      }
    };

    window.addEventListener("click", this.boundClick);
  }
}
