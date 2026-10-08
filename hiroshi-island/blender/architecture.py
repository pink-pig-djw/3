"""Built structures of the valley, modelled procedurally in world space so
foundations meet the terrain exactly:

    culvert   stone arch wall, voussoirs, coping, tunnel barrel
    house     raised wooden house: stones, posts, engawa + railing, shoji,
              plaster walls, irimoya roof with real tile corrugation
    deck      weathered wooden deck with bench and steps on the west bank
    stairs    stone steps from the plateau road down to the east path
and reusable pieces placed by the game:
    fence_post, fence_rail, lantern

Material names are mapped to textures in src/world/architecture.js:
    stone, wood, timber, boards, plaster, kawara, paper, dark
"""

import json
import math
import os
import sys

import bpy  # noqa: I001
import bmesh
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import world_spec as W  # noqa: E402
from common import (DATA_DIR, MODEL_DIR, export_glb, log, mesh_from_arrays, obj_from_mesh,  # noqa: E402
                    principled_material, reset_scene, select_only)

RNG = np.random.default_rng(42)


# ---------------------------------------------------------------------------
# Terrain sampling
# ---------------------------------------------------------------------------

class Terrain:
    def __init__(self):
        meta = json.load(open(os.path.join(DATA_DIR, "terrain.json")))
        self.size = meta["size"]
        self.res = meta["res"]
        self.h = np.fromfile(os.path.join(DATA_DIR, "terrain_height.bin"), np.float32).reshape(self.res, self.res)
        self.cell = self.size / (self.res - 1)

    def __call__(self, x, z):
        gx = (x + self.size / 2) / self.cell
        gz = (z + self.size / 2) / self.cell
        ix, iz = int(math.floor(gx)), int(math.floor(gz))
        fx, fz = gx - ix, gz - iz
        h = self.h
        return float((h[iz, ix] * (1 - fx) + h[iz, ix + 1] * fx) * (1 - fz)
                     + (h[iz + 1, ix] * (1 - fx) + h[iz + 1, ix + 1] * fx) * fz)


# ---------------------------------------------------------------------------
# Geometry builder (game coordinates: x east, y up, z south)
# ---------------------------------------------------------------------------

_box_cache = {}


def beveled_box(L, h, w, bevel):
    """Unit-frame box: x in [0, L] (length), y in [-h/2, h/2], z in [-w/2, w/2]."""
    key = (round(L, 4), round(h, 4), round(w, 4), round(bevel, 4))
    if key in _box_cache:
        return _box_cache[key]
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x = (v.co.x + 0.5) * L
        v.co.y = v.co.y * h
        v.co.z = v.co.z * w
    if bevel > 0:
        b = min(bevel, L * 0.3, h * 0.3, w * 0.3)
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=b, segments=1, affect="EDGES", profile=0.5)
    bm.normal_update()
    V = np.array([v.co[:] for v in bm.verts])
    F = [[v.index for v in f.verts] for f in bm.faces]
    N = [np.array(f.normal[:]) for f in bm.faces]
    bm.free()
    _box_cache[key] = (V, F, N)
    return V, F, N


class Builder:
    def __init__(self):
        self.parts = {}

    def _p(self, mat):
        return self.parts.setdefault(mat, dict(V=[], F=[], UV=[], C=[], n=0))

    def add(self, mat, V, F, UV, color):
        """V (n,3) game coords, F list of index lists, UV per-loop list matching F."""
        p = self._p(mat)
        base = p["n"]
        p["V"].append(np.asarray(V, float))
        for f, uvs in zip(F, UV):
            p["F"].append([i + base for i in f])
            p["UV"].extend(uvs)
        c = np.asarray(color, float)
        if c.ndim == 1:
            c = np.repeat(c[None, :3], len(V), 0)
        p["C"].append(c[:, :3])
        p["n"] += len(V)

    def box(self, mat, origin, along, up, L, h, w, bevel=0.01, tint=1.0, uv_tile=1.0, grain=True):
        """Beam/box starting at `origin`, extending L along `along`."""
        a = np.asarray(along, float)
        a /= np.linalg.norm(a)
        u = np.asarray(up, float)
        u = u - a * u.dot(a)
        u /= np.linalg.norm(u)
        s = np.cross(a, u)
        Vl, F, N = beveled_box(L, h, w, bevel)
        M = np.stack([a, u, s], 1)
        V = Vl @ M.T + np.asarray(origin, float)
        UV = []
        for f, n in zip(F, N):
            ax = int(np.argmax(np.abs(n)))
            uvs = []
            for vi in f:
                x, y, z = Vl[vi]
                if ax == 0:      # end grain
                    uvs.append((z / uv_tile + 0.31, y / uv_tile + 0.17))
                elif ax == 1:    # top / bottom
                    uvs.append((x / uv_tile, z / uv_tile + 0.5))
                else:            # sides
                    uvs.append((x / uv_tile, y / uv_tile + 0.25))
            UV.append(uvs)
        if np.ndim(tint) == 0:
            tint = (tint, tint, tint)
        self.add(mat, V, F, UV, tint)

    def post(self, mat, base, height, size, bevel=0.012, tint=1.0):
        self.box(mat, base, (0, 1, 0), (0, 0, 1), height, size, size, bevel, tint)

    def quad_grid(self, mat, origin, ex, ey, nx, ny, uv_scale=1.0, offset_fn=None, normal=None, tint=1.0,
                  clip=None):
        """Grid patch spanned by ex (nx cells) and ey (ny cells). offset_fn(s,t) displaces along normal."""
        ex = np.asarray(ex, float)
        ey = np.asarray(ey, float)
        nrm = np.cross(ex, ey) if normal is None else np.asarray(normal, float)
        nrm /= np.linalg.norm(nrm)
        Lx, Ly = np.linalg.norm(ex), np.linalg.norm(ey)
        V, F, UV = [], [], []
        ss = np.linspace(0, 1, nx + 1)
        tt = np.linspace(0, 1, ny + 1)
        for j, t in enumerate(tt):
            for i, s in enumerate(ss):
                p = np.asarray(origin, float) + ex * s + ey * t
                if offset_fn is not None:
                    p = p + nrm * offset_fn(s * Lx, t * Ly)
                V.append(p)
        V = np.array(V)
        for j in range(ny):
            for i in range(nx):
                a = j * (nx + 1) + i
                q = [a, a + 1, a + nx + 2, a + nx + 1]
                if clip is not None and not clip(V[q].mean(0)):
                    continue
                F.append(q)
                UV.append([(ss[i] * Lx / uv_scale, tt[j] * Ly / uv_scale), (ss[i + 1] * Lx / uv_scale, tt[j] * Ly / uv_scale),
                           (ss[i + 1] * Lx / uv_scale, tt[j + 1] * Ly / uv_scale), (ss[i] * Lx / uv_scale, tt[j + 1] * Ly / uv_scale)])
        if np.ndim(tint) == 0:
            tint = (tint, tint, tint)
        self.add(mat, V, F, UV, tint)

    def poly(self, mat, pts, uv_axes=None, uv_scale=1.0, tint=1.0):
        pts = np.asarray(pts, float)
        n = np.cross(pts[1] - pts[0], pts[2] - pts[0])
        n /= np.linalg.norm(n) + 1e-9
        if uv_axes is None:
            a = pts[1] - pts[0]
            a /= np.linalg.norm(a)
            b = np.cross(n, a)
        else:
            a, b = uv_axes
        uvs = [((p - pts[0]).dot(a) / uv_scale, (p - pts[0]).dot(b) / uv_scale) for p in pts]
        if np.ndim(tint) == 0:
            tint = (tint, tint, tint)
        self.add(mat, pts, [list(range(len(pts)))], [uvs], tint)

    def build(self, name, mats):
        objs = []
        for mat, p in self.parts.items():
            if not p["F"]:
                continue
            V = np.concatenate(p["V"])
            C = np.concatenate(p["C"])
            # game (x, y, z) -> blender (x, -z, y)
            Vb = np.stack([V[:, 0], -V[:, 2], V[:, 1]], 1)
            UV = np.array(p["UV"], float)
            me = mesh_from_arrays(f"{name}_{mat}", Vb, p["F"], uvs=UV, colors=np.c_[C, np.ones(len(C))], smooth=False)
            ob = obj_from_mesh(f"{name}_{mat}", me)
            ob.data.materials.append(mats[mat])
            objs.append(ob)
        select_only(objs, objs[0])
        bpy.ops.object.join()
        ob = bpy.context.view_layer.objects.active
        ob.name = name
        ob.data.name = name
        # auto-smooth-ish: keep beveled edges crisp but smooth small chamfers
        return ob


