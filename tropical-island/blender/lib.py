"""Shared helpers for the Blender asset scripts.

Run any script with Blender's Python (e.g. `blender -b -P textures.py -- out_dir`)
or with the `bpy` module from PyPI (`python textures.py out_dir`).
"""
import math
import os
import sys

import bpy
import numpy as np

TAU = math.tau


def args():
    """Command-line arguments after `--` (blender -P) or after the script name (python)."""
    argv = sys.argv
    return argv[argv.index('--') + 1:] if '--' in argv else argv[1:]


def fresh_scene(samples=4):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.render.bake.margin = 0
    return sc


def select_only(obj):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


class Graph:
    """Builds a shader node graph that ends in an Emission shader, so any socket can be baked."""

    def __init__(self, mat):
        mat.use_nodes = True
        self.nt = mat.node_tree
        self.nt.nodes.clear()
        self.out = self.node('ShaderNodeOutputMaterial')
        self.emit = self.node('ShaderNodeEmission')
        self.link(self.emit.outputs[0], self.out.inputs['Surface'])
        self._uv = None

    # ---- plumbing ----
    def node(self, kind, inputs=None, **props):
        n = self.nt.nodes.new(kind)
        for k, v in props.items():
            setattr(n, k, v)
        for k, v in (inputs or {}).items():
            self.set(n.inputs[k], v)
        return n

    def set(self, sock, v):
        if isinstance(v, bpy.types.NodeSocket):
            self.link(v, sock)
        elif isinstance(v, (tuple, list)) and len(v) == 3 and sock.type == 'RGBA':
            sock.default_value = (*v, 1.0)
        else:
            sock.default_value = v

    def link(self, a, b):
        self.nt.links.new(a, b)

    # ---- maths ----
    def m(self, op, a, b=0.0, c=0.0, clamp=False):
        n = self.node('ShaderNodeMath', operation=op, use_clamp=clamp)
        self.set(n.inputs[0], a)
        self.set(n.inputs[1], b)
        self.set(n.inputs[2], c)
        return n.outputs[0]

    def add(self, *xs):
        acc = xs[0]
        for x in xs[1:]:
            acc = self.m('ADD', acc, x)
        return acc

    def sub(self, a, b): return self.m('SUBTRACT', a, b)
    def mul(self, a, b): return self.m('MULTIPLY', a, b)
    def mad(self, a, b, c): return self.m('MULTIPLY_ADD', a, b, c)
    def fract(self, a): return self.m('FRACT', a)
    def sin(self, a): return self.m('SINE', a)
    def pw(self, a, b): return self.m('POWER', a, b)
    def mx(self, a, b): return self.m('MAXIMUM', a, b)
    def mn(self, a, b): return self.m('MINIMUM', a, b)
    def gt(self, a, b): return self.m('GREATER_THAN', a, b)
    def clamp01(self, a): return self.m('ADD', a, 0.0, clamp=True)

    def smooth(self, e0, e1, x):
        """smoothstep(e0, e1, x); e1 < e0 gives the falling edge."""
        n = self.node('ShaderNodeMapRange', interpolation_type='SMOOTHSTEP', clamp=True)
        self.set(n.inputs['Value'], x)
        lo, hi, a, b = (e0, e1, 0.0, 1.0) if e1 >= e0 else (e1, e0, 1.0, 0.0)
        self.set(n.inputs['From Min'], lo)
        self.set(n.inputs['From Max'], hi)
        self.set(n.inputs['To Min'], a)
        self.set(n.inputs['To Max'], b)
        return n.outputs['Result']

    def lerp(self, a, b, t):
        return self.add(a, self.mul(self.sub(b, a), t))

    # ---- colour ----
    def rgb(self, c):
        n = self.node('ShaderNodeRGB')
        n.outputs[0].default_value = (*srgb_to_lin(c), 1.0)
        return n.outputs[0]

    def mix(self, t, a, b, blend='MIX'):
        n = self.node('ShaderNodeMix', data_type='RGBA', blend_type=blend)
        ins = {s.identifier: s for s in n.inputs}
        self.set(ins['Factor_Float'], t)
        self.set(ins['A_Color'], a if isinstance(a, bpy.types.NodeSocket) else self.rgb(a))
        self.set(ins['B_Color'], b if isinstance(b, bpy.types.NodeSocket) else self.rgb(b))
        return {s.identifier: s for s in n.outputs}['Result_Color']

    def scale_color(self, col, f):
        n = self.node('ShaderNodeVectorMath', operation='SCALE')
        self.set(n.inputs[0], col)
        self.set(n.inputs['Scale'], f)
        return n.outputs['Vector']

    def ramp(self, fac, stops, interp='LINEAR'):
        """stops: [(position, '#rrggbb'), ...]"""
        n = self.node('ShaderNodeValToRGB')
        cr = n.color_ramp
        cr.interpolation = interp
        while len(cr.elements) < len(stops):
            cr.elements.new(0.5)
        for e, (p, c) in zip(cr.elements, stops):
            e.position = p
            e.color = (*srgb_to_lin(c), 1.0)
        self.set(n.inputs['Fac'], fac)
        return n.outputs['Color']

    def combine(self, r, g, b):
        n = self.node('ShaderNodeCombineColor')
        self.set(n.inputs[0], r)
        self.set(n.inputs[1], g)
        self.set(n.inputs[2], b)
        return n.outputs[0]

    # ---- seamless coordinates ----
    def uv(self):
        if self._uv is None:
            tc = self.node('ShaderNodeTexCoord')
            sep = self.node('ShaderNodeSeparateXYZ')
            self.link(tc.outputs['UV'], sep.inputs[0])
            self._uv = (sep.outputs['X'], sep.outputs['Y'])
        return self._uv

    def torus(self, fu, fv, off=(0.0, 0.0, 0.0, 0.0)):
        """Map the unit square onto a torus in 4D: noise sampled there tiles perfectly.
        fu, fv ≈ feature frequency across the tile in u and v."""
        u, v = self.uv()
        au, av = self.mul(u, TAU), self.mul(v, TAU)
        ru, rv = fu / TAU, fv / TAU
        x = self.add(self.mul(self.m('COSINE', au), ru), off[0])
        y = self.add(self.mul(self.m('SINE', au), ru), off[1])
        z = self.add(self.mul(self.m('COSINE', av), rv), off[2])
        w = self.add(self.mul(self.m('SINE', av), rv), off[3])
        n = self.node('ShaderNodeCombineXYZ')
        self.set(n.inputs[0], x)
        self.set(n.inputs[1], y)
        self.set(n.inputs[2], z)
        return n.outputs[0], w

    def noise(self, fu, fv=None, detail=4.0, rough=0.5, lac=2.0, seed=0.0, kind='FBM', distortion=0.0):
        vec, w = self.torus(fu, fv if fv is not None else fu, (seed * 7.31, seed * 3.17, seed * 5.53, seed * 9.71))
        n = self.node('ShaderNodeTexNoise', noise_dimensions='4D', noise_type=kind)
        self.set(n.inputs['Vector'], vec)
        self.set(n.inputs['W'], w)
        self.set(n.inputs['Scale'], 1.0)
        self.set(n.inputs['Detail'], detail)
        self.set(n.inputs['Roughness'], rough)
        self.set(n.inputs['Lacunarity'], lac)
        self.set(n.inputs['Distortion'], distortion)
        return n.outputs['Fac']

    def voronoi(self, fu, fv=None, feature='F1', metric='EUCLIDEAN', rand=1.0, seed=0.0):
        vec, w = self.torus(fu, fv if fv is not None else fu, (seed * 4.13, seed * 8.71, seed * 2.39, seed * 6.07))
        n = self.node('ShaderNodeTexVoronoi', voronoi_dimensions='4D', feature=feature, distance=metric)
        self.set(n.inputs['Vector'], vec)
        self.set(n.inputs['W'], w)
        self.set(n.inputs['Scale'], 1.0)
        self.set(n.inputs['Randomness'], rand)
        return n.outputs

    def white(self, x):
        """Random value per integer x (e.g. one per plank)."""
        n = self.node('ShaderNodeTexWhiteNoise', noise_dimensions='1D')
        self.set(n.inputs['W'], x)
        return n.outputs['Value']

    def stripes(self, axis, count, warp=None, warp_amt=0.0):
        """Phase that runs 0→count across the tile along u (0) or v (1), optionally warped."""
        c = self.uv()[axis]
        p = self.mul(c, count)
        return self.add(p, self.mul(warp, warp_amt)) if warp is not None else p


