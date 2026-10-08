"""Terrain, stream and world layout for chapter one (溪谷).

Produces (all in game coordinates, metres):
    public/assets/data/terrain.json         grid metadata
    public/assets/data/terrain_height.bin   float32 heights, near grid (res x res)
    public/assets/data/terrain_far.bin      float32 heights, far grid
    public/assets/data/water_level.bin      float32 water surface level field
    public/assets/data/stream.json          dense stream centre line samples
    public/assets/data/layout.json          placements (trees, rocks, plants, props...)
    public/assets/textures/splat.png        R grass  G path  B riverbed  A forest floor
    public/assets/textures/masks.png        R grass density  G flowers  B wetness  A exposed rock

Also builds the terrain + placement empties inside Blender so the level can be
inspected or edited (see build_all.py, which saves blender/build/island.blend).
"""

import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import world_spec as W  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA_DIR = os.path.join(ROOT, "public", "assets", "data")
TEX_DIR = os.path.join(ROOT, "public", "assets", "textures")
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(TEX_DIR, exist_ok=True)


def log(*a):
    print("[terrain]", *a, flush=True)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------------------
# Noise (deterministic, vectorised)
# ---------------------------------------------------------------------------

def _hash2(ix, iy, seed):
    v = (ix * 374761393 + iy * 668265263 + seed * 1442695041) & 0xFFFFFFFF
    v = ((v ^ (v >> 13)) * 1274126177) & 0xFFFFFFFF
    v = v ^ (v >> 16)
    return (v & 0xFFFFFF) / float(0xFFFFFF)


def vnoise(x, y, seed=0):
    x = np.asarray(x, np.float64)
    y = np.asarray(y, np.float64)
    xi = np.floor(x).astype(np.int64)
    yi = np.floor(y).astype(np.int64)
    xf, yf = x - xi, y - yi
    u = xf * xf * xf * (xf * (xf * 6 - 15) + 10)
    v = yf * yf * yf * (yf * (yf * 6 - 15) + 10)
    a = _hash2(xi, yi, seed)
    b = _hash2(xi + 1, yi, seed)
    c = _hash2(xi, yi + 1, seed)
    d = _hash2(xi + 1, yi + 1, seed)
    return ((a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v) * 2 - 1


def fbm(x, y, octaves=5, seed=0, lac=2.03, gain=0.5):
    tot = 0.0
    amp, f, norm = 1.0, 1.0, 0.0
    for o in range(octaves):
        # rotate each octave a little to hide grid alignment
        a = 0.5 * o
        ca, sa = math.cos(a), math.sin(a)
        tot = tot + vnoise((x * ca - y * sa) * f, (x * sa + y * ca) * f, seed + 31 * o) * amp
        norm += amp
        amp *= gain
        f *= lac
    return tot / norm


def ridged(x, y, octaves=5, seed=0):
    tot, amp, f, norm = 0.0, 1.0, 1.0, 0.0
    for o in range(octaves):
        n = 1 - np.abs(vnoise(x * f, y * f, seed + 7 * o))
        tot = tot + n * n * amp
        norm += amp
        amp *= 0.5
        f *= 2.0
    return tot / norm


# ---------------------------------------------------------------------------
# Stream
# ---------------------------------------------------------------------------

EXTRA_DOWNSTREAM = [
    # continue the valley to the sea (shapes the far terrain only)
    (-7.0, 160.0, 0.20, 6.0, 0.5),
    (-3.0, 230.0, -0.6, 8.0, 0.6),
    (6.0, 320.0, -1.6, 12.0, 0.8),
    (12.0, 420.0, -3.0, 24.0, 1.5),
    (16.0, 560.0, -5.0, 60.0, 3.0),
]


def catmull(p0, p1, p2, p3, t):
    t2, t3 = t * t, t * t * t
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                  + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)


def sample_stream(ctrl, step=0.25):
    C = np.array(ctrl, np.float64)
    n = len(C)
    pts = []
    for i in range(n - 1):
        p0 = C[max(i - 1, 0)]
        p1 = C[i]
        p2 = C[i + 1]
        p3 = C[min(i + 2, n - 1)]
        seg_len = np.hypot(*(p2[:2] - p1[:2]))
        k = max(2, int(seg_len / 0.05))
        for j in range(k):
            t = j / k
            xz = catmull(p0[:2], p1[:2], p2[:2], p3[:2], t)
            w = catmull(p0[3], p1[3], p2[3], p3[3], t)
            d = catmull(p0[4], p1[4], p2[4], p3[4], t)
            # water level: monotone S-curve between control points (sharp cascades)
            s = t * t * (3 - 2 * t)
            y = p1[2] + (p2[2] - p1[2]) * s
            pts.append((xz[0], xz[1], y, max(w, 2.0), max(d, 0.15)))
    pts.append(tuple(C[-1]))
    P = np.array(pts)
    seg = np.hypot(np.diff(P[:, 0]), np.diff(P[:, 1]))
    s = np.concatenate([[0], np.cumsum(seg)])
    total = s[-1]
    ss = np.arange(0, total, step)
    out = np.stack([np.interp(ss, s, P[:, k]) for k in range(5)], 1)
    tx = np.gradient(out[:, 0])
    tz = np.gradient(out[:, 1])
    tl = np.hypot(tx, tz) + 1e-9
    tx, tz = tx / tl, tz / tl
    # signed curvature (positive = turning towards +side)
    ang = np.unwrap(np.arctan2(tz, tx))
    curv = np.gradient(ang) / step
    from scipy.ndimage import gaussian_filter1d

    curv = gaussian_filter1d(curv, 24)
    return dict(x=out[:, 0], z=out[:, 1], y=out[:, 2], w=out[:, 3], d=out[:, 4], s=ss, tx=tx, tz=tz,
                curv=curv)


