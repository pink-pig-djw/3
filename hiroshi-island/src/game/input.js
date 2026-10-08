const TOUCH_LOOK = 1.5; // touch drags turn a little faster than the same mouse distance
const STICK = 52; // virtual stick radius, CSS px

/**
 * Keyboard, mouse and touch state.
 *
 * Mouse look uses pointer lock when the browser grants it. Where it doesn't
 * (some embedded frames and app views) the game stays playable by dragging to
 * look, and a short click still counts as a click. On touch screens the left
 * part of the screen is a floating stick, the rest drags the view, and the
 * on-screen buttons feed `tap()`.
 */
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
    this.active = false; // gameplay controls are live, see lock() / unlock()
    this.locked = false; // pointer lock held
    this.lockFailures = 0;
    this.enabled = true;
    this.touch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    this.move = { x: 0, y: 0, run: false }; // virtual stick
    this.drag = null;
    this.stick = null;
    this.look = null;
    this.onStick = null; // (state | null) => void, draws the stick
    this.listeners = { lock: [], unlock: [], mode: [] };

    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.release());

    // ------------------------------------------------------------- mouse
    window.addEventListener('mousemove', (e) => {
      if (this.locked) {
        this.dx += e.movementX;
        this.dy += e.movementY;
      } else if (this.drag) {
        const mx = e.clientX - this.drag.x;
        const my = e.clientY - this.drag.y;
        this.drag.x = e.clientX;
        this.drag.y = e.clientY;
        this.drag.moved += Math.abs(mx) + Math.abs(my);
        this.dx += mx;
        this.dy += my;
      }
    });
    canvas.addEventListener('mousedown', (e) => {
      this.setTouch(false);
      if (!this.active) return;
      this.buttons.add(e.button);
      if (this.locked) {
        this.clicked.add(e.button);
        return;
      }
      this.requestLock();
      if (this.drag) {
        // another button while dragging (right button held to aim): a plain click
        this.clicked.add(e.button);
        return;
      }
      this.drag = { x: e.clientX, y: e.clientY, moved: 0, t: performance.now(), button: e.button };
      canvas.classList.add('dragging');
    });
    window.addEventListener('mouseup', (e) => {
      this.buttons.delete(e.button);
      const d = this.drag;
      if (d && e.button === d.button) {
        if (d.moved < 6 && performance.now() - d.t < 500) this.clicked.add(e.button);
        this.endDrag();
      }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener(
      'wheel',
      (e) => {
        if (this.active) this.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === canvas;
      if (this.locked) {
        this.lockFailures = 0;
        this.endDrag();
        this.emit('lock');
      } else if (was) {
        this.keys.clear();
        this.buttons.clear();
        // lost without unlock(): Esc, or the browser took it back
        if (this.active) this.emit('unlock');
      }
    });
    document.addEventListener('pointerlockerror', () => this.lockFailures++);

    // ------------------------------------------------------------- touch
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      e.preventDefault();
      this.setTouch(true);
      if (!this.active) return;
      canvas.setPointerCapture?.(e.pointerId);
      if (!this.stick && e.clientX < window.innerWidth * 0.4) {
        this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
        this.updateStick();
      } else if (!this.look) {
        this.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') return;
      if (this.stick?.id === e.pointerId) {
        this.stick.x = e.clientX;
        this.stick.y = e.clientY;
        this.updateStick();
      } else if (this.look?.id === e.pointerId) {
        this.dx += (e.clientX - this.look.x) * TOUCH_LOOK;
        this.dy += (e.clientY - this.look.y) * TOUCH_LOOK;
        this.look.x = e.clientX;
        this.look.y = e.clientY;
      }
    });
    const lift = (e) => {
      if (this.stick?.id === e.pointerId) {
        this.stick = null;
        this.updateStick();
      }
      if (this.look?.id === e.pointerId) this.look = null;
    };
    canvas.addEventListener('pointerup', lift);
    canvas.addEventListener('pointercancel', lift);
  }

  on(evt, fn) {
    this.listeners[evt].push(fn);
  }

  emit(evt, ...args) {
    this.listeners[evt].forEach((f) => f(...args));
  }

  setTouch(on) {
    if (this.touch === on) return;
    this.touch = on;
    this.emit('mode', on);
  }

  /** Gameplay controls on; grabs the mouse where the browser allows it. */
  lock() {
    this.active = true;
    this.requestLock();
  }

  /** Gameplay controls off, mouse released. */
  unlock() {
    this.active = false;
    this.release();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  requestLock() {
    if (this.touch || this.locked || this.lockFailures >= 3 || !this.canvas.requestPointerLock) return;
    // without a recent click the browser refuses anyway; the next click on the view tries again
    if (navigator.userActivation && !navigator.userActivation.isActive) return;
    try {
      this.canvas.requestPointerLock()?.catch?.(() => {});
    } catch {
      this.lockFailures++;
    }
  }

  endDrag() {
    this.drag = null;
    this.canvas.classList.remove('dragging');
  }

  /** Forget everything held down (focus lost, controls switched off). */
  release() {
    this.keys.clear();
    this.buttons.clear();
    this.endDrag();
    this.look = null;
    if (this.stick) {
      this.stick = null;
      this.updateStick();
    }
  }

  updateStick() {
    const s = this.stick;
    if (!s) {
      this.move.x = this.move.y = 0;
      this.move.run = false;
      this.onStick?.(null);
      return;
    }
    let vx = (s.x - s.ox) / STICK;
    let vy = (s.y - s.oy) / STICK;
    const len = Math.hypot(vx, vy);
    // pushed well past the rim: walk faster
    this.move.run = len > 1.35;
    if (len < 0.12) vx = vy = 0;
    else if (len > 1) {
      vx /= len;
      vy /= len;
    }
    this.move.x = vx;
    this.move.y = -vy;
    this.onStick?.({ ox: s.ox, oy: s.oy, kx: vx * STICK, ky: vy * STICK, run: this.move.run });
  }

  /** On-screen buttons: a key press for one frame. */
  tap(code) {
    this.pressed.add(code);
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
