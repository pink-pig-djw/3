"""The islanders: realistic people from MakeHuman's MPFB2 add-on, dressed, given hair, and baked for the web.

    python people.py ../assets/people [ids...]

Needs MPFB2 (https://github.com/makehumancommunity/mpfb2, assets CC0) installed as a Blender extension;
set MPFB_SRC to its src/mpfb folder and it is linked into Blender's user extensions automatically.
The eye mesh comes from the MakeHuman repository (MAKEHUMAN_DATA, its makehuman/data folder).

Each character is a Mixamo-compatible skeleton (52 bones, "mixamorig:*") with up to four meshes:
  body    skin (baked albedo with brows, lips and stubble; tangent normal; packed AO/roughness)
  eyes    procedural MPFB eyes baked to a small texture
  clothes cut from MakeHuman's fitting helpers (tights, skirt), loosened, with their own UVs;
          the texture holds shading (R), a print mask (G) and which garment it is (B), so the page can
          recolour each person
  hair    a cap over the scalp plus strand cards (alpha-tested atlas)
"""
import math
import os
import sys
import importlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import bmesh  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
MPFB_SRC = os.environ.get('MPFB_SRC', '/home/user/makehumancommunity/mpfb2/src/mpfb')
ATLAS_PATH = os.path.join(HERE, 'build', 'hair_atlas.webp')
MAKEHUMAN_DATA = os.environ.get('MAKEHUMAN_DATA', '/home/user/makehumancommunity/makehuman/makehuman/data')


def mpfb():
    """Link MPFB2 into the user extensions, enable it, and return its services."""
    ext = bpy.utils.user_resource('EXTENSIONS', path='user_default', create=True)
    link = os.path.join(ext, 'mpfb')
    if not os.path.exists(link):
        os.symlink(MPFB_SRC, link)
    bpy.ops.preferences.addon_enable(module='bl_ext.user_default.mpfb')
    m = lambda p: importlib.import_module('bl_ext.user_default.mpfb.' + p)  # noqa: E731

    class S:
        HS = m('services.humanservice').HumanService
        MS = m('services.materialservice').MaterialService
        TS = m('services.targetservice').TargetService
    return S


