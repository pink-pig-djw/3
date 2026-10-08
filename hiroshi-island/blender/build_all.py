"""Rebuild every asset of 浩的岛 and assemble the level as a .blend file.

    # with the standalone bpy module (pip install bpy==5.2.2, Python 3.13)
    python blender/build_all.py [--skip-textures] [--blend-only]
    # or inside Blender 5.x
    blender -b -P blender/build_all.py -- [--skip-textures] [--blend-only]

Steps (each one is also runnable on its own):
    textures.py        tileable PBR sets baked from micro-geometry   (~8 min)
    water_textures.py  ripple / foam maps (numpy)
    terrain.py         heightfield, stream, splat masks, layout.json
    rocks.py           boulders + baked atlas                         (~4 min)
    vegetation.py      leaf atlas, trees, bushes, ferns, reeds
    architecture.py    culvert, house, deck, stairs, fence, lanterns
    creatures.py       trout, dragonfly, river lantern, wind chime, hat
then `npm run optimize` (Draco) and finally blender/build/island.blend, the
whole valley assembled for inspection or editing in Blender.
"""

import json
import math
import os
import runpy
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]


def run(script, *argv):
    print(f"\n=== {script} {' '.join(argv)} ===", flush=True)
    saved = sys.argv
    sys.argv = [script, *argv]
    try:
        runpy.run_path(os.path.join(HERE, script), run_name="__main__")
    finally:
        sys.argv = saved


def assemble_blend():
    import bpy  # noqa: I001
    import numpy as np
    from common import BUILD_DIR, DATA_DIR, mesh_from_arrays, obj_from_mesh, reset_scene

    reset_scene()
    meta = json.load(open(os.path.join(DATA_DIR, "terrain.json")))
    res, size = meta["res"], meta["size"]
    H = np.fromfile(os.path.join(DATA_DIR, "terrain_height.bin"), np.float32).reshape(res, res)
    # game (x, y, z) -> blender (x, -z, y)
    xs = np.linspace(-size / 2, size / 2, res)
    X, Z = np.meshgrid(xs, xs)
    V = np.stack([X.ravel(), -Z.ravel(), H.ravel()], 1)
    idx = np.arange(res * res).reshape(res, res)
    F = np.stack([idx[:-1, :-1].ravel(), idx[1:, :-1].ravel(), idx[1:, 1:].ravel(), idx[:-1, 1:].ravel()], 1)
    obj_from_mesh("terrain", mesh_from_arrays("terrain", V, F, smooth=True))
    stream = json.load(open(os.path.join(DATA_DIR, "stream.json")))
    pts = [(p[0], -p[2], p[1]) for p in stream["points"]]
    curve = bpy.data.curves.new("stream", "CURVE")
    sp = curve.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (*p, 1.0)
    bpy.context.scene.collection.objects.link(bpy.data.objects.new("stream_centre", curve))

    raw = os.path.join(BUILD_DIR, "raw")
    subprocess.run(["node", os.path.join(ROOT, "tools", "decompress-models.mjs"), raw], check=True, cwd=ROOT)

    def import_glb(name):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(raw, name))
        return [o for o in bpy.data.objects if o not in before]

    import_glb("architecture.glb")
    layout = json.load(open(os.path.join(DATA_DIR, "layout.json")))
    lib = {}
    for f in ("trees.glb", "rocks.glb", "plants.glb"):
        for o in import_glb(f):
            lib[o.name] = o
            o.hide_set(True)
            o.hide_render = True

    def place(src_name, p, yaw_deg, s, coll):
        src = lib.get(src_name)
        if src is None or src.type != "MESH":
            return
        o = src.copy()  # linked duplicate: shares the mesh
        o.hide_render = False
        coll.objects.link(o)
        o.location = (p[0], -p[2], p[1])
        o.rotation_euler = (0, 0, math.radians(yaw_deg))
        o.scale = (s, s, s)
        o.hide_set(False)

    coll_t = bpy.data.collections.new("trees")
    coll_r = bpy.data.collections.new("rocks")
    for c in (coll_t, coll_r):
        bpy.context.scene.collection.children.link(c)
    for t in layout["trees"]:
        place(f"tree_{t['v']}", t["p"], t["yaw"], t["s"], coll_t)
    for r in layout["rocks"]:
        place(f"rock_{r['v']}", r["p"], r["yaw"], r["size"], coll_r)
    path = os.path.join(BUILD_DIR, "island.blend")
    bpy.ops.wm.save_as_mainfile(filepath=path)
    print("saved", path)


if __name__ == "__main__":
    if "--blend-only" not in args:
        if "--skip-textures" not in args:
            run("textures.py")
        run("water_textures.py")
        run("terrain.py")
        run("rocks.py")
        run("vegetation.py")
        run("architecture.py")
        run("creatures.py")
        try:
            subprocess.run(["node", os.path.join(ROOT, "tools", "optimize-models.mjs")], check=True, cwd=ROOT)
        except (OSError, subprocess.CalledProcessError) as e:
            print("Draco optimisation skipped:", e, "(run `npm run optimize` in hiroshi-island/)")
    assemble_blend()
