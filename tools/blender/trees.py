"""Harakat o'yinlari - realistic trees for the city (Lombardy poplar "terak", plane tree "chinor"), built in Blender.

    blender -b --factory-startup --python tools/blender/trees.py -- [--out public/models/poyga/trees] [--tex public/textures/poyga/trees] [--preview DIR]

1. Leaf-cluster textures are RENDERED from real little twigs with modelled leaves (orthographic, transparent background),
   bark textures from a procedural bark material: so the game's leaf cards show real leaf shapes, light and colour.
2. A tree = tapered trunk + a branch skeleton (fastigiate for the poplar, spreading for the plane tree) as tubes with UVs,
   foliage = many alpha leaf cards along the outer branches (a few thousand triangles per tree).
3. Exported as GLB (materials "bark" and "leaves", textures embedded); optional preview renders (Cycles, sky + sun).
"""

import argparse
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ARGS = None


# ------------------------------------------------------------------------------------------------ helpers

def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.world = bpy.data.worlds.new("World")
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    return sc


def link(ob, coll=None):
    (coll or bpy.context.scene.collection).objects.link(ob)
    return ob


def mesh_object(name, verts, faces, uvs=None, mat=None, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    if uvs is not None:
        uvl = me.uv_layers.new(name="UVMap")
        for poly in me.polygons:
            for li, vi in zip(poly.loop_indices, poly.vertices):
                uvl.data[li].uv = uvs[vi]
    if mat:
        me.materials.append(mat)
    me.polygons.foreach_set("use_smooth", [smooth] * len(me.polygons))
    ob = bpy.data.objects.new(name, me)
    return link(ob)


def lerp(a, b, t):
    return a + (b - a) * t


# ------------------------------------------------------------------------------------------------ textures (rendered)

def leaf_shape(kind):
    """2D outline of one leaf (x across, y along, tip at y = 1)."""
    pts = []
    n = 24
    for k in range(n + 1):
        t = k / n
        if kind == "terak":
            # poplar: broad triangular-rhombic blade with a fine point
            w = 0.62 * math.sin(math.pi * min(1, t * 1.05)) ** 0.75 * (1 - 0.55 * t) + 0.02
        else:
            # plane tree: wide palmate (5 lobes) approximated by a lobed outline
            w = 0.95 * math.sin(math.pi * t) ** 0.55 * (0.75 + 0.25 * abs(math.cos(t * math.pi * 2.5)))
        pts.append((w, t))
    right = pts
    left = [(-x, y) for (x, y) in reversed(pts[1:-1])]
    return right + left


def render_leaf_texture(kind, path, size=512, seed=1):
    """A twig with many leaves, seen from above, rendered to an RGBA PNG (the leaf-card texture)."""
    sc = clear()
    rnd = random.Random(seed)
    mat = bpy.data.materials.new("leaf")
    mat.use_nodes = True
    nt = mat.node_tree
    b = nt.nodes["Principled BSDF"]
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "col"
    attr.attribute_type = "GEOMETRY"
    nt.links.new(attr.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.7
    b.inputs["Specular IOR Level"].default_value = 0.25
    # veins: a darker midrib through a gradient along the leaf
    outline = leaf_shape(kind)
    verts, faces, cols = [], [], []
    stems = []
    base_col = (0.045, 0.17, 0.018) if kind == "terak" else (0.06, 0.19, 0.022)
    # a spray: several twigs radiating from the middle, each carrying leaves, plus loose leaves filling the gaps,
    # so a card is mostly covered and reads as a clump of foliage from any side
    ntw = 7 if kind == "terak" else 6
    leaves_per = 16 if kind == "terak" else 8
    lsize = 0.17 if kind == "terak" else 0.32

    def leaf(p, ang, s, tilt, i):
        rot = Matrix.Rotation(ang, 4, "Z") @ Matrix.Rotation(tilt, 4, "Y")
        petiole = 0.25 * s
        base = len(verts)
        c = tuple(min(1, max(0, x * rnd.uniform(0.7, 1.35))) for x in base_col)
        cent = rot @ Vector((0, petiole + 0.5 * s, 0)) + p
        verts.append((cent.x, cent.y, cent.z + 0.0015 * i))
        cols.append(tuple(x * 1.08 for x in c))
        for (x, y) in outline:
            v = rot @ Vector((x * s * 0.5, petiole + y * s, 0.1 * s * x * x)) + p
            verts.append((v.x, v.y, v.z + 0.0015 * i))
            k = 0.82 + 0.28 * (1 - abs(x) / 0.9)
            cols.append(tuple(min(1, cc * k) for cc in c))
        m = len(outline)
        for k in range(m):
            faces.append((base, base + 1 + k, base + 1 + (k + 1) % m))

    outline = leaf_shape(kind)
    n = 0
    for t_i in range(ntw):
        az = math.tau * t_i / ntw + rnd.uniform(-0.25, 0.25)
        L = rnd.uniform(0.6, 0.9)
        pts = [Vector((math.cos(az) * L * k / 8 + 0.04 * math.sin(k), math.sin(az) * L * k / 8 + 0.04 * math.cos(k * 1.3), 0)) for k in range(9)]
        stems.append(pts)
        for i in range(leaves_per):
            t = 0.12 + 0.88 * (i + 0.5) / leaves_per
            p = pts[0].lerp(pts[-1], t)
            side = 1 if i % 2 else -1
            ang = az - math.pi / 2 + side * rnd.uniform(0.5, 1.2)
            leaf(p, ang, lsize * rnd.uniform(0.75, 1.2) * (1.15 - 0.4 * t), rnd.uniform(-0.6, 0.6), n)
            n += 1
    for i in range(int(leaves_per * ntw * 0.45)):
        r = math.sqrt(rnd.random()) * 0.75
        a2 = rnd.uniform(0, math.tau)
        leaf(Vector((math.cos(a2) * r, math.sin(a2) * r, 0)), rnd.uniform(0, math.tau), lsize * rnd.uniform(0.7, 1.1), rnd.uniform(-0.7, 0.7), n)
        n += 1
    stem_pts = stems[0]
    ob = mesh_object("twig", verts, faces, mat=mat, smooth=False)
    ca = ob.data.color_attributes.new("col", "FLOAT_COLOR", "POINT")
    flat = []
    for c in cols:
        flat += [c[0], c[1], c[2], 1]
    ca.data.foreach_set("color", flat)
    # the twig itself
    tw = bpy.data.curves.new("stem", "CURVE")
    tw.dimensions = "3D"
    for pts in stems:
        sp = tw.splines.new("POLY")
        sp.points.add(len(pts) - 1)
        for k, q in enumerate(pts):
            sp.points[k].co = (q.x, q.y, q.z - 0.01, 1)
    tw.bevel_depth = 0.01
    sm = bpy.data.materials.new("stem")
    sm.diffuse_color = (0.2, 0.15, 0.08, 1)
    sm.use_nodes = True
    sm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.18, 0.14, 0.07, 1)
    tw.materials.append(sm)
    link(bpy.data.objects.new("stem", tw))
    # light + orthographic camera from above, transparent film
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 3.5
    so = link(bpy.data.objects.new("sun", sun))
    so.rotation_euler = (math.radians(25), math.radians(-15), 0)
    sc.world.use_nodes = True
    sc.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.62, 0.7, 1)
    sc.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
    cam = bpy.data.cameras.new("cam")
    cam.type = "ORTHO"
    cam.ortho_scale = 2.0
    co = link(bpy.data.objects.new("cam", cam))
    co.location = (0, 0, 5)
    sc.camera = co
    sc.render.film_transparent = True
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.cycles.samples = 48
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def render_bark_texture(kind, path, size=512):
    """Procedural bark (poplar: grey-brown furrows; plane tree: mottled camouflage patches) rendered flat."""
    sc = clear()
    mat = bpy.data.materials.new("bark")
    mat.use_nodes = True
    nt = mat.node_tree
    N, L = nt.nodes, nt.links
    b = N["Principled BSDF"]
    tc = N.new("ShaderNodeTexCoord")
    mp = N.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1.0, 4.0, 1.0) if kind == "terak" else (1.4, 1.4, 1.0)
    L.new(tc.outputs["Generated"], mp.inputs["Vector"])
    ramp = N.new("ShaderNodeValToRGB")
    if kind == "terak":
        wave = N.new("ShaderNodeTexWave")
        wave.wave_type = "BANDS"
        wave.bands_direction = "X"
        wave.inputs["Scale"].default_value = 6
        wave.inputs["Distortion"].default_value = 9
        wave.inputs["Detail"].default_value = 6
        L.new(mp.outputs["Vector"], wave.inputs["Vector"])
        L.new(wave.outputs["Fac"], ramp.inputs["Fac"])
        ramp.color_ramp.elements[0].color = (0.07, 0.06, 0.05, 1)
        ramp.color_ramp.elements[1].color = (0.42, 0.4, 0.36, 1)
    else:
        vor = N.new("ShaderNodeTexVoronoi")
        vor.inputs["Scale"].default_value = 5
        L.new(mp.outputs["Vector"], vor.inputs["Vector"])
        nz = N.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = 3
        L.new(mp.outputs["Vector"], nz.inputs["Vector"])
        mix = N.new("ShaderNodeMath")
        mix.operation = "ADD"
        L.new(vor.outputs["Distance"], mix.inputs[0])
        L.new(nz.outputs["Fac"], mix.inputs[1])
        L.new(mix.outputs[0], ramp.inputs["Fac"])
        ramp.color_ramp.elements[0].color = (0.62, 0.6, 0.48, 1)
        ramp.color_ramp.elements[1].color = (0.33, 0.3, 0.22, 1)
        e = ramp.color_ramp.elements.new(0.55)
        e.color = (0.78, 0.76, 0.66, 1)
    L.new(ramp.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.9
    bpy.ops.mesh.primitive_plane_add(size=2)
    pl = bpy.context.active_object
    pl.data.materials.append(mat)
    sc.world.use_nodes = True
    sc.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 2.5
    link(bpy.data.objects.new("sun", sun))
    cam = bpy.data.cameras.new("cam")
    cam.type = "ORTHO"
    cam.ortho_scale = 2.0
    co = link(bpy.data.objects.new("cam", cam))
    co.location = (0, 0, 4)
    sc.camera = co
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.cycles.samples = 16
    sc.view_settings.view_transform = "Standard"
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


# ------------------------------------------------------------------------------------------------ tree geometry

class Builder:
    def __init__(self):
        self.bv, self.bf, self.buv = [], [], []
        self.lv, self.lf, self.luv = [], [], []

    def tube(self, pts, radii, sides=6, uscale=1.0):
        """Tapered tube along points; UV u around (0..1), v along (metres / circumference-ish)."""
        base = len(self.bv)
        rings = []
        v_acc = 0.0
        prev = None
        for i, (p, r) in enumerate(zip(pts, radii)):
            d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            a = d.orthogonal().normalized()
            bvec = d.cross(a).normalized()
            if prev is not None:
                v_acc += (p - prev).length / max(0.3, 2 * math.pi * r) * 0.5 * uscale
            prev = p
            ring = []
            for k in range(sides + 1):
                ang = 2 * math.pi * k / sides
                q = p + (a * math.cos(ang) + bvec * math.sin(ang)) * r
                self.bv.append(tuple(q))
                self.buv.append((k / sides, v_acc))
                ring.append(len(self.bv) - 1)
            rings.append(ring)
        for i in range(len(rings) - 1):
            for k in range(sides):
                self.bf.append((rings[i][k], rings[i][k + 1], rings[i + 1][k + 1], rings[i + 1][k]))
        return base

    def card(self, c, size, rnd, up_bias=0.3, normal=None):
        """One leaf-cluster card: a quad at c, random orientation (slightly facing outwards / up)."""
        axis = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))).normalized()
        if normal is not None:
            axis = (axis + normal * 0.9 + Vector((0, 0, up_bias))).normalized()
        t = axis.orthogonal().normalized()
        b = axis.cross(t).normalized()
        rot = rnd.uniform(0, math.tau)
        t, b = t * math.cos(rot) + b * math.sin(rot), -t * math.sin(rot) + b * math.cos(rot)
        h = size / 2
        base = len(self.lv)
        for (x, y, u, v) in ((-1, -1, 0, 0), (1, -1, 1, 0), (1, 1, 1, 1), (-1, 1, 0, 1)):
            q = c + t * (x * h) + b * (y * h)
            self.lv.append(tuple(q))
            self.luv.append((u, v))
        self.lf.append((base, base + 1, base + 2, base + 3))


