"""Render the foliage atlas (2048×2048 RGBA + normal map): palm leaflets, broad leaves,
grass clumps, a fern frond and tropical flowers, all modelled as real leaf outlines with veins.

    python foliage.py ../assets/tex

Writes foliage_c.webp (sRGB colour + alpha), foliage_n.webp (normals) and foliage.json (UV regions).
Atlas units: 1 unit = 512 px, origin bottom-left, v up.
"""
import json
import math
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import numpy as np  # noqa: E402

import lib  # noqa: E402
from lib import TAU  # noqa: E402

UNITS = 4.0
RES = 2048
rng = np.random.default_rng(3)
REGIONS = {}


def region(name, x0, y0, w, h):
    REGIONS[name] = [x0 / UNITS, y0 / UNITS, (x0 + w) / UNITS, (y0 + h) / UNITS]


# ---------------------------------------------------------------------
#  materials: colour patterns in the leaf's own coordinates (base at origin, tip towards +Y)
# ---------------------------------------------------------------------
class LeafGraph(lib.Graph):
    def obj(self):
        tc = self.node('ShaderNodeTexCoord')
        sep = self.node('ShaderNodeSeparateXYZ')
        self.link(tc.outputs['Object'], sep.inputs[0])
        return sep.outputs['X'], sep.outputs['Y'], tc.outputs['Object']

    def noise3(self, vec, scale, detail=3, seed=0.0):
        n = self.node('ShaderNodeTexNoise', noise_dimensions='4D')
        self.set(n.inputs['Vector'], vec)
        self.set(n.inputs['W'], seed)
        self.set(n.inputs['Scale'], scale)
        self.set(n.inputs['Detail'], detail)
        return n.outputs['Fac']

    def finish(self, col, height, rough=0.6):
        bsdf = self.node('ShaderNodeBsdfPrincipled')
        self.set(bsdf.inputs['Base Color'], col)
        self.set(bsdf.inputs['Roughness'], rough)
        self.link(bsdf.outputs[0], self.out.inputs['Surface'])
        lib.add_height_aov(self.nt, height if isinstance(height, bpy.types.NodeSocket) else None)


def leaflet_mat(name, L, base, mid, tip, rib, dry=0.0, seed=0.0):
    mat = bpy.data.materials.new(name)
    g = LeafGraph(mat)
    x, y, vec = g.obj()
    t = g.clamp01(g.mul(y, 1.0 / L))
    ax = g.m('ABSOLUTE', x)
    col = g.ramp(t, [(0.0, base), (0.25, mid), (0.75, mid), (1.0, tip)])
    col = g.mix(g.mul(g.noise3(vec, 30, 3, seed), 0.25), col, g.scale_color(col, 0.75))
    veins = g.smooth(0.7, 1.0, g.sin(g.mul(x, 420.0)))
    col = g.mix(g.mul(veins, 0.12), col, g.scale_color(col, 1.25))
    ribm = g.smooth(0.006, 0.0, ax)
    col = g.mix(g.mul(ribm, 0.7), col, rib)
    if dry > 0:
        burn = g.smooth(0.55, 0.75, g.add(t, g.mul(g.noise3(vec, 8, 2, seed + 3), 0.3)))
        col = g.mix(g.mul(burn, dry), col, '#8b6f45')
    g.finish(col, g.add(g.mul(ribm, 0.003), g.mul(veins, 0.0004)), rough=0.55)
    return mat


def broadleaf_mat(name, L, base, vein, edge, blotch=None, seed=0.0):
    mat = bpy.data.materials.new(name)
    g = LeafGraph(mat)
    x, y, vec = g.obj()
    t = g.clamp01(g.mul(y, 1.0 / L))
    ax = g.m('ABSOLUTE', x)
    col = g.mix(g.mul(g.noise3(vec, 9, 3, seed), 0.35), base, g.scale_color(g.rgb(base), 0.8))
    lat = g.smooth(0.9, 0.99, g.sin(g.mul(g.sub(g.mul(y, 9.0), g.mul(ax, 7.0)), TAU)))
    ribm = g.mul(g.smooth(0.01, 0.0, ax), g.sub(1.0, g.mul(t, 0.6)))
    if blotch:
        b = g.smooth(0.55, 0.65, g.noise3(vec, 6, 4, seed + 5))
        col = g.mix(g.mul(b, 0.85), col, blotch)
    col = g.mix(g.mul(lat, 0.55), col, vein)
    col = g.mix(ribm, col, vein)
    col = g.mix(g.mul(g.smooth(0.3, 0.9, t), 0.15), col, edge)
    g.finish(col, g.add(g.mul(ribm, 0.004), g.mul(lat, 0.0015)), rough=0.4)
    return mat


