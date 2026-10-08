"""Bake the island's tileable PBR textures from procedural Blender materials.

    python textures.py ../assets/tex            (bpy module)
    blender -b -P textures.py -- ../assets/tex  (Blender)

For every material this writes three WebP files:
    <name>_c.webp   base colour (sRGB)
    <name>_n.webp   tangent-space normal map (OpenGL, +Y up)
    <name>_r.webp   R = cavity AO, G = roughness, B = height (0..1)
Each recipe returns (albedo, height in metres, roughness) as shader sockets;
tile sizes are in metres so the normal maps come out at real-world strength.
"""
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np  # noqa: E402

import lib  # noqa: E402
from lib import TAU  # noqa: E402


def chan(g, col, i):
    n = g.node('ShaderNodeSeparateColor')
    g.set(n.inputs[0], col)
    return n.outputs[i]


def sand(g):
    """Bright coral sand: fine cream grains with dark mineral and pink foraminifera grains,
    pebbles, shell chips, and wind ripples in patches."""
    macro = g.noise(3, detail=3, seed=1)
    warp = g.noise(4, detail=2, seed=2)
    zone = g.smooth(0.45, 0.62, g.noise(2.0, detail=2, seed=3))
    ph = g.stripes(1, 14, warp, 1.4)
    rip = g.pw(g.mad(g.sin(g.mul(ph, TAU)), 0.5, 0.5), 1.7)
    grain = chan(g, g.voronoi(720, seed=4)['Color'], 0)          # ~1.7 mm grains: below a pixel, they read as speckle
    coarse = g.voronoi(300, seed=8)
    cgrain = chan(g, coarse['Color'], 0)
    fine = g.noise(420, detail=1.5, seed=5)
    pv = g.voronoi(70, seed=6)
    pebble = g.mul(g.gt(chan(g, pv['Color'], 0), 0.95), g.smooth(0.22, 0.05, pv['Distance']))
    sv = g.voronoi(45, metric='CHEBYCHEV', seed=7)
    shell = g.mul(g.gt(chan(g, sv['Color'], 1), 0.97), g.smooth(0.2, 0.08, sv['Distance']))
    h = g.add(g.mul(g.mul(rip, zone), 0.003), g.mul(macro, 0.004), g.mul(fine, 0.0006),
              g.mul(g.smooth(0.5, 0.0, coarse['Distance']), 0.0003), g.mul(pebble, 0.003), g.mul(shell, 0.0012), 0.02)
    base = g.ramp(macro, [(0.0, '#d6c39b'), (0.5, '#e1d2b1'), (1.0, '#eae0c8')])
    stops = [(0.0, '#4f4236'), (0.035, '#7d6750'), (0.09, '#bba27c'), (0.2, '#dccbaa'),
             (0.78, '#e8decb'), (0.9, '#f6f2e8'), (0.955, '#f2ebdd'), (0.965, '#d89a8c'), (1.0, '#c7857a')]
    col = g.mix(0.5, base, g.ramp(grain, stops))
    col = g.mix(0.22, col, g.ramp(cgrain, stops))
    col = g.mix(g.mul(g.sub(1.0, rip), g.mul(zone, 0.35)), col, g.scale_color(col, 0.8))   # heavy minerals collect in the troughs
    col = g.mix(pebble, col, g.ramp(chan(g, pv['Color'], 1), [(0.0, '#b5a185'), (0.5, '#8a7f70'), (1.0, '#d6cbb6')]))
    col = g.mix(shell, col, g.ramp(chan(g, sv['Color'], 2), [(0.0, '#f5f0e7'), (0.6, '#f1ddd3'), (1.0, '#e6c6b4')]))
    rough = g.sub(0.92, g.mul(shell, 0.3))
    return col, h, rough

