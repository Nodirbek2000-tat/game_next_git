"""Harakat o'yinlari - CC0 street furniture from Poly Haven (polyhaven.com, CC0), prepared for the game in Blender.

    blender -b --factory-startup --python tools/blender/props.py -- --src DIR_WITH_POLYHAVEN_GLTF --out assets-src/models/poyga/props

Each asset (downloaded as glTF 1k) is imported, scaled to metres if needed, decimated to a triangle budget, its
textures halved to 512 px, put on the ground (y = 0) and centred, then exported as one GLB.
"""

import argparse
import glob
import math
import os
import sys

import bpy

# game budgets (they are instanced hundreds of times)
BUDGET = {"street_lamp_01": 1400, "street_lamp_02": 1400, "painted_wooden_bench": 700, "fire_hydrant": 600,
          "water_manhole_cover": 120, "utility_box_01": 500, "shrub_03": 900, "shrub_01": 1100, "planter_box_01": 500, "trashbag": 300}


def tris(objs):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs if o.type == "MESH")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", default="assets-src/models/poyga/props")
    a = ap.parse_args(argv)
    os.makedirs(a.out, exist_ok=True)
    for d in sorted(glob.glob(os.path.join(a.src, "*"))):
        name = os.path.basename(d)
        files = glob.glob(os.path.join(d, "*.gltf"))
        if not files:
            continue
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=files[0])
        objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
        before = tris(objs)
        budget = BUDGET.get(name, 3000)
        if before > budget:
            ratio = budget / before
            for o in objs:
                m = o.modifiers.new("dec", "DECIMATE")
                m.ratio = max(0.02, ratio)
                bpy.context.view_layer.objects.active = o
                bpy.ops.object.modifier_apply(modifier="dec")
        for img in bpy.data.images:
            if img.size[0] > 512:
                img.scale(512, max(1, int(512 * img.size[1] / img.size[0])))
                img.pack()
        # ground + centre
        from mathutils import Vector

        bpy.context.view_layer.update()
        mn = Vector((1e9, 1e9, 1e9))
        mx = Vector((-1e9, -1e9, -1e9))
        for o in objs:
            for c in o.bound_box:
                w = o.matrix_world @ Vector(c)
                mn = Vector(map(min, mn, w))
                mx = Vector(map(max, mx, w))
        off = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
        roots = [o for o in bpy.context.scene.objects if o.parent is None]
        for o in roots:
            o.location -= off
        size = mx - mn
        print(f"[props] {name}: {before} -> {tris(objs)} tris, size {size.x:.2f} x {size.y:.2f} x {size.z:.2f} m")
        bpy.ops.export_scene.gltf(filepath=os.path.join(os.path.abspath(a.out), f"{name}.glb"), export_format="GLB", export_yup=True,
                                  export_apply=True, export_image_format="JPEG", export_jpeg_quality=85, export_cameras=False, export_lights=False)


main()
