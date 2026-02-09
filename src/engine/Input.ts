import { ScreenPos } from "../types";

export type MouseButton = "left" | "right" | "middle";

export class Input {
  /** Currently held keys */
  keys = new Set<string>();
  /** Keys pressed this frame (consume after reading) */
  keysPressed = new Set<string>();

  mouse: ScreenPos = { x: 0, y: 0 };
  mouseDown = new Map<MouseButton, boolean>();
  mouseClicked = new Map<MouseButton, ScreenPos | null>();
  wheelDelta = 0;

  /** Is the user dragging with middle or right button? */
  dragging = false;
  dragDelta: ScreenPos = { x: 0, y: 0 };

  private canvas: HTMLCanvasElement;
  private lastMouse: ScreenPos = { x: 0, y: 0 };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.bind();
  }

  private bind() {
    window.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      this.keysPressed.add(e.code);
    });
    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
    });
    this.canvas.addEventListener("mousemove", (e) => {
      this.mouse = { x: e.offsetX, y: e.offsetY };
      if (this.dragging) {
        this.dragDelta.x += e.offsetX - this.lastMouse.x;
        this.dragDelta.y += e.offsetY - this.lastMouse.y;
      }
      this.lastMouse = { x: e.offsetX, y: e.offsetY };
    });
    this.canvas.addEventListener("mousedown", (e) => {
      const btn = this.toButton(e.button);
      this.mouseDown.set(btn, true);
      if (btn === "middle" || btn === "right") {
        this.dragging = true;
      }
    });
    this.canvas.addEventListener("mouseup", (e) => {
      const btn = this.toButton(e.button);
      this.mouseDown.set(btn, false);
      if (btn === "left") {
        this.mouseClicked.set("left", { x: e.offsetX, y: e.offsetY });
      }
      if (btn === "right") {
        this.mouseClicked.set("right", { x: e.offsetX, y: e.offsetY });
      }
      this.dragging = false;
    });
    this.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.wheelDelta += e.deltaY > 0 ? -0.25 : 0.25;
    }, { passive: false });
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private toButton(b: number): MouseButton {
    if (b === 2) return "right";
    if (b === 1) return "middle";
    return "left";
  }

  /** Call at end of frame to reset per-frame state */
  flush() {
    this.keysPressed.clear();
    this.mouseClicked.set("left", null);
    this.mouseClicked.set("right", null);
    this.wheelDelta = 0;
    this.dragDelta = { x: 0, y: 0 };
  }

  /** Was key pressed this frame? */
  pressed(code: string): boolean {
    return this.keysPressed.has(code);
  }

  /** Is key currently held? */
  held(code: string): boolean {
    return this.keys.has(code);
  }

  /** Get left-click position this frame (or null) */
  leftClick(): ScreenPos | null {
    return this.mouseClicked.get("left") ?? null;
  }

  /** Get right-click position this frame (or null) */
  rightClick(): ScreenPos | null {
    return this.mouseClicked.get("right") ?? null;
  }
}
