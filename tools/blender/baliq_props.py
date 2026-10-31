"""Harakat o'yinlari - Baliq ovi: the lake props, made in Blender from Poly Haven CC0 models (+ a modelled cattail).

    blender -b --factory-startup --python tools/blender/baliq_props.py -- --src DIR --out assets-src/models/baliq-ovi

DIR holds the Poly Haven 1k glTF downloads (modular_wooden_pier, rock_moss_set_01, grass_medium_01).
  bridge.glb : the pier, 2 x 3 sections of modular_wooden_pier scaled to the game's deck (4.2 x 8.6 m, deck at 0.55 m)
  rock.glb   : one mossy rock, decimated, unit radius, centred (the game instances it as shore and bed rocks)
  reed.glb   : a cattail clump (blades + stems + brown heads), ~2 m, own texture atlas
  grass.glb  : a patch of four grass clumps, decimated
"""

import argparse
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

# the game's pier (games/baliq-ovi/world.ts BRIDGE); game z = -blender y
Z0, Z1, HALF_W, DECK_Y = 2.4, 11.0, 2.1, 0.55


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def import_gltf(src, name):
    d = os.path.join(src, name)
    gl = [os.path.join(d, f) for f in os.listdir(d) if f.endswith(".gltf")][0]
    bpy.ops.import_scene.gltf(filepath=gl)
    for o in bpy.context.scene.objects:
        if o.type == "MESH":
            o.data.transform(o.matrix_world)
            o.matrix_world.identity()
    return {o.name: o for o in bpy.context.scene.objects if o.type == "MESH"}


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def decimate(o, target):
    n = tris(o)
    if n <= target:
        return
    m = o.modifiers.new("dec", "DECIMATE")
    m.ratio = max(0.001, target / n)
    bpy.context.view_layer.objects.active = o
    for x in bpy.context.scene.objects:
        x.select_set(x is o)
    bpy.ops.object.modifier_apply(modifier="dec")


def shrink_images(px=512):
    for img in bpy.data.images:
        if img.size[0] > px:
            img.scale(px, max(1, int(px * img.size[1] / img.size[0])))
            img.pack()


def export(path, objs):
    for o in bpy.context.scene.objects:
        o.select_set(o in objs)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
                              export_image_format="JPEG", export_jpeg_quality=85, export_cameras=False, export_lights=False)
    print(f"[baliq_props] {os.path.basename(path)}: {sum(tris(o) for o in objs)} tris")


def bounds(objs, mat_filter=None):
    mn = Vector((1e9,) * 3)
    mx = Vector((-1e9,) * 3)
    for o in objs:
        me = o.data
        for p in me.polygons:
            if mat_filter and mat_filter not in me.materials[p.material_index].name:
                continue
            for vi in p.vertices:
                v = me.vertices[vi].co
                mn = Vector(map(min, mn, v))
                mx = Vector(map(max, mx, v))
    return mn, mx


# ---------------------------------------------------------------- pier

def pier(src, out):
    reset()
    obs = import_gltf(src, "modular_wooden_pier")
    sections = [obs[k] for k in sorted(obs) if "section_0" in k and not k.endswith("05")]
    for k in list(obs):
        if obs[k] not in sections:
            bpy.data.objects.remove(obs[k])
    length = Z1 - Z0
    rows = 3
    rnd = random.Random(3)
    placed = []
    # deck (planks) of every section: its size gives the scale; sections are 2.5 x 3.5 m
    for r in range(rows):
        for c in range(2):
            s = sections[(r * 2 + c + r) % len(sections)]
            o = s.copy()
            o.data = s.data.copy()
            bpy.context.scene.collection.objects.link(o)
            mn, mx = bounds([o], "planks")
            ctr = (mn + mx) / 2
            sx = (HALF_W * 2 / 2) / (mx.x - mn.x)
            sy = (length / rows) / (mx.y - mn.y)
            sc = (sx + sy) / 2
            rot = Matrix.Rotation(math.pi if rnd.random() < 0.5 else 0, 4, "Z")
            cx = (c - 0.5) * HALF_W
            cy = -(Z0 + (r + 0.5) * length / rows)
            o.data.transform(Matrix.Translation((cx, cy, DECK_Y + 0.035)) @ Matrix.Diagonal((sx, sy, sc, 1)) @ rot @ Matrix.Translation((-ctr.x, -ctr.y, -mx.z)))
            placed.append(o)
    for s in sections:
        bpy.data.objects.remove(s)
    for o in placed:
        decimate(o, 3500)
    shrink_images(512)
    export(os.path.join(out, "bridge.glb"), placed)


