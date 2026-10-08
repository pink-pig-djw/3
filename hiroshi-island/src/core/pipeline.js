import {
  BlendFunction,
  BloomEffect,
  Effect,
  EffectComposer,
  EffectPass,
  Pass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import {
  CustomBlending,
  DstColorFactor,
  HalfFloatType,
  LinearFilter,
  Mesh,
  OneFactor,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Uniform,
  Vector2,
  WebGLRenderTarget,
  ZeroFactor,
} from 'three';
import { WATER_LAYER } from '../world/water.js';

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

class FullScreen {
  constructor(material) {
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new Scene();
    this.mesh = new Mesh(new PlaneGeometry(2, 2), material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }
  render(renderer, target) {
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
  }
}

/**
 * Renders the world in three steps so the water can see what is below and
 * around it:
 *   1. opaque scene -> composer input buffer (colour + depth texture)
 *   2. copy colour + linear depth -> refraction target
 *   3. water on top, sampling the refraction target (refraction, absorption, SSR)
 *   4. exposure (multiply in place) so later effects work on exposed values
 */
export class WorldPass extends Pass {
  constructor(scene, camera, water) {
    super('WorldPass', scene, camera);
    this.needsSwap = false;
    this.needsDepthBlit = true;
    this.needsDepthTexture = true;
    this.water = water;
    this.exposure = 1;
    this.refrScale = 1;
    this.refrRT = new WebGLRenderTarget(1, 1, {
      type: HalfFloatType,
      depthBuffer: false,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
    });
    this.copy = new FullScreen(
      new ShaderMaterial({
        uniforms: {
          tColor: { value: null },
          tDepth: { value: null },
          cameraNear: { value: 0.1 },
          cameraFar: { value: 1000 },
        },
        vertexShader: FS_VERT,
        fragmentShader: /* glsl */ `
          #include <packing>
          uniform sampler2D tColor;
          uniform sampler2D tDepth;
          uniform float cameraNear;
          uniform float cameraFar;
          varying vec2 vUv;
          void main() {
            float d = texture2D(tDepth, vUv).r;
            float z = d >= 1.0 ? 60000.0 : -perspectiveDepthToViewZ(d, cameraNear, cameraFar);
            gl_FragColor = vec4(texture2D(tColor, vUv).rgb, z);
          }`,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.expose = new FullScreen(
      new ShaderMaterial({
        uniforms: { uExposure: { value: 1 } },
        vertexShader: FS_VERT,
        fragmentShader: 'uniform float uExposure; void main(){ gl_FragColor = vec4(vec3(uExposure), 1.0); }',
        depthTest: false,
        depthWrite: false,
        blending: CustomBlending,
        blendSrc: DstColorFactor,
        blendDst: ZeroFactor,
        blendSrcAlpha: ZeroFactor,
        blendDstAlpha: OneFactor,
      }),
    );
  }

  setSize(width, height) {
    this.refrRT.setSize(Math.max(1, Math.round(width * this.refrScale)), Math.max(1, Math.round(height * this.refrScale)));
    if (this.water) this.water.userData.uniforms.uRes.value.set(width, height);
  }

  render(renderer, inputBuffer) {
    const { scene, camera } = this;
    const prevAuto = renderer.autoClear;
    const shadow = renderer.shadowMap;

    // 1. opaque world
    renderer.autoClear = false;
    renderer.setRenderTarget(inputBuffer);
    renderer.clear(true, true, false);
    camera.layers.set(0);
    shadow.needsUpdate = true;
    renderer.render(scene, camera);

    if (this.water && this.water.visible) {
      // 2. refraction source
      const m = this.copy.mesh.material;
      m.uniforms.tColor.value = inputBuffer.texture;
      m.uniforms.tDepth.value = inputBuffer.depthTexture;
      m.uniforms.cameraNear.value = camera.near;
      m.uniforms.cameraFar.value = camera.far;
      this.copy.render(renderer, this.refrRT);
      this.water.userData.uniforms.tRefr.value = this.refrRT.texture;
      // 3. water surface
      camera.layers.set(WATER_LAYER);
      renderer.setRenderTarget(inputBuffer);
      renderer.render(scene, camera);
      camera.layers.set(0);
    }

    // 4. exposure
    this.expose.mesh.material.uniforms.uExposure.value = this.exposure;
    this.expose.render(renderer, inputBuffer);
    renderer.autoClear = prevAuto;
  }
}

/**
 * Physically based depth of field: circle of confusion from a 35 mm camera
 * model (focal length, f-number, focus distance), gathered at half resolution
 * with a golden-angle spiral, so bright points bloom into round bokeh.
 */
export class DOFPass extends Pass {
  constructor(camera) {
    super('DOFPass');
    this.camera = camera;
    this.needsDepthTexture = true;
    this.needsSwap = true;
    this.focus = 5; // m
    this.focal = 35; // mm
    this.fstop = 2.8;
    this.sensor = 24; // mm (height)
    const rtOpts = { type: HalfFloatType, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter };
    this.cocRT = new WebGLRenderTarget(1, 1, rtOpts);
    this.blurRT = new WebGLRenderTarget(1, 1, rtOpts);
    const common = {
      tDepth: new Uniform(null),
      cameraNear: new Uniform(0.1),
      cameraFar: new Uniform(1000),
      uFocus: new Uniform(5000),
      uFocal: new Uniform(35),
      uAperture: new Uniform(12.5),
      uPxPerMm: new Uniform(40),
      uMaxCoc: new Uniform(18),
    };
    const COC = /* glsl */ `
      #include <packing>
      uniform sampler2D tDepth;
      uniform float cameraNear, cameraFar, uFocus, uFocal, uAperture, uPxPerMm, uMaxCoc;
      float linearDepthMM(vec2 uv) {
        float d = texture2D(tDepth, uv).r;
        if (d >= 1.0) return 1e8;
        return -perspectiveDepthToViewZ(d, cameraNear, cameraFar) * 1000.0;
      }
      // signed CoC radius in full-resolution pixels (negative = in front of the focus plane)
      float cocRadius(vec2 uv) {
        float D = linearDepthMM(uv);
        float c = uAperture * uFocal * (D - uFocus) / (D * max(uFocus - uFocal, 1.0));
        return clamp(c * 0.5 * uPxPerMm, -uMaxCoc, uMaxCoc);
      }`;
    this.cocMat = new ShaderMaterial({
      uniforms: { ...common, tColor: new Uniform(null), uTexel: new Uniform(new Vector2()) },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */ `
        ${COC}
        uniform sampler2D tColor;
        uniform vec2 uTexel;
        varying vec2 vUv;
        void main() {
          // 4-tap downsample, weighted against fireflies
          vec3 c = vec3(0.0); float w = 0.0;
          for (int i = 0; i < 4; i++) {
            vec2 o = vec2(i % 2 == 0 ? -0.5 : 0.5, i < 2 ? -0.5 : 0.5) * uTexel;
            vec3 s = texture2D(tColor, vUv + o).rgb;
            float k = 1.0 / (1.0 + dot(s, vec3(0.2126, 0.7152, 0.0722)) * 0.02);
            c += s * k; w += k;
          }
          gl_FragColor = vec4(c / w, cocRadius(vUv) * 0.5);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.blurMat = new ShaderMaterial({
      uniforms: { tCoc: new Uniform(null), uTexel: new Uniform(new Vector2()), uMax: new Uniform(9) },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tCoc;
        uniform vec2 uTexel;
        uniform float uMax;
        varying vec2 vUv;
        const float GOLDEN = 2.39996323;
        const int N = 64;
        void main() {
          vec4 center = texture2D(tCoc, vUv);
          float cs = abs(center.a);
          vec3 acc = center.rgb;
          float tot = 1.0;
          float R = max(uMax, 1.0);
          for (int i = 1; i < N; i++) {
            float fi = float(i);
            float r = sqrt(fi / float(N)) * R;
            float a = fi * GOLDEN;
            vec2 uv = vUv + vec2(cos(a), sin(a)) * r * uTexel;
            vec4 s = texture2D(tCoc, uv);
            float ss = abs(s.a);
            // a sample behind the centre can't blur over it more than the centre's own CoC
            if (s.a > center.a) ss = clamp(ss, 0.0, cs * 2.0);
            float m = smoothstep(r - 0.75, r + 0.75, ss);
            acc += mix(acc / tot, s.rgb, m);
            tot += 1.0;
          }
          gl_FragColor = vec4(acc / tot, center.a);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.compMat = new ShaderMaterial({
      uniforms: { ...common, tColor: new Uniform(null), tBlur: new Uniform(null) },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */ `
        ${COC}
        uniform sampler2D tColor;
        uniform sampler2D tBlur;
        varying vec2 vUv;
        void main() {
          vec4 sharp = texture2D(tColor, vUv);
          vec4 blur = texture2D(tBlur, vUv);
          float c = abs(cocRadius(vUv));
          float t = smoothstep(0.6, 2.2, c);
          // near-field blur also spills over sharp background
          t = max(t, smoothstep(0.8, 3.0, -blur.a * 2.0));
          gl_FragColor = vec4(mix(sharp.rgb, blur.rgb, t), sharp.a);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.fsCoc = new FullScreen(this.cocMat);
    this.fsBlur = new FullScreen(this.blurMat);
    this.fsComp = new FullScreen(this.compMat);
    this.common = common;
    this.size = new Vector2(1, 1);
  }

  setDepthTexture(depthTexture) {
    this.common.tDepth.value = depthTexture;
  }

  setSize(w, h) {
    this.size.set(w, h);
    const hw = Math.max(1, Math.floor(w / 2));
    const hh = Math.max(1, Math.floor(h / 2));
    this.cocRT.setSize(hw, hh);
    this.blurRT.setSize(hw, hh);
    this.cocMat.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.blurMat.uniforms.uTexel.value.set(1 / hw, 1 / hh);
  }

  render(renderer, inputBuffer, outputBuffer) {
    const c = this.common;
    c.cameraNear.value = this.camera.near;
    c.cameraFar.value = this.camera.far;
    c.uFocus.value = this.focus * 1000;
    c.uFocal.value = this.focal;
    c.uAperture.value = this.focal / this.fstop;
    c.uPxPerMm.value = this.size.y / this.sensor;
    c.uMaxCoc.value = Math.min(this.size.y * 0.02, 26);
    this.blurMat.uniforms.uMax.value = c.uMaxCoc.value * 0.5;
    this.cocMat.uniforms.tColor.value = inputBuffer.texture;
    this.fsCoc.render(renderer, this.cocRT);
    this.blurMat.uniforms.tCoc.value = this.cocRT.texture;
    this.fsBlur.render(renderer, this.blurRT);
    this.compMat.uniforms.tColor.value = inputBuffer.texture;
    this.compMat.uniforms.tBlur.value = this.blurRT.texture;
    this.fsComp.render(renderer, this.renderToScreen ? null : outputBuffer);
  }
}

/** Post tone-mapping look: contrast, saturation, warmth, vignette, grain. */
class LookEffect extends Effect {
  constructor() {
    super(
      'LookEffect',
      /* glsl */ `
      uniform float uContrast;
      uniform float uSat;
      uniform float uWarmth;
      uniform float uVignette;
      uniform float uGrain;
      uniform float uTime;
      uniform float uNight;
      float hashL(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        // night vision: dim areas lose colour and shift to blue, lights stay warm
        float pk = uNight * (1.0 - smoothstep(0.25, 0.85, l));
        c = mix(c, l * vec3(0.62, 0.8, 1.15), pk * 0.6);
        c = mix(vec3(l), c, uSat);
        c = (c - 0.5) * uContrast + 0.5;
        c *= vec3(1.0 + uWarmth, 1.0 + uWarmth * 0.2, 1.0 - uWarmth);
        vec2 q = uv - 0.5;
        q.x *= 1.25;
        float v = 1.0 - smoothstep(0.35, 0.95, length(q)) * uVignette;
        c *= v;
        float g = hashL(uv * 1024.0 + fract(uTime) * 97.0) - 0.5;
        c += g * uGrain * (0.35 + 0.65 * (1.0 - l));
        outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
      }`,
      {
        blendFunction: BlendFunction.NORMAL,
        uniforms: new Map([
          ['uContrast', new Uniform(1.03)],
          ['uSat', new Uniform(1.05)],
          ['uWarmth', new Uniform(0)],
          ['uVignette', new Uniform(0.28)],
          ['uGrain', new Uniform(0.018)],
          ['uTime', new Uniform(0)],
          ['uNight', new Uniform(0)],
        ]),
      },
    );
  }
  update(renderer, inputBuffer, dt) {
    this.uniforms.get('uTime').value += dt;
  }
}

export class Pipeline {
  constructor(renderer, scene, camera, water, quality) {
    this.renderer = renderer;
    this.quality = quality;
    this.composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling: 0, stencilBuffer: false });
    this.world = new WorldPass(scene, camera, water);
    this.world.refrScale = quality.refrScale;
    this.composer.addPass(this.world);

    if (quality.ao) {
      this.ao = new N8AOPostPass(scene, camera, 1, 1);
      this.ao.autoDetectTransparency = false;
      Object.assign(this.ao.configuration, {
        aoRadius: 1.6,
        distanceFalloff: 0.6,
        intensity: 2.2,
        halfRes: quality.aoHalfRes,
        aoSamples: quality.aoSamples,
        denoiseSamples: 6,
        denoiseRadius: 10,
        gammaCorrection: false,
        transparencyAware: false,
        screenSpaceRadius: false,
        depthAwareUpsampling: true,
      });
      this.composer.addPass(this.ao);
    }

    this.dof = new DOFPass(camera);
    this.dof.enabled = false;
    this.composer.addPass(this.dof);

    this.bloom = new BloomEffect({
      mipmapBlur: true,
      luminanceThreshold: 0.95,
      luminanceSmoothing: 0.35,
      intensity: 0.55,
      radius: 0.72,
    });
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    this.look = new LookEffect();
    this.composer.addPass(new EffectPass(camera, this.bloom, this.tone, this.look));
    this.smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });
    this.composer.addPass(new EffectPass(camera, this.smaa));
  }

  setSize(w, h) {
    this.composer.setSize(w, h, false);
  }

  setLook({ contrast, sat, warmth, vignette, grain, night }) {
    const u = this.look.uniforms;
    if (night !== undefined) u.get('uNight').value = night;
    if (contrast !== undefined) u.get('uContrast').value = contrast;
    if (sat !== undefined) u.get('uSat').value = sat;
    if (warmth !== undefined) u.get('uWarmth').value = warmth;
    if (vignette !== undefined) u.get('uVignette').value = vignette;
    if (grain !== undefined) u.get('uGrain').value = grain;
  }

  render(dt) {
    this.composer.render(dt);
  }
}
