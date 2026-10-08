"""Small story props and animals, vertex coloured (no textures needed):

    fish       yamame trout, 23 cm, nose along +x (animated in the game)
    dragonfly  shiokara-tonbo; wing vertices carry flap weights in _WIND.b
    toro       floating paper lantern (toro nagashi), paper is emissive at night
    furin      glass wind chime with clapper, string and a paper strip
    hat        an old straw hat (left on the bench)
"""

import math
import os
import sys

import bpy  # noqa: I001
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import MODEL_DIR, export_glb, hexlin, log, mesh_from_arrays, obj_from_mesh, principled_material, reset_scene, select_only  # noqa: E402,E501


class Mesh:
    def __init__(self):
        self.V, self.F, self.C, self.W = [], [], [], []

    def add(self, V, F, C, W=None):
        base = len(self.V)
        self.V += [tuple(v) for v in V]
        self.F += [tuple(int(i) + base for i in f) for f in F]
        C = np.asarray(C, float)
        if C.ndim == 1:
            C = np.repeat(C[None, :], len(V), 0)
        self.C += [tuple(c[:3]) + (1.0,) for c in C]
        if W is None:
            W = np.zeros((len(V), 4))
        self.W += [tuple(w) for w in np.asarray(W, float)]

    def obj(self, name, mat):
        me = mesh_from_arrays(name, np.array(self.V), self.F, colors=np.array(self.C),
                              attrs={"_WIND": np.array(self.W)}, smooth=True)
        ob = obj_from_mesh(name, me)
        ob.data.materials.append(mat)
        return ob


def loft(path_fn, radius_fn, rings, segs, color_fn, cap=True, wind_fn=None):
    """Generic tube along x: path_fn(t) -> centre (3,), radius_fn(t) -> (ry, rz)."""
    V, C, W = [], [], []
    for i in range(rings + 1):
        t = i / rings
        c = np.asarray(path_fn(t))
        ry, rz = radius_fn(t)
        for j in range(segs):
            a = 2 * math.pi * j / segs
            p = c + np.array([0, math.cos(a) * ry, math.sin(a) * rz])
            V.append(p)
            C.append(color_fn(t, a, p))
            W.append(wind_fn(t, a) if wind_fn else (0, 0, 0, 0))
    F = []
    for i in range(rings):
        for j in range(segs):
            a = i * segs + j
            b = i * segs + (j + 1) % segs
            F.append((a, b, b + segs, a + segs))
    if cap:
        V.append(np.asarray(path_fn(0.0)))
        C.append(color_fn(0.0, 0.0, V[-1]))
        W.append(wind_fn(0.0, 0.0) if wind_fn else (0, 0, 0, 0))
        ci = len(V) - 1
        for j in range(segs):
            F.append((ci, (j + 1) % segs, j))
        V.append(np.asarray(path_fn(1.0)))
        C.append(color_fn(1.0, 0.0, V[-1]))
        W.append(wind_fn(1.0, 0.0) if wind_fn else (0, 0, 0, 0))
        ci2 = len(V) - 1
        last = rings * segs
        for j in range(segs):
            F.append((ci2, last + j, last + (j + 1) % segs))
    return np.array(V), F, np.array(C), np.array(W)


def lathe(profile, segs, color_fn):
    """Revolve (r, y) profile around the vertical axis (z up in Blender)."""
    V, C = [], []
    for i, (r, y) in enumerate(profile):
        for j in range(segs):
            a = 2 * math.pi * j / segs
            V.append((math.cos(a) * r, math.sin(a) * r, y))
            C.append(color_fn(i / (len(profile) - 1), a))
    F = []
    for i in range(len(profile) - 1):
        for j in range(segs):
            a = i * segs + j
            b = i * segs + (j + 1) % segs
            F.append((a, b, b + segs, a + segs))
    return np.array(V), F, np.array(C)


# ---------------------------------------------------------------------------

