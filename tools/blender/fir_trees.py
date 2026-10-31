"""Harakat o'yinlari - Baliq ovi: game-ready firs from Poly Haven's fir_tree_01 (CC0), made in Blender.

    blender -b --factory-startup --python tools/blender/fir_trees.py -- --src DIR/fir_tree_01 --out assets-src/models/baliq-ovi/trees --tex assets-src/textures/baliq-ovi/trees

Each of the three firs in the file (0.5 - 4 million triangles of needles) becomes:
  * trunk + branches decimated to a few thousand triangles (own bark textures, 512 px),
  * a branch-spray texture RENDERED from the tree's own needles (seen from above, alpha),
  * ~700 alpha cards lying like fir branches where the needles really are (sampled from the original twig faces),
  * an impostor rendered from the full original (front view, alpha) for the far shore.
"""

import argparse
import json
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

TREES = {
    # object in the file: (game name, cards, card size m, bark tris)
    "fir_tree_01_a_LOD0": ("fir_0", 900, 1.5, 4000),
    "fir_tree_01_b_LOD0": ("fir_1", 750, 1.3, 3500),
    "fir_tree_01_c_LOD0": ("fir_2", 750, 1.3, 3500),
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




def fir_cards(name, centres, axis_c, size, rnd, mat):
    """Cards lying like fir branches: roughly horizontal, drooping outwards, the spray pointing away from the trunk."""
    verts, faces, uvs = [], [], []
    for c in centres:
        out = Vector((c.x - axis_c.x, c.y - axis_c.y, 0))
        out = out.normalized() if out.length > 1e-4 else Vector((1, 0, 0))
        n = (Vector((0, 0, 1)) + out * rnd.uniform(0.25, 0.7) + Vector((rnd.uniform(-0.25, 0.25), rnd.uniform(-0.25, 0.25), 0))).normalized()
        # the long side of the card (u) points outwards along the branch
        t = (out - n * out.dot(n)).normalized()
        b = n.cross(t).normalized()
        s = size * rnd.uniform(0.75, 1.2) / 2
        # the card starts near the branch base: shift it half a card outwards, droop the tip a little
        base = len(verts)
        for (x, y, u, v) in ((-1, -1, 0, 0), (1, -1, 1, 0), (1, 1, 1, 1), (-1, 1, 0, 1)):
            p = c + t * (x * s * 0.95) + b * (y * s * 0.55) - Vector((0, 0, 1)) * (max(0, x) * s * 0.18)
            verts.append(tuple(p))
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
    ap.add_argument("--out", default="assets-src/models/baliq-ovi/trees")
    ap.add_argument("--tex", default="assets-src/textures/baliq-ovi/trees")
    ap.add_argument("--only", default="")
    a = ap.parse_args(argv)
    out = os.path.abspath(a.out)
    tex = os.path.abspath(a.tex)
    os.makedirs(out, exist_ok=True)
    os.makedirs(tex, exist_ok=True)
    manifest_path = os.path.join(out, "trees.json")
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}
    gl = [os.path.join(a.src, f) for f in os.listdir(a.src) if f.endswith(".gltf")][0]
    for src, (name, ncards, csize, bark_tris) in TREES.items():
        if a.only and name not in a.only.split(","):
            continue
        rnd = random.Random(7)
        bpy.ops.wm.read_factory_settings(use_empty=True)
        sc = bpy.context.scene
        bpy.ops.import_scene.gltf(filepath=gl)
        for o in list(sc.objects):
            if o.name != src:
                bpy.data.objects.remove(o)
        ob = sc.objects[src]
        ob.data.transform(ob.matrix_world)
        ob.matrix_world.identity()
        vs = ob.data.vertices
        zmin = min(v.co.z for v in vs)
        H = max(v.co.z for v in vs) - zmin
        trunk_mi = [i for i, m in enumerate(ob.data.materials) if "trunk" in m.name][0]
        tv = [ob.data.vertices[vi].co for p in ob.data.polygons if p.material_index == trunk_mi for vi in p.vertices[:1]]
        cx = sum(v.x for v in tv) / len(tv)
        cy = sum(v.y for v in tv) / len(tv)
        ob.data.transform(Matrix.Translation((-cx, -cy, -zmin)))
        leaf_mi = [i for i, m in enumerate(ob.data.materials) if "twig" in m.name][0]
        lv = [p.center.copy() for p in ob.data.polygons if p.material_index == leaf_mi]
        xs = [v.x for v in lv]
        W = (max(abs(min(xs)), abs(max(xs)))) * 2 * 1.02
        sun = setup_light(sc, strength=1.2, sun=4.0)
        S = max(H, W) * 1.04
        ortho_render(sc, (0, -80, H / 2), (math.radians(90), 0, 0), S, (max(64, int(1024 * W * 1.04 / S)), max(64, int(1024 * H * 1.04 / S))),
                     os.path.join(tex, f"imp_{name}.png"), samples=64)
        # a branch spray seen from above: the densest needle cell around 40 % of the height on the sun side
        cell = csize * 0.7
        grid = {}
        for p in lv:
            if not (0.3 * H < p.z < 0.55 * H):
                continue
            k = (int(p.x // cell), int(p.y // cell))
            grid[k] = grid.get(k, 0) + 1
        best = max(grid.items(), key=lambda kv: kv[1] * (1.0 + 0.3 * (kv[0][0] * cell) / max(1.0, W)))[0]
        cxy = Vector(((best[0] + 0.5) * cell, (best[1] + 0.5) * cell))
        zs = sorted(p.z for p in lv if abs(p.x - cxy.x) < cell / 2 and abs(p.y - cxy.y) < cell / 2)
        zc = zs[len(zs) // 2]
        slab = csize * 1.05
        # looking straight down at one branch layer (thin clip range so the branches above do not cover it)
        ortho_render(sc, (cxy.x, cxy.y, zc + 30), (0, 0, 0), slab, (512, 512), os.path.join(tex, f"leaf_{name}.png"),
                     clip=(30 - 0.6, 30 + 0.9))
        parts = split_by_material(ob)
        leaves = next(o for k, o in parts.items() if "twig" in k)
        barks = [o for k, o in parts.items() if "twig" not in k]
        for o in barks:
            drop_twigs(o, 0.5)
            share = 0.45 if "trunk" in o.name else 0.55 / max(1, len(barks) - 1)
            decimate(o, int(bark_tris * share))
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
        b.inputs["Roughness"].default_value = 0.85
        pick = rnd.sample(range(len(lv)), min(ncards, len(lv)))
        fir_cards(f"{name}_leaves", [lv[i] for i in pick], Vector((0, 0, 0)), csize, rnd, lm)
        bpy.data.objects.remove(leaves)
        bpy.data.objects.remove(sun)
        for o in sc.objects:
            o.select_set(o.type == "MESH")
        n_tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in sc.objects if o.type == "MESH")
        print(f"[fir_trees] {src} -> {name}: {n_tris} tris, {H:.1f} m tall, crown {W:.1f} m")
        bpy.ops.export_scene.gltf(filepath=os.path.join(out, f"{name}.glb"), export_format="GLB", use_selection=True, export_yup=True,
                                  export_apply=True, export_image_format="JPEG", export_jpeg_quality=85, export_cameras=False, export_lights=False)
        manifest[name] = {"h": round(H, 2), "w": round(W * 1.04, 2), "leaf": f"leaf_{name}.png"}
        json.dump(manifest, open(manifest_path, "w"), indent=1)


main()
