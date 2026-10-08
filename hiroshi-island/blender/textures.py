"""Tileable PBR texture sets, baked with Cycles from real micro-geometry.

Each set is modelled as a small patch of actual geometry (pebbles, grass blades,
leaves, displaced rock...) that wraps around the tile borders. It is then baked
top-down onto a flat plane with "selected to active", which gives:

    <name>_albedo.webp   sRGB base colour
    <name>_normal.webp   tangent-space normal (OpenGL, +Y up)
    <name>_orm.webp      R = ambient occlusion, G = roughness, B = height

Run:  python blender/textures.py [names...]
"""

import json
import math
import os
import sys
import time

import bpy  # noqa: I001  (bpy must be imported before bmesh/mathutils)
import bmesh
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (NT, TEX_DIR, assign_material, bake, export_glb, grid_mesh_arrays,  # noqa: E402,F401
                    height_emitter, hexlin, lin2srgb, log, mesh_from_arrays, new_float_image,
                    noise3, obj_from_mesh, periodic_noise, periodic_worley, reset_scene,
                    resize_np, sample_periodic, save_image, swap_to_emission, vertex_color_material)

BAKE_RES = int(os.environ.get("HIROSHI_BAKE_RES", "1024"))
OUT_RES = int(os.environ.get("HIROSHI_TEX_RES", "1024"))


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def icosphere_arrays(subdiv=3):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    v = np.array([vv.co[:] for vv in bm.verts], np.float32)
    f = np.array([[vv.index for vv in ff.verts] for ff in bm.faces], np.int32)
    bm.free()
    return v, f


def wrap_copies(xy, reach, S):
    """Indices + offsets for elements within `reach` of the tile border."""
    out_idx, out_off = [], []
    for dx in (-S, 0.0, S):
        for dy in (-S, 0.0, S):
            if dx == 0 and dy == 0:
                continue
            p = xy + np.array([dx, dy])
            m = (p[:, 0] > -reach) & (p[:, 0] < S + reach) & (p[:, 1] > -reach) & (p[:, 1] < S + reach)
            ids = np.nonzero(m)[0]
            out_idx.append(ids)
            out_off.append(np.repeat([[dx, dy]], len(ids), 0))
    return np.concatenate(out_idx), np.concatenate(out_off)


def pack_circles(S, radii, seed, overlap=0.92, tries=40, existing=None):
    """Greedy periodic circle packing. radii: candidate radii (placed big->small)."""
    rnd = np.random.default_rng(seed)
    cell = max(radii) * 2.0
    ncell = max(1, int(S / cell))
    cell = S / ncell
    grid = {}
    placed = []

    def cells_near(x, y, r):
        rr = int(math.ceil((r + max(radii)) / cell))
        cx, cy = int(x / cell), int(y / cell)
        for i in range(cx - rr, cx + rr + 1):
            for j in range(cy - rr, cy + rr + 1):
                yield (i % ncell, j % ncell)

    def ok(x, y, r):
        for key in cells_near(x, y, r):
            for (px, py, pr) in grid.get(key, ()):
                dx = (x - px + S / 2) % S - S / 2
                dy = (y - py + S / 2) % S - S / 2
                if dx * dx + dy * dy < ((r + pr) * overlap) ** 2:
                    return False
        return True

    def add(x, y, r):
        key = (int(x / cell) % ncell, int(y / cell) % ncell)
        grid.setdefault(key, []).append((x, y, r))
        placed.append((x, y, r))

    for (x, y, r) in existing or []:
        add(x, y, r)
    for r in sorted(radii, reverse=True):
        for _ in range(tries):
            x, y = rnd.random() * S, rnd.random() * S
            if ok(x, y, r):
                add(x, y, r)
                break
    return np.array(placed[len(existing or []):], np.float64).reshape(-1, 3)


