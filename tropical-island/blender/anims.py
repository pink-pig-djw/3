"""Motion capture for the islanders, retargeted onto the Mixamo skeleton that people.py gives every character.

    python anims.py ../assets/people

Source: the CMU Graphics Lab Motion Capture Database (http://mocap.cs.cmu.edu), in the MotionBuilder-friendly
BVH conversion by B. Hahne (CMU_BVH, default /home/user/mocap/cmu-mocap/data). A few clips get a hand-set arm
(waving, a surfboard carried on the head, a lantern held out) or a reclining pose for the loungers on top of the capture.

Retargeting works in world space from the T-pose that opens every CMU take: each source joint's rotation away
from its T-pose is applied to the matching target bone in *its* T-pose (its rest pose with the limbs turned
onto the source's T-pose directions). Clips are cut, looped with a cross-fade, made in-place (walks report
their speed), sampled at 30 fps and exported as glTF animations on the bare skeleton.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Quaternion, Vector  # noqa: E402

import people  # noqa: E402

CMU = os.environ.get('CMU_BVH', '/home/user/mocap/cmu-mocap/data')
FPS = 30
# The collar bones are left at rest: CMU's clavicles sit at a different angle from MakeHuman's, and copying them
# shrugs the shoulders. The arms are matched by their world direction, so they still point the same way.
MAP = {   # target (mixamorig:*) ← CMU joint
    'Hips': 'Hips', 'Spine': 'LowerBack', 'Spine1': 'Spine', 'Spine2': 'Spine1', 'Neck': 'Neck', 'Head': 'Head',
    'LeftArm': 'LeftArm', 'LeftForeArm': 'LeftForeArm', 'LeftHand': 'LeftHand',
    'RightArm': 'RightArm', 'RightForeArm': 'RightForeArm', 'RightHand': 'RightHand',
    'LeftUpLeg': 'LeftUpLeg', 'LeftLeg': 'LeftLeg', 'LeftFoot': 'LeftFoot', 'LeftToeBase': 'LeftToeBase',
    'RightUpLeg': 'RightUpLeg', 'RightLeg': 'RightLeg', 'RightFoot': 'RightFoot', 'RightToeBase': 'RightToeBase',
}
CHILD = {'Hips': 'LowerBack', 'LowerBack': 'Spine', 'Spine': 'Spine1', 'Spine1': 'Neck', 'Neck': 'Neck1', 'Head': 'Head_end',
         'LeftShoulder': 'LeftArm', 'LeftArm': 'LeftForeArm', 'LeftForeArm': 'LeftHand', 'LeftHand': 'LeftFingerBase',
         'RightShoulder': 'RightArm', 'RightArm': 'RightForeArm', 'RightForeArm': 'RightHand', 'RightHand': 'RightFingerBase',
         'LeftUpLeg': 'LeftLeg', 'LeftLeg': 'LeftFoot', 'LeftFoot': 'LeftToeBase', 'LeftToeBase': 'LeftToeBase_end',
         'RightUpLeg': 'RightLeg', 'RightLeg': 'RightFoot', 'RightFoot': 'RightToeBase', 'RightToeBase': 'RightToeBase_end'}

# name, take, start s, end s, kind (loop / once), in place (locomotion), arm overrides
CLIPS = [
    ('idle', '82_08', 1.0, 8.0, 'loop', False, None),
    ('walk', '91_31', 1.6, 5.6, 'loop', True, None),
    ('walk_slow', '91_10', 4.2, 12.0, 'loop', True, None),
    ('run', '16_35', 0.25, 1.35, 'loop', True, None),
    ('talk', '18_08', 4.0, 16.0, 'loop', False, None),
    ('sit', '13_04', 4.6, 8.0, 'loop', False, None),
    ('lie', '82_08', 1.0, 8.0, 'loop', False, 'relax'),
    ('tread', '79_02', 1.0, 6.2, 'loop', False, None),
    ('fish', '79_34', 0.8, 6.0, 'loop', False, None),
    ('drink', '79_40', 0.8, 7.0, 'loop', False, None),
    ('paddle', '79_95', 1.0, 7.6, 'loop', False, None),
    ('scoop', '02_06', 3.1, 6.3, 'loop', False, None),
    ('wave', '82_08', 2.0, 5.0, 'loop', False, 'wave'),
    ('walk_carry', '91_31', 1.6, 5.6, 'loop', True, 'carry'),
    ('walk_lantern', '91_10', 4.2, 12.0, 'loop', True, 'lantern'),
]


# ---------------------------------------------------------------------------------------------
#  BVH: parse and forward kinematics (BVH is Y-up, the T-pose faces +Z, the actor's left is +X)
# ---------------------------------------------------------------------------------------------
def parse_bvh(path):
    txt = open(path).read().split()
    i, joints, stack = 0, [], []
    while txt[i] != 'MOTION':
        t = txt[i]
        if t in ('ROOT', 'JOINT'):
            joints.append(dict(name=txt[i + 1], parent=stack[-1] if stack else -1, offset=np.zeros(3), ch=[]))
            i += 2
            continue
        if t == 'End':
            joints.append(dict(name=joints[stack[-1]]['name'] + '_end', parent=stack[-1], offset=np.zeros(3), ch=[]))
            i += 2
            continue
        if t == '{':
            stack.append(len(joints) - 1)
        elif t == '}':
            stack.pop()
        elif t == 'OFFSET':
            joints[stack[-1]]['offset'] = np.array([float(x) for x in txt[i + 1:i + 4]])
            i += 4
            continue
        elif t == 'CHANNELS':
            n = int(txt[i + 1])
            joints[stack[-1]]['ch'] = txt[i + 2:i + 2 + n]
            i += 2 + n
            continue
        i += 1
    nf, ft = int(txt[i + 2]), float(txt[i + 5])
    return joints, np.array(txt[i + 6:], float).reshape(nf, -1), ft


def _rot(axis, deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return {'X': np.array([[1, 0, 0], [0, c, -s], [0, s, c]]), 'Y': np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]]),
            'Z': np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])}[axis]


C = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], float)     # BVH (Y up) → Blender (Z up): the actor then faces -Y


def fk(joints, frame):
    pos, R, k = {}, {}, 0
    for j, J in enumerate(joints):
        loc, r = J['offset'].copy(), np.eye(3)
        for c in J['ch']:
            v = frame[k]
            k += 1
            if c.endswith('position'):
                loc['XYZ'.index(c[0])] = v
            else:
                r = r @ _rot(c[0], v)
        if J['parent'] < 0:
            pos[J['name']], R[J['name']] = loc, r
        else:
            pn = joints[J['parent']]['name']
            pos[J['name']] = pos[pn] + R[pn] @ loc
            R[J['name']] = R[pn] @ r
    return {n: C @ p for n, p in pos.items()}, {n: C @ r @ C.T for n, r in R.items()}


# ---------------------------------------------------------------------------------------------
#  Target skeleton
# ---------------------------------------------------------------------------------------------
def reference_rig(S):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    h = S.HS.create_human()
    rig = S.HS.add_builtin_rig(h, 'mixamo')
    bpy.data.objects.remove(h)
    rig.name = rig.data.name = 'islander'
    return rig


def rot_between(a, b):
    a, b = Vector(a).normalized(), Vector(b).normalized()
    return a.rotation_difference(b).to_matrix()


def bone_order(rig):
    out = []

    def walk(b):
        out.append(b)
        for c in b.children:
            walk(c)
    for b in rig.data.bones:
        if b.parent is None:
            walk(b)
    return out


# arm poses laid over a clip, as world directions for (upper arm, forearm, hand), character facing -Y, left = +X
def override_dirs(kind, t):
    if kind == 'wave':      # upper arm out to the side and up, forearm upright, swinging from the elbow
        sw = math.sin(t * 2 * math.pi * 1.6)
        return {'RightArm': (-0.85, -0.15, 0.45), 'RightForeArm': (-0.1 - 0.4 * sw, -0.3, 0.9), 'RightHand': (-0.05 - 0.5 * sw, -0.3, 0.86)}
    if kind == 'carry':      # a surfboard flat on the head, both hands up on its rails
        return {'LeftArm': (0.85, 0.05, 0.52), 'LeftForeArm': (-0.5, -0.1, 0.86), 'LeftHand': (-0.35, -0.1, 0.93),
                'RightArm': (-0.85, 0.05, 0.52), 'RightForeArm': (0.5, -0.1, 0.86), 'RightHand': (0.35, -0.1, 0.93)}
    if kind == 'relax':      # on a lounger: hands folded behind the head, hips flexed 43 degrees (the page tilts the body back)
        f = math.radians(43)
        legs = {}
        for side, sx in (('Left', 1), ('Right', -1)):
            legs.update({side + 'UpLeg': (0.03 * sx, -math.sin(f), -math.cos(f)), side + 'Leg': (0.02 * sx, -math.sin(f + 0.04), -math.cos(f + 0.04)),
                         side + 'Foot': (0.12 * sx, -0.99, 0.0), side + 'ToeBase': (0.1 * sx, -0.99, 0.08)})
        return {'RightArm': (-0.55, 0.25, 0.8), 'RightForeArm': (0.99, 0.1, 0.1), 'RightHand': (0.9, 0.3, -0.3),
                'LeftArm': (0.55, 0.25, 0.8), 'LeftForeArm': (-0.99, 0.1, 0.1), 'LeftHand': (-0.9, 0.3, -0.3), **legs}
    if kind == 'lantern':    # a lantern held out in front with the left hand
        return {'LeftArm': (0.2, -0.3, -0.93), 'LeftForeArm': (0.12, -0.97, -0.18), 'LeftHand': (0.05, -0.98, -0.2)}
    return {}


def retarget(rig, take, t0, t1, kind, in_place, override):
    joints, data, ft = parse_bvh(os.path.join(CMU, f'{int(take.split("_")[0]):03d}', take + '.bvh'))
    P0, R0 = fk(joints, data[0])                                   # the T-pose
    foot0 = min(P0['LeftToeBase'][2], P0['RightToeBase'][2])
    bones = {b.name.split(':')[1]: b for b in rig.data.bones}
    # target rest orientations and the T-pose that matches the source's
    Qrest = {n: b.matrix_local.to_3x3() for n, b in bones.items()}
    QT = {}
    for tn, sn in MAP.items():
        b = bones[tn]
        d_t = b.tail_local - b.head_local
        d_s = P0[CHILD[sn]] - P0[sn]
        if np.linalg.norm(d_s) < 1e-6:
            d_s = np.array(d_t)
        QT[tn] = rot_between(d_t, d_s) @ Qrest[tn]
    hips_rest = bones['Hips'].head_local.copy()
    scale = (hips_rest.z - 0.0) / (P0['Hips'][2] - foot0)
    # frames at 30 fps
    step = 1.0 / FPS / ft
    frames = np.arange(t0 / ft, t1 / ft, step).astype(int)
    frames = frames[frames < len(data)]
    samples = [fk(joints, data[f]) for f in frames]
    # face the clip forward (-Y): locomotion along its direction of travel, the rest by the pelvis
    hp = np.array([s[0]['Hips'] for s in samples])
    if in_place:
        fwd = hp[-1] - hp[0]
    else:
        lr = np.mean([s[0]['LeftUpLeg'] - s[0]['RightUpLeg'] for s in samples], axis=0)
        fwd = np.cross(lr, np.array([0, 0, 1.0]))      # left × up = forward
    yaw = math.atan2(fwd[0], -fwd[1])
    Y = Matrix.Rotation(-yaw, 3, 'Z')
    order = bone_order(rig)
    out = []                                  # per frame: {bone: (quat, loc or None)}
    for k, (P, R) in enumerate(samples):
        world = {}
        for tn, sn in MAP.items():
            delta = Y @ Matrix(R[sn].tolist()) @ Matrix(R0[sn].tolist()).inverted()
            world[tn] = delta @ QT[tn]
        for bn, d in override_dirs(override, k / FPS).items():
            b = bones[bn]
            world[bn] = rot_between(b.tail_local - b.head_local, d) @ Qrest[bn]
        pose = {}
        local = {}
        for b in order:
            n0 = b.name.split(':')[1]
            if 'Hand' in n0 and n0[-1].isdigit():         # fingers: relaxed, slightly curled
                ang = (0.18 if 'Thumb' in n0 else 0.32) * (0.8 if n0.endswith('1') else 1.0)
                local[n0] = Quaternion((1, 0, 0), ang)
                continue
            n = b.name.split(':')[1]
            if b.parent is None:
                Pw = world.get(n, Qrest[n])
                L = Qrest[n].inverted() @ Pw
            else:
                pn = b.parent.name.split(':')[1]
                if pn not in pose:
                    continue
                if n in world:
                    Pw = world[n]
                    L = Qrest[n].inverted() @ Qrest[pn] @ pose[pn].inverted() @ Pw
                else:
                    L = Matrix.Identity(3)
                    Pw = pose[pn] @ Qrest[pn].inverted() @ Qrest[n]
            pose[n] = Pw
            local[n] = L.to_quaternion()
        anchor = P0['Hips'] if in_place else samples[0][0]['Hips']      # stay where the take starts
        hips = Y @ Vector((P['Hips'] - anchor).tolist()) * scale + hips_rest
        hips.z = (P['Hips'][2] - foot0) * scale
        out.append((local, hips))
    speed = 0.0
    # loop: end where the pose best matches the start, then cross-fade the seam
    if kind == 'loop' and len(out) > 20:
        def dist(a, b):
            return sum(a[0][n].rotation_difference(b[0][n]).angle for n in ('LeftUpLeg', 'RightUpLeg', 'LeftArm', 'RightArm', 'Spine1', 'LeftLeg', 'RightLeg'))
        lo = int(len(out) * 0.6)
        best = min(range(lo, len(out)), key=lambda e: dist(out[0], out[e]))
        out = out[:best]
        n = min(8, len(out) // 4)
        for i in range(n):
            w = ((i + 1) / (n + 1)) ** 2
            f = len(out) - n + i
            loc, hp_ = out[f]
            first_loc, first_hp = out[0]
            out[f] = ({b: q.slerp(first_loc[b], w) for b, q in loc.items()}, hp_)
    if in_place:
        a, b = out[0][1].copy(), out[-1][1].copy()
        travel = (b - a)
        travel.z = 0
        dur = len(out) / FPS
        speed = travel.length / dur
        for i, (loc, hp_) in enumerate(out):
            drift = travel * (i / max(1, len(out) - 1))
            hp_ = hp_ - drift
            out[i] = (loc, Vector((hips_rest.x + (hp_.x - a.x) * 0.3, hips_rest.y + (hp_.y - a.y) * 0.3, hp_.z)))
    return out, speed


def write_action(rig, name, frames):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    rig.animation_data_create()
    rig.animation_data.action = act
    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    last = len(frames) - 1
    for f, (local, hips) in enumerate(frames):
        for pb in rig.pose.bones:
            n = pb.name.split(':')[1]
            if n not in local:
                continue                                # untouched bones keep their rest pose (no track)
            if n not in MAP and 0 < f < last:
                continue                                # constant poses (fingers): two keys are enough
            pb.rotation_quaternion = local[n]
            pb.keyframe_insert('rotation_quaternion', frame=f + 1)
            if pb.parent is None:
                b = pb.bone
                pb.location = b.matrix_local.to_3x3().inverted() @ (hips - b.head_local)
                pb.keyframe_insert('location', frame=f + 1)
    for fc in act.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'
    rig.animation_data.action = None
    return act


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    out_dir = os.path.abspath(argv[0] if argv else '../assets/people')
    S = people.mpfb()
    rig = reference_rig(S)
    sc = bpy.context.scene
    sc.render.fps = FPS
    meta = {}
    for name, take, t0, t1, kind, in_place, over in CLIPS:
        frames, speed = retarget(rig, take, t0, t1, kind, in_place, over)
        write_action(rig, name, frames)
        meta[name] = {'frames': len(frames), 'speed': round(speed, 3), 'loop': kind == 'loop'}
        print(name, len(frames), 'frames', 'speed %.2f m/s' % speed, flush=True)
    import json
    json.dump({'clips': meta, 'hips': list(rig.data.bones['mixamorig:Hips'].head_local)}, open(os.path.join(out_dir, 'anims.json'), 'w'), indent=1)
    for o in bpy.data.objects:
        o.select_set(o == rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=os.path.join(out_dir, 'anims.glb'), export_format='GLB', use_selection=True,
                              export_animations=True, export_animation_mode='ACTIONS', export_skins=True, export_yup=True,
                              export_force_sampling=False, export_frame_step=1, export_optimize_animation_size=True,
                              export_def_bones=False, export_materials='NONE')
    os.makedirs(os.path.join(people.HERE, 'build'), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(people.HERE, 'build', 'anims.blend'), compress=True)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        import traceback
        traceback.print_exc()
    sys.stdout.flush()
    os._exit(0)