STREAM_ALL = None


def stream_all():
    global STREAM_ALL
    if STREAM_ALL is None:
        STREAM_ALL = sample_stream(W.STREAM + EXTRA_DOWNSTREAM, 0.25)
    return STREAM_ALL


def stream_query(X, Z):
    from scipy.spatial import cKDTree

    S = stream_all()
    tree = cKDTree(np.stack([S["x"], S["z"]], 1))
    q = np.stack([np.ravel(X), np.ravel(Z)], 1)
    # pick the sample whose channel EDGE is closest (min over k nearest of
    # dist - half_width). Using the nearest centre sample instead makes the
    # terrain jump where the channel width changes quickly (pool outlet).
    k = 48
    dk, ik = tree.query(q, k=k, workers=-1)
    edge = dk - S["w"][ik] * 0.5
    j = np.argmin(edge, axis=1)
    # smooth minimum of the edge distance (removes ridge-like kinks where the
    # closest sample switches far away from the water)
    tau = 1.5
    emin = edge.min(axis=1)
    soft_edge = emin - tau * np.log(np.exp(-(edge - emin[:, None]) / tau).sum(axis=1)) + tau * math.log(1.0)
    rows = np.arange(len(q))
    idx = ik[rows, j]
    dist = dk[rows, j]
    ox = q[:, 0] - S["x"][idx]
    oz = q[:, 1] - S["z"][idx]
    cross = S["tx"][idx] * oz - S["tz"][idx] * ox
    side = -np.sign(cross)  # +1 = east bank for a south-flowing stream
    side[side == 0] = 1
    shp = np.shape(X)
    return {k: v.reshape(shp) for k, v in dict(
        dist=dist, idx=idx, side=side, soft_edge=soft_edge,
        wy=S["y"][idx], w=S["w"][idx], dep=S["d"][idx], s=S["s"][idx],
        curv=S["curv"][idx]).items()}


# ---------------------------------------------------------------------------
# Polylines helpers
# ---------------------------------------------------------------------------

def densify(poly, step=0.25):
    P = np.array(poly, np.float64)
    seg = np.hypot(np.diff(P[:, 0]), np.diff(P[:, 1]))
    s = np.concatenate([[0], np.cumsum(seg)])
    ss = np.arange(0, s[-1] + 1e-6, step)
    return np.stack([np.interp(ss, s, P[:, 0]), np.interp(ss, s, P[:, 1])], 1), ss


def poly_distance(X, Z, poly, step=0.25):
    from scipy.spatial import cKDTree

    D, ss = densify(poly, step)
    tree = cKDTree(D)
    q = np.stack([np.ravel(X), np.ravel(Z)], 1)
    dist, idx = tree.query(q)
    return dist.reshape(np.shape(X)), ss[idx].reshape(np.shape(X)), idx.reshape(np.shape(X))


def house_frame():
    H = W.HOUSE
    a = math.radians(H["yaw_deg"])
    return H["x"], H["z"], math.cos(a), math.sin(a)


def rect_distance(X, Z, cx, cz, ca, sa, hw, hd):
    """Distance to a rotated rectangle (0 inside). yaw rotates local x->world."""
    dx, dz = X - cx, Z - cz
    # local axes match blender/architecture.py Frame: ex = (cos, -sin), ez = (sin, cos) in (x, z)
    lx = dx * ca - dz * sa
    lz = dx * sa + dz * ca
    qx = np.abs(lx) - hw
    qz = np.abs(lz) - hd
    return np.hypot(np.maximum(qx, 0), np.maximum(qz, 0)) + np.minimum(np.maximum(qx, qz), 0)


# ---------------------------------------------------------------------------
# Height function
# ---------------------------------------------------------------------------

def stream_x_at(Z):
    """Stream x as a function of z (the stream runs monotonically north->south)."""
    S = stream_all()
    return np.interp(Z, S["z"], S["x"])


_YZ = None


def stream_y_at(Z):
    """Water level as a smooth function of z (cascades blurred out), used for
    the valley floor away from the water so cascades don't leave steps."""
    global _YZ
    if _YZ is None:
        from scipy.ndimage import gaussian_filter1d

        S = stream_all()
        zz = np.arange(S["z"].min() - 50, S["z"].max() + 50, 0.5)
        yy = np.interp(zz, S["z"], S["y"])
        _YZ = (zz, gaussian_filter1d(yy, 30))
    return np.interp(Z, _YZ[0], _YZ[1])


