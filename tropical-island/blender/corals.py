"""Reef corals: staghorn, table, brain, boulder (Porites), sea fan and finger coral.

    python corals.py ../assets/models

One material, 'coral' (the page textures it with the polyp map in object space and tints each colony).
COLOR_0 is grey: light at growing tips, darker in crevices (baked ambient occlusion).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import numpy as np  # noqa: E402

import lib  # noqa: E402
from lib import TAU  # noqa: E402
from palms import Mesh, ellipsoid, norm, tube  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
UV0 = lambda u, s, i: (u, s)  # noqa: E731


def staghorn(rng):
    m = Mesh()

    def branch(p, d, length, r, depth):
        pts = [p + d * length * s + np.array([0, 0, 0.02 * math.sin(s * 3)]) * length for s in np.linspace(0, 1, 3)]
        tube(m, pts, np.linspace(r, r * 0.72, 3), 5, 0, lambda s, k: np.ones(3) * (0.8 + 0.12 * (3 - depth) / 3 + (0.35 * s if depth == 0 else 0)),
             lambda s: 0.0, UV0)
        e = pts[-1]
        if depth == 0:
            ellipsoid(m, e, (r * 0.75, r * 0.75, r * 0.9), 0, np.ones(3) * 1.25, 0.0, d, lat=2, lon=5)
            return
        for k in range(2 if depth > 1 else int(rng.integers(2, 4))):
            a = rng.uniform(0, TAU)
            nd = norm(d + np.array([math.cos(a), math.sin(a), 0]) * rng.uniform(0.35, 0.7) + np.array([0, 0, 0.35]))
            branch(e, nd, length * rng.uniform(0.7, 0.85), r * 0.75, depth - 1)
    for k in range(5):
        a = k / 5 * TAU + rng.uniform(-0.3, 0.3)
        d = norm(np.array([math.cos(a), math.sin(a), 1.2]))
        branch(np.array([0, 0, 0.0]), d, 0.28, 0.045, 3)
    return m


def table(rng):
    m = Mesh()
    tube(m, [np.array([0, 0, 0.0]), np.array([0.02, 0, 0.2]), np.array([0, 0.02, 0.42])], [0.09, 0.07, 0.1], 8, 0,
         lambda s, k: np.ones(3) * 0.7, lambda s: 0.0, UV0)
    R, rings, segs = 0.75, 7, 40
    top, bot = [], []
    for i in range(rings + 1):
        r = R * i / rings
        rt, rb = [], []
        for k in range(segs):
            a = k / segs * TAU
            wav = 0.035 * math.sin(a * 7 + rng.uniform(0, 0.3)) * (r / R) ** 2
            rr = r * (1 + 0.08 * math.sin(a * 3 + 1.3) * (r / R))
            z = 0.42 + 0.06 * (r / R) ** 1.5 + wav
            p = np.array([math.cos(a) * rr, math.sin(a) * rr, z])
            lift = 0.012 * math.sin(a * 23) * math.sin(r * 40)   # rows of upright branchlets on the plate
            shade = 0.9 + 0.25 * (r / R)
            rt.append(m.vert(p + np.array([0, 0, 0.03 + lift]), (k / segs, r / R), np.ones(3) * shade, np.array([0, 0, 1.0]) + np.array([math.cos(a), math.sin(a), 0]) * 0.2 * r / R, 0.0))
            rb.append(m.vert(p - np.array([0, 0, 0.02]), (k / segs, r / R), np.ones(3) * 0.55, np.array([0, 0, -1.0]), 0.0))
        top.append(rt)
        bot.append(rb)
    for i in range(rings):
        for k in range(segs):
            k2 = (k + 1) % segs
            m.face([top[i][k], top[i + 1][k], top[i + 1][k2], top[i][k2]], 0)
            m.face([bot[i][k], bot[i][k2], bot[i + 1][k2], bot[i + 1][k]], 0)
    for k in range(segs):   # the rim
        k2 = (k + 1) % segs
        m.face([top[rings][k], bot[rings][k], bot[rings][k2], top[rings][k2]], 0)
    return m


def displaced_dome(name, seed, radius, height, tex, strength, target):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=6, radius=1.0)
    ob = bpy.context.active_object
    ob.name = name
    v = lib.mesh_arrays(ob)
    v[:, 2] = np.where(v[:, 2] < -0.1, -0.1 + (v[:, 2] + 0.1) * 0.15, v[:, 2])
    v *= np.array([radius, radius, height])
    lib.set_mesh_arrays(ob, v)
    dm = ob.modifiers.new('d', 'DISPLACE')
    dm.texture, dm.strength, dm.mid_level, dm.texture_coords = tex, strength, 0.5, 'LOCAL'
    lib.apply_modifiers(ob)
    v = lib.mesh_arrays(ob)
    v[:, 2] -= v[:, 2].min()
    lib.set_mesh_arrays(ob, v)
    dec = ob.modifiers.new('dec', 'DECIMATE')
    dec.ratio = target / len(ob.data.polygons)
    lib.apply_modifiers(ob)
    lib.select_only(ob)
    bpy.ops.object.shade_smooth()
    return ob


def sea_fan(rng):
    m = Mesh()

    def br(p, a, length, r, depth):
        d = np.array([math.cos(a), 0, math.sin(a)])
        e = p + d * length
        tube(m, [p, (p + e) / 2 + np.array([0, rng.normal(0, 0.01), 0]), e], [r, r * 0.85, r * 0.7], 3, 0,
             lambda s, k: np.ones(3) * (0.85 + 0.15 * depth / 7), lambda s: 0.1 + 0.12 * (7 - depth), UV0)
        if depth == 0:
            return
        for k in (-1, 1):
            br(e, a + k * rng.uniform(0.22, 0.5), length * rng.uniform(0.74, 0.88), r * 0.8, depth - 1)
    br(np.zeros(3), math.pi / 2, 0.175, 0.022, 6)
    return m


def finger(rng):
    m = Mesh()
    for k in range(13):
        a = rng.uniform(0, TAU)
        r0 = rng.uniform(0, 0.12)
        base = np.array([math.cos(a) * r0, math.sin(a) * r0, 0.0])
        d = norm(np.array([math.cos(a) * 0.4, math.sin(a) * 0.4, 1.0]) + rng.normal(0, 0.15, 3))
        L = rng.uniform(0.18, 0.32)
        pts = [base + d * L * s + np.array([0, 0, 0.02 * s]) for s in np.linspace(0, 1, 5)]
        tube(m, pts, np.linspace(0.045, 0.032, 5), 7, 0, lambda s, kk: np.ones(3) * (0.75 + 0.35 * s), lambda s: 0.2 * s, UV0)
        ellipsoid(m, pts[-1], (0.032, 0.032, 0.03), 0, np.ones(3) * 1.1, 0.2, d, lat=3, lon=7)
    return m


def main():
    out = os.path.abspath((lib.args() or ['../assets/models'])[0])
    lib.fresh_scene()
    mat = bpy.data.materials.new('coral')
    rng = np.random.default_rng(9)
    objs = []
    for name, m in (('coral_staghorn', staghorn(rng)), ('coral_table', table(rng)), ('coral_fan', sea_fan(rng)), ('coral_finger', finger(rng))):
        objs.append(m.build(name, [mat]))
    brain_tex = bpy.data.textures.new('brain', 'MARBLE')
    brain_tex.marble_type, brain_tex.noise_basis_2, brain_tex.turbulence, brain_tex.noise_scale, brain_tex.noise_depth = 'SHARP', 'SIN', 6.0, 0.09, 3
    lumps = bpy.data.textures.new('lumps', 'CLOUDS')
    lumps.noise_scale, lumps.noise_depth = 0.25, 2
    brain_mat = bpy.data.materials.new('coral_brain')
    for ob in (displaced_dome('coral_brain', 1, 0.55, 0.42, lumps, 0.08, 1400), displaced_dome('coral_boulder', 2, 0.7, 0.5, lumps, 0.22, 1200)):
        ob.data.materials.append(brain_mat if ob.name == 'coral_brain' else mat)
        me = ob.data
        a = me.attributes.new('_sway', 'FLOAT', 'POINT')
        a.data.foreach_set('value', np.zeros(len(me.vertices), np.float32))
        a = me.attributes.new('_flutter', 'FLOAT', 'POINT')
        a.data.foreach_set('value', np.zeros(len(me.vertices), np.float32))
        c = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        c.data.foreach_set('color', np.ones(len(me.vertices) * 4, np.float32))
        me.uv_layers.new(name='UVMap')
        objs.append(ob)
    for k, ob in enumerate(objs):
        ob.location.x = k * 3.0
    for ob in objs:
        me = ob.data
        tint = np.empty(len(me.vertices) * 4, np.float32)
        me.color_attributes['Col'].data.foreach_get('color', tint)
        lib.bake_vertex_ao(ob, samples=48, distance=0.15, attr='AO')
        ao = np.empty(len(me.vertices) * 4, np.float32)
        me.color_attributes['AO'].data.foreach_get('color', ao)
        tint = tint.reshape(-1, 4)
        tint[:, :3] *= (0.35 + 0.65 * ao.reshape(-1, 4)[:, :1])
        me.color_attributes['Col'].data.foreach_set('color', tint.ravel())
        me.color_attributes.remove(me.color_attributes['AO'])
        me.color_attributes.active_color = me.color_attributes['Col']
        print(ob.name, len(me.polygons), 'faces', flush=True)
    for ob in objs:
        ob.location.x = 0
    lib.export_glb(objs, os.path.join(out, 'corals.glb'))
    for k, ob in enumerate(objs):
        ob.location.x = k * 3.0
    os.makedirs(os.path.join(HERE, 'build'), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'build', 'corals.blend'), compress=True)


if __name__ == '__main__':
    main()
