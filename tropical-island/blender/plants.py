"""Shrubs, flowering plants, grass clumps and ferns built from leaf cards on real branch structures.

    python plants.py ../assets/models

Materials: 'leaf' (foliage atlas) and 'bark' (stems). Attributes as in palms.py.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import numpy as np  # noqa: E402

import lib  # noqa: E402
from lib import TAU  # noqa: E402
from palms import Mesh, WHITE, ellipsoid, hexcol, norm, region_uv, tube  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
LEAF, BARK = 1, 0


def card(m, base, direction, up_hint, length, width, region, tint, sway, center, flut=(0.2, 1.0), bend=0.0, segs=1):
    """A leaf card from its base along `direction`; the card plane contains `direction` and is
    turned to face `up_hint`. Normals lean outwards from the plant centre for soft canopy shading."""
    d = norm(direction)
    side = norm(np.cross(d, up_hint))
    face = norm(np.cross(side, d))
    if face[2] < -0.2:
        face, side = -face, -side
    rows = []
    for i in range(segs + 1):
        s = i / segs
        p = base + d * length * s - face * bend * length * s * s
        out = norm(norm(p - center) + np.array([0, 0, 0.5]))
        nrm = norm(face * 0.45 + out * 0.55)
        f = flut[0] + (flut[1] - flut[0]) * s
        rows.append((m.vert(p - side * width / 2, region_uv(region, 0, s), tint * (0.85 + 0.15 * s), nrm, sway, f),
                     m.vert(p + side * width / 2, region_uv(region, 1, s), tint * (0.85 + 0.15 * s), nrm, sway, f)))
    for i in range(segs):
        m.face([rows[i][0], rows[i][1], rows[i + 1][1], rows[i + 1][0]], LEAF)


def stem(m, pts, r0, r1, col, sway0=0.0, sway1=1.0, sides=4):
    n = len(pts)
    tube(m, pts, np.linspace(r0, r1, n), sides, BARK, lambda s, k: col, lambda s: sway0 + (sway1 - sway0) * s,
         lambda u, s, i: (u * 0.1, s * 0.6))


def dome_shrub(rng, regions, height, radius, leaves, leaf_len, flowers=None, n_flowers=0, stem_col='#6b5a44'):
    """Branches from the base fan out to a dome; leaves cluster on the outer shell."""
    m = Mesh()
    center = np.array([0, 0, height * 0.45])
    sc = hexcol(stem_col)
    tips = []
    for b in range(9):
        a = b / 9 * TAU + rng.uniform(-0.3, 0.3)
        el = rng.uniform(0.6, 1.25)
        r = radius * rng.uniform(0.7, 1.0)
        tip = np.array([math.cos(a) * r * math.cos(el - 0.4), math.sin(a) * r * math.cos(el - 0.4), height * rng.uniform(0.55, 0.95)])
        mid = tip * 0.5 + np.array([0, 0, height * 0.12])
        stem(m, [np.array([0, 0, 0.0]), mid, tip], 0.025, 0.008, sc, 0.0, 0.8)
        tips.append(tip)
    for k in range(leaves):
        u, v = rng.uniform(0, 1, 2)
        a = TAU * u
        el = math.acos(1 - v * 1.15) if v < 0.87 else math.pi / 2
        d = np.array([math.cos(a) * math.sin(el), math.sin(a) * math.sin(el), math.cos(el)])
        p = center + d * np.array([radius, radius, height * 0.55]) * rng.uniform(0.55, 1.0)
        p[2] = max(p[2], 0.05)
        out = norm(p - center + np.array([0, 0, 0.3]))
        direction = norm(out + rng.normal(0, 0.5, 3))
        reg = regions[rng.integers(len(regions))]
        tint = np.ones(3) * rng.uniform(0.82, 1.08)
        card(m, p - direction * leaf_len * 0.15, direction, out, leaf_len * rng.uniform(0.8, 1.15), leaf_len * rng.uniform(0.85, 1.0), reg, tint,
             0.3 + 0.7 * p[2] / height, center, bend=0.15, segs=2)
    for k in range(n_flowers):
        u, v = rng.uniform(0, 1, 2)
        a = TAU * u
        el = math.acos(1 - v * 0.95)
        d = np.array([math.cos(a) * math.sin(el), math.sin(a) * math.sin(el), math.cos(el)])
        p = center + d * np.array([radius, radius, height * 0.55]) * 1.02
        out = norm(p - center)
        reg = flowers[rng.integers(len(flowers))]
        s = rng.uniform(0.11, 0.15)
        side = norm(np.cross(out, [0, 0, 1.0]) + 1e-6)
        up = np.cross(out, side)
        card(m, p - up * s / 2, up, out, s, s, reg, np.ones(3), 0.3 + 0.7 * p[2] / height, center, flut=(0.5, 0.6))
    return m


def ti_plant(rng):
    """Cordyline: slim canes topped with rosettes of long red leaves."""
    m = Mesh()
    sc = hexcol('#6a5a48')
    for k in range(int(rng.integers(2, 4))):
        h = rng.uniform(0.7, 1.4)
        lean = rng.normal(0, 0.12, 2)
        top = np.array([lean[0] * h, lean[1] * h, h])
        stem(m, [np.array([lean[0] * 0.1, lean[1] * 0.1, 0.0]), top * 0.5 + np.array([0, 0, 0.02]), top], 0.022, 0.016, sc, 0.0, 0.9, sides=5)
        for j in range(26):
            a = j * math.radians(137.5) + rng.normal(0, 0.1)
            el = math.radians(rng.uniform(-10, 70))
            d = np.array([math.cos(a) * math.cos(el), math.sin(a) * math.cos(el), math.sin(el)])
            card(m, top, d, np.array([0, 0, 1.0]), rng.uniform(0.4, 0.55), 0.13, 'leaf_ti', np.ones(3) * rng.uniform(0.8, 1.1), 1.0, top, bend=0.35, segs=3)
    return m


def frangipani(rng):
    """A small Plumeria tree: forked grey branches, leaf rosettes and flower clusters at the tips."""
    m = Mesh()
    gc = hexcol('#8d8778')
    tips = []

    def branch(p, d, length, r, depth):
        e = p + d * length
        stem(m, [p, p + d * length * 0.5 + np.array([0, 0, 0.03]), e], r, r * 0.8, gc, 0.1 * (3 - depth), 0.35 * (4 - depth), sides=6)
        if depth == 0:
            tips.append((e, d))
            return
        for k in range(2):
            nd = norm(d + np.array([math.cos(k * math.pi + rng.uniform(-0.6, 0.6)), math.sin(k * math.pi + rng.uniform(-0.6, 0.6)), 0]) * 0.55 + np.array([0, 0, 0.25]))
            branch(e, nd, length * 0.75, r * 0.75, depth - 1)
    branch(np.zeros(3), np.array([0.1, 0.05, 1.0]) / np.linalg.norm([0.1, 0.05, 1.0]), 0.75, 0.07, 3)
    for e, d in tips:
        for j in range(15):
            a = j * math.radians(137.5)
            dd = norm(np.array([math.cos(a), math.sin(a), 0]) * 0.8 + d * (0.3 + 0.5 * rng.random()))
            card(m, e, dd, np.array([0, 0, 1.0]), rng.uniform(0.34, 0.46), 0.15, 'leaf_pale', np.ones(3) * rng.uniform(0.85, 1.05), 1.0, e, bend=0.25, segs=2)
        fl = 'frangipani_white' if rng.random() < 0.6 else 'frangipani_pink'
        for j in range(5):
            o = rng.normal(0, 0.05, 3)
            p = e + d * 0.08 + o
            card(m, p, norm(np.array([o[0], o[1], 0.02]) + 1e-6), np.array([0, 0, 1.0]), 0.09, 0.09, fl, np.ones(3), 1.0, e, flut=(0.5, 0.6))
    return m


def grass_clump(rng, region, h):
    m = Mesh()
    for k in range(3):
        a = k / 3 * math.pi + rng.uniform(-0.2, 0.2)
        d = np.array([math.cos(a), math.sin(a), 0.0])
        w = h * 0.5
        rows = []
        for i in range(3):
            s = i / 2
            p = np.array([0, 0, h * s])
            nrm = norm(np.array([0, 0, 1.0]) * 0.6 + np.cross(d, [0, 0, 1.0]) * 0.4)
            rows.append((m.vert(p - d * w, region_uv(region, 0, s), np.ones(3) * (0.7 + 0.3 * s), nrm, s * s, s),
                         m.vert(p + d * w, region_uv(region, 1, s), np.ones(3) * (0.7 + 0.3 * s), nrm, s * s, s)))
        for i in range(2):
            m.face([rows[i][0], rows[i][1], rows[i + 1][1], rows[i + 1][0]], LEAF)
    return m


def fern(rng):
    m = Mesh()
    c = np.zeros(3)
    for k in range(9):
        a = k / 9 * TAU + rng.uniform(-0.2, 0.2)
        el = math.radians(rng.uniform(35, 65))
        d = np.array([math.cos(a) * math.cos(el), math.sin(a) * math.cos(el), math.sin(el)])
        card(m, c, d, np.array([0, 0, 1.0]), rng.uniform(0.6, 0.85), 0.32, 'fern', np.ones(3) * rng.uniform(0.85, 1.05), 1.0, c - np.array([0, 0, 0.3]), bend=0.45, segs=4)
    return m


def main():
    out = os.path.abspath((lib.args() or ['../assets/models'])[0])
    lib.fresh_scene()
    bark = bpy.data.materials.new('bark')
    leaf = bpy.data.materials.new('leaf')
    rng = np.random.default_rng(42)
    plants = {
        'shrub_glossy': dome_shrub(rng, ['leaf_glossy'], 0.9, 0.6, 230, 0.22),
        'shrub_croton': dome_shrub(rng, ['leaf_croton', 'leaf_croton', 'leaf_glossy'], 0.8, 0.5, 190, 0.22),
        'shrub_pale': dome_shrub(rng, ['leaf_pale'], 0.75, 0.65, 160, 0.28),
        'shrub_hibiscus': dome_shrub(rng, ['leaf_glossy', 'leaf_pale'], 1.1, 0.6, 230, 0.21, ['hibiscus_red', 'hibiscus_red', 'hibiscus_yellow'], 24),
        'ti_plant': ti_plant(rng),
        'frangipani': frangipani(rng),
        'grass_green': grass_clump(rng, 'grass0', 0.45),
        'grass_beach': grass_clump(rng, 'grass1', 0.5),
        'fern': fern(rng),
    }
    objs = []
    for k, (name, m) in enumerate(plants.items()):
        ob = m.build(name, [bark, leaf])
        ob.location.x = k * 4.0
        objs.append(ob)
    for ob in objs:
        if ob.name.startswith('grass'):
            continue
        me = ob.data
        tint = np.empty(len(me.vertices) * 4, np.float32)
        me.color_attributes['Col'].data.foreach_get('color', tint)
        lib.bake_vertex_ao(ob, samples=32, distance=0.4, attr='AO')
        ao = np.empty(len(me.vertices) * 4, np.float32)
        me.color_attributes['AO'].data.foreach_get('color', ao)
        tint = tint.reshape(-1, 4)
        tint[:, :3] *= (0.4 + 0.6 * ao.reshape(-1, 4)[:, :1])
        me.color_attributes['Col'].data.foreach_set('color', tint.ravel())
        me.color_attributes.remove(me.color_attributes['AO'])
        me.color_attributes.active_color = me.color_attributes['Col']
    for ob in objs:
        print(ob.name, len(ob.data.polygons), 'faces', flush=True)
        ob.location.x = 0
    lib.export_glb(objs, os.path.join(out, 'plants.glb'))
    for k, ob in enumerate(objs):
        ob.location.x = k * 4.0
    os.makedirs(os.path.join(HERE, 'build'), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'build', 'plants.blend'), compress=True)


if __name__ == '__main__':
    main()
