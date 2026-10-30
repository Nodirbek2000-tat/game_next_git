"""Harakat o'yinlari - game-ready versions of Poly Haven's CC0 trees (jacaranda_tree, tree_small_02), made in Blender.

    blender -b --factory-startup --python tools/blender/cc0_trees.py -- --src DIR --out public/models/poyga/trees --tex public/textures/poyga/trees

The originals have millions of leaf polygons. For the game:
  * trunk + branches are decimated (their own textures kept, downsized),
  * a leaf-cluster texture is RENDERED from a slab of the tree's own leaves (so the cards show the real leaves),
  * ~800 alpha cards are put where the real leaves are (sampled from the original leaf faces),
  * the far-away impostor is rendered from the full original model.
"""

import argparse
import json
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector

TREES = {
    # source name: (game name, target height m, cards, card size m, bark tris)
    "jacaranda_tree": ("keng_0", 12.5, 1000, 1.6, 5000),
    "tree_small_02": ("keng_1", 10.0, 800, 1.35, 6000),
}


def split_by_material(ob):
    """One object per material (trunk / branches / leaves)."""
    out = {}
    me = ob.data
    for mi, mat in enumerate(me.materials):
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index != mi], context="FACES")
        nm = bpy.data.meshes.new(mat.name)
        bm.to_mesh(nm)
        bm.free()
        nm.materials.clear()
        nm.materials.append(mat)
        for p in nm.polygons:
            p.material_index = 0
        o = bpy.data.objects.new(mat.name, nm)
        o.matrix_world = ob.matrix_world
        bpy.context.scene.collection.objects.link(o)
        out[mat.name] = o
    bpy.data.objects.remove(ob)
    return out


def apply_scale(o, s):
    o.data.transform(o.matrix_world)
    o.matrix_world.identity()
    for v in o.data.vertices:
        v.co *= s


