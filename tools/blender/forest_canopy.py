"""Harakat o'yinlari - Baliq ovi: a seamless "forest seen from above" texture, rendered in Blender from the game's firs.

    blender -b --factory-startup --python tools/blender/forest_canopy.py -- --out assets-src/textures/baliq-ovi/mtn/forest_canopy.jpg

~500 firs (fir_0..2 with their real needle-card textures) scattered densely on a 48 m tile, wrapped at the edges so
the texture tiles; orthographic camera straight down, a low morning sun. The game puts it on the forested slopes of
the far ranges (games/baliq-ovi/world.ts).
"""

import argparse
import math
import os
import random
import sys

import bpy

TILE = 48.0


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default="assets-src/models/baliq-ovi/trees")
    ap.add_argument("--tex", default="assets-src/textures/baliq-ovi/trees")
    ap.add_argument("--out", default="assets-src/textures/baliq-ovi/mtn/forest_canopy.jpg")
    ap.add_argument("--n", type=int, default=520)
    a = ap.parse_args(argv)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    protos = []
    for k in range(3):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.abspath(os.path.join(a.models, f"fir_{k}.glb")))
        new = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
        leaf = bpy.data.images.load(os.path.abspath(os.path.join(a.tex, f"leaf_fir_{k}.png")))
        for o in new:
            for m in o.data.materials:
                if m and m.name.startswith("leaves"):
                    nt = m.node_tree
                    b = nt.nodes["Principled BSDF"]
                    ti = next(n for n in nt.nodes if n.type == "TEX_IMAGE")
                    ti.image = leaf
                    nt.links.new(ti.outputs["Alpha"], b.inputs["Alpha"])
                    m.blend_method = "CLIP" if hasattr(m, "blend_method") else m.blend_method
        protos.append(new)
        for o in new:
            o.hide_render = True
    rnd = random.Random(9)
    pts = []
    tries = 0
    while len(pts) < a.n and tries < a.n * 60:
        tries += 1
        x, y = rnd.uniform(0, TILE), rnd.uniform(0, TILE)
        # clumps with small gaps (a natural stand, not a grid)
        if any(min(abs(x - px), TILE - abs(x - px)) ** 2 + min(abs(y - py), TILE - abs(y - py)) ** 2 < 1.7 ** 2 for px, py in pts):
            continue
        pts.append((x, y))
    for x, y in pts:
        k = 0 if rnd.random() < 0.55 else (1 if rnd.random() < 0.8 else 2)
        s = rnd.uniform(0.55, 1.1)
        rz = rnd.uniform(0, math.tau)
        for ox in (-TILE, 0, TILE):
            for oy in (-TILE, 0, TILE):
                px, py = x + ox, y + oy
                if not (-6 < px < TILE + 6 and -6 < py < TILE + 6):
                    continue
                for p in protos[k]:
                    c = p.copy()
                    c.hide_render = False
                    sc.collection.objects.link(c)
                    c.location = (px - TILE / 2, py - TILE / 2, 0)
                    c.rotation_euler = (math.pi / 2, 0, rz)
                    c.scale = (s, s, s)
    # forest floor
    bpy.ops.mesh.primitive_plane_add(size=TILE * 1.4)
    fl = bpy.context.active_object
    fm = bpy.data.materials.new("floor")
    fm.use_nodes = True
    fm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.035, 0.04, 0.025, 1)
    fl.data.materials.append(fm)
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.5
    sun.data.angle = math.radians(3)
    sun.rotation_euler = (math.radians(42), 0, math.radians(35))
    sc.collection.objects.link(sun)
    sc.world = bpy.data.worlds.new("w")
    sc.world.use_nodes = True
    sc.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.65, 0.8, 1)
    sc.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = TILE
    cam.location = (0, 0, 60)
    sc.collection.objects.link(cam)
    sc.camera = cam
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 48
    sc.cycles.use_denoising = True
    sc.render.resolution_x = sc.render.resolution_y = 1024
    sc.view_settings.view_transform = "Standard"
    sc.render.image_settings.file_format = "JPEG"
    sc.render.image_settings.quality = 88
    sc.render.filepath = os.path.abspath(a.out)
    bpy.ops.render.render(write_still=True)
    print("[forest_canopy]", len(pts), "trees ->", a.out)


main()
