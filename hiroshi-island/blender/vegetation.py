"""Vegetation: leaf atlas (rendered from modelled twigs), procedural trees,
bushes, ferns and reeds.

Outputs:
    public/assets/textures/foliage_albedo.webp   RGBA, 2x2 cells: [broadleaf A, broadleaf B, fern, bush]
    public/assets/textures/foliage_normal.webp
    public/assets/models/trees.glb    tree_0..tree_3 (+ _lod1): primitives 'bark' and 'leaves'
    public/assets/models/plants.glb   bush_0, bush_1, fern, reeds

Wind data is stored in the custom vertex attribute _WIND (RGBA):
    r = sway weight (0 at the root .. 1 at the crown tips)
    g = phase (random per branch)
    b = flutter weight (1 for leaves)
    a = branch level / 3
"""

import math
import os
import sys

import bpy  # noqa: I001
import bmesh  # noqa: F401
import numpy as np
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (MODEL_DIR, NT, TEX_DIR, assign_material, export_glb, hexlin, lin2srgb, link,  # noqa: E402
                    load_image_np, log, mesh_from_arrays, obj_from_mesh, principled_material,
                    reset_scene, save_image, select_only)

ATLAS = int(os.environ.get("HIROSHI_FOLIAGE_ATLAS", "2048"))
CELL = ATLAS // 2
SCRATCH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "build")
os.makedirs(SCRATCH, exist_ok=True)


# =============================================================================
# 1. Leaf atlas
# =============================================================================

def leaf_strip(length, width, segs=10, serrate=0.0, fold=0.25, curl=0.15, shape="ovate"):
    """Leaf in local coords: x along the leaf (0..length), y across, z up.
    Returns verts (N,3), faces, uv (leaf-local u along, v across -1..1)."""
    us = np.linspace(0, 1, segs + 1)
    if shape == "ovate":
        half = np.sin(np.pi * np.power(us, 0.75)) ** 0.85 * (1 - 0.25 * us)
    elif shape == "lanceolate":
        half = np.sin(np.pi * np.power(us, 0.9)) ** 1.2
    else:  # pinna (fern leaflet)
        half = np.sin(np.pi * np.power(us, 0.6)) ** 0.7 * (1 - 0.5 * us)
    if serrate > 0:
        half = half * (1 + serrate * np.abs(np.sin(us * np.pi * 14)))
    half = half * width * 0.5
    verts, uv = [], []
    for i, u in enumerate(us):
        for s in (-1, 0, 1):
            y = s * half[i]
            z = abs(y) * fold * -1.0 + curl * (u ** 2) * length
            verts.append((u * length, y, z))
            uv.append((u, float(s)))
    faces = []
    for i in range(segs):
        for j in range(2):
            a = i * 3 + j
            faces.append((a, a + 1, a + 4, a + 3))
    return np.array(verts), faces, np.array(uv)


def leaf_material(name, base_hex, var=0.12, vein=0.12, kind="leaf"):
    """Emission-only material in two modes selected by the scene property
    'mode' (0 = albedo, 1 = normal). Base colour comes from attribute 'Col'."""
    mat = bpy.data.materials.new(name)
    nt = NT(mat)
    out = nt.new("ShaderNodeOutputMaterial")
    em = nt.new("ShaderNodeEmission")
    nt.set(em, "Strength", 1.0)
    col = nt.new("ShaderNodeAttribute", props={"attribute_name": "Col"})
    uv = nt.new("ShaderNodeAttribute", props={"attribute_name": "LeafUV"})
    sep = nt.new("ShaderNodeSeparateXYZ")
    nt.link(uv, "Vector", sep, "Vector")
    # veins: midrib + lateral veins from leaf-local coordinates
    absv = nt.new("ShaderNodeMath", props={"operation": "ABSOLUTE"})
    nt.link(sep, "Y", absv, 0)
    mid = nt.new("ShaderNodeMapRange", From_Min=0.0, From_Max=0.07, To_Min=1.0, To_Max=0.0)
    nt.link(absv, "Value", mid, "Value")
    lat = nt.new("ShaderNodeMath", props={"operation": "MULTIPLY_ADD"})
    nt.link(absv, "Value", lat, 0)
    nt.set(lat, 1, 0.55)
    nt.link(sep, "X", lat, 2)
    lat2 = nt.new("ShaderNodeMath", props={"operation": "MULTIPLY"})
    nt.link(lat, "Value", lat2, 0)
    nt.set(lat2, 1, 9.0)
    fr = nt.new("ShaderNodeMath", props={"operation": "FRACT"})
    nt.link(lat2, "Value", fr, 0)
    pp = nt.new("ShaderNodeMath", props={"operation": "PINGPONG"})
    nt.link(fr, "Value", pp, 0)
    nt.set(pp, 1, 0.5)
    latv = nt.new("ShaderNodeMapRange", From_Min=0.0, From_Max=0.06, To_Min=1.0, To_Max=0.0)
    nt.link(pp, "Value", latv, "Value")
    veins = nt.new("ShaderNodeMath", props={"operation": "MAXIMUM"})
    nt.link(mid, "Result", veins, 0)
    nt.link(latv, "Result", veins, 1)
    # edge darkening
    edge = nt.new("ShaderNodeMapRange", From_Min=0.75, From_Max=1.0, To_Min=1.0, To_Max=0.78)
    nt.link(absv, "Value", edge, "Value")
    # mottling
    tc = nt.new("ShaderNodeTexCoord")
    nz = nt.new("ShaderNodeTexNoise", Scale=60.0, Detail=3.0)
    nt.link(tc, "Object", nz, "Vector")
    mott = nt.new("ShaderNodeMapRange", From_Min=0.3, From_Max=0.7, To_Min=1.0 - var, To_Max=1.0 + var)
    nt.link(nz, "Fac", mott, "Value")
    c1 = nt.new("ShaderNodeVectorMath", props={"operation": "SCALE"})
    nt.link(col, "Color", c1, 0)
    nt.link(mott, "Result", c1, "Scale")
    c2 = nt.new("ShaderNodeVectorMath", props={"operation": "SCALE"})
    nt.link(c1, "Vector", c2, 0)
    nt.link(edge, "Result", c2, "Scale")
    veinc = nt.new("ShaderNodeVectorMath", props={"operation": "SCALE"})
    nt.link(c2, "Vector", veinc, 0)
    nt.set(veinc, "Scale", 1.0 + vein * 2.5)
    albedo = nt.mix("RGBA", (veins, "Value"), (c2, "Vector"), (veinc, "Vector"))
    # normal mode
    geo = nt.new("ShaderNodeNewGeometry")
    nmap = nt.new("ShaderNodeVectorMath", props={"operation": "MULTIPLY_ADD"})
    nt.link(geo, "Normal", nmap, 0)
    nt.set(nmap, 1, (0.5, 0.5, 0.5))
    nt.set(nmap, 2, (0.5, 0.5, 0.5))
    mode = nt.new("ShaderNodeAttribute", props={"attribute_type": "VIEW_LAYER", "attribute_name": "mode"})
    sel = nt.mix("RGBA", (mode, "Fac"), (albedo, "Result"), (nmap, "Vector"))
    nt.link(sel, "Result", em, "Color")
    nt.link(em, "Emission", out, "Surface")
    mat.use_backface_culling = False
    return mat


