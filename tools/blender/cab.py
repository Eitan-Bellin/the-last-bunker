# v2 elevator cab: a steel cage car (frame, mesh sides, scissor gate, a lamp, a pulley head) on transparent background.
# 130 x 177 game units (2.4 x 3.3 m), orthographic front, 2 px per unit.
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
from lib import *

out, FR, still = args()
sc = reset()
W, H = 130 / 54, 177 / 54
sc.render.resolution_x, sc.render.resolution_y = 260, 354
sc.render.film_transparent = True
steel = mat('steel', (0.30, 0.30, 0.29), metal=0.9, rough=0.35, grime=0.45)
yellow = mat('yellow', (0.75, 0.55, 0.08), metal=0.3, rough=0.45, grime=0.5)
floor_m = mat('cab_floor', (0.2, 0.19, 0.18), metal=0.7, rough=0.5, grime=0.5)
inner = mat('cab_in', (0.12, 0.12, 0.11), metal=0.5, rough=0.6, grime=0.5)
hazard = stripes_mat('hazard', (0.8, 0.6, 0.05), (0.04, 0.04, 0.04), 8)
box('back', (0, 0.6, H / 2), (W - 0.1, 0.05, H - 0.4), inner, 0)
box('floor', (0, 0.25, 0.08), (W, 0.8, 0.16), floor_m, 0.01)
box('floor_edge', (0, -0.16, 0.12), (W, 0.02, 0.06), hazard, 0)
box('roof', (0, 0.25, H - 0.35), (W, 0.8, 0.12), steel, 0.01)
for x in (-W / 2 + 0.05, W / 2 - 0.05):
    box('post', (x, -0.12, H / 2 - 0.15), (0.1, 0.1, H - 0.4), yellow, 0.01)
# scissor gate (diagonal bars) across the front, lower half
for k in range(6):
    x = -W / 2 + 0.2 + k * (W - 0.4) / 5
    box('scis_a', (x, -0.15, 0.75), (0.03, 0.02, 1.25), steel, 0, rot=(0, 0.35, 0))
    box('scis_b', (x, -0.15, 0.75), (0.03, 0.02, 1.25), steel, 0, rot=(0, -0.35, 0))
box('gate_rail', (0, -0.15, 1.4), (W - 0.2, 0.04, 0.05), steel, 0)
# pulley head on the roof
box('head', (0, 0.25, H - 0.15), (0.6, 0.4, 0.28), steel, 0.02)
cyl('pulley', (0, 0.05, H - 0.1), 0.16, 0.08, mat('dark', (0.05, 0.05, 0.05), metal=0.5, rough=0.5), rot=(math.pi / 2, 0, 0))
glow, _ = emissive('cab_lamp', (1, 0.82, 0.55), 9)
sphere('lamp', (0, 0.3, H - 0.5), 0.07, glow)
point((0, 0.2, H - 0.6), 60, (1, 0.8, 0.55), 0.1)
area((0.6, -3, 2.6), 120, 3, (0.85, 0.85, 0.9), rot=(math.radians(65), 0, 0))
post()
bpy.ops.object.camera_add()
cam = bpy.context.object
cam.data.type = 'ORTHO'
cam.data.ortho_scale = H
cam.location = (0, -20, H / 2)
cam.rotation_euler = (math.pi / 2, 0, 0)
sc.camera = cam
os.makedirs(out, exist_ok=True)
sc.render.filepath = os.path.join(out, 'cab.png')
bpy.ops.render.render(write_still=True)
