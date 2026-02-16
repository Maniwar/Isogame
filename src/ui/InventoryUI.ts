import { GameState } from "../types";
import { ITEM_DB } from "../systems/InventorySystem";
import type { Game } from "../engine/Game";
import type { AssetManager } from "../assets/AssetManager";

export class InventoryUI {
  private boundClick: ((e: MouseEvent) => void) | null = null;
  private boundTouch: ((e: TouchEvent) => void) | null = null;
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
    assets?: AssetManager,
  ) {
    this.lastState = state;

    // Clamp panel to screen width on small devices
    const pw = Math.min(this.panelW, screenW - 20);
    const ph = Math.min(this.panelH, screenH - 40);
    const px = (screenW - pw) / 2;
    const py = (screenH - ph) / 2;

    // Background
    ctx.fillStyle = "rgba(20, 20, 16, 0.95)";
    ctx.fillRect(px, py, pw, ph);

    // Border
    ctx.strokeStyle = "#40c040";
    ctx.lineWidth = 2;
    ctx.strokeRect(px, py, pw, ph);

    // Header
    ctx.fillStyle = "#40c040";
    ctx.font = "bold 16px monospace";
    ctx.textAlign = "center";
    ctx.fillText("INVENTORY", px + pw / 2, py + 30);

    // Divider
    ctx.strokeStyle = "rgba(64, 192, 64, 0.3)";
    ctx.beginPath();
    ctx.moveTo(px + 10, py + this.headerH);
    ctx.lineTo(px + pw - 10, py + this.headerH);
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
          InventoryUI._mouseX <= px + pw &&
          InventoryUI._mouseY >= itemY &&
          InventoryUI._mouseY < itemY + this.itemH;

        if (isHovered) {
          ctx.fillStyle = "rgba(64, 192, 64, 0.1)";
          ctx.fillRect(px + 5, itemY, pw - 10, this.itemH);
        }

        // Item icon (AI-generated PNG or fallback)
        const iconSize = 24;
        const iconX = px + 12;
        const iconY = itemY + (this.itemH - iconSize) / 2;
        const icon = assets?.getItem(item.itemId);
        if (icon) {
          ctx.drawImage(icon, iconX, iconY, iconSize, iconSize);
        }
        const textLeft = icon ? px + 12 + iconSize + 8 : px + 40;

        // Equipped indicator
        if (item.equipped) {
          ctx.fillStyle = "#40c040";
          ctx.font = "10px monospace";
          ctx.fillText("[E]", textLeft - 22, itemY + 20);
        }

        // Item name
        ctx.fillStyle = item.equipped ? "#40c040" : "#d4c4a0";
        ctx.font = "12px monospace";
        ctx.fillText(def.name, textLeft, itemY + 15);

        // Count
        if (item.count > 1) {
          ctx.fillStyle = "#8ec44a";
          ctx.fillText(`x${item.count}`, textLeft, itemY + 30);
        }

        // Item stats on right side
        ctx.textAlign = "right";
        ctx.fillStyle = "#6e6e5e";
        ctx.font = "10px monospace";
        if (def.damage) ctx.fillText(`DMG: ${def.damage}`, px + pw - 15, itemY + 15);
        if (def.healing) ctx.fillText(`HEAL: +${def.healing}`, px + pw - 15, itemY + 15);
        if (def.armorValue) ctx.fillText(`DEF: ${def.armorValue}`, px + pw - 15, itemY + 15);
        ctx.fillText(`${def.value} caps`, px + pw - 15, itemY + 30);
        ctx.textAlign = "left";

        yOff += this.itemH;
      }
    }

    // Description at bottom
    if (inventory.length === 0) {
      ctx.fillStyle = "#6e6e5e";
      ctx.font = "12px monospace";
      ctx.textAlign = "center";
      ctx.fillText("Inventory is empty.", px + pw / 2, py + ph / 2);
    }

    // Footer hint
    ctx.fillStyle = "rgba(212, 196, 160, 0.5)";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.fillText(
      "Tap item to Use/Equip",
      px + pw / 2,
      py + ph - 12,
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
    window.addEventListener("touchstart", (e) => {
      if (e.touches.length > 0) {
        InventoryUI._mouseY = e.touches[0].clientY;
        InventoryUI._mouseX = e.touches[0].clientX;
      }
    }, { passive: true });
  }

  private findItemAtY(clientX: number, clientY: number): string | null {
    const state = this.lastState;
    if (!state) return null;

    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const pw = Math.min(this.panelW, screenW - 20);
    const ph = Math.min(this.panelH, screenH - 40);
    const px = (screenW - pw) / 2;
    const py = (screenH - ph) / 2;

    // Check if inside panel
    if (clientX < px || clientX > px + pw || clientY < py || clientY > py + ph) {
      return null;
    }

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
        if (clientY >= yOff && clientY < yOff + this.itemH) {
          return item.itemId;
        }
        yOff += this.itemH;
      }
    }
    return null;
  }

  private ensureClickHandler(game: Game) {
    if (this.boundClick) return;

    this.boundClick = (e: MouseEvent) => {
      const state = this.lastState;
      if (!state || state.phase !== "inventory") return;

      const itemId = this.findItemAtY(e.clientX, e.clientY);
      if (itemId) {
        game.useItem(itemId);
      }
    };
    window.addEventListener("click", this.boundClick);

    // Touch support
    this.boundTouch = (e: TouchEvent) => {
      const state = this.lastState;
      if (!state || state.phase !== "inventory") return;
      if (e.changedTouches.length === 0) return;

      const touch = e.changedTouches[0];
      const itemId = this.findItemAtY(touch.clientX, touch.clientY);
      if (itemId) {
        e.preventDefault();
        game.useItem(itemId);
      }
    };
    window.addEventListener("touchend", this.boundTouch, { passive: false });
  }
}
