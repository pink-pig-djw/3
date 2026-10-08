/** Keyboard / mouse state with pointer lock. */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set(); // keys pressed this frame
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.buttons = new Set();
    this.clicked = new Set();
    this.locked = false;
    this.enabled = true;
    this.listeners = { lock: [], unlock: [] };

    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.buttons.add(e.button);
      this.clicked.add(e.button);
    });
    window.addEventListener('mouseup', (e) => this.buttons.delete(e.button));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener(
      'wheel',
      (e) => {
        if (!this.locked) return;
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      (this.locked ? this.listeners.lock : this.listeners.unlock).forEach((f) => f());
      if (!this.locked) {
        this.keys.clear();
        this.buttons.clear();
      }
    });
  }

  on(evt, fn) {
    this.listeners[evt].push(fn);
  }

  lock() {
    if (document.pointerLockElement !== this.canvas) {
      try {
        const r = this.canvas.requestPointerLock({ unadjustedMovement: true });
        if (r && r.catch) r.catch(() => this.canvas.requestPointerLock());
      } catch {
        this.canvas.requestPointerLock();
      }
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code) {
    return this.keys.has(code);
  }

  hit(code) {
    return this.pressed.has(code);
  }

  /** Call at the end of every frame. */
  endFrame() {
    this.pressed.clear();
    this.clicked.clear();
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
  }
}