def blade_mat(name, H, base, mid, tip, seed=0.0):
    mat = bpy.data.materials.new(name)
    g = LeafGraph(mat)
    x, y, vec = g.obj()
    t = g.clamp01(g.mul(y, 1.0 / H))
    col = g.ramp(t, [(0.0, base), (0.4, mid), (1.0, tip)])
    col = g.mix(g.mul(g.noise3(vec, 40, 2, seed), 0.3), col, g.scale_color(col, 0.8))
    g.finish(col, g.mul(t, 0.002), rough=0.6)
    return mat


def flower_mat(name, center, mid, edge, r0, r1, veins=0.15, seed=0.0):
    mat = bpy.data.materials.new(name)
    g = LeafGraph(mat)
    x, y, vec = g.obj()
    r = g.m('SQRT', g.add(g.mul(x, x), g.mul(y, y)))
    col = g.ramp(g.clamp01(g.mul(r, 1.0 / r1)), [(0.0, center), (r0 / r1, center), (min(0.99, r0 / r1 + 0.12), mid), (1.0, edge)])
    ang = g.m('ARCTAN2', y, x)
    v = g.smooth(0.8, 1.0, g.sin(g.mul(ang, 90.0)))
    col = g.mix(g.mul(v, veins), col, g.scale_color(col, 0.8))
    g.finish(col, g.mul(v, 0.0006), rough=0.5)
    return mat


def flat_mat(name, colour):
    mat = bpy.data.materials.new(name)
    g = LeafGraph(mat)
    g.finish(g.rgb(colour), 0.0)
    return mat


# ---------------------------------------------------------------------
#  geometry: leaf outlines as triangle strips along a midline
# ---------------------------------------------------------------------
def strip(name, pts, half, mat, z=0.0, rows_per=1):
    """pts: midline points [(x, y)], half: half-widths. Three vertices per row (left, centre, right)."""
    verts, faces = [], []
    pts = np.asarray(pts, float)
    for i, ((x, y), w) in enumerate(zip(pts, half)):
        d = pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]
        d /= max(1e-9, np.linalg.norm(d))
        nrm = np.array([-d[1], d[0]])
        for s in (-1, 0, 1):
            verts.append([x + nrm[0] * w * s, y + nrm[1] * w * s, z])
    n = len(pts)
    for i in range(n - 1):
        a = i * 3
        faces += [[a, a + 3, a + 4, a + 1], [a + 1, a + 4, a + 5, a + 2]]
    ob = lib.mesh_from(name, np.array(verts), np.array(faces))
    ob.data.materials.append(mat)
    return ob


def place(ob, x, y, angle=0.0, z=0.0):
    """Leaves are built with their base at the origin; move/rotate the object (the material uses object coordinates)."""
    ob.location = (x, y, z)
    ob.rotation_euler = (0, 0, angle)
    return ob


def leaflet(name, mat, L, W, cx, y0):
    t = np.linspace(0, 1, 60)
    half = W / 2 * np.sin(np.pi * np.clip(t, 0, 1) ** 0.75) ** 0.7 * (0.35 + 0.65 * np.minimum(1, t * 6))
    half[-1] = 0.0
    pts = np.stack([np.zeros_like(t), t * L], 1)
    return place(strip(name, pts, half, mat), cx, y0)


def broadleaf(name, mat, L, W, cx, cy, serrate=0.0, angle=0.0):
    t = np.linspace(0, 1, 70)
    half = W / 2 * np.sin(np.pi * t) ** 0.85 * (1.15 - 0.45 * t)
    if serrate:
        half *= 1 + serrate * np.abs(np.sin(t * 46))
    half[-1] = 0.0
    pts = np.stack([0.03 * np.sin(t * 3), t * L], 1)
    return place(strip(name, pts, half, mat), cx, cy - L / 2, angle)


def blade(name, mat, H, w, bend, x0, y0, ang):
    t = np.linspace(0, 1, 24)
    # a blade curving away from vertical
    a = ang + bend * t ** 1.5
    pts = np.cumsum(np.stack([np.sin(a), np.cos(a)], 1) * (H / 24), 0)
    pts = np.vstack([[0, 0], pts[:-1]])
    half = w / 2 * (1 - 0.9 * t ** 1.6)
    ob = strip(name, pts, half, mat)
    return place(ob, x0, y0)


