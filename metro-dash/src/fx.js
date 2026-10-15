// Lightweight particle system (one Points draw call) for sparkles, flames and dust.
import * as THREE from 'three';
import { BEND, curveUniforms } from './curve.js';
import { makeGlowTexture } from './textures.js';

const MAX = 900;

export class Particles {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.baseSize = new Float32Array(MAX);
    this.grav = new Float32Array(MAX);
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.PointsMaterial({
      size: 1, map: makeGlowTexture(), vertexColors: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    // per-particle size + the curved-world bend
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uCurveY = curveUniforms.uCurveY;
      shader.uniforms.uCurveX = curveUniforms.uCurveX;
      shader.vertexShader = 'uniform float uCurveY;\nuniform float uCurveX;\nattribute float size;\n' +
        shader.vertexShader.replace('uniform float size;', '').replace('#include <project_vertex>', BEND);
    };
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(x, y, z, { n = 6, color = 0xffd23f, speed = 3, up = 1, life = 0.5, size = 0.5, gravity = 6, vz = 0 } = {}) {
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * speed;
      this.vel[i * 3] = Math.cos(a) * r;
      this.vel[i * 3 + 1] = up * (0.5 + Math.random()) * speed * 0.6;
      this.vel[i * 3 + 2] = Math.sin(a) * r + vz;
      this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
      this.life[i] = this.maxLife[i] = life * (0.6 + Math.random() * 0.6);
      this.baseSize[i] = size * (0.6 + Math.random() * 0.8);
      this.grav[i] = gravity;
    }
  }

  update(dt) {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) { this.size[i] = 0; continue; }
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.baseSize[i] * t;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.size.fill(0);
  }
}