def bend(p0, d, length, n, curve, rnd, droop=0.0):
    """Points of a gently curved branch from p0 along d."""
    pts = [p0.copy()]
    dirv = d.normalized()
    side = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), 0)).normalized() * curve
    for i in range(1, n + 1):
        t = i / n
        dirv = (dirv + side * (1 / n) + Vector((0, 0, -droop / n))).normalized()
        pts.append(pts[-1] + dirv * (length / n))
    return pts


def tree_terak(seed=1):
    """Lombardy poplar (terak): 20-25 m and slim (crown ~4 m wide: about 1 : 5), the branches nearly vertical,
    hugging the trunk, the foliage dense from ~3 m up to a narrow pointed top."""
    rnd = random.Random(seed)
    B = Builder()
    H = rnd.uniform(20, 25)
    lean = Vector((rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), 0))
    trunk = [lean * (t * t) + Vector((0, 0, H * t)) for t in [i / 16 for i in range(17)]]
    radii = [lerp(0.34, 0.04, (i / 16) ** 0.75) for i in range(17)]
    B.tube(trunk, radii, sides=9, uscale=1.0)
    B.tube([Vector((0, 0, -0.1)), Vector((0, 0, 0.5))], [0.5, 0.34], sides=9)

    def at(t):
        k = min(int(t * 16), 15)
        return trunk[k].lerp(trunk[k + 1], t * 16 - k)

    def env(t):
        # widest at ~35 % of the height, a long taper to a narrow spire
        if t < 0.12:
            return 0.0
        u = (t - 0.12) / 0.88
        return math.sin(math.pi * min(1.0, u * 0.62 + 0.12)) ** 0.9 * (1 - 0.65 * u ** 2)

    nb = 120
    for i in range(nb):
        t = 0.12 + 0.86 * (i / nb) + rnd.uniform(-0.005, 0.005)
        p = at(t)
        e = env(t)
        L = (0.8 + 2.4 * e) * rnd.uniform(0.75, 1.15)
        az = rnd.uniform(0, math.tau)
        up = math.radians(rnd.uniform(74, 84))
        d = Vector((math.cos(az) * math.cos(up), math.sin(az) * math.cos(up), math.sin(up)))
        pts = bend(p, d, L, 3, 0.12, rnd)
        r0 = lerp(0.05, 0.015, t)
        B.tube(pts, [lerp(r0, 0.006, j / (len(pts) - 1)) for j in range(len(pts))], sides=4)
        out = Vector((math.cos(az), math.sin(az), 0))
        for c in range(int(5 + 9 * e)):
            u = rnd.uniform(0.2, 1.0)
            q = pts[int(u * (len(pts) - 1))] + Vector((rnd.uniform(-0.2, 0.2), rnd.uniform(-0.2, 0.2), rnd.uniform(-0.5, 0.5)))
            B.card(q, rnd.uniform(0.7, 1.05), rnd, 0.8, out * 0.6)
    # a dense core: the column of leaves around the trunk
    for c in range(520):
        t = rnd.uniform(0.13, 0.995)
        p = at(t)
        e = env(t)
        az = rnd.uniform(0, math.tau)
        rr = rnd.uniform(0.1, 1.0) ** 0.7 * (0.35 + 1.75 * e)
        q = p + Vector((math.cos(az) * rr, math.sin(az) * rr, rnd.uniform(-0.4, 0.4)))
        B.card(q, rnd.uniform(0.75, 1.15), rnd, 0.9, Vector((math.cos(az), math.sin(az), 0)) * 0.5)
    return B, H