def lin(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def years(y):
    """MakeHuman's age slider: 1 → 0, 11 → 0.1875, 25 → 0.5, 90 → 1."""
    if y <= 11:
        return (y - 1) / 10 * 0.1875
    if y <= 25:
        return 0.1875 + (y - 11) / 14 * 0.3125
    return 0.5 + (y - 25) / 65 * 0.5


# race: (african, asian, caucasian); skin in sRGB; outfit: garments cut from the helpers
CHARS = [
    dict(id='kai', gender=1.0, age=22, muscle=0.7, weight=0.42, height=0.52, race=(0.3, 0.4, 0.3), skin='#a8714d',
         hair='short', hair_col='#17120f', outfit=['boardshorts'], eye='#3b2414',
         targets={'nose/nose-flaring-incr': 0.4, 'mouth/mouth-scale-horiz-incr': 0.3, 'head/head-square': 0.3}),
    dict(id='koa', gender=1.0, age=56, muscle=0.5, weight=0.62, height=0.55, race=(0.0, 0.1, 0.9), skin='#d29a78',
         hair='short_grey', hair_col='#9a948c', outfit=['shirt', 'shorts'], eye='#4d6a7a', stubble=0.6,
         targets={'head/head-fat-incr': 0.3, 'nose/nose-scale-vert-incr': 0.3}),
    dict(id='chen', gender=1.0, age=48, muscle=0.5, weight=0.55, height=0.42, race=(0.0, 0.95, 0.05), skin='#c99a74',
         hair='short', hair_col='#1c1a19', outfit=['tshirt', 'shorts'], eye='#2b1a10',
         targets={'head/head-round': 0.4}),
    dict(id='noa', gender=1.0, age=31, muscle=0.62, weight=0.5, height=0.48, race=(0.9, 0.0, 0.1), skin='#6e4630',
         hair='buzz', hair_col='#0f0c0b', outfit=['tank', 'shorts'], eye='#1e120b', stubble=0.4,
         targets={'nose/nose-scale-horiz-incr': 0.3}),
    dict(id='leilani', gender=0.0, age=24, muscle=0.45, weight=0.45, height=0.5, race=(0.3, 0.4, 0.3), skin='#b07a55',
         hair='long', hair_col='#140f0c', outfit=['dress'], eye='#2c1a10',
         targets={'head/head-oval': 0.4, 'mouth/mouth-lowerlip-volume-incr': 0.3}),
    dict(id='lani', gender=0.0, age=28, muscle=0.55, weight=0.4, height=0.55, race=(0.0, 0.05, 0.95), skin='#dcab8a',
         hair='ponytail', hair_col='#b8925a', outfit=['tank', 'shorts'], eye='#3f6b8a',
         targets={'head/head-oval': 0.3, 'nose/nose-scale-horiz-decr': 0.3}),
    dict(id='mele', gender=0.0, age=42, muscle=0.45, weight=0.55, height=0.4, race=(0.0, 0.9, 0.1), skin='#d1a07c',
         hair='bob', hair_col='#191514', outfit=['tshirt', 'skirt'], eye='#2a1a10',
         targets={'head/head-round': 0.3}),
    dict(id='ama', gender=0.0, age=30, muscle=0.5, weight=0.52, height=0.5, race=(0.75, 0.0, 0.25), skin='#80543a',
         hair='bun', hair_col='#120d0b', outfit=['bikini'], eye='#1f130c',
         targets={'nose/nose-flaring-incr': 0.3, 'mouth/mouth-lowerlip-volume-incr': 0.4}),
    dict(id='boy', gender=1.0, age=8, muscle=0.5, weight=0.45, height=0.5, race=(0.2, 0.45, 0.35), skin='#b98058',
         hair='short', hair_col='#1a1410', outfit=['tshirt', 'shorts'], eye='#2c1a10', targets={}),
    dict(id='girl', gender=0.0, age=7, muscle=0.5, weight=0.45, height=0.5, race=(0.1, 0.3, 0.6), skin='#d6a07c',
         hair='ponytail', hair_col='#4a3020', outfit=['onepiece'], eye='#3a2614', targets={}),
]


# ---------------------------------------------------------------------------------------------
#  Body
# ---------------------------------------------------------------------------------------------
def build_body(S, spec):
    macro = S.TS.get_default_macro_info_dict()
    macro.update(gender=spec['gender'], age=years(spec['age']), muscle=spec['muscle'], weight=spec['weight'],
                 height=spec['height'], proportions=0.65, firmness=0.6, cupsize=0.5)
    af, asn, ca = spec['race']
    macro['race'] = {'african': af, 'asian': asn, 'caucasian': ca}
    h = S.HS.create_human(macro_detail_dict=macro)
    tdir = os.path.join(MPFB_SRC, 'data', 'targets')
    for name, w in spec.get('targets', {}).items():
        path = os.path.join(tdir, name + '.target.gz')
        if os.path.exists(path):
            S.TS.load_target(h, path, weight=w)
    S.TS.bake_targets(h)
    rig = S.HS.add_builtin_rig(h, 'mixamo')
    S.MS.create_v2_skin_material('skin', h)
    eyes = S.HS.add_mhclo_asset(os.path.join(MAKEHUMAN_DATA, 'eyes', 'high-poly', 'high-poly.mhclo'), h,
                                asset_type='Eyes', material_type='PROCEDURAL_EYES')
    rig.name = rig.data.name = spec['id']
    h.name = h.data.name = spec['id'] + '_body'
    eyes.name = eyes.data.name = spec['id'] + '_eyes'
    return rig, h, eyes


def landmarks(rig):
    b = {bn.name.split(':')[1]: bn for bn in rig.data.bones}
    hp = lambda n: np.array(b[n].head_local)  # noqa: E731
    return dict(hips=hp('Hips'), spine=hp('Spine'), spine1=hp('Spine1'), spine2=hp('Spine2'), neck=hp('Neck'), head=hp('Head'),
                head_top=np.array(b['Head'].tail_local), shoulder=hp('LeftArm'), elbow=hp('LeftForeArm'), wrist=hp('LeftHand'),
                hip=hp('LeftUpLeg'), knee=hp('LeftLeg'), ankle=hp('LeftFoot'), clavicle=hp('LeftShoulder'))


def seg_t(p, a, b):
    """Projection parameter of points p (N×3) on the segment a→b (0 at a, 1 at b)."""
    d = b - a
    return (p - a) @ d / (d @ d)


def mirror_x(p):
    q = p.copy()
    q[:, 0] = np.abs(q[:, 0])
    return q


def vertex_group_indices(obj, name, thresh=0.5):
    gi = obj.vertex_groups[name].index
    return np.array([v.index for v in obj.data.vertices if any(g.group == gi and g.weight > thresh for g in v.groups)], int)


# ---------------------------------------------------------------------------------------------
#  Clothes: faces cut from MakeHuman's fitting helpers, by regions measured from the skeleton
# ---------------------------------------------------------------------------------------------
class Regions:
    """Per-vertex body coordinates: height, distance along the limbs, front/back, and which part."""

    def __init__(self, p, L, nipple):
        self.p = p
        q = mirror_x(p)
        self.ax, self.y, self.z = q[:, 0], q[:, 1], q[:, 2]
        self.L, self.nip = L, nipple
        self.crotch = L['hip'][2] - 0.075
        self.front = self.y < L['spine1'][1]
        ua_t, fa_t = seg_t(q, L['shoulder'], L['elbow']), seg_t(q, L['elbow'], L['wrist'])
        d_ua = np.linalg.norm(q - (L['shoulder'] + np.clip(ua_t, 0, 1)[:, None] * (L['elbow'] - L['shoulder'])), axis=1)
        d_fa = np.linalg.norm(q - (L['elbow'] + np.clip(fa_t, 0, 1)[:, None] * (L['wrist'] - L['elbow'])), axis=1)
        self.arm_t = np.where(d_ua < d_fa, ua_t, 1 + np.clip(fa_t, 0, None))   # 0 shoulder, 1 elbow, 2 wrist
        self.arm = (np.minimum(d_ua, d_fa) < 0.085) & (self.arm_t > 0.1) & (self.ax > L['shoulder'][0] - 0.04)
        self.leg_t = seg_t(q, L['hip'], L['knee'])                          # 0 hip joint, 1 knee
        self.leg = (self.z < self.crotch + 0.02) | ((self.ax > 0.06) & (self.z < L['hip'][2]) & (self.leg_t > 0.12))
        self.torso = ~self.arm & ~self.leg & (self.z < L['neck'][2] + 0.02)


def garment_mask(R, kind):
    L, z, ax, front = R.L, R.z, R.ax, R.front
    hips, neck, sh, nip = L['hips'][2], L['neck'][2], L['shoulder'], R.nip
    hipzone = R.torso | (R.leg & (R.leg_t < 0.3))
    if kind == 'boardshorts':
        return (R.leg & (R.leg_t <= 0.5)) | (R.torso & (z <= hips + 0.045))
    if kind == 'shorts':
        return (R.leg & (R.leg_t <= 0.4)) | (R.torso & (z <= hips + 0.04))
    if kind in ('tshirt', 'shirt'):
        sleeve = 0.42 if kind == 'tshirt' else 0.52
        bottom = hips - (0.03 if kind == 'tshirt' else 0.07)
        vneck = 0.06 * np.clip(1 - ax / 0.05, 0, 1) if kind == 'shirt' else 0.0
        top = np.where(ax < 0.075, np.where(front, neck - 0.03 - vneck, neck - 0.005), neck + 0.08)
        return (R.torso & (z >= bottom) & (z <= top)) | (R.arm & (R.arm_t <= sleeve))
    if kind == 'tank':
        bust = front & (ax < 0.135) & (z <= nip[2] + 0.075 - 0.3 * np.clip(ax - 0.085, 0, None))
        back = ~front & (ax < 0.12) & (z <= sh[2] - 0.03)
        strap = (ax > 0.05) & (ax < 0.115) & (z <= sh[2] + 0.1)
        return R.torso & (z >= hips - 0.03) & ((z <= sh[2] - 0.09) | bust | back | strap)
    if kind == 'skirt':      # waistband from the tights; the skirt itself comes from the skirt helper
        return R.torso & (z >= hips + 0.02) & (z <= hips + 0.09)
    if kind == 'dress':
        bust = front & (ax < 0.13) & (z <= nip[2] + 0.06 - 0.3 * np.clip(ax - 0.09, 0, None))
        strap = (ax > 0.06) & (ax < 0.09) & (z <= sh[2] + 0.1)
        return R.torso & (z >= hips - 0.06) & ((z <= nip[2] - 0.02) | bust | strap)
    if kind == 'bikini':
        trunk = (ax < 0.165) & (z > R.crotch - 0.1) & (z < neck + 0.03)
        dx = np.abs(ax - nip[0])
        cups = trunk & front & (dx < 0.085) & (z > nip[2] - 0.075) & (z < nip[2] + 0.065 - 0.3 * dx)
        band = trunk & (z > nip[2] - 0.085) & (z < nip[2] - 0.05)
        strap = trunk & (np.abs(ax - nip[0] + 0.02) < 0.02) & (z > nip[2]) & (z < sh[2] + 0.1)
        bottom = trunk & (z <= hips - 0.035) & (z >= R.crotch - 0.08) & (ax < 0.06 + 1.1 * np.clip(z - R.crotch + 0.03, 0, None))
        return cups | band | strap | bottom
    if kind == 'onepiece':
        bust = front & (ax < 0.13) & (z <= nip[2] + 0.065)
        strap = (ax > 0.045) & (ax < 0.08) & (z <= sh[2] + 0.1)
        legcut = ax < 0.08 + 0.9 * np.clip(z - R.crotch + 0.02, 0, None)
        return hipzone & legcut & (z >= R.crotch - 0.07) & ((z <= nip[2] - 0.01) | bust | strap)
    raise ValueError(kind)


# loosening (metres, along the normal) and how much the hem flares out
# swimwear is cut from the (finer) skin itself; everything else from the looser tights helper
SKIN_TIGHT = {'bikini', 'onepiece'}
FIT = {'boardshorts': (0.012, 0.02), 'shorts': (0.006, 0.012), 'tshirt': (0.012, 0.012), 'shirt': (0.016, 0.016),
       'tank': (0.004, 0.0), 'skirt': (0.006, 0.0), 'dress': (0.004, 0.0), 'bikini': (0.0025, 0.0), 'onepiece': (0.0025, 0.0)}


def faces_where(obj, vmask):
    return [p.index for p in obj.data.polygons if all(vmask[i] for i in p.vertices)]


def split_faces(obj, face_ids, name):
    """A copy of obj holding only the given faces (vertex groups, modifiers and parent are kept)."""
    new = obj.copy()
    new.data = obj.data.copy()
    new.name = new.data.name = name
    bpy.context.scene.collection.objects.link(new)
    keep = set(face_ids)
    bm = bmesh.new()
    bm.from_mesh(new.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(new.data)
    bm.free()
    for m in list(new.modifiers):
        if m.type != 'ARMATURE':
            new.modifiers.remove(m)
    return new


def subdivide(obj, levels=1):
    m = obj.modifiers.new('sub', 'SUBSURF')
    m.levels = m.render_levels = levels
    m.uv_smooth = 'PRESERVE_BOUNDARIES'
    bpy.context.view_layer.objects.active = obj
    with bpy.context.temp_override(object=obj):
        bpy.ops.object.modifier_move_to_index(modifier='sub', index=0)
        bpy.ops.object.modifier_apply(modifier='sub')


def inflate(obj, amount, flare=0.0, hem_from=None):
    """Push the shell out along its normals; near open edges ("hems") push further to make it hang loose."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    bm.normal_update()
    boundary = {v.index for e in bm.edges if e.is_boundary for v in e.verts}
    dist = {i: 0 for i in boundary}
    frontier = list(boundary)
    for ring in range(1, 4):     # graph distance from the hem, a few rings deep
        nxt = []
        for i in frontier:
            for e in bm.verts[i].link_edges:
                j = e.other_vert(bm.verts[i]).index
                if j not in dist:
                    dist[j] = ring
                    nxt.append(j)
        frontier = nxt
    for v in bm.verts:
        k = dist.get(v.index, 4)
        extra = flare * (1 - k / 4) if hem_from is None or v.co.z < hem_from else 0.0
        v.co += v.normal * (amount + extra)
    bm.to_mesh(obj.data)
    bm.free()


def smooth_hems(obj, iters=8):
    """Straighten the stair-stepped open edges left by cutting along mesh faces."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bnd = {}
    for e in bm.edges:
        if e.is_boundary:
            a, b = e.verts
            bnd.setdefault(a, []).append(b)
            bnd.setdefault(b, []).append(a)
    for _ in range(iters):
        new = {v: (v.co * 0.5 + (nb[0].co + nb[1].co) * 0.25) for v, nb in bnd.items() if len(nb) == 2}
        for v, c in new.items():
            v.co = c
    bm.to_mesh(obj.data)
    bm.free()


def build_clothes(rig, body, spec):
    me = body.data
    p = np.array([v.co[:] for v in me.vertices])
    L = landmarks(rig)
    nip_idx = vertex_group_indices(body, 'nipple')
    nip = mirror_x(p[nip_idx]).mean(0) if len(nip_idx) else np.array([0.08, -0.15, L['spine2'][2]])
    R = Regions(p, L, nip)
    tights = np.zeros(len(p), bool)
    tights[vertex_group_indices(body, 'helper-tights')] = True
    skirt = np.zeros(len(p), bool)
    skirt[vertex_group_indices(body, 'helper-skirt')] = True
    skin = np.zeros(len(p), bool)
    skin[vertex_group_indices(body, 'body')] = True
    pieces = []
    for kind in spec['outfit']:
        mask = garment_mask(R, kind) & (skin if kind in SKIN_TIGHT else tights)
        if kind in ('skirt', 'dress'):
            top = L['hips'][2] + (0.07 if kind == 'skirt' else 0.05)
            mask |= skirt & (R.z >= L['knee'][2] + (0.05 if kind == 'skirt' else -0.02)) & (R.z <= top)
        faces = faces_where(body, mask)
        if not faces:
            continue
        g = split_faces(body, faces, f"{spec['id']}_{kind}")
        if kind not in SKIN_TIGHT:
            subdivide(g, 1)
        smooth_hems(g, 14 if kind in SKIN_TIGHT else 8)
        loose, flare = FIT[kind]
        inflate(g, loose, flare, hem_from=L['hips'][2] if kind in ('tshirt', 'shirt') else None)
        g['garment'] = kind
        pieces.append(g)
    return pieces


def strip_helpers(body):
    """Delete MakeHuman's helper geometry (fitting meshes, joint cubes); only the skin stays."""
    keep = np.zeros(len(body.data.vertices), bool)
    keep[vertex_group_indices(body, 'body')] = True
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not keep[v.index]], context='VERTS')
    bm.to_mesh(body.data)
    bm.free()
    for m in list(body.modifiers):
        if m.type == 'MASK':
            body.modifiers.remove(m)


