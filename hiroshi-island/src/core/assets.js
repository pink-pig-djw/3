import {
  DataArrayTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  ClampToEdgeWrapping,
  UnsignedByteType,
  RGBAFormat,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const BASE = new URL('assets/', new URL(import.meta.env.BASE_URL, window.location.href)).href;

/**
 * Small asset loader with progress reporting. Everything the game needs is
 * produced by the Blender pipeline in /blender and lives in public/assets.
 */
export class Assets {
  constructor(renderer, onProgress = () => {}) {
    this.renderer = renderer;
    this.onProgress = onProgress;
    this.total = 0;
    this.done = 0;
    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);
    const draco = new DRACOLoader();
    draco.setDecoderPath(new URL('draco/', new URL(import.meta.env.BASE_URL, window.location.href)).href);
    draco.setDecoderConfig({ type: 'wasm' });
    this.gltfLoader.setDRACOLoader(draco);
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();
    this.cache = new Map();
  }

  url(path) {
    return BASE + path;
  }

  track(promise) {
    this.total++;
    this.onProgress(this.done, this.total);
    return promise.then((v) => {
      this.done++;
      this.onProgress(this.done, this.total);
      return v;
    });
  }

  async fetchOk(path) {
    const res = await fetch(this.url(path));
    if (!res.ok) throw new Error(`加载失败 ${path}: ${res.status}`);
    return res;
  }

  json(path) {
    return this.track(this.fetchOk(path).then((r) => r.json()));
  }

  floats(path) {
    return this.track(
      this.fetchOk(path)
        .then((r) => r.arrayBuffer())
        .then((b) => new Float32Array(b)),
    );
  }

  async decode(path, flipY = true) {
    const res = await this.fetchOk(path);
    const blob = await res.blob();
    return createImageBitmap(blob, {
      imageOrientation: flipY ? 'flipY' : 'from-image',
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
  }

  /** Regular 2D texture. */
  texture(path, { srgb = false, repeat = true, mips = true, aniso = true, flipY = true } = {}) {
    const key = `tex:${path}:${srgb}:${repeat}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const p = this.track(
      this.decode(path, flipY).then((bmp) => {
        const t = new Texture(bmp);
        // ImageBitmaps are already flipped while decoding
        t.flipY = false;
        t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
        t.wrapS = t.wrapT = repeat ? RepeatWrapping : ClampToEdgeWrapping;
        t.generateMipmaps = mips;
        t.minFilter = mips ? LinearMipmapLinearFilter : LinearFilter;
        t.magFilter = LinearFilter;
        if (aniso) t.anisotropy = Math.min(8, this.maxAniso);
        t.needsUpdate = true;
        return t;
      }),
    );
    this.cache.set(key, p);
    return p;
  }

  /** Several same-sized images packed into one sampler2DArray. */
  textureArray(paths, { srgb = false, size = 1024 } = {}) {
    return this.track(
      Promise.all(paths.map((p) => this.decode(p, true))).then((bitmaps) => {
        const layer = size * size * 4;
        const data = new Uint8Array(layer * bitmaps.length);
        const canvas = new OffscreenCanvas(size, size);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        bitmaps.forEach((bmp, i) => {
          ctx.clearRect(0, 0, size, size);
          ctx.drawImage(bmp, 0, 0, size, size);
          data.set(ctx.getImageData(0, 0, size, size).data, i * layer);
          bmp.close?.();
        });
        const tex = new DataArrayTexture(data, size, size, bitmaps.length);
        tex.format = RGBAFormat;
        tex.type = UnsignedByteType;
        tex.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
        tex.wrapS = tex.wrapT = RepeatWrapping;
        tex.generateMipmaps = true;
        tex.minFilter = LinearMipmapLinearFilter;
        tex.magFilter = LinearFilter;
        tex.anisotropy = Math.min(8, this.maxAniso);
        tex.needsUpdate = true;
        return tex;
      }),
    );
  }

  gltf(path) {
    return this.track(
      new Promise((resolve, reject) => {
        this.gltfLoader.load(this.url(path), resolve, undefined, reject);
      }),
    );
  }
}