def tree_chinor(seed=1):
    """Plane tree: thick trunk, mottled bark, 3-5 big limbs spreading out, a broad rounded crown (12-16 m)."""
    rnd = random.Random(seed)
    B = Builder()
    H = rnd.uniform(12, 16)
    th = H * rnd.uniform(0.28, 0.36)
    trunk = [Vector((0.05 * math.sin(t * 3), 0.04 * math.cos(t * 2), th * t)) for t in [i / 6 for i in range(7)]]
    B.tube(trunk, [lerp(0.48, 0.34, i / 6) for i in range(7)], sides=11)
    B.tube([Vector((0, 0, -0.1)), Vector((0, 0, 0.7))], [0.7, 0.48], sides=11)
    top = trunk[-1]
    crownR = H * rnd.uniform(0.42, 0.5)
    nl = rnd.randint(4, 5)
    for i in range(nl):
        az = math.tau * i / nl + rnd.uniform(-0.3, 0.3)
        up = math.radians(rnd.uniform(40, 60))
        d = Vector((math.cos(az) * math.cos(up), math.sin(az) * math.cos(up), math.sin(up)))
        L = (H - th) * rnd.uniform(0.7, 0.9)
        limb = bend(top, d, L, 6, 0.35, rnd)
        B.tube(limb, [lerp(0.26, 0.05, j / (len(limb) - 1)) for j in range(len(limb))], sides=8)
        # secondary branches off the limb
        for j in range(2, len(limb) - 1):
            for q in range(2):
                az2 = az + rnd.uniform(-1.4, 1.4)
                up2 = math.radians(rnd.uniform(10, 50))
                d2 = Vector((math.cos(az2) * math.cos(up2), math.sin(az2) * math.cos(up2), math.sin(up2)))
                L2 = rnd.uniform(1.6, 3.4) * (1.1 - j / len(limb) * 0.4)
                br = bend(limb[j], d2, L2, 4, 0.4, rnd, droop=0.25)
                B.tube(br, [lerp(0.07, 0.01, k / (len(br) - 1)) for k in range(len(br))], sides=5)
                for c in range(9):
                    u = rnd.uniform(0.3, 1.0)
                    p = br[int(u * (len(br) - 1))] + Vector((rnd.uniform(-0.6, 0.6), rnd.uniform(-0.6, 0.6), rnd.uniform(-0.4, 0.5)))
                    B.card(p, rnd.uniform(1.3, 2.0), rnd, 0.6, d2)
    # crown fill: cards on a rounded hull (ellipsoid) so the silhouette is full and round
    centre = top + Vector((0, 0, (H - th) * 0.5))
    for c in range(420):
        v = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1), rnd.gauss(0, 0.8))).normalized()
        rr = rnd.uniform(0.55, 1.0)
        p = centre + Vector((v.x * crownR * rr, v.y * crownR * rr, v.z * (H - th) * 0.48 * rr))
        B.card(p, rnd.uniform(1.4, 2.2), rnd, 0.5, v)
    return B, H


