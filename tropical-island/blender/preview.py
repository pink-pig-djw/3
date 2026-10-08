"""Render a quick lineup of the models in a .glb (for checking shapes).

    python preview.py model.glb out.png [rock_texture_dir]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402

import lib  # noqa: E402


def main():
    a = lib.args()
    glb, out = os.path.abspath(a[0]), os.path.abspath(a[1])
    sc = lib.fresh_scene(samples=48)
    bpy.ops.import_scene.gltf(filepath=glb)
    objs = [o for o in sc.objects if o.type == 'MESH']
    # vertex-colour material so the baked AO / tints show up
    mat = bpy.data.materials.new('preview')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    attr = nt.nodes.new('ShaderNodeVertexColor')
    mul = nt.nodes.new('ShaderNodeMix')
    mul.data_type, mul.blend_type = 'RGBA', 'MULTIPLY'
    ins = {s.identifier: s for s in mul.inputs}
    ins['Factor_Float'].default_value = 1.0
    ins['A_Color'].default_value = (0.42, 0.39, 0.35, 1)
    nt.links.new(attr.outputs['Color'], ins['B_Color'])
    nt.links.new({s.identifier: s for s in mul.outputs}['Result_Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.85
    tex_dir = os.path.abspath(a[2]) if len(a) > 2 else None

    def textured(name, img, box=False, alpha=False, scale=1.0):
        mt = bpy.data.materials.new('pv_' + name)
        mt.use_nodes = True
        t = mt.node_tree
        b = t.nodes['Principled BSDF']
        it = t.nodes.new('ShaderNodeTexImage')
        it.image = bpy.data.images.load(os.path.join(tex_dir, img))
        if box:
            tc = t.nodes.new('ShaderNodeTexCoord')
            mp = t.nodes.new('ShaderNodeMapping')
            mp.inputs['Scale'].default_value = (scale, scale, scale)
            t.links.new(tc.outputs['Object'], mp.inputs['Vector'])
            t.links.new(mp.outputs['Vector'], it.inputs['Vector'])
            it.projection, it.projection_blend = 'BOX', 0.3
        vc = t.nodes.new('ShaderNodeVertexColor')
        mx = t.nodes.new('ShaderNodeMix')
        mx.data_type, mx.blend_type = 'RGBA', 'MULTIPLY'
        ins = {s.identifier: s for s in mx.inputs}
        ins['Factor_Float'].default_value = 1.0
        t.links.new(it.outputs['Color'], ins['A_Color'])
        t.links.new(vc.outputs['Color'], ins['B_Color'])
        t.links.new({s.identifier: s for s in mx.outputs}['Result_Color'], b.inputs['Base Color'])
        b.inputs['Roughness'].default_value = 0.8
        if alpha:
            t.links.new(it.outputs['Alpha'], b.inputs['Alpha'])
        return mt

    tex_mats = {}
    if tex_dir:
        tex_mats = {'bark': textured('bark', 'bark_c.webp'), 'crown': textured('crown', 'foliage_c.webp', alpha=True),
                    'leaf': textured('leaf', 'foliage_c.webp', alpha=True), 'rock': textured('rock', 'rock_c.webp', box=True, scale=0.5),
                    'coral': textured('coral', 'coral_c.webp', box=True, scale=2.0)}
    x = 0.0
    for o in objs:
        if o.parent is None:
            w = max(o.dimensions.x, o.dimensions.y, 0.5)
            o.location = (x + w / 2, 0, 0)
            x += w + 0.4
        for slot in o.material_slots:
            key = next((k for k in tex_mats if slot.material and slot.material.name.startswith(k)), None)
            slot.material = tex_mats[key] if key else (tex_mats.get('rock') if tex_mats and o.name.startswith('rock') else mat)
    bpy.ops.mesh.primitive_plane_add(size=200)
    ground = bpy.context.active_object
    gm = bpy.data.materials.new('ground')
    gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.55, 0.5, 0.42, 1)
    ground.data.materials.append(gm)
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 4.0
    sun.rotation_euler = (math.radians(50), math.radians(15), math.radians(35))
    sc.collection.objects.link(sun)
    sc.world = bpy.data.worlds.new('w')
    sc.world.use_nodes = True
    sc.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.65, 0.8, 1)
    sc.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.7
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    h = max(o.dimensions.z for o in objs)
    cam.data.lens = 35
    cx = x / 2
    dist = max(x * 0.75, h * 2.2)
    cam.location = (cx, -dist, h * 0.9 + dist * 0.25)
    direction = (cx - cam.location.x, 0 - cam.location.y, h * 0.4 - cam.location.z)
    import mathutils
    cam.rotation_euler = mathutils.Vector(direction).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = 1400, 520
    sc.view_settings.view_transform = 'AgX'
    sc.render.filepath = out
    bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    main()
