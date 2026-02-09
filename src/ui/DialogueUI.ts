import { GameState } from "../types";
import type { Game } from "../engine/Game";

export class DialogueUI {
  private hoveredResponse = -1;
  private boundClick: ((e: MouseEvent) => void) | null = null;
  private lastState: GameState | null = null;

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
  ) {
    this.lastState = state;

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

    // Speaker name
    ctx.fillStyle = "#40c040";
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "left";
    ctx.fillText(node.speaker, this.padding, panelY + 25);

    // Dialogue text (word-wrap)
    ctx.fillStyle = "#d4c4a0";
    ctx.font = "13px monospace";
    this.drawWrappedText(ctx, node.text, this.padding, panelY + 50, screenW - this.padding * 2, 16);

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

    // Set up click handler
    this.ensureClickHandler(game);
  }

  private getMouseY(): number {
    // Use a simple tracking approach — updated via mousemove on window
    return DialogueUI._mouseY;
  }

  static _mouseY = 0;
  static _mouseX = 0;
  static {
    window.addEventListener("mousemove", (e) => {
      DialogueUI._mouseY = e.clientY;
      DialogueUI._mouseX = e.clientX;
    });
  }

  private ensureClickHandler(game: Game) {
    if (this.boundClick) return;

    this.boundClick = (e: MouseEvent) => {
      const state = this.lastState;
      if (!state || !state.dialogueTree || !state.dialogueNodeId) return;
      if (state.phase !== "dialogue") return;

      const node = state.dialogueTree.nodes[state.dialogueNodeId];
      if (!node) return;

      const screenH = window.innerHeight;
      const panelY = screenH - this.panelH;
      const y = e.clientY;

      for (let i = 0; i < node.responses.length; i++) {
        const ry = panelY + this.responseStartY + i * this.responseLineH;
        if (y >= ry && y < ry + this.responseLineH) {
          game.selectDialogueResponse(i);
          break;
        }
      }
    };
    window.addEventListener("click", this.boundClick);
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