def height_field(X, Z, detail=True):
    q = stream_query(X, Z)
    ad = q["dist"]
    wy, half, dep, s = q["wy"], q["w"] * 0.5, q["dep"], q["s"]
    # continuous side (+1 east, -1 west): the nearest-sample side flips on medial
    # axes far from the stream, which would leave seams in the terrain
    side = np.tanh((X - stream_x_at(Z)) / (4.0 + 0.6 * np.maximum(ad - half, 0)))
    # soft edge distance blends into the hard one near the water
    e_hard = np.maximum(ad - half, 0)
    e_raw = np.maximum(e_hard + (np.maximum(q["soft_edge"], 0) - e_hard) * smoothstep(4.0, 12.0, e_hard), 0)
    # longitudinal base level: nearest sample near the water, smooth function of z away from it
    wy = wy + (stream_y_at(Z) - wy) * smoothstep(2.0, 18.0, e_raw)

    # Bank height and width vary along the stream and between sides. Outer
    # banks of bends are steep and high, inner banks are low gravel bars.
    curv = q["curv"]
    near = smoothstep(14.0, 3.0, e_raw)  # bank character only matters close to the water
    outer = np.clip(-curv * side * 9.0, -1, 1) * near  # +1 on the outer bank
    bn = fbm(s / 14.0 + side * 37.0, side * 11.0, 3, seed=5) * near
    bankH = 1.25 + 0.55 * bn + 0.45 * outer
    bankW = 2.2 + 0.9 * fbm(s / 9.0 + side * 13.0, 3.3, 2, seed=6) * near - 0.6 * outer
    # meadow on the west side of the pool, higher banks near the culvert
    near_culvert = smoothstep(16.0, 2.0, s) * smoothstep(-6.0, -14.0, Z) * near
    bankH = bankH + near_culvert * 1.4
    pool = smoothstep(9.0, 3.0, np.hypot(X - 3.0, Z - 46.0) - 6.0)
    bankH = bankH * (1 - 0.45 * pool * smoothstep(0.3, -0.6, side))
    bankH = np.clip(bankH, 0.35, 3.2)
    bankW = np.clip(bankW, 1.0, 4.0)

    # channel profile: flat-ish bed rising to the water line at the edge
    t = np.clip(ad / half, 0, 1.5)
    bed = wy - dep * (1 - smoothstep(0.45, 1.0, t) ** 1.2) + 0.04 * (t > 1.0)
    # bank: from waterline to bank top
    e1 = np.clip((ad - half) / bankW, 0, 1)
    bank_curve = np.power(e1, 0.85) * (1 - 0.35 * e1 * (1 - e1))
    y_bank = wy + 0.03 + bankH * bank_curve
    # valley floor beyond the bank top
    e = np.maximum(e_raw - bankW, 0)
    steep = 1.02 + 0.13 * side  # east side (house) is a bit steeper
    raw = (0.07 * e + 0.0042 * e * e) * steep
    rise = 46.0 * (1 - np.exp(-raw / 46.0))
    y_valley = wy + bankH + rise
    y = np.where(ad < half, bed, np.where(ad < half + bankW, y_bank, y_valley))

    # hills / mid noise grows with distance from the stream
    far = smoothstep(6.0, 60.0, e)
    mid = smoothstep(1.0, 12.0, e)
    y = y + fbm(X / 80.0, Z / 80.0, 5, seed=11) * 9.0 * far
    y = y + ridged(X / 140.0 + 3.1, Z / 140.0, 4, seed=12) * 10.0 * far
    y = y + fbm(X / 22.0, Z / 22.0, 4, seed=13) * 1.3 * mid
    if detail:
        y = y + fbm(X / 4.0, Z / 4.0, 3, seed=14) * 0.12 * smoothstep(0.0, 1.0, ad - half)
        y = y + fbm(X / 1.3, Z / 1.3, 2, seed=15) * 0.035 * (ad > half)

    # ---- North: culvert embankment and the plateau road -------------------
    C = W.CULVERT
    top = C["top"]
    # everything north of the wall face is filled up to the road level and then
    # rises gently into the northern hills
    north = Z < C["z"] - 0.05
    hill_n = top + np.maximum(0, (W.ROAD["z0"] - 1.0) - Z) * 0.22 + fbm(X / 30, Z / 30, 3, seed=21) * 0.8 * \
        smoothstep(W.ROAD["z0"] - 1.0, W.ROAD["z0"] - 12.0, Z)
    y = np.where(north, np.maximum(y, hill_n), y)
    # road surface: flat at road level between z0..z1
    road = smoothstep(W.ROAD["z0"] - 2.0, W.ROAD["z0"], Z) * smoothstep(W.ROAD["z1"] + 0.8, W.ROAD["z1"], Z) \
        * smoothstep(17.0, 11.0, np.abs(X - 2.0))
    y = np.where(north, y * (1 - road) + (top - 0.05) * road, y)
    # wing slopes south of the wall: rise to the wall top away from the channel
    dxw = np.abs(X - C["x"])
    wing = smoothstep(half + 0.9, half + 3.5, dxw)
    south_of_wall = Z >= C["z"] - 0.05
    wing_y = top - np.maximum(Z - C["z"], 0) * 0.85 - smoothstep(C["half_width"] - 1.0, C["half_width"] + 9.0, dxw) * 0.0
    y = np.where(south_of_wall & (Z < C["z"] + 9.0), np.maximum(y, wing_y * wing + y * (1 - wing)), y)

    # ---- House plateau ---------------------------------------------------
    hx, hz, ca, sa = house_frame()
    hd = rect_distance(X, Z, hx, hz, ca, sa, W.HOUSE["w"] * 0.5 + 1.6, W.HOUSE["d"] * 0.5 + 1.6)
    k = smoothstep(4.0, 0.0, hd)
    y = y * (1 - k) + W.HOUSE["ground"] * k

    return y, q


height_field_cache = {}


