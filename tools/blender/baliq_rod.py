"""Harakat o'yinlari - Baliq ovi: the first-person spinning rod set and the player's hands, modelled in Blender.

    blender -b --factory-startup --python tools/blender/baliq_rod.py -- --out assets-src/models/baliq-ovi/rod.glb

Exported WITHOUT the y-up conversion: every part is in the ROD FRAME (x = to the right of the rod, y = along the rod
towards the tip, z = up), origin on the rod axis at the reel seat, where the right hand holds it. The game builds that
frame from the rod pose every frame (games/baliq-ovi/rod.ts).

  handle : butt cap, cork rear grip, graphite reel seat with hoods, cork fore grip, winding check (the blank starts at y = 0)
  reel   : spinning reel (foot, body, rotor, bail, spool with line); the crank axis is x, at REEL_AXIS
  crank  : crank arm + knob, origin on the crank axis (turns about x)
  guide  : one line guide (ring + frame) below the blank, origin on the axis (scaled along the blank)
  hand_r : the right hand around the reel seat; its wrist at WRIST_R
  hand_l : the left hand around the crank knob, origin at the knob centre; its wrist at WRIST_L
  sleeve : a jacket sleeve, y 0..1 (scaled to the bone length), shoulder end at y = 0
"""

import argparse
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

REEL_AXIS = (-0.004, 0.0, -0.088)  # crank axis centre (rod frame)
CRANK_R = 0.05
KNOB_X = -0.058  # knob centre, rod frame x (on the left side of the reel)