def srgb_to_lin(c):
    if isinstance(c, str):
        c = c.lstrip('#')
        c = tuple(int(c[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


# ---------------------------------------------------------------------
#  Baking
# ---------------------------------------------------------------------
def bake_plane():
    bpy.ops.mesh.primitive_plane_add(size=1.0)
    plane = bpy.context.active_object
    mat = bpy.data.materials.new('bake')
    plane.data.materials.append(mat)
    return plane, mat


def bake(graph, plane, sock, res, samples=None):
    """Bake whatever `sock` evaluates to over the unit square; returns float32 [res, res, 3], row 0 = v 0."""
    sc = bpy.context.scene
    if samples:
        sc.cycles.samples = samples
    graph.link(sock, graph.emit.inputs['Color'])
    img = bpy.data.images.new('bake_img', res, res, float_buffer=True, alpha=False)
    tex = graph.node('ShaderNodeTexImage')
    tex.image = img
    for n in graph.nt.nodes:
        n.select = False
    tex.select = True
    graph.nt.nodes.active = tex
    select_only(plane)
    bpy.ops.object.bake(type='EMIT', margin=0, use_clear=True)
    buf = np.empty(res * res * 4, np.float32)
    img.pixels.foreach_get(buf)
    graph.nt.nodes.remove(tex)
    bpy.data.images.remove(img)
    return buf.reshape(res, res, 4)[:, :, :3].copy()


# ---------------------------------------------------------------------
#  Post-processing in numpy (everything wraps around, so tiles stay seamless)
# ---------------------------------------------------------------------
def blur(a, sigma):
    """Periodic Gaussian blur via FFT."""
    h, w = a.shape
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    k = np.exp(-2 * (math.pi ** 2) * (sigma ** 2) * (fx ** 2 + fy ** 2))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * k))


def normal_from_height(h, pixel_size, strength=1.0):
    """Tangent-space (OpenGL, +Y up) normal map from a height field in metres. Rows run along +v."""
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / (2 * pixel_size)
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) / (2 * pixel_size)
    n = np.dstack([-dx * strength, -dy * strength, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * 0.5 + 0.5


def cavity_ao(h, pixel_size, radius_m, depth_m):
    """Darken pits and cracks: how far the surface sits below its blurred surroundings."""
    sigma = max(1.0, radius_m / pixel_size)
    d = blur(h, sigma) - h
    return np.clip(1.0 - d / depth_m, 0.0, 1.0)


def lin_to_srgb(x):
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def save_rgb(path, rgb, quality=88, srgb=False):
    from PIL import Image
    a = lin_to_srgb(rgb) if srgb else np.clip(rgb, 0.0, 1.0)
    img = Image.fromarray((a[::-1] * 255 + 0.5).astype(np.uint8), 'RGB')   # flip: image row 0 is the top (v = 1)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, quality=quality, method=6)
    return path


def save_rgba(path, rgba, quality=90, srgb=True):
    from PIL import Image
    rgb = lin_to_srgb(rgba[:, :, :3]) if srgb else np.clip(rgba[:, :, :3], 0.0, 1.0)
    a = np.dstack([rgb, np.clip(rgba[:, :, 3:4], 0.0, 1.0)])
    img = Image.fromarray((a[::-1] * 255 + 0.5).astype(np.uint8), 'RGBA')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, quality=quality, method=6)
    return path


# ---------------------------------------------------------------------
#  Rendering a tileable texture from real geometry, seen straight from above
# ---------------------------------------------------------------------
def periodic_noise(n, res, octaves=((2, 1.0), (4, 0.5), (8, 0.25)), seed=0):
    """Smooth periodic noise on an n×n grid (sum of random-phase waves with integer frequencies)."""
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:n, 0:n] / n
    out = np.zeros((n, n))
    for f, amp in octaves:
        for _ in range(6):
            kx, ky = rng.integers(-f, f + 1, 2)
            if kx == 0 and ky == 0:
                continue
            out += amp * np.cos(TAU * (kx * x + ky * y) + rng.uniform(0, TAU))
    out -= out.min()
    return out / max(1e-9, out.max())


