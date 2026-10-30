"""Harakat o'yinlari - a realistic Tashkent-style street in Blender with the cars of tools/blender/cars.py, animated.

    blender -b --factory-startup --python tools/blender/street.py -- --out tools/blender/out/kocha.blend [--render out.png]

Crossroads of two 4-lane streets: asphalt with wear, markings (dashes, double line, stop lines, zebras), granite curbs,
tiled pavements, grass strips with plane trees (chinor), street lamps, traffic lights that cycle, blocks of flats with
shops on the ground floor, parked and moving cars (wheels roll), a chase camera and a wide camera. Blender coordinates:
z up, streets along y (main) and x (cross). Cars face -y in their own frame (the game's +z nose).
"""

import math
import os
import random
import sys

import bpy
import bmesh
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cars  # noqa: E402

FPS = 30
FRAMES = 360
ROAD_W = 14.0          # 4 lanes x 3.5 m
CURB = 0.3
WALK = 5.0             # pavement width (with the tree strip)
HALF = ROAD_W / 2
LEN = 130.0            # each street runs -LEN..LEN

rnd = random.Random(7)


# ------------------------------------------------------------------------------------------------ helpers

def find_lc(name, lc=None):
    lc = lc or bpy.context.view_layer.layer_collection
    if lc.name == name:
        return lc
    for ch in lc.children:
        r = find_lc(name, ch)
        if r:
            return r
    return None


def coll(name, parent=None):
    c = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(c)
    return c


def obj_from_bm(name, bm, mat, col):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if mat:
        me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    return ob


def box(name, center, size, mat, col, bevel=0.0, segs=2):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0] + center[0], v.co.y * size[1] + center[1], v.co.z * size[2] + center[2]))
    ob = obj_from_bm(name, bm, mat, col)
    if bevel > 0:
        m = ob.modifiers.new("bevel", "BEVEL")
        m.width = bevel
        m.segments = segs
        m.limit_method = "ANGLE"
    for p in ob.data.polygons:
        p.use_smooth = bevel > 0
    return ob


def plane(name, x0, y0, x1, y1, z, mat, col):
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in ((x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z))]
    bm.faces.new(vs)
    return obj_from_bm(name, bm, mat, col)


def cyl(name, center, r, depth, mat, col, verts=16, r2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=r, radius2=r if r2 is None else r2, depth=depth)
    for v in bm.verts:
        v.co += Vector(center)
    ob = obj_from_bm(name, bm, mat, col)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def nodes(mat):
    mat.use_nodes = True
    nt = mat.node_tree
    return nt, nt.nodes, nt.links, nt.nodes["Principled BSDF"]


def simple(name, color, rough=0.5, metal=0.0, emit=None, strength=0.0):
    m = bpy.data.materials.new(name)
    nt, N, L, b = nodes(m)
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = strength
    return m


def noise_mix(m, c1, c2, scale, detail=6, rough=(0.8, 0.95), bump=0.2, bump_scale=None, coords="Object"):
    """Base colour = two colours mixed by noise; roughness follows; fine bump noise."""
    nt, N, L, b = nodes(m)
    tc = N.new("ShaderNodeTexCoord")
    nz = N.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = scale
    nz.inputs["Detail"].default_value = detail
    L.new(tc.outputs[coords], nz.inputs["Vector"])
    ramp = N.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (*c1, 1)
    ramp.color_ramp.elements[1].color = (*c2, 1)
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[1].position = 0.7
    L.new(nz.outputs["Fac"], ramp.inputs["Fac"])
    L.new(ramp.outputs["Color"], b.inputs["Base Color"])
    rr = N.new("ShaderNodeMapRange")
    rr.inputs["To Min"].default_value, rr.inputs["To Max"].default_value = rough
    L.new(nz.outputs["Fac"], rr.inputs["Value"])
    L.new(rr.outputs["Result"], b.inputs["Roughness"])
    if bump:
        fn = N.new("ShaderNodeTexNoise")
        fn.inputs["Scale"].default_value = bump_scale or scale * 60
        fn.inputs["Detail"].default_value = 2
        L.new(tc.outputs[coords], fn.inputs["Vector"])
        bp = N.new("ShaderNodeBump")
        bp.inputs["Strength"].default_value = bump
        bp.inputs["Distance"].default_value = 0.02
        L.new(fn.outputs["Fac"], bp.inputs["Height"])
        L.new(bp.outputs["Normal"], b.inputs["Normal"])
    return m, (nt, N, L, b, tc, ramp)


# ------------------------------------------------------------------------------------------------ materials