def mat(name, color, rough=0.6, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m


def textured(name, base, tint, rough=0.7):
    """Principled material with a diffuse (tinted) + normal map, exported into the GLB."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    d = nt.nodes.new("ShaderNodeTexImage")
    d.image = bpy.data.images.load(os.path.abspath(base + "_diff.jpg"))
    d.image.scale(512, 512)
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    mix.inputs["B"].default_value = (*tint, 1)
    nt.links.new(d.outputs["Color"], mix.inputs["A"])
    nt.links.new(mix.outputs["Result"], b.inputs["Base Color"])
    nm = nt.nodes.new("ShaderNodeTexImage")
    nm.image = bpy.data.images.load(os.path.abspath(base + "_nor_gl.jpg"))
    nm.image.colorspace_settings.name = "Non-Color"
    nm.image.scale(512, 512)
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(nm.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], b.inputs["Normal"])
    b.inputs["Roughness"].default_value = rough
    return m


def obj_from_bm(bm, name, material):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    for p in me.polygons:
        p.use_smooth = True
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def tube(name, material, r0, r1, y0, y1, seg=24, x=0.0, z=0.0, axis="Y"):
    """Truncated cone along +y (or +x) from y0 to y1."""
    bm = bmesh.new()
    depth = y1 - y0
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r0, radius2=r1, depth=depth)
    # cone axis z, centred: move to z 0..depth, then z -> y
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, depth / 2 + y0))
    if axis == "Y":
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(-math.pi / 2, 3, "X"))
    else:
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "Y"))
    bmesh.ops.translate(bm, verts=bm.verts, vec=(x, 0, z) if axis == "Y" else (0, x, z))
    return obj_from_bm(bm, name, material)


def box(name, material, size, loc, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    bmesh.ops.translate(bm, vec=loc, verts=bm.verts)
    o = obj_from_bm(bm, name, material)
    if bevel:
        m = o.modifiers.new("bev", "BEVEL")
        m.width = bevel
        m.segments = 3
    return o


def sphere(name, material, r, loc, scale=(1, 1, 1), seg=16):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=max(6, seg // 2), radius=r)
    bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    bmesh.ops.translate(bm, vec=loc, verts=bm.verts)
    return obj_from_bm(bm, name, material)


def capsule(name, material, a, b, r0, r1=None):
    """Capsule from a to b (radii r0 at a, r1 at b)."""
    r1 = r0 if r1 is None else r1
    a = Vector(a)
    b = Vector(b)
    d = b - a
    L = d.length
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=12, radius1=r0, radius2=r1, depth=L)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, L / 2))
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=q.to_matrix())
    bmesh.ops.translate(bm, verts=bm.verts, vec=a)
    for c, r in ((a, r0), (b, r1)):
        s = bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=r)
        bmesh.ops.translate(bm, verts=s["verts"], vec=c)
    return obj_from_bm(bm, name, material)


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
        for m in list(o.modifiers):
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    return o


def organic(o, voxel, target_tris, smooth_iter=6):
    """Voxel remesh the overlapping primitives into one skin, smooth it, decimate."""
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    m = o.modifiers.new("rm", "REMESH")
    m.mode = "VOXEL"
    m.voxel_size = voxel
    bpy.ops.object.modifier_apply(modifier="rm")
    s = o.modifiers.new("sm", "SMOOTH")
    s.factor = 0.6
    s.iterations = smooth_iter
    bpy.ops.object.modifier_apply(modifier="sm")
    n = sum(len(p.vertices) - 2 for p in o.data.polygons)
    if n > target_tris:
        d = o.modifiers.new("dec", "DECIMATE")
        d.ratio = target_tris / n
        bpy.ops.object.modifier_apply(modifier="dec")
    for p in o.data.polygons:
        p.use_smooth = True


# ---------------------------------------------------------------- hands

def grip_hand(name, skin, r_obj, spread=1.0):
    """A right hand closed around a cylinder of radius r_obj along +y (back of the hand on the top-right).
    Returns (object, wrist point)."""
    parts = []
    # angle around the axis: 90 deg = top, 0 = right, 180 = left
    def at(phi_deg, rad, y):
        p = math.radians(phi_deg)
        return Vector((math.cos(p) * rad, y, math.sin(p) * rad))

    fingers = [  # y of the finger, radius, phalanx lengths
        (0.029 * spread, 0.0079, (0.043, 0.026, 0.021)),
        (0.0095 * spread, 0.0083, (0.047, 0.029, 0.023)),
        (-0.0105 * spread, 0.0079, (0.044, 0.027, 0.022)),
        (-0.0285 * spread, 0.0069, (0.035, 0.022, 0.019)),
    ]
    wrist = at(38, r_obj + 0.034, -0.072)
    for fy, fr, lens in fingers:
        R = r_obj + fr
        phi = 108.0
        prev = at(phi, R + 0.003, fy)
        knuckle = prev
        for k, L in enumerate(lens):
            phi += math.degrees(L / R) * (0.92 if k == 0 else 1.0)
            cur = at(phi, R, fy - 0.002 * k)
            # phalanges are slimmer in the middle than at the joints; the joints bulge (knuckles)
            mid = (prev + cur) / 2
            r0 = fr * (1.0 - 0.08 * k)
            parts.append(capsule(f"{name}_f", skin, prev, mid, r0, r0 * 0.86))
            parts.append(capsule(f"{name}_f", skin, mid, cur, r0 * 0.86, r0 * 0.95))
            parts.append(sphere(f"{name}_j", skin, r0 * (1.12 if k == 0 else 1.02), tuple(prev), seg=12))
            prev = cur
        # finger tip: rounder pad
        parts.append(sphere(f"{name}_tip", skin, fr * 0.8, tuple(prev), scale=(1, 1.15, 1), seg=12))
        # metacarpal: wrist -> knuckle (the back of the hand)
        base = wrist + Vector((0, fy * 0.45 + 0.012, 0))
        parts.append(capsule(f"{name}_m", skin, base, knuckle, 0.0105, fr + 0.0015))
    # palm filling under the metacarpals
    parts.append(sphere(f"{name}_p", skin, 0.03, (wrist + at(95, r_obj + 0.02, -0.005)) / 2 + Vector((0.004, 0.004, 0.0)), scale=(0.62, 1.2, 0.45)))
    # thumb lies along the right / top of the grip, pointing forwards
    t0 = wrist + Vector((-0.008, 0.012, -0.012))
    t1 = at(22, r_obj + 0.011, -0.012)
    t2 = at(55, r_obj + 0.009, 0.022)
    t3 = at(75, r_obj + 0.008, 0.046)
    parts.append(capsule(f"{name}_t", skin, t0, t1, 0.0125, 0.0095))
    parts.append(capsule(f"{name}_t", skin, t1, t2, 0.0095, 0.0085))
    parts.append(sphere(f"{name}_tj", skin, 0.0098, tuple(t1), seg=12))
    parts.append(capsule(f"{name}_t", skin, t2, t3, 0.0085, 0.0078))
    parts.append(sphere(f"{name}_tt", skin, 0.0075, tuple(t3), scale=(1, 1.2, 1), seg=12))
    # wrist stub (inside the cuff)
    parts.append(capsule(f"{name}_w", skin, wrist + Vector((0, 0.01, 0)), wrist + Vector((0.018, -0.045, -0.012)), 0.0205, 0.022))
    o = join(parts, name)
    organic(o, 0.0011, 7000, smooth_iter=2)
    # the glove's leather needs UVs (the remesh dropped them)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.01, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    # uv scale: ~4 cm of leather per texture tile
    for l in o.data.uv_layers.active.data:
        l.uv = l.uv * 2.5
    # cuff of the glove around the wrist
    cuff = capsule(f"{name}_cuff", skin, wrist + Vector((0.006, -0.012, -0.004)), wrist + Vector((0.02, -0.05, -0.013)), 0.0235, 0.025)
    for p in cuff.data.polygons:
        p.use_smooth = True
    return o, wrist, cuff


def build(out):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    cork = mat("cork", (0.52, 0.38, 0.22), rough=0.85)
    rubber = mat("rubber", (0.03, 0.03, 0.035), rough=0.7)
    graphite = mat("graphite", (0.05, 0.06, 0.08), rough=0.35, metal=0.4)
    alu = mat("alu", (0.55, 0.57, 0.6), rough=0.28, metal=1.0)
    gold = mat("gold", (0.75, 0.55, 0.22), rough=0.3, metal=1.0)
    body_m = mat("reel_body", (0.08, 0.09, 0.1), rough=0.35, metal=0.6)
    line_m = mat("line", (0.85, 0.88, 0.8), rough=0.5)
    knob_m = mat("knob", (0.06, 0.06, 0.06), rough=0.55)
    ring_m = mat("ring", (0.15, 0.15, 0.16), rough=0.15, metal=0.9)
    skin = textured("glove", "assets-src/textures/baliq-ovi/rod/fabric_leather_02", (0.42, 0.36, 0.32), rough=0.62)
    cuff_m = mat("cuff", (0.05, 0.05, 0.055), rough=0.8)
    cloth = textured("sleeve", "assets-src/textures/baliq-ovi/rod/denim_fabric", (1, 1, 1), rough=0.92)

    # ---- handle (y < 0 behind the seat, blank starts at the fore grip's end)
    h = []
    h.append(tube("butt", rubber, 0.0175, 0.0185, -0.47, -0.445, 28))
    h.append(sphere("buttcap", rubber, 0.0178, (0, -0.47, 0), scale=(1, 0.5, 1), seg=24))
    # rear grip: cork rings (slightly different shades come from the light; tiny steps between rings)
    y = -0.445
    while y < -0.085:
        y1 = min(-0.085, y + 0.012)
        t = (y + 0.445) / 0.36
        r = 0.0165 + 0.0025 * math.sin(math.pi * min(1, t * 1.15))
        h.append(tube("cork", cork, r, r - 0.0002, y, y1 - 0.0004, 28))
        h.append(tube("corkj", cork, r - 0.0006, r - 0.0006, y1 - 0.0004, y1, 28))
        y = y1
    h.append(tube("hood_r", alu, 0.0158, 0.0152, -0.085, -0.06, 28))
    h.append(tube("seat", graphite, 0.0135, 0.0135, -0.06, 0.04, 28))
    h.append(tube("hood_f", alu, 0.0152, 0.0158, 0.04, 0.062, 28))
    h.append(tube("nut", gold, 0.0162, 0.0162, 0.062, 0.072, 28))
    h.append(tube("fore", cork, 0.0155, 0.0128, 0.072, 0.16, 28))
    h.append(tube("check", alu, 0.0118, 0.0105, 0.16, 0.168, 24))
    handle = join(h, "handle")

    # ---- reel (hangs below the seat)
    r = []
    r.append(box("foot", alu, (0.007, 0.075, 0.004), (0, 0, -0.0155), bevel=0.0015))
    r.append(box("stem", body_m, (0.008, 0.02, 0.05), (0, -0.004, -0.045), bevel=0.003))
    ax = Vector(REEL_AXIS)
    r.append(sphere("gearbox", body_m, 0.034, ax + Vector((0, -0.006, 0)), scale=(0.62, 0.95, 0.9), seg=28))
    r.append(tube("crankcap", alu, 0.012, 0.012, ax.x + 0.02, ax.x + 0.027, 24, x=ax.y, z=ax.z, axis="X"))
    # rotor + spool along +y in front of the gearbox
    r.append(tube("rotor", body_m, 0.024, 0.031, ax.y + 0.026, ax.y + 0.05, 32, z=ax.z))
    r.append(tube("skirt", alu, 0.03, 0.03, ax.y + 0.05, ax.y + 0.056, 32, z=ax.z))
    r.append(tube("spool", alu, 0.0255, 0.0255, ax.y + 0.056, ax.y + 0.084, 32, z=ax.z))
    r.append(tube("lineon", line_m, 0.0262, 0.0258, ax.y + 0.058, ax.y + 0.081, 32, z=ax.z))
    r.append(tube("spoolcap", alu, 0.0245, 0.016, ax.y + 0.084, ax.y + 0.09, 32, z=ax.z))
    # bail arm: a wire over the spool, two arms on the rotor
    for sx in (-1, 1):
        r.append(capsule("bailarm", alu, ax + Vector((sx * 0.029, 0.045, 0)), ax + Vector((sx * 0.031, 0.07, 0.006)), 0.0022))
    pts = [ax + Vector((math.cos(a) * 0.031, 0.071 + 0.004 * math.sin(a), math.sin(a) * 0.031)) for a in [math.pi * k / 10 for k in range(11)]]
    for a, b in zip(pts, pts[1:]):
        r.append(capsule("bail", alu, a, b, 0.0013))
    reel = join(r, "reel")

    # ---- crank (origin on the axis, arm along +z, knob outward along -x)
    c = []
    c.append(capsule("crankarm", alu, (-0.03, 0, 0), (-0.034, 0, CRANK_R), 0.0035, 0.003))
    c.append(tube("knobstem", alu, 0.0035, 0.0035, -0.045, -0.034, 12, x=0, z=CRANK_R, axis="X"))
    c.append(tube("knob", knob_m, 0.0085, 0.0095, KNOB_X - 0.015 - 0.0, -0.043, 24, x=0, z=CRANK_R, axis="X"))
    c.append(sphere("knobend", knob_m, 0.0094, (KNOB_X - 0.015, 0, CRANK_R), scale=(0.4, 1, 1)))
    crank = join(c, "crank")

    # ---- guide (ring below the blank)
    g = []
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, segments=20, radius=0.008)
    bm.free()
    ring_pts = [Vector((math.cos(a) * 0.0085, 0, -0.022 + math.sin(a) * 0.0085)) for a in [math.tau * k / 16 for k in range(17)]]
    for a, b in zip(ring_pts, ring_pts[1:]):
        g.append(capsule("ring", ring_m, a, b, 0.0016))
    for sx in (-1, 1):
        g.append(capsule("leg", alu, (sx * 0.002, -0.012, -0.002), (sx * 0.006, 0, -0.0135), 0.0011))
    g.append(capsule("foot", alu, (0, -0.016, -0.0015), (0, 0.004, -0.0015), 0.0016))
    guide = join(g, "guide")
    d = guide.modifiers.new("dec", "DECIMATE")
    d.ratio = 0.1
    bpy.context.view_layer.objects.active = guide
    bpy.ops.object.modifier_apply(modifier="dec")

    # ---- hands
    hand_r, wrist_r, cuff_r = grip_hand("hand_r", skin, 0.0145)
    cuff_r.data.materials[0] = cuff_m
    hand_r = join([hand_r, cuff_r], "hand_r")
    # the left hand: a right hand mirrored (x), closed around the knob (radius 0.0095, axis turned from y onto x),
    # turned about the knob so that the wrist comes from behind, then moved onto the knob centre
    hand_l, wrist_l, cuff_l = grip_hand("hand_l", skin, 0.0095, spread=0.8)
    cuff_l.data.materials[0] = cuff_m
    hand_l = join([hand_l, cuff_l], "hand_l")
    M = Matrix.Translation((KNOB_X - 0.012, 0, 0)) @ Matrix.Rotation(math.radians(70), 4, "X") @ Matrix.Rotation(-math.pi / 2, 4, "Z") @ Matrix.Scale(-1, 4, (1, 0, 0))
    hand_l.data.transform(M)
    hand_l.data.flip_normals()
    wrist_l = M @ wrist_l
    # the left hand's origin: the knob centre (KNOB_X, 0, 0) -> the game puts it where the crank's knob is
    hand_l.data.transform(Matrix.Translation((-KNOB_X, 0, 0)))
    wrist_l = wrist_l - Vector((KNOB_X, 0, 0))

    # ---- sleeve: y 0..1, folds near the wrist, a cuff
    bm = bmesh.new()
    rnd = random.Random(4)
    rings = 26
    seg = 20
    vs = []
    for i in range(rings + 1):
        t = i / rings
        row = []
        for j in range(seg):
            a = math.tau * j / seg
            rad = 0.058 - 0.012 * t + 0.004 * math.sin(t * 31 + a * 2) * t * t + rnd.uniform(-0.0012, 0.0012)
            if t > 0.93:
                rad += 0.004
            row.append(bm.verts.new((math.cos(a) * rad, t, math.sin(a) * rad * 0.9)))
        vs.append(row)
    uvl = bm.loops.layers.uv.new("UVMap")
    for i in range(rings):
        for j in range(seg):
            f = bm.faces.new((vs[i][j], vs[i][(j + 1) % seg], vs[i + 1][(j + 1) % seg], vs[i + 1][j]))
            # around: 3 tiles, along: 8 tiles (the sleeve is scaled to ~0.3 m in the game)
            for loop, (u, v) in zip(f.loops, ((j, i), (j + 1, i), (j + 1, i + 1), (j, i + 1))):
                loop[uvl].uv = (u / seg * 3, v / rings * 8)
    bm.faces.new(list(reversed(vs[rings])))
    sleeve = obj_from_bm(bm, "sleeve", cloth)

    for o in bpy.context.scene.objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_yup=False, export_apply=True,
                              export_cameras=False, export_lights=False)
    tri = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.context.scene.objects if o.type == "MESH"}
    print("[baliq_rod]", tri)
    print("[baliq_rod] WRIST_R", tuple(round(v, 4) for v in wrist_r), "WRIST_L", tuple(round(v, 4) for v in wrist_l))


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="assets-src/models/baliq-ovi/rod.glb")
    a = ap.parse_args(argv)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    build(os.path.abspath(a.out))


main()