def rock(g):
    """Weathered volcanic rock: lumpy relief with erosion pockets and vesicles, crystalline grain,
    broad tonal patches and iron staining, crusts of pale lichen, dark spots, and a few long
    fractures (never a closed network)."""
    big = g.noise(2.5, detail=6, rough=0.6, seed=21)
    mid = g.noise(9, detail=5, rough=0.55, seed=22)
    grain = g.noise(45, detail=4, rough=0.6, seed=35)
    ridged = g.clamp01(g.mul(g.noise(6, detail=6, rough=0.55, seed=23, kind='RIDGED_MULTIFRACTAL'), 0.6))
    fine = g.noise(110, detail=3, seed=24)
    warp = g.noise(4, detail=3, seed=26)
    e = g.add(g.voronoi(3, feature='DISTANCE_TO_EDGE', seed=25)['Distance'], g.mul(g.sub(warp, 0.5), 0.12))
    crack = g.mul(g.smooth(0.006, 0.0, e), g.smooth(0.5, 0.62, g.noise(4, detail=3, seed=27)))
    e2 = g.add(g.voronoi(9, feature='DISTANCE_TO_EDGE', seed=28)['Distance'], g.mul(g.sub(fine, 0.5), 0.03))
    hair = g.mul(g.smooth(0.003, 0.0, e2), g.smooth(0.63, 0.72, g.noise(7, detail=2, seed=29)))
    pv = g.voronoi(55, seed=30)
    pits = g.mul(g.gt(chan(g, pv['Color'], 0), 0.55), g.smooth(0.18, 0.05, pv['Distance']))
    pk = g.voronoi(14, seed=33)
    pocket = g.mul(g.gt(chan(g, pk['Color'], 0), 0.72), g.smooth(0.35, 0.0, pk['Distance']))     # shallow dished hollows
    lichen = g.mul(g.smooth(0.56, 0.64, g.noise(10, detail=5, seed=36)), g.smooth(0.3, 0.6, g.noise(50, detail=3, seed=38)))
    crust = g.mul(g.smooth(0.66, 0.69, g.noise(24, detail=4, seed=42)), g.smooth(0.45, 0.65, g.noise(3, detail=2, seed=43)))
    dark = g.mul(g.smooth(0.66, 0.72, g.noise(18, detail=4, seed=44)), g.smooth(0.5, 0.7, g.noise(2.0, detail=2, seed=45)))
    lic_tint = g.noise(4, detail=2, seed=40)
    orange = g.mul(g.smooth(0.7, 0.75, g.noise(26, detail=4, seed=39)), g.smooth(0.5, 0.7, g.noise(5, detail=2, seed=41)))
    rust = g.smooth(0.5, 0.75, g.noise(2.0, detail=3, seed=37))
    patch = g.smooth(0.3, 0.7, g.noise(1.5, detail=3, seed=46))
    h = g.add(0.2, g.mul(big, 0.09), g.mul(mid, 0.04), g.mul(grain, 0.007), g.mul(ridged, 0.03), g.mul(fine, 0.002),
              g.mul(crack, -0.025), g.mul(hair, -0.004), g.mul(pits, -0.006), g.mul(pocket, -0.012), g.mul(lichen, 0.0008), g.mul(crust, 0.0006))
    col = g.ramp(patch, [(0.0, '#4b4741'), (0.35, '#6f695f'), (0.7, '#8b8476'), (1.0, '#a39b8b')])
    col = g.mix(g.mul(mid, 0.4), col, g.scale_color(col, 1.25))
    col = g.mix(0.35, col, g.ramp(grain, [(0.0, '#47433d'), (0.5, '#787166'), (1.0, '#a59e8f')]))
    speck = chan(g, g.voronoi(520, seed=32)['Color'], 0)
    col = g.mix(0.3, col, g.ramp(speck, [(0.0, '#36322e'), (0.5, '#7f786c'), (0.85, '#a69f90'), (1.0, '#d3ccbc')]))
    col = g.mix(g.mul(rust, 0.4), col, '#8a6a4a')
    col = g.mix(g.mul(ridged, 0.25), col, '#b5ad9c')
    col = g.mix(g.mul(pocket, 0.35), col, g.scale_color(col, 0.65))
    col = g.mix(g.mul(lichen, 0.35), col, g.ramp(lic_tint, [(0.0, '#c4c2ae'), (0.5, '#d2cdb8'), (1.0, '#b3b69a')]))
    col = g.mix(g.mul(crust, 0.4), col, '#d6d2c2')
    col = g.mix(g.mul(dark, 0.5), col, '#2e2c29')
    col = g.mix(g.mul(orange, 0.3), col, '#b88a45')
    col = g.mix(crack, col, g.scale_color(col, 0.35))
    col = g.mix(g.mul(hair, 0.4), col, g.scale_color(col, 0.6))
    col = g.mix(g.mul(pits, 0.6), col, g.scale_color(col, 0.5))
    rough = g.add(0.8, g.mul(crack, 0.12), g.mul(lichen, 0.08), g.mul(ridged, -0.06), g.mul(dark, -0.1))
    return col, h, rough