# ------------------------------------------------------------------------------------------------ materials / export

def tree_materials(kind, texdir):
    bark = bpy.data.materials.new("bark")
    bark.use_nodes = True
    nt = bark.node_tree
    img = bpy.data.images.load(os.path.join(texdir, f"bark_{kind}.png"))
    tn = nt.nodes.new("ShaderNodeTexImage")
    tn.image = img
    dark = nt.nodes.new("ShaderNodeMix")
    dark.data_type = "RGBA"
    dark.blend_type = "MULTIPLY"
    dark.inputs[0].default_value = 1.0
    dark.inputs[7].default_value = (0.55, 0.52, 0.48, 1)
    nt.links.new(tn.outputs["Color"], dark.inputs[6])
    nt.links.new(dark.outputs[2], nt.nodes["Principled BSDF"].inputs["Base Color"])
    nt.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.92
    leaves = bpy.data.materials.new("leaves")
    leaves.use_nodes = True
    nt = leaves.node_tree
    img2 = bpy.data.images.load(os.path.join(texdir, f"leaf_{kind}.png"))
    tl = nt.nodes.new("ShaderNodeTexImage")
    tl.image = img2
    b = nt.nodes["Principled BSDF"]
    nt.links.new(tl.outputs["Color"], b.inputs["Base Color"])
    nt.links.new(tl.outputs["Alpha"], b.inputs["Alpha"])
    b.inputs["Roughness"].default_value = 0.78
    b.inputs["Specular IOR Level"].default_value = 0.18
    try:
        leaves.surface_render_method = "DITHERED"
    except Exception:
        pass
    try:
        leaves.blend_method = "CLIP"
    except Exception:
        pass
    return bark, leaves