def hide_covered(body, pieces, reach=0.06):
    """Delete skin that sits fully under clothes (with a one-ring margin), so it can't poke through."""
    from mathutils.bvhtree import BVHTree
    deps = bpy.context.evaluated_depsgraph_get()
    trees = [BVHTree.FromObject(g, deps) for g in pieces if g.get('garment') not in ('skirt', 'dress')]
    trees += [BVHTree.FromObject(g, deps) for g in pieces if g.get('garment') in ('skirt', 'dress')]
    if not trees:
        return
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.normal_update()
    covered = np.zeros(len(bm.verts), bool)
    for v in bm.verts:
        for t in trees:
            hit = t.ray_cast(v.co + v.normal * 0.001, v.normal, reach)
            if hit[0] is not None:
                covered[v.index] = True
                break
    core = covered.copy()          # erode by one ring so the hems still have skin under them
    for v in bm.verts:
        if covered[v.index] and not all(covered[e.other_vert(v).index] for e in v.link_edges):
            core[v.index] = False
    dead = [f for f in bm.faces if all(core[v.index] for v in f.verts)]
    bmesh.ops.delete(bm, geom=dead, context='FACES_ONLY')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(body.data)
    bm.free()


# ---------------------------------------------------------------------------------------------
#  Hair: a cap over the scalp and strand cards grown over it (atlas: four card strips + a dense cap strip)
# ---------------------------------------------------------------------------------------------
HAIR_STRIPS = 4
CAP_U = (0.8, 1.0)
STYLES = {
    'buzz': dict(cap=0.0025),
    'short': dict(cap=0.005, cards=520, length=(0.045, 0.085), width=(0.016, 0.026), gravity=0.35),
    'short_grey': dict(cap=0.005, cards=480, length=(0.04, 0.075), width=(0.016, 0.026), gravity=0.4),
    'bob': dict(cap=0.006, cards=520, length=(0.15, 0.22), width=(0.02, 0.032), gravity=1.2, cut='jaw', step=0.03),
    'long': dict(cap=0.006, cards=560, length=(0.3, 0.42), width=(0.026, 0.04), gravity=1.4, step=0.04),
    'ponytail': dict(cap=0.004, cards=380, length=(0.05, 0.09), width=(0.015, 0.024), gravity=0.0, to='tail',
                     tail=dict(n=60, length=(0.2, 0.28))),
    'bun': dict(cap=0.004, cards=380, length=(0.05, 0.09), width=(0.015, 0.024), gravity=0.0, to='bun', bun=dict(n=70, r=0.042)),
}


def head_frame(body, rig):
    p = np.array([v.co[:] for v in body.data.vertices])
    L = landmarks(rig)
    scalp = p[vertex_group_indices(body, 'scalp')]
    ears = p[vertex_group_indices(body, 'ears')]
    lips = p[vertex_group_indices(body, 'lips')]
    top = scalp[np.argmax(scalp[:, 2])]
    head = p[(p[:, 2] > L['head'][2]) & (np.abs(p[:, 0]) < 0.12)]
    centre = np.array([0.0, (head[:, 1].min() + head[:, 1].max()) / 2, (L['head'][2] + top[2]) / 2 + 0.01])
    return dict(p=p, top=top, centre=centre, back=head[:, 1].max(), front=head[:, 1].min(), ear_z=(ears[:, 2].min(), ears[:, 2].max()),
                ear_y=(ears[:, 1].min(), ears[:, 1].max()), ear_x=np.abs(ears[:, 0]).min(), chin=lips[:, 2].min() - 0.045,
                brow=lips[:, 2].max() + 0.075, neck=L['neck'][2], spine2=L['spine2'][2], L=L)