def bark(g):
    """Coconut palm trunk: wavy, uneven leaf-scar rings (some worn away), vertical fissures, long splits
    and fibres, grey weathering with pale lichen. u runs around the trunk, v up it (~12 rings per metre)."""
    warp = g.add(g.mul(g.noise(3, 2, detail=2, seed=31), 0.9), g.mul(g.noise(9, 1, detail=2, seed=36), 0.6))
    f = g.fract(g.stripes(1, 12, warp, 1.0))
    scar = g.mul(g.smooth(0.0, 0.05, f), g.smooth(0.2, 0.07, f))
    bulge = g.sin(g.mul(f, math.pi))
    vis = g.smooth(0.3, 0.6, g.noise(6, 4, detail=2, seed=37))
    fis = g.smooth(0.55, 0.68, g.noise(60, 6, detail=5, seed=32))
    split = g.smooth(0.63, 0.7, g.noise(18, 2, detail=4, seed=38))
    fib = g.noise(260, 18, detail=2, seed=33)
    blot = g.noise(5, 3, detail=3, seed=34)
    lichen = g.mul(g.smooth(0.6, 0.68, g.noise(14, 9, detail=4, seed=39)), g.smooth(0.45, 0.65, g.noise(3, 2, detail=2, seed=40)))
    h = g.add(0.1, g.mul(bulge, 0.0015), g.mul(g.mul(scar, vis), 0.003), g.mul(fis, -0.003), g.mul(split, -0.004), g.mul(fib, 0.0008))
    col = g.ramp(blot, [(0.0, '#6a6158'), (0.5, '#80776b'), (1.0, '#999082')])
    ring = g.mul(g.add(g.smooth(0.05, 0.0, f), g.smooth(0.965, 1.0, f)), vis)
    col = g.mix(g.mul(ring, 0.6), col, '#4a423a')
    col = g.mix(g.mul(fis, 0.5), col, g.scale_color(col, 0.6))
    col = g.mix(g.mul(split, 0.7), col, g.scale_color(col, 0.45))
    col = g.mix(g.mul(fib, 0.15), col, '#b4a896')
    weather = g.smooth(0.55, 0.75, g.noise(4, 10, detail=3, seed=35))
    col = g.mix(g.mul(weather, 0.35), col, '#aaa498')
    col = g.mix(g.mul(lichen, 0.5), col, '#b9bcae')
    rough = g.add(0.88, g.mul(fis, 0.08))
    return col, h, rough


