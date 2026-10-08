"""Rocks with real fracture planes: convex hulls of random points, remeshed, eroded with
noise and cell textures, flattened where they sit, decimated, with ambient occlusion baked
into the vertex colours.

    python rocks.py ../assets/models
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402  (bpy first: it puts Blender's own modules such as bmesh on the path)
import bmesh  # noqa: E402
import numpy as np  # noqa: E402

import lib  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))

#            name         seed  radii (x, y, z)       points  chips  target faces
SHAPES = [
    ('rock_boulder_a', 11, (1.0, 0.9, 0.78), 26, 0.05, 1500),
    ('rock_boulder_b', 23, (1.0, 0.85, 0.7), 22, 0.06, 1500),
    ('rock_boulder_c', 37, (0.95, 1.0, 0.85), 30, 0.04, 1500),
    ('rock_block_a', 41, (1.0, 0.8, 0.75), 12, 0.07, 1300),
    ('rock_block_b', 53, (0.9, 1.0, 0.9), 10, 0.08, 1300),
    ('rock_slab', 67, (1.2, 1.0, 0.45), 16, 0.05, 1300),
    ('rock_pinnacle', 79, (0.6, 0.55, 1.4), 18, 0.06, 1400),
    ('rock_pebble', 97, (1.0, 0.8, 0.5), 30, 0.02, 500),
]


def legacy_tex(name, kind, **props):
    t = bpy.data.textures.new(name, kind)
    for k, v in props.items():
        setattr(t, k, v)
    return t


def make_rock(name, seed, radii, npts, chips, target):
    rng = np.random.default_rng(seed)
    d = rng.normal(size=(npts, 3))
    d /= np.linalg.norm(d, axis=1, keepdims=True)
    pts = d * np.array(radii) * rng.uniform(0.72, 1.0, (npts, 1))
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in pts]
    res = bmesh.ops.convex_hull(bm, input=vs)
    loose = {g for g in res['geom_interior'] + res['geom_unused'] if isinstance(g, bmesh.types.BMVert)}
    bmesh.ops.delete(bm, geom=list(loose), context='VERTS')
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.location.x = 6.0 * len([o for o in bpy.context.scene.objects if o.type == 'MESH'])   # bake each rock on its own
    size = max(radii)
    rm = ob.modifiers.new('remesh', 'REMESH')
    rm.mode, rm.voxel_size = 'VOXEL', 0.018 * size
    # broad lumps, then chipped facets (F2-F1 cell ridges), then fine grain
    lumps = legacy_tex(name + '_lumps', 'CLOUDS', noise_scale=0.45 * size, noise_depth=3)
    cells = legacy_tex(name + '_cells', 'VORONOI', noise_scale=0.22 * size, distance_metric='DISTANCE', weight_1=-1.0, weight_2=1.0, weight_3=0.0, weight_4=0.0)
    grain = legacy_tex(name + '_grain', 'STUCCI', noise_scale=0.05 * size, turbulence=6.0)
    for tex, s, mid in ((lumps, 0.09 * size, 0.5), (cells, chips * size, 0.0), (grain, 0.012 * size, 0.5)):
        dm = ob.modifiers.new(tex.name, 'DISPLACE')
        dm.texture, dm.strength, dm.mid_level = tex, s, mid
        dm.texture_coords = 'LOCAL'
    lib.apply_modifiers(ob)
    # sit flat on the ground: squash everything below a little above the lowest point
    v = lib.mesh_arrays(ob)
    z0 = v[:, 2].min()
    cut = z0 + 0.22 * (v[:, 2].max() - z0)
    low = v[:, 2] < cut
    v[low, 2] = cut + (v[low, 2] - cut) * 0.25
    v[:, 2] -= v[:, 2].min()
    v[:, :2] -= (v[:, :2].max(0) + v[:, :2].min(0)) / 2
    lib.set_mesh_arrays(ob, v)
    dec = ob.modifiers.new('decimate', 'DECIMATE')
    dec.ratio = min(1.0, target / max(1, len(ob.data.polygons)))
    lib.apply_modifiers(ob)
    lib.select_only(ob)
    bpy.ops.object.shade_smooth_by_angle(angle=np.radians(50))
    lib.bake_vertex_ao(ob, samples=64, distance=0.25 * size)
    # crevice occlusion from the bake, plus a little contact shadow where the rock meets the ground
    me = ob.data
    col = me.color_attributes['Col']
    c = np.empty(len(col.data) * 4, np.float32)
    col.data.foreach_get('color', c)
    c = c.reshape(-1, 4)
    z = lib.mesh_arrays(ob)[:, 2]
    contact = 0.6 + 0.4 * np.clip(z / (0.18 * (z.max() + 1e-6)), 0, 1)
    ao = np.clip(0.35 + 0.65 * c[:, 0], 0, 1) * contact
    c[:, :3] = ao[:, None]
    col.data.foreach_set('color', c.ravel())
    print(name, len(ob.data.polygons), 'faces', flush=True)
    return ob


def main():
    out = os.path.abspath((lib.args() or ['../assets/models'])[0])
    lib.fresh_scene()
    rocks = [make_rock(*s) for s in SHAPES]
    for r in rocks:
        r.location.x = 0                  # every rock exports at the origin; the page places them itself
    lib.export_glb(rocks, os.path.join(out, 'rocks.glb'))
    for k, r in enumerate(rocks):
        r.location.x = k * 3.0            # side by side in the .blend
    os.makedirs(os.path.join(HERE, 'build'), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'build', 'rocks.blend'), compress=True)


if __name__ == '__main__':
    main()