def make_mats():
    M = {}
    asphalt = bpy.data.materials.new("asfalt")
    asphalt, (nt, N, L, b, tc, ramp) = noise_mix(asphalt, (0.042, 0.042, 0.044), (0.062, 0.061, 0.06), 0.7, detail=8, rough=(0.8, 0.93), bump=0.35, bump_scale=900)
    # aggregate speckle on top of the large blotches
    sp = N.new("ShaderNodeTexVoronoi")
    sp.inputs["Scale"].default_value = 420
    L.new(tc.outputs["Object"], sp.inputs["Vector"])
    mx = N.new("ShaderNodeMix")
    mx.data_type = "RGBA"
    mx.blend_type = "LIGHTEN"
    mx.inputs[0].default_value = 0.35
    L.new(ramp.outputs["Color"], mx.inputs[6])
    gr = N.new("ShaderNodeValToRGB")
    gr.color_ramp.elements[0].color = (0.03, 0.03, 0.03, 1)
    gr.color_ramp.elements[1].color = (0.16, 0.155, 0.15, 1)
    gr.color_ramp.elements[0].position = 0.85
    L.new(sp.outputs["Distance"], gr.inputs["Fac"])
    L.new(gr.outputs["Color"], mx.inputs[7])
    # darker tyre tracks in the middle of each lane (cos of x across the lane width)
    sep = N.new("ShaderNodeSeparateXYZ")
    L.new(tc.outputs["Object"], sep.inputs["Vector"])
    mth = N.new("ShaderNodeMath")
    mth.operation = "MULTIPLY"
    mth.inputs[1].default_value = 2 * math.pi / 1.75
    L.new(sep.outputs["X"], mth.inputs[0])
    cs = N.new("ShaderNodeMath")
    cs.operation = "COSINE"
    L.new(mth.outputs[0], cs.inputs[0])
    trk = N.new("ShaderNodeMix")
    trk.data_type = "RGBA"
    trk.blend_type = "MULTIPLY"
    mr = N.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = 0.4
    mr.inputs["To Max"].default_value = 0.25
    L.new(cs.outputs[0], mr.inputs["Value"])
    L.new(mr.outputs["Result"], trk.inputs[0])
    L.new(mx.outputs[2], trk.inputs[6])
    trk.inputs[7].default_value = (0.7, 0.7, 0.7, 1)
    L.new(trk.outputs[2], b.inputs["Base Color"])
    M["asphalt"] = asphalt

    paint, (nt, N, L, b, tc, ramp) = noise_mix(bpy.data.materials.new("chiziq"), (0.55, 0.55, 0.53), (0.85, 0.85, 0.82), 3.0, rough=(0.55, 0.8), bump=0.1)
    M["line"] = paint
    M["curb"], _ = noise_mix(bpy.data.materials.new("bordyur"), (0.32, 0.32, 0.31), (0.5, 0.49, 0.47), 6.0, rough=(0.6, 0.85), bump=0.3)
    tiles = bpy.data.materials.new("trotuar")
    nt, N, L, b = nodes(tiles)
    tc = N.new("ShaderNodeTexCoord")
    br = N.new("ShaderNodeTexBrick")
    br.inputs["Scale"].default_value = 2.2
    br.inputs["Mortar Size"].default_value = 0.012
    br.inputs["Color1"].default_value = (0.36, 0.33, 0.3, 1)
    br.inputs["Color2"].default_value = (0.5, 0.47, 0.43, 1)
    br.inputs["Mortar"].default_value = (0.12, 0.11, 0.1, 1)
    br.offset = 0.5
    L.new(tc.outputs["Object"], br.inputs["Vector"])
    L.new(br.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.8
    bp = N.new("ShaderNodeBump")
    bp.inputs["Strength"].default_value = 0.6
    bp.invert = True
    L.new(br.outputs["Fac"], bp.inputs["Height"])
    L.new(bp.outputs["Normal"], b.inputs["Normal"])
    M["walk"] = tiles
    M["grass"], _ = noise_mix(bpy.data.materials.new("maysa"), (0.05, 0.12, 0.02), (0.13, 0.22, 0.04), 3.0, rough=(0.8, 1.0), bump=0.5, bump_scale=300)
    M["soil"], _ = noise_mix(bpy.data.materials.new("tuproq"), (0.08, 0.05, 0.03), (0.16, 0.11, 0.07), 4.0, rough=(0.9, 1.0), bump=0.6)
    M["bark"], _ = noise_mix(bpy.data.materials.new("po'stloq"), (0.12, 0.1, 0.08), (0.3, 0.27, 0.22), 9.0, rough=(0.8, 1.0), bump=0.8, bump_scale=60)
    leaf = bpy.data.materials.new("barg")
    nt, N, L, b = nodes(leaf)
    oi = N.new("ShaderNodeObjectInfo")
    nz = N.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 3.5
    ramp = N.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.04, 0.1, 0.015, 1)
    ramp.color_ramp.elements[1].color = (0.2, 0.32, 0.05, 1)
    add = N.new("ShaderNodeMath")
    add.operation = "ADD"
    L.new(nz.outputs["Fac"], add.inputs[0])
    L.new(oi.outputs["Random"], add.inputs[1])
    mul = N.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    mul.inputs[1].default_value = 0.6
    L.new(add.outputs[0], mul.inputs[0])
    L.new(mul.outputs[0], ramp.inputs["Fac"])
    L.new(ramp.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.6
    b.inputs["Subsurface Weight"].default_value = 0.15
    vor = N.new("ShaderNodeTexVoronoi")
    vor.inputs["Scale"].default_value = 40
    bp = N.new("ShaderNodeBump")
    bp.inputs["Strength"].default_value = 0.9
    L.new(vor.outputs["Distance"], bp.inputs["Height"])
    L.new(bp.outputs["Normal"], b.inputs["Normal"])
    M["leaf"] = leaf
    M["leaf_in"], _ = noise_mix(bpy.data.materials.new("barg_ichi"), (0.03, 0.07, 0.015), (0.07, 0.13, 0.03), 2.0, rough=(0.8, 1.0), bump=0.6)
    M["plaster"] = []
    for i, (c1, c2) in enumerate((((0.62, 0.55, 0.44), (0.72, 0.66, 0.55)), ((0.7, 0.68, 0.64), (0.8, 0.78, 0.74)),
                                   ((0.55, 0.42, 0.32), (0.66, 0.52, 0.4)), ((0.6, 0.62, 0.6), (0.7, 0.72, 0.7)))):
        m, _ = noise_mix(bpy.data.materials.new(f"suvoq{i}"), c1, c2, 1.2, rough=(0.75, 0.95), bump=0.25, bump_scale=120)
        M["plaster"].append(m)
    M["glass"] = simple("deraza", (0.02, 0.025, 0.03), 0.03, 0.0)
    M["glass"].node_tree.nodes["Principled BSDF"].inputs["Specular IOR Level"].default_value = 0.8
    M["frame"] = simple("rom", (0.75, 0.75, 0.72), 0.4)
    M["shopglass"] = simple("vitrina", (0.05, 0.06, 0.06), 0.02, 0.0, (1.0, 0.85, 0.6), 0.6)
    M["metal"] = simple("metall", (0.12, 0.13, 0.14), 0.35, 0.8)
    M["steel"] = simple("po'lat", (0.6, 0.6, 0.6), 0.3, 1.0)
    M["lamp"] = simple("chiroq", (1, 0.9, 0.7), 0.3, 0.0, (1, 0.85, 0.6), 3.0)
    M["tl_box"] = simple("svetofor", (0.02, 0.02, 0.02), 0.5)
    M["sign_blue"] = simple("belgi_kok", (0.0, 0.12, 0.55), 0.4)
    M["sign_white"] = simple("belgi_oq", (0.85, 0.85, 0.85), 0.4)
    M["sign_red"] = simple("belgi_qizil", (0.6, 0.02, 0.02), 0.4)
    M["roof"] = simple("tom", (0.12, 0.12, 0.13), 0.9)
    M["shop"] = [simple(f"vivеska{i}".replace("е", "e"), c, 0.4, 0.0, c, 1.5) for i, c in enumerate(((0.0, 0.35, 0.15), (0.55, 0.05, 0.05), (0.05, 0.15, 0.6), (0.7, 0.4, 0.0)))]
    M["text"] = simple("yozuv", (1, 1, 1), 0.4, 0.0, (1, 1, 1), 2.0)
    M["manhole"] = simple("lyuk", (0.05, 0.05, 0.05), 0.5, 0.9)
    M["bench"] = simple("skameyka", (0.25, 0.14, 0.06), 0.6)
    return M


# ------------------------------------------------------------------------------------------------ streets

def streets(M, C):
    c = coll("Yo'llar", C)
    # asphalt: main street (along y) and cross street (along x) as one cross-shaped surface
    for (x0, y0, x1, y1) in ((-HALF, -LEN, HALF, LEN), (-LEN, -HALF, -HALF, HALF), (HALF, -HALF, LEN, HALF)):
        plane("asfalt", x0, y0, x1, y1, 0.0, M["asphalt"], c)
    # markings (2 mm above the asphalt)
    mk = coll("Chiziqlar", c)
    z = 0.002
    stop = HALF + 6.5  # zebra + stop line before the crossroads
    for sgn in (1, -1):
        # main street: double centre line, lane dashes, edge lines
        y_a, y_b = sgn * stop, sgn * LEN
        ya, yb = min(y_a, y_b), max(y_a, y_b)
        for dx in (-0.09, 0.09):
            plane("markaz", dx - 0.06, ya, dx + 0.06, yb, z, M["line"], mk)
        for lane_x in (-3.5, 3.5):
            y = ya
            while y < yb:
                plane("punktir", lane_x - 0.07, y, lane_x + 0.07, min(y + 3.0, yb), z, M["line"], mk)
                y += 9.0
        for ex in (-HALF + 0.35, HALF - 0.35):
            plane("chet", ex - 0.06, ya, ex + 0.06, yb, z, M["line"], mk)
        # cross street
        xa, xb = min(sgn * stop, sgn * LEN), max(sgn * stop, sgn * LEN)
        for dy in (-0.09, 0.09):
            plane("markaz", xa, dy - 0.06, xb, dy + 0.06, z, M["line"], mk)
        for lane_y in (-3.5, 3.5):
            x = xa
            while x < xb:
                plane("punktir", x, lane_y - 0.07, min(x + 3.0, xb), lane_y + 0.07, z, M["line"], mk)
                x += 9.0
        for ey in (-HALF + 0.35, HALF - 0.35):
            plane("chet", xa, ey - 0.06, xb, ey + 0.06, z, M["line"], mk)
        # zebras (stripes along the traffic, 0.5 m wide, 4 m long) and stop lines
        zy = sgn * (HALF + 3.0)
        k = -HALF + 0.6
        while k < HALF - 0.4:
            plane("zebra", k, zy - 2.0, k + 0.5, zy + 2.0, z, M["line"], mk)
            plane("zebra", zy - 2.0, k, zy + 2.0, k + 0.5, z, M["line"], mk)
            k += 1.0
        # stop lines on the right-hand lanes only (traffic drives on the right)
        sy = sgn * (HALF + 5.6)
        if sgn > 0:
            plane("stop", 0.2, sy - 0.2, HALF, sy + 0.2, z, M["line"], mk)
            plane("stop", sy - 0.2, -HALF, sy + 0.2, -0.2, z, M["line"], mk)
        else:
            plane("stop", -HALF, sy - 0.2, -0.2, sy + 0.2, z, M["line"], mk)
            plane("stop", sy - 0.2, 0.2, sy + 0.2, HALF, z, M["line"], mk)
    # manholes and a repaired patch
    for (x, y) in ((1.7, 30), (-5.0, -22), (24, 1.8), (-35, -4.5), (5.2, 64)):
        cyl("lyuk", (x, y, 0.004), 0.32, 0.01, M["manhole"], mk, 24)
    patch = plane("yamoq", -6.4, -48, -2.2, -41, 0.001, None, mk)
    pm = M["asphalt"].copy()
    pm.name = "asfalt_yamoq"
    pm.node_tree.nodes["Color Ramp"].color_ramp.elements[0].color = (0.02, 0.02, 0.022, 1)
    patch.data.materials.append(pm)
    return c


def blocks(M, C):
    """Pavements, curbs, tree strips for the four corner blocks; returns the blocks' inner rectangles."""
    c = coll("Trotuar", C)
    rects = []
    for sx in (1, -1):
        for sy in (1, -1):
            x0, x1 = sorted((sx * (HALF), sx * LEN))
            y0, y1 = sorted((sy * (HALF), sy * LEN))
            # curbs along both streets
            cx = sx * (HALF + CURB / 2)
            cy = sy * (HALF + CURB / 2)
            ya, yb = (y0 + (CURB if sy > 0 else 0), y1 - (0 if sy > 0 else CURB))
            xa, xb = (x0 + (CURB if sx > 0 else 0), x1 - (0 if sx > 0 else CURB))
            box("bordyur", (cx, (y0 + y1) / 2, 0.075), (CURB, y1 - y0, 0.15), M["curb"], c, 0.02)
            box("bordyur", ((x0 + x1) / 2, cy, 0.075), (x1 - x0, CURB, 0.15), M["curb"], c, 0.02)
            # pavement slab (14 cm high) inside the curbs
            px0, px1 = sorted((sx * (HALF + CURB), sx * LEN))
            py0, py1 = sorted((sy * (HALF + CURB), sy * LEN))
            box("trotuar", ((px0 + px1) / 2, (py0 + py1) / 2, 0.07), (px1 - px0, py1 - py0, 0.14), M["walk"], c)
            # grass strips along the streets (1.6 m, between the curb side and the walking part)
            gx = sx * (HALF + CURB + 1.0)
            gy = sy * (HALF + CURB + 1.0)
            ga, gb = sorted((sy * (HALF + CURB + 6.0), sy * (LEN - 2)))
            box("maysa", (gx, (ga + gb) / 2, 0.145), (1.6, gb - ga, 0.012), M["grass"], c)
            ha, hb = sorted((sx * (HALF + CURB + 6.0), sx * (LEN - 2)))
            box("maysa", ((ha + hb) / 2, gy, 0.145), (hb - ha, 1.6, 0.012), M["grass"], c)
            rects.append((sx, sy))
    # ground beyond
    g = plane("yer", -400, -400, 400, 400, -0.02, M["grass"], c)
    return rects


LEAF = {}


def leaf_setup(M, hidden):
    """A twig of five plane-tree (chinor) leaves; a particle setting covers a leaf cluster with twigs."""
    if LEAF:
        return LEAF["ps"]
    bm = bmesh.new()
    for t in range(5):
        a = -0.9 + t * 0.45
        ox, oy = math.sin(a) * 0.12, math.cos(a) * 0.12
        rim = []
        for k in range(7):
            b = 2 * math.pi * k / 7
            lobe = 0.6 + 0.4 * abs(math.cos(b * 2.5))
            rim.append(bm.verts.new((ox + math.sin(a) * 0.07 + math.cos(b) * lobe * 0.075, oy + math.cos(a) * 0.07 + math.sin(b) * lobe * 0.075, (t % 2) * 0.02)))
        bm.faces.new(rim)
    leaf = obj_from_bm("chinor_shoxcha", bm, M["leaf"], hidden)
    ps = bpy.data.particles.new("barglar")
    ps.type = "HAIR"
    ps.use_advanced_hair = True
    ps.count = 900
    ps.hair_length = 0.3
    ps.render_type = "OBJECT"
    ps.instance_object = leaf
    ps.particle_size = 1.9
    ps.size_random = 0.5
    ps.use_rotations = True
    ps.rotation_mode = "NOR"
    ps.rotation_factor_random = 0.8
    ps.phase_factor_random = 2.0
    ps.display_percentage = 10
    ps.use_emit_random = True
    LEAF["ps"] = ps
    return ps


TREES = []


def tree_proto(M, C, hidden, h):
    """One plane tree at the origin in its own (hidden) collection, placed many times as a collection instance."""
    c = coll(f"Daraxt_{len(TREES)}", C)
    ps = leaf_setup(M, hidden)
    cyl("tana", (0, 0, 0.14 + h * 0.28), 0.17 + h * 0.012, h * 0.56, M["bark"], c, 14, r2=0.11)
    top = 0.14 + h * 0.56
    for k in range(4):
        a = k * math.pi / 2 + rnd.uniform(-0.4, 0.4)
        ln = h * rnd.uniform(0.25, 0.32)
        tilt = rnd.uniform(0.5, 0.8)
        br = cyl("shox", (0, 0, ln / 2), 0.075, ln, M["bark"], c, 8, r2=0.035)
        br.location = (0, 0, top - 0.4)
        br.rotation_euler = (tilt * math.cos(a + math.pi / 2), tilt * math.sin(a + math.pi / 2), 0)
    for k in range(8):
        a = rnd.uniform(0, 2 * math.pi)
        rr = rnd.uniform(0.4, 1.9) * (h / 9)
        cz = top + rnd.uniform(0.3, h * 0.38)
        r = rnd.uniform(1.0, 1.5) * (h / 9)
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=r)
        for v in bm.verts:
            v.co += Vector((rr * math.cos(a), rr * math.sin(a), cz))
        ob = obj_from_bm("barg_toda", bm, M["leaf_in"], c)
        d = ob.modifiers.new("displace", "DISPLACE")
        tx = bpy.data.textures.get("barg_tex") or bpy.data.textures.new("barg_tex", "CLOUDS")
        tx.noise_scale = 0.7
        d.texture = tx
        d.strength = 0.4
        d.texture_coords = "GLOBAL"
        for p in ob.data.polygons:
            p.use_smooth = True
        ob.modifiers.new("barglar", "PARTICLE_SYSTEM")
        ob.particle_systems[0].settings = ps
        ob.particle_systems[0].seed = rnd.randint(0, 9999)
    find_lc(c.name).exclude = True
    TREES.append(c)
    return c


