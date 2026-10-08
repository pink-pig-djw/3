"""Shared helpers for the Blender asset pipeline of 浩的岛 (Hiroshi's Island).

Every script in this folder runs either inside Blender
    blender -b -P blender/build_all.py
or with the standalone `bpy` module from PyPI
    python blender/build_all.py

Coordinates: Blender is Z-up. The game is Y-up. The glTF exporter converts
(x, y, z)_blender -> (x, z, -y)_game, and the JSON layout files are written in
game coordinates by `to_game()`.
"""

import math
import os
import random
import sys

import bpy  # noqa: I001  (bpy must be imported before bmesh/mathutils)
import bmesh
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ASSETS = os.path.join(ROOT, "public", "assets")
TEX_DIR = os.path.join(ASSETS, "textures")
MODEL_DIR = os.path.join(ASSETS, "models")
DATA_DIR = os.path.join(ASSETS, "data")
BUILD_DIR = os.path.join(HERE, "build")

for d in (TEX_DIR, MODEL_DIR, DATA_DIR, BUILD_DIR):
    os.makedirs(d, exist_ok=True)

if HERE not in sys.path:
    sys.path.insert(0, HERE)


def log(*a):
    print("[hiroshi]", *a, flush=True)


# ---------------------------------------------------------------------------
# Scene setup
# ---------------------------------------------------------------------------

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    import addon_utils

    addon_utils.enable("cycles", default_set=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 16
    sc.cycles.use_denoising = False
    sc.render.threads_mode = "AUTO"
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    world = bpy.data.worlds.new("World")
    world.color = (0.0, 0.0, 0.0)
    sc.world = world
    return sc


def link(obj, collection=None):
    (collection or bpy.context.scene.collection).objects.link(obj)
    return obj


def select_only(objs, active=None):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or (objs[0] if objs else None)


def delete_objects(objs):
    for o in list(objs):
        data = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if data is not None and getattr(data, "users", 1) == 0:
            if isinstance(data, bpy.types.Mesh):
                bpy.data.meshes.remove(data)


# ---------------------------------------------------------------------------
# Mesh construction from numpy arrays (fast path, no per-vertex python)
# ---------------------------------------------------------------------------

def mesh_from_arrays(name, verts, faces, uvs=None, colors=None, smooth=True,
                     attrs=None, uv_name="UVMap", extra_uvs=None):
    """verts: (N,3) float, faces: (F,3|4) int (uniform arity) or list of tuples.
    uvs: per-loop (L,2) or per-vertex (N,2). colors: per-vertex (N,4) linear.
    attrs: dict name -> (N,) or (N,k) float arrays stored as POINT attributes.
    """
    verts = np.asarray(verts, dtype=np.float32)
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(verts))
    me.vertices.foreach_set("co", verts.ravel())

    if isinstance(faces, np.ndarray):
        faces = faces.astype(np.int32)
        arity = faces.shape[1]
        nf = len(faces)
        me.loops.add(nf * arity)
        me.loops.foreach_set("vertex_index", faces.ravel())
        me.polygons.add(nf)
        me.polygons.foreach_set("loop_start", np.arange(0, nf * arity, arity, dtype=np.int32))
        me.polygons.foreach_set("loop_total", np.full(nf, arity, dtype=np.int32))
        loop_vidx = faces.ravel()
    else:
        flat = [i for f in faces for i in f]
        me.loops.add(len(flat))
        me.loops.foreach_set("vertex_index", np.asarray(flat, dtype=np.int32))
        me.polygons.add(len(faces))
        starts, totals, s = [], [], 0
        for f in faces:
            starts.append(s)
            totals.append(len(f))
            s += len(f)
        me.polygons.foreach_set("loop_start", np.asarray(starts, dtype=np.int32))
        me.polygons.foreach_set("loop_total", np.asarray(totals, dtype=np.int32))
        loop_vidx = np.asarray(flat, dtype=np.int32)

    def _set_uv(layer_name, data):
        data = np.asarray(data, dtype=np.float32)
        if len(data) == len(verts) and len(data) != len(loop_vidx):
            data = data[loop_vidx]
        elif len(data) == len(verts) and len(verts) == len(loop_vidx):
            data = data[loop_vidx]
        uvl = me.uv_layers.new(name=layer_name)
        uvl.data.foreach_set("uv", data.ravel())

    if uvs is not None:
        _set_uv(uv_name, uvs)
    for nm, data in (extra_uvs or {}).items():
        _set_uv(nm, data)

    if colors is not None:
        colors = np.asarray(colors, dtype=np.float32)
        if colors.shape[1] == 3:
            colors = np.concatenate([colors, np.ones((len(colors), 1), np.float32)], 1)
        ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
        ca.data.foreach_set("color", colors.ravel())
        me.color_attributes.active_color = ca
        me.color_attributes.render_color_index = 0

    for nm, data in (attrs or {}).items():
        data = np.asarray(data, dtype=np.float32)
        if data.ndim == 1:
            a = me.attributes.new(nm, "FLOAT", "POINT")
            a.data.foreach_set("value", data)
        elif data.shape[1] == 2:
            a = me.attributes.new(nm, "FLOAT2", "POINT")
            a.data.foreach_set("vector", data.ravel())
        elif data.shape[1] == 3:
            a = me.attributes.new(nm, "FLOAT_VECTOR", "POINT")
            a.data.foreach_set("vector", data.ravel())
        else:
            a = me.attributes.new(nm, "FLOAT_COLOR", "POINT")
            a.data.foreach_set("color", data.ravel())

    me.update(calc_edges=True)
    me.validate(clean_customdata=False)
    if smooth:
        me.shade_smooth()
    else:
        me.shade_flat()
    return me


