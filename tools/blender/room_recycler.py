# v2 floor 1: the scrap recycler. Conveyor with riding scrap, a shredder with counter-rotating toothed rollers behind
# its window, a swinging magnet crane, a rotating beacon, bales and the drop crate by the shaft door.
import sys, os, math, random
sys.path.insert(0, os.path.dirname(__file__))
from lib import *

out, FR, still = args()
sc = reset()
shell(wall=(0.27, 0.26, 0.23), floor=(0.20, 0.19, 0.17))

steel = mat('steel', (0.35, 0.36, 0.37), metal=0.9, rough=0.35, grime=0.35)
yellow = mat('yellow', (0.75, 0.55, 0.08), metal=0.3, rough=0.45, grime=0.45, scale=6)
green = mat('green_paint', (0.20, 0.30, 0.18), metal=0.3, rough=0.5, grime=0.5, scale=5, bump=0.1)
dark = mat('dark', (0.05, 0.05, 0.05), metal=0.5, rough=0.6)
rubber = mat('rubber', (0.06, 0.06, 0.06), rough=0.8)
hazard = stripes_mat('hazard', (0.8, 0.6, 0.05), (0.05, 0.05, 0.05), 5)
rust = mat('rust', (0.42, 0.22, 0.10), metal=0.6, rough=0.75, grime=0.5, scale=10, bump=0.3)
scrap_mats = [steel, rust, mat('scrap_blue', (0.18, 0.28, 0.42), metal=0.6, rough=0.5, grime=0.4), mat('scrap_copper', (0.6, 0.32, 0.18), metal=0.9, rough=0.35)]
wood = mat('wood', (0.42, 0.28, 0.15), rough=0.75, grime=0.4, scale=12, bump=0.2)

# ---- scrap heap (left, back) ----
for i in range(70):
    x = 0.1 + random.random() * 2.2
    h = max(0.05, 1.1 - abs(x - 1.0) * 0.9)
    scrap_piece(f'heap{i}', (x, 2.3 + random.random() * 0.6, random.random() * h), 0.12 + random.random() * 0.16, random.choice(scrap_mats))

# ---- conveyor: incline from the heap up to the hopper ----
x0, z0, x1, z1, yb = 0.9, 0.45, 3.55, 2.55, 1.55
L = math.hypot(x1 - x0, z1 - z0)
ang = math.atan2(z1 - z0, x1 - x0)
cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
belt = box('belt', (cx, yb, cz), (L, 0.7, 0.06), rubber, 0.01, rot=(0, -ang, 0))
for side in (-1, 1):
    box(f'rail{side}', (cx, yb + side * 0.4, cz + 0.06), (L + 0.1, 0.06, 0.22), yellow, 0.015, rot=(0, -ang, 0))
for k in range(4):
    t = 0.1 + k * 0.27
    lx, lz = x0 + (x1 - x0) * t, z0 + (z1 - z0) * t
    for side in (-1, 1):
        box(f'leg{k}{side}', (lx, yb + side * 0.36, lz / 2), (0.08, 0.08, lz), steel, 0.01)
for end, (ex, ez) in enumerate(((x0, z0), (x1, z1))):
    cyl(f'drum{end}', (ex, yb, ez), 0.12, 0.85, steel, rot=(math.pi / 2, 0, 0))
# slats and scrap that ride the belt; pattern period = 3 slats, so moving 3 spacings per loop is seamless
SP = 0.42
n = int(L / SP) + 3
dirv = Vector(((x1 - x0) / L, 0, (z1 - z0) / L))
up = Vector((-dirv.z, 0, dirv.x))
start = Vector((x0, yb, z0))
for i in range(-3, n):
    for kind in ('slat', 'scrap'):
        d0 = i * SP + (0.2 if kind == 'scrap' else 0)
        if kind == 'slat':
            o = box(f'slat{i}', (0, 0, 0), (0.05, 0.66, 0.05), dark, 0.005, rot=(0, -ang, 0))
        else:
            random.seed(1000 + (i % 3))
            o = scrap_piece(f'ride{i}', (0, 0, 0), 0.13, scrap_mats[i % 3])
        keys = []
        for f in range(1, FR + 2):
            d = d0 + 3 * SP * (f - 1) / FR
            p = start + dirv * d + up * (0.07 if kind == 'slat' else 0.17)
            vis = 0.0 <= d <= L
            keys.append((f, p, vis))
        for f, p, vis in keys:
            o.location = p
            o.keyframe_insert('location', frame=f)
            o.hide_render = not vis
            o.keyframe_insert('hide_render', frame=f)
        for fc in fcurves(o.animation_data.action):
            for kp in fc.keyframe_points:
                kp.interpolation = 'CONSTANT' if fc.data_path == 'hide_render' else 'LINEAR'
random.seed(11)