def tree(M, c, x, y, h, hidden):
    if len(TREES) < 4:
        tree_proto(M, PROTO["coll"], hidden, 9.5)
    proto = TREES[rnd.randrange(len(TREES))]
    e = bpy.data.objects.new("Chinor", None)
    e.instance_type = "COLLECTION"
    e.instance_collection = proto
    e.location = (x, y, 0)
    e.rotation_euler.z = rnd.uniform(0, 2 * math.pi)
    e.scale = (h / 9.5,) * 3
    c.objects.link(e)
    box("chuqur", (x, y, 0.143), (1.2, 1.2, 0.01), M["soil"], c)


PROTO = {}


def street_lamp(M, c, x, y, facing):
    cyl("ustun", (x, y, 4.1), 0.09, 8.0, M["metal"], c, 12, r2=0.06)
    dx = math.cos(facing) * 1.1
    dy = math.sin(facing) * 1.1
    arm = cyl("qo'l", (x + dx / 2, y + dy / 2, 8.0), 0.04, 2.2, M["metal"], c, 8)
    arm.rotation_euler = (0, math.pi / 2, facing)
    head = box("chiroq_korpus", (x + dx * 2, y + dy * 2, 7.95), (0.7, 0.32, 0.12), M["metal"], c, 0.03)
    head.rotation_euler.z = facing
    lamp = box("chiroq", (x + dx * 2, y + dy * 2, 7.88), (0.55, 0.24, 0.02), M["lamp"], c)
    lamp.rotation_euler.z = facing


