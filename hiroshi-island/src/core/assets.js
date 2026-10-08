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

const ROOT = new URL(import.meta.env.BASE_URL, document.baseURI);
const BASE = new URL('assets/', ROOT).href;

// The single-page web build (tools/build-web.mjs) ships the models without
// Draco, so nothing needs WebAssembly, and gzips the binary files itself. Its
// pack manifest says where each asset went: `files[path]` is either a renamed
// file next to the page ({ url, gz, text }: `text` files hold base64, since the
// host serves no raw binary type) or, in the offline single-file version, the
// bytes themselves ({ b64, gz }).
const PACKED = import.meta.env.MODE === 'web';
const PACK = (PACKED && globalThis.__HIROSHI_PACK__) || { files: {} };

const MIME = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg' };

function fromBase64(s) {
  if (Uint8Array.fromBase64) return Uint8Array.fromBase64(s);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function gunzip(bytes) {
  // a host may already have undone the gzip (Content-Encoding): check the magic number
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

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
    if (!PACKED) {
      const draco = new DRACOLoader();
      draco.setDecoderPath(new URL('draco/', ROOT).href);
      this.gltfLoader.setDRACOLoader(draco);
    }
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

  /** The bytes of an asset, wherever the build put them. */
  async bytes(path) {
    const entry = PACK.files[path];
    let data;
    if (typeof entry?.b64 === 'string') data = fromBase64(entry.b64);
    else {
      const res = await fetch(entry?.url ? new URL(entry.url, BASE).href : this.url(path));
      if (!res.ok) throw new Error(`加载失败 ${path}: ${res.status}`);
      data = entry?.text ? fromBase64((await res.text()).trim()) : new Uint8Array(await res.arrayBuffer());
    }
    return entry?.gz ? gunzip(data) : data;
  }

  json(path) {
    return this.track(this.bytes(path).then((b) => JSON.parse(new TextDecoder().decode(b))));
  }

  floats(path) {
    return this.track(
      this.bytes(path).then((b) => (b.byteOffset % 4 ? new Float32Array(b.slice().buffer) : new Float32Array(b.buffer, b.byteOffset, b.byteLength >> 2))),
    );
  }

  async decode(path, flipY = true) {
    const blob = new Blob([await this.bytes(path)], { type: MIME[path.split('.').pop()] ?? '' });
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
      this.bytes(path).then((b) => {
        const buf = b.byteOffset === 0 && b.byteLength === b.buffer.byteLength ? b.buffer : b.slice().buffer;
        return this.gltfLoader.parseAsync(buf, '');
      }),
    );
  }
}