def hair_region(H):
    """Body vertices where hair grows: the MakeHuman scalp, down the back of the skull to the nape, over the temples."""
    p = H['p']
    z, y, ax = p[:, 2], p[:, 1], np.abs(p[:, 0])
    ez0, ez1 = H['ear_z']
    ey0, ey1 = H['ear_y']
    behind_ears = (y > ey1 - 0.005) & (z > H['neck'] + 0.075 - 0.25 * np.clip(ax - 0.03, 0, None))
    above_ears = (z > ez1 - 0.005) & (y > ey0 - 0.035)
    temples = (z > H['brow'] + 0.01) & (ax > 0.045)
    forehead = z > H['brow'] + 0.035 + 0.06 * np.clip(0.04 - ax, 0, None) / 0.04 * 0.3
    in_head = (z > ez0 - 0.02) & (ax < 0.12)
    ear_hole = (np.abs(ax - H['ear_x'] - 0.01) < 0.025) & (z > ez0) & (z < ez1) & (y > ey0 - 0.01) & (y < ey1 + 0.01)
    return in_head & (behind_ears | above_ears | temples | forehead) & ~ear_hole


def strand_atlas(path, size=1024, seed=3):
    """Grey strand atlas with alpha: four card strips (u 0..0.8) and a dense, opaque cap strip (u 0.8..1).
    Roots at the top of the image (v = 1 in Blender's UVs)."""
    from PIL import Image, ImageDraw
    rng = np.random.default_rng(seed)
    S = size * 2
    col = Image.new('L', (S, S), 0)
    alpha = Image.new('L', (S, S), 0)
    dc, da = ImageDraw.Draw(col), ImageDraw.Draw(alpha)
    strip_w = int(S * CAP_U[0] / HAIR_STRIPS)

    def strand(x0, x1, tip, w, b, amp, freq, ph):
        ys = np.linspace(0, tip, 40)
        xs = x0 + (x1 - x0) * ys / S + amp * np.sin(ys / S * freq * 6.283 + ph)
        pts = list(zip(xs, ys))
        for i in range(len(pts) - 1):
            t = i / (len(pts) - 1)
            a = int(255 * (1 - max(0, t - 0.7) / 0.3 * 0.85))
            shade = int(255 * b * (0.62 + 0.38 * min(1, t * 4)))      # darker at the roots
            ww = max(1, int(round(w * (1 - 0.5 * t))))
            da.line([pts[i], pts[i + 1]], fill=a, width=ww)
            dc.line([pts[i], pts[i + 1]], fill=shade, width=ww)
    for k in range(HAIR_STRIPS):
        x_lo, x_hi = k * strip_w, (k + 1) * strip_w
        for _ in range(260):
            x0 = rng.uniform(x_lo + 8, x_hi - 8)
            strand(x0, x0 + rng.normal(0, 6), S * rng.uniform(0.72, 1.0), rng.uniform(2.0, 4.2), rng.uniform(0.55, 1.0),
                   rng.uniform(1, 5) * (1 + k * 0.6), rng.uniform(1, 3), rng.uniform(0, 6.3))
    cap0 = int(S * CAP_U[0])
    da.rectangle([cap0, 0, S, S], fill=255)
    dc.rectangle([cap0, 0, S, S], fill=118)
    for _ in range(900):
        x0 = rng.uniform(cap0, S)
        strand(x0, x0 + rng.normal(0, 4), S, rng.uniform(2.0, 3.5), rng.uniform(0.6, 1.0), rng.uniform(1, 3), rng.uniform(1, 3), rng.uniform(0, 6.3))
    da.rectangle([cap0, 0, S, S], fill=255)
    img = Image.merge('RGBA', [col, col, col, alpha]).resize((size, size), Image.LANCZOS)
    a = np.asarray(img).astype(np.float32)
    # bleed colour into transparent texels so mipmaps don't darken the strand edges
    rgb, al = a[..., :3], a[..., 3:4] / 255
    from PIL import ImageFilter
    blur = np.asarray(Image.fromarray(np.uint8(rgb[..., 0] * al[..., 0])).filter(ImageFilter.GaussianBlur(6)), np.float32)
    wsum = np.asarray(Image.fromarray(np.uint8(al[..., 0] * 255)).filter(ImageFilter.GaussianBlur(6)), np.float32) / 255
    fill = blur / np.maximum(wsum, 1e-3)
    g = np.where(al[..., 0] > 0.02, rgb[..., 0], fill)
    out = np.dstack([g, g, g, a[..., 3]]).clip(0, 255).astype(np.uint8)
    Image.fromarray(out, 'RGBA').save(path, quality=88, method=6)


def make_cap(body, H, style, name):
    region = hair_region(H)
    faces = faces_where(body, region)
    cap = split_faces(body, faces, name)
    smooth_hems(cap, 6)
    inflate(cap, style['cap'])
    crown_uvs(cap, H)
    return cap


def grow_cards(cap, body, H, style, rng):
    """Strand cards rooted on the cap, combed away from the crown (or towards a ponytail / bun): they follow the
    skull down to below the ears, then fall under gravity, kept off the face, neck and shoulders."""
    from mathutils.bvhtree import BVHTree
    deps = bpy.context.evaluated_depsgraph_get()
    tree = BVHTree.FromObject(cap, deps)
    btree = BVHTree.FromObject(body, deps)
    me = cap.data
    tris = [(me.vertices[a].co.copy(), me.vertices[b].co.copy(), me.vertices[c].co.copy())
            for poly in me.polygons for a, b, c in [(poly.vertices[0], poly.vertices[i], poly.vertices[i + 1]) for i in range(1, len(poly.vertices) - 1)]]
    areas = np.array([((b - a).cross(c - a)).length / 2 for a, b, c in tris])
    pick = rng.choice(len(tris), size=style.get('cards', 0), p=areas / areas.sum())
    crown = Vector(H['top']) + Vector((0, 0.015, -0.01))
    target = None
    if style.get('to') == 'tail':
        target = Vector((0, H['back'] + 0.012, H['centre'][2] - 0.005))
    elif style.get('to') == 'bun':
        target = Vector((0, H['back'] - 0.005, H['top'][2] - 0.035))
    down = Vector((0, 0, -1))
    skull_bottom = H['ear_z'][0] - 0.01
    cards = []
    for ti in pick:
        a, b, c = tris[ti]
        r1, r2 = rng.random(), rng.random()
        if r1 + r2 > 1:
            r1, r2 = 1 - r1, 1 - r2
        p = a + (b - a) * r1 + (c - a) * r2
        L0 = rng.uniform(*style['length'])
        if target is not None:
            L0 = (target - p).length * 1.02
        segs = max(3, int(L0 / style.get('step', 0.02)))
        step = L0 / segs
        pts, nrms = [], []
        loc, n, _, _ = tree.find_nearest(p)
        d = (target - p) if target is not None else (p - crown)
        if target is None and abs(p.x) < 0.015 and p.y < H['centre'][1]:
            d.x += 0.04 if p.x >= 0 else -0.04                       # centre parting
        d = d - n * d.dot(n)
        d = d.normalized() if d.length > 1e-6 else down.copy()
        lift = 0.002 + rng.uniform(0, 0.004)
        for i in range(segs + 1):
            t = i / segs
            loc, n, _, _ = tree.find_nearest(p)
            want = lift + 0.003 * t
            on_skull = p.z > skull_bottom and (p - loc).length < 0.03
            if on_skull or (p - loc).dot(n) < want:
                p = loc + n * want                                   # lie on the head
            hit = btree.find_nearest(p)
            if hit[0] is not None and (p - hit[0]).dot(hit[1]) < 0.012:
                p = hit[0] + hit[1] * 0.012                          # never inside the neck or shoulders
            pts.append(p.copy())
            nrms.append(n.copy() if on_skull else (n * 0.5 + (p - Vector(H['centre'])).normalized() * 0.5).normalized())
            if style.get('cut') == 'jaw' and p.z < H['chin'] + 0.015:
                break
            if target is not None:
                nd = (target - p)
                if nd.length < step:
                    break
                nd.normalize()
            else:
                nd = d + down * style['gravity'] * step * (4 + 10 * t)
            if on_skull:
                nd = nd - n * nd.dot(n)                              # stay tangent to the skull
            nd = nd.normalized() if nd.length > 1e-6 else down.copy()
            if p.y < H['centre'][1] - 0.02 and abs(p.x) < 0.08 and H['chin'] - 0.02 < p.z < H['brow'] + 0.03:
                nd.x += 0.6 if p.x >= 0 else -0.6                    # keep strands off the face
                nd = nd.normalized()
            d = nd
            p = p + d * step
        if len(pts) >= 2:
            cards.append((pts, nrms, rng.uniform(*style['width']), int(rng.integers(HAIR_STRIPS))))
    if style.get('to') == 'tail':
        tail = style['tail']
        for k in range(tail['n']):
            ang = k / tail['n'] * 2 * math.pi + rng.normal(0, 0.2)
            r0 = 0.012 * rng.uniform(0.3, 1.0)
            p = target + Vector((math.cos(ang) * r0, 0.004, math.sin(ang) * r0))
            d = Vector((rng.normal(0, 0.15), 0.6, -0.8)).normalized()
            L0 = rng.uniform(*tail['length'])
            segs = int(L0 / 0.025)
            pts, nrms = [], []
            for i in range(segs + 1):
                t = i / segs
                spread = 0.012 + 0.02 * math.sin(min(1, t * 1.6) * math.pi * 0.5)
                q = p + Vector((math.cos(ang) * spread * 0.7, math.sin(ang) * spread * 0.35, 0))
                pts.append(q)
                nrms.append((q - Vector((0, p.y, p.z))).normalized() if (q - Vector((0, p.y, p.z))).length > 1e-5 else Vector((0, 1, 0)))
                d = (d + Vector((0, -0.25 * d.y, -1)) * 0.35).normalized()
                p = p + d * (L0 / segs)
            cards.append((pts, nrms, rng.uniform(0.02, 0.03), int(rng.integers(HAIR_STRIPS))))
    if style.get('to') == 'bun':
        bun = style['bun']
        cen = target + Vector((0, bun['r'] * 0.8, 0.0))
        for k in range(bun['n']):
            axis = Vector(rng.normal(0, 1, 3)).normalized()
            start = axis.orthogonal().normalized()
            pts, nrms = [], []
            arc = rng.uniform(2.0, 3.6)
            for i in range(9):
                a = arc * i / 8
                v = start * math.cos(a) + axis.cross(start) * math.sin(a)
                r = bun['r'] * rng.uniform(0.95, 1.08) if i == 0 else bun['r'] * (1 + 0.05 * math.sin(i))
                pts.append(cen + v * r)
                nrms.append(v.copy())
            cards.append((pts, nrms, rng.uniform(0.022, 0.032), int(rng.integers(HAIR_STRIPS))))
    return cards