def thatch(g):
    """Palm-leaf thatch in six overlapping tiers per tile; v points up the roof."""
    wav = g.noise(5, 1, detail=2, seed=41)
    rag = g.noise(110, 2, detail=2, seed=42)
    f = g.fract(g.add(g.stripes(1, 6, wav, 0.25), g.mul(g.sub(rag, 0.5), 0.12)))   # 0 = cut ends, 1 = tucked under the next tier
    strands = g.add(g.mul(g.noise(300, 7, detail=3, seed=43), 0.65), g.mul(g.noise(140, 4, detail=2, seed=44), 0.35))
    h = g.add(0.05, g.mul(g.sub(1.0, f), 0.02), g.mul(strands, 0.004))
    col = g.ramp(g.noise(180, 5, detail=2, seed=45), [(0.0, '#89745a'), (0.4, '#a68c62'), (0.7, '#bea271'), (1.0, '#d3bd8c')])
    weather = g.smooth(0.5, 0.7, g.noise(3, 2, detail=3, seed=46))
    col = g.mix(g.mul(weather, 0.45), col, '#8e8778')
    col = g.mix(g.mul(g.smooth(0.15, 0.0, f), 0.3), col, '#e0cda2')
    col = g.mix(g.mul(g.smooth(0.55, 1.0, f), 0.6), col, g.scale_color(col, 0.45))
    col = g.mix(g.mul(g.smooth(0.35, 0.2, strands), 0.4), col, g.scale_color(col, 0.6))
    rough = g.add(0.93, g.mul(strands, 0.04))
    return col, h, rough


def wood(g):
    """Weathered boards: eight per tile across v, grain along u. Kept light: the scene tints it per part."""
    u, v = g.uv()
    pv = g.mul(v, 8)
    idx = g.m('FLOOR', pv)
    bf = g.fract(pv)
    rnd, rnd2, rnd3 = g.white(idx), g.white(g.add(idx, 17.3)), g.white(g.add(idx, 41.7))
    du = g.m('ABSOLUTE', g.sub(g.fract(g.add(g.sub(u, rnd2), 0.5)), 0.5))
    joint = g.smooth(0.004, 0.0, du)
    board = g.mul(g.mul(g.smooth(0.0, 0.035, bf), g.smooth(1.0, 0.965, bf)), g.sub(1.0, joint))

    def board_noise(fu, fv, detail, k):
        vec, w = g.torus(fu, fv, (g.mul(rnd, 40.0 + k), k, g.mul(rnd3, 30.0 + k), k))
        nz = g.node('ShaderNodeTexNoise', noise_dimensions='4D', noise_type='FBM')
        for key, val in (('Vector', vec), ('W', w), ('Scale', 1.0), ('Detail', detail), ('Roughness', 0.6), ('Distortion', 0.0)):
            g.set(nz.inputs[key], val)
        return nz.outputs['Fac']
    wob = board_noise(3, 24, 4, 0.0)
    rings = g.fract(g.mul(g.add(g.add(bf, g.mul(g.sub(wob, 0.5), 0.9)), rnd3), 7.0))
    late = g.smooth(0.78, 1.0, rings)                               # dark latewood line at the end of each ring
    pores = g.noise(6, 260, detail=2, seed=55)
    kv = g.voronoi(3, 22, seed=53)
    knot = g.mul(g.gt(chan(g, kv['Color'], 0), 0.86), g.smooth(0.09, 0.02, kv['Distance']))
    weather = g.smooth(0.4, 0.7, board_noise(4, 18, 4, 7.0))
    check = g.mul(g.gt(board_noise(2, 40, 2, 3.0), 0.6), g.smooth(0.012, 0.0, g.m('ABSOLUTE', g.sub(bf, g.add(0.5, g.mul(g.sub(wob, 0.5), 0.3))))))
    col = g.ramp(rnd, [(0.0, '#cdbfa8'), (0.5, '#d9cab2'), (1.0, '#d2c1a6')])
    col = g.mix(g.mul(late, 0.55), col, g.scale_color(col, 0.68))
    col = g.mix(g.mul(g.smooth(0.55, 0.8, pores), 0.25), col, g.scale_color(col, 0.85))
    col = g.mix(knot, col, '#6a5038')
    col = g.mix(g.mul(weather, 0.5), col, '#aaa69c')
    col = g.mix(check, col, '#4a3a2c')
    col = g.mix(g.sub(1.0, board), col, '#2a2119')
    h = g.add(0.02, g.mul(board, 0.006), g.mul(g.sin(g.mul(bf, math.pi)), 0.0008), g.mul(late, g.mul(weather, -0.0008)),
              g.mul(pores, 0.0003), g.mul(knot, -0.0005), g.mul(check, -0.002))
    rough = g.add(0.74, g.mul(weather, 0.14), g.mul(g.sub(1.0, board), 0.1))
    return col, h, rough