def flatten_features(Y, X, Z, q):
    """Second pass: flatten paths, the deck site, stairs. Needs a first-pass Y."""
    from scipy.ndimage import gaussian_filter, map_coordinates

    res = Y.shape[0]
    size = W.TERRAIN["size"]
    cell = size / (res - 1)

    def sample(x, z):
        gx = (np.atleast_1d(np.asarray(x, np.float64)) + size / 2) / cell
        gz = (np.atleast_1d(np.asarray(z, np.float64)) + size / 2) / cell
        return map_coordinates(Y, [gz, gx], order=1, mode="nearest")

    # paths: profile = smoothed terrain along the path, flattened across
    for poly, hw in ((W.PATH_EAST, 0.85), (W.PATH_WEST, 0.75), (W.ROAD_PATH, 1.1)):
        D, ss = densify(poly, 0.25)
        prof = sample(D[:, 0], D[:, 1])
        from scipy.ndimage import gaussian_filter1d

        prof = gaussian_filter1d(prof, 6)
        dist, sidx, idx = poly_distance(X, Z, poly)
        target = prof[idx] - 0.04
        k = smoothstep(hw + 1.6, hw, dist)
        # never flatten into the stream channel
        k *= smoothstep(q["w"] * 0.5 + 0.4, q["w"] * 0.5 + 1.6, q["dist"])
        Y = Y * (1 - k) + target * k

    # deck: level ground under the deck
    D = W.DECK
    dd = np.hypot(X - D["x"], Z - D["z"])
    lvl = float(sample(D["x"], D["z"])[0])
    k = smoothstep(4.2, 2.4, dd)
    Y = Y * (1 - k) + lvl * k
    height_field_cache["deck_level"] = lvl

    # stairs: straight ramp under the stone steps
    (tx, tz), (bx, bz) = W.STAIRS["top"], W.STAIRS["bottom"]
    vx, vz = bx - tx, bz - tz
    L = math.hypot(vx, vz)
    ux, uz = vx / L, vz / L
    lx = (X - tx) * ux + (Z - tz) * uz
    lz = -(X - tx) * uz + (Z - tz) * ux
    ytop = W.ROAD["y"] - 0.05
    ybot = float(sample(bx + ux * 1.2, bz + uz * 1.2)[0])
    ramp = ytop + (ybot - ytop) * np.clip(lx / L, 0, 1)
    k = smoothstep(1.6, 0.9, np.abs(lz)) * smoothstep(-0.8, 0.0, lx) * smoothstep(L + 1.4, L, lx)
    Y = Y * (1 - k) + ramp * k
    height_field_cache["stairs"] = dict(ytop=ytop, ybot=ybot)

    Y = gaussian_filter(Y, 0.6)
    # keep the water channel below the water surface after smoothing
    inside = q["dist"] < q["w"] * 0.5 * 0.92
    Y = np.where(inside, np.minimum(Y, q["wy"] - 0.08), Y)
    return Y


# ---------------------------------------------------------------------------
# Splat / masks
# ---------------------------------------------------------------------------

def compute_masks(Y, X, Z, q, tree_xz):
    res = Y.shape[0]
    size = W.TERRAIN["size"]
    cell = size / (res - 1)
    gy, gx = np.gradient(Y, cell)
    slope = np.hypot(gx, gy)
    ad, half, wy = q["dist"], q["w"] * 0.5, q["wy"]
    above = Y - wy

    n1 = fbm(X / 3.0, Z / 3.0, 3, seed=101)
    n2 = fbm(X / 11.0, Z / 11.0, 3, seed=102)

    # riverbed / gravel: inside channel and low gravel bars near the water
    river = smoothstep(half + 0.9 + 0.5 * n1, half + 0.1, ad)
    bars = smoothstep(0.35 + 0.15 * n1, 0.05, above) * smoothstep(half + 3.0, half, ad)
    riverbed = np.clip(np.maximum(river, bars), 0, 1)

    # path dirt
    path = 0.0
    for poly, hw in ((W.PATH_EAST, 0.75), (W.PATH_WEST, 0.6), (W.ROAD_PATH, 1.15)):
        d, _, _ = poly_distance(X, Z, poly)
        path = np.maximum(path, smoothstep(hw + 0.35 + 0.25 * n1, hw - 0.25, d))
    # trampled area on the house plateau
    hx, hz, ca, sa = house_frame()
    hd = rect_distance(X, Z, hx, hz, ca, sa, W.HOUSE["w"] * 0.5 + 0.9, W.HOUSE["d"] * 0.5 + 0.9)
    path = np.maximum(path, smoothstep(1.4 + 0.6 * n1, 0.0, hd) * 0.9)

    # forest floor under tree canopies
    from scipy.spatial import cKDTree

    canopy = np.zeros_like(Y)
    if len(tree_xz):
        tr = cKDTree(np.asarray(tree_xz))
        q2 = np.stack([X.ravel(), Z.ravel()], 1)
        cnt = np.array([len(x) for x in tr.query_ball_point(q2, 6.5, workers=-1)]).reshape(Y.shape)
        dmin, _ = tr.query(q2)
        dmin = dmin.reshape(Y.shape)
        canopy = np.clip(smoothstep(6.5, 2.0, dmin) * 0.7 + np.clip(cnt / 4.0, 0, 1) * 0.6, 0, 1)
    forest = np.clip(canopy + 0.25 * n2, 0, 1) * (1 - riverbed) * (1 - path)

    # exposed rock: steep slopes and some outcrops
    rock = smoothstep(0.85, 1.4, slope + 0.25 * n1) * (1 - riverbed * 0.7)

    grass = np.clip(1 - riverbed - path - forest, 0, 1)
    tot = grass + path + riverbed + forest + 1e-6
    splat = np.stack([grass / tot, path / tot, riverbed / tot, forest / tot], 2)

    # density masks
    wet = smoothstep(1.2, 0.0, above) * smoothstep(half + 4.5, half, ad)
    grass_density = grass / tot * (1 - rock) * smoothstep(0.08, 0.3, above) * (1 - 0.6 * smoothstep(0.3, 1.0, canopy))
    grass_density *= 0.75 + 0.25 * smoothstep(-0.6, 0.6, n2)
    flowers = grass_density * smoothstep(0.25, 0.75, fbm(X / 7.0 + 5, Z / 7.0, 3, seed=103)) * \
        (0.4 + 0.6 * smoothstep(half + 8, half + 1.5, ad))
    masks = np.stack([np.clip(grass_density, 0, 1), np.clip(flowers, 0, 1), np.clip(wet, 0, 1),
                      np.clip(rock, 0, 1)], 2)
    return splat, masks, slope


# ---------------------------------------------------------------------------
# Placement
# ---------------------------------------------------------------------------