def pebbles_arrays(circles, S, seed, palette, flat=(0.35, 0.6), embed=(0.15, 0.45),
                   rough=(0.55, 0.8), subdiv=3, speckle=0.25, lumpy=0.12):
    """Stamp deformed ellipsoid pebbles for every circle (x, y, r)."""
    base_v, base_f = icosphere_arrays(subdiv)
    rnd = np.random.default_rng(seed)
    if len(circles) == 0:
        return None
    # wrap duplicates
    idx, off = wrap_copies(circles[:, :2], circles[:, 2].max(), S)
    allc = np.concatenate([circles, np.column_stack([circles[idx, :2] + off, circles[idx, 2]])])
    src = np.concatenate([np.arange(len(circles)), idx])  # identity of each copy
    n = len(allc)
    nv = len(base_v)
    # per-original-pebble params (copies share them so wrapping is seamless)
    P = len(circles)
    ry = rnd.uniform(0.62, 0.95, P)
    rz = rnd.uniform(*flat, P)
    yaw = rnd.uniform(0, 2 * math.pi, P)
    tilt = rnd.normal(0, 0.12, (P, 2))
    emb = rnd.uniform(*embed, P)
    seeds = rnd.integers(0, 10_000, P)
    pal_i = rnd.choice(len(palette), P, p=[p[1] for p in palette])
    tint = rnd.uniform(0.85, 1.12, P)
    rgh = rnd.uniform(*rough, P)

    V = np.tile(base_v, (n, 1)).reshape(n, nv, 3).astype(np.float64)
    s = src
    r = allc[:, 2]
    # lumpy deformation in object space
    q = V * 1.3 + (seeds[s] * 0.137)[:, None, None]
    d = noise3(q.reshape(-1, 3)).reshape(n, nv) * 2 - 1
    d2 = noise3((V * 3.1 + (seeds[s] * 0.71)[:, None, None]).reshape(-1, 3)).reshape(n, nv) * 2 - 1
    V *= (1 + lumpy * d + lumpy * 0.35 * d2)[:, :, None]
    V[:, :, 0] *= r[:, None]
    V[:, :, 1] *= (r * ry[s])[:, None]
    V[:, :, 2] *= (r * rz[s])[:, None]
    # rotation (yaw + small tilt)
    cy, sy = np.cos(yaw[s]), np.sin(yaw[s])
    x = V[:, :, 0] * cy[:, None] - V[:, :, 1] * sy[:, None]
    y = V[:, :, 0] * sy[:, None] + V[:, :, 1] * cy[:, None]
    z = V[:, :, 2] + x * tilt[s, 0][:, None] + y * tilt[s, 1][:, None]
    zc = (r * rz[s]) * (1 - 2 * emb[s])
    V = np.stack([x + allc[:, 0][:, None], y + allc[:, 1][:, None], z + zc[:, None]], 2)
    # colours
    base = np.array([palette[i][0] for i in pal_i])[s] * tint[s][:, None]
    sp = noise3((V.reshape(-1, 3) / np.repeat(r, nv)[:, None] * 2.5 + 7.0)).reshape(n, nv)
    sp2 = noise3((V.reshape(-1, 3) * 90.0)).reshape(n, nv)
    k = 1 + speckle * (sp - 0.5) + speckle * 0.8 * (sp2 - 0.5)
    C = base[:, None, :] * k[:, :, None]
    # darker at the bottom where the pebble sits in the sand
    zrel = (V[:, :, 2] - V[:, :, 2].min(1, keepdims=True)) / (np.ptp(V[:, :, 2], 1, keepdims=True) + 1e-6)
    C *= (0.75 + 0.25 * np.clip(zrel * 2, 0, 1))[:, :, None]
    R = np.repeat(rgh[s], nv).reshape(n, nv)
    F = base_f[None, :, :] + (np.arange(n) * nv)[:, None, None]
    # pebble-local coordinates (identical for wrapped copies) drive fine speckles
    loc = V.copy()
    loc[:, :, 0] -= allc[:, 0][:, None]
    loc[:, :, 1] -= allc[:, 1][:, None]
    loc += (seeds[s] * 0.0131)[:, None, None]
    pebbles_arrays.last_loc = loc.reshape(-1, 3)
    return V.reshape(-1, 3), F.reshape(-1, 3), C.reshape(-1, 3), R.ravel()


def blades_arrays(n, S, seed, length=(0.02, 0.07), width=(0.0025, 0.0045), lean=(0.4, 1.35),
                  palette=None, segs=4, z0=0.0, droop=0.6):
    rnd = np.random.default_rng(seed)
    root = rnd.random((n, 2)) * S
    L = rnd.uniform(*length, n)
    W = rnd.uniform(*width, n)
    th = rnd.uniform(0, 2 * math.pi, n)
    ph = rnd.uniform(*lean, n)
    pal_i = rnd.choice(len(palette), n, p=[p[1] for p in palette])
    col = np.array([palette[i][0] for i in pal_i]) * rnd.uniform(0.8, 1.2, (n, 1))
    idx, off = wrap_copies(root, length[1], S)
    root = np.concatenate([root, root[idx] + off])
    sel = np.concatenate([np.arange(n), idx])
    L, W, th, ph, col = L[sel], W[sel], th[sel], ph[sel], col[sel]
    m = len(root)
    t = np.linspace(0, 1, segs + 1)
    ang = ph[:, None] + droop * (np.pi / 2 - ph[:, None]) * t[None, :] ** 1.6
    ang = np.minimum(ang, np.pi / 2 + 0.15)
    dl = (L / segs)[:, None]
    dx = np.sin(ang) * dl
    dz = np.cos(ang) * dl
    hx = np.concatenate([np.zeros((m, 1)), np.cumsum(dx[:, :-1], 1)], 1)
    hz = np.concatenate([np.zeros((m, 1)), np.cumsum(dz[:, :-1], 1)], 1)
    dirx, diry = np.cos(th), np.sin(th)
    px = root[:, 0][:, None] + hx * dirx[:, None]
    py = root[:, 1][:, None] + hx * diry[:, None]
    pz = z0 + hz
    w = W[:, None] * (1 - t[None, :] ** 1.3) + 0.0004
    sx, sy = -diry[:, None] * w, dirx[:, None] * w
    left = np.stack([px + sx, py + sy, pz], 2)
    right = np.stack([px - sx, py - sy, pz + w * 0.25], 2)  # slight V fold
    V = np.stack([left, right], 2).reshape(m, (segs + 1) * 2, 3)
    shade = 0.55 + 0.55 * t
    C = col[:, None, :] * np.repeat(shade, 2)[None, :, None]
    nvb = (segs + 1) * 2
    f = []
    for i in range(segs):
        a, b = 2 * i, 2 * i + 1
        f.append([a, b, b + 2, a + 2])
    f = np.array(f)
    F = f[None] + (np.arange(m) * nvb)[:, None, None]
    return V.reshape(-1, 3), F.reshape(-1, 4), C.reshape(-1, 3)