def traffic_light(M, c, x, y, facing, phase):
    """Pole + head facing `facing` (radians, direction to the drivers). phase 0 = green for the main street first."""
    cyl("svetofor_ustun", (x, y, 2.0), 0.07, 4.0, M["metal"], c, 12)
    hx, hy = x + math.cos(facing) * 0.15, y + math.sin(facing) * 0.15
    head = box("svetofor", (hx, hy, 3.4), (0.36, 0.3, 1.0), M["tl_box"], c, 0.03)
    head.rotation_euler.z = facing - math.pi / 2
    cols = [((1, 0.05, 0.02), "qizil"), ((1, 0.6, 0.0), "sariq"), ((0.1, 1, 0.3), "yashil")]
    for i, (col, nm) in enumerate(cols):
        m = simple(f"svet_{nm}_{phase}_{len(bpy.data.materials)}", (0.05, 0.05, 0.05), 0.2, 0.0, col, 0.0)
        lx, ly = hx + math.cos(facing) * 0.16, hy + math.sin(facing) * 0.16
        l = cyl(f"svet_{nm}", (lx, ly, 3.72 - i * 0.31), 0.11, 0.04, m, c, 20)
        l.rotation_euler = (math.pi / 2, 0, facing - math.pi / 2)
        animate_signal(m, i, phase)