def _twig(rnd, start, ang, length, n_leaves, leaf_len, leaf_w, palette, shape, serrate, twig_col, r0,
          V, F, UV, C, base):
    pts = []
    p = np.array(start, dtype=float)
    for i in range(16):
        pts.append(p.copy())
        ang += rnd.normal(0, 0.05)
        p = p + np.array([math.cos(ang), math.sin(ang), 0.0]) * length / 16
    pts = np.array(pts)
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        d = b - a
        nrm = np.array([-d[1], d[0], 0.0])
        nrm /= np.linalg.norm(nrm) + 1e-9
        r = r0 * (1 - i / len(pts) * 0.7)
        quad = [a - nrm * r, a + nrm * r, b + nrm * r * 0.95, b - nrm * r * 0.95]
        V += [tuple(q) for q in quad]
        F.append((base, base + 1, base + 2, base + 3))
        UV += [(0.5, 0.0)] * 4
        C += [hexlin(twig_col)] * 4
        base += 4
    for k in range(n_leaves):
        t = 0.12 + 0.88 * (k / max(n_leaves - 1, 1)) ** 0.85
        idx = min(int(t * (len(pts) - 1)), len(pts) - 2)
        at = pts[idx]
        d = pts[idx + 1] - pts[idx]
        tw = math.atan2(d[1], d[0])
        side = 1 if k % 2 == 0 else -1
        yaw = tw + side * math.radians(rnd.uniform(35, 75))
        if k == n_leaves - 1:
            yaw = tw + rnd.normal(0, 0.15)
        L = leaf_len * rnd.uniform(0.75, 1.15) * (0.75 + 0.35 * t)
        lv, lf, luv = leaf_strip(L, leaf_w * L / leaf_len * rnd.uniform(0.85, 1.15), serrate=serrate,
                                 fold=rnd.uniform(0.1, 0.35), curl=rnd.uniform(-0.25, 0.1), shape=shape)
        lv[:, 0] += 0.01
        R = np.array(Matrix.Rotation(yaw, 3, "Z") @ Matrix.Rotation(rnd.normal(0, 0.25), 3, "Y")
                     @ Matrix.Rotation(rnd.normal(0, 0.35), 3, "X"))
        lv = lv @ R.T + at + np.array([0, 0, rnd.uniform(0, 0.03)])
        V += [tuple(v) for v in lv]
        F += [tuple(np.array(f) + base) for f in lf]
        UV += [tuple(u) for u in luv]
        pal = palette[rnd.choice(len(palette), p=[q[1] for q in palette])][0]
        c = np.array(hexlin(pal)) * rnd.uniform(0.85, 1.15)
        C += [tuple(c)] * len(lv)
        base += len(lv)
    return pts, base


