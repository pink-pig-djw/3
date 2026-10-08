"""Coconut palms (Cocos nucifera), four variants matching the page's layout.

    python palms.py ../assets/models

Each palm is one object with two materials:
  'bark'  — trunk and the mass of roots at its foot (UVs for the tileable bark texture: u around, v up, 1 tile = 1 m)
  'crown' — fronds (one textured card per leaflet, UVs into the foliage atlas), leaf bases and coconuts
Vertex attributes: COLOR_0 (tint × baked ambient occlusion), _sway (how far wind bends that point), _flutter (leaflet flutter).
Blender is Z-up; the glTF export turns it Y-up. Trunks lean towards +X.
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import numpy as np  # noqa: E402

import lib  # noqa: E402
from lib import TAU  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ATLAS = json.load(open(os.path.join(HERE, '..', 'assets', 'tex', 'foliage.json')))['regions']


def hexcol(h):
    h = h.lstrip('#')
    return np.array(lib.srgb_to_lin(tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))))


def norm(v):
    return v / max(1e-9, np.linalg.norm(v))


class Mesh:
    """Accumulates vertices with per-vertex uv, colour, normal, sway, flutter and per-face material."""

    def __init__(self):
        self.v, self.uv, self.col, self.n, self.sway, self.flut = [], [], [], [], [], []
        self.faces, self.mat = [], []

    def vert(self, p, uv, col, n, sway, flut=0.0):
        self.v.append(p); self.uv.append(uv); self.col.append(col); self.n.append(norm(np.asarray(n, float)))
        self.sway.append(sway); self.flut.append(flut)
        return len(self.v) - 1

    def face(self, idx, mat):
        self.faces.append(idx); self.mat.append(mat)

    def build(self, name, materials):
        verts = np.array(self.v)
        me = bpy.data.meshes.new(name)
        me.from_pydata(verts.tolist(), [], self.faces)
        me.update()
        for m in materials:
            me.materials.append(m)
        me.polygons.foreach_set('material_index', np.array(self.mat, np.int32))
        loop_vi = np.empty(len(me.loops), np.int32)
        me.loops.foreach_get('vertex_index', loop_vi)
        uvl = me.uv_layers.new(name='UVMap')
        uvl.data.foreach_set('uv', np.array(self.uv, np.float32)[loop_vi].ravel())
        c = np.ones((len(verts), 4), np.float32)
        c[:, :3] = np.array(self.col)
        ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        ca.data.foreach_set('color', c.ravel())
        for nm, arr in (('_sway', self.sway), ('_flutter', self.flut)):
            a = me.attributes.new(nm, 'FLOAT', 'POINT')
            a.data.foreach_set('value', np.array(arr, np.float32))
        me.shade_smooth()
        me.normals_split_custom_set_from_vertices([tuple(n) for n in self.n])
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


def tube(m, pts, radii, sides, mat, col_fn, sway_fn, uv_fn, flut_fn=lambda s: 0.0, cap=False):
    """A tube along a polyline with parallel-transported frames."""
    pts = np.asarray(pts, float)
    n = len(pts)
    T = np.gradient(pts, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True)
    ref = np.array([0, 0, 1.0]) if abs(T[0][2]) < 0.9 else np.array([1.0, 0, 0])
    N = norm(np.cross(T[0], ref))
    rows = []
    for i in range(n):
        if i:
            N = norm(N - T[i] * np.dot(N, T[i]))
        B = np.cross(T[i], N)
        s = i / (n - 1)
        row = []
        for k in range(sides + 1):
            a = k / sides * TAU
            d = N * math.cos(a) + B * math.sin(a)
            row.append(m.vert(pts[i] + d * radii[i], uv_fn(k / sides, s, i), col_fn(s, k), d, sway_fn(s), flut_fn(s)))
        rows.append(row)
    for i in range(n - 1):
        for k in range(sides):
            m.face([rows[i][k], rows[i][k + 1], rows[i + 1][k + 1], rows[i + 1][k]], mat)
    return rows


def ellipsoid(m, c, r, mat, col, sway, axis=np.array([0, 0, 1.0]), lat=5, lon=8, uv=(0.5, 0.5)):
    up = norm(axis)
    side = norm(np.cross(up, [1.0, 0, 0] if abs(up[0]) < 0.9 else [0, 1.0, 0]))
    fwd = np.cross(up, side)
    rows = []
    for i in range(lat + 1):
        th = math.pi * i / lat
        row = []
        for k in range(lon):
            ph = TAU * k / lon
            d = side * math.sin(th) * math.cos(ph) + fwd * math.sin(th) * math.sin(ph) + up * math.cos(th)
            p = c + side * r[0] * math.sin(th) * math.cos(ph) + fwd * r[1] * math.sin(th) * math.sin(ph) + up * r[2] * math.cos(th)
            row.append(m.vert(p, uv, col * (0.85 + 0.15 * math.cos(th)), d, sway))
        rows.append(row)
    for i in range(lat):
        for k in range(lon):
            k2 = (k + 1) % lon
            m.face([rows[i][k], rows[i + 1][k], rows[i + 1][k2], rows[i][k2]], mat)


def region_uv(name, u, v):
    x0, y0, x1, y1 = ATLAS[name]
    return (x0 + (x1 - x0) * u, y0 + (y1 - y0) * v)


WHITE = lambda: region_uv('white', 0.5, 0.5)  # noqa: E731


def frond(m, rng, top, az, elev, length, droop, age, crown_c, leaflets=48, dead=False):
    """Rachis + leaflets. age: 0 young (upright) … 1 old (drooping)."""
    ns = 10
    d0 = np.array([math.cos(az) * math.cos(elev), math.sin(az) * math.cos(elev), math.sin(elev)])
    pts, p, e = [], top + d0 * 0.12, elev
    ds = length / ns
    for i in range(ns + 1):
        s = i / ns
        pts.append(p.copy())
        e = elev - droop * s ** 1.5
        p = p + ds * np.array([math.cos(az) * math.cos(e), math.sin(az) * math.cos(e), math.sin(e)])
    pts = np.array(pts)
    rach = hexcol('#8f7a4f' if dead else '#9c9a52')
    tube(m, pts, np.linspace(0.038, 0.008, ns + 1), 4, 1,
         lambda s, k: rach * (0.75 + 0.25 * s), lambda s: 1.0 + 0.6 * s, lambda u, s, i: WHITE(), flut_fn=lambda s: 0.15 * s)
    # leaflets along both sides, folded downwards into a V
    T = np.gradient(pts, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True)
    sc = length / 3.2
    for side in (-1, 1):
        for j in range(leaflets):
            s = 0.08 + 0.9 * j / (leaflets - 1)
            f = s * ns
            i0 = min(int(f), ns - 1)
            A = pts[i0] + (pts[i0 + 1] - pts[i0]) * (f - i0)
            t = norm(T[i0] + (T[i0 + 1] - T[i0]) * (f - i0))
            up = norm(np.array([0, 0, 1.0]) - t * t[2])
            sd = norm(np.cross(t, up)) * side
            beta = (0.42 + 0.62 * s) * (0.55 if age < 0.2 else 1.0) + (0.8 if dead else 0.0) + rng.normal(0, 0.07)
            d = norm(sd * math.cos(beta) - up * math.sin(beta) + t * 0.32)
            ll = 0.74 * sc * (0.32 + 0.68 * math.sin(math.pi * (0.04 + 0.92 * s)) ** 0.8) * rng.uniform(0.9, 1.08) * (0.8 if dead else 1.0)
            w = 0.075 * sc
            B = A + d * ll - up * (0.07 * ll if not dead else 0.25 * ll)
            plane_n = norm(np.cross(t, B - A))
            if plane_n[2] < 0:
                plane_n = -plane_n
            # soften leaf lighting: blend the card normal with "outwards from the crown"
            out = norm(norm(A - crown_c) + np.array([0, 0, 0.6]))
            nrm = norm(plane_n * 0.45 + out * 0.55)
            if dead:
                var = 5
            else:
                var = rng.choice(4, p=[0.3, 0.3, 0.25, 0.15]) if age < 0.8 else rng.choice([2, 3, 4], p=[0.4, 0.4, 0.2])
            name = f'leaflet{var}'
            tint = rng.uniform(0.88, 1.08) * (0.62 + 0.38 * s)
            col = np.array([tint, tint, tint])
            sw = 1.0 + 0.6 * s
            a0 = m.vert(A - t * w / 2, region_uv(name, 0, 0), col * 0.9, nrm, sw, 0.0)
            a1 = m.vert(A + t * w / 2, region_uv(name, 1, 0), col * 0.9, nrm, sw, 0.0)
            b1 = m.vert(B + t * w / 2, region_uv(name, 1, 1), col, nrm, sw + 0.1, 1.0)
            b0 = m.vert(B - t * w / 2, region_uv(name, 0, 1), col, nrm, sw + 0.1, 1.0)
            m.face([a0, a1, b1, b0], 1)


def palm(variant):
    rng = np.random.default_rng(500 + variant * 17)
    H = [6.3, 7.5, 5.3, 6.8][variant]
    lean = [1.6, 2.6, 0.7, 2.1][variant]
    m = Mesh()
    # ---- trunk ----
    N = 22
    t = np.linspace(0, 1, N)
    pts = np.stack([lean * t ** 1.8, 0.15 * np.sin(t * 3) + 0.05 * np.sin(t * 11), H * t], 1)
    seglen = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    vlen = np.concatenate([[0], np.cumsum(seglen)])
    radii = 0.2 * (1 - 0.36 * t) * (1 + 0.75 * np.clip(1 - t / 0.08, 0, 1) ** 1.6)   # swollen bole at the foot
    bark_col = lambda s, k: np.ones(3) * (0.78 + 0.22 * min(1, s * 6))  # noqa: E731
    tube(m, pts, radii, 10, 0, bark_col, lambda s: s * s, lambda u, s, i: (u, vlen[i]))
    # the flared mass of roots at the foot
    # a mat of thin adventitious roots spreading from the bole, most of them already under the sand
    for k in range(34):
        a = k / 34 * TAU + rng.uniform(-0.15, 0.15)
        h0 = rng.uniform(0.0, 0.1)
        r0 = 0.27 + rng.uniform(-0.02, 0.02)
        reach = rng.uniform(0.12, 0.3)
        d = np.array([math.cos(a), math.sin(a), 0])
        rp = [np.array([0, 0, h0]) + d * (r0 - 0.03), np.array([0, 0, h0 * 0.45]) + d * (r0 + reach * 0.45), np.array([0, 0, -0.06]) + d * (r0 + reach)]
        rr_ = rng.uniform(0.011, 0.02)
        tube(m, rp, [rr_, rr_ * 0.9, rr_ * 0.7], 4, 0, lambda s, kk: np.ones(3) * 0.78, lambda s: 0.0, lambda u, s, i: (u * 0.08, s * 0.25))
    top = pts[-1]
    axis = norm(pts[-1] - pts[-3])
    crown_c = top + np.array([0, 0, 0.3])
    sc = H / 6.5
    # ---- leaf bases wrapped around the top, and the coconuts below them ----
    ellipsoid(m, top + axis * 0.05, (0.26 * sc, 0.26 * sc, 0.42 * sc), 1, hexcol('#6f6a3c'), 1.0, axis, lat=5, lon=9, uv=WHITE())
    nut_cols = [hexcol(c) for c in ('#5d7d2b', '#7c8f2e', '#b19a3a', '#6e4e2e')]
    for cl in range(2):
        ca = rng.uniform(0, TAU)
        cdir = np.array([math.cos(ca), math.sin(ca), 0])
        base = top - np.array([0, 0, 0.32 * sc]) + cdir * 0.24 * sc
        for k in range(int(rng.integers(4, 7))):
            o = rng.normal(0, 1, 3) * np.array([0.11, 0.11, 0.08]) * sc
            c = base + o + cdir * 0.06
            ellipsoid(m, c, (0.11 * sc, 0.11 * sc, 0.14 * sc), 1, nut_cols[rng.integers(4)] * rng.uniform(0.85, 1.1), 1.0, norm(c - top + np.array([0, 0, -0.4])), lat=4, lon=7, uv=WHITE())
    # ---- fronds: phyllotaxis, young ones upright, old ones drooping, a dead one hanging ----
    n = 16 + (variant % 2) * 2
    golden = math.radians(137.5)
    for k in range(n):
        age = k / (n - 1)
        az = k * golden + rng.normal(0, 0.12)
        elev = math.radians(68 - 80 * age) + rng.normal(0, 0.06)
        length = (2.5 + 0.9 * math.sin(math.pi * min(1, 0.2 + age))) * sc * rng.uniform(0.92, 1.06)
        droop = 0.7 + 1.3 * age + rng.normal(0, 0.1)
        frond(m, rng, top + np.array([0, 0, 0.1 - 0.25 * age]) * sc, az, elev, length, droop, age, crown_c)
    for k in range(1 + variant % 2):
        az = rng.uniform(0, TAU)
        frond(m, rng, top - np.array([0, 0, 0.3]) * sc, az, math.radians(-55), 2.2 * sc, 0.5, 1.0, crown_c, leaflets=34, dead=True)
    return m


def main():
    out = os.path.abspath((lib.args() or ['../assets/models'])[0])
    lib.fresh_scene()
    bark = bpy.data.materials.new('bark')
    crown = bpy.data.materials.new('crown')
    palms = []
    for v in range(4):
        m = palm(v)
        ob = m.build(f'palm_{v}', [bark, crown])
        ob.location.x = v * 12.0
        palms.append(ob)
    # self-shadowing inside the crown and under it, multiplied into the tint
    for ob in palms:
        me = ob.data
        tint = np.empty(len(me.vertices) * 4, np.float32)
        me.color_attributes['Col'].data.foreach_get('color', tint)
        lib.bake_vertex_ao(ob, samples=48, distance=0.9, attr='AO')
        ao = np.empty(len(me.vertices) * 4, np.float32)
        me.color_attributes['AO'].data.foreach_get('color', ao)
        tint = tint.reshape(-1, 4)
        tint[:, :3] *= (0.45 + 0.55 * ao.reshape(-1, 4)[:, :1])
        me.color_attributes['Col'].data.foreach_set('color', tint.ravel())
        me.color_attributes.remove(me.color_attributes['AO'])
        me.color_attributes.active_color = me.color_attributes['Col']
        print(ob.name, len(me.polygons), 'faces', flush=True)
    for ob in palms:
        ob.location.x = 0
    lib.export_glb(palms, os.path.join(out, 'palms.glb'))
    for v, ob in enumerate(palms):
        ob.location.x = v * 12.0
    os.makedirs(os.path.join(HERE, 'build'), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'build', 'palms.blend'), compress=True)


if __name__ == '__main__':
    main()