def build_tree(kind, seed, texdir, at=(0, 0, 0), name=None):
    B, H = (tree_terak if kind == "terak" else tree_chinor)(seed)
    bark, leaves = tree_materials(kind, texdir)
    o1 = mesh_object(f"{name or kind}_bark", B.bv, B.bf, B.buv, bark, True)
    o2 = mesh_object(f"{name or kind}_leaves", B.lv, B.lf, B.luv, leaves, False)
    for o in (o1, o2):
        o.location = at
    return o1, o2, H


def render_impostor(objs, H, W, path):
    """The tree seen from the side (orthographic, transparent): the far-away billboard of the game."""
    sc = bpy.context.scene
    sc.world.use_nodes = True
    sc.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.6, 0.68, 0.78, 1)
    sc.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.7
    sun = bpy.data.lights.new("isun", "SUN")
    sun.energy = 2.6
    so = link(bpy.data.objects.new("isun", sun))
    so.rotation_euler = (math.radians(55), 0, math.radians(-25))
    cam = bpy.data.cameras.new("icam")
    cam.type = "ORTHO"
    S = max(H, W) * 1.04
    cam.ortho_scale = S
    co = link(bpy.data.objects.new("icam", cam))
    co.location = (0, -60, H / 2)
    co.rotation_euler = (math.radians(90), 0, 0)
    sc.camera = co
    sc.render.film_transparent = True
    sc.render.resolution_x = int(512 * W / S) if W < H else 512
    sc.render.resolution_y = int(512 * H / S) if H >= W else int(512 * H / S)
    sc.render.resolution_x = max(64, int(512 * W * 1.04 / S))
    sc.render.resolution_y = max(64, int(512 * H * 1.04 / S))
    cam.sensor_fit = "AUTO"
    sc.cycles.samples = 32
    sc.cycles.use_denoising = True
    sc.view_settings.view_transform = "Standard"
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(so)
    bpy.data.objects.remove(co)