def fish():
    L = 0.23
    rnd = np.random.default_rng(3)
    marks = [(0.25 + 0.075 * k + rnd.normal(0, 0.006), rnd.uniform(0.85, 1.15)) for k in range(8)]
    dots = [(rnd.uniform(0.2, 0.75), rnd.uniform(0.6, 2.4)) for _ in range(14)]
    back = np.array(hexlin("#3a4030"))
    side = np.array(hexlin("#9a9a8c"))
    belly = np.array(hexlin("#d9d6cc"))
    parr = np.array(hexlin("#4a4c48"))
    red = np.array(hexlin("#b0503a"))

    def col(t, a, p):
        up = math.sin(a)  # +1 dorsal (z up), -1 belly
        c = side * (1 - max(up, 0)) + back * max(up, 0) ** 0.6
        c = c * (1 - max(-up, 0) ** 1.5) + belly * max(-up, 0) ** 1.5
        # parr marks along the lateral line
        for (mt, s) in marks:
            d = math.hypot((t - mt) / (0.025 * s), up / 0.55)
            if d < 1:
                c = c * 0.45 + parr * 0.55
        for (dt, da) in dots:
            if abs(t - dt) < 0.008 and abs(a - da) < 0.18:
                c = red
        if t < 0.12:
            c = c * (0.85 + t)  # darker head
        return c

    def rad(t):
        h = 0.028 * (math.sin(math.pi * min(t * 1.05, 1.0) ** 0.62) ** 0.9) * (1 - 0.65 * t ** 2) + 0.002
        return (h * 0.62, h)

    path = lambda t: (L * (0.5 - t), 0.0, 0.002 * math.sin(t * math.pi))  # noqa: E731
    sway = lambda t, a: (t, 0.0, 0.0, 0.0)  # noqa: E731  # _WIND.r = distance from the nose
    M = Mesh()
    V, F, C, W = loft(path, rad, 26, 12, col, wind_fn=sway)
    M.add(V, F, C, W)
    fin_c = np.array(hexlin("#5c5a4c"))
    # tail fin (forked)
    tx = -L * 0.5
    tail = [(tx, 0, 0.003), (tx - 0.045, 0, 0.032), (tx - 0.03, 0, 0.004), (tx - 0.045, 0, -0.026), (tx, 0, -0.002)]
    M.add(tail, [(0, 1, 2), (0, 2, 3), (0, 3, 4), (2, 1, 0), (3, 2, 0), (4, 3, 0)], fin_c, [(1.0, 0, 0, 0)] * 5)
    # dorsal + adipose fins
    for (x0, x1, hgt) in ((0.02, -0.02, 0.022), (-0.06, -0.075, 0.008)):
        z0 = rad(0.5 - x0 / L)[1]
        f = [(x0, 0, z0 - 0.002), (x1, 0, z0 - 0.002), (x1 - 0.005, 0, z0 + hgt)]
        tt = 0.5 - x0 / L
        M.add(f, [(0, 1, 2), (2, 1, 0)], fin_c, [(tt, 0, 0, 0)] * 3)
    # pectoral / pelvic / anal fins
    for (x, s, z) in ((0.06, 1, -0.012), (0.06, -1, -0.012), (-0.01, 1, -0.02), (-0.01, -1, -0.02), (-0.045, 0, -0.018)):
        f = [(x, 0.006 * s, z), (x - 0.025, 0.012 * s, z - 0.01), (x - 0.02, 0.002 * s, z - 0.004)]
        tt = 0.5 - x / L
        M.add(f, [(0, 1, 2), (2, 1, 0)], fin_c, [(tt, 0, 0, 0)] * 3)
    # eyes
    for s in (1, -1):
        e = [(L * 0.44 + 0.002 * math.cos(a), s * 0.0105, 0.004 + 0.003 * math.sin(a)) for a in np.linspace(0, 6.28, 9)[:-1]]
        M.add(e + [(L * 0.44, s * 0.0115, 0.004)], [(8, k, (k + 1) % 8) if s > 0 else (8, (k + 1) % 8, k) for k in range(8)],
              np.array(hexlin("#111111")), [(0.05, 0, 0, 0)] * 9)
    return M


