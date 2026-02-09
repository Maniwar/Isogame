import { GameState } from "../types";
import type { Game } from "../engine/Game";
import type { AssetManager } from "../assets/AssetManager";

export class DialogueUI {
  private hoveredResponse = -1;
  private boundClick: ((e: MouseEvent) => void) | null = null;
  private boundTouch: ((e: TouchEvent) => void) | null = null;
  private lastState: GameState | null = null;
  private lastScreenH = 0;

  // Layout constants
  private readonly panelH = 220;
  private readonly padding = 20;
  private readonly responseStartY = 120;
  private readonly responseLineH = 28;

  draw(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    screenW: number,
    screenH: number,
    game: Game,
    assets?: AssetManager,
  ) {
    this.lastState = state;
    this.lastScreenH = screenH;

    if (!state.dialogueTree || !state.dialogueNodeId) return;

    const node = state.dialogueTree.nodes[state.dialogueNodeId];
    if (!node) return;

    const panelY = screenH - this.panelH;

    // Background panel
    ctx.fillStyle = "rgba(20, 20, 16, 0.95)";
    ctx.fillRect(0, panelY, screenW, this.panelH);

    // Border
    ctx.strokeStyle = "#40c040";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, panelY);
    ctx.lineTo(screenW, panelY);
    ctx.stroke();

    // Portrait (if available for the selected NPC)
    let textOffsetX = 0;
    if (assets && state.selectedEntity) {
      const portrait = assets.getPortrait(state.selectedEntity.spriteKey);
      if (portrait) {
        const pSize = 64;
        const px = this.padding;
        const py = panelY + 10;
        // Draw portrait frame
        ctx.strokeStyle = "#40c040";
        ctx.lineWidth = 1;
        ctx.strokeRect(px - 1, py - 1, pSize + 2, pSize + 2);
        ctx.drawImage(portrait, px, py, pSize, pSize);
        textOffsetX = pSize + 12;
      }
    }

    // Speaker name
    ctx.fillStyle = "#40c040";
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "left";
    ctx.fillText(node.speaker, this.padding + textOffsetX, panelY + 25);

    // Dialogue text (word-wrap)
    ctx.fillStyle = "#d4c4a0";
    ctx.font = "13px monospace";
    this.drawWrappedText(ctx, node.text, this.padding + textOffsetX, panelY + 50, screenW - this.padding * 2 - textOffsetX, 16);

    // Response options
    const mouseY = this.getMouseY();

    node.responses.forEach((response, i) => {
      const ry = panelY + this.responseStartY + i * this.responseLineH;
      const isHovered = mouseY >= ry && mouseY < ry + this.responseLineH;
      this.hoveredResponse = isHovered ? i : this.hoveredResponse;

      if (isHovered) {
        ctx.fillStyle = "rgba(64, 192, 64, 0.15)";
        ctx.fillRect(this.padding - 5, ry, screenW - this.padding * 2 + 10, this.responseLineH);
      }

      ctx.fillStyle = isHovered ? "#40c040" : "#8ec44a";
      ctx.font = "12px monospace";
      ctx.fillText(`${i + 1}. ${response.text}`, this.padding + 10, ry + 18);
    });

    // Set up click/touch handlers
    this.ensureClickHandler(game);
  }

  private getMouseY(): number {
    return DialogueUI._mouseY;
  }

  static _mouseY = 0;
  static _mouseX = 0;
  static {
    window.addEventListener("mousemove", (e) => {
      DialogueUI._mouseY = e.clientY;
      DialogueUI._mouseX = e.clientX;
    });
    window.addEventListener("touchstart", (e) => {
      if (e.touches.length > 0) {
        DialogueUI._mouseY = e.touches[0].clientY;
        DialogueUI._mouseX = e.touches[0].clientX;
      }
    }, { passive: true });
  }

  private findResponseAtY(y: number): number {
    const state = this.lastState;
    if (!state || !state.dialogueTree || !state.dialogueNodeId) return -1;

    const node = state.dialogueTree.nodes[state.dialogueNodeId];
    if (!node) return -1;

    const panelY = this.lastScreenH - this.panelH;

    for (let i = 0; i < node.responses.length; i++) {
      const ry = panelY + this.responseStartY + i * this.responseLineH;
      if (y >= ry && y < ry + this.responseLineH) {
        return i;
      }
    }
    return -1;
  }

  private ensureClickHandler(game: Game) {
    if (this.boundClick) return;

    this.boundClick = (e: MouseEvent) => {
      const state = this.lastState;
      if (!state || state.phase !== "dialogue") return;

      const idx = this.findResponseAtY(e.clientY);
      if (idx >= 0) {
        game.selectDialogueResponse(idx);
      }
    };
    window.addEventListener("click", this.boundClick);

    // Touch support — touchend fires on tap
    this.boundTouch = (e: TouchEvent) => {
      const state = this.lastState;
      if (!state || state.phase !== "dialogue") return;
      if (e.changedTouches.length === 0) return;

      const touch = e.changedTouches[0];
      const idx = this.findResponseAtY(touch.clientY);
      if (idx >= 0) {
        e.preventDefault();
        game.selectDialogueResponse(idx);
      }
    };
    window.addEventListener("touchend", this.boundTouch, { passive: false });
  }

  private drawWrappedText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
  ) {
    const words = text.split(" ");
    let line = "";
    let ly = y;

    for (const word of words) {
      const test = line + word + " ";
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line.trim(), x, ly);
        line = word + " ";
        ly += lineHeight;
      } else {
        line = test;
      }
    }
    ctx.fillText(line.trim(), x, ly);
  }
}