def animate_signal(m, which, phase):
    """Cycle: green 7 s, yellow 2 s, red 9 s (the other street is shifted by 9 s)."""
    b = m.node_tree.nodes["Principled BSDF"]
    sock = b.inputs["Emission Strength"]
    cyc = 18 * FPS
    off = 0 if phase == 0 else 9 * FPS
    prefs = bpy.context.preferences.edit
    old = prefs.keyframe_new_interpolation_type
    prefs.keyframe_new_interpolation_type = "CONSTANT"
    for start in range(-cyc, FRAMES + cyc, cyc):
        s = start + off
        on = {2: (s, s + 7 * FPS), 1: (s + 7 * FPS, s + 9 * FPS), 0: (s + 9 * FPS, s + 18 * FPS)}[which]
        for f, v in ((on[0], 12.0), (on[1], 0.0)):
            sock.default_value = v
            sock.keyframe_insert("default_value", frame=f)
    prefs.keyframe_new_interpolation_type = old


def building(M, c, x0, y0, x1, y1, floors, mat, front, shop_name=None, shop_mat=None):
    """Block of flats: plaster box, windows on all four facades (frames + glass + sills), balconies, shops on the
    ground floor of the street side (`front` = 'x+', 'x-', 'y+' or 'y-')."""
    fh = 3.0
    H = floors * fh + 0.6
    b = box("bino", ((x0 + x1) / 2, (y0 + y1) / 2, H / 2), (x1 - x0, y1 - y0, H), mat, c)
    box("parapet", ((x0 + x1) / 2, (y0 + y1) / 2, H + 0.05), (x1 - x0 + 0.2, y1 - y0 + 0.2, 0.25), M["roof"], c)
    win_w, win_h, step = 1.4, 1.5, 3.2
    for side in ("x+", "x-", "y+", "y-"):
        along_x = side[0] == "y"
        a0, a1 = (x0, x1) if along_x else (y0, y1)
        n = max(1, int((a1 - a0 - 1.0) / step))
        margin = ((a1 - a0) - (n - 1) * step) / 2
        outer = (y1 if side == "y+" else y0) if along_x else (x1 if side == "x+" else x0)
        sgn = 1 if side[1] == "+" else -1
        for fl in range(floors):
            zc = fl * fh + 1.6
            shop = side == front and fl == 0
            for i in range(n):
                a = a0 + margin + i * step
                if shop:
                    w, h = step * 0.86, 2.4
                    zc2 = 1.35
                    gm = M["shopglass"]
                else:
                    w, h, zc2 = win_w, win_h, zc
                    gm = M["glass"]
                if along_x:
                    box("rom", (a, outer + sgn * 0.02, zc2), (w + 0.12, 0.08, h + 0.12), M["frame"], c)
                    box("oyna", (a, outer + sgn * 0.065, zc2), (w, 0.02, h), gm, c)
                    if not shop:
                        box("tokcha", (a, outer + sgn * 0.12, zc2 - h / 2 - 0.05), (w + 0.2, 0.2, 0.05), M["frame"], c)
                    if not shop and fl > 0 and i % 2 == 0 and side == front:
                        box("balkon", (a, outer + sgn * 0.7, zc2 - 0.9), (w + 0.6, 1.3, 0.12), mat, c)
                        box("balkon_devor", (a, outer + sgn * 1.32, zc2 - 0.4), (w + 0.6, 0.06, 0.9), mat, c)
                else:
                    box("rom", (outer + sgn * 0.02, a, zc2), (0.08, w + 0.12, h + 0.12), M["frame"], c)
                    box("oyna", (outer + sgn * 0.065, a, zc2), (0.02, w, h), gm, c)
                    if not shop:
                        box("tokcha", (outer + sgn * 0.12, a, zc2 - h / 2 - 0.05), (0.2, w + 0.2, 0.05), M["frame"], c)
                    if not shop and fl > 0 and i % 2 == 0 and side == front:
                        box("balkon", (outer + sgn * 0.7, a, zc2 - 0.9), (1.3, w + 0.6, 0.12), mat, c)
                        box("balkon_devor", (outer + sgn * 1.32, a, zc2 - 0.4), (0.06, w + 0.6, 0.9), mat, c)
        if side == front and shop_name:
            mid = (a0 + a1) / 2
            L = min(a1 - a0 - 2, 9.0)
            if along_x:
                box("vivеska".replace("е", "e"), (mid, outer + sgn * 0.15, 2.95), (L, 0.15, 0.6), shop_mat, c, 0.02)
            else:
                box("viveska", (outer + sgn * 0.15, mid, 2.95), (0.15, L, 0.6), shop_mat, c, 0.02)
            cu = bpy.data.curves.new("yozuv", "FONT")
            cu.body = shop_name
            cu.align_x = "CENTER"
            cu.align_y = "CENTER"
            cu.size = 0.42
            cu.extrude = 0.01
            t = bpy.data.objects.new("yozuv", cu)
            c.objects.link(t)
            cu.materials.append(M["text"])
            rot = {"y+": 0.0, "y-": math.pi, "x+": -math.pi / 2, "x-": math.pi / 2}[side]
            if along_x:
                t.location = (mid, outer + sgn * 0.24, 2.95)
            else:
                t.location = (outer + sgn * 0.24, mid, 2.95)
            t.rotation_euler = (math.pi / 2, 0, rot + (math.pi if sgn > 0 and along_x else 0) - (0 if along_x else 0))
            if along_x:
                t.rotation_euler = (math.pi / 2, 0, 0.0 if sgn < 0 else math.pi)
            else:
                t.rotation_euler = (math.pi / 2, 0, -math.pi / 2 if sgn < 0 else math.pi / 2)
    return b


