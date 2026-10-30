"""Run with the GUI: camera view, rendered (EEVEE) shading, play the animation."""
import bpy


def setup():
    for win in bpy.context.window_manager.windows:
        for area in win.screen.areas:
            if area.type == "VIEW_3D":
                for sp in area.spaces:
                    if sp.type == "VIEW_3D":
                        sp.shading.type = "RENDERED"
                        sp.region_3d.view_perspective = "CAMERA"
                        sp.overlay.show_overlays = False
    bpy.context.scene.frame_set(1)
    return None


bpy.app.timers.register(setup, first_interval=1.5)
