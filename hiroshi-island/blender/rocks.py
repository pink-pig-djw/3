"""Boulders: 8 variants sculpted procedurally as ~300k-triangle high-poly
meshes, decimated to game meshes and baked (normal, AO, albedo) into one
shared 2048 atlas.

Outputs:
    public/assets/models/rocks.glb             rock_0 .. rock_7 (origin = base centre, ~1 m wide)
    public/assets/textures/rocks_albedo.webp
    public/assets/textures/rocks_normal.webp
    public/assets/textures/rocks_orm.webp      R = AO, G = roughness, B = cavity
"""

import math
import os
import sys

import bpy  # noqa: I001
import bmesh
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (MODEL_DIR, NT, TEX_DIR, assign_material, bake, export_glb, fbm3, hexlin,  # noqa: E402
                    join, lin2srgb, log, mesh_from_arrays, new_float_image, noise3, obj_from_mesh,
                    principled_material, reset_scene, save_image, select_only)

ATLAS = int(os.environ.get("HIROSHI_ROCK_ATLAS", "2048"))
HIGH_SUBDIV = int(os.environ.get("HIROSHI_ROCK_SUBDIV", "8"))

# kind, radii (x, y, z), seed, base colour
VARIANTS = [
    ("river", (1.0, 0.82, 0.58), 1, "#a39b8d"),
    ("river", (1.0, 0.70, 0.50), 2, "#9b968b"),
    ("river", (1.0, 0.90, 0.66), 3, "#a69a86"),
    ("river", (1.0, 0.76, 0.46), 4, "#928d84"),
    ("angular", (1.0, 0.86, 0.78), 5, "#8a847a"),
    ("angular", (1.0, 0.75, 0.62), 6, "#857f76"),
    ("slab", (1.0, 0.86, 0.30), 7, "#968f83"),
    ("slab", (1.0, 0.78, 0.26), 8, "#8f897f"),
]


def icosphere(subdiv):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    v = np.array([vv.co[:] for vv in bm.verts], np.float64)
    f = np.array([[vv.index for vv in ff.verts] for ff in bm.faces], np.int32)
    bm.free()
    return v, f


def softplus(x, k):
    return np.log1p(np.exp(-np.abs(x * k))) / k + np.maximum(x, 0)


def sculpt(kind, radii, seed, V):
    rnd = np.random.default_rng(seed)
    p = V.copy()
    n = p / np.linalg.norm(p, axis=1, keepdims=True)
    off = rnd.uniform(-50, 50, 3)
    # large-scale lumps
    r = 1.0 + 0.16 * fbm3(n * 1.1 + off, 3, seed=seed) + 0.05 * fbm3(n * 2.6 + off * 1.3, 3, seed=seed + 1)
    p = n * r[:, None]
    p *= np.array(radii)
    if kind == "angular":
        # cleave with random planes (soft clamp keeps edges slightly rounded)
        for k in range(9):
            pn = rnd.normal(size=3)
            pn[2] = abs(pn[2]) * 0.6 + (0.3 if k < 2 else 0.0)
            pn /= np.linalg.norm(pn)
            proj = p @ pn
            d = np.percentile(proj, rnd.uniform(78, 92))
            excess = softplus(proj - d, 60.0)
            p -= np.outer(excess, pn) * 0.92
    elif kind == "slab":
        # flatten the top into a gently domed walking surface
        top = np.percentile(p[:, 2], 70)
        ex = softplus(p[:, 2] - top, 25.0)
        p[:, 2] -= ex * 0.8
    # medium and fine detail along the surface normal
    nn = p / (np.linalg.norm(p, axis=1, keepdims=True) + 1e-9)
    amp_med = {"river": 0.018, "angular": 0.03, "slab": 0.02}[kind]
    amp_fine = {"river": 0.004, "angular": 0.008, "slab": 0.006}[kind]
    d = amp_med * fbm3(p * 4.0 + off, 4, seed=seed + 2) + amp_fine * fbm3(p * 18.0 + off, 3, seed=seed + 3)
    # small pits / vugs
    pits = np.clip((noise3(p * 26.0 + off, seed + 4) - 0.78) * 4.0, 0, 1)
    d -= pits * 0.006
    p += nn * d[:, None]
    # flat-ish bottom (hidden in the ground)
    zmin = np.percentile(p[:, 2], 6)
    p[:, 2] = np.maximum(p[:, 2], zmin + (p[:, 2] - zmin) * 0.2)
    # normalise: ~1 m wide, origin at base centre
    p[:, 0] -= (p[:, 0].max() + p[:, 0].min()) / 2
    p[:, 1] -= (p[:, 1].max() + p[:, 1].min()) / 2
    p[:, 2] -= p[:, 2].min()
    s = 1.0 / max(np.ptp(p[:, 0]), np.ptp(p[:, 1]))
    return p * s