def poisson(x0, x1, z0, z1, r, seed, k=20):
    """Bridson Poisson-disk sampling in a rectangle."""
    rnd = np.random.default_rng(seed)
    cell = r / math.sqrt(2)
    gw = int(math.ceil((x1 - x0) / cell))
    gh = int(math.ceil((z1 - z0) / cell))
    grid = -np.ones((gh, gw), np.int64)
    pts = []
    active = []
    p = (rnd.uniform(x0, x1), rnd.uniform(z0, z1))
    pts.append(p)
    active.append(0)
    grid[int((p[1] - z0) / cell), int((p[0] - x0) / cell)] = 0
    while active:
        ai = rnd.integers(len(active))
        px, pz = pts[active[ai]]
        found = False
        for _ in range(k):
            a = rnd.uniform(0, 2 * math.pi)
            rr = rnd.uniform(r, 2 * r)
            nx, nz = px + rr * math.cos(a), pz + rr * math.sin(a)
            if not (x0 <= nx < x1 and z0 <= nz < z1):
                continue
            gx, gz = int((nx - x0) / cell), int((nz - z0) / cell)
            ok = True
            for j in range(max(gz - 2, 0), min(gz + 3, gh)):
                for i in range(max(gx - 2, 0), min(gx + 3, gw)):
                    o = grid[j, i]
                    if o >= 0:
                        ox, oz = pts[o]
                        if (ox - nx) ** 2 + (oz - nz) ** 2 < r * r:
                            ok = False
                            break
                if not ok:
                    break
            if ok:
                pts.append((nx, nz))
                grid[gz, gx] = len(pts) - 1
                active.append(len(pts) - 1)
                found = True
                break
        if not found:
            active.pop(ai)
    return np.array(pts)


class Field:
    """Bilinear sampler over the near grid."""

    def __init__(self, Y):
        self.Y = Y
        self.res = Y.shape[0]
        self.size = W.TERRAIN["size"]
        self.cell = self.size / (self.res - 1)

    def __call__(self, x, z):
        from scipy.ndimage import map_coordinates

        gx = (np.asarray(x, np.float64) + self.size / 2) / self.cell
        gz = (np.asarray(z, np.float64) + self.size / 2) / self.cell
        return map_coordinates(self.Y, [np.atleast_1d(gz), np.atleast_1d(gx)], order=1, mode="nearest")


def exclusion(x, z, q):
    """Return distance-like clearance used to keep vegetation off paths etc."""
    x = np.asarray(x)
    z = np.asarray(z)
    clear = np.full(x.shape, 99.0)
    for poly in (W.PATH_EAST, W.PATH_WEST, W.ROAD_PATH):
        d, _, _ = poly_distance(x, z, poly)
        clear = np.minimum(clear, d)
    hx, hz, ca, sa = house_frame()
    clear = np.minimum(clear, rect_distance(x, z, hx, hz, ca, sa, W.HOUSE["w"] * 0.5 + 1.2, W.HOUSE["d"] * 0.5 + 1.2))
    clear = np.minimum(clear, np.hypot(x - W.DECK["x"], z - W.DECK["z"]) - 2.6)
    # culvert wall and the area in front of it
    C = W.CULVERT
    inwall = (np.abs(x - C["x"]) < C["half_width"] + 1.0) & (z > C["z"] - C["thickness"] - 1.5) & (z < C["z"] + 3.0)
    clear = np.where(inwall, -1.0, clear)
    return clear


