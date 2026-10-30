"""HDR sky -> sRGB JPEG background (+ the sun direction found in the HDR).

    blender -b --factory-startup --python tools/blender/sky_jpg.py -- IN.hdr OUT.jpg [exposure] [width]
"""
import math
import sys

import bpy

a = sys.argv[sys.argv.index("--") + 1:]
src, dst = a[0], a[1]
exposure = float(a[2]) if len(a) > 2 else 0.0
width = int(a[3]) if len(a) > 3 else 4096
img = bpy.data.images.load(src)
w, h = img.size
px = img.pixels[:]
best, bi = -1.0, 0
for i in range(0, w * h * 4, 4 * 7):
    l = px[i] + px[i + 1] + px[i + 2]
    if l > best:
        best, bi = l, i // 4
x, y = bi % w, bi // w
lon = (x + 0.5) / w * 2 * math.pi - math.pi  # 0 at the image centre
lat = (y + 0.5) / h * math.pi - math.pi / 2  # blender rows are bottom-up
# three.js equirect: u = atan2(dir.z, dir.x) / 2pi + 0.5, v = asin(dir.y) / pi + 0.5
u = (x + 0.5) / w
phi = (u - 0.5) * 2 * math.pi
d = (math.cos(lat) * math.cos(phi), math.sin(lat), math.cos(lat) * math.sin(phi))
print(f"[sky] sun pixel {x},{y} lum {best:.1f} three dir {d[0]:.3f},{d[1]:.3f},{d[2]:.3f}")
sc = bpy.context.scene
sc.view_settings.view_transform = "AgX"
sc.view_settings.look = "AgX - Punchy"
sc.view_settings.exposure = exposure
sc.render.image_settings.file_format = "JPEG"
sc.render.image_settings.quality = 88
if width != w:
    img.scale(width, width // 2)
img.save_render(dst, scene=sc)
print("[sky] wrote", dst)