def rock_colors(kind, base_hex, seed, P):
    rnd = np.random.default_rng(seed + 100)
    base = np.array(hexlin(base_hex))
    off = rnd.uniform(-50, 50, 3)
    big = fbm3(P * 2.0 + off, 4, seed=seed + 10)
    mid = fbm3(P * 7.0 + off, 3, seed=seed + 11)
    c = base[None, :] * (1 + 0.22 * big[:, None] + 0.08 * mid[:, None])
    # mineral banding on some river rocks
    if kind == "river" and seed % 2 == 0:
        band = np.sin((P @ rnd.normal(size=3)) * rnd.uniform(14, 24) + mid * 3) * 0.5 + 0.5
        c *= (1 - 0.1 * (band ** 6))[:, None]
        q = np.clip((band - 0.96) * 25, 0, 1)
        c = c * (1 - q[:, None]) + np.array(hexlin("#d8d4cc"))[None, :] * q[:, None]
    # warm iron staining
    stain = np.clip((fbm3(P * 3.0 + off * 2, 3, seed=seed + 12) - 0.25) * 3, 0, 1)
    c = c * (1 - 0.35 * stain[:, None]) + np.array(hexlin("#8a6a4a"))[None, :] * 0.35 * stain[:, None]
    # lichen rosettes on the upper half
    up = np.clip((P[:, 2] / (P[:, 2].max() + 1e-6) - 0.45) * 3, 0, 1)
    li = np.clip((noise3(P * 22.0 + off, seed + 13) - 0.72) * 6, 0, 1) * up
    c = c * (1 - 0.6 * li[:, None]) + np.array(hexlin("#c3c6b4"))[None, :] * 0.6 * li[:, None]
    return np.clip(c, 0, 1)


def speckle_material(name):
    """Vertex colour x fine mineral speckle evaluated per shading point."""
    mat = bpy.data.materials.new(name)
    nt = NT(mat)
    out = nt.new("ShaderNodeOutputMaterial")
    p = nt.new("ShaderNodeBsdfPrincipled")
    nt.set(p, "Roughness", 0.75)
    col = nt.new("ShaderNodeAttribute", props={"attribute_name": "Col"})
    tc = nt.new("ShaderNodeTexCoord")
    nz = nt.new("ShaderNodeTexNoise", Scale=420.0, Detail=2.0, Roughness=0.6)
    nt.link(tc, "Object", nz, "Vector")
    ramp = nt.new("ShaderNodeValToRGB")
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.30, (0.55, 0.55, 0.55, 1)
    els[1].position, els[1].color = 0.37, (1, 1, 1, 1)
    e = els.new(0.64)
    e.color = (1, 1, 1, 1)
    e = els.new(0.71)
    e.color = (1.3, 1.3, 1.28, 1)
    nt.link(nz, "Fac", ramp, "Fac")
    m = nt.mix("RGBA", 1.0, (col, "Color"), (ramp, "Color"), blend="MULTIPLY")
    nt.link(m, "Result", p, "Base Color")
    nt.link(p, "BSDF", out, "Surface")
    return mat


