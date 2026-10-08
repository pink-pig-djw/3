"""Render the grassy ground texture from real geometry: thousands of grass blades in tussocks,
fallen leaves, dry palm leaflets, twigs, pebbles and bits of coral rubble on sandy soil.

    python ground.py ../assets/tex

Writes ground_c.webp / ground_n.webp / ground_r.webp (same layout as textures.py).
"""
import math
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import numpy as np  # noqa: E402

import lib  # noqa: E402
from lib import TAU  # noqa: E402

T = 2.0          # tile size in metres
RES = 1024
rng = np.random.default_rng(7)


def hexcol(h):
    h = h.lstrip('#')
    return np.array(lib.srgb_to_lin(tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))))


class Builder:
    def __init__(self):
        self.v, self.f, self.c = [], [], []
        self.n = 0

    def add(self, verts, faces, cols):
        self.v.append(verts)
        self.f.append(faces + self.n)
        self.c.append(cols)
        self.n += len(verts)

    def build(self, name, mat):
        ob = lib.mesh_from(name, np.vstack(self.v), np.vstack(self.f), colors=np.vstack(self.c))
        ob.data.materials.append(mat)
        for p in ob.data.polygons:
            p.use_smooth = True
        return ob


def blade(b, x, y, ang, elev, bend, length, width, col, segs=4):
    d = np.array([math.cos(ang), math.sin(ang)])
    side = np.array([-d[1], d[0]])
    pts, cols, p, e = [], [], np.array([x, y, 0.0]), elev
    step = length / segs
    for i in range(segs + 1):
        s = i / segs
        w = width * (1 - 0.9 * s ** 1.4) * 0.5
        pts.append(p + np.array([side[0] * w, side[1] * w, 0]))
        pts.append(p - np.array([side[0] * w, side[1] * w, 0]))
        shade = 0.55 + 0.55 * s
        cols += [col * shade, col * shade]
        p = p + step * np.array([d[0] * math.cos(e), d[1] * math.cos(e), math.sin(e)])
        e -= bend / segs
    faces = [[2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2] for i in range(segs)]
    b.add(np.array(pts), np.array(faces), np.array(cols))


def leaf(b, x, y, ang, length, width, curl, col, z0=0.002, n=10):
    """A fallen leaf: elliptical outline, cupped across the midrib, lying on the soil."""
    d = np.array([math.cos(ang), math.sin(ang)])
    side = np.array([-d[1], d[0]])
    verts, cols = [], []
    for i in range(n + 1):
        t = i / n
        along = (t - 0.5) * length
        half = width * 0.5 * math.sin(math.pi * t) ** 0.8
        for sgn in (-1, 0, 1):
            off = sgn * half
            z = z0 + curl * (abs(off) / max(1e-6, width * 0.5)) ** 2 * width * 0.4 + 0.004 * math.sin(math.pi * t)
            verts.append([x + d[0] * along + side[0] * off, y + d[1] * along + side[1] * off, z])
            cols.append(col * (0.8 if sgn == 0 else 1.0))
    faces = []
    for i in range(n):
        a = i * 3
        faces += [[a, a + 1, a + 4, a + 3], [a + 1, a + 2, a + 5, a + 4]]
    b.add(np.array(verts), np.array(faces), np.array(cols))


def pebble(b, x, y, r, flat, col):
    lat, lon = 4, 7
    verts, cols, faces = [], [], []
    for i in range(lat + 1):
        th = math.pi * i / lat
        for k in range(lon):
            ph = TAU * k / lon
            j = 1 + 0.15 * rng.standard_normal()
            verts.append([x + r * j * math.sin(th) * math.cos(ph), y + r * j * math.sin(th) * math.sin(ph), r * flat * math.cos(th) + r * flat * 0.3])
            cols.append(col * (0.9 + 0.2 * rng.random()))
    for i in range(lat):
        for k in range(lon):
            a, c = i * lon + k, i * lon + (k + 1) % lon
            faces.append([a, c, c + lon, a + lon])
    b.add(np.array(verts), np.array(faces), np.array(cols))