# ---- shredder ----
SX0, SX1, SZ = 3.35, 5.95, 2.45
yd0, yd1 = 1.0, 2.2
ym = (yd0 + yd1) / 2
WX0, WX1, WZ0, WZ1 = 3.85, 5.45, 0.75, 1.95
box('sh_left', ((SX0 + WX0) / 2, ym, SZ / 2), (WX0 - SX0, yd1 - yd0, SZ), green, 0.04)
box('sh_right', ((WX1 + SX1) / 2, ym, SZ / 2), (SX1 - WX1, yd1 - yd0, SZ), green, 0.04)
box('sh_top', ((WX0 + WX1) / 2, ym, (WZ1 + SZ) / 2), (WX1 - WX0, yd1 - yd0, SZ - WZ1), green, 0.03)
box('sh_bot', ((WX0 + WX1) / 2, ym, WZ0 / 2), (WX1 - WX0, yd1 - yd0, WZ0), green, 0.03)
box('sh_inner', ((WX0 + WX1) / 2, yd1 - 0.1, (WZ0 + WZ1) / 2), (WX1 - WX0, 0.05, WZ1 - WZ0), dark, 0)
box('sh_band', ((SX0 + SX1) / 2, yd0 - 0.01, 0.2), (SX1 - SX0, 0.02, 0.3), hazard, 0)
# hopper: a tapered box on top
bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=1.0, radius2=1.55, depth=0.7, location=((SX0 + SX1) / 2 - 0.3, ym, SZ + 0.35), rotation=(0, 0, math.pi / 4))
hop = bpy.context.object
hop.scale = (1.0, 0.55, 1)
hop.data.materials.append(steel)
for i in range(12):
    scrap_piece(f'hop{i}', ((SX0 + SX1) / 2 - 0.3 + (random.random() - 0.5) * 1.6, ym + (random.random() - 0.5) * 0.6, SZ + 0.55 + random.random() * 0.2), 0.14, random.choice(scrap_mats))
# two toothed rollers behind the window, facing the camera, counter-rotating (10 teeth: 1/5 turn per loop is seamless)
for k, (rx, sense) in enumerate(((4.3, 1), (5.0, -1))):
    piv = empty(f'roller{k}', (rx, yd0 + 0.35, 1.35))
    piv.rotation_euler = (0, 0.3 * k, 0)
    cyl(f'core{k}', (0, 0, 0), 0.26, 0.5, steel, rot=(math.pi / 2, 0, 0), parent=piv)
    for t in range(10):
        a = t * 2 * math.pi / 10
        box(f'tooth{k}{t}', (math.cos(a) * 0.31, 0, math.sin(a) * 0.31), (0.12, 0.45, 0.09), mat('blade', (0.55, 0.56, 0.58), metal=1, rough=0.25), 0.01, rot=(0, -a, 0), parent=piv)
    cyl(f'hub{k}', (0, -0.27, 0), 0.08, 0.06, yellow, rot=(math.pi / 2, 0, 0), parent=piv)
    spin(piv, 'y', sense * 0.4, FR)
# window frame and shredded output chute
for (fx, fz, w, h) in ((WX0 - 0.03, (WZ0 + WZ1) / 2, 0.08, WZ1 - WZ0 + 0.1), (WX1 + 0.03, (WZ0 + WZ1) / 2, 0.08, WZ1 - WZ0 + 0.1), ((WX0 + WX1) / 2, WZ1 + 0.03, WX1 - WX0, 0.08), ((WX0 + WX1) / 2, WZ0 - 0.03, WX1 - WX0, 0.08)):
    box('wf', (fx, yd0 - 0.02, fz), (w, 0.06, h), steel, 0.01)
box('chute', (SX1 + 0.35, ym - 0.2, 0.45), (0.7, 0.6, 0.08), steel, 0.01, rot=(0, 0.45, 0))
for i in range(25):
    scrap_piece(f'shred{i}', (SX1 + 0.5 + random.random() * 0.7, ym - 0.2 + (random.random() - 0.5) * 0.6, random.random() * 0.25), 0.06, random.choice(scrap_mats))
# control panel with gauges
box('panel', (SX0 + 0.25, yd0 - 0.08, 1.6), (0.36, 0.08, 0.5), dark, 0.01)
for g in range(2):
    cyl(f'gauge{g}', (SX0 + 0.17 + g * 0.17, yd0 - 0.13, 1.68), 0.06, 0.02, mat('gauge', (0.85, 0.82, 0.7), rough=0.3), rot=(math.pi / 2, 0, 0))
    nd = box(f'needle{g}', (SX0 + 0.17 + g * 0.17, yd0 - 0.145, 1.68), (0.005, 0.005, 0.05), mat('needle', (0.8, 0.05, 0.02)), 0)
    wobble(nd, 'rotation_euler[1]', 0.3, 0.25, FR, cycles=2, phase=g * 0.3)
red_led = mat('led_r', (0.9, 0.1, 0.05), emit=(1, 0.1, 0.05), emit_strength=6)
green_led = mat('led_g', (0.1, 0.9, 0.2), emit=(0.1, 1, 0.2), emit_strength=6)
for i, m_ in enumerate((green_led, red_led, green_led)):
    sphere(f'led{i}', (SX0 + 0.13 + i * 0.12, yd0 - 0.13, 1.45), 0.025, m_)