def build_layout(Y, field, X, Z, q, slope):
    rnd = np.random.default_rng(2024)
    size = W.TERRAIN["size"]
    half_size = size / 2 - 2

    # ---------------- trees -------------------------------------------------
    pts = poisson(-half_size, half_size, -half_size, half_size, 5.2, 7)
    sq = stream_query(pts[:, 0], pts[:, 1])
    e = sq["dist"] - sq["w"] * 0.5
    clear = exclusion(pts[:, 0], pts[:, 1], sq)
    # meadow corridor near the stream inside the playable area is kept open
    inplay = (pts[:, 0] > W.PLAYABLE["x0"]) & (pts[:, 0] < W.PLAYABLE["x1"]) & \
             (pts[:, 1] > W.PLAYABLE["z0"]) & (pts[:, 1] < W.PLAYABLE["z1"])
    dens = np.where(inplay, smoothstep(9.0, 26.0, e) * 0.85 + 0.06, smoothstep(5.0, 14.0, e) * 0.95)
    n = fbm(pts[:, 0] / 25.0, pts[:, 1] / 25.0, 3, seed=301)
    dens *= np.clip(0.75 + 0.6 * n, 0, 1)
    keep = (rnd.random(len(pts)) < dens) & (clear > 3.0) & (e > 3.5)
    # keep the far road on the plateau clear
    keep &= ~((pts[:, 1] > W.ROAD["z0"] - 1.5) & (pts[:, 1] < W.ROAD["z1"] + 1.0))
    T = pts[keep]
    trees = []
    weights = np.array([0.34, 0.3, 0.22, 0.14])
    for (x, z) in T:
        v = int(rnd.choice(4, p=weights))
        s = float(rnd.uniform(0.78, 1.22))
        trees.append(dict(v=v, p=[round(float(x), 3), round(float(field(x, z)[0]), 3), round(float(z), 3)],
                          yaw=round(float(rnd.uniform(0, 360)), 1), s=round(s, 3)))
    for (x, z, v, s, yaw) in W.HERO_TREES:
        trees.append(dict(v=v, p=[x, round(float(field(x, z)[0]), 3), z], yaw=yaw, s=s, hero=True))
    log("trees", len(trees))

    # ---------------- rocks -------------------------------------------------
    rocks = []
    S = stream_all()
    s_end = 150.0
    idx = np.nonzero(S["s"] < s_end)[0]
    # in-stream boulders
    s_pos = 2.0
    while s_pos < s_end:
        i = int(np.searchsorted(S["s"], s_pos))
        if i >= len(S["s"]):
            break
        cx, cz, wy, w = S["x"][i], S["z"][i], S["y"][i], S["w"][i]
        nx, nz = -S["tz"][i], S["tx"][i]
        off = rnd.uniform(-0.5, 0.5) * w * 0.9
        x, z = cx + nx * off, cz + nz * off
        size_m = float(rnd.uniform(0.45, 1.25))
        rocks.append(dict(v=int(rnd.integers(0, 6)), p=[round(float(x), 3), round(float(field(x, z)[0]), 3), round(float(z), 3)],
                          yaw=round(float(rnd.uniform(0, 360)), 1), size=round(size_m, 3),
                          sink=round(float(rnd.uniform(0.25, 0.45)), 3), squash=round(float(rnd.uniform(0.55, 0.85)), 3)))
        s_pos += float(rnd.uniform(1.6, 3.4))
    # cascade weirs: a line of rocks across each lip
    for (lx, lz) in ((-2.8, -7.0), (2.5, 5.0), (6.0, 57.0)):
        sq = stream_query(np.array([lx]), np.array([lz]))
        i = int(sq["idx"][0])
        nx, nz = -S["tz"][i], S["tx"][i]
        w = S["w"][i]
        for o in np.linspace(-0.55, 0.55, 5):
            x = lx + nx * o * w + rnd.normal(0, 0.15)
            z = lz + nz * o * w + rnd.normal(0, 0.15)
            rocks.append(dict(v=int(rnd.integers(0, 6)), p=[round(float(x), 3), round(float(field(x, z)[0]), 3), round(float(z), 3)],
                              yaw=round(float(rnd.uniform(0, 360)), 1), size=round(float(rnd.uniform(0.7, 1.3)), 3),
                              sink=0.35, squash=round(float(rnd.uniform(0.55, 0.8)), 3)))
    # bank boulders in clusters
    s_pos = 3.0
    while s_pos < s_end:
        i = int(np.searchsorted(S["s"], s_pos))
        if i >= len(S["s"]):
            break
        side = rnd.choice([-1, 1])
        nx, nz = S["tz"][i] * side, -S["tx"][i] * side
        base_off = S["w"][i] * 0.5 + rnd.uniform(-0.3, 1.8)
        for k in range(int(rnd.integers(1, 4))):
            off = base_off + rnd.uniform(-0.6, 1.4)
            along = rnd.uniform(-1.5, 1.5)
            x = S["x"][i] + nx * off + S["tx"][i] * along
            z = S["z"][i] + nz * off + S["tz"][i] * along
            if exclusion(np.array([x]), np.array([z]), None)[0] < 1.0:
                continue
            size_m = float(rnd.uniform(1.0, 2.2) if k == 0 else rnd.uniform(0.35, 0.9))
            rocks.append(dict(v=int(rnd.integers(0, 8)), p=[round(float(x), 3), round(float(field(x, z)[0]), 3), round(float(z), 3)],
                              yaw=round(float(rnd.uniform(0, 360)), 1), size=round(size_m, 3),
                              sink=round(float(rnd.uniform(0.2, 0.4)), 3), squash=round(float(rnd.uniform(0.55, 0.9)), 3)))
        s_pos += float(rnd.uniform(3.0, 7.0))
    # hillside rocks
    hp = poisson(-half_size, half_size, -half_size, half_size, 8.0, 9)
    sq = stream_query(hp[:, 0], hp[:, 1])
    e = sq["dist"] - sq["w"] * 0.5
    nn = fbm(hp[:, 0] / 30.0, hp[:, 1] / 30.0, 2, seed=55)
    keep = (rnd.random(len(hp)) < 0.28 + 0.3 * nn) & (e > 4.0) & (exclusion(hp[:, 0], hp[:, 1], sq) > 1.5)
    for (x, z) in hp[keep]:
        rocks.append(dict(v=int(rnd.integers(0, 8)), p=[round(float(x), 3), round(float(field(x, z)[0]), 3), round(float(z), 3)],
                          yaw=round(float(rnd.uniform(0, 360)), 1), size=round(float(rnd.uniform(0.4, 2.0)), 3),
                          sink=round(float(rnd.uniform(0.25, 0.5)), 3), squash=round(float(rnd.uniform(0.5, 0.95)), 3)))
    # stepping stones (flat, tops just above the water)
    stepping = []
    for (x, z) in W.STEPPING_STONES:
        sq = stream_query(np.array([x]), np.array([z]))
        top = float(sq["wy"][0]) + 0.16
        stepping.append(dict(v=6 + int(rnd.integers(0, 2)), p=[x, round(float(field(x, z)[0]), 3), z],
                             top=round(top, 3), yaw=round(float(rnd.uniform(0, 360)), 1),
                             size=round(float(rnd.uniform(0.75, 0.95)), 3)))
    log("rocks", len(rocks), "stepping", len(stepping))

    # ---------------- bushes / ferns / reeds ---------------------------------
    bp = poisson(-half_size, half_size, -half_size, half_size, 3.2, 13)
    sq = stream_query(bp[:, 0], bp[:, 1])
    e = sq["dist"] - sq["w"] * 0.5
    clr = exclusion(bp[:, 0], bp[:, 1], sq)
    from scipy.spatial import cKDTree

    ttree = cKDTree(np.array([t["p"][0::2] for t in trees]))
    dt, _ = ttree.query(bp)
    edge = smoothstep(6.0, 12.0, e) * smoothstep(30.0, 14.0, e)  # forest edge band
    bank = smoothstep(1.0, 2.5, e) * smoothstep(5.0, 3.0, e)
    p_bush = 0.08 + 0.55 * edge + 0.25 * bank + 0.25 * smoothstep(9.0, 4.0, dt)
    keep = (rnd.random(len(bp)) < p_bush) & (clr > 2.0) & (e > 1.2)
    bushes = []
    for (x, z) in bp[keep]:
        bushes.append(dict(v=int(rnd.integers(0, 2)), p=[round(float(x), 3), round(float(field(x, z)[0]), 3), round(float(z), 3)],
                           yaw=round(float(rnd.uniform(0, 360)), 1), s=round(float(rnd.uniform(0.6, 1.3)), 3)))
    fp = poisson(-half_size, half_size, -half_size, half_size, 2.0, 17)
    sq = stream_query(fp[:, 0], fp[:, 1])
    e = sq["dist"] - sq["w"] * 0.5
    dt, _ = ttree.query(fp)
    clr = exclusion(fp[:, 0], fp[:, 1], sq)
    C = W.CULVERT
    near_wall = (np.abs(fp[:, 0] - C["x"]) < C["half_width"] + 2) & (fp[:, 1] > C["z"]) & (fp[:, 1] < C["z"] + 5)
    p_fern = 0.4 * smoothstep(6.0, 2.0, dt) * smoothstep(1.5, 4.0, e) + 0.5 * near_wall * smoothstep(0.6, 1.4, e)
    keep = (rnd.random(len(fp)) < p_fern) & ((clr > 1.2) | near_wall) & (e > 0.6)
    ferns = []
    for (x, z) in fp[keep]:
        ferns.append(dict(p=[round(float(x), 3), round(float(field(x, z)[0]), 3), round(float(z), 3)],
                          yaw=round(float(rnd.uniform(0, 360)), 1), s=round(float(rnd.uniform(0.7, 1.25)), 3)))
    # reeds along slow water (pool, lower reaches)
    reeds = []
    for i in range(0, len(S["s"]), 6):
        if S["s"][i] > s_end:
            break
        slow = S["w"][i] > 6.0 or S["s"][i] > 92.0 or (55.0 < S["s"][i] < 62.0)
        if not slow or rnd.random() > 0.35:
            continue
        side = rnd.choice([-1, 1])
        nx, nz = -S["tz"][i] * side, S["tx"][i] * side
        off = S["w"][i] * 0.5 + rnd.uniform(-0.6, 0.5)
        x, z = S["x"][i] + nx * off, S["z"][i] + nz * off
        if exclusion(np.array([x]), np.array([z]), None)[0] < 1.0:
            continue
        reeds.append(dict(p=[round(float(x), 3), round(float(field(x, z)[0]), 3), round(float(z), 3)],
                          yaw=round(float(rnd.uniform(0, 360)), 1), s=round(float(rnd.uniform(0.7, 1.2)), 3)))
    log("bushes", len(bushes), "ferns", len(ferns), "reeds", len(reeds))

    # ---------------- fences -------------------------------------------------
    fences = []
    D, ss = densify(W.PATH_EAST, 0.5)
    sq = stream_query(D[:, 0], D[:, 1])
    run = []
    for j in range(len(D)):
        tx = D[min(j + 1, len(D) - 1), 0] - D[max(j - 1, 0), 0]
        tz = D[min(j + 1, len(D) - 1), 1] - D[max(j - 1, 0), 1]
        L = math.hypot(tx, tz) + 1e-9
        nx, nz = -tz / L, tx / L
        # choose the side facing the stream
        px, pz = D[j, 0] + nx, D[j, 1] + nz
        mx, mz = D[j, 0] - nx, D[j, 1] - nz
        dp = stream_query(np.array([px, mx]), np.array([pz, mz]))["dist"]
        sgn = 1 if dp[0] < dp[1] else -1
        fx, fz = D[j, 0] + nx * sgn * 1.05, D[j, 1] + nz * sgn * 1.05
        sj = ss[j]
        on = (9.0 < sj < ss[-1] - 4.5)  # skip the house front and the stairs
        if on:
            run.append([round(float(fx), 3), round(float(fz), 3)])
        elif len(run) > 3:
            fences.append(run)
            run = []
        else:
            run = []
    if len(run) > 3:
        fences.append(run)

    # ---------------- lanterns ------------------------------------------------
    lanterns = [dict(p=[x, round(float(field(x, z)[0]), 3), z]) for (x, z) in W.LANTERNS]

    return dict(trees=trees, rocks=rocks, stepping=stepping, bushes=bushes, ferns=ferns, reeds=reeds,
                fences=fences, lanterns=lanterns)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def compute():
    T = W.TERRAIN
    size, res = T["size"], T["res"]
    xs = np.linspace(-size / 2, size / 2, res)
    X, Z = np.meshgrid(xs, xs)
    log("height field", res, "x", res)
    Y, q = height_field(X, Z)
    Y = flatten_features(Y, X, Z, q)
    field = Field(Y)

    # far terrain (same function, coarser) + distant mountains, sinking to the sea in the south
    fs, fr = T["far_size"], T["far_res"]
    fx = np.linspace(-fs / 2, fs / 2, fr)
    FX, FZ = np.meshgrid(fx, fx)
    FY, fq = height_field(FX, FZ, detail=False)
    r = np.hypot(FX, FZ)
    mount = smoothstep(180.0, 700.0, r) * (ridged(FX / 260.0, FZ / 260.0, 5, seed=401) * 120.0 + 10.0)
    southness = smoothstep(150.0, 520.0, FZ) * smoothstep(260.0, 60.0, np.abs(FX - 10.0))
    FY = FY + mount * (1 - southness)
    FY = np.where(southness > 0, FY * (1 - southness) + (-6.0 + fbm(FX / 60, FZ / 60, 3, seed=402) * 3.0) * southness, FY)
    # inside the near square use the near heights exactly (border continuity)
    inside = (np.abs(FX) <= size / 2) & (np.abs(FZ) <= size / 2)
    FY = np.where(inside, field(FX.ravel(), FZ.ravel()).reshape(FY.shape) - 0.15, FY)

    # water level field (1 m grid)
    wres = 257
    wx = np.linspace(-size / 2, size / 2, wres)
    WX, WZ = np.meshgrid(wx, wx)
    wq = stream_query(WX, WZ)
    WL = wq["wy"].astype(np.float32)

    lay = build_layout(Y, field, X, Z, q, None)
    tree_xz = [(t["p"][0], t["p"][2]) for t in lay["trees"]]
    splat, masks, slope = compute_masks(Y, X, Z, q, tree_xz)
    return dict(X=X, Z=Z, Y=Y, q=q, FY=FY, WL=WL, splat=splat, masks=masks, layout=lay, field=field)