def main():
    out = os.path.abspath((lib.args() or ['../assets/tex'])[0])
    lib.fresh_scene(samples=16)
    # sandy soil with a little relief, seamless through the 4D torus trick
    bpy.ops.mesh.primitive_plane_add(size=T, location=(T / 2, T / 2, 0))
    soil = bpy.context.active_object
    smat = bpy.data.materials.new('soil')
    soil.data.materials.append(smat)
    g = lib.Graph(smat)
    n1, n2 = g.noise(6, detail=5, seed=3), g.noise(60, detail=3, seed=4)
    col = g.ramp(n1, [(0.0, '#6c5539'), (0.45, '#8c7352'), (0.75, '#a78f6c'), (1.0, '#bca988')])
    col = g.mix(g.mul(n2, 0.35), col, '#c8b896')
    hgt = g.add(g.mul(n1, 0.004), g.mul(n2, 0.0015))
    bsdf = g.node('ShaderNodeBsdfPrincipled')
    g.set(bsdf.inputs['Base Color'], col)
    g.set(bsdf.inputs['Roughness'], 0.95)
    bump = g.node('ShaderNodeBump', inputs={'Strength': 1.0, 'Distance': 1.0})
    g.set(bump.inputs['Height'], hgt)
    g.link(bump.outputs['Normal'], bsdf.inputs['Normal'])
    g.link(bsdf.outputs[0], g.out.inputs['Surface'])
    lib.add_height_aov(g.nt, hgt)

    dens = lib.periodic_noise(256, T, ((2, 1.0), (3, 0.7), (6, 0.35)), seed=11)
    def density(x, y):
        return dens[int(y / T * 256) % 256, int(x / T * 256) % 256]

    greens = [('#2f4d22', 0.22), ('#44682b', 0.3), ('#5d8436', 0.22), ('#7c9c45', 0.13), ('#9aa95a', 0.07), ('#a89366', 0.06)]
    gcols = [hexcol(c) for c, _ in greens]
    gw = np.array([w for _, w in greens]); gw /= gw.sum()
    b = Builder()
    items = []
    # tussocks of grass
    n_clumps = 520
    for _ in range(n_clumps):
        cx, cy = rng.uniform(0, T, 2)
        if rng.random() > 0.25 + 0.95 * density(cx, cy):
            continue
        nb = int(rng.integers(14, 42))
        for _ in range(nb):
            r = abs(rng.normal(0, 0.035))
            a = rng.uniform(0, TAU)
            items.append(('blade', cx + math.cos(a) * r, cy + math.sin(a) * r, a + rng.normal(0, 0.6)))
    # loose blades everywhere the soil is fertile
    for _ in range(5000):
        x, y = rng.uniform(0, T, 2)
        if rng.random() < 0.15 + 0.85 * density(x, y):
            items.append(('blade', x, y, rng.uniform(0, TAU)))
    for _ in range(170):
        x, y = rng.uniform(0, T, 2)
        items.append(('leaf', x, y, rng.uniform(0, TAU)))
    for _ in range(26):
        x, y = rng.uniform(0, T, 2)
        items.append(('leaflet', x, y, rng.uniform(0, TAU)))
    for _ in range(140):
        x, y = rng.uniform(0, T, 2)
        items.append(('pebble', x, y, 0))
    for _ in range(24):
        x, y = rng.uniform(0, T, 2)
        items.append(('twig', x, y, rng.uniform(0, TAU)))

    leaf_cols = [hexcol(c) for c in ('#5e4128', '#7a5634', '#93693d', '#a98352', '#c2a36a', '#b9a24d', '#76803a')]
    peb_cols = [hexcol(c) for c in ('#b9b2a4', '#d8d2c4', '#9a9083', '#e9e3d6', '#c9a99a')]
    margin = 0.32
    for kind, x, y, ang in items:
        for dx, dy in lib.wrap_copies([(x, y)], T, margin)[0]:
            X, Y = x + dx, y + dy
            if kind == 'blade':
                ci = rng.choice(len(gcols), p=gw)
                blade(b, X, Y, ang, math.radians(rng.uniform(35, 72)), rng.uniform(0.4, 1.4), rng.uniform(0.06, 0.2), rng.uniform(0.003, 0.006), gcols[ci] * rng.uniform(0.85, 1.15))
            elif kind == 'leaf':
                leaf(b, X, Y, ang, rng.uniform(0.04, 0.12), rng.uniform(0.02, 0.05), rng.uniform(0.0, 0.6), leaf_cols[rng.integers(len(leaf_cols))] * rng.uniform(0.85, 1.1), z0=rng.uniform(0.001, 0.01))
            elif kind == 'leaflet':
                leaf(b, X, Y, ang, rng.uniform(0.18, 0.34), rng.uniform(0.016, 0.026), 0.3, hexcol(['#a58b5e', '#8f7a57', '#b8a275'][rng.integers(3)]), z0=0.004, n=14)
            elif kind == 'pebble':
                pebble(b, X, Y, rng.uniform(0.004, 0.014), rng.uniform(0.4, 0.8), peb_cols[rng.integers(len(peb_cols))])
            else:
                leaf(b, X, Y, ang, rng.uniform(0.08, 0.2), 0.006, 0.0, hexcol('#5a4430') * rng.uniform(0.8, 1.2), z0=0.004, n=6)
    mat = lib.vertex_color_material('veg', rough=0.8)
    b.build('ground_items', mat)

    with tempfile.TemporaryDirectory() as tmp:
        r = lib.render_topdown(T, RES, tmp, samples=16, ao_distance=0.06)
    albedo = r['col'][:, :, :3]
    nor = r['nor'][:, :, :3]
    nor /= np.maximum(1e-6, np.linalg.norm(nor, axis=2, keepdims=True))
    nor[:, :, 2] = np.abs(nor[:, :, 2])
    ao = np.clip(r['ao'][:, :, 0], 0, 1)
    hgt = r['hgt'][:, :, 0]
    hn = (hgt - hgt.min()) / max(1e-6, np.ptp(hgt))
    green = np.clip((albedo[:, :, 1] - albedo[:, :, 0]) * 8, 0, 1)
    rough = 0.92 - 0.14 * green
    lib.save_rgb(os.path.join(out, 'ground_c.webp'), albedo, quality=86, srgb=True)
    lib.save_rgb(os.path.join(out, 'ground_n.webp'), nor * 0.5 + 0.5, quality=90)
    lib.save_rgb(os.path.join(out, 'ground_r.webp'), np.dstack([ao, rough, hn]), quality=88)
    print('ground: blades/leaves', len(items))


if __name__ == '__main__':
    main()