def city(M, C):
    c = coll("Shahar", C)
    trees = coll("Daraxtlar", C)
    lamps = coll("Chiroqlar", C)
    PROTO["coll"] = coll("Daraxt_asl", C)
    hidden = coll("Barg_asl", C)
    find_lc(hidden.name).hide_viewport = True
    hidden.hide_render = True
    names = ["DORIXONA", "NON VA SOMSA", "OZIQ-OVQAT", "KAFE", "MEVA-SABZAVOT", "TELEFONLAR", "KITOBLAR", "GULLAR"]
    k = 0
    for sx in (1, -1):
        for sy in (1, -1):
            # buildings along the main street (front = towards x = 0) and along the cross street
            bx0 = HALF + CURB + WALK + 3.0
            y = HALF + CURB + WALK + 3.0
            while y < LEN - 20:
                depth = rnd.uniform(12, 14)
                length = rnd.choice((24.0, 30.0, 36.0))
                floors = rnd.choice((4, 5, 5, 9))
                x0, x1 = sorted((sx * bx0, sx * (bx0 + depth)))
                y0, y1 = sorted((sy * y, sy * (y + length)))
                building(M, c, x0, y0, x1, y1, floors, rnd.choice(M["plaster"]), "x-" if sx > 0 else "x+",
                         names[k % len(names)], M["shop"][k % len(M["shop"])])
                k += 1
                y += length + rnd.uniform(8, 14)
            x = HALF + CURB + WALK + 3.0 + 16
            while x < LEN - 20:
                depth = rnd.uniform(12, 14)
                length = rnd.choice((24.0, 30.0))
                floors = rnd.choice((4, 5, 9))
                x0, x1 = sorted((sx * x, sx * (x + length)))
                y0, y1 = sorted((sy * bx0, sy * (bx0 + depth)))
                building(M, c, x0, y0, x1, y1, floors, rnd.choice(M["plaster"]), "y-" if sy > 0 else "y+",
                         names[k % len(names)], M["shop"][k % len(M["shop"])])
                k += 1
                x += length + rnd.uniform(8, 14)
            # trees and lamps in the grass strips
            gx = sx * (HALF + CURB + 1.0)
            gy = sy * (HALF + CURB + 1.0)
            t = HALF + CURB + 8.0
            while t < LEN - 4:
                tree(M, trees, gx, sy * t, rnd.uniform(8, 11), hidden)
                tree(M, trees, sx * t, gy, rnd.uniform(8, 11), hidden)
                t += rnd.uniform(9, 12)
            t = HALF + CURB + 12.0
            while t < LEN - 4:
                street_lamp(M, lamps, sx * (HALF + CURB + 0.35), sy * t, math.pi if sx > 0 else 0.0)
                street_lamp(M, lamps, sx * t, sy * (HALF + CURB + 0.35), -math.pi / 2 if sy > 0 else math.pi / 2)
                t += 28
            # bench
            box("skameyka", (sx * (HALF + CURB + 3.8), sy * 20, 0.45), (0.5, 2.0, 0.06), M["bench"], c, 0.01)
            box("skameyka_suyanchiq", (sx * (HALF + CURB + 4.05), sy * 20, 0.75), (0.06, 2.0, 0.4), M["bench"], c, 0.01)
    # traffic lights at the four corners (main street lights face the approaching drivers)
    tl = coll("Svetoforlar", C)
    o = HALF + CURB + 0.6
    traffic_light(M, tl, -o, o, math.pi / 2, 0)      # for cars coming down -y (they drive at x < 0)
    traffic_light(M, tl, o, -o, -math.pi / 2, 0)     # for cars going +y
    traffic_light(M, tl, o, o, 0.0, 1)               # cross street, cars going -x
    traffic_light(M, tl, -o, -o, math.pi, 1)         # cross street, cars going +x
    # pedestrian crossing signs
    for (x, y, f) in ((-o, HALF + 4.5, math.pi / 2), (o, -HALF - 4.5, -math.pi / 2)):
        cyl("belgi_ustun", (x, y, 1.3), 0.035, 2.6, M["steel"], tl, 8)
        s = box("belgi", (x, y, 2.55), (0.6, 0.03, 0.6), M["sign_blue"], tl)
        s.rotation_euler.z = f - math.pi / 2
        bm = bmesh.new()
        vs = [bm.verts.new(v) for v in ((-0.22, 0, -0.18), (0.22, 0, -0.18), (0, 0, 0.2))]
        bm.faces.new(vs)
        tri = obj_from_bm("belgi_uchburchak", bm, M["sign_white"], tl)
        tri.location = (x + math.cos(f) * 0.02, y + math.sin(f) * 0.02, 2.55)
        tri.rotation_euler.z = f - math.pi / 2