def write_outputs(R):
    from PIL import Image

    T = W.TERRAIN
    Y = R["Y"].astype(np.float32)
    Y.tofile(os.path.join(DATA_DIR, "terrain_height.bin"))
    R["FY"].astype(np.float32).tofile(os.path.join(DATA_DIR, "terrain_far.bin"))
    R["WL"].tofile(os.path.join(DATA_DIR, "water_level.bin"))
    meta = dict(size=T["size"], res=T["res"], farSize=T["far_size"], farRes=T["far_res"],
                waterRes=int(R["WL"].shape[0]), minY=float(Y.min()), maxY=float(Y.max()),
                seaLevel=-1.2)
    with open(os.path.join(DATA_DIR, "terrain.json"), "w") as f:
        json.dump(meta, f, indent=2)

    def img(a, path):
        # resample res x res (vertex grid) to 512 x 512 pixel centres
        from scipy.ndimage import map_coordinates

        n = 512
        res = a.shape[0]
        c = (np.arange(n) + 0.5) / n * (res - 1)
        GZ, GX = np.meshgrid(c, c, indexing="ij")
        ch = [map_coordinates(a[:, :, k], [GZ, GX], order=1) for k in range(a.shape[2])]
        out = np.clip(np.stack(ch, 2) * 255 + 0.5, 0, 255).astype(np.uint8)
        Image.fromarray(out, "RGBA").save(path, optimize=True)
        log("wrote", os.path.relpath(path, ROOT))

    img(R["splat"], os.path.join(TEX_DIR, "splat.png"))
    img(R["masks"], os.path.join(TEX_DIR, "masks.png"))

    # dense stream samples for the water surface (playable part only)
    S = stream_all()
    keep = S["s"] <= 168.0
    step = 2  # 0.5 m
    st = dict(step=0.5, points=[[round(float(S["x"][i]), 3), round(float(S["y"][i]), 3), round(float(S["z"][i]), 3),
                                 round(float(S["w"][i]), 3), round(float(S["d"][i]), 3)]
                                for i in np.nonzero(keep)[0][::step]])
    with open(os.path.join(DATA_DIR, "stream.json"), "w") as f:
        json.dump(st, f, separators=(",", ":"))

    lay = R["layout"]
    D = W.DECK
    lay.update(dict(
        start=W.START,
        playable=W.PLAYABLE,
        culvert=W.CULVERT,
        road=W.ROAD,
        house=W.HOUSE,
        deck=dict(D, level=round(float(height_field_cache.get("deck_level", 0.0)), 3)),
        stairs=dict(W.STAIRS, **height_field_cache.get("stairs", {})),
        paths=dict(east=W.PATH_EAST, west=W.PATH_WEST, road=W.ROAD_PATH),
        pool=dict(x=3.0, z=46.0, y=4.15, r=6.5),
    ))
    with open(os.path.join(DATA_DIR, "layout.json"), "w") as f:
        json.dump(lay, f, separators=(",", ":"))
    log("wrote layout:", {k: len(v) for k, v in lay.items() if isinstance(v, list)})