def grid_mesh_arrays(nx, ny, x0, y0, x1, y1):
    xs = np.linspace(x0, x1, nx, dtype=np.float32)
    ys = np.linspace(y0, y1, ny, dtype=np.float32)
    X, Y = np.meshgrid(xs, ys)
    verts = np.stack([X.ravel(), Y.ravel(), np.zeros(X.size, np.float32)], 1)
    idx = np.arange(nx * ny).reshape(ny, nx)
    a = idx[:-1, :-1].ravel()
    b = idx[:-1, 1:].ravel()
    c = idx[1:, 1:].ravel()
    d = idx[1:, :-1].ravel()
    faces = np.stack([a, b, c, d], 1)
    uv = np.stack([(X.ravel() - x0) / (x1 - x0), (Y.ravel() - y0) / (y1 - y0)], 1)
    return verts, faces, uv


def obj_from_mesh(name, me, collection=None):
    ob = bpy.data.objects.new(name, me)
    link(ob, collection)
    return ob


def mesh_to_arrays(ob, apply_transform=True):
    """Evaluated triangulated mesh as numpy (verts, tris)."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    me.calc_loop_triangles()
    v = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get("co", v)
    v = v.reshape(-1, 3)
    t = np.empty(len(me.loop_triangles) * 3, np.int32)
    me.loop_triangles.foreach_get("vertices", t)
    t = t.reshape(-1, 3)
    if apply_transform:
        M = np.array(ob.matrix_world)
        v = v @ M[:3, :3].T + M[:3, 3]
    ev.to_mesh_clear()
    return v, t


def join(objs, name=None):
    objs = [o for o in objs if o is not None]
    if len(objs) == 1:
        if name:
            objs[0].name = name
        return objs[0]
    select_only(objs, objs[0])
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    if name:
        ob.name = name
        ob.data.name = name
    return ob


def apply_transforms(ob):
    select_only([ob], ob)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def apply_modifiers(ob):
    select_only([ob], ob)
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------

class NT:
    """Tiny node-tree builder: nt = NT(mat); n = nt.new('ShaderNodeTexNoise', Scale=4)."""

    def __init__(self, mat, clear=True):
        mat.use_nodes = True
        self.mat = mat
        self.tree = mat.node_tree
        self.nodes = self.tree.nodes
        self.links = self.tree.links
        if clear:
            self.nodes.clear()

    def new(self, kind, *, props=None, **inputs):
        n = self.nodes.new(kind)
        for k, v in (props or {}).items():
            setattr(n, k, v)
        for k, v in inputs.items():
            self.set(n, k.replace("_", " "), v)
        return n

    @staticmethod
    def sock(sockets, name):
        if isinstance(name, int):
            return sockets[name]
        cands = [s for s in sockets if s.name == name or s.identifier == name]
        en = [s for s in cands if getattr(s, "enabled", True)]
        if en:
            return en[0]
        if cands:
            return cands[0]
        raise KeyError(f"socket {name!r} not in {[s.name for s in sockets]}")

    def set(self, node, name, value):
        s = self.sock(node.inputs, name)
        s.default_value = value

    def link(self, a, a_out, b, b_in):
        self.links.new(self.sock(a.outputs, a_out), self.sock(b.inputs, b_in))

    def mix(self, data_type, fac, a, b, blend="MIX"):
        m = self.nodes.new("ShaderNodeMix")
        m.data_type = data_type
        if data_type == "RGBA":
            m.blend_type = blend
        sfx = {"RGBA": "Color", "FLOAT": "Float", "VECTOR": "Vector"}[data_type]
        for val, ident in ((fac, "Factor_Float"), (a, "A_" + sfx), (b, "B_" + sfx)):
            sock = [s for s in m.inputs if s.identifier == ident][0]
            if isinstance(val, tuple) and len(val) == 2 and hasattr(val[0], "outputs"):
                self.links.new(self.sock(val[0].outputs, val[1]), sock)
            else:
                sock.default_value = val
        return m

    def out(self, node, name):
        return self.sock(node.outputs, name)


def principled_material(name, base=(0.5, 0.5, 0.5, 1), rough=0.6, metallic=0.0):
    mat = bpy.data.materials.new(name)
    nt = NT(mat)
    out = nt.new("ShaderNodeOutputMaterial")
    p = nt.new("ShaderNodeBsdfPrincipled")
    nt.set(p, "Base Color", base)
    nt.set(p, "Roughness", rough)
    nt.set(p, "Metallic", metallic)
    nt.link(p, "BSDF", out, "Surface")
    return mat


def vertex_color_material(name, rough_attr=None, rough=0.7):
    """Principled material whose base color comes from the 'Col' attribute and
    roughness optionally from a float attribute."""
    mat = bpy.data.materials.new(name)
    nt = NT(mat)
    out = nt.new("ShaderNodeOutputMaterial")
    p = nt.new("ShaderNodeBsdfPrincipled")
    col = nt.new("ShaderNodeAttribute", props={"attribute_name": "Col"})
    nt.link(col, "Color", p, "Base Color")
    if rough_attr:
        r = nt.new("ShaderNodeAttribute", props={"attribute_name": rough_attr})
        nt.link(r, "Fac", p, "Roughness")
    else:
        nt.set(p, "Roughness", rough)
    nt.link(p, "BSDF", out, "Surface")
    return mat


def assign_material(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)


# ---------------------------------------------------------------------------
# Images & baking
# ---------------------------------------------------------------------------

def new_float_image(name, w, h=None, alpha=True):
    img = bpy.data.images.new(name, w, h or w, alpha=alpha, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"
    return img


def image_to_np(img):
    w, h = img.size
    arr = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(arr)
    return arr.reshape(h, w, 4)[::-1].copy()  # top row first


def load_image_np(path):
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = "Non-Color"
    a = image_to_np(img)
    bpy.data.images.remove(img)
    return a


def lin2srgb(x):
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def srgb2lin(x):
    x = np.asarray(x, dtype=np.float64)
    return np.where(x <= 0.04045, x / 12.92, np.power((x + 0.055) / 1.055, 2.4))


def hexlin(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(float(v) for v in srgb2lin(np.array(c)))


def save_image(arr, path, quality=88, lossless=False):
    """arr: float (h,w,c) in 0..1, already in the output encoding."""
    from PIL import Image

    a = np.clip(arr * 255.0 + 0.5, 0, 255).astype(np.uint8)
    if a.ndim == 2:
        im = Image.fromarray(a, "L")
    elif a.shape[2] == 3:
        im = Image.fromarray(a, "RGB")
    else:
        im = Image.fromarray(a, "RGBA")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    ext = os.path.splitext(path)[1].lower()
    if ext == ".webp":
        im.save(path, "WEBP", quality=quality, lossless=lossless, method=6)
    elif ext in (".jpg", ".jpeg"):
        im.convert("RGB").save(path, "JPEG", quality=quality, optimize=True)
    else:
        im.save(path, optimize=True)
    log("wrote", os.path.relpath(path, ROOT), im.size)


def resize_np(arr, size):
    from PIL import Image

    out = []
    for c in range(arr.shape[2]):
        im = Image.fromarray(arr[:, :, c].astype(np.float32), "F")
        out.append(np.asarray(im.resize((size, size), Image.LANCZOS)))
    return np.stack(out, 2)


def set_bake_target(ob, img):
    """Ensure every material on `ob` has an active image node pointing at img."""
    for slot in ob.material_slots:
        mat = slot.material
        nt = mat.node_tree
        node = nt.nodes.get("__bake__")
        if node is None:
            node = nt.nodes.new("ShaderNodeTexImage")
            node.name = "__bake__"
        node.image = img
        nt.nodes.active = node


def bake(low, highs, kind, img, *, extrusion=0.3, max_dist=0.0, margin=4,
         samples=16, pass_filter=None, normal_space="TANGENT"):
    sc = bpy.context.scene
    sc.cycles.samples = samples
    set_bake_target(low, img)
    sel = list(highs) + [low]
    select_only(sel, low)
    kw = dict(type=kind, use_selected_to_active=bool(highs), cage_extrusion=extrusion,
              max_ray_distance=max_dist, margin=margin, use_clear=True,
              target="IMAGE_TEXTURES", normal_space=normal_space)
    if pass_filter:
        kw["pass_filter"] = pass_filter
    bpy.ops.object.bake(**kw)
    return image_to_np(img)


def swap_to_emission(objs, socket_builder):
    """Temporarily route every material's output through an emission shader.
    socket_builder(nt) -> (node, output_name) providing the emitted value.
    Returns a restore() callable."""
    saved = []
    done = set()
    for ob in objs:
        for slot in ob.material_slots:
            mat = slot.material
            if mat is None or mat.name in done:
                continue
            done.add(mat.name)
            nt = NT(mat, clear=False)
            outn = [n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"][0]
            surf = outn.inputs["Surface"]
            prev = surf.links[0].from_socket if surf.links else None
            em = nt.new("ShaderNodeEmission")
            em.name = "__emit__"
            src, name = socket_builder(nt)
            nt.link(src, name, em, "Color")
            nt.set(em, "Strength", 1.0)
            nt.links.new(em.outputs[0], surf)
            saved.append((mat, prev, [em, src]))

    def restore():
        for mat, prev, nodes in saved:
            nt = mat.node_tree
            outn = [n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"][0]
            for n in nodes:
                nt.nodes.remove(n)
            if prev is not None:
                nt.links.new(prev, outn.inputs["Surface"])

    return restore


def height_emitter(zmin, zmax):
    def build(nt):
        geo = nt.new("ShaderNodeNewGeometry")
        sep = nt.new("ShaderNodeSeparateXYZ")
        nt.link(geo, "Position", sep, "Vector")
        mr = nt.new("ShaderNodeMapRange", From_Min=zmin, From_Max=zmax, To_Min=0.0, To_Max=1.0)
        nt.link(sep, "Z", mr, "Value")
        return mr, "Result"

    return build


# ---------------------------------------------------------------------------
# Noise (numpy). Periodic versions are used for tileable textures.
# ---------------------------------------------------------------------------

def periodic_noise(n, freq, seed, beta=2.0, octaves=1):
    """Band-limited periodic noise on an n x n grid, roughly unit variance.
    freq: base frequency in cycles per tile."""
    rng = np.random.default_rng(seed)
    fx = np.fft.fftfreq(n) * n
    FX, FY = np.meshgrid(fx, fx)
    r = np.sqrt(FX ** 2 + FY ** 2)
    total = np.zeros((n, n))
    amp = 1.0
    f = float(freq)
    for _ in range(octaves):
        white = rng.normal(size=(n, n))
        W = np.fft.fft2(white)
        band = np.exp(-((np.log2(np.maximum(r, 1e-6)) - math.log2(f)) ** 2) / (2 * 0.45 ** 2))
        band[0, 0] = 0
        layer = np.real(np.fft.ifft2(W * band))
        layer /= layer.std() + 1e-9
        total += layer * amp
        amp *= 0.5 ** (beta / 2.0)
        f *= 2.0
    total /= total.std() + 1e-9
    return total


def periodic_worley(n, count, seed, aspect=(1.0, 1.0), jitter=1.0):
    """Periodic Worley noise: returns F1, F2 distances (in tile units) and cell id."""
    from scipy.spatial import cKDTree

    rng = np.random.default_rng(seed)
    pts = rng.random((count, 2))
    ax, ay = aspect
    tree = cKDTree(pts * [ax, ay], boxsize=[ax, ay])
    u = (np.arange(n) + 0.5) / n
    U, V = np.meshgrid(u, u)
    q = np.stack([U.ravel() * ax, V.ravel() * ay], 1)
    d, i = tree.query(q, k=2)
    return d[:, 0].reshape(n, n), d[:, 1].reshape(n, n), i[:, 0].reshape(n, n)


def sample_periodic(field, u, v):
    """Bilinear sample of an n x n periodic field at tile coords u, v (any range).
    Row index = v, column index = u."""
    n = field.shape[0]
    x = (np.asarray(u) % 1.0) * n - 0.5
    y = (np.asarray(v) % 1.0) * n - 0.5
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    fx = x - x0
    fy = y - y0
    x0 %= n
    y0 %= n
    x1 = (x0 + 1) % n
    y1 = (y0 + 1) % n
    f = field
    return ((f[y0, x0] * (1 - fx) + f[y0, x1] * fx) * (1 - fy)
            + (f[y1, x0] * (1 - fx) + f[y1, x1] * fx) * fy)


def value_noise_2d(x, y, seed=0):
    """Smooth value noise for arbitrary coordinates (non periodic)."""
    xi = np.floor(x).astype(np.int64)
    yi = np.floor(y).astype(np.int64)
    xf = x - xi
    yf = y - yi

    def h(ix, iy):
        v = (ix * 374761393 + iy * 668265263 + seed * 2147483647) & 0xFFFFFFFF
        v = (v ^ (v >> 13)) * 1274126177 & 0xFFFFFFFF
        v = v ^ (v >> 16)
        return (v & 0xFFFF) / 65535.0

    u = xf * xf * xf * (xf * (xf * 6 - 15) + 10)
    w = yf * yf * yf * (yf * (yf * 6 - 15) + 10)
    a = h(xi, yi)
    b = h(xi + 1, yi)
    c = h(xi, yi + 1)
    d = h(xi + 1, yi + 1)
    return (a * (1 - u) + b * u) * (1 - w) + (c * (1 - u) + d * u) * w


def fbm2(x, y, octaves=5, lac=2.0, gain=0.5, seed=0):
    tot = np.zeros_like(np.asarray(x, dtype=np.float64))
    amp, f, norm = 1.0, 1.0, 0.0
    for o in range(octaves):
        tot += (value_noise_2d(x * f, y * f, seed + o * 17) * 2 - 1) * amp
        norm += amp
        amp *= gain
        f *= lac
    return tot / norm


def noise3(p, seed=0):
    """Value noise in 3D for (N,3) arrays."""
    p = np.asarray(p, dtype=np.float64)
    i = np.floor(p).astype(np.int64)
    f = p - i
    u = f * f * f * (f * (f * 6 - 15) + 10)

    def h(ix, iy, iz):
        v = (ix * 73856093 ^ iy * 19349663 ^ iz * 83492791 ^ (seed * 2654435761)) & 0xFFFFFFFF
        v = (v ^ (v >> 13)) * 1274126177 & 0xFFFFFFFF
        v = v ^ (v >> 16)
        return (v & 0xFFFF) / 65535.0

    x, y, z = i[:, 0], i[:, 1], i[:, 2]
    ux, uy, uz = u[:, 0], u[:, 1], u[:, 2]
    c000 = h(x, y, z); c100 = h(x + 1, y, z)
    c010 = h(x, y + 1, z); c110 = h(x + 1, y + 1, z)
    c001 = h(x, y, z + 1); c101 = h(x + 1, y, z + 1)
    c011 = h(x, y + 1, z + 1); c111 = h(x + 1, y + 1, z + 1)
    x00 = c000 * (1 - ux) + c100 * ux
    x10 = c010 * (1 - ux) + c110 * ux
    x01 = c001 * (1 - ux) + c101 * ux
    x11 = c011 * (1 - ux) + c111 * ux
    y0 = x00 * (1 - uy) + x10 * uy
    y1 = x01 * (1 - uy) + x11 * uy
    return y0 * (1 - uz) + y1 * uz


def fbm3(p, octaves=4, lac=2.0, gain=0.5, seed=0):
    p = np.asarray(p, dtype=np.float64)
    tot = np.zeros(len(p))
    amp, f, norm = 1.0, 1.0, 0.0
    for o in range(octaves):
        tot += (noise3(p * f + o * 13.7, seed + o) * 2 - 1) * amp
        norm += amp
        amp *= gain
        f *= lac
    return tot / norm


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

def export_glb(objs, path, *, colors=True, attributes=True, tangents=False):
    select_only(objs, objs[0])
    kw = dict(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=tangents,
        export_materials="EXPORT",
        export_attributes=attributes,
        export_extras=True,
        export_image_format="NONE",
    )
    if colors:
        kw["export_vertex_color"] = "ACTIVE"
        kw["export_active_vertex_color_when_no_material"] = True
    else:
        kw["export_vertex_color"] = "NONE"
    bpy.ops.export_scene.gltf(**kw)
    log("wrote", os.path.relpath(path, ROOT), f"{os.path.getsize(path) / 1024:.0f} KB")


def to_game(v):
    """Blender (x, y, z) -> game (x, y_up, z)."""
    return [float(v[0]), float(v[2]), float(-v[1])]


def rng(seed):
    return random.Random(seed)