# ------------------------------------------------------------------------------------------------ cars

def car_asset(kind, C):
    S, objs, wheels, wheel = cars.build(kind, 0)
    for o in objs:
        cars.compose(o)
    for o in wheels:
        bpy.data.objects.remove(o)
    body = cars.join(objs, f"{kind}_kuzov")
    wob = cars.to_object(f"{kind}_g'ildirak", wheel)
    cars.shade(wob, 40)
    cars.compose(wob)
    wob.data.attributes.remove(wob.data.attributes["base"])
    for o in (body, wob):
        for cl in o.users_collection:
            cl.objects.unlink(o)
        C.objects.link(o)
        o.hide_render = True
        o.hide_set(True)
    return S, body, wob


PAINTS = {}


def paint(rgb_hex):
    if rgb_hex in PAINTS:
        return PAINTS[rgb_hex]
    m = bpy.data.materials["paint"].copy()
    m.name = f"kraska_{rgb_hex.strip('#')}"
    m.node_tree.nodes["tint"].inputs[7].default_value = (*cars.srgb(rgb_hex), 1)
    PAINTS[rgb_hex] = m
    return m


def place(asset, name, color, x, y, heading, C, speed=0.0, start=1, stop=None):
    """heading: direction the nose points, radians in the x-y plane (0 = -y like the asset, pi = +y)."""
    S, body, wob = asset
    root = bpy.data.objects.new(name, None)
    root.empty_display_type = "ARROWS"
    C.objects.link(root)
    b = body.copy()
    C.objects.link(b)
    b.hide_render = False
    b.parent = root
    b.material_slots[0].link = "OBJECT"
    b.material_slots[0].material = paint(color)
    ws = []
    for (wx, wy, wz, mir) in cars.wheel_positions(S):
        w = wob.copy()
        C.objects.link(w)
        w.hide_render = False
        w.parent = root
        w.location = cars.G((wx, wy, wz))
        if mir:
            w.scale = (-1, 1, 1)
        ws.append(w)
    root.location = (x, y, 0.14 * 0 + 0.0)
    root.rotation_euler.z = heading
    if speed > 0:
        prefs = bpy.context.preferences.edit
        prefs.keyframe_new_interpolation_type = "LINEAR"
        end = stop or FRAMES
        d = speed * (end - start) / FPS
        # nose direction in world: the asset's nose is -y, turned by `heading` about z
        fx, fy = math.sin(heading), -math.cos(heading)
        root.keyframe_insert("location", frame=start)
        root.location = (x + fx * d, y + fy * d, 0.0)
        root.keyframe_insert("location", frame=end)
        for w in ws:
            w.rotation_euler.x = 0.0
            w.keyframe_insert("rotation_euler", index=0, frame=start)
            w.rotation_euler.x = d / S["wheel"]["r"]
            w.keyframe_insert("rotation_euler", index=0, frame=end)
    return root