def dragonfly():
    M = Mesh()
    body = np.array(hexlin("#6f8aa0"))
    dark = np.array(hexlin("#1d2226"))
    thorax_c = np.array(hexlin("#3c4a52"))

    def abd_col(t, a, p):
        return dark if t > 0.72 else body * (0.9 + 0.2 * math.sin(a))

    V, F, C, W = loft(lambda t: (-0.008 - 0.045 * t, 0, 0.0), lambda t: (0.0032 * (1 - 0.4 * t), 0.0032 * (1 - 0.4 * t)),
                      12, 8, abd_col)
    M.add(V, F, C)
    V, F, C, W = loft(lambda t: (0.006 - 0.016 * t, 0, 0.001), lambda t: (0.0045 * math.sin(math.pi * (0.15 + 0.7 * t)), 0.005 * math.sin(math.pi * (0.15 + 0.7 * t))),
                      6, 8, lambda t, a, p: thorax_c)
    M.add(V, F, C)
    # big compound eyes
    for s in (1, -1):
        V, F, C, W = loft(lambda t, s=s: (0.009 + 0.006 * t, s * 0.003, 0.002), lambda t: (0.0035 * math.sin(math.pi * t) + 0.0005,) * 2,
                          5, 8, lambda t, a, p: np.array(hexlin("#2a3a48")))
        M.add(V, F, C)
    # wings: forewing / hindwing pairs, flap weight in _WIND.b, side sign in _WIND.a
    wing_c = np.array(hexlin("#c8d0d4"))
    for (x0, span, chord) in ((0.0, 0.034, 0.008), (-0.006, 0.032, 0.010)):
        for s in (1, -1):
            pts = [(x0, s * 0.002, 0.004), (x0 + 0.002, s * (0.002 + span * 0.5), 0.0045), (x0 + 0.001, s * (0.002 + span), 0.0045),
                   (x0 - chord * 0.8, s * (0.002 + span * 0.95), 0.0045), (x0 - chord, s * (0.002 + span * 0.4), 0.0042), (x0 - chord * 0.6, s * 0.002, 0.004)]
            W = [(0, 0, min(abs(p[1]) / span, 1.0), 0.5 + 0.5 * s) for p in pts]
            M.add(pts, [(0, 1, 5), (1, 4, 5), (1, 2, 4), (2, 3, 4), (5, 1, 0), (5, 4, 1), (4, 2, 1), (4, 3, 2)], wing_c, W)
    return M


def toro():
    M = Mesh()
    wood = np.array(hexlin("#6a5038"))
    paper = np.array(hexlin("#efe6d2"))
    s, h = 0.2, 0.22

    def box(x0, x1, y0, y1, z0, z1, c):
        V = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        F = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        M.add(V, F, c)

    box(-0.13, 0.13, -0.13, 0.13, 0.0, 0.035, wood)
    for (x, y) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        box(x * s / 2 - 0.008, x * s / 2 + 0.008, y * s / 2 - 0.008, y * s / 2 + 0.008, 0.035, 0.035 + h, wood)
    # paper walls (the material "paper" glows); stored in a separate object
    P = Mesh()
    z0, z1 = 0.04, 0.035 + h - 0.01
    q = s / 2 - 0.002
    walls = [((-q, -q), (q, -q)), ((q, -q), (q, q)), ((q, q), (-q, q)), ((-q, q), (-q, -q))]
    for (a, b) in walls:
        P.add([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)], [(0, 1, 2, 3)], paper)
    box(-0.11, 0.11, -0.11, 0.11, 0.035 + h, 0.05 + h, wood)
    return M, P