def cards_mesh(cards, name):
    verts, faces, uvs, norms = [], [], [], []
    for pts, nrms, width, k in cards:
        u0, u1 = k / HAIR_STRIPS * CAP_U[0], (k + 1) / HAIR_STRIPS * CAP_U[0]
        n = len(pts)
        base = len(verts)
        for i, (p, nr) in enumerate(zip(pts, nrms)):
            t = i / (n - 1)
            d = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
            side = d.cross(nr)
            side = side.normalized() if side.length > 1e-6 else Vector((1, 0, 0))
            w = width * (1 - 0.45 * t) / 2
            verts += [p - side * w, p + side * w]
            norms += [nr, nr]
            uvs += [(u0, 1 - t), (u1, 1 - t)]
        for i in range(n - 1):
            a = base + i * 2
            faces.append((a, a + 1, a + 3, a + 2))
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    uvl = me.uv_layers.new(name='UVMap')
    loop_vi = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get('vertex_index', loop_vi)
    uvl.data.foreach_set('uv', np.array(uvs, np.float32)[loop_vi].ravel())
    me.shade_smooth()
    me.normals_split_custom_set_from_vertices([tuple(nv) for nv in norms])
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def skin_from(body, obj, H, long_hair=False):
    """Weights for hair: the nearest skin vertex's weights (all head); long hair below the neck follows the upper spine."""
    from mathutils.kdtree import KDTree
    bme = body.data
    kd = KDTree(len(bme.vertices))
    for v in bme.vertices:
        kd.insert(v.co, v.index)
    kd.balance()
    names = {g.index: g.name for g in body.vertex_groups}
    groups = {}
    for v in obj.data.vertices:
        _, idx, _ = kd.find(v.co)
        ws = {names[g.group]: g.weight for g in bme.vertices[idx].groups if names[g.group].startswith('mixamorig')}
        if long_hair and v.co.z < H['neck'] + 0.02:
            k = min(1.0, (H['neck'] + 0.02 - v.co.z) / 0.12)
            ws = {n: w * (1 - k) for n, w in ws.items()}
            ws['mixamorig:Spine2'] = ws.get('mixamorig:Spine2', 0) + k
        for n, w in ws.items():
            groups.setdefault(n, []).append((v.index, w))
    for n, lst in groups.items():
        g = obj.vertex_groups.get(n) or obj.vertex_groups.new(name=n)
        for i, w in lst:
            g.add([i], w, 'REPLACE')


def crown_uvs(obj, H):
    """Strands flow out from the crown: u around it, v away from it, inside the dense cap strip of the atlas."""
    me = obj.data
    uv = me.uv_layers[0] if me.uv_layers else me.uv_layers.new()
    c = H['top'] + np.array([0, 0.015, -0.01])
    for poly in me.polygons:
        us = []
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index].co
            d = np.array(v) - c
            ang = math.atan2(d[0], d[1]) / (2 * math.pi) + 0.5
            rho = np.linalg.norm(d[[0, 1]]) + max(0.0, -d[2]) * 1.2
            us.append([ang * 5, 1.0 - min(rho / 0.5, 1.0)])
        us = np.array(us)
        us[:, 0] -= math.floor(us[:, 0].min())          # keep each face inside one repeat (no seam smear)
        for li, (u, v) in zip(poly.loop_indices, us):
            uv.data[li].uv = (CAP_U[0] + (CAP_U[1] - CAP_U[0]) * min(u, 0.999), v)


def build_hair(rig, body, spec, shell=None):
    style = STYLES[spec['hair']]
    H = head_frame(body, rig)
    cap = make_cap(body, H, style, spec['id'] + '_hair')
    parts = [cap]
    if shell is not None:
        crown_uvs(shell, H)
        parts.append(shell)
    if style.get('cards') or style.get('to'):
        rng = np.random.default_rng(abs(hash(spec['id'])) % 2 ** 31)
        cards = cards_mesh(grow_cards(cap, body, H, style, rng), spec['id'] + '_cards')
        skin_from(body, cards, H, long_hair=spec['hair'] == 'long')
        cards.parent = rig
        mod = cards.modifiers.new('rig', 'ARMATURE')
        mod.object = rig
        parts.append(cards)
    # join cap + cards into one hair object
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = cap
    if len(parts) > 1:
        bpy.ops.object.join()
    cap['hair'] = spec['hair']
    return cap


def hair_shell(rig, body, spec):
    """Long hair and bobs get a solid inner volume from MakeHuman's hair helper, so the cards only have to
    add the strands on top of it."""
    if spec['hair'] not in ('long', 'bob'):
        return None
    p = np.array([v.co[:] for v in body.data.vertices])
    m = np.zeros(len(p), bool)
    m[vertex_group_indices(body, 'helper-hair')] = True
    lips = p[vertex_group_indices(body, 'lips')]
    if spec['hair'] == 'bob':
        m &= p[:, 2] > lips[:, 2].min() - 0.03
    faces = faces_where(body, m)
    if not faces:
        return None
    shell = split_faces(body, faces, spec['id'] + '_shell')
    smooth_hems(shell, 8)
    inflate(shell, 0.004)
    return shell