# rotating beacon on the housing
bx, bz = SX1 - 0.35, SZ + 0.1
cyl('beacon_base', (bx, ym - 0.3, bz), 0.1, 0.08, dark)
cyl('beacon_glass', (bx, ym - 0.3, bz + 0.12), 0.08, 0.16, mat('beacon', (1, 0.5, 0.05), emit=(1, 0.45, 0.05), emit_strength=8))
bpiv = empty('beacon_piv', (bx, ym - 0.3, bz + 0.12))
bpy.ops.object.light_add(type='SPOT', location=(0, 0, 0))
spot = bpy.context.object
spot.parent = bpiv
spot.rotation_euler = (math.pi / 2, 0, 0)
spot.data.energy = 120
spot.data.color = (1, 0.5, 0.1)
spot.data.spot_size = math.radians(40)
spin(bpiv, 'z', 1, FR)

# ---- magnet crane: ceiling rail, trolley, swinging magnet ----
box('crane_rail', (7.4, 1.6, 4.25), (4.4, 0.25, 0.18), yellow, 0.02)
box('trolley', (7.3, 1.6, 4.05), (0.6, 0.4, 0.25), dark, 0.02)
swing = empty('swing', (7.3, 1.6, 3.95))
cyl('cable', (0, 0, -0.6), 0.02, 1.2, dark, parent=swing)
mag = cyl('magnet', (0, 0, -1.3), 0.42, 0.22, mat('magnet', (0.15, 0.15, 0.15), metal=0.8, rough=0.4, grime=0.4), parent=swing)
box('mag_band', (0, -0.43, -1.3), (0.6, 0.02, 0.12), hazard, 0, parent=swing)
for i in range(6):
    scrap_piece(f'stuck{i}', ((random.random() - 0.5) * 0.6, (random.random() - 0.5) * 0.4, -1.5), 0.1, random.choice(scrap_mats), parent=swing)
wobble(swing, 'rotation_euler[1]', 0, 0.06, FR, cycles=1)

# ---- bales and crates (right, back) ----
strap = mat('strap', (0.55, 0.45, 0.12), metal=0.7, rough=0.4)
for r in range(2):
    for c in range(3 - r):
        b = bale(f'bale{r}{c}', (6.7 + c * 0.75 + r * 0.37, 2.4, 0.33 + r * 0.66), (0.7, 0.7, 0.64), scrap_mats, strap)
        b.rotation_euler = (0, 0, (random.random() - 0.5) * 0.12)
# props: oil drums, a tool board, an extinguisher, cable runs, a warning sign
drum_m = [mat('drum_blue', (0.12, 0.22, 0.40), metal=0.5, rough=0.5, grime=0.5, scale=6, bump=0.15), rust]
for i, (dx, dy) in enumerate(((8.95, 2.5), (9.45, 2.3), (9.2, 1.9))):
    cyl(f'drum{i}', (dx, dy, 0.45), 0.29, 0.9, drum_m[i % 2], verts=28)
    for z in (0.2, 0.7):
        cyl(f'drumring{i}{z}', (dx, dy, z), 0.3, 0.04, dark, verts=28)
box('toolboard', (2.6, 3.05, 2.3), (1.1, 0.04, 0.7), mat('pegboard', (0.35, 0.28, 0.2), rough=0.8, grime=0.4), 0.01)
for i in range(5):
    box(f'tool{i}', (2.2 + i * 0.2, 3.0, 2.25 + (i % 2) * 0.1), (0.04, 0.03, 0.35 + (i % 3) * 0.08), steel, 0.005)
cyl('extinguisher', (6.25, 2.95, 0.9), 0.09, 0.5, mat('ext', (0.7, 0.05, 0.03), metal=0.3, rough=0.35))
pipe('cable_a', [(0.0, 3.0, 3.6), (3.0, 3.0, 3.5), (3.0, 3.0, 2.7)], 0.025, dark)
pipe('cable_b', [(6.0, 3.0, 3.7), (9.6, 3.0, 3.7), (9.6, 3.0, 0.5)], 0.03, dark)
pipe('vent', [(4.0, 2.2, 4.6), (4.0, 2.2, 3.0)], 0.22, steel)
box('sign', (8.2, 3.05, 2.6), (0.6, 0.02, 0.4), hazard, 0.01)
# the drop crate by the shaft door (workers bring goods here)
box('crate', (9.25, 0.75, 0.35), (0.9, 0.7, 0.7), wood, 0.03)
for zz in (0.12, 0.58):
    box('crate_band', (9.25, 0.39, zz), (0.92, 0.02, 0.08), mat('crate_band', (0.2, 0.15, 0.1), rough=0.7), 0)
box('door_frame', (9.95, 2.9, 1.3), (0.15, 0.3, 2.6), steel, 0.02)

# ---- lights ----
for lx in (1.4, 5.0, 8.6):
    lamp_fixture(lx, 3.9, y=1.4, energy=900)
area((5, -2, 3.5), 70, 6, (0.55, 0.65, 0.85), rot=(math.radians(70), 0, 0))
post()
camera()
render(out, FR, still)