def debug_png(R, path):
    from PIL import Image

    Y = R["Y"]
    sp = R["splat"]
    g = (Y - Y.min()) / (np.ptp(Y) + 1e-9)
    gy, gx = np.gradient(Y)
    shade = np.clip(0.6 + (gx * -0.6 + gy * -0.6), 0, 1.2)
    rgb = np.stack([g, g, g], 2) * 0.35 + 0.5 * shade[:, :, None]
    tint = (sp[:, :, 0:1] * np.array([0.35, 0.6, 0.25]) + sp[:, :, 1:2] * np.array([0.7, 0.55, 0.35])
            + sp[:, :, 2:3] * np.array([0.4, 0.55, 0.75]) + sp[:, :, 3:4] * np.array([0.3, 0.35, 0.2]))
    rgb = rgb * tint * 1.6
    lay = R["layout"]
    img = (np.clip(rgb, 0, 1) * 255).astype(np.uint8)
    size = W.TERRAIN["size"]
    res = Y.shape[0]

    def px(x, z):
        return int((x + size / 2) / size * (res - 1)), int((z + size / 2) / size * (res - 1))

    for t in lay["trees"]:
        i, j = px(t["p"][0], t["p"][2])
        img[max(j - 1, 0):j + 2, max(i - 1, 0):i + 2] = (20, 70, 20)
    for r in lay["rocks"]:
        i, j = px(r["p"][0], r["p"][2])
        img[j:j + 2, i:i + 2] = (230, 230, 220)
    Image.fromarray(img).save(path)


if __name__ == "__main__":
    R = compute()
    write_outputs(R)
    if len(sys.argv) > 1:
        debug_png(R, sys.argv[-1])