def build_character(S, spec):
    rig, body, eyes = build_body(S, spec)
    pieces = build_clothes(rig, body, spec)
    shell = hair_shell(rig, body, spec)
    strip_helpers(body)
    hide_covered(body, pieces)
    hair = build_hair(rig, body, spec, shell)
    return rig, body, eyes, pieces, hair


# ---------------------------------------------------------------------------------------------
#  Materials, decimation, baking and export
# ---------------------------------------------------------------------------------------------
PRINTS = {'shirt': 'flowers', 'dress': 'small_flowers', 'boardshorts': 'side_stripe'}


def set_colours(body, eyes, spec):
    tone = lin(spec['skin'])
    lips = tuple(t * 0.62 + c for t, c in zip(tone, (0.09, 0.02, 0.02)))
    for n in body.data.materials[0].node_tree.nodes:
        if n.type != 'GROUP':
            continue
        name = n.node_tree.name
        if name == 'MpfbSkinMasterColor':
            vals = {'SkinColor': tone, 'LipsColor': lips, 'EyelidColor': tuple(t * 0.7 for t in tone),
                    'AureolaeColor': tuple(t * 0.75 for t in tone), 'NavelCenterColor': tuple(t * 0.6 for t in tone),
                    'FingernailsColor': tuple(t * 0.5 + 0.45 for t in tone), 'ToenailsColor': tuple(t * 0.5 + 0.45 for t in tone)}
            for k, v in vals.items():
                n.inputs[k].default_value = (*v, 1)
            for k in ('SkinOverride', 'LipsOverride', 'EyelidOverride', 'AurolaeOverride', 'NavelCenterOverride', 'FingernailsOverride', 'ToenailsOverride'):
                n.inputs[k].default_value = 1.0
        if 'SpotStrength' in n.inputs:
            n.inputs['SpotStrength'].default_value = 0.35
    iris = lin(spec['eye'])
    for mat in eyes.data.materials:
        for n in mat.node_tree.nodes:
            if n.type == 'GROUP':
                for k, v in (('IrisMajorColor', iris), ('IrisMinorColor', tuple(c * 0.55 for c in iris))):
                    if k in n.inputs:
                        n.inputs[k].default_value = (*v, 1)


def decimate(obj, faces, protect=None):
    """Collapse-decimate to about `faces` triangles; a protect mask (per vertex, 1 = keep detail) spares the face."""
    me = obj.data
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    if tris <= faces:
        return
    m = obj.modifiers.new('dec', 'DECIMATE')
    m.decimate_type = 'COLLAPSE'
    m.ratio = faces / tris
    m.use_collapse_triangulate = True
    m.use_symmetry = True
    m.symmetry_axis = 'X'
    if protect is not None:
        g = obj.vertex_groups.new(name='_decimate')
        for i, w in enumerate(protect):
            g.add([i], float(1.0 - w), 'REPLACE')
        m.vertex_group = '_decimate'
        m.vertex_group_factor = 1.0
    bpy.context.view_layer.objects.active = obj
    with bpy.context.temp_override(object=obj):
        bpy.ops.object.modifier_move_to_index(modifier='dec', index=0)
        bpy.ops.object.modifier_apply(modifier='dec')
    if protect is not None:
        obj.vertex_groups.remove(obj.vertex_groups['_decimate'])


def bake(obj, kind, res, samples=1, margin=6, pass_filter=None, mats=None):
    """Cycles bake of one object into a float image; returns [res, res, 4] with row 0 = v 0."""
    sc = bpy.context.scene
    sc.cycles.samples = samples
    img = bpy.data.images.new('bake_' + obj.name, res, res, float_buffer=True, alpha=True)
    nodes = []
    for mat in (mats or obj.data.materials):
        tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image = img
        for nd in mat.node_tree.nodes:
            nd.select = False
        tex.select = True
        mat.node_tree.nodes.active = tex
        nodes.append((mat, tex))
    select_only(obj)
    kw = dict(type=kind, margin=margin, use_clear=True)
    if pass_filter:
        kw['pass_filter'] = pass_filter
    if kind == 'NORMAL':
        kw['normal_space'] = 'TANGENT'
    bpy.ops.object.bake(**kw)
    buf = np.empty(res * res * 4, np.float32)
    img.pixels.foreach_get(buf)
    for mat, tex in nodes:
        mat.node_tree.nodes.remove(tex)
    bpy.data.images.remove(img)
    return buf.reshape(res, res, 4)


def select_only(obj):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def bake_geometry(obj, res):
    """Object-space position and normal per texel (plus coverage), through a temporary emission material."""
    keep = list(obj.data.materials)
    mat = bpy.data.materials.new('_geo')
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    nt.links.new(tc.outputs['Object'], em.inputs['Color'])
    pos = bake(obj, 'EMIT', res, mats=[mat], margin=4)
    vm = nt.nodes.new('ShaderNodeVectorTransform')
    vm.vector_type, vm.convert_from, vm.convert_to = 'NORMAL', 'WORLD', 'OBJECT'
    nt.links.new(geo.outputs['Normal'], vm.inputs[0])
    nt.links.new(vm.outputs[0], em.inputs['Color'])
    nrm = bake(obj, 'EMIT', res, mats=[mat], margin=4)
    obj.data.materials.clear()
    for m in keep:
        obj.data.materials.append(m)
    bpy.data.materials.remove(mat)
    return pos[..., :3], nrm[..., :3], pos[..., 3] > 0.5


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def value_noise(p, freq, seed=0):
    """Cheap 3D value noise on arrays of points."""
    q = p * freq + seed * 17.13
    i = np.floor(q)
    f = q - i
    f = f * f * (3 - 2 * f)

    def h(ix, iy, iz):
        n = np.sin(ix * 127.1 + iy * 311.7 + iz * 74.7 + seed) * 43758.5453
        return n - np.floor(n)
    out = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (f[..., 0] if dx else 1 - f[..., 0]) * (f[..., 1] if dy else 1 - f[..., 1]) * (f[..., 2] if dz else 1 - f[..., 2])
                out = out + w * h(i[..., 0] + dx, i[..., 1] + dy, i[..., 2] + dz)
    return out