def coral(g):
    """Corallites of a stony coral: raised walls around shallow cups, as a grey detail map
    that the scene multiplies with each colony's colour."""
    edge = g.voronoi(60, feature='DISTANCE_TO_EDGE', seed=61)['Distance']
    wall = g.smooth(0.07, 0.0, edge)
    cup = g.smooth(0.05, 0.3, edge)
    fine = g.noise(240, detail=2, seed=62)
    h = g.add(0.01, g.mul(wall, 0.003), g.mul(cup, -0.002), g.mul(fine, 0.0005))
    col = g.ramp(g.add(g.mul(g.sub(1.0, cup), 0.3), g.mul(wall, 0.6), g.mul(fine, 0.1)), [(0.0, '#8a8a8a'), (0.45, '#cbcbcb'), (1.0, '#f0f0f0')])
    rough = g.sub(0.8, g.mul(wall, 0.1))
    return col, h, rough


def brain(g):
    """Brain coral: meandering ridges and valleys (iso-lines of a warped noise field)."""
    field = g.noise(5, detail=3, rough=0.5, seed=71, distortion=0.4)
    m = g.sin(g.mul(field, TAU * 9.0))
    ridge = g.smooth(-0.2, 0.8, m)
    valley = g.smooth(-0.6, -0.95, m)
    fine = g.noise(200, detail=2, seed=72)
    h = g.add(0.01, g.mul(ridge, 0.006), g.mul(valley, -0.002), g.mul(fine, 0.0005))
    col = g.ramp(g.add(g.mul(ridge, 0.8), g.mul(fine, 0.2)), [(0.0, '#6e6e6e'), (0.5, '#bdbdbd'), (1.0, '#f0f0f0')])
    rough = g.sub(0.8, g.mul(ridge, 0.1))
    return col, h, rough


#        name     recipe  tile (m)  res   normal boost  cavity radius/depth (m)
RECIPES = [
    ('sand', sand, 1.2, 1024, 1.6, 0.004, 0.0015),
    ('rock', rock, 3.0, 1024, 1.2, 0.05, 0.03),
    ('bark', bark, 1.0, 1024, 1.5, 0.008, 0.004),
    ('thatch', thatch, 1.0, 1024, 1.3, 0.01, 0.01),
    ('wood', wood, 1.33, 1024, 1.2, 0.004, 0.004),
    ('coral', coral, 0.5, 512, 1.5, 0.004, 0.003),
    ('brain', brain, 0.6, 512, 1.5, 0.006, 0.004),
]
# the grassy ground is rendered from real geometry instead: see ground.py


def main():
    out = os.path.abspath((lib.args() or ['../assets/tex'])[0])
    only = set(lib.args()[1:])
    lib.fresh_scene(samples=4)
    plane, mat = lib.bake_plane()
    for name, recipe, tile, res, boost, cav_r, cav_d in RECIPES:
        if only and name not in only:
            continue
        t0 = time.time()
        g = lib.Graph(mat)
        col, h, rough = recipe(g)
        albedo = lib.bake(g, plane, col, res, samples=4)
        data = lib.bake(g, plane, g.combine(h, rough, 0.0), res, samples=2)
        height, rough_m = data[:, :, 0], data[:, :, 1]
        px = tile / res
        nrm = lib.normal_from_height(height, px, boost)
        ao = lib.cavity_ao(height, px, cav_r, cav_d)
        hn = (height - height.min()) / max(1e-6, np.ptp(height))
        lib.save_rgb(os.path.join(out, f'{name}_c.webp'), albedo, quality=86, srgb=True)
        lib.save_rgb(os.path.join(out, f'{name}_n.webp'), nrm, quality=90)
        lib.save_rgb(os.path.join(out, f'{name}_r.webp'), np.dstack([ao, np.clip(rough_m, 0, 1), hn]), quality=88)
        print(f'{name}: {time.time() - t0:.1f}s', flush=True)


if __name__ == '__main__':
    main()