def twig_cluster(seed, n_leaves, leaf_len, leaf_w, palette, shape="ovate", serrate=0.05, span=0.86,
                 twig_col="#4d3b2c", sides=3):
    """A branching twig full of leaves, laid out in the XY plane facing +Z."""
    rnd = np.random.default_rng(seed)
    V, F, UV, C = [], [], [], []
    per = max(4, n_leaves // (sides + 1))
    main, base = _twig(rnd, (0.0, -0.48, 0.0), math.radians(rnd.uniform(80, 100)), span, per + 2, leaf_len, leaf_w,
                       palette, shape, serrate, twig_col, 0.007, V, F, UV, C, 0)
    for k in range(sides):
        t = 0.22 + 0.55 * k / max(sides - 1, 1) + rnd.uniform(-0.05, 0.05)
        at = main[int(t * (len(main) - 1))]
        side = 1 if k % 2 == 0 else -1
        d = main[min(int(t * (len(main) - 1)) + 1, len(main) - 1)] - at
        tw = math.atan2(d[1], d[0])
        ang = tw + side * math.radians(rnd.uniform(32, 52))
        L = span * rnd.uniform(0.38, 0.55) * (1.1 - 0.5 * t)
        _, base = _twig(rnd, at, ang, L, per, leaf_len * 0.95, leaf_w, palette, shape, serrate, twig_col, 0.0045,
                        V, F, UV, C, base)
    return np.array(V), F, np.array(UV), np.array(C)


def fern_frond(seed, length=0.92, palette=None):
    rnd = np.random.default_rng(seed)
    V, F, UV, C = [], [], [], []
    base = 0
    n = 30
    rach = np.array([[0.0, -0.46 + length * i / n, 0.0] for i in range(n + 1)])
    rach[:, 0] += 0.04 * np.sin(np.linspace(0, 2.0, n + 1))
    for i in range(n):
        a, b = rach[i], rach[i + 1]
        r = 0.004 * (1 - i / n) + 0.001
        V += [tuple(a + [-r, 0, 0]), tuple(a + [r, 0, 0]), tuple(b + [r, 0, 0]), tuple(b + [-r, 0, 0])]
        F.append((base, base + 1, base + 2, base + 3))
        UV += [(0.5, 0.0)] * 4
        C += [hexlin("#5f6b2c")] * 4
        base += 4
    for i in range(2, n):
        t = i / n
        size = 0.2 * math.sin(math.pi * min(t * 1.1, 1.0)) ** 0.7 * (1 - 0.6 * t) + 0.02
        for side in (-1, 1):
            lv, lf, luv = leaf_strip(size, size * 0.28, segs=8, serrate=0.12, fold=0.15, curl=-0.05, shape="pinna")
            ang = math.radians(90 - 25 * t) * side + (0 if side > 0 else math.pi)
            ang = math.radians(10 + 15 * t) if side > 0 else math.radians(170 - 15 * t)
            R = np.array(Matrix.Rotation(ang, 3, "Z") @ Matrix.Rotation(rnd.normal(0, 0.2), 3, "X"))
            lv = lv @ R.T + rach[i]
            V += [tuple(v) for v in lv]
            F += [tuple(np.array(f) + base) for f in lf]
            UV += [tuple(u) for u in luv]
            pal = palette[rnd.choice(len(palette), p=[q[1] for q in palette])][0]
            C += [tuple(np.array(hexlin(pal)) * rnd.uniform(0.9, 1.1))] * len(lv)
            base += len(lv)
    return np.array(V), F, np.array(UV), np.array(C)


def render_cell(objs, path_prefix):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 24
    sc.render.film_transparent = True
    sc.render.resolution_x = CELL
    sc.render.resolution_y = CELL
    sc.render.filter_size = 1.2
    sc.view_settings.view_transform = "Standard"
    sc.render.image_settings.file_format = "OPEN_EXR"
    sc.render.image_settings.color_depth = "32"
    sc.render.image_settings.color_mode = "RGBA"
    out = {}
    vl = sc.view_layers[0]
    for mode in (0, 1):
        vl["mode"] = float(mode)
        p = os.path.join(SCRATCH, f"{path_prefix}_{mode}.exr")
        sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        out[mode] = load_image_np(p)
    return out


def make_atlas():
    reset_scene()
    sc = bpy.context.scene
    cam_data = bpy.data.cameras.new("ortho")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 1.0
    cam = bpy.data.objects.new("cam", cam_data)
    link(cam)
    cam.location = (0, 0, 3)
    sc.camera = cam

    green = [("#4f7a2a", 0.35), ("#5c8a2e", 0.25), ("#3f6a24", 0.2), ("#7a9a3a", 0.12), ("#8c8a3a", 0.08)]
    green_b = [("#3e6526", 0.4), ("#4a7429", 0.3), ("#5a7f2c", 0.2), ("#6d7a30", 0.1)]
    fern_pal = [("#4a7a26", 0.5), ("#5e8a2e", 0.35), ("#6f8a30", 0.15)]
    bush_pal = [("#355b22", 0.4), ("#41692a", 0.35), ("#55752c", 0.25)]

    cells = [
        ("broadA", lambda: twig_cluster(11, 40, 0.11, 0.05, green, serrate=0.06, sides=4)),
        ("broadB", lambda: twig_cluster(12, 30, 0.14, 0.08, green_b, shape="ovate", serrate=0.02, sides=3)),
        ("fern", lambda: fern_frond(13, palette=fern_pal)),
        ("bush", lambda: twig_cluster(14, 56, 0.075, 0.038, bush_pal, shape="lanceolate", serrate=0.0, span=0.85,
                                       sides=4)),
    ]
    alb = np.zeros((ATLAS, ATLAS, 4), np.float32)
    nrm = np.zeros((ATLAS, ATLAS, 4), np.float32)
    for ci, (name, fn) in enumerate(cells):
        for o in list(bpy.data.objects):
            if o.type == "MESH":
                bpy.data.objects.remove(o, do_unlink=True)
        V, F, UV, C = fn()
        me = mesh_from_arrays(name, V, F, colors=C, attrs={"LeafUV": np.c_[UV, np.zeros(len(UV))]}, smooth=True)
        ob = obj_from_mesh(name, me)
        assign_material(ob, leaf_material(name + "_m", "#5c8a2e"))
        res = render_cell([ob], f"cell_{name}")
        a = res[0]
        nm = res[1]
        cx, cy = ci % 2, ci // 2
        ys = slice(cy * CELL, (cy + 1) * CELL)
        xs = slice(cx * CELL, (cx + 1) * CELL)
        alpha = a[:, :, 3:4]
        # un-premultiply (EXR from Cycles is premultiplied)
        rgb = a[:, :, :3] / np.maximum(alpha, 1e-4)
        nr = nm[:, :, :3] / np.maximum(alpha, 1e-4)
        alb[ys, xs, :3] = rgb
        alb[ys, xs, 3] = alpha[:, :, 0]
        nrm[ys, xs, :3] = nr
        nrm[ys, xs, 3] = alpha[:, :, 0]
        log("rendered cell", name)

    # bleed colours into transparent texels so mip-maps don't darken edges
    from scipy.ndimage import distance_transform_edt

    mask = alb[:, :, 3] < 0.5
    _, (iy, ix) = distance_transform_edt(mask, return_indices=True)
    alb[:, :, :3] = np.where(mask[:, :, None], alb[iy, ix, :3], alb[:, :, :3])
    nrm[:, :, :3] = np.where(mask[:, :, None], nrm[iy, ix, :3], nrm[:, :, :3])
    nrm[:, :, :3] = np.where(mask[:, :, None] & (alb[:, :, 3:4] < 0.01), np.array([0.5, 0.5, 1.0]), nrm[:, :, :3])
    # cutout edges: sharpen alpha a little
    a = np.clip((alb[:, :, 3] - 0.5) * 1.6 + 0.5, 0, 1)
    out_alb = np.dstack([lin2srgb(alb[:, :, :3]), a])
    save_image(out_alb, os.path.join(TEX_DIR, "foliage_albedo.webp"), quality=92)
    save_image(np.clip(nrm[:, :, :3], 0, 1), os.path.join(TEX_DIR, "foliage_normal.webp"), quality=90)


# =============================================================================
# 2. Trees
# =============================================================================

class Branch:
    __slots__ = ("pts", "rad", "level", "children", "phase", "parent_t")

    def __init__(self, level):
        self.pts = []
        self.rad = []
        self.level = level
        self.children = []
        self.phase = 0.0
        self.parent_t = 0.0


TREE_TYPES = {
    # trunk length, trunk radius, levels, children per level, branch angle (deg), length ratio,
    # up tendency, droop, wobble, leaf cell, crown flattening
    0: dict(name="keyaki", trunk=(3.6, 0.34), height=12.5, splits=4, levels=3, children=(0, 6, 5, 4),
            angle=(0, 28, 42, 50), ratio=(1.0, 0.62, 0.48, 0.42), up=(0.15, 0.25, 0.12, 0.05),
            droop=(0.0, 0.05, 0.12, 0.18), wobble=(0.05, 0.12, 0.16, 0.2), cell=0, cards=(0.85, 1.25)),
    1: dict(name="nara", trunk=(2.8, 0.3), height=9.5, splits=3, levels=3, children=(0, 7, 5, 4),
            angle=(0, 48, 45, 50), ratio=(1.0, 0.68, 0.5, 0.42), up=(0.1, 0.08, 0.06, 0.04),
            droop=(0.0, 0.1, 0.15, 0.2), wobble=(0.08, 0.16, 0.2, 0.22), cell=1, cards=(0.85, 1.2)),
    2: dict(name="hannoki", trunk=(6.0, 0.22), height=13.0, splits=1, levels=3, children=(0, 14, 4, 3),
            angle=(0, 52, 40, 45), ratio=(1.0, 0.32, 0.5, 0.45), up=(0.25, 0.18, 0.1, 0.05),
            droop=(0.0, 0.12, 0.15, 0.2), wobble=(0.03, 0.12, 0.16, 0.2), cell=0, cards=(0.75, 1.05)),
    3: dict(name="gnarled", trunk=(2.4, 0.42), height=8.0, splits=3, levels=3, children=(0, 7, 5, 4),
            angle=(0, 55, 45, 50), ratio=(1.0, 0.85, 0.5, 0.42), up=(0.0, 0.02, 0.05, 0.04),
            droop=(0.0, 0.14, 0.16, 0.2), wobble=(0.18, 0.2, 0.22, 0.22), cell=1, cards=(0.9, 1.3),
            lean=0.42),
}


def rand_perp(d, rnd):
    a = Vector(rnd.normal(size=3))
    p = a - d * a.dot(d)
    if p.length < 1e-6:
        p = Vector((1, 0, 0)) - d * d.x
    return p.normalized()


def grow(rnd, P, start, direction, length, radius, level, out, phase):
    b = Branch(level)
    b.phase = phase
    seg = 0.35 if level == 0 else (0.3 if level == 1 else 0.22)
    n = max(3, int(length / seg))
    step = length / n
    d = direction.normalized()
    p = start.copy()
    up = Vector((0, 0, 1))
    for i in range(n + 1):
        t = i / n
        r = radius * (1 - t * (0.62 if level == 0 else 0.8)) + 0.006
        b.pts.append(p.copy())
        b.rad.append(r)
        wob = Vector(rnd.normal(size=3)) * P["wobble"][level]
        d = (d + up * P["up"][level] * 0.25 + wob * 0.35 - up * P["droop"][level] * t * 0.5).normalized()
        p = p + d * step
    out.append(b)
    if level >= P["levels"]:
        return b
    nchild = P["children"][level + 1]
    golden = math.radians(137.5)
    rot0 = rnd.uniform(0, 6.28)
    for k in range(nchild):
        t = rnd.uniform(0.35, 0.95) if level > 0 else 1.0
        if level == 0:
            t = rnd.uniform(0.55, 0.98)
        idx = min(int(t * n), n - 1)
        at = b.pts[idx]
        bd = (b.pts[idx + 1] - b.pts[idx]).normalized()
        perp = rand_perp(bd, rnd)
        perp = (Quaternion(bd, rot0 + golden * k) @ perp).normalized()
        ang = math.radians(P["angle"][level + 1] + rnd.normal(0, 8))
        cd = (bd * math.cos(ang) + perp * math.sin(ang)).normalized()
        clen = length * P["ratio"][level + 1] * (1.15 - 0.45 * t) * rnd.uniform(0.8, 1.2)
        crad = b.rad[idx] * rnd.uniform(0.55, 0.72)
        c = grow(rnd, P, at, cd, clen, crad, level + 1, out, phase + rnd.uniform(0, 6.28))
        c.parent_t = t
        b.children.append(c)
    return b


def build_tree(variant, seed, lod=0):
    P = TREE_TYPES[variant]
    rnd = np.random.default_rng(seed)
    branches = []
    trunk_len, trunk_r = P["trunk"]
    lean = P.get("lean", 0.06)
    d0 = Vector((rnd.normal(0, lean), rnd.normal(0, lean), 1.0)).normalized()
    trunk = grow(rnd, dict(P, levels=0), Vector((0, 0, 0)), d0, trunk_len, trunk_r, 0, branches, 0.0)
    # main limbs from the top of the trunk (vase / spreading structure)
    top = trunk.pts[-1]
    tdir = (trunk.pts[-1] - trunk.pts[-2]).normalized()
    remaining = P["height"] - trunk_len
    golden = math.radians(137.5)
    for k in range(P["splits"]):
        perp = rand_perp(tdir, rnd)
        perp = (Quaternion(tdir, golden * k * 1.3) @ perp).normalized()
        spread = math.radians(rnd.uniform(18, 34) if P["splits"] > 1 else 4)
        if variant == 3:
            spread = math.radians(rnd.uniform(40, 62))
        cd = (tdir * math.cos(spread) + perp * math.sin(spread)).normalized()
        L = remaining * rnd.uniform(0.85, 1.05) / math.cos(spread * 0.6)
        if variant == 2:
            L = remaining
        limb = grow(rnd, P, top, cd, L, trunk.rad[-1] * (0.8 if P["splits"] > 1 else 0.95), 1 if P["splits"] > 1 else 0,
                    branches, rnd.uniform(0, 6.28))
        trunk.children.append(limb)
    return branches


def tube_arrays(branches, radial_fn, bark_tile=1.0, root_flare=True, max_level=3):
    V, F, UV, W = [], [], [], []
    base = 0
    zmax = max(p.z for b in branches for p in b.pts) + 1e-6
    for b in branches:
        if b.level > max_level:
            continue
        nr = radial_fn(b.level)
        pts = b.pts
        n = len(pts)
        # frames along the curve
        prev_n = None
        acc = 0.0
        for i in range(n):
            if i < n - 1:
                d = (pts[i + 1] - pts[i]).normalized()
            else:
                d = (pts[i] - pts[i - 1]).normalized()
            if prev_n is None:
                prev_n = rand_perp(d, np.random.default_rng(7))
            nvec = (prev_n - d * prev_n.dot(d)).normalized()
            prev_n = nvec
            bvec = d.cross(nvec)
            r = b.rad[i]
            if i > 0:
                acc += (pts[i] - pts[i - 1]).length
            circ = 2 * math.pi * r
            ku = max(1, round(circ / bark_tile)) if b.level == 0 else 1
            for j in range(nr + 1):
                a = j / nr * 2 * math.pi
                rr = r
                if root_flare and b.level == 0 and acc < 1.2:
                    # buttress roots at the base
                    fl = (1.2 - acc) / 1.2
                    rr = r * (1 + 0.9 * fl ** 2 * (0.6 + 0.4 * math.cos(a * 5 + 0.7)))
                off = nvec * math.cos(a) * rr + bvec * math.sin(a) * rr
                V.append(tuple(pts[i] + off))
                UV.append((j / nr * ku, acc / bark_tile))
                sway = (max(pts[i].z, 0.0) / zmax) ** 1.5
                W.append((min(sway, 1.0), b.phase / 6.283, 0.0, b.level / 3.0))
        for i in range(n - 1):
            for j in range(nr):
                a = base + i * (nr + 1) + j
                F.append((a, a + 1, a + nr + 2, a + nr + 1))
        base += n * (nr + 1)
    return np.array(V), F, np.array(UV), np.array(W)


def leaf_cards(branches, P, rnd, density=1.0, min_level=2):
    """Cluster cards along the outer twigs."""
    cards = []
    for b in branches:
        if b.level < min_level and not (b.level == P["levels"] and b.level >= 1):
            continue
        n = len(b.pts)
        L = sum((b.pts[i + 1] - b.pts[i]).length for i in range(n - 1))
        count = max(1, int(L / 0.13 * density))
        for k in range(count):
            t = 0.3 + 0.7 * (k + rnd.random()) / count
            idx = min(int(t * (n - 1)), n - 2)
            f = t * (n - 1) - idx
            p = b.pts[idx].lerp(b.pts[idx + 1], f)
            cards.append((p, b))
        if b.level == P["levels"]:
            cards.append((b.pts[-1], b))
    return cards


def build_leaf_arrays(cards, P, rnd, cell, size_range, zmax):
    pts = np.array([np.array(c[0]) for c in cards])
    center = pts.mean(0)
    center[2] = pts[:, 2].mean() * 0.9
    ext = np.abs(pts - center).max(0) + 1e-6
    V, F, UV, N, C, W = [], [], [], [], [], []
    # Blender UV convention (v up). Cell 0/1 are the top row of the atlas image.
    cu, cv = (cell % 2) * 0.5, (1 - cell // 2) * 0.5
    base = 0
    for (p, b) in cards:
        p = Vector(p)
        out = Vector(np.array(p) - center)
        out_n = out.normalized() if out.length > 1e-4 else Vector((0, 0, 1))
        # card orientation: mostly facing outwards/upwards with randomness
        nrm = (out_n * 0.6 + Vector((0, 0, 0.5)) + Vector(rnd.normal(size=3)) * 0.6).normalized()
        tang = rand_perp(nrm, rnd)
        bit = nrm.cross(tang)
        s = rnd.uniform(*size_range)
        # card hangs from the twig: shift so the twig base sits near the bottom edge
        c0 = p + bit * s * 0.35 + Vector(rnd.normal(size=3)) * 0.08
        corners = [(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)]
        rel = (np.array(p) - center) / ext
        depth = float(np.clip(np.linalg.norm(rel), 0, 1.3))
        ao = 0.45 + 0.55 * min(depth, 1.0) ** 1.2
        ao *= 0.8 + 0.2 * float(np.clip((p.z - center[2]) / (ext[2] + 1e-6) * 0.5 + 0.6, 0, 1))
        tint = rnd.uniform(0.85, 1.12)
        hue = rnd.uniform(-0.06, 0.06)
        col = (ao * tint * (1 + hue), ao * tint, ao * tint * (1 - hue))
        sph = Vector(np.array(c0) - center).normalized()
        for (x, y) in corners:
            v = c0 + tang * x * s + bit * y * s
            V.append(tuple(v))
            UV.append((cu + (x + 0.5) * 0.5, cv + (y + 0.5) * 0.5))
            n2 = (sph * 0.75 + nrm * 0.25).normalized()
            N.append(tuple(n2))
            C.append(col + (1.0,))
            sway = (max(v.z, 0.0) / zmax) ** 1.5
            W.append((min(sway, 1.0), b.phase / 6.283, 1.0, 1.0))
        F.append((base, base + 1, base + 2, base + 3))
        base += 4
    return np.array(V), F, np.array(UV), np.array(N), np.array(C), np.array(W)


def make_mesh_obj(name, V, F, UV, W, colors=None, normals=None, mat=None):
    if colors is None:
        colors = np.ones((len(V), 4), np.float32)  # joined meshes need the attribute everywhere
    me = mesh_from_arrays(name, V, F, uvs=UV, colors=colors, attrs={"_WIND": W}, smooth=True)
    if normals is not None:
        me.normals_split_custom_set_from_vertices([tuple(n) for n in normals])
    ob = obj_from_mesh(name, me)
    if mat is not None:
        assign_material(ob, mat)
    return ob


# Crown envelopes for the space colonisation trees (z up, metres)
CROWNS = {
    # trunk top, crown shape fn(h, rnd) -> points, attractor count, card size, leaf cell
    0: dict(name="keyaki", trunk=3.4, n=2600, size=(0.9, 1.3), cell=0,
            shape=("vase", 3.0, 12.8, 6.4)),
    1: dict(name="nara", trunk=2.6, n=2100, size=(0.85, 1.2), cell=1,
            shape=("ellipsoid", (0.0, 0.0, 6.6), (4.6, 4.2, 3.6))),
    2: dict(name="hannoki", trunk=3.8, n=1900, size=(0.8, 1.1), cell=0,
            shape=("ellipsoid", (0.0, 0.0, 8.4), (3.1, 3.0, 5.0))),
    3: dict(name="gnarled", trunk=2.0, n=2100, size=(0.9, 1.3), cell=1,
            shape=("ellipsoid", (2.4, 0.4, 5.0), (5.4, 4.0, 2.7)), lean=(1.1, 0.25)),
}


def crown_points(spec, rnd):
    kind = spec["shape"][0]
    pts = []
    while len(pts) < spec["n"]:
        if kind == "ellipsoid":
            c, r = np.array(spec["shape"][1]), np.array(spec["shape"][2])
            q = rnd.uniform(-1, 1, 3)
            if np.linalg.norm(q) > 1:
                continue
            # flatten the underside a little
            if q[2] < -0.55 and rnd.random() < 0.6:
                continue
            pts.append(c + q * r)
        else:  # vase: widening upwards, domed top
            _, z0, z1, rmax = spec["shape"]
            z = rnd.uniform(z0, z1)
            t = (z - z0) / (z1 - z0)
            rr = rmax * (0.35 + 0.65 * math.sin(min(t * 1.25, 1.0) * math.pi / 2)) * (1 - max(t - 0.82, 0) * 2.5)
            a = rnd.uniform(0, 2 * math.pi)
            d = math.sqrt(rnd.random()) * max(rr, 0.3)
            pts.append((math.cos(a) * d, math.sin(a) * d, z))
    return np.array(pts)


def colonise(spec, rnd, seg=0.27, infl=2.6, kill=0.48, iters=220):
    from scipy.spatial import cKDTree

    attract = crown_points(spec, rnd)
    lean = spec.get("lean", (0.0, 0.0))
    pos = [np.zeros(3)]
    par = [-1]
    ntr = int(spec["trunk"] / seg)
    for i in range(1, ntr + 1):
        t = i / ntr
        p = np.array([lean[0] * t * t, lean[1] * t * t, spec["trunk"] * t])
        p[:2] += rnd.normal(0, 0.02, 2)
        pos.append(p)
        par.append(i - 1)
    alive = np.ones(len(attract), bool)
    up = np.array([0, 0, 1.0])
    for it in range(iters):
        P = np.array(pos)
        tree = cKDTree(P)
        A = attract[alive]
        if len(A) == 0:
            break
        d, idx = tree.query(A, distance_upper_bound=infl)
        ok = np.isfinite(d)
        if not ok.any():
            break
        vec = A[ok] - P[idx[ok]]
        vec /= np.linalg.norm(vec, axis=1, keepdims=True) + 1e-9
        acc = np.zeros_like(P)
        cnt = np.zeros(len(P))
        np.add.at(acc, idx[ok], vec)
        np.add.at(cnt, idx[ok], 1)
        grew = 0
        new_pts = []
        for n in np.nonzero(cnt)[0]:
            dvec = acc[n] / cnt[n]
            if np.linalg.norm(dvec) < 0.15:
                dvec = dvec + rnd.normal(0, 0.3, 3)
            dvec = dvec / (np.linalg.norm(dvec) + 1e-9) + up * 0.08 + rnd.normal(0, 0.08, 3)
            dvec /= np.linalg.norm(dvec) + 1e-9
            npnt = P[n] + dvec * seg
            # don't grow onto an existing node
            if tree.query(npnt)[0] < seg * 0.45:
                continue
            pos.append(npnt)
            par.append(int(n))
            new_pts.append(npnt)
            grew += 1
        if grew == 0:
            break
        nt = cKDTree(np.array(new_pts))
        dk, _ = nt.query(attract, distance_upper_bound=kill)
        alive &= ~np.isfinite(dk)
    return np.array(pos), np.array(par)


def pipe_radii(pos, par, r_tip=0.014, exp=2.0):
    n = len(pos)
    children = [[] for _ in range(n)]
    for i in range(1, n):
        children[par[i]].append(i)
    r = np.zeros(n)
    for i in range(n - 1, -1, -1):
        if not children[i]:
            r[i] = r_tip
        else:
            r[i] = sum(r[c] ** exp for c in children[i]) ** (1 / exp)
    return r, children


def chains_from(pos, par, r, children):
    """Split the node tree into smooth chains (main child continues the chain)."""
    chains = []
    stack = [(0, None)]
    while stack:
        start, parent_node = stack.pop()
        chain = [parent_node] if parent_node is not None else []
        n = start
        while True:
            chain.append(n)
            ch = children[n]
            if not ch:
                break
            main = max(ch, key=lambda c: r[c])
            for c in ch:
                if c != main:
                    stack.append((c, n))
            n = main
        chains.append(chain)
    return chains


def smooth_chain(P, iters=2):
    P = P.copy()
    for _ in range(iters):
        if len(P) > 2:
            P[1:-1] = P[1:-1] * 0.5 + (P[:-2] + P[2:]) * 0.25
    return P


def tree_wood_arrays(pos, r, chains, lod, zmax, phase_rnd):
    V, F, UV, W = [], [], [], []
    base = 0
    min_r = (0.026, 0.05, 0.09)[lod]
    for ci, ch in enumerate(chains):
        ch = [n for n in ch if r[n] >= min_r * 0.7] if len(ch) > 2 else ch
        if len(ch) < 2:
            continue
        P = smooth_chain(pos[ch])
        R = r[ch]
        R[0] = min(R[0], R[1] * 1.05) if len(R) > 1 else R[0]
        if R.max() < min_r:
            continue
        rmax = R.max()
        nr = (10 if rmax > 0.15 else 7 if rmax > 0.06 else 5 if rmax > 0.03 else 3)
        if lod >= 1:
            nr = max(3, nr // (2 * lod))
        phase = phase_rnd.uniform(0, 1)
        prev = None
        acc = 0.0
        is_trunk = ci == 0
        for i in range(len(P)):
            d = P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]
            d /= np.linalg.norm(d) + 1e-9
            if prev is None:
                a = np.array([1.0, 0, 0]) if abs(d[0]) < 0.9 else np.array([0, 1.0, 0])
                prev = a - d * a.dot(d)
            nv = prev - d * prev.dot(d)
            nv /= np.linalg.norm(nv) + 1e-9
            prev = nv
            bv = np.cross(d, nv)
            if i > 0:
                acc += np.linalg.norm(P[i] - P[i - 1])
            circ = 2 * math.pi * R[i]
            ku = max(1, round(circ)) if R[i] > 0.12 else 1
            for j in range(nr + 1):
                a = j / nr * 2 * math.pi
                rr = R[i]
                if is_trunk and P[i][2] < 1.0:
                    fl = (1.0 - P[i][2])
                    rr = R[i] * (1 + 0.85 * fl ** 2 * (0.55 + 0.45 * math.cos(a * 5 + 0.7)))
                off = nv * math.cos(a) * rr + bv * math.sin(a) * rr
                V.append(tuple(P[i] + off))
                UV.append((j / nr * ku, acc))
                sway = (max(P[i][2], 0) / zmax) ** 1.5
                W.append((min(sway, 1.0), phase, 0.0, min(1.0, 0.05 / max(R[i], 0.01))))
        for i in range(len(P) - 1):
            for j in range(nr):
                a = base + i * (nr + 1) + j
                F.append((a, a + 1, a + nr + 2, a + nr + 1))
        base += len(P) * (nr + 1)
    return np.array(V), F, np.array(UV), np.array(W)


def tree_cards(pos, r, children, spec, rnd, lod, zmax):
    leaf_nodes = [i for i in range(len(pos)) if r[i] < (0.026 if lod == 0 else 0.03) and pos[i][2] > spec["trunk"] * 0.8]
    keep = (1.0, 0.62, 0.12)[lod]
    cards = []

    class _B:
        phase = 0.0

    for i in leaf_nodes:
        if rnd.random() > keep * 0.9:
            continue
        b = _B()
        b.phase = float((i * 0.618) % 1.0) * 6.283
        cards.append((Vector(pos[i]), b))
    size = (spec["size"], (spec["size"][0] * 1.45, spec["size"][1] * 1.5), (spec["size"][0] * 2.6, spec["size"][1] * 2.9))[lod]
    return build_leaf_arrays(cards, None, rnd, spec["cell"], size, zmax)


def build_trees():
    reset_scene()
    bark = principled_material("bark")
    leaves = principled_material("leaves")
    objs = []
    for v in range(4):
        spec = CROWNS[v]
        rnd = np.random.default_rng(500 + v)
        pos, par = colonise(spec, rnd)
        r, children = pipe_radii(pos, par)
        chains = chains_from(pos, par, r, children)
        zmax = pos[:, 2].max()
        log(f"tree {v}: {len(pos)} nodes, trunk radius {r[0]:.2f} m, height {zmax:.1f} m")
        for lod in (0, 1, 2):
            tv, tf, tuv, tw = tree_wood_arrays(pos, r.copy(), chains, lod, zmax, np.random.default_rng(9 + v))
            name = f"tree_{v}{'' if lod == 0 else f'_lod{lod}'}"
            wood = make_mesh_obj(name + "_bark", tv, tf, tuv, tw, mat=bark)
            lv, lf, luv, ln, lc, lw = tree_cards(pos, r, children, spec, np.random.default_rng(77 + v + lod), lod, zmax)
            leaf = make_mesh_obj(name + "_leaves", lv, lf, luv, lw, colors=lc, normals=ln, mat=leaves)
            ob = join_keep([wood, leaf], name)
            log(f"  lod{lod}: {len(tf)} wood quads, {len(lf)} cards")
            objs.append(ob)
    export_glb(objs, os.path.join(MODEL_DIR, "trees.glb"))
    return objs


def join_keep(objs, name):
    select_only(objs, objs[0])
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


# =============================================================================
# 3. Bushes, ferns, reeds
# =============================================================================

def build_bush(seed, height, width, cell=3, cards=160):
    rnd = np.random.default_rng(seed)
    branches = []
    stems = int(rnd.integers(4, 7))
    P = dict(wobble=(0.2, 0.2, 0.2, 0.2), up=(0.2, 0.1, 0.05, 0.05), droop=(0, 0.15, 0.2, 0.2), levels=1,
             children=(0, 4, 0, 0), angle=(0, 40, 0, 0), ratio=(1, 0.5, 0, 0))
    for s in range(stems):
        a = rnd.uniform(0, 6.28)
        d = Vector((math.cos(a) * 0.5, math.sin(a) * 0.5, 1.0)).normalized()
        grow(rnd, P, Vector((rnd.normal(0, 0.08), rnd.normal(0, 0.08), 0)), d, height * rnd.uniform(0.8, 1.05),
             0.018, 0, branches, rnd.uniform(0, 6.28))
    tv, tf, tuv, tw = tube_arrays(branches, lambda lv: 4, bark_tile=0.5, root_flare=False, max_level=1)
    # leaf cards distributed in an ellipsoid volume, denser outside
    pts = []
    while len(pts) < cards:
        p = rnd.uniform(-1, 1, 3)
        r = np.linalg.norm(p)
        if r > 1 or r < 0.45:
            continue
        pts.append(p)
    zmax = height * 1.05
    cardlist = []
    for p in pts:
        pos = Vector((p[0] * width * 0.5, p[1] * width * 0.5, (p[2] * 0.5 + 0.5) * height * 0.95 + 0.08))
        b = branches[int(rnd.integers(len(branches)))]
        cardlist.append((pos, b))
    lv, lf, luv, ln, lc, lw = build_leaf_arrays(cardlist, dict(levels=1), rnd, cell, (0.42, 0.62), zmax)
    return (tv, tf, tuv, tw), (lv, lf, luv, ln, lc, lw)


def build_fern(seed, fronds=11):
    rnd = np.random.default_rng(seed)
    V, F, UV, N, C, W = [], [], [], [], [], []
    base = 0
    for k in range(fronds):
        yaw = k / fronds * 2 * math.pi + rnd.normal(0, 0.2)
        L = rnd.uniform(0.7, 1.05)
        rise = math.radians(rnd.uniform(35, 65))
        segs = 4
        dirh = Vector((math.cos(yaw), math.sin(yaw), 0))
        side = Vector((-math.sin(yaw), math.cos(yaw), 0))
        width = L * 0.42
        for i in range(segs + 1):
            t = i / segs
            ang = rise - t * t * math.radians(80)
            # integrate a drooping arc
            x = sum(math.cos(rise - (j / segs) ** 2 * math.radians(80)) for j in range(i)) * L / segs
            z = sum(math.sin(rise - (j / segs) ** 2 * math.radians(80)) for j in range(i)) * L / segs
            p = dirh * x + Vector((0, 0, z))
            for sgn in (-1, 1):
                v = p + side * sgn * width * 0.5
                V.append(tuple(v))
                # frond texture: rachis runs up the cell (v), leaflets across (u)
                UV.append(((sgn * 0.5 + 0.5) * 0.5, t * 0.5))  # cell 2 = bottom-left
                nrm = (Vector((-math.sin(ang) * dirh.x, -math.sin(ang) * dirh.y, math.cos(ang)))).normalized()
                N.append(tuple(nrm))
                c = rnd.uniform(0.85, 1.1)
                C.append((c * (0.6 + 0.4 * t), c * (0.6 + 0.4 * t), c * (0.6 + 0.4 * t), 1.0))
                W.append((t, k / fronds, 1.0, 1.0))
        for i in range(segs):
            a = base + i * 2
            F.append((a, a + 1, a + 3, a + 2))
        base += (segs + 1) * 2
    return np.array(V), F, np.array(UV), np.array(N), np.array(C), np.array(W)


def build_reeds(seed, blades=26, spikes=4):
    rnd = np.random.default_rng(seed)
    V, F, C, W, UV = [], [], [], [], []
    base = 0
    for k in range(blades + spikes):
        spike = k >= blades
        a = rnd.uniform(0, 6.28)
        r = rnd.uniform(0, 0.18)
        x0, y0 = math.cos(a) * r, math.sin(a) * r
        H = rnd.uniform(1.0, 1.7) if not spike else rnd.uniform(1.5, 1.9)
        lean = rnd.uniform(0.05, 0.35)
        yaw = rnd.uniform(0, 6.28)
        segs = 6
        w0 = 0.012 if not spike else 0.004
        for i in range(segs + 1):
            t = i / segs
            bend = lean * t * t * H
            cx = x0 + math.cos(yaw) * bend
            cy = y0 + math.sin(yaw) * bend
            z = H * t * (1 - 0.2 * lean * t)
            w = w0 * (1 - t ** 1.5) + 0.001
            for sgn in (-1, 1):
                V.append((cx - math.sin(yaw) * w * sgn, cy + math.cos(yaw) * w * sgn, z))
                g = (0.05 + 0.08 * t, 0.09 + 0.1 * t, 0.025 + 0.02 * t) if not spike else (0.07, 0.09, 0.04)
                C.append(g + (1.0,))
                W.append((t, k / 30.0, 1.0, 1.0))
                UV.append((0.99, 0.99))
        for i in range(segs):
            q = base + i * 2
            F.append((q, q + 1, q + 3, q + 2))
        base += (segs + 1) * 2
        if spike:
            # brown cattail head near the top
            hz = H * 0.82
            cx = x0 + math.cos(yaw) * lean * 0.67 * H
            cy = y0 + math.sin(yaw) * lean * 0.67 * H
            ring = 6
            for i in range(3):
                z = hz + i * 0.09
                for j in range(ring):
                    aa = j / ring * 6.283
                    V.append((cx + math.cos(aa) * 0.018, cy + math.sin(aa) * 0.018, z))
                    C.append((0.16, 0.09, 0.05, 1.0))
                    W.append((0.85, k / 30.0, 1.0, 1.0))
                    UV.append((0.99, 0.99))
            for i in range(2):
                for j in range(ring):
                    a0 = base + i * ring + j
                    a1 = base + i * ring + (j + 1) % ring
                    F.append((a0, a1, a1 + ring, a0 + ring))
            base += 3 * ring
    return np.array(V), F, np.array(C), np.array(W), np.array(UV)


def build_plants():
    reset_scene()
    bark = principled_material("bark")
    leaves = principled_material("leaves")
    plain = principled_material("reed")
    objs = []
    for i, (h, w, n) in enumerate(((1.25, 1.7, 150), (0.8, 1.2, 95))):
        (tv, tf, tuv, tw), (lv, lf, luv, ln, lc, lw) = build_bush(200 + i, h, w, cards=n)
        wood = make_mesh_obj(f"bush_{i}_bark", tv, tf, tuv, tw, mat=bark)
        leaf = make_mesh_obj(f"bush_{i}_leaves", lv, lf, luv, lw, colors=lc, normals=ln, mat=leaves)
        objs.append(join_keep([wood, leaf], f"bush_{i}"))
    fv, ff, fuv, fn, fc, fw = build_fern(300)
    objs.append(make_mesh_obj("fern", fv, ff, fuv, fw, colors=fc, normals=fn, mat=leaves))
    rv, rf, rc, rw, ruv = build_reeds(400)
    objs.append(make_mesh_obj("reeds", rv, rf, ruv, rw, colors=rc, mat=plain))
    export_glb(objs, os.path.join(MODEL_DIR, "plants.glb"))


if __name__ == "__main__":
    what = sys.argv[1:] or ["atlas", "trees", "plants"]
    if "atlas" in what:
        make_atlas()
    if "trees" in what:
        build_trees()
    if "plants" in what:
        build_plants()