def skin_overlays(alb, pos, nrm, cov, eyes, body, spec):
    """Paint what the skin shader lacks: eyebrows, a lash line, and stubble on the men's jaws."""
    ep = np.array([v.co[:] for v in eyes.data.vertices])
    eye = np.array([ep[ep[:, 0] > 0].mean(0), ep[ep[:, 0] < 0].mean(0)])
    lips = np.array([v.co[:] for v in body.data.vertices])[vertex_group_indices(body, 'lips')]
    hair = np.array(lin(spec['hair_col']))
    brow_col = hair * 0.75 if hair.mean() < 0.25 else hair * 0.45 + 0.02
    ax = np.abs(pos[..., 0])
    front = nrm[..., 1] < -0.15
    E = eye[0]
    k = 0.75 if spec['age'] < 12 else 1.0
    # eyebrows: an arched band over each eye, thick at the inner end, with hair-like streaks
    s = (ax - (E[0] - 0.024)) / 0.052
    zc = E[2] + 0.021 + 0.007 * np.sin(np.pi * np.clip(s, 0, 1) * 0.95) - 0.004 * s
    th = (0.0056 * (1 - s) + 0.0021) * (0.85 if spec['gender'] < 0.5 else 1.1)
    brow = smoothstep(th, th * 0.45, np.abs(pos[..., 2] - zc)) * smoothstep(-0.05, 0.08, s) * smoothstep(1.05, 0.85, s)
    brow *= front * (pos[..., 1] < E[1] + 0.012) * cov
    streak = 0.55 + 0.45 * np.sin(ax * 2400 + pos[..., 2] * 900 + value_noise(pos, 300) * 6)
    brow *= streak * 0.9 * k
    alb[..., :3] = alb[..., :3] * (1 - brow[..., None]) + brow_col * brow[..., None]
    # lash line: a dark rim around each eye opening, heavier on the upper lid
    dx = (ax - E[0]) / 0.0145
    dz = (pos[..., 2] - E[2] + 0.001) / 0.0068
    r = np.sqrt(dx * dx + dz * dz)
    upper = (dz > -0.2)
    lash = smoothstep(0.32, 0.0, np.abs(r - 1.0)) * front * (pos[..., 1] < E[1]) * cov
    lash *= np.where(upper, 0.75, 0.3) * (smoothstep(1.35, 0.8, np.abs(dx)))
    alb[..., :3] = alb[..., :3] * (1 - lash[..., None] * 0.85) + np.array([0.012, 0.008, 0.006]) * lash[..., None] * 0.85
    # stubble
    st = spec.get('stubble', 0.0)
    if st > 0:
        lip_c = lips.mean(0)
        jaw = (pos[..., 2] < E[2] - 0.035) & (pos[..., 2] > lip_c[2] - 0.075) & (pos[..., 1] < E[1] + 0.045)
        lipzone = (np.abs(pos[..., 0]) < 0.03) & (np.abs(pos[..., 2] - lip_c[2]) < 0.013)
        dots = smoothstep(0.55, 0.85, value_noise(pos, 900, 3))
        m = jaw * ~lipzone * cov * smoothstep(E[2] - 0.035, E[2] - 0.06, pos[..., 2])
        m = m * (0.45 + 0.55 * dots) * st * 0.45
        alb[..., :3] = alb[..., :3] * (1 - m[..., None]) + hair * 0.4 * m[..., None]
    return alb


def print_mask(kind, pos, nrm, cov, seed):
    """G channel of the cloth texture: where the second colour (a print) goes."""
    style = PRINTS.get(kind)
    if style in ('flowers', 'small_flowers'):
        cell = 0.065 if style == 'flowers' else 0.042
        q = pos / cell
        i = np.floor(q)
        rnd = lambda a, b: (np.sin(i[..., 0] * a + i[..., 1] * b + i[..., 2] * 7.3 + seed) * 43758.5) % 1.0  # noqa: E731
        c = (i + np.dstack([rnd(12.9, 78.2), rnd(39.3, 11.1), rnd(73.1, 52.7)]) * 0.6 + 0.2) * cell
        d = pos - c
        rr = np.linalg.norm(d, axis=-1) / cell
        ang = np.arctan2(d[..., 2], d[..., 0] + d[..., 1])
        petal = 0.32 * (0.72 + 0.28 * np.cos(5 * ang + rnd(5.1, 9.7) * 6))
        m = smoothstep(petal, petal - 0.04, rr) * (rnd(91.7, 23.3) < 0.8)
        leaf = smoothstep(0.42, 0.38, np.abs(rr - 0.5 - 0.1 * np.sin(3 * ang))) * (rnd(3.3, 61.1) > 0.55) * 0.5
        return np.clip(m + leaf * (1 - m), 0, 1) * cov
    if style == 'side_stripe':
        return smoothstep(0.82, 0.9, nrm[..., 0] * np.sign(pos[..., 0])) * cov
    return np.zeros(pos.shape[:2])


def cloth_bake_material(name):
    """Fabric for baking: weave and soft folds as bump, so Cycles can bake a tangent normal map and AO."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    wave = nt.nodes.new('ShaderNodeTexWave')
    wave.wave_type = 'BANDS'
    wave.bands_direction = 'Z'
    wave.inputs['Scale'].default_value = 9.0
    wave.inputs['Distortion'].default_value = 6.0
    wave.inputs['Detail'].default_value = 2.0
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 900.0
    mixh = nt.nodes.new('ShaderNodeMath')
    mixh.operation = 'MULTIPLY_ADD'
    mixh.inputs[1].default_value = 0.08
    nt.links.new(tc.outputs['Object'], wave.inputs['Vector'])
    nt.links.new(tc.outputs['Object'], noise.inputs['Vector'])
    nt.links.new(noise.outputs['Fac'], mixh.inputs[0])
    nt.links.new(wave.outputs['Fac'], mixh.inputs[2])
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.35
    bump.inputs['Distance'].default_value = 0.004
    nt.links.new(mixh.outputs[0], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return mat


def smart_uv(obj, margin=0.02):
    select_only(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=margin, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')


def join(objs, name):
    objs = [o for o in objs if o is not None]
    if not objs:
        return None
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    objs[0].name = objs[0].data.name = name
    return objs[0]


def plain_material(obj, name):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    obj.data.materials.clear()
    obj.data.materials.append(m)
    for poly in obj.data.polygons:
        poly.material_index = 0


def export_character(S, spec, out_dir, tex_dir):
    import lib
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.world = bpy.data.worlds.new('w')
    sc.world.light_settings.distance = 0.12
    rig, body, eyes, pieces, hair = build_character(S, spec)
    cid = spec['id']
    kid = spec['age'] < 12
    # first take the clothes and their print regions while every garment still knows what it is
    for g in pieces:
        g['print_seed'] = float(len(g.name))
        gid = g.data.color_attributes.new('gid', 'FLOAT_COLOR', 'POINT')     # which garment of the outfit
        gid.data.foreach_set('color', np.tile(np.float32([spec['outfit'].index(g['garment']), 0, 0, 1]), len(g.data.vertices)))
    set_colours(body, eyes, spec)
    # --- geometry budget ---
    bp = np.array([v.co[:] for v in body.data.vertices])
    head_z = landmarks(rig)['neck'][2]
    protect = smoothstep(head_z - 0.03, head_z + 0.03, bp[:, 2])
    decimate(body, 10000 if kid else 13000, protect * 0.5)
    decimate(eyes, 700)
    clothes = join(pieces, cid + '_clothes')
    if clothes is not None:
        decimate(clothes, 3200)
    # --- skin ---
    R = 1024
    alb = bake(body, 'DIFFUSE', R, pass_filter={'COLOR'})
    nrm_map = bake(body, 'NORMAL', R)
    ao = bake(body, 'AO', R, samples=48)
    rough = bake(body, 'ROUGHNESS', R)
    pos, onrm, cov = bake_geometry(body, R)
    alb = skin_overlays(alb, pos, onrm, cov, eyes, body, spec)
    lib.save_rgb(os.path.join(tex_dir, f'{cid}_skin_c.webp'), alb[..., :3], quality=90, srgb=True)
    lib.save_rgb(os.path.join(tex_dir, f'{cid}_skin_n.webp'), nrm_map[..., :3], quality=90)
    lib.save_rgb(os.path.join(tex_dir, f'{cid}_skin_r.webp'), np.dstack([ao[..., 0] * 0.7 + 0.3, rough[..., 0], np.zeros((R, R))]), quality=88)
    # --- eyes ---
    eyes_alb = bake(eyes, 'DIFFUSE', 256, pass_filter={'COLOR'})
    lib.save_rgb(os.path.join(tex_dir, f'{cid}_eyes_c.webp'), eyes_alb[..., :3], quality=90, srgb=True)
    # --- clothes: shading (R), print mask (G), garment (B: 0 = first of the outfit, 1 = second), normal ---
    if clothes is not None:
        uvs = clothes.data.uv_layers
        while len(uvs):
            uvs.remove(uvs[0])
        uvs.new(name='UVMap')
        smart_uv(clothes)
        cm = cloth_bake_material('_cloth_bake')
        clothes.data.materials.clear()
        clothes.data.materials.append(cm)
        CR = 512
        cn = bake(clothes, 'NORMAL', CR)
        cao = bake(clothes, 'AO', CR, samples=48)
        cpos, cnrm, ccov = bake_geometry(clothes, CR)
        gid = np.rint(bake_attribute(clothes, 'gid', CR))
        kinds = spec['outfit']
        g = np.zeros((CR, CR))
        for k, kind in enumerate(kinds):      # each garment prints only on its own texels
            g = np.maximum(g, print_mask(kind, cpos, cnrm, ccov, len(kind)) * (gid == k))
        shade = cao[..., 0] * 0.75 + 0.25
        lib.save_rgb(os.path.join(tex_dir, f'{cid}_cloth_c.webp'), np.dstack([shade, g, gid / max(1, len(kinds) - 1)]), quality=90)
        lib.save_rgb(os.path.join(tex_dir, f'{cid}_cloth_n.webp'), cn[..., :3], quality=90)
    # --- export ---
    plain_material(body, 'skin')
    plain_material(eyes, 'eyes')
    plain_material(hair, 'hair')
    if clothes is not None:
        plain_material(clothes, 'cloth')
    body.name, eyes.name, hair.name = 'body', 'eyes', 'hair'
    objs = [rig, body, eyes, hair] + ([clothes] if clothes is not None else [])
    for o in objs:
        if o.type == 'MESH':
            for vg in list(o.vertex_groups):
                if not vg.name.startswith('mixamorig'):
                    o.vertex_groups.remove(vg)
    lib.export_glb(objs, os.path.join(out_dir, f'{cid}.glb'), export_skins=True, export_vertex_color='NONE',
                   export_attributes=False, export_all_influences=False)
    tris = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs if o.type == 'MESH'}
    print(cid, 'triangles', tris, flush=True)


def bake_attribute(obj, name, res):
    """A colour attribute's first channel per texel, through a temporary emission material."""
    keep = list(obj.data.materials)
    mat = bpy.data.materials.new('_attr')
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    at = nt.nodes.new('ShaderNodeAttribute')
    at.attribute_name = name
    nt.links.new(at.outputs['Color'], em.inputs['Color'])
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    val = bake(obj, 'EMIT', res, mats=[mat], margin=4)
    obj.data.materials.clear()
    for m in keep:
        obj.data.materials.append(m)
    bpy.data.materials.remove(mat)
    return val[..., 0]