def build():
    sc = reset_scene()
    V0, F0 = icosphere(HIGH_SUBDIV)
    highs, lows = [], []
    mat_hi = speckle_material("rock_high")
    mat_lo = principled_material("rock")
    for i, (kind, radii, seed, base) in enumerate(VARIANTS):
        P = sculpt(kind, radii, seed, V0)
        C = rock_colors(kind, base, seed, P)
        me = mesh_from_arrays(f"rock_{i}_high", P, F0, colors=C)
        hi = obj_from_mesh(f"rock_{i}_high", me)
        assign_material(hi, mat_hi)
        # game mesh: decimated copy
        lo = obj_from_mesh(f"rock_{i}", mesh_from_arrays(f"rock_{i}", P, F0))
        assign_material(lo, mat_lo)
        mod = lo.modifiers.new("dec", "DECIMATE")
        mod.ratio = 2400 / len(F0)
        select_only([lo], lo)
        bpy.ops.object.modifier_apply(modifier="dec")
        # spread the variants apart so baking rays never hit a neighbour
        hi.location.x = lo.location.x = i * 3.0
        highs.append(hi)
        lows.append(lo)
        log(f"rock {i} ({kind}): high {len(F0)} faces, low {len(lo.data.polygons)}")

    # UVs: unwrap all game meshes into one shared atlas
    select_only(lows, lows[0])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(82), island_margin=0.004, area_weight=0.0,
                             scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=0.004, rotate=True)
    bpy.ops.object.mode_set(mode="OBJECT")

    sc.world.light_settings.distance = 0.25
    # bake everything in one pass onto a joined copy of the game meshes
    copies = []
    for lo in lows:
        c = lo.copy()
        c.data = lo.data.copy()
        bpy.context.scene.collection.objects.link(c)
        copies.append(c)
    bake_low = join(copies, "bake_low")
    for lo in lows:
        lo.hide_render = True  # coincident with bake_low: would occlude the AO rays
    img = new_float_image("rock_bake", ATLAS)
    results = {}
    for kind, passes, samples in (("NORMAL", None, 4), ("DIFFUSE", {"COLOR"}, 4)):
        results[kind] = bake(bake_low, highs, kind, img, extrusion=0.07, max_dist=0.14, margin=16,
                             samples=samples, pass_filter=passes)
        log("baked", kind)
    # AO straight on the game mesh: robust (no cage misses) and smooth; the
    # fine cavities come from the normal map and the cavity channel below.
    for hi in highs:
        hi.hide_render = True  # they overlap the game meshes
    results["AO"] = bake(bake_low, [], "AO", img, margin=16, samples=96)
    for hi in highs:
        hi.hide_render = False
    log("baked AO")
    bpy.data.objects.remove(bake_low, do_unlink=True)
    for lo in lows:
        lo.hide_render = False

    alb = lin2srgb(results["DIFFUSE"][:, :, :3])
    nrm = results["NORMAL"][:, :, :3]
    ao = results["AO"][:, :, 0]
    nz = results["NORMAL"][:, :, 2] * 2 - 1
    cav = np.clip(1.0 - (1.0 - nz) * 6.0, 0, 1)
    orm = np.stack([ao, np.full_like(ao, 0.74), cav], 2)
    save_image(alb, os.path.join(TEX_DIR, "rocks_albedo.webp"), quality=90)
    save_image(nrm, os.path.join(TEX_DIR, "rocks_normal.webp"), quality=92)
    save_image(orm, os.path.join(TEX_DIR, "rocks_orm.webp"), quality=90)

    for lo in lows:
        lo.location.x = 0
    export_glb(lows, os.path.join(MODEL_DIR, "rocks.glb"), colors=False, attributes=False)
    return highs, lows


if __name__ == "__main__":
    build()