# ---------------------------------------------------------------- rock

def rock(src, out):
    reset()
    obs = import_gltf(src, "rock_moss_set_01")
    keep = obs["rock_moss_set_01_rock03"]
    for k, o in obs.items():
        if o is not keep:
            bpy.data.objects.remove(o)
    mn, mx = bounds([keep])
    ctr = (mn + mx) / 2
    r = max(mx.x - mn.x, mx.y - mn.y) / 2
    keep.data.transform(Matrix.Scale(1 / r, 4) @ Matrix.Translation(-ctr))
    decimate(keep, 900)
    shrink_images(512)
    export(os.path.join(out, "rock.glb"), [keep])


# ---------------------------------------------------------------- grass patch

def grass(src, out):
    reset()
    obs = import_gltf(src, "grass_medium_01")
    pick = ["grass_medium_01_large_a_LOD0", "grass_medium_01_mid_a_LOD0", "grass_medium_01_tall_a_LOD0", "grass_medium_01_large_c_LOD0", "grass_medium_01_tall_b_LOD0"]
    offs = [(0, 0, 0), (0.22, 0.12, 1.2), (-0.15, 0.18, 2.5), (0.1, -0.22, 3.7), (-0.2, -0.12, 5.0)]
    parts = []
    for name, (x, y, a) in zip(pick, offs):
        o = obs[name]
        mn, mx = bounds([o])
        o.data.transform(Matrix.Translation((x, y, 0)) @ Matrix.Rotation(a, 4, "Z") @ Matrix.Scale(1.6, 4) @ Matrix.Translation(((mn.x + mx.x) / -2, (mn.y + mx.y) / -2, -mn.z)))
        decimate(o, 170)
        parts.append(o)
    for k, o in obs.items():
        if o not in parts:
            bpy.data.objects.remove(o)
    bpy.context.view_layer.objects.active = parts[0]
    for o in bpy.context.scene.objects:
        o.select_set(o in parts)
    bpy.ops.object.join()
    shrink_images(512)
    export(os.path.join(out, "grass.glb"), [parts[0]])


# ---------------------------------------------------------------- cattail clump

