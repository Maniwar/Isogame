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

  // Touch state
  private touchStartPos: ScreenPos | null = null;
  private touchStartTime = 0;
  private twoFingerDist = 0;
  private isTouchDragging = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.bind();
    this.bindTouch();
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

  /**
   * Touch input mapping:
   *   - Single tap → left click (move / interact)
   *   - Single finger drag → pan camera
   *   - Two-finger pinch → zoom
   */
  private bindTouch() {
    this.canvas.addEventListener("touchstart", (e) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        const t = e.touches[0];
        const pos = this.touchPos(t);
        this.touchStartPos = pos;
        this.touchStartTime = Date.now();
        this.isTouchDragging = false;
        this.mouse = pos;
        this.lastMouse = pos;
      }
      if (e.touches.length === 2) {
        this.twoFingerDist = this.pinchDist(e.touches);
      }
    }, { passive: false });

    this.canvas.addEventListener("touchmove", (e) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        const t = e.touches[0];
        const pos = this.touchPos(t);
        this.mouse = pos;

        // Start dragging after 8px movement threshold
        if (this.touchStartPos) {
          const dx = pos.x - this.touchStartPos.x;
          const dy = pos.y - this.touchStartPos.y;
          if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
            this.isTouchDragging = true;
          }
        }

        if (this.isTouchDragging) {
          this.dragging = true;
          this.dragDelta.x += pos.x - this.lastMouse.x;
          this.dragDelta.y += pos.y - this.lastMouse.y;
        }
        this.lastMouse = pos;
      }
      if (e.touches.length === 2) {
        const newDist = this.pinchDist(e.touches);
        const delta = newDist - this.twoFingerDist;
        // Convert pinch distance to zoom (scale sensitivity)
        if (Math.abs(delta) > 2) {
          this.wheelDelta += delta > 0 ? 0.05 : -0.05;
          this.twoFingerDist = newDist;
        }
      }
    }, { passive: false });

    this.canvas.addEventListener("touchend", (e) => {
      e.preventDefault();
      if (e.changedTouches.length >= 1 && !this.isTouchDragging) {
        // Tap = left click (only if we didn't drag)
        const t = e.changedTouches[0];
        const pos = this.touchPos(t);
        const elapsed = Date.now() - this.touchStartTime;
        if (elapsed < 300) {
          this.mouseClicked.set("left", pos);
        }
      }
      this.dragging = false;
      this.isTouchDragging = false;
      this.touchStartPos = null;
    }, { passive: false });
  }

  private touchPos(t: Touch): ScreenPos {
    const rect = this.canvas.getBoundingClientRect();
    // Return CSS-pixel coordinates (not physical pixels).
    // All game UI and camera code works in CSS-pixel space.
    return {
      x: t.clientX - rect.left,
      y: t.clientY - rect.top,
    };
  }

  private pinchDist(touches: TouchList): number {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
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

  /** Inject a virtual key press (for on-screen buttons) */
  injectKey(code: string) {
    this.keysPressed.add(code);
  }

  /** Detect if we're on a touch device */
  static isTouchDevice(): boolean {
    return "ontouchstart" in window || navigator.maxTouchPoints > 0;
  }
}
