"""Shrinks a VRoid VRM 1.0 file for the web while keeping every VRM extension intact.

- textures -> WebP, face textures capped at 1024 px, everything else at 512 px
- keeps only the facial morph targets used by the expressions the game plays
  (and drops morph normals)
- packs skin weights / joints / UVs / indices into smaller integer types

Only accessors and bufferViews are re-indexed; nodes, meshes, materials,
textures and images keep their indices, so the VRM extensions stay valid.

Usage: python3 tools/slim_vrm.py <in.vrm> <out.vrm>
"""
import io
import json
import struct
import sys
from collections import defaultdict

import numpy as np
from PIL import Image

KEEP_EXPRESSIONS = {'happy', 'angry', 'sad', 'surprised', 'blink', 'blinkLeft', 'blinkRight', 'aa', 'oh'}
FACE_TEX = 1024
OTHER_TEX = 512

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read_glb(path):
    data = open(path, 'rb').read()
    magic, _, _ = struct.unpack_from('<III', data, 0)
    assert magic == 0x46546C67, 'not a GLB'
    jlen, _ = struct.unpack_from('<II', data, 12)
    js = json.loads(data[20:20 + jlen])
    blen, _ = struct.unpack_from('<II', data, 20 + jlen)
    binary = data[28 + jlen:28 + jlen + blen]
    return js, binary


def write_glb(path, js, binary):
    jbytes = json.dumps(js, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    jbytes += b' ' * ((4 - len(jbytes) % 4) % 4)
    binary = bytes(binary) + b'\0' * ((4 - len(binary) % 4) % 4)
    total = 12 + 8 + len(jbytes) + 8 + len(binary)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(jbytes), 0x4E4F534A))
        f.write(jbytes)
        f.write(struct.pack('<II', len(binary), 0x004E4942))
        f.write(binary)


def read_accessor(js, binary, idx):
    a = js['accessors'][idx]
    assert 'sparse' not in a, 'sparse accessors are not supported'
    bv = js['bufferViews'][a['bufferView']]
    dt = np.dtype(CT[a['componentType']])
    n = NC[a['type']]
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride', n * dt.itemsize)
    if stride == n * dt.itemsize:
        arr = np.frombuffer(binary, dtype=dt, count=a['count'] * n, offset=start).reshape(a['count'], n)
    else:
        rows = [np.frombuffer(binary, dtype=dt, count=n, offset=start + i * stride) for i in range(a['count'])]
        arr = np.stack(rows)
    return arr.copy()


def images_of(obj, out):
    """Collect every {"index": n} texture reference inside a material."""
    if isinstance(obj, dict):
        if 'index' in obj and isinstance(obj['index'], int) and len(obj) <= 4:
            out.add(obj['index'])
        for v in obj.values():
            images_of(v, out)
    elif isinstance(obj, list):
        for v in obj:
            images_of(v, out)