def petal(name, mat, length, width, ang, r_in, z):
    t = np.linspace(0, 1, 30)
    half = width / 2 * np.sin(np.pi * np.clip(0.08 + 0.92 * t, 0, 1)) ** 0.55 * (0.25 + 0.75 * t ** 0.6)
    half[-1] = 0.0
    pts = np.stack([np.zeros_like(t), r_in + t * length], 1)
    ob = strip(name, pts, half, mat, z=z)
    return ob


def main():
    out = os.path.abspath((lib.args() or ['../assets/tex'])[0])
    lib.fresh_scene(samples=24)

    # ---- palm leaflets: six variants, 0.25 × 2 units each, base at the bottom of the cell ----
    leaf_vars = [
        ('#7f9a45', '#4c7a30', '#6b8f3e', '#b9c27a', 0.0),
        ('#86a04a', '#5a8a36', '#7aa045', '#c1c47e', 0.0),
        ('#7c9241', '#40682a', '#5e8237', '#a7b46b', 0.15),
        ('#98a653', '#7f9a44', '#a3a957', '#d0c780', 0.3),
        ('#a8a061', '#9c9558', '#b39a5e', '#cdb784', 0.8),
        ('#8f7c58', '#8a7454', '#9a8360', '#b79e74', 1.0),
    ]
    for k, (base, mid, tip, rib, dry) in enumerate(leaf_vars):
        L = 1.92
        mat = leaflet_mat(f'leaflet{k}', L, base, mid, tip if dry < 0.5 else mid, rib, dry, seed=k * 3.1)
        leaflet(f'leaflet{k}', mat, L, 0.2 if k != 5 else 0.15, k * 0.25 + 0.125, 2.04)
        region(f'leaflet{k}', k * 0.25, 2.0, 0.25, 2.0)
    # ---- a white patch for parts coloured only by their vertex colours ----
    bpy.ops.mesh.primitive_plane_add(size=1, location=(1.625, 3.0, 0))
    wp = bpy.context.active_object
    wp.scale = (0.25, 2.0, 1)
    wp.data.materials.append(flat_mat('white', '#ffffff'))
    region('white', 1.5, 2.0, 0.25, 2.0)

    # ---- broad leaves: 4 cells of 1 × 1 ----
    broad = [
        ('glossy', 2.5, 3.5, '#2d5524', '#6e9446', '#3d6a2e', None, 0.0),
        ('croton', 3.5, 3.5, '#35522a', '#d9bf45', '#c4452e', '#b8432c', 0.0),
        ('pale', 2.5, 2.5, '#4f8436', '#93b65c', '#6c9a44', None, 0.05),
        ('ti', 3.5, 2.5, '#5c2236', '#a2486a', '#d76f93', '#7a2e45', 0.0),
    ]
    for name, cx, cy, base, vein, edge, blotch, serr in broad:
        L = 0.92 if name != 'ti' else 0.95
        W = 0.5 if name != 'ti' else 0.3
        mat = broadleaf_mat(name, L, base, vein, edge, blotch, seed=cx + cy)
        broadleaf(name, mat, L, W, cx, cy, serrate=serr)
        region(f'leaf_{name}', cx - 0.5, cy - 0.5, 1.0, 1.0)

    # ---- grass clumps: two cards of 1 × 2 units, blades rising from the bottom centre ----
    for k, (base, mid, tip, n, wmax) in enumerate([('#3c5c26', '#5f8a3a', '#a9b866', 26, 0.05), ('#8c8d4c', '#b4ad6a', '#ddd29c', 22, 0.035)]):
        mat = blade_mat(f'grass{k}', 1.9, base, mid, tip, seed=k)
        x0 = k * 1.0 + 0.5
        for i in range(n):
            ang = rng.normal(0, 0.3)
            H = rng.uniform(0.9, 1.92) * (1 - abs(ang) * 0.5)
            blade(f'g{k}_{i}', mat, H, rng.uniform(0.6, 1.0) * wmax, np.sign(ang) * rng.uniform(0.1, 0.6), x0 + rng.normal(0, 0.03), 0.02, ang)
        region(f'grass{k}', k * 1.0, 0.0, 1.0, 2.0)

    # ---- fern frond: 1 × 2 units ----
    fmat = blade_mat('fern', 1.9, '#3f6b2c', '#4d7d34', '#6f9a45', seed=7)
    rmat = flat_mat('fern_rachis', '#5c6b34')
    t = np.linspace(0, 1, 40)
    spine = np.stack([2.5 + 0.06 * np.sin(t * 2.5), 0.05 + t * 1.85], 1)
    strip('fern_rachis', spine, 0.008 * (1 - t) + 0.002, rmat, z=0.002)
    for i in range(2, 38, 1):
        s = i / 40
        for side in (-1, 1):
            Lp = 0.38 * math.sin(math.pi * min(1, s * 1.1)) ** 0.8 + 0.03
            p = petal(f'pin{i}{side}', fmat, Lp, 0.065 * (1 - s * 0.5), 0, 0.0, 0.0)
            place(p, spine[i, 0], spine[i, 1], -side * (1.25 - 0.4 * s))
    region('fern', 2.0, 0.0, 1.0, 2.0)

    # ---- flowers: 0.5 × 0.5 cells ----
    flowers = [
        ('hibiscus_red', 3.25, 1.75, '#5b0a19', '#d42a3b', '#e8545f', 5, 0.2, 0.2, 0.05),
        ('hibiscus_yellow', 3.75, 1.75, '#7d1a1a', '#f2c234', '#f7d65e', 5, 0.2, 0.2, 0.05),
        ('frangipani_white', 3.25, 1.25, '#f3bf35', '#fbf6ea', '#fffdf6', 5, 0.17, 0.11, 0.04),
        ('frangipani_pink', 3.75, 1.25, '#f6c84a', '#f29ab3', '#f7c3d2', 5, 0.17, 0.11, 0.04),
    ]
    for name, cx, cy, c0, c1, c2, n, plen, pwid, r0 in flowers:
        mat = flower_mat(name, c0, c1, c2, r0, 0.23)
        for i in range(n):
            ang = i / n * TAU + (0.35 if 'frangipani' in name else 0.0)
            p = petal(f'{name}{i}', mat, plen, pwid, 0, 0.012, 0.0005 * i)
            place(p, cx, cy, ang + (0.25 if 'frangipani' in name else 0.0), 0.0005 * i)
        if 'hibiscus' in name:   # the staminal column with its yellow pollen
            col = flat_mat(name + '_stamen', '#f1d04a')
            for k in range(14):
                a = rng.uniform(0, TAU)
                r = rng.uniform(0.0, 0.035)
                bpy.ops.mesh.primitive_uv_sphere_add(radius=0.007, segments=8, ring_count=5, location=(cx + math.cos(a) * r + 0.04, cy + math.sin(a) * r + 0.06, 0.02))
                bpy.context.active_object.data.materials.append(col)
        region(name, cx - 0.25, cy - 0.25, 0.5, 0.5)

    with tempfile.TemporaryDirectory() as tmp:
        r = lib.render_topdown(UNITS, RES, tmp, samples=24, ao_distance=0.02, transparent=True)
    alpha = np.clip(r['alpha'][:, :, 0], 0, 1)
    col = r['col'][:, :, :3]
    # un-premultiply edges and bleed colour outwards so mipmaps don't fringe with black
    m = alpha > 0.01
    col[m] /= np.maximum(alpha[m][:, None], 1e-3)
    col = np.clip(col, 0, 1)
    filled = col.copy()
    known = m.copy()
    for _ in range(24):
        acc = np.zeros_like(filled)
        cnt = np.zeros(known.shape)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            acc += np.roll(np.roll(filled * known[:, :, None], dy, 0), dx, 1)
            cnt += np.roll(np.roll(known, dy, 0), dx, 1)
        new = (~known) & (cnt > 0)
        filled[new] = acc[new] / cnt[new][:, None]
        known |= new
    # leaves are flat cards: their relief (midribs, veins) comes from the height AOV
    hgt = np.where(m, r['hgt'][:, :, 0], 0.0)
    nor = lib.normal_from_height(lib.blur(hgt, 0.7), UNITS / RES, 0.5) * 2 - 1
    nor[~m] = (0, 0, 1)
    lib.save_rgba(os.path.join(out, 'foliage_c.webp'), np.dstack([filled, alpha]), quality=90)
    lib.save_rgb(os.path.join(out, 'foliage_n.webp'), nor * 0.5 + 0.5, quality=88)
    with open(os.path.join(out, 'foliage.json'), 'w') as f:
        json.dump({'units': UNITS, 'regions': REGIONS}, f, indent=1)
    print('foliage atlas:', len(REGIONS), 'regions')


if __name__ == '__main__':
    main()