def export(objs, path):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
                              export_texcoords=True, export_normals=True, export_materials="EXPORT", export_image_format="AUTO",
                              export_cameras=False, export_lights=False, export_animations=False)


def preview(texdir, d):
    """A row of poplars on a meadow under a summer sky + a plane tree, like the reference photo."""
    sc = clear()
    sc.world.use_nodes = True
    nt = sc.world.node_tree
    sky = nt.nodes.new("ShaderNodeTexSky")
    try:
        sky.sky_type = "NISHITA"
        sky.sun_elevation = math.radians(48)
        sky.sun_rotation = math.radians(160)
    except Exception:
        pass
    nt.links.new(sky.outputs["Color"], nt.nodes["Background"].inputs["Color"])
    nt.nodes["Background"].inputs["Strength"].default_value = 0.22
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 2.4
    sun.angle = math.radians(1)
    so = link(bpy.data.objects.new("sun", sun))
    so.rotation_euler = (math.radians(42), 0, math.radians(70))
    # meadow
    bpy.ops.mesh.primitive_plane_add(size=600)
    g = bpy.context.active_object
    gm = bpy.data.materials.new("grass")
    gm.use_nodes = True
    gnt = gm.node_tree
    nz = gnt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 0.8
    ramp = gnt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.025, 0.08, 0.012, 1)
    ramp.color_ramp.elements[1].color = (0.07, 0.16, 0.025, 1)
    gnt.links.new(nz.outputs["Fac"], ramp.inputs["Fac"])
    gnt.links.new(ramp.outputs["Color"], gnt.nodes["Principled BSDF"].inputs["Base Color"])
    g.data.materials.append(gm)
    for k in range(9):
        build_tree("terak", 10 + k, texdir, at=(k * 7.5 - 25, 14 + k * 1.2, 0), name=f"t{k}")
    build_tree("chinor", 3, texdir, at=(22, 4, 0), name="c1")
    cam = bpy.data.cameras.new("cam")
    cam.lens = 28
    co = link(bpy.data.objects.new("cam", cam))
    co.location = (-28, -30, 1.7)
    co.rotation_euler = (math.radians(92), 0, math.radians(-38))
    sc.camera = co
    sc.render.resolution_x, sc.render.resolution_y = 1280, 900
    sc.cycles.samples = 48
    sc.cycles.use_denoising = True
    try:
        sc.view_settings.view_transform = "AgX"
        sc.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass
    sc.view_settings.exposure = -0.4
    os.makedirs(d, exist_ok=True)
    sc.render.filepath = os.path.join(d, "trees.png")
    bpy.ops.render.render(write_still=True)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="public/models/poyga/trees")
    ap.add_argument("--tex", default="public/textures/poyga/trees")
    ap.add_argument("--preview", default="")
    ap.add_argument("--variants", type=int, default=3)
    a = ap.parse_args(argv)
    os.makedirs(a.tex, exist_ok=True)
    texdir = os.path.abspath(a.tex)
    for kind in ("terak", "chinor"):
        render_leaf_texture(kind, os.path.join(texdir, f"leaf_{kind}.png"), seed=7)
        render_bark_texture(kind, os.path.join(texdir, f"bark_{kind}.png"))
    manifest = {}
    for kind in ("terak", "chinor"):
        for v in range(a.variants):
            clear()
            o1, o2, H = build_tree(kind, 100 + v * 17, texdir)
            xs = [p[0] for p in o2.data.vertices.values() for p in [p.co]]
            W = (max(xs) - min(xs)) if xs else 4
            print(f"[trees] {kind} #{v}: {len(o1.data.polygons) * 2 + len(o2.data.polygons) * 2} tris, {H:.1f} m, crown {W:.1f} m")
            export([o1, o2], os.path.join(os.path.abspath(a.out), f"{kind}_{v}.glb"))
            render_impostor([o1, o2], H + 0.5, W, os.path.join(texdir, f"imp_{kind}_{v}.png"))
            manifest[f"{kind}_{v}"] = {"h": round(H + 0.5, 2), "w": round(W * 1.04 * max(H + 0.5, W) / max(H + 0.5, W), 2)}
    import json

    with open(os.path.join(os.path.abspath(a.out), "trees.json"), "w") as fh:
        json.dump(manifest, fh, indent=1)
    if a.preview:
        preview(texdir, a.preview)


main()