def leaves_arrays(n, S, seed, size=(0.035, 0.09), palette=None, zmax=0.02, segs=8, fold=0.25,
                  curl=0.35, aspect=(0.35, 0.6)):
    rnd = np.random.default_rng(seed)
    c = rnd.random((n, 2)) * S
    L = rnd.uniform(*size, n)
    A = rnd.uniform(*aspect, n)
    th = rnd.uniform(0, 2 * math.pi, n)
    z = np.sort(rnd.random(n)) * zmax  # later leaves lie on top
    pal_i = rnd.choice(len(palette), n, p=[p[1] for p in palette])
    col = np.array([palette[i][0] for i in pal_i]) * rnd.uniform(0.75, 1.2, (n, 1))
    crl = rnd.uniform(-curl, curl, n)
    idx, off = wrap_copies(c, size[1], S)
    c = np.concatenate([c, c[idx] + off])
    sel = np.concatenate([np.arange(n), idx])
    L, A, th, z, col, crl = L[sel], A[sel], th[sel], z[sel], col[sel], crl[sel]
    m = len(c)
    t = np.linspace(0, 1, segs + 1)
    half = np.sin(np.pi * t) ** 0.75 * (1 - 0.25 * t)
    # local coordinates: x along leaf, y across
    xs = (t - 0.5)
    lv = []
    for side in (-1, 0, 1):
        yy = side * half * 0.5
        zz = np.abs(yy) * fold * 2
        lv.append(np.stack([xs, yy, zz], 1))
    lv = np.stack(lv, 1)  # (segs+1, 3, 3)
    nv = lv.shape[0] * 3
    P = np.repeat(lv.reshape(1, nv, 3), m, 0).astype(np.float64)
    P[:, :, 0] *= L[:, None]
    P[:, :, 1] *= (L * A)[:, None]
    P[:, :, 2] *= (L * A)[:, None]
    # curl along length
    P[:, :, 2] += (crl[:, None] * (P[:, :, 0] / L[:, None]) ** 2) * L[:, None]
    ct, st = np.cos(th)[:, None], np.sin(th)[:, None]
    x = P[:, :, 0] * ct - P[:, :, 1] * st + c[:, 0][:, None]
    y = P[:, :, 0] * st + P[:, :, 1] * ct + c[:, 1][:, None]
    zz = P[:, :, 2] + z[:, None]
    V = np.stack([x, y, zz], 2)
    vein = np.tile(np.array([1.0, 0.82, 1.0]), segs + 1)  # darker midrib
    C = col[:, None, :] * vein[None, :, None]
    f = []
    for i in range(segs):
        for j in range(2):
            a = i * 3 + j
            f.append([a, a + 1, a + 4, a + 3])
    f = np.array(f)
    F = f[None] + (np.arange(m) * nv)[:, None, None]
    return V.reshape(-1, 3), F.reshape(-1, 4), C.reshape(-1, 3)


def twigs_arrays(n, S, seed, length=(0.08, 0.35), radius=(0.002, 0.007), color=(0.12, 0.08, 0.05),
                 z=0.01):
    rnd = np.random.default_rng(seed)
    sides, segs = 6, 6
    allv, allf, allc = [], [], []
    base = 0
    for k in range(n):
        x0, y0 = rnd.random() * S, rnd.random() * S
        Lk = rnd.uniform(*length)
        r0 = rnd.uniform(*radius)
        th = rnd.uniform(0, 2 * math.pi)
        bend = rnd.normal(0, 0.4)
        for dx in (-S, 0, S):
            for dy in (-S, 0, S):
                if (dx or dy) and not (-Lk < x0 + dx < S + Lk and -Lk < y0 + dy < S + Lk):
                    continue
                t = np.linspace(0, 1, segs + 1)
                a = th + bend * (t - 0.5)
                cx = x0 + dx + np.cumsum(np.cos(a)) * Lk / segs
                cy = y0 + dy + np.cumsum(np.sin(a)) * Lk / segs
                rr = r0 * (1 - 0.5 * t)
                ring = np.linspace(0, 2 * math.pi, sides, endpoint=False)
                nx, ny = -np.sin(a), np.cos(a)
                vx = cx[:, None] + nx[:, None] * np.cos(ring)[None] * rr[:, None]
                vy = cy[:, None] + ny[:, None] * np.cos(ring)[None] * rr[:, None]
                vz = z + rr[:, None] * (1 + np.sin(ring)[None])
                V = np.stack([vx, vy, vz], 2).reshape(-1, 3)
                f = []
                for i in range(segs):
                    for j in range(sides):
                        a0 = i * sides + j
                        a1 = i * sides + (j + 1) % sides
                        f.append([a0, a1, a1 + sides, a0 + sides])
                allv.append(V)
                allf.append(np.array(f) + base)
                c = np.array(color) * rnd.uniform(0.7, 1.3)
                allc.append(np.repeat([c], len(V), 0))
                base += len(V)
    return np.concatenate(allv), np.concatenate(allf), np.concatenate(allc)