def furin():
    M = Mesh()
    glass_c = np.array(hexlin("#d8e6ea"))

    def gcol(t, a):
        # goldfish-red brush strokes near the rim
        if t > 0.6 and (math.sin(a * 3) > 0.6):
            return np.array(hexlin("#c0392b"))
        if t > 0.86:
            return np.array(hexlin("#2e86c1"))
        return glass_c

    prof = [(0.001, 0.0), (0.012, -0.002), (0.024, -0.01), (0.032, -0.024), (0.036, -0.04), (0.037, -0.05)]
    V, F, C = lathe(prof, 20, gcol)
    G = Mesh()
    G.add(V, F, C)
    # inner surface so the thin glass has a thickness
    V2 = V * np.array([0.93, 0.93, 1.0])
    G.add(V2, [tuple(reversed(f)) for f in F], C)
    # string, clapper and the paper strip (tanzaku)
    S = Mesh()
    thread = np.array(hexlin("#c9b79c"))
    V, F, C, W = loft(lambda t: (0, 0, 0.12 - 0.11 * t), lambda t: (0.0008, 0.0008), 1, 4, lambda t, a, p: thread, cap=False)
    # loft builds along an arbitrary path: map (x,y,z) correctly (it already puts y/z radius offsets)
    S.add(V[:, [1, 2, 0]] * np.array([1, 1, 1]) + np.array([0, 0, 0]), F, C)
    V, F, C, W = loft(lambda t: (0, 0, -0.005 - 0.1 * t), lambda t: (0.0006, 0.0006), 1, 4, lambda t, a, p: thread, cap=False)
    S.add(V[:, [1, 2, 0]], F, C)
    S.add([(-0.0025, -0.0025, -0.036), (0.0025, -0.0025, -0.036), (0.0025, 0.0025, -0.036), (-0.0025, 0.0025, -0.036),
           (-0.0025, -0.0025, -0.05), (0.0025, -0.0025, -0.05), (0.0025, 0.0025, -0.05), (-0.0025, 0.0025, -0.05)],
          [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], glass_c)
    P = Mesh()
    paper = np.array(hexlin("#e8dcc0"))
    P.add([(-0.018, 0, -0.105), (0.018, 0, -0.105), (0.018, 0, -0.255), (-0.018, 0, -0.255)], [(0, 1, 2, 3)], paper,
          [(0, 0, 0.5, 0), (0, 0, 0.5, 0), (0, 0, 1, 0), (0, 0, 1, 0)])
    return G, S, P


def hat():
    straw = np.array(hexlin("#c9a86a"))
    band = np.array(hexlin("#3b2a20"))

    def col(t, a):
        stripe = 0.9 + 0.1 * math.sin(a * 60 + t * 30)
        if 0.38 < t < 0.48:
            return band
        return straw * stripe * (0.9 + 0.1 * t)

    prof = [(0.0, 0.115), (0.06, 0.112), (0.085, 0.1), (0.095, 0.075), (0.1, 0.03), (0.105, 0.012), (0.16, 0.006),
            (0.2, 0.0), (0.205, -0.004)]
    V, F, C = lathe(prof, 40, col)
    M = Mesh()
    M.add(V, F, C)
    M.add(V * np.array([1, 1, 1]) - np.array([0, 0, 0.003]), [tuple(reversed(f)) for f in F], C * 0.8)
    return M


def main():
    reset_scene()
    mats = {n: principled_material(n) for n in ("creature", "glass", "paper", "wing")}
    objs = []
    objs.append(fish().obj("fish", mats["creature"]))
    objs.append(dragonfly().obj("dragonfly", mats["creature"]))
    body, paper = toro()
    a = body.obj("toro_body", mats["creature"])
    b = paper.obj("toro_paper", mats["paper"])
    select_only([a, b], a)
    bpy.ops.object.join()
    a.name = "toro"
    objs.append(a)
    g, s, p = furin()
    go = g.obj("furin_glass", mats["glass"])
    so = s.obj("furin_string", mats["creature"])
    po = p.obj("furin_paper", mats["paper"])
    select_only([go, so, po], go)
    bpy.ops.object.join()
    go.name = "furin"
    objs.append(go)
    objs.append(hat().obj("hat", mats["creature"]))
    export_glb(objs, os.path.join(MODEL_DIR, "creatures.glb"))
    for o in objs:
        log(o.name, len(o.data.polygons))


if __name__ == "__main__":
    main()
