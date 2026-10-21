# v2 floor frame: the part of every floor around the room picture (transparent where the room shows): the concrete slab
# under the room, the door gap, and the elevator shaft beside it (back wall, guide rails, bracing, landing platform with
# its gate, a caged lamp, pipes). Orthographic so it tiles vertically; 720 x 292 game units (54 u/m) at 2 px/unit.
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
from lib import *

out, FR, still = args()
sc = reset()
U = 1 / 54                    # metres per game unit
FW, FH = 720 * U, 292 * U
ROOM_W, ROOM_H = 540 * U, 268 * U
SX0, SX1 = 560 * U, 720 * U
sc.render.resolution_x, sc.render.resolution_y = 1440, 584
sc.render.film_transparent = True

concrete = mat('slab', (0.30, 0.29, 0.27), rough=0.9, grime=0.5, scale=4, bump=0.35)
dark = mat('shaft_wall', (0.10, 0.10, 0.10), rough=0.9, grime=0.5, scale=3, bump=0.3)
steel = mat('steel', (0.32, 0.32, 0.31), metal=0.85, rough=0.4, grime=0.45)
rust = mat('rust', (0.38, 0.22, 0.12), metal=0.6, rough=0.7, grime=0.5, scale=8, bump=0.3)
hazard = stripes_mat('hazard', (0.8, 0.6, 0.05), (0.04, 0.04, 0.04), 7)
# z = 0 is the top of the slab (the room's floor line); the frame spans z from -24 units to +268 units
slab_h = 24 * U
box('slab', (FW / 2, 0.5, -slab_h / 2), (FW + 0.2, 2.0, slab_h), concrete, 0.01)
box('slab_edge', (FW / 2, -0.49, -0.02), (FW + 0.2, 0.02, 0.04), hazard, 0)
# door gap between the room and the shaft
box('door_l', ((ROOM_W + SX0) / 2, 0.2, ROOM_H / 2), (SX0 - ROOM_W, 0.6, ROOM_H), concrete, 0.01)
# shaft: back wall, side walls, two guide rails, cross bracing, landing platform and gate frame, lamp, pipes
cx = (SX0 + SX1) / 2
box('back', (cx, 1.6, ROOM_H / 2), (SX1 - SX0 + 0.4, 0.1, FH + 1), dark, 0)
for x in (SX0 + 0.12, SX1 - 0.12):
    box('rail', (x, 0.9, ROOM_H / 2), (0.08, 0.12, FH + 1), steel, 0.005)
for z in (ROOM_H * 0.3, ROOM_H * 0.8):
    box('beam', (cx, 1.3, z), (SX1 - SX0, 0.1, 0.1), rust, 0.01)
    box('xa', (cx, 1.35, z + 0.45), (0.06, 0.06, 1.25), rust, 0, rot=(0, 0.95, 0))
    box('xb', (cx, 1.35, z + 0.45), (0.06, 0.06, 1.25), rust, 0, rot=(0, -0.95, 0))
box('landing', (cx, 0.6, -0.03), (SX1 - SX0, 1.4, 0.06), mat('grate', (0.25, 0.25, 0.25), metal=0.8, rough=0.5, grime=0.4), 0.005)
box('landing_edge', (cx, -0.09, 0.0), (SX1 - SX0, 0.02, 0.05), hazard, 0)
for x in (SX0 + 0.04, SX1 - 0.04):
    box('gate_post', (x, -0.05, 1.1), (0.05, 0.05, 2.2), steel, 0.004)
box('gate_top', (cx, -0.05, 2.2), (SX1 - SX0, 0.05, 0.05), steel, 0.004)
pipe('pipe_v', [(SX1 - 0.3, 1.45, -1), (SX1 - 0.3, 1.45, FH + 1)], 0.05, mat('pipe_r', (0.4, 0.12, 0.08), metal=0.5, rough=0.5, grime=0.4))
pipe('cable_v', [(SX0 + 0.35, 1.5, -1), (SX0 + 0.35, 1.5, FH + 1)], 0.025, mat('cab', (0.04, 0.04, 0.04), rough=0.6))
glow, _ = emissive('lamp', (1, 0.78, 0.5), 10)
cyl('lamp_cage', (SX0 + 0.3, 1.4, ROOM_H - 0.6), 0.09, 0.16, steel)
sphere('lamp_bulb', (SX0 + 0.3, 1.32, ROOM_H - 0.6), 0.06, glow)
point((SX0 + 0.3, 1.0, ROOM_H - 0.7), 90, (1, 0.75, 0.45), 0.1)
area((FW / 2, -3, 3), 120, 8, (0.8, 0.82, 0.9), rot=(math.radians(60), 0, 0))
post()
bpy.ops.object.camera_add()
cam = bpy.context.object
cam.data.type = 'ORTHO'
cam.data.ortho_scale = FW
cam.location = (FW / 2, -20, (ROOM_H - slab_h) / 2)
cam.rotation_euler = (math.pi / 2, 0, 0)
sc.camera = cam
os.makedirs(out, exist_ok=True)
sc.render.filepath = os.path.join(out, 'frame.png')
bpy.ops.render.render(write_still=True)