# ---------------------------------------------------------------------------------------------
#  Preview: Cycles line-up (python people.py --preview out.png [ids])
# ---------------------------------------------------------------------------------------------
def preview(chars, out, closeup=False):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 32
    sc.cycles.device = 'CPU'
    sc.render.resolution_x, sc.render.resolution_y = (1600, 700) if not closeup else (1600, 500)
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.exposure = -0.4
    w = bpy.data.worlds.new('w')
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.62, 0.72, 1)
    w.node_tree.nodes['Background'].inputs[1].default_value = 0.6
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sc.collection.objects.link(sun)
    sun.data.energy = 3.0
    sun.data.angle = math.radians(3)
    sun.rotation_euler = (math.radians(55), 0, math.radians(-35))
    n = len(chars)
    for k, (rig, body, eyes, pieces, hair, spec) in enumerate(chars):
        rig.location.x = (k - (n - 1) / 2) * 0.75
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    width = n * 0.75
    if closeup:
        cam.data.type = 'ORTHO'
        cam.data.ortho_scale = width * 1.02
        cam.location = (0, -3, 1.45)
        cam.rotation_euler = (math.radians(90), 0, 0)
        sc.render.resolution_y = int(1600 * 0.42 / width * 1.0 / 0.42 * 0.42) if False else 500
    else:
        cam.data.type = 'ORTHO'
        cam.data.ortho_scale = max(width * 1.02, 1.9 * 1600 / 700)
        cam.location = (0, -6, 0.85)
        cam.rotation_euler = (math.radians(90), 0, 0)
    sc.render.filepath = os.path.abspath(out)
    bpy.ops.render.render(write_still=True)


def head_views(chars, out):
    """Front, side and back of every head (python people.py --preview out.png ids --heads)."""
    from PIL import Image
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 24
    sc.render.resolution_x = sc.render.resolution_y = 360
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.exposure = -0.3
    w = bpy.data.worlds.new('w')
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.62, 0.72, 1)
    w.node_tree.nodes['Background'].inputs[1].default_value = 0.7
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sc.collection.objects.link(sun)
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(50), 0, math.radians(-30))
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 0.62
    for k, ch in enumerate(chars):
        ch[0].location.x = k * 3.0
    sheet = Image.new('RGB', (360 * len(chars), 360 * 3))
    for row, ang in enumerate((0, 90, 180)):
        for k, ch in enumerate(chars):
            z = landmarks(ch[0])['head'][2] + 0.1
            a = math.radians(ang)
            cam.location = (k * 3.0 - 3 * math.sin(a), -3 * math.cos(a), z)
            cam.rotation_euler = (math.radians(90), 0, -a)
            f = out.replace('.png', '_tile.png')
            sc.render.filepath = os.path.abspath(f)
            bpy.ops.render.render(write_still=True)
            sheet.paste(Image.open(f).convert('RGB'), (360 * k, 360 * row))
    sheet.save(out)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    S = mpfb()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if argv and argv[0] != '--preview':
        out_dir = os.path.abspath(argv[0])
        tex_dir = os.path.join(out_dir, 'tex')
        os.makedirs(tex_dir, exist_ok=True)
        strand_atlas(os.path.join(tex_dir, 'hair_c.webp'))
        for spec in CHARS:
            if len(argv) > 1 and spec['id'] not in argv[1:]:
                continue
            export_character(S, spec, out_dir, tex_dir)
        return
    if argv and argv[0] == '--preview':
        out, ids = argv[1], set(a for a in argv[2:] if not a.startswith('--'))
        strand_atlas(ATLAS_PATH)
        chars = []
        for spec in CHARS:
            if ids and spec['id'] not in ids:
                continue
            rig, body, eyes, pieces, hair = build_character(S, spec)
            hm = bpy.data.materials.new('hair_' + spec['id'])
            hm.use_nodes = True
            nt = hm.node_tree
            bsdf = nt.nodes['Principled BSDF']
            tex = nt.nodes.new('ShaderNodeTexImage')
            tex.image = bpy.data.images.load(ATLAS_PATH)
            mixc = nt.nodes.new('ShaderNodeMix'); mixc.data_type = 'RGBA'; mixc.blend_type = 'MULTIPLY'
            ins = {x.identifier: x for x in mixc.inputs}
            ins['Factor_Float'].default_value = 1.0
            ins['B_Color'].default_value = (*lin(spec['hair_col']), 1)
            nt.links.new(tex.outputs['Color'], ins['A_Color'])
            nt.links.new({x.identifier: x for x in mixc.outputs}['Result_Color'], bsdf.inputs['Base Color'])
            nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
            bsdf.inputs['Roughness'].default_value = 0.45
            hair.data.materials.clear()
            hair.data.materials.append(hm)
            for g in pieces:
                m = bpy.data.materials.new(g.name)
                m.diffuse_color = (*lin(['#3a6ea5', '#c0392b', '#2e8b57', '#f1c40f', '#8e44ad'][pieces.index(g) % 5]), 1)
                m.use_nodes = True
                m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = m.diffuse_color
                m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.8
                g.data.materials.clear()
                g.data.materials.append(m)
            chars.append((rig, body, eyes, pieces, hair, spec))
        if '--heads' in argv:
            head_views(chars, out)
        else:
            preview(chars, out, closeup='--close' in argv)
        return


if __name__ == '__main__':
    try:
        main()
    except Exception:
        import traceback
        traceback.print_exc()
    sys.stdout.flush()
    os._exit(0)      # bpy as a module can hang on interpreter shutdown