def drop_twigs(o, min_size):
    """Delete loose parts smaller than min_size (twigs hidden in the foliage): decimation cannot merge islands."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.faces.ensure_lookup_table()
    seen = set()
    kill = []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack = [f]
        island = []
        seen.add(f.index)
        while stack:
            g = stack.pop()
            island.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        vs = [v.co for g in island for v in g.verts]
        mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
        mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
        if (mx - mn).length < min_size:
            kill += island
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bm.to_mesh(o.data)
    bm.free()


def decimate(o, target):
    n = sum(len(p.vertices) - 2 for p in o.data.polygons)
    if n <= target:
        return
    m = o.modifiers.new("dec", "DECIMATE")
    m.ratio = max(0.0004, target / n)
    bpy.context.view_layer.objects.active = o
    for x in bpy.context.scene.objects:
        x.select_set(x is o)
    bpy.ops.object.modifier_apply(modifier="dec")


def setup_light(sc, strength=0.8, sun=2.6):
    sc.world = sc.world or bpy.data.worlds.new("W")
    sc.world.use_nodes = True
    sc.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.6, 0.68, 0.78, 1)
    sc.world.node_tree.nodes["Background"].inputs["Strength"].default_value = strength
    l = bpy.data.lights.new("sun", "SUN")
    l.energy = sun
    so = bpy.data.objects.new("sun", l)
    so.rotation_euler = (math.radians(50), 0, math.radians(-30))
    sc.collection.objects.link(so)
    return so


def ortho_render(sc, loc, rot, scale, res, path, clip=None, samples=48):
    cam = bpy.data.cameras.new("cam")
    cam.type = "ORTHO"
    cam.ortho_scale = scale
    if clip:
        cam.clip_start, cam.clip_end = clip
    co = bpy.data.objects.new("cam", cam)
    sc.collection.objects.link(co)
    co.location = loc
    co.rotation_euler = rot
    sc.camera = co
    sc.render.engine = "CYCLES"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.film_transparent = True
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.view_settings.view_transform = "Standard"
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(co)


def card_mesh(name, centres, normals, size, rnd, mat):
    verts, faces, uvs = [], [], []
    for c, n in zip(centres, normals):
        axis = (n + Vector((rnd.uniform(-0.7, 0.7), rnd.uniform(-0.7, 0.7), rnd.uniform(-0.3, 0.6)))).normalized()
        t = axis.orthogonal().normalized()
        b = axis.cross(t).normalized()
        a = rnd.uniform(0, math.tau)
        t, b = t * math.cos(a) + b * math.sin(a), -t * math.sin(a) + b * math.cos(a)
        s = size * rnd.uniform(0.8, 1.2) / 2
        base = len(verts)
        for (x, y, u, v) in ((-1, -1, 0, 0), (1, -1, 1, 0), (1, 1, 1, 1), (-1, 1, 0, 1)):
            verts.append(tuple(c + t * (x * s) + b * (y * s)))
            uvs.append((u, v))
        faces.append((base, base + 1, base + 2, base + 3))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    uvl = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        for li, vi in zip(poly.loop_indices, poly.vertices):
            uvl.data[li].uv = uvs[vi]
    me.materials.append(mat)
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", default="public/models/poyga/trees")
    ap.add_argument("--tex", default="public/textures/poyga/trees")
    a = ap.parse_args(argv)
    out = os.path.abspath(a.out)
    tex = os.path.abspath(a.tex)
    os.makedirs(out, exist_ok=True)
    os.makedirs(tex, exist_ok=True)
    manifest_path = os.path.join(out, "trees.json")
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}
    for src, (name, H, ncards, csize, bark_tris) in TREES.items():
        rnd = random.Random(5)
        bpy.ops.wm.read_factory_settings(use_empty=True)
        sc = bpy.context.scene
        gl = [os.path.join(a.src, src, f) for f in os.listdir(os.path.join(a.src, src)) if f.endswith(".gltf")][0]
        bpy.ops.import_scene.gltf(filepath=gl)
        ob = [o for o in sc.objects if o.type == "MESH"][0]
        # scale the ORIGINAL to the target height (base on the ground, centred) and render from it first
        from mathutils import Matrix

        ob.data.transform(ob.matrix_world)
        ob.matrix_world.identity()
        vs = ob.data.vertices
        zmin = min(v.co.z for v in vs)
        zmax = max(v.co.z for v in vs)
        cx = sum(v.co.x for v in vs) / len(vs)
        cy = sum(v.co.y for v in vs) / len(vs)
        s = H / (zmax - zmin)
        ob.data.transform(Matrix.Scale(s, 4) @ Matrix.Translation((-cx, -cy, -zmin)))
        leaf_mi = [i for i, m in enumerate(ob.data.materials) if "leaves" in m.name][0]
        lv = [p.center.copy() for p in ob.data.polygons if p.material_index == leaf_mi]
        lc = sum(lv, Vector()) / len(lv)
        xs = [v.x for v in lv]
        W = (max(xs) - min(xs)) * 1.02
        sun = setup_light(sc, strength=1.3, sun=4.0)
        S = max(H, W) * 1.04
        ortho_render(sc, (0, -80, H / 2), (math.radians(90), 0, 0), S, (max(64, int(512 * W * 1.04 / S)), max(64, int(512 * H * 1.04 / S))),
                     os.path.join(tex, f"imp_{name}.png"))
        # the densest cluster of leaves (grid count), preferring the sun side (+x) of the crown
        cell = csize * 0.6
        grid = {}
        for p in lv:
            k = (int(p.x // cell), int(p.y // cell), int(p.z // cell))
            grid[k] = grid.get(k, 0) + 1
        best = max(grid.items(), key=lambda kv: kv[1] * (1.0 + 0.15 * kv[0][0] * cell / max(1.0, W)))[0]
        side = Vector(((best[0] + 0.5) * cell, (best[1] + 0.5) * cell, (best[2] + 0.5) * cell))
        slab = csize * 1.05
        ortho_render(sc, (side.x + 30, side.y, side.z), (math.radians(90), 0, math.radians(90)), slab, (512, 512),
                     os.path.join(tex, f"leaf_{name}.png"), clip=(30 - slab * 0.6, 30 + slab * 0.6))
        parts = split_by_material(ob)
        leaves = next(o for k, o in parts.items() if "leaves" in k)
        barks = [o for k, o in parts.items() if "leaves" not in k]
        # ---- game mesh: decimated bark, cards at real leaf spots
        for o in barks:
            drop_twigs(o, 0.6)
            decimate(o, bark_tris // len(barks))
        for img in bpy.data.images:
            if img.size[0] > 512:
                img.scale(512, max(1, int(512 * img.size[1] / img.size[0])))
                img.pack()
        lm = bpy.data.materials.new("leaves")
        lm.use_nodes = True
        nt = lm.node_tree
        ti = nt.nodes.new("ShaderNodeTexImage")
        ti.image = bpy.data.images.load(os.path.join(tex, f"leaf_{name}.png"))
        b = nt.nodes["Principled BSDF"]
        nt.links.new(ti.outputs["Color"], b.inputs["Base Color"])
        nt.links.new(ti.outputs["Alpha"], b.inputs["Alpha"])
        b.inputs["Roughness"].default_value = 0.8
        pick = rnd.sample(range(len(lv)), min(ncards, len(lv)))
        centres = [lv[i] for i in pick]
        normals = [(c - Vector((lc.x, lc.y, lc.z * 0.9))).normalized() for c in centres]
        cards = card_mesh(f"{name}_leaves", centres, normals, csize, rnd, lm)
        bpy.data.objects.remove(leaves)
        bpy.data.objects.remove(sun)
        for o in sc.objects:
            o.select_set(o.type == "MESH")
        n_tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in sc.objects if o.type == "MESH")
        print(f"[cc0_trees] {src} -> {name}: {n_tris} tris, {H} m tall, crown {W:.1f} m")
        bpy.ops.export_scene.gltf(filepath=os.path.join(out, f"{name}.glb"), export_format="GLB", use_selection=True, export_yup=True,
                                  export_apply=True, export_image_format="JPEG", export_jpeg_quality=85, export_cameras=False, export_lights=False)
        # (the leaf texture needs alpha: it stays a separate PNG next to the GLB, the game binds it to the "leaves" material)
        manifest[name] = {"h": round(H, 2), "w": round(W * 1.04, 2), "leaf": f"leaf_{name}.png"}
    json.dump(manifest, open(manifest_path, "w"), indent=1)


main()