def main(src, dst):
    js, binary = read_glb(src)
    vrm = js['extensions']['VRMC_vrm']

    # ---------- expressions -> morph targets to keep ----------
    used = defaultdict(set)
    for kind in ('preset', 'custom'):
        for name, e in vrm.get('expressions', {}).get(kind, {}).items():
            if kind == 'preset' and name in KEEP_EXPRESSIONS:
                for b in e.get('morphTargetBinds', []):
                    used[js['nodes'][b['node']]['mesh']].add(b['index'])
            else:
                e['morphTargetBinds'] = []
    remap = {}
    for mi, mesh in enumerate(js['meshes']):
        if not mesh['primitives'][0].get('targets'):
            continue
        keep = sorted(used[mi])
        remap[mi] = {old: new for new, old in enumerate(keep)}
        for p in mesh['primitives']:
            p['targets'] = [{'POSITION': p['targets'][i]['POSITION']} for i in keep]
            if not p['targets']:
                del p['targets']
            if 'extras' in p and 'targetNames' in p['extras']:
                p['extras']['targetNames'] = [p['extras']['targetNames'][i] for i in keep]
        if 'weights' in mesh:
            mesh['weights'] = [mesh['weights'][i] for i in keep]
        if 'extras' in mesh and 'targetNames' in mesh['extras']:
            mesh['extras']['targetNames'] = [mesh['extras']['targetNames'][i] for i in keep]
    for kind in ('preset', 'custom'):
        for e in vrm.get('expressions', {}).get(kind, {}).values():
            for b in e.get('morphTargetBinds', []):
                b['index'] = remap[js['nodes'][b['node']]['mesh']][b['index']]

    # ---------- rebuild buffer ----------
    out = bytearray()
    new_bvs = []

    def push(data, target=None):
        while len(out) % 4:
            out.append(0)
        bv = {'buffer': 0, 'byteOffset': len(out), 'byteLength': len(data)}
        if target:
            bv['target'] = target
        out.extend(data)
        new_bvs.append(bv)
        return len(new_bvs) - 1

    # images
    face_images = set()
    for m in js['materials']:
        if any(k in m.get('name', '') for k in ('FACE', 'EYE', 'Face_00_SKIN')):
            tex = set()
            images_of(m, tex)
            face_images |= {js['textures'][t]['source'] for t in tex if t < len(js['textures'])}
    thumb = vrm.get('meta', {}).get('thumbnailImage')
    for ii, img in enumerate(js['images']):
        bv = js['bufferViews'][img['bufferView']]
        raw = binary[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]
        im = Image.open(io.BytesIO(raw))
        im.load()
        if max(im.size) <= 16:
            img['bufferView'] = push(raw)
            continue
        limit = 64 if ii == thumb else (FACE_TEX if ii in face_images else OTHER_TEX)
        if max(im.size) > limit:
            s = limit / max(im.size)
            im = im.resize((max(1, round(im.size[0] * s)), max(1, round(im.size[1] * s))), Image.LANCZOS)
        has_alpha = im.mode in ('RGBA', 'LA', 'P') and im.convert('RGBA').getextrema()[3][0] < 255
        im = im.convert('RGBA' if has_alpha else 'RGB')
        buf = io.BytesIO()
        im.save(buf, 'WEBP', quality=86, method=6)
        img['bufferView'] = push(buf.getvalue())
        img['mimeType'] = 'image/webp'

    # accessors
    new_acc = []
    acc_map = {}

    def convert(idx, role):
        if (idx, role) in acc_map:
            return acc_map[(idx, role)]
        a = dict(js['accessors'][idx])
        arr = read_accessor(js, binary, idx)
        a.pop('byteOffset', None)
        target = 34962
        if role == 'WEIGHTS_0' and a['componentType'] == 5126:
            w = np.clip(arr, 0, 1)
            s = w.sum(axis=1, keepdims=True)
            s[s == 0] = 1
            q = np.floor(w / s * 255 + 0.5).astype(np.int32)
            # keep the sum at exactly 255 by fixing up the largest weight
            diff = 255 - q.sum(axis=1)
            top = q.argmax(axis=1)
            q[np.arange(len(q)), top] += diff
            arr = np.clip(q, 0, 255).astype(np.uint8)
            a['componentType'] = 5121
            a['normalized'] = True
        elif role == 'JOINTS_0' and arr.max() < 256:
            arr = arr.astype(np.uint8)
            a['componentType'] = 5121
        elif role == 'TEXCOORD_0' and a['componentType'] == 5126 and arr.min() >= 0 and arr.max() <= 1:
            arr = np.floor(arr * 65535 + 0.5).astype(np.uint16)
            a['componentType'] = 5123
            a['normalized'] = True
        elif role == 'indices':
            target = 34963
            if arr.max() < 65536:
                arr = arr.astype(np.uint16)
                a['componentType'] = 5123
        elif role == 'ibm':
            target = None
        a['bufferView'] = push(arr.tobytes(), target)
        new_acc.append(a)
        acc_map[(idx, role)] = len(new_acc) - 1
        return acc_map[(idx, role)]

    for mesh in js['meshes']:
        for p in mesh['primitives']:
            p['attributes'].pop('TANGENT', None)
            p['attributes'] = {k: convert(v, k) for k, v in p['attributes'].items()}
            if 'indices' in p:
                p['indices'] = convert(p['indices'], 'indices')
            for t in p.get('targets', []):
                t['POSITION'] = convert(t['POSITION'], 'morph')
    for skin in js.get('skins', []):
        if 'inverseBindMatrices' in skin:
            skin['inverseBindMatrices'] = convert(skin['inverseBindMatrices'], 'ibm')

    js['accessors'] = new_acc
    js['bufferViews'] = new_bvs
    js['buffers'] = [{'byteLength': len(out)}]
    write_glb(dst, js, out)
    print(f'{src} -> {dst}: {len(out) / 1e6:.2f} MB binary')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