def traffic(C):
    A = coll("Mashina_asl", C)
    A.hide_render = True
    lay = bpy.context.view_layer.layer_collection.children[C.name].children[A.name]
    lay.exclude = False
    assets = {k: car_asset(k, A) for k in ("sedan", "krossover", "sport", "van", "truck")}
    lay.hide_viewport = True
    M = coll("Mashinalar", C)
    # heading 0 -> nose to -y (drives down the street on the x < 0 lanes); pi -> nose to +y (x > 0 lanes)
    player = place(assets["sedan"], "Sedan_oyinchi", "#b0121f", -5.25, 70, 0.0, M, speed=12.5)
    place(assets["krossover"], "Krossover", "#e8e8e6", -1.75, 40, 0.0, M, speed=11.0)
    place(assets["truck"], "Yuk_mashina", "#1d4f91", 1.75, -60, math.pi, M, speed=9.0)
    place(assets["sport"], "Sport", "#f2b705", 5.25, -95, math.pi, M, speed=16.0)
    place(assets["sedan"], "Sedan_2", "#1c1c1e", 5.25, -20, math.pi, M, speed=11.5)
    place(assets["van"], "Furgon", "#f4f4f2", -1.75, -10, 0.0, M, speed=10.0)
    # waiting at the red light on the cross street, then go when it turns green (9 s)
    go = 9 * FPS + 20
    place(assets["krossover"], "Krossover_kutyapti", "#5b6770", HALF + 8.6, 1.75, -math.pi / 2, M, speed=7.0, start=go)
    place(assets["sedan"], "Sedan_kutyapti", "#8a8f94", -(HALF + 8.6), -1.75, math.pi / 2, M, speed=7.0, start=go)
    # parked along the kerbs of the cross street (its outer lanes are the parking lanes)
    parked = [("sedan", "#d9d9d6"), ("krossover", "#22303f"), ("sedan", "#7a1a1a"), ("van", "#ffffff"), ("sedan", "#3b5d3a"), ("sport", "#e85d04"),
              ("krossover", "#9c9c94"), ("sedan", "#c9b38a")]
    x = HALF + 26
    for i, (k, col) in enumerate(parked):
        if i % 2:
            place(assets[k], f"Parkovka_{i}", col, x, HALF - 1.15, -math.pi / 2, M)        # nose -x, right-hand kerb y > 0
        else:
            place(assets[k], f"Parkovka_{i}", col, -x, -(HALF - 1.15), math.pi / 2, M)     # nose +x, kerb y < 0
            x += 7.0 + (2 if k == "van" else 0)
    return player


# ------------------------------------------------------------------------------------------------ light, cameras, render

def sky_and_sun():
    sc = bpy.context.scene
    w = sc.world
    w.use_nodes = True
    nt = w.node_tree
    for n in list(nt.nodes):
        if n.type == "TEX_SKY":
            nt.nodes.remove(n)
    sky = nt.nodes.new("ShaderNodeTexSky")
    try:
        sky.sky_type = "NISHITA"
        sky.sun_elevation = math.radians(38)
        sky.sun_rotation = math.radians(220)
        sky.altitude = 450
        sky.air_density = 1.2
        sky.dust_density = 1.6
    except Exception:
        pass
    nt.links.new(sky.outputs["Color"], nt.nodes["Background"].inputs["Color"])
    nt.nodes["Background"].inputs["Strength"].default_value = 0.35
    sun = bpy.data.lights.new("Quyosh", "SUN")
    sun.energy = 4.0
    sun.angle = math.radians(0.6)
    sun.color = (1.0, 0.95, 0.88)
    so = bpy.data.objects.new("Quyosh", sun)
    so.rotation_euler = (math.radians(90 - 38), 0, math.radians(220 - 90))
    sc.collection.objects.link(so)


def cameras(player):
    sc = bpy.context.scene
    tgt = bpy.data.objects.new("kamera_nishon", None)
    sc.collection.objects.link(tgt)
    tgt.parent = player
    tgt.location = (0, -2.0, 0.8)
    cam = bpy.data.cameras.new("Kuzatuvchi")
    cam.lens = 30
    co = bpy.data.objects.new("Kamera_kuzatuv", cam)
    sc.collection.objects.link(co)
    co.parent = player
    co.location = (2.2, 8.5, 2.4)
    tr = co.constraints.new("TRACK_TO")
    tr.target = tgt
    tr.track_axis = "TRACK_NEGATIVE_Z"
    tr.up_axis = "UP_Y"
    cam2 = bpy.data.cameras.new("Umumiy")
    cam2.lens = 24
    c2 = bpy.data.objects.new("Kamera_umumiy", cam2)
    sc.collection.objects.link(c2)
    c2.location = (-4.5, 26, 6.5)
    t2 = bpy.data.objects.new("umumiy_nishon", None)
    sc.collection.objects.link(t2)
    t2.location = (4, -2, 0.5)
    tr2 = c2.constraints.new("TRACK_TO")
    tr2.target = t2
    tr2.track_axis = "TRACK_NEGATIVE_Z"
    tr2.up_axis = "UP_Y"
    sc.camera = co
    return co, c2


def render_settings():
    sc = bpy.context.scene
    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try:
            sc.render.engine = eng
            break
        except TypeError:
            continue
    e = sc.eevee
    for k, v in (("use_raytracing", True), ("use_shadows", True), ("taa_render_samples", 64), ("use_gtao", True),
                 ("use_bloom", True), ("shadow_ray_count", 2), ("shadow_step_count", 8), ("use_fast_gi", True)):
        if hasattr(e, k):
            try:
                setattr(e, k, v)
            except Exception:
                pass
    sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
    sc.render.fps = FPS
    sc.frame_start, sc.frame_end = 1, FRAMES
    try:
        sc.view_settings.view_transform = "AgX"
        sc.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass
    sc.cycles.samples = 64
    sc.cycles.use_denoising = True


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = "tools/blender/out/kocha.blend"
    render = None
    frame = 60
    cam = "kuzatuv"
    i = 0
    while i < len(argv):
        if argv[i] == "--out":
            out = argv[i + 1]
            i += 1
        elif argv[i] == "--render":
            render = argv[i + 1]
            i += 1
        elif argv[i] == "--frame":
            frame = int(argv[i + 1])
            i += 1
        elif argv[i] == "--cam":
            cam = argv[i + 1]
            i += 1
        i += 1
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.world = bpy.data.worlds.new("Osmon")
    cars.make_materials()
    root = coll("Ko'cha")
    M = make_mats()
    streets(M, root)
    blocks(M, root)
    city(M, root)
    player = traffic(root)
    sky_and_sun()
    co, c2 = cameras(player)
    render_settings()
    sc.frame_set(frame)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(out))
    print("[street] saved", os.path.abspath(out))
    if render:
        sc.camera = co if cam == "kuzatuv" else c2
        sc.render.filepath = os.path.abspath(render)
        bpy.ops.render.render(write_still=True)
        print("[street] rendered", render)


main()