def tint_rand(base=1.0, var=0.12, hue=0.03):
    k = base * RNG.uniform(1 - var, 1 + var)
    h = RNG.uniform(-hue, hue)
    return (k * (1 + h), k, k * (1 - h))


# ---------------------------------------------------------------------------
# Culvert
# ---------------------------------------------------------------------------

def build_culvert(B, T):
    C = W.CULVERT
    cx, zf = C["x"], C["z"]
    R = C["arch_radius"]
    yspring = C["spring"]
    top = C["top"]
    thick = C["thickness"]
    hw = C["half_width"]
    ybot = 4.6
    ring_w = 0.42
    # mortar backing plane (slightly recessed), with the arch opening cut out
    def outside_opening(p):
        dx = p[0] - cx
        if p[1] >= yspring:
            return math.hypot(dx, p[1] - yspring) > R
        return abs(dx) > R

    B.quad_grid("dark", (cx - hw, ybot, zf - 0.02), (2 * hw, 0, 0), (0, top - ybot, 0), 72, 24, uv_scale=2.0,
                clip=outside_opening, tint=0.9)
    # coursed masonry blocks
    y = ybot
    course = 0
    while y < top - 0.05:
        ch = RNG.uniform(0.28, 0.5)
        if y + ch > top:
            ch = top - y
        x = cx - hw + (RNG.uniform(0.0, 0.5) if course % 2 else 0.0)
        while x < cx + hw - 0.05:
            bl = RNG.uniform(0.45, 1.35)
            if x + bl > cx + hw:
                bl = cx + hw - x
            pieces = [(x, bl)]
            out = []
            for depth in range(3):
                nxt = []
                for (px, pl) in pieces:
                    corners = [(px, y), (px + pl, y), (px, y + ch), (px + pl, y + ch)]
                    clear = all(math.hypot(qx - cx, max(qy - yspring, 0)) > R + ring_w + 0.03
                                if qy >= yspring - 0.0 else abs(qx - cx) > R + 0.05 for (qx, qy) in corners)
                    clear = clear and all(not (abs(qx - cx) < R + ring_w and qy > yspring - 0.02 and
                                              math.hypot(qx - cx, qy - yspring) < R + ring_w + 0.03)
                                          for (qx, qy) in corners)
                    inside_open = all(abs(qx - cx) < R and (qy < yspring or math.hypot(qx - cx, qy - yspring) < R)
                                      for (qx, qy) in corners)
                    if inside_open:
                        continue
                    if clear:
                        out.append((px, pl))
                    elif pl > 0.22:
                        nxt += [(px, pl / 2), (px + pl / 2, pl / 2)]
                pieces = nxt
            for (px, pl) in out:
                gap = 0.022
                prot = RNG.uniform(0.0, 0.06)
                shrink = RNG.uniform(0.0, 0.03)
                B.box("stone", (px + gap / 2, y + ch / 2 + RNG.normal(0, 0.006), zf + prot / 2), (1, 0, 0), (0, 1, 0),
                      pl - gap - shrink, ch - gap - shrink, 0.3 + prot, bevel=RNG.uniform(0.03, 0.07),
                      tint=tint_rand(0.95, 0.26, 0.06), uv_tile=2.5)
            x += bl
        y += ch
        course += 1
    # voussoirs around the arch + keystone
    nvs = 17
    for k in range(nvs):
        a0 = math.pi * k / nvs
        a1 = math.pi * (k + 1) / nvs
        am = (a0 + a1) / 2
        ri, ro = R, R + ring_w + (0.12 if k == nvs // 2 else 0.0)
        gap = 0.02
        # wedge as a box aligned radially (slight taper ignored), 0.36 deep
        mid_r = (ri + ro) / 2
        px = cx + math.cos(am) * mid_r
        py = yspring + math.sin(am) * mid_r
        along = np.array([math.cos(am), math.sin(am), 0])
        arc = (a1 - a0) * mid_r - gap
        B.box("stone", (px - along[0] * (ro - ri) / 2, py - along[1] * (ro - ri) / 2, zf + 0.04), along,
              (0, 0, 1), ro - ri, 0.44, arc, bevel=0.03, tint=tint_rand(0.92, 0.1), uv_tile=2.5)
    # springer blocks + jamb stones down to the bed
    for side in (-1, 1):
        yy = ybot
        while yy < yspring - 0.05:
            hh = min(RNG.uniform(0.35, 0.45), yspring - yy)
            x0 = cx + side * R
            B.box("stone", (x0 + (0 if side > 0 else -0.5), yy + hh / 2, zf + 0.03), (1, 0, 0), (0, 1, 0), 0.5,
                  hh - 0.02, 0.42, bevel=0.03, tint=tint_rand(0.95, 0.12), uv_tile=2.5)
            yy += hh
    # coping stones and low parapet on top
    x = cx - hw - 0.1
    while x < cx + hw + 0.1:
        L = RNG.uniform(0.7, 1.1)
        L = min(L, cx + hw + 0.1 - x)
        B.box("stone", (x, top + 0.09, zf - thick / 2 + 0.12), (1, 0, 0), (0, 1, 0), L - 0.015, 0.18, thick + 0.12,
              bevel=0.03, tint=tint_rand(0.97, 0.08), uv_tile=2.5)
        x += L
    x = cx - hw
    while x < cx + hw:
        L = min(RNG.uniform(0.5, 0.9), cx + hw - x)
        B.box("stone", (x, top + 0.18 + 0.2, zf - 0.22), (1, 0, 0), (0, 1, 0), L - 0.015, 0.4, 0.36, bevel=0.035,
              tint=tint_rand(0.95, 0.1), uv_tile=2.5)
        x += L
    for x in np.arange(cx - hw, cx + hw, 0.75):
        L = min(0.73, cx + hw - x)
        B.box("stone", (x, top + 0.58 + 0.06, zf - 0.22), (1, 0, 0), (0, 1, 0), L, 0.12, 0.44, bevel=0.03,
              tint=tint_rand(1.0, 0.06), uv_tile=2.5)
    # tunnel barrel (inner surface) going back into the hill
    depth = C["tunnel_depth"]
    nseg = 22
    za = zf
    zb = zf - depth
    ring = []
    for k in range(nseg + 1):
        a = math.pi * k / nseg
        ring.append((cx + math.cos(a) * R, yspring + math.sin(a) * R))
    V, F, UV = [], [], []
    nz = 12
    zs = np.linspace(za, zb, nz + 1)
    pts = [(cx + R, ybot)] + ring + [(cx - R, ybot)]
    for j, z in enumerate(zs):
        for i, (px, py) in enumerate(pts):
            V.append((px, py, z))
    for j in range(nz):
        for i in range(len(pts) - 1):
            a = j * len(pts) + i
            q = [a, a + 1, a + len(pts) + 1, a + len(pts)]  # normals face into the tunnel
            F.append(q)
            UV.append([(i * 0.25, zs[j] / 2.5), ((i + 1) * 0.25, zs[j] / 2.5), ((i + 1) * 0.25, zs[j + 1] / 2.5),
                       (i * 0.25, zs[j + 1] / 2.5)])
    V = np.array(V)
    # darken with depth (fake occlusion inside the tunnel)
    dk = np.clip(1 - (za - V[:, 2]) / depth * 1.4, 0.05, 1.0) ** 1.5
    B.add("stone", V, F, UV, np.stack([dk, dk, dk], 1) * 0.85)
    # paved deck over the tunnel where the road crosses (hides the trench in the terrain)
    zz = zf - thick
    while zz > zb:
        dz = RNG.uniform(0.45, 0.7)
        x = cx - 2.6
        while x < cx + 2.6:
            L = min(RNG.uniform(0.5, 1.0), cx + 2.6 - x)
            B.box("stone", (x, W.ROAD["y"] - 0.12, zz - dz / 2), (1, 0, 0), (0, 1, 0), L - 0.02, 0.3, dz - 0.02,
                  bevel=0.04, tint=tint_rand(0.8, 0.15), uv_tile=2.5)
            x += L
        zz -= dz
    # back wall in darkness
    B.poly("dark", [(cx - R - 0.2, ybot, zb), (cx + R + 0.2, ybot, zb), (cx + R + 0.2, yspring + R + 0.3, zb),
                    (cx - R - 0.2, yspring + R + 0.3, zb)], tint=0.02)


# ---------------------------------------------------------------------------
# House
# ---------------------------------------------------------------------------

class Frame:
    """Local frame of the house: x right, y up, z towards the front."""

    def __init__(self, x, z, yaw_deg, y0):
        a = math.radians(yaw_deg)
        self.o = np.array([x, y0, z])
        # yaw rotates local +z (front) towards ... (game yaw about +y)
        self.ex = np.array([math.cos(a), 0, -math.sin(a)])
        self.ey = np.array([0, 1.0, 0])
        self.ez = np.array([math.sin(a), 0, math.cos(a)])

    def p(self, x, y, z):
        return self.o + self.ex * x + self.ey * y + self.ez * z

    def d(self, x, y, z):
        return self.ex * x + self.ey * y + self.ez * z


def build_house(B, T):
    H = W.HOUSE
    F = Frame(H["x"], H["z"], H["yaw_deg"], H["ground"])
    floor = H["floor"] - H["ground"]  # ~0.7
    hw, hd = H["w"] / 2, H["d"] / 2  # 3.2, 2.4
    eng_front, eng_side = 0.95, 0.9
    xs = [-hw, -hw / 3, hw / 3, hw]
    zs = [-hd, 0.0, hd]
    eave = 2.95
    post = 0.15
    timber_tint = lambda: tint_rand(1.0, 0.07, 0.02)  # noqa: E731

    # --- foundation stones under every post (sit on the real terrain) ---
    def stone_under(lx, lz, size=0.42):
        p = F.p(lx, 0, lz)
        gy = T(p[0], p[2])
        top = H["ground"] + 0.28
        h = top - gy + 0.15
        B.box("stone", (p[0], gy - 0.15, p[2]), (0, 1, 0), F.ez, h, size, size, bevel=0.06,
              tint=tint_rand(0.95, 0.12), uv_tile=2.5)
        return top - H["ground"]

    for lx in xs:
        for lz in zs:
            stone_under(lx, lz)
    for lx in xs + [hw + eng_side]:
        stone_under(lx, hd + eng_front, 0.36)
    for lz in zs:
        stone_under(hw + eng_side, lz, 0.36)

    # --- sills, posts, beams ---
    sill_y = 0.28
    for lz in zs:
        B.box("timber", F.p(-hw - 0.08, sill_y + 0.08, lz), F.ex, F.ey, 2 * hw + 0.16, 0.16, 0.16, bevel=0.012,
              tint=timber_tint())
    for lx in xs:
        B.box("timber", F.p(lx, sill_y + 0.08, -hd - 0.08), F.ez, F.ey, 2 * hd + 0.16, 0.15, 0.15, bevel=0.012,
              tint=timber_tint())
    for lx in xs:
        for lz in zs:
            if abs(lx) < hw and abs(lz) < hd - 0.01:
                continue  # no posts in the middle of rooms
            B.box("timber", F.p(lx, sill_y + 0.16, lz), F.ey, F.ex, eave - sill_y - 0.16, post, post, bevel=0.015,
                  tint=timber_tint())
    # top plates
    for lz in (-hd, hd):
        B.box("timber", F.p(-hw - 0.5, eave - 0.1, lz), F.ex, F.ey, 2 * hw + 1.0 + eng_side, 0.2, 0.17, bevel=0.015,
              tint=timber_tint())
    for lx in (-hw, hw):
        B.box("timber", F.p(lx, eave - 0.09, -hd - 0.5), F.ez, F.ey, 2 * hd + 1.0 + eng_front, 0.18, 0.16,
              bevel=0.015, tint=timber_tint())
    # lintels (kamoi) and wall plates
    for lz in (-hd, hd):
        B.box("timber", F.p(-hw, 2.48, lz), F.ex, F.ey, 2 * hw, 0.1, 0.12, bevel=0.008, tint=timber_tint())
        B.box("timber", F.p(-hw, floor + 0.04, lz), F.ex, F.ey, 2 * hw, 0.08, 0.12, bevel=0.008, tint=timber_tint())
    for lx in (-hw, hw):
        B.box("timber", F.p(lx, 2.48, -hd), F.ez, F.ey, 2 * hd, 0.1, 0.12, bevel=0.008, tint=timber_tint())

    # --- floor and engawa ---
    B.box("boards", F.p(-hw, floor - 0.04, 0.0), F.ex, F.ey, 2 * hw, 0.08, 2 * hd, bevel=0.0,
          tint=0.8, uv_tile=1.0)
    nb = 34
    x0 = -hw
    x1 = hw + eng_side
    for i in range(nb):
        z = hd + (i + 0.5) * eng_front / 8
        if i >= 8:
            break
        B.box("boards", F.p(x0 - 0.05, floor - 0.02, z), F.ex, F.ey, x1 - x0 + 0.1, 0.045, eng_front / 8 - 0.008,
              bevel=0.006, tint=tint_rand(0.95, 0.1))
    for i in range(int((2 * hd) / 0.12)):
        z = -hd + (i + 0.5) * 0.12
        B.box("boards", F.p(hw, floor - 0.02, z), F.ex, F.ey, eng_side, 0.045, 0.112, bevel=0.006,
              tint=tint_rand(0.95, 0.1))
    # engawa edge beams + small posts
    B.box("timber", F.p(-hw - 0.1, floor - 0.12, hd + eng_front), F.ex, F.ey, 2 * hw + eng_side + 0.2, 0.14, 0.12,
          tint=timber_tint())
    B.box("timber", F.p(hw + eng_side, floor - 0.12, -hd - 0.1), F.ez, F.ey, 2 * hd + eng_front + 0.2, 0.14, 0.12,
          tint=timber_tint())
    for lx in xs + [hw + eng_side]:
        B.box("timber", F.p(lx, 0.28, hd + eng_front), F.ey, F.ex, floor - 0.38, 0.11, 0.11, tint=timber_tint())
    for lz in zs:
        B.box("timber", F.p(hw + eng_side, 0.28, lz), F.ey, F.ex, floor - 0.38, 0.11, 0.11, tint=timber_tint())
    # outer eave posts on the engawa corners (carry the roof)
    for (lx, lz) in ((-hw, hd + eng_front), (hw + eng_side, hd + eng_front), (hw + eng_side, -hd)):
        B.box("timber", F.p(lx, floor, lz), F.ey, F.ex, eave - floor - 0.1, 0.12, 0.12, tint=timber_tint())
    B.box("timber", F.p(-hw - 0.2, eave - 0.2, hd + eng_front), F.ex, F.ey, 2 * hw + eng_side + 0.4, 0.16, 0.13,
          tint=timber_tint())
    B.box("timber", F.p(hw + eng_side, eave - 0.2, -hd - 0.2), F.ez, F.ey, 2 * hd + eng_front + 0.4, 0.16, 0.13,
          tint=timber_tint())

    # --- railing (front, leaving a gap for the steps on the right) ---
    rail_h = 0.62
    def railing(p0, p1, posts):
        p0 = np.array(p0, float)
        p1 = np.array(p1, float)
        d = p1 - p0
        L = np.linalg.norm(d)
        dn = d / L
        for k in range(posts + 1):
            q = p0 + d * k / posts
            B.box("timber", F.p(q[0], floor, q[1]), F.ey, F.ex, rail_h + 0.06, 0.07, 0.07, bevel=0.01,
                  tint=timber_tint())
        dw = F.ex * dn[0] + F.ez * dn[1]
        for yy, hh in ((rail_h, 0.05), (rail_h * 0.45, 0.035)):
            B.box("timber", F.p(p0[0], floor + yy, p0[1]), dw, F.ey, L, hh, 0.06, bevel=0.008, tint=timber_tint())
        nbal = int(L / 0.16)
        for k in range(1, nbal):
            q = p0 + d * k / nbal
            B.box("timber", F.p(q[0], floor + rail_h * 0.45, q[1]), F.ey, F.ex, rail_h * 0.55, 0.025, 0.025,
                  bevel=0.004, tint=timber_tint())

    railing((-hw, hd + eng_front - 0.05), (1.4, hd + eng_front - 0.05), 4)
    railing((hw + eng_side - 0.05, -hd), (hw + eng_side - 0.05, hd * 0.2), 2)

    # --- walls ---
    def wall_panel(xa, xb, lz, kind, facing):
        """Panel between posts on the plane z = lz (front/back walls)."""
        w = xb - xa
        y0, y1 = floor, 2.48
        zoff = 0.0
        # lower boards (koshi-ita) on side/back walls and under windows
        if kind in ("plaster", "window"):
            nbd = max(2, int(w / 0.18))
            for k in range(nbd):
                B.box("boards", F.p(xa + k * w / nbd + 0.004, y0 + 0.45, lz + zoff), F.ex, F.ey, w / nbd - 0.006, 0.9,
                      0.03, bevel=0.003, tint=tint_rand(0.9, 0.1))
        if kind == "plaster":
            B.quad_grid("plaster", F.p(xa, y0 + 0.9, lz + 0.01 * facing), F.d(w, 0, 0), F.d(0, y1 - y0 - 0.9, 0), 4, 4,
                        uv_scale=2.0, normal=F.ez * facing, tint=tint_rand(1.0, 0.04))
        if kind == "window":
            B.quad_grid("plaster", F.p(xa, y0 + 0.9, lz + 0.01 * facing), F.d(w, 0, 0), F.d(0, y1 - y0 - 0.9, 0), 4, 4,
                        uv_scale=2.0, normal=F.ez * facing, tint=tint_rand(1.0, 0.04),
                        clip=lambda p: not _in_window(p, F, xa, xb, y0 + 1.25, y0 + 1.7))
            shoji(xa + w * 0.25, xb - w * 0.25, y0 + 1.25, y0 + 1.7, lz + 0.02 * facing, facing)
        if kind == "shoji":
            mid = (xa + xb) / 2
            shoji(xa, mid + 0.02, y0 + 0.04, y1 - 0.02, lz + 0.03 * facing, facing)
            shoji(mid - 0.02, xb, y0 + 0.04, y1 - 0.02, lz + 0.065 * facing, facing)
        # wall above the lintel
        B.quad_grid("plaster", F.p(xa, 2.58, lz + 0.01 * facing), F.d(w, 0, 0), F.d(0, eave - 2.68, 0), 2, 1,
                    uv_scale=2.0, normal=F.ez * facing, tint=tint_rand(0.97, 0.04))

    def shoji(xa, xb, ya, yb, lz, facing):
        w, h = xb - xa, yb - ya
        B.quad_grid("paper", F.p(xa, ya, lz), F.d(w, 0, 0), F.d(0, h, 0), 1, 1, uv_scale=1.0, normal=F.ez * facing)
        fr = 0.035
        for (yy, hh) in ((ya, fr), (yb - fr, fr)):
            B.box("timber", F.p(xa, yy + hh / 2, lz + 0.012 * facing), F.ex, F.ey, w, hh, 0.03, bevel=0.003,
                  tint=timber_tint())
        for xx in (xa, xb - fr):
            B.box("timber", F.p(xx + fr / 2, ya, lz + 0.012 * facing), F.ey, F.ex, h, fr, 0.03, bevel=0.003,
                  tint=timber_tint())
        # kumiko lattice
        nx, ny = max(2, int(w / 0.28)), max(2, int(h / 0.3))
        for i in range(1, nx):
            xx = xa + w * i / nx
            B.box("timber", F.p(xx, ya, lz + 0.01 * facing), F.ey, F.ex, h, 0.012, 0.02, bevel=0.0,
                  tint=timber_tint())
        for j in range(1, ny):
            yy = ya + h * j / ny
            B.box("timber", F.p(xa, yy, lz + 0.01 * facing), F.ex, F.ey, w, 0.012, 0.02, bevel=0.0,
                  tint=timber_tint())

    for i in range(3):
        wall_panel(xs[i], xs[i + 1], hd, "shoji", 1)
        wall_panel(xs[i], xs[i + 1], -hd, "window" if i == 1 else "plaster", -1)
    # side walls (rotate the frame logic: build directly with ez as width axis)
    for lx, facing in ((-hw, -1), (hw, 1)):
        for k in range(2):
            za, zb = zs[k], zs[k + 1]
            w = zb - za
            nbd = max(2, int(w / 0.18))
            for q in range(nbd):
                B.box("boards", F.p(lx, floor + 0.45, za + q * w / nbd + 0.004), F.ez, F.ey, w / nbd - 0.006, 0.9,
                      0.03, bevel=0.003, tint=tint_rand(0.9, 0.1))
            if lx > 0 and k == 1:
                # shoji door towards the side engawa
                B.quad_grid("paper", F.p(lx + 0.03, floor + 0.04, za), F.d(0, 0, w), F.d(0, 2.42 - floor, 0), 1, 1,
                            normal=F.ex * facing)
                for j in range(1, 6):
                    B.box("timber", F.p(lx + 0.04, floor + 0.04 + j * (2.42 - floor) / 6, za), F.ez, F.ey, w, 0.012,
                          0.02, bevel=0.0, tint=timber_tint())
                for j in range(1, 4):
                    B.box("timber", F.p(lx + 0.04, floor + 0.04, za + j * w / 4), F.ey, F.ex, 2.42 - floor - 0.04, 0.012,
                          0.02, bevel=0.0, tint=timber_tint())
            else:
                B.quad_grid("plaster", F.p(lx + 0.01 * facing, floor + 0.9, za), F.d(0, 0, w),
                            F.d(0, 2.48 - floor - 0.9, 0), 4, 4, uv_scale=2.0, normal=F.ex * facing,
                            tint=tint_rand(1.0, 0.04))
            B.quad_grid("plaster", F.p(lx + 0.01 * facing, 2.58, za), F.d(0, 0, w), F.d(0, eave - 2.68, 0), 2, 1,
                        uv_scale=2.0, normal=F.ex * facing, tint=tint_rand(0.97, 0.04))
    # interior: dark floor/ceiling so the glowing shoji read as rooms at night
    B.quad_grid("boards", F.p(-hw, floor + 0.001, hd), F.d(2 * hw, 0, 0), F.d(0, 0, -2 * hd), 2, 2, uv_scale=1.0,
                normal=F.ey, tint=0.55)
    B.quad_grid("dark", F.p(-hw, eave - 0.25, -hd), F.d(2 * hw, 0, 0), F.d(0, 0, 2 * hd), 1, 1, normal=-F.ey, tint=0.3)

    # --- roof (irimoya) ---
    build_roof(B, F, xs, zs, eave, hw, hd, eng_front, eng_side)

    # --- entrance steps (stone) on the right side of the front engawa ---
    for k, (dz, hh) in enumerate(((0.35, 0.42), (0.75, 0.2))):
        p = F.p(2.6, 0, hd + eng_front + dz)
        gy = T(p[0], p[2])
        B.box("stone", (p[0], gy - 0.1, p[2]), (0, 1, 0), F.ex, H["ground"] + hh - gy + 0.1, 0.9 - 0.15 * k, 0.4,
              bevel=0.05, tint=tint_rand(0.95, 0.1), uv_tile=2.5)
    return F


def _in_window(p, F, xa, xb, ya, yb):
    rel = p - F.o
    lx = rel.dot(F.ex)
    ly = rel.dot(F.ey)
    w = xb - xa
    return (xa + w * 0.25 < lx < xb - w * 0.25) and (ya < ly < yb)


def build_roof(B, F, xs, zs, eave, hw, hd, eng_front, eng_side):
    pitch = math.tan(math.radians(25))
    ov = 0.85
    # roof outline (local): covers the house and both engawa
    rx0, rx1 = -hw - ov, hw + eng_side + ov * 0.75
    rz0, rz1 = -hd - ov, hd + eng_front + ov * 0.75
    cxr = (rx0 + rx1) / 2
    czr = (rz0 + rz1) / 2
    half_w = (rx1 - rx0) / 2
    half_d = (rz1 - rz0) / 2
    y_edge = eave - ov * pitch  # height at the eave edge
    hip_run = 1.75  # horizontal run of the lower hip skirt at the gable ends
    ridge_y = y_edge + half_d * pitch
    gable_y = y_edge + hip_run * pitch
    P = 0.27   # tile period across
    course = 0.25

    def corrugation(s, t):
        lip = (s / course) % 1.0
        return 0.04 * (0.5 + 0.5 * math.sin(2 * math.pi * t / P)) + 0.018 * lip

    def slope(origin, ex, ey, ns, nt, clip):
        B.quad_grid("kawara", origin, ex, ey, ns, nt, uv_scale=1.0, offset_fn=lambda a, b: corrugation(b, a),
                    clip=clip)

    # front & back main slopes (full width up to the ridge, clipped by the hip lines at the ends)
    for sgn in (1, -1):
        zedge = czr + sgn * half_d
        origin = F.p(rx0, y_edge, zedge)
        ex = F.d(rx1 - rx0, 0, 0)
        ey = F.d(0, half_d * pitch, -sgn * half_d)
        nt = int((rx1 - rx0) / (P / 6))
        ns = int(half_d * 1.1 / (course / 3))

        def clip(p, sgn=sgn):
            rel = p - F.o
            lx, lz = rel.dot(F.ex), rel.dot(F.ez)
            d = half_d - (lz - czr) * sgn  # horizontal distance in from the eave edge
            if d < hip_run:
                return abs(lx - cxr) < half_w - d   # clipped by the 45 degree hip lines
            return abs(lx - cxr) < half_w - hip_run + 0.35  # gable part overhangs its wall

        if sgn > 0:
            slope(origin, ex, ey, nt, ns, clip)
        else:
            # flip so the corrugation offset points outward/up
            slope(F.p(rx1, y_edge, zedge), F.d(-(rx1 - rx0), 0, 0), ey, nt, ns, clip)
    # hip skirts at the two ends (trapezoids up to the gable line)
    for sgn in (1, -1):
        xedge = cxr + sgn * half_w
        origin = F.p(xedge, y_edge, czr + sgn * half_d)
        ez_span = F.d(0, 0, -2 * half_d * sgn)  # winding so the normal points up and out
        ey = F.d(-sgn * hip_run, hip_run * pitch, 0)
        nt = int(2 * half_d / (P / 6))
        ns = int(hip_run * 1.1 / (course / 3))

        def clip(p, sgn=sgn):
            rel = p - F.o
            lx, lz = rel.dot(F.ex), rel.dot(F.ez)
            dist_edge = half_w - (lx - cxr) * sgn
            return abs(lz - czr) < half_d - dist_edge

        slope(origin, ez_span, ey, nt, ns, clip)
    # gable walls (tsuma): vertical triangles above the gable line, with boards
    for sgn in (1, -1):
        xg = cxr + sgn * (half_w - hip_run) + sgn * 0.12
        half_g = half_d - hip_run
        pts = [F.p(xg, gable_y, czr - half_g), F.p(xg, gable_y, czr + half_g), F.p(xg, ridge_y - 0.05, czr)]
        if sgn > 0:
            pts = pts[::-1]
        B.poly("boards", pts, uv_axes=(F.ez, F.ey), uv_scale=1.0, tint=0.85)
        # vertical battens
        for k in range(-6, 7):
            zz = czr + k * half_g / 7
            hh = (ridge_y - gable_y) * (1 - abs(k) / 7) - 0.06
            if hh > 0.05:
                B.box("timber", F.p(xg + sgn * 0.02, gable_y, zz), F.ey, F.ez, hh, 0.04, 0.03, bevel=0.0, tint=0.9)
        # bargeboards
        for side in (-1, 1):
            p0 = F.p(xg + sgn * 0.06, gable_y - 0.05, czr + side * (half_g + 0.35))
            p1 = F.p(xg + sgn * 0.06, ridge_y + 0.05, czr)
            d = p1 - p0
            B.box("timber", p0, d, F.ey - F.ez * 0.0 + 0.0001, np.linalg.norm(d), 0.2, 0.06, bevel=0.01, tint=0.8)
    # ridge: stacked noshi tiles + rounded cap, with oni-gawara ends
    rl0 = cxr - (half_w - hip_run) - 0.3
    rl1 = cxr + (half_w - hip_run) + 0.3
    for k, (hh, ww) in enumerate(((0.12, 0.42), (0.1, 0.36), (0.1, 0.3))):
        B.box("kawara", F.p(rl0, ridge_y + 0.05 + k * 0.1, czr), F.ex, F.ey, rl1 - rl0, hh, ww, bevel=0.015, tint=0.9)
    B.box("kawara", F.p(rl0 - 0.05, ridge_y + 0.36, czr), F.ex, F.ey, rl1 - rl0 + 0.1, 0.12, 0.2, bevel=0.05, tint=0.8)
    for x in (rl0 - 0.12, rl1 + 0.12):
        B.box("kawara", F.p(x - 0.12, ridge_y + 0.05, czr), F.ex, F.ey, 0.24, 0.62, 0.46, bevel=0.06, tint=0.7)
    # hip ridges (4 corners): from the eave corner up to the gable-line corner
    for sx in (1, -1):
        for sz in (1, -1):
            p0 = F.p(cxr + sx * half_w, y_edge + 0.05, czr + sz * half_d)
            p1 = F.p(cxr + sx * (half_w - hip_run), gable_y + 0.07, czr + sz * (half_d - hip_run))
            d = p1 - p0
            B.box("kawara", p0, d, F.ey, np.linalg.norm(d) + 0.1, 0.16, 0.2, bevel=0.04, tint=0.85)
    # eave fascia and soffit with rafters
    for sgn in (1, -1):
        B.box("timber", F.p(rx0 - 0.05, y_edge - 0.06, czr + sgn * (half_d + 0.02)), F.ex, F.ey, rx1 - rx0 + 0.1,
              0.12, 0.05, bevel=0.01, tint=0.85)
    for sgn in (1, -1):
        B.box("timber", F.p(cxr + sgn * (half_w + 0.02), y_edge - 0.06, rz0 - 0.05), F.ez, F.ey, rz1 - rz0 + 0.1,
              0.12, 0.05, bevel=0.01, tint=0.85)
    # soffit boards under the overhang (front and back)
    for sgn in (1, -1):
        zout = czr + sgn * half_d
        zin = zout - sgn * (ov + 0.3)
        B.poly("boards", [F.p(rx0, y_edge - 0.03, zout), F.p(rx1, y_edge - 0.03, zout),
                          F.p(rx1, y_edge - 0.03 + (ov + 0.3) * pitch, zin), F.p(rx0, y_edge - 0.03 + (ov + 0.3) * pitch, zin)][::sgn],
               tint=0.6)
        for x in np.arange(rx0 + 0.1, rx1, 0.42):
            p0 = F.p(x, y_edge - 0.08, zout)
            d = F.d(0, (ov + 0.4) * pitch, -sgn * (ov + 0.4))
            B.box("timber", p0, d, F.ey, np.linalg.norm(d), 0.08, 0.06, bevel=0.008, tint=0.8)
    for sgn in (1, -1):
        xout = cxr + sgn * half_w
        xin = xout - sgn * (ov + 0.3)
        B.poly("boards", [F.p(xout, y_edge - 0.03, rz1), F.p(xout, y_edge - 0.03, rz0),
                          F.p(xin, y_edge - 0.03 + (ov + 0.3) * pitch, rz0), F.p(xin, y_edge - 0.03 + (ov + 0.3) * pitch, rz1)][::sgn],
               tint=0.6)


# ---------------------------------------------------------------------------
# Deck, stairs, small pieces
# ---------------------------------------------------------------------------

def build_deck(B, T, level):
    D = W.DECK
    Fr = Frame(D["x"], D["z"], D["yaw_deg"], level)
    hw, hd = D["w"] / 2, D["d"] / 2
    top = D["height"]
    # posts down to the terrain
    for lx in (-hw, 0, hw):
        for lz in (-hd, hd):
            p = Fr.p(lx, 0, lz)
            gy = T(p[0], p[2]) - 0.25
            B.box("wood", (p[0], gy, p[2]), (0, 1, 0), Fr.ex, level + top - gy - 0.05, 0.12, 0.12, bevel=0.012,
                  tint=tint_rand(0.85, 0.1))
    for lz in (-hd, hd):
        B.box("wood", Fr.p(-hw - 0.1, top - 0.14, lz), Fr.ex, Fr.ey, 2 * hw + 0.2, 0.14, 0.1, tint=tint_rand(0.85, 0.08))
    for lx in np.linspace(-hw, hw, 5):
        B.box("wood", Fr.p(lx, top - 0.13, -hd), Fr.ez, Fr.ey, 2 * hd, 0.12, 0.06, tint=tint_rand(0.8, 0.08))
    n = int((2 * hd) / 0.145)
    for i in range(n):
        z = -hd + (i + 0.5) * (2 * hd / n)
        jitter = RNG.uniform(-0.03, 0.03)
        B.box("wood", Fr.p(-hw - 0.05 + jitter, top - 0.02, z), Fr.ex, Fr.ey, 2 * hw + 0.1, 0.04, 2 * hd / n - 0.012,
              bevel=0.006, tint=tint_rand(1.0, 0.12, 0.03))
    # railing on the back and the left side, bench along the back
    rh = 0.85
    for (a, b) in (((-hw, -hd), (hw, -hd)), ((-hw, -hd), (-hw, hd))):
        a = np.array(a)
        b = np.array(b)
        d = b - a
        L = np.linalg.norm(d)
        posts = int(L / 1.1) + 1
        for k in range(posts + 1):
            q = a + d * k / posts
            B.box("wood", Fr.p(q[0], top, q[1]), Fr.ey, Fr.ex, rh, 0.08, 0.08, bevel=0.01, tint=tint_rand(0.9, 0.1))
        dw = Fr.ex * d[0] / L + Fr.ez * d[1] / L
        for yy in (rh - 0.03, rh * 0.5):
            B.box("wood", Fr.p(a[0], top + yy, a[1]), dw, Fr.ey, L, 0.05, 0.08, bevel=0.01, tint=tint_rand(0.95, 0.08))
    # bench
    for lx in (-hw + 0.5, 0.0, hw - 0.5):
        B.box("wood", Fr.p(lx, top, -hd + 0.35), Fr.ey, Fr.ex, 0.4, 0.08, 0.3, tint=tint_rand(0.85, 0.08))
    for k in range(3):
        B.box("wood", Fr.p(-hw + 0.3, top + 0.42, -hd + 0.22 + k * 0.105), Fr.ex, Fr.ey, 2 * hw - 0.6, 0.04, 0.1,
              bevel=0.008, tint=tint_rand(1.0, 0.1))
    # steps towards the water (front right)
    for k in range(2):
        z = hd + 0.3 + k * 0.3
        p = Fr.p(hw - 0.7, 0, z)
        gy = T(p[0], p[2])
        yy = top - 0.2 * (k + 1)
        B.box("wood", Fr.p(hw - 1.3, yy - 0.04, z), Fr.ex, Fr.ey, 1.2, 0.05, 0.28, bevel=0.006, tint=tint_rand(0.95, 0.1))
        for lx in (hw - 1.25, hw - 0.15):
            q = Fr.p(lx, 0, z)
            g = T(q[0], q[2]) - 0.2
            B.box("wood", (q[0], g, q[2]), (0, 1, 0), Fr.ex, level + yy - g - 0.06, 0.07, 0.07, tint=tint_rand(0.8, 0.1))
    return Fr


def build_stairs(B, T, info):
    (tx, tz), (bx, bz) = W.STAIRS["top"], W.STAIRS["bottom"]
    ytop, ybot = info["ytop"], info["ybot"]
    n = W.STAIRS["steps"]
    d = np.array([bx - tx, 0, bz - tz])
    L = np.linalg.norm(d)
    dn = d / L
    side = np.cross(dn, [0, 1, 0])
    for k in range(n + 1):
        t = k / n
        p = np.array([tx, 0, tz]) + d * t
        y = ytop + (ybot - ytop) * t
        w = 1.3 + RNG.uniform(-0.1, 0.1)
        depth = L / n + 0.12
        gy = min(T(p[0] + side[0] * 0.6, p[2] + side[2] * 0.6), T(p[0] - side[0] * 0.6, p[2] - side[2] * 0.6), y) - 0.3
        B.box("stone", np.array([p[0], gy, p[2]]), (0, 1, 0), side, y - gy, w, depth, bevel=0.05,
              tint=tint_rand(0.95, 0.12), uv_tile=2.5)


def build_fence_pieces(B):
    # post: origin at ground level, 1.05 m tall (0.25 in the ground)
    B.box("wood", (0, -0.25, 0), (0, 1, 0), (1, 0, 0), 1.3, 0.09, 0.09, bevel=0.015, tint=tint_rand(0.9, 0.05))


def build_rail(B):
    # rail: 1 m long along +x, round-ish (octagonal beam), origin at its start
    B.box("wood", (0, 0, 0), (1, 0, 0), (0, 1, 0), 1.0, 0.06, 0.06, bevel=0.02, tint=tint_rand(0.95, 0.05))


def build_lantern(B):
    # wooden post with a small paper andon on top; origin at ground
    B.box("wood", (0, -0.3, 0), (0, 1, 0), (1, 0, 0), 1.42, 0.085, 0.085, bevel=0.012, tint=0.85)
    y0 = 1.12
    s = 0.22
    hgt = 0.3
    B.box("wood", (-s / 2 - 0.02, y0, 0), (1, 0, 0), (0, 1, 0), s + 0.04, 0.03, s + 0.04, bevel=0.005, tint=0.8)
    for (x, z) in ((-s / 2, -s / 2), (s / 2, -s / 2), (s / 2, s / 2), (-s / 2, s / 2)):
        B.box("wood", (x, y0, z), (0, 1, 0), (1, 0, 0), hgt, 0.022, 0.022, bevel=0.003, tint=0.8)
    for (o, ex, n) in (((-s / 2, y0 + 0.02, s / 2), (s, 0, 0), (0, 0, 1)), ((s / 2, y0 + 0.02, -s / 2), (-s, 0, 0), (0, 0, -1)),
                       ((s / 2, y0 + 0.02, s / 2), (0, 0, -s), (1, 0, 0)), ((-s / 2, y0 + 0.02, -s / 2), (0, 0, s), (-1, 0, 0))):
        B.quad_grid("paper", o, ex, (0, hgt - 0.04, 0), 1, 1, normal=n)
    # little roof
    B.box("wood", (-s / 2 - 0.05, y0 + hgt, 0), (1, 0, 0), (0, 1, 0), s + 0.1, 0.03, s + 0.1, bevel=0.01, tint=0.7)
    B.box("wood", (-s / 2 + 0.02, y0 + hgt + 0.05, 0), (1, 0, 0), (0, 1, 0), s - 0.04, 0.06, s - 0.04, bevel=0.02, tint=0.65)


# ---------------------------------------------------------------------------

def main():
    reset_scene()
    T = Terrain()
    layout = json.load(open(os.path.join(DATA_DIR, "layout.json")))
    names = ["stone", "wood", "timber", "boards", "plaster", "kawara", "paper", "dark"]
    mats = {n: principled_material(n) for n in names}
    objs = []

    B = Builder()
    build_culvert(B, T)
    objs.append(B.build("culvert", mats))
    log("culvert done")

    B = Builder()
    build_house(B, T)
    objs.append(B.build("house", mats))
    log("house done")

    B = Builder()
    build_deck(B, T, layout["deck"]["level"])
    objs.append(B.build("deck", mats))

    B = Builder()
    build_stairs(B, T, layout["stairs"])
    objs.append(B.build("stairs", mats))

    for nm, fn in (("fence_post", build_fence_pieces), ("fence_rail", build_rail), ("lantern", build_lantern)):
        B = Builder()
        fn(B)
        objs.append(B.build(nm, mats))
    export_glb(objs, os.path.join(MODEL_DIR, "architecture.glb"))
    for o in objs:
        log(o.name, len(o.data.polygons), "faces")


if __name__ == "__main__":
    main()