def ground_arrays(S, n, height, color, rough, margin=0.06):
    """Displaced grid covering the tile plus a wrapped margin.
    height/color/rough are periodic fields (n x n [x3])."""
    m = int(n * margin)
    N = n + 2 * m
    x0 = -m / n * S
    x1 = (n + m) / n * S
    V, F, UV = grid_mesh_arrays(N, N, x0, x0, x1, x1)
    u = V[:, 0] / S
    v = V[:, 1] / S
    V[:, 2] = sample_periodic(height, u, v)
    C = np.stack([sample_periodic(color[:, :, i], u, v) for i in range(3)], 1)
    R = sample_periodic(rough, u, v)
    return V, F, C, R


def make_obj(name, V, F, C, R=None, rough=0.7, loc=None, speckle=None):
    attrs = {}
    if R is not None:
        attrs["Rough"] = R
    if loc is not None:
        attrs["Loc"] = loc
    me = mesh_from_arrays(name, V, F, colors=C, attrs=attrs or None)
    ob = obj_from_mesh(name, me)
    mat = vertex_color_material(name + "_mat", rough_attr="Rough" if R is not None else None, rough=rough)
    if speckle:
        add_speckle(mat, *speckle)
    assign_material(ob, mat)
    return ob


def add_speckle(mat, scale, dark, light):
    """Multiply base colour by mineral speckles evaluated per shading point from
    the 'Loc' attribute (so wrapped copies of a pebble get identical detail)."""
    nt = NT(mat, clear=False)
    p = [n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"][0]
    colattr = [n for n in nt.nodes if n.type == "ATTRIBUTE" and n.attribute_name == "Col"][0]
    loc = nt.new("ShaderNodeAttribute", props={"attribute_name": "Loc"})
    nz = nt.new("ShaderNodeTexNoise", Scale=scale, Detail=3.0, Roughness=0.6)
    nt.link(loc, "Vector", nz, "Vector")
    ramp = nt.new("ShaderNodeValToRGB")
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.30, (1 - dark, 1 - dark, 1 - dark, 1)
    els[1].position, els[1].color = 0.36, (1, 1, 1, 1)
    e = els.new(0.66)
    e.color = (1, 1, 1, 1)
    e = els.new(0.72)
    e.color = (1 + light, 1 + light, 1 + light, 1)
    nt.link(nz, "Fac", ramp, "Fac")
    blot = nt.new("ShaderNodeTexNoise", Scale=scale * 0.08, Detail=2.0)
    nt.link(loc, "Vector", blot, "Vector")
    br = nt.new("ShaderNodeMapRange", From_Min=0.3, From_Max=0.7, To_Min=0.85, To_Max=1.12)
    nt.link(blot, "Fac", br, "Value")
    m1 = nt.mix("RGBA", 1.0, (colattr, "Color"), (ramp, "Color"), blend="MULTIPLY")
    m2 = nt.new("ShaderNodeVectorMath", props={"operation": "SCALE"})
    nt.link(m1, "Result", m2, 0)
    nt.link(br, "Result", m2, "Scale")
    nt.link(m2, "Vector", p, "Base Color")


def lerp(a, b, t):
    return a + (b - a) * t


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def col(h):
    return np.array(hexlin(h))


# ---------------------------------------------------------------------------
# Tile definitions. Each returns (high_objects, ao_distance)
# ---------------------------------------------------------------------------

def tile_riverbed(S):
    n = 512
    hgt = periodic_noise(n, 6, 1, octaves=4) * 0.006 + periodic_noise(n, 40, 2) * 0.0015
    silt = periodic_noise(n, 3, 3, octaves=3)
    c = np.zeros((n, n, 3))
    sand = col("#8c806a")
    dark = col("#5d5444")
    t = smooth(-1, 1.2, silt)[:, :, None]
    c[:] = lerp(dark, sand, t)
    c *= (0.9 + 0.1 * periodic_noise(n, 80, 4))[:, :, None]
    rough = np.full((n, n), 0.85)
    Vg, Fg, Cg, Rg = ground_arrays(S, n, hgt, c, rough)
    objs = [make_obj("rb_ground", Vg, Fg, Cg, Rg)]

    rnd = np.random.default_rng(11)
    radii = np.concatenate([
        rnd.uniform(0.05, 0.11, 30),
        rnd.uniform(0.03, 0.05, 160),
        rnd.uniform(0.016, 0.03, 900),
        rnd.uniform(0.008, 0.016, 2600),
    ])
    circ = pack_circles(S, radii, 12, overlap=0.88, tries=30)
    palette = [
        (col("#8f8a80"), 0.32),  # grey granite
        (col("#a39782"), 0.22),  # beige
        (col("#7a6553"), 0.16),  # brown
        (col("#55524d"), 0.12),  # dark grey
        (col("#b9b4a8"), 0.06),  # quartz
        (col("#806452"), 0.07),  # reddish
        (col("#6b7062"), 0.05),  # greenish
    ]
    V, F, C, R = pebbles_arrays(circ, S, 13, palette, flat=(0.35, 0.65), embed=(0.1, 0.45))
    objs.append(make_obj("rb_pebbles", V, F, C, R, loc=pebbles_arrays.last_loc, speckle=(380.0, 0.45, 0.35)))
    return objs, 0.06


def tile_gravel_path(S):
    n = 512
    hgt = (periodic_noise(n, 3, 21, octaves=3) * 0.012 + periodic_noise(n, 24, 22, octaves=2) * 0.003
           + np.abs(periodic_noise(n, 9, 23)) * -0.006)
    c = np.zeros((n, n, 3))
    soil = col("#7a6450")
    soil2 = col("#5c4a3a")
    dry = col("#9a876e")
    a = periodic_noise(n, 4, 24, octaves=3)
    c[:] = lerp(soil2, soil, smooth(-1.2, 1, a)[:, :, None])
    c = lerp(c, dry, (smooth(0.4, 1.8, periodic_noise(n, 7, 25)) * 0.6)[:, :, None])
    c *= (0.88 + 0.12 * periodic_noise(n, 120, 26))[:, :, None]
    rough = np.full((n, n), 0.92)
    Vg, Fg, Cg, Rg = ground_arrays(S, n, hgt, c, rough)
    objs = [make_obj("gp_ground", Vg, Fg, Cg, Rg)]
    rnd = np.random.default_rng(27)
    radii = np.concatenate([rnd.uniform(0.02, 0.045, 25), rnd.uniform(0.008, 0.02, 450),
                            rnd.uniform(0.003, 0.008, 1400)])
    circ = pack_circles(S, radii, 28, overlap=1.4, tries=6)
    palette = [(col("#8d8478"), 0.4), (col("#9b8b74"), 0.3), (col("#5e5346"), 0.2), (col("#b8b0a2"), 0.1)]
    V, F, C, R = pebbles_arrays(circ, S, 29, palette, flat=(0.4, 0.7), embed=(0.35, 0.6),
                                rough=(0.75, 0.9), subdiv=2)
    objs.append(make_obj("gp_stones", V, F, C, R, loc=pebbles_arrays.last_loc, speckle=(380.0, 0.35, 0.25)))
    gpal = [(col("#7c7a3c"), 0.5), (col("#9c8f55"), 0.3), (col("#5d6a2c"), 0.2)]
    V, F, C = blades_arrays(1400, S, 30, length=(0.015, 0.05), lean=(0.9, 1.45), palette=gpal)
    objs.append(make_obj("gp_blades", V, F, C, rough=0.7))
    return objs, 0.08


def tile_grass_ground(S):
    n = 512
    hgt = periodic_noise(n, 4, 41, octaves=3) * 0.01
    c = np.zeros((n, n, 3))
    soil = col("#4a3c2c")
    c[:] = soil * (0.8 + 0.2 * periodic_noise(n, 30, 42))[:, :, None]
    rough = np.full((n, n), 0.95)
    Vg, Fg, Cg, Rg = ground_arrays(S, n, hgt, c, rough)
    objs = [make_obj("gg_soil", Vg, Fg, Cg, Rg)]
    # dead layer first (thatch), then green blades on top
    dpal = [(col("#7b6a45"), 0.5), (col("#8d7b52"), 0.3), (col("#5b4c33"), 0.2)]
    V, F, C = blades_arrays(9000, S, 43, length=(0.03, 0.08), lean=(1.25, 1.5), palette=dpal, z0=0.004)
    objs.append(make_obj("gg_thatch", V, F, C, rough=0.85))
    gpal = [
        (col("#4d6b2a"), 0.35), (col("#5d7d30"), 0.25), (col("#3e5a22"), 0.2),
        (col("#7a8b3e"), 0.12), (col("#9a9a55"), 0.08),
    ]
    V, F, C = blades_arrays(26000, S, 44, length=(0.03, 0.09), lean=(0.5, 1.3), palette=gpal, z0=0.008)
    objs.append(make_obj("gg_blades", V, F, C, rough=0.55))
    lpal = [(col("#3f5f25"), 0.6), (col("#567a2e"), 0.4)]
    V, F, C = leaves_arrays(500, S, 45, size=(0.012, 0.025), palette=lpal, zmax=0.03, aspect=(0.7, 0.95),
                            fold=0.1)
    objs.append(make_obj("gg_clover", V, F, C, rough=0.5))
    return objs, 0.05


def tile_forest_floor(S):
    n = 512
    hgt = periodic_noise(n, 3, 61, octaves=4) * 0.015
    soil = col("#3d3024")
    moss = col("#4f5e2a")
    m = smooth(0.6, 1.6, periodic_noise(n, 3, 62, octaves=3))
    c = lerp(soil, moss, m[:, :, None]) * (0.85 + 0.15 * periodic_noise(n, 60, 63))[:, :, None]
    rough = np.full((n, n), 0.9)
    Vg, Fg, Cg, Rg = ground_arrays(S, n, hgt, c, rough)
    objs = [make_obj("ff_soil", Vg, Fg, Cg, Rg)]
    lpal = [
        (col("#6b4a2b"), 0.3), (col("#8a6034"), 0.2), (col("#4a3524"), 0.2), (col("#a07a3c"), 0.12),
        (col("#5a5a2a"), 0.1), (col("#2f241a"), 0.08),
    ]
    V, F, C = leaves_arrays(3200, S, 64, size=(0.04, 0.1), palette=lpal, zmax=0.03, curl=0.4)
    objs.append(make_obj("ff_leaves", V, F, C, rough=0.8))
    V, F, C = twigs_arrays(45, S, 65)
    objs.append(make_obj("ff_twigs", V, F, C, rough=0.85))
    gpal = [(col("#4d6b2a"), 0.6), (col("#6b7a35"), 0.4)]
    V, F, C = blades_arrays(1500, S, 66, length=(0.03, 0.07), palette=gpal, z0=0.02)
    objs.append(make_obj("ff_blades", V, F, C, rough=0.6))
    return objs, 0.06


def tile_rock(S):
    n = 1024
    big = periodic_noise(n, 2, 83, octaves=6)
    med = periodic_noise(n, 7, 90, octaves=4)
    fine = periodic_noise(n, 40, 84, octaves=3)
    f1, f2, cid = periodic_worley(n, 36, 81)
    edge = f2 - f1
    show = smooth(0.15, 0.85, periodic_noise(n, 3, 91, octaves=2))  # only some fractures
    crack = (1 - smooth(0.0, 0.005, edge)) * show
    plates = (np.take(np.random.default_rng(82).random(36), cid) - 0.5) * show
    hgt = big * 0.045 + med * 0.012 + fine * 0.0022 + plates * 0.008 - crack * 0.009
    pit = smooth(1.8, 2.8, periodic_noise(n, 110, 85))
    hgt -= pit * 0.0015
    base = col("#8f887c")
    warm = col("#9c8f7c")
    darkc = col("#5a554d")
    c = lerp(darkc, base, smooth(-1.6, 1.0, big * 0.7 + med * 0.5)[:, :, None])
    c = lerp(c, warm, (smooth(0.0, 1.5, periodic_noise(n, 3, 92, octaves=3)) * 0.5)[:, :, None])
    # granite grain: dark mica and pale feldspar specks
    c = lerp(c, col("#34312d"), (smooth(1.7, 2.3, periodic_noise(n, 220, 86)) * 0.75)[:, :, None])
    c = lerp(c, col("#c9c3b7"), (smooth(1.8, 2.5, periodic_noise(n, 170, 87)) * 0.6)[:, :, None])
    c *= (0.93 + 0.07 * fine)[:, :, None]
    # crustose lichen: small pale rosettes, very few orange ones
    lich = smooth(1.15, 1.6, periodic_noise(n, 14, 88, octaves=3)) * smooth(-0.2, 0.6, big)
    c = lerp(c, col("#b4b6a4"), (lich * 0.55)[:, :, None])
    lich2 = smooth(2.2, 2.6, periodic_noise(n, 18, 89, octaves=2))
    c = lerp(c, col("#b48a4e"), (lich2 * 0.45)[:, :, None])
    # water streaks
    u = (np.arange(n) + 0.5) / n
    U, Vv = np.meshgrid(u, u)
    streak = smooth(0.8, 1.8, sample_periodic(periodic_noise(n, 10, 93, octaves=2), U, Vv * 0.15))
    c *= (1 - 0.12 * streak)[:, :, None]
    c *= (1 - crack * 0.5)[:, :, None]
    rough = 0.8 - lich * 0.04 + crack * 0.1
    V, F, C, R = ground_arrays(S, n, hgt, c, rough)
    return [make_obj("rock_surface", V, F, C, R)], 0.1


def tile_moss(S):
    n = 1024
    f1, f2, cid = periodic_worley(n, 2600, 101)
    r0 = 0.62 / math.sqrt(2600)
    cush = np.sqrt(np.clip(1 - (f1 / r0) ** 2, 0, 1))
    clump = periodic_noise(n, 5, 103, octaves=3)
    fib = periodic_noise(n, 220, 102, octaves=2)
    hgt = cush * 0.004 + clump * 0.007 + fib * 0.0012
    var = np.take(np.random.default_rng(104).random(2600), cid)
    g_dark, g_mid, g_tip, g_brown = col("#33461c"), col("#56752a"), col("#93a447"), col("#6e6232")
    c = lerp(g_dark, g_mid, (0.35 + 0.65 * cush * (0.6 + 0.4 * var))[:, :, None])
    c = lerp(c, g_tip, (smooth(0.6, 1.0, cush) * smooth(0.3, 1.0, var) * 0.55)[:, :, None])
    c = lerp(c, g_brown, (smooth(0.7, 1.8, periodic_noise(n, 4, 105, octaves=3)) * 0.45)[:, :, None])
    c *= (0.86 + 0.14 * fib)[:, :, None]
    c *= (0.8 + 0.2 * smooth(-1.5, 1.0, clump))[:, :, None]
    rough = np.full((n, n), 0.92)
    V, F, C, R = ground_arrays(S, n, hgt, c, rough)
    return [make_obj("moss", V, F, C, R)], 0.02


def tile_bark(S):
    n = 1024
    f1, f2, cid = periodic_worley(n, 60, 121, aspect=(1.0, 0.22))
    ridge = smooth(0.0, 0.05, f2 - f1)
    plate = np.take(np.random.default_rng(122).random(60), cid)
    warp = periodic_noise(n, 3, 123, octaves=3)
    fine = periodic_noise(n, 64, 124, octaves=2)
    hgt = ridge * 0.03 + plate * 0.006 + fine * 0.002 + warp * 0.004
    base = col("#7b6f61")
    light = col("#9f9586")
    dark = col("#40362e")
    c = lerp(dark, base, ridge[:, :, None])
    c = lerp(c, light, (smooth(0.5, 1, ridge) * plate * 0.6)[:, :, None])
    c *= (0.85 + 0.2 * periodic_noise(n, 140, 125))[:, :, None]
    lich = smooth(1.5, 2.0, periodic_noise(n, 9, 126, octaves=3)) * ridge
    c = lerp(c, col("#9aa08a"), (lich * 0.45)[:, :, None])
    rough = 0.9 - ridge * 0.05
    V, F, C, R = ground_arrays(S, n, hgt, c, rough)
    return [make_obj("bark", V, F, C, R)], 0.06


def tile_wood(S):
    """Weathered cedar boards. Grain runs along U (x)."""
    n = 1024
    u = (np.arange(n) + 0.5) / n
    U, Vv = np.meshgrid(u, u)
    warp = periodic_noise(n, 2, 141, octaves=3) * 0.04
    rings = np.sin((Vv * 22 + warp * 9 + 0.15 * np.sin(U * 2 * np.pi * 2)) * 2 * np.pi)
    grain = smooth(0.4, 1.0, rings)
    stretch = periodic_noise(n, 40, 142)  # fine fibres
    fibers = sample_periodic(stretch, U * 0.08, Vv * 3.0)
    cracks = smooth(2.1, 2.8, sample_periodic(periodic_noise(n, 30, 143), U * 0.06, Vv * 2.0))
    hgt = -grain * 0.0015 + fibers * 0.0004 - cracks * 0.003
    base = col("#8a7d6b")
    silver = col("#a29d92")
    dark = col("#4f443a")
    sil = smooth(-0.6, 1.4, periodic_noise(n, 3, 144, octaves=3))
    c = lerp(base, silver, (sil * 0.75)[:, :, None])
    c = lerp(c, dark, (grain * 0.35 + cracks * 0.7)[:, :, None])
    c *= (0.9 + 0.12 * fibers)[:, :, None]
    rough = 0.85 + 0.1 * cracks
    V, F, C, R = ground_arrays(S, n, hgt, c, rough)
    return [make_obj("wood", V, F, C, R)], 0.02


def tile_plaster(S):
    n = 1024
    hgt = periodic_noise(n, 3, 161, octaves=5) * 0.0025
    u = (np.arange(n) + 0.5) / n
    U, Vv = np.meshgrid(u, u)
    trowel = sample_periodic(periodic_noise(n, 6, 162, octaves=2), U * 0.5 + Vv * 0.2, Vv * 1.5)
    hgt += smooth(0.5, 1.5, trowel) * 0.0012
    f1, f2, _ = periodic_worley(n, 25, 163)
    crack = (1 - smooth(0.0, 0.0025, f2 - f1)) * smooth(0.8, 1.6, periodic_noise(n, 3, 164))
    hgt -= crack * 0.0015
    base = col("#d6ccb6")
    stain = col("#b3a68b")
    st = smooth(0.5, 2.0, periodic_noise(n, 2, 165, octaves=4))
    c = lerp(base, stain, (st * 0.7)[:, :, None])
    c *= (0.95 + 0.06 * periodic_noise(n, 90, 166))[:, :, None]
    c = lerp(c, col("#6f6655"), (crack * 0.8)[:, :, None])
    rough = np.full((n, n), 0.9)
    V, F, C, R = ground_arrays(S, n, hgt, c, rough)
    return [make_obj("plaster", V, F, C, R)], 0.02


def tile_kawara(S):
    """Glazed grey roof-tile clay: colour mottling + small dents. The tile
    shapes themselves are real geometry on the house."""
    n = 512
    hgt = periodic_noise(n, 5, 181, octaves=4) * 0.0012
    base = col("#4d535b")
    c = lerp(col("#3a3f46"), base, smooth(-1.2, 1.2, periodic_noise(n, 4, 182, octaves=3))[:, :, None])
    c = lerp(c, col("#6c6a62"), (smooth(1.2, 2.2, periodic_noise(n, 9, 183, octaves=2)) * 0.6)[:, :, None])
    rough = 0.45 + 0.25 * smooth(0.5, 2, periodic_noise(n, 6, 184))
    V, F, C, R = ground_arrays(S, n, hgt, c, rough)
    return [make_obj("kawara", V, F, C, R)], 0.02


TILES = {
    # name: (builder, tile size in metres)
    "riverbed": (tile_riverbed, 1.6),
    "path": (tile_gravel_path, 2.0),
    "grass": (tile_grass_ground, 2.0),
    "forest": (tile_forest_floor, 2.0),
    "rock": (tile_rock, 2.5),
    "moss": (tile_moss, 0.8),
    "bark": (tile_bark, 1.0),
    "wood": (tile_wood, 1.0),
    "plaster": (tile_plaster, 2.0),
    "kawara": (tile_kawara, 1.0),
}


def build_tile(name):
    builder, S = TILES[name]
    t0 = time.time()
    sc = reset_scene()
    highs, ao_dist = builder(S)
    zs = []
    for ob in highs:
        v = np.empty(len(ob.data.vertices) * 3, np.float32)
        ob.data.vertices.foreach_get("co", v)
        zs.append(v.reshape(-1, 3)[:, 2])
    zs = np.concatenate(zs)
    zmin, zmax = float(zs.min()), float(zs.max())
    lv, lf, luv = grid_mesh_arrays(2, 2, 0, 0, S, S)
    low = obj_from_mesh("low", mesh_from_arrays("low", lv, lf, uvs=luv, smooth=False))
    from common import principled_material

    assign_material(low, principled_material("low_mat"))
    sc.world.light_settings.distance = ao_dist
    res = BAKE_RES
    img = new_float_image("bake", res)
    ext = zmax + 0.02
    dist = (zmax - zmin) + 0.06
    common = dict(extrusion=ext, max_dist=dist, margin=2)
    log(f"{name}: {sum(len(o.data.polygons) for o in highs)} faces, z {zmin:.4f}..{zmax:.4f}")
    albedo = bake(low, highs, "DIFFUSE", img, pass_filter={"COLOR"}, samples=4, **common)
    normal = bake(low, highs, "NORMAL", img, samples=4, **common)
    rough = bake(low, highs, "ROUGHNESS", img, samples=4, **common)
    ao = bake(low, highs, "AO", img, samples=48, **common)
    restore = swap_to_emission(highs, height_emitter(zmin, zmax))
    height = bake(low, highs, "EMIT", img, samples=4, **common)
    restore()

    def fin(a):
        return resize_np(a, OUT_RES) if res != OUT_RES else a

    albedo_s = lin2srgb(fin(albedo[:, :, :3]))
    nrm = fin(normal[:, :, :3])
    # renormalise after filtering
    nv = nrm * 2 - 1
    # thin double-sided geometry (leaves, blades) can be hit from behind: mirror
    # those normals back towards the viewer
    nv = np.where(nv[:, :, 2:3] < 0, -nv, nv)
    nv[:, :, 2] = np.maximum(nv[:, :, 2], 0.05)
    nv /= np.linalg.norm(nv, axis=2, keepdims=True) + 1e-6
    nrm = nv * 0.5 + 0.5
    orm = np.stack([fin(ao[:, :, :1])[:, :, 0], fin(rough[:, :, :1])[:, :, 0], fin(height[:, :, :1])[:, :, 0]], 2)
    save_image(albedo_s, os.path.join(TEX_DIR, f"{name}_albedo.webp"), quality=90)
    save_image(nrm, os.path.join(TEX_DIR, f"{name}_normal.webp"), quality=92)
    save_image(orm, os.path.join(TEX_DIR, f"{name}_orm.webp"), quality=92)
    log(f"{name}: done in {time.time() - t0:.1f}s")
    return {"size": S, "height": [zmin, zmax]}


def main(names):
    meta_path = os.path.join(TEX_DIR, "textures.json")
    meta = {}
    if os.path.exists(meta_path):
        with open(meta_path) as f:
            meta = json.load(f)
    for nm in names:
        meta[nm] = build_tile(nm)
        with open(meta_path, "w") as f:
            json.dump(meta, f, indent=2)


if __name__ == "__main__":
    args = [a for a in sys.argv[sys.argv.index("--") + 1:]] if "--" in sys.argv else sys.argv[1:]
    main(args or list(TILES))