def reed(out, tex_dir):
    reset()
    # texture atlas: u 0..0.7 a blade (dark base -> green -> straw tip, fine veins), u 0.7..1 stem (v < 0.6) and the brown head
    W, H = 128, 512
    img = bpy.data.images.new("reed_atlas", W, H)
    rnd = random.Random(11)
    veins = [rnd.uniform(-0.06, 0.06) for _ in range(W)]
    px = []
    for j in range(H):
        v = j / (H - 1)
        for i in range(W):
            u = i / (W - 1)
            if u < 0.7:
                g = (0.16 + 0.22 * v, 0.24 + 0.2 * v, 0.07 + 0.04 * v)
                tip = max(0.0, (v - 0.82) / 0.18)
                g = tuple(a + (b - a) * tip for a, b in zip(g, (0.55, 0.5, 0.3)))
                k = 1 + veins[i] + (0.05 if (i // 3) % 2 else 0)
                px += [g[0] * k, g[1] * k, g[2] * k, 1]
            elif v < 0.6:
                px += [0.22 + 0.15 * v, 0.3 + 0.1 * v, 0.1, 1]
            else:
                n = 1 + rnd.uniform(-0.12, 0.12)
                px += [0.22 * n, 0.12 * n, 0.06 * n, 1]
    img.pixels = px
    img.filepath_raw = os.path.join(tex_dir, "reed_atlas.png")
    img.file_format = "PNG"
    img.save()
    mat = bpy.data.materials.new("reed")
    mat.use_nodes = True
    ti = mat.node_tree.nodes.new("ShaderNodeTexImage")
    ti.image = img
    mat.node_tree.links.new(ti.outputs["Color"], mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
    mat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.7
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")

    def strip(base, direction, length, width, bend, seg=6, u0=0.0, u1=0.7, v0=0.0, v1=1.0, taper=True):
        side = Vector((-direction.y, direction.x, 0)).normalized()
        rows = []
        for k in range(seg + 1):
            t = k / seg
            p = base + direction * (length * t * (1 - 0.35 * bend * t)) + Vector((0, 0, length * t * (1 - 0.55 * bend * t * t)))
            w = width * (1 - t) ** 0.8 + 0.002 if taper else width * (0.75 + 0.25 * math.sin(math.pi * t))
            rows.append((bm.verts.new(p - side * w), bm.verts.new(p + side * w), v0 + (v1 - v0) * t))
        for k in range(seg):
            a, b, va = rows[k]
            c, d, vc = rows[k + 1]
            f = bm.faces.new((a, b, d, c))
            for loop, uv in zip(f.loops, ((u0, va), (u1, va), (u1, vc), (u0, vc))):
                loop[uvl].uv = uv

    for k in range(11):
        a = k / 11 * math.tau + rnd.uniform(-0.3, 0.3)
        d = Vector((math.cos(a), math.sin(a), 0)) * rnd.uniform(0.15, 0.45)
        strip(Vector((math.cos(a) * 0.05, math.sin(a) * 0.05, 0)), d, rnd.uniform(1.3, 2.1), rnd.uniform(0.018, 0.028), rnd.uniform(0.3, 0.9))
    for k in range(3):
        a = rnd.uniform(0, math.tau)
        base = Vector((math.cos(a) * 0.06, math.sin(a) * 0.06, 0))
        h = rnd.uniform(1.7, 2.2)
        lean = Vector((math.cos(a), math.sin(a), 0)) * 0.06
        strip(base, lean, h, 0.008, 0.05, seg=4, u0=0.72, u1=0.98, v0=0.0, v1=0.58)
        strip(base + lean * 0.7 + Vector((0, 0, h * 0.74)), lean * 0.1, 0.24, 0.022, 0.0, seg=2, u0=0.72, u1=0.98, v0=0.62, v1=1.0, taper=False)
        strip(base + lean * 0.7 + Vector((0, 0, h * 0.74)), Vector((-lean.y, lean.x, 0)) * 0.1, 0.24, 0.022, 0.0, seg=2, u0=0.72, u1=0.98, v0=0.62, v1=1.0, taper=False)
    me = bpy.data.meshes.new("reed")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    o = bpy.data.objects.new("reed", me)
    bpy.context.scene.collection.objects.link(o)
    export(os.path.join(out, "reed.glb"), [o])


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", default="assets-src/models/baliq-ovi")
    ap.add_argument("--tex", default="tools/blender/out")
    ap.add_argument("--only", default="pier,rock,grass,reed")
    a = ap.parse_args(argv)
    out = os.path.abspath(a.out)
    os.makedirs(out, exist_ok=True)
    os.makedirs(os.path.abspath(a.tex), exist_ok=True)
    only = a.only.split(",")
    if "pier" in only:
        pier(a.src, out)
    if "rock" in only:
        rock(a.src, out)
    if "grass" in only:
        grass(a.src, out)
    if "reed" in only:
        reed(out, os.path.abspath(a.tex))


main()