def wrap_copies(points, tile, margin):
    """For tileable scattering: the offsets at which a point near the border must be repeated."""
    out = []
    for p in points:
        x, y = p[0], p[1]
        xs = [0.0] + ([tile] if x < margin else []) + ([-tile] if x > tile - margin else [])
        ys = [0.0] + ([tile] if y < margin else []) + ([-tile] if y > tile - margin else [])
        out.append([(dx, dy) for dx in xs for dy in ys])
    return out


def mesh_from(name, verts, faces, colors=None, uvs=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts.tolist() if hasattr(verts, 'tolist') else verts, [], faces.tolist() if hasattr(faces, 'tolist') else faces)
    me.update()
    if colors is not None:
        attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        c = np.ones((len(colors), 4), np.float32)
        c[:, :3] = colors
        attr.data.foreach_set('color', c.ravel())
    if uvs is not None:
        uvl = me.uv_layers.new(name='UVMap')
        loop_vi = np.empty(len(me.loops), np.int32)
        me.loops.foreach_get('vertex_index', loop_vi)
        uvl.data.foreach_set('uv', np.asarray(uvs, np.float32)[loop_vi].ravel())
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def vertex_color_material(name, rough=0.85, height_aov=True):
    """Principled material coloured by the 'Col' attribute; also writes world Z into the 'height' AOV."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    attr = nt.nodes.new('ShaderNodeAttribute')
    attr.attribute_name = 'Col'
    nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = rough
    if height_aov:
        add_height_aov(nt)
    return mat


def add_height_aov(nt, extra=None):
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(geo.outputs['Position'], sep.inputs[0])
    out = nt.nodes.new('ShaderNodeOutputAOV')
    out.aov_name = 'height'
    z = sep.outputs['Z']
    if extra is not None:
        add = nt.nodes.new('ShaderNodeMath')
        add.operation = 'ADD'
        nt.links.new(z, add.inputs[0])
        nt.links.new(extra, add.inputs[1])
        z = add.outputs[0]
    nt.links.new(z, out.inputs['Value'])


def render_topdown(tile, res, out_dir, samples=16, ao_distance=0.05, z_top=5.0, transparent=False, size=None):
    """Orthographic top-down render of [0, tile]² → dict of float arrays (row 0 = +v 0):
    'col' albedo, 'nor' world normal (== tangent-space for a flat tile), 'ao', 'hgt'."""
    sc = bpy.context.scene
    sc.cycles.samples = samples
    sc.render.resolution_x = sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = transparent
    sc.view_settings.view_transform = 'Standard'
    sc.render.filter_size = 0.75
    if sc.world is None:
        sc.world = bpy.data.worlds.new('World')
    sc.world.use_nodes = True
    sc.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.5, 0.5, 0.5, 1)
    sc.world.light_settings.distance = ao_distance
    cam_data = bpy.data.cameras.new('topcam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = tile if size is None else max(size)
    cam_data.clip_start, cam_data.clip_end = 0.01, z_top * 4
    cam = bpy.data.objects.new('topcam', cam_data)
    sc.collection.objects.link(cam)
    w, h = (tile, tile) if size is None else size
    cam.location = (w / 2, h / 2, z_top)
    if size is not None:
        sc.render.resolution_x, sc.render.resolution_y = res, int(round(res * h / w))
    cam.rotation_euler = (0, 0, 0)
    sc.camera = cam
    vl = sc.view_layers[0]
    vl.use_pass_diffuse_color = True
    vl.use_pass_normal = True
    vl.use_pass_ambient_occlusion = True
    if 'height' not in vl.aovs:
        a = vl.aovs.add()
        a.name, a.type = 'height', 'VALUE'
    sc.use_nodes = True
    tree = sc.node_tree
    for n in list(tree.nodes):
        if n.bl_idname == 'CompositorNodeOutputFile':
            tree.nodes.remove(n)
    rl = next(n for n in tree.nodes if n.bl_idname == 'CompositorNodeRLayers')
    fo = tree.nodes.new('CompositorNodeOutputFile')
    fo.base_path = out_dir
    fo.format.file_format = 'OPEN_EXR'
    fo.format.color_depth = '32'
    fo.file_slots.clear()
    slots = [('col', 'DiffCol'), ('nor', 'Normal'), ('ao', 'AO'), ('hgt', 'height')] + ([('alpha', 'Alpha')] if transparent else [])
    for slot, sock in slots:
        fo.file_slots.new(slot)
        tree.links.new(rl.outputs[sock], fo.inputs[slot])
    sc.frame_set(1)
    bpy.ops.render.render(write_still=False)
    out = {}
    rx, ry = sc.render.resolution_x, sc.render.resolution_y
    for slot, _ in slots:
        path = os.path.join(out_dir, f'{slot}0001.exr')
        img = bpy.data.images.load(path)
        buf = np.empty(rx * ry * 4, np.float32)
        img.pixels.foreach_get(buf)
        out[slot] = buf.reshape(ry, rx, 4)
        bpy.data.images.remove(img)
    return out


# ---------------------------------------------------------------------
#  Mesh utilities and export
# ---------------------------------------------------------------------
def apply_modifiers(obj):
    select_only(obj)
    for m in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def mesh_arrays(obj):
    me = obj.data
    v = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('co', v)
    return v.reshape(-1, 3)


def set_mesh_arrays(obj, v):
    obj.data.vertices.foreach_set('co', np.asarray(v, np.float32).ravel())
    obj.data.update()


def bake_vertex_ao(obj, samples=48, distance=0.5, ground_z=None, attr='Col'):
    """Ambient occlusion baked into a colour attribute (optionally with a ground plane to darken the base)."""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = samples
    if sc.world is None:
        sc.world = bpy.data.worlds.new('World')
    sc.world.light_settings.distance = distance
    me = obj.data
    if attr not in me.color_attributes:
        me.color_attributes.new(attr, 'FLOAT_COLOR', 'POINT')
    me.color_attributes.active_color = me.color_attributes[attr]
    if not obj.data.materials:
        obj.data.materials.append(bpy.data.materials.new('ao_tmp'))
    plane = None
    if ground_z is not None:
        bpy.ops.mesh.primitive_plane_add(size=50, location=(0, 0, ground_z))
        plane = bpy.context.active_object
    select_only(obj)
    sc.render.bake.target = 'VERTEX_COLORS'
    bpy.ops.object.bake(type='AO')
    sc.render.bake.target = 'IMAGE_TEXTURES'
    if plane:
        bpy.data.objects.remove(plane)


def export_glb(objs, path, **kw):
    for o in bpy.context.view_layer.objects:
        o.select_set(o in objs)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    opts = dict(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                export_normals=True, export_texcoords=True, export_tangents=False,
                export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_attributes=True,
                export_materials='EXPORT', export_yup=True, export_animations=False, export_skins=False,
                export_morph=False, export_cameras=False, export_lights=False)
    opts.update(kw)
    bpy.ops.export_scene.gltf(**opts)
    return path
