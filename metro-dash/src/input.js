// Swipes (touch or mouse drag), double-tap, and keyboard.
export class Input {
  constructor(target, handler) {
    this.h = handler;
    this.start = null;
    this.lastTap = 0;
    const SWIPE = 26;

    target.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      this.start = { x: e.clientX, y: e.clientY, t: performance.now(), fired: false, id: e.pointerId };
    });
    target.addEventListener('pointermove', (e) => {
      const s = this.start;
      if (!s || s.fired || s.id !== e.pointerId) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (Math.hypot(dx, dy) < SWIPE) return;
      s.fired = true;
      if (Math.abs(dx) > Math.abs(dy)) this.h(dx > 0 ? 'right' : 'left');
      else this.h(dy > 0 ? 'down' : 'up');
    });
    const end = (e) => {
      const s = this.start;
      this.start = null;
      if (!s || s.fired || s.id !== e.pointerId) return;
      if (performance.now() - s.t < 300) {
        const now = performance.now();
        if (now - this.lastTap < 320) { this.h('double'); this.lastTap = 0; }
        else { this.lastTap = now; this.h('tap'); }
      }
    };
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', () => { this.start = null; });

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const map = {
        ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
        ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
        Space: 'double', Escape: 'pause', KeyP: 'pause', Enter: 'enter',
      };
      const a = map[e.code];
      if (!a) return;
      if (e.target instanceof HTMLElement && e.target.closest('button') && (a === 'enter' || e.code === 'Space')) return;
      e.preventDefault();
      this.h(a);
    });
  }
}
