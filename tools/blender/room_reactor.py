# v2 floor 8: the reactor. A big pressure vessel with a pulsing green core window, a turbine-generator whose shaft and
# flywheel spin, coolant pipes venting steam, a control desk with gauges and blinking lights, hazard floor bands, crate.
import sys, os, math, random
sys.path.insert(0, os.path.dirname(__file__))
from lib import *

out, FR, still = args()
sc = reset()
shell(wall=(0.34, 0.33, 0.31), floor=(0.24, 0.23, 0.22))
steel = mat('steel', (0.5, 0.52, 0.52), metal=0.95, rough=0.28, grime=0.3)
olive = mat('olive', (0.38, 0.40, 0.30), metal=0.5, rough=0.45, grime=0.4, scale=4)
dark = mat('dark', (0.05, 0.05, 0.05), metal=0.5, rough=0.5)
hazard = stripes_mat('hazard', (0.8, 0.6, 0.05), (0.05, 0.05, 0.05), 5)
# vessel with a glowing core window (pulses)
cyl('vessel', (4.8, 2.1, 1.5), 0.95, 3.0, olive, verts=48)
cyl('vessel_cap', (4.8, 2.1, 3.1), 1.0, 0.2, steel, verts=48)
for z in (0.4, 1.5, 2.6):
    cyl(f'vband{z}', (4.8, 2.1, z), 0.98, 0.08, steel, verts=48)
core_m, core_s = emissive('core', (0.45, 1.0, 0.25), 14)
anim_value(core_s, FR, lambda t: 12 + 6 * math.sin(2 * math.pi * t))
cyl('core_win', (4.8, 1.12, 1.55), 0.38, 0.06, core_m, rot=(math.pi / 2, 0, 0))
cyl('core_ring', (4.8, 1.1, 1.55), 0.45, 0.05, steel, rot=(math.pi / 2, 0, 0))
bpy.ops.object.light_add(type='POINT', location=(4.8, 0.7, 1.55))
cl = bpy.context.object
cl.data.color = (0.5, 1.0, 0.3)
for f in range(1, FR + 2):
    cl.data.energy = 110 + 50 * math.sin(2 * math.pi * (f - 1) / FR)
    cl.data.keyframe_insert('energy', frame=f)
# coolant pipes left and right with steam vents
for sx in (-1, 1):
    pipe(f'cool{sx}', [(4.8 + sx * 0.9, 2.0, 1.0), (4.8 + sx * 1.6, 2.0, 1.0), (4.8 + sx * 1.6, 2.0, 3.8), (4.8 + sx * 3.5, 2.0, 3.8)], 0.14, steel)
    steam = smoke_mat('steam', (0.9, 0.9, 0.9), 0.2, 0.2)
    vx = 4.8 + sx * 1.6
    for k in range(5):
        o = sphere(f'st{sx}{k}', (vx, 1.8, 2.4), 0.07, steam)
        for f in range(1, FR + 2):
            t = ((f - 1) / FR + k / 5) % 1
            o.location = (vx + sx * 0.5 * t, 1.75, 2.4 + 0.5 * t)
            o.scale = (0.6 + 3 * t,) * 3
            o.keyframe_insert('location', frame=f)
            o.keyframe_insert('scale', frame=f)
# turbine-generator on the left: housing, spinning shaft collar and flywheel
box('gen', (1.4, 2.0, 0.6), (2.0, 1.0, 1.2), mat('gen_paint', (0.2, 0.3, 0.42), metal=0.5, rough=0.4, grime=0.4), 0.05)
shaft = empty('shaft', (2.6, 2.0, 0.6))
cyl('shaft_c', (0, 0, 0), 0.12, 0.6, steel, rot=(0, math.pi / 2, 0), parent=shaft)
fw = empty('flywheel', (2.95, 1.98, 0.6))
cyl('fw_d', (0, 0, 0), 0.45, 0.12, dark, rot=(0, math.pi / 2, 0), parent=fw, verts=40)
for k in range(6):
    a = k * math.pi / 3
    box(f'fw_mark{k}', (0.07, math.cos(a) * 0.35, math.sin(a) * 0.35), (0.02, 0.06, 0.12), hazard, 0, rot=(a, 0, 0), parent=fw)
spin(fw, 'x', 1 / 3, FR)
spin(shaft, 'x', 1 / 3, FR)
# control desk on the right: gauges with moving needles, blinking lights, a screen
box('ctrl', (7.9, 1.7, 0.55), (1.6, 0.7, 1.1), olive, 0.03)
box('ctrl_top', (7.9, 1.55, 1.15), (1.6, 0.6, 0.12), dark, 0.02, rot=(0.35, 0, 0))
for g in range(3):
    cyl(f'gauge{g}', (7.4 + g * 0.5, 1.35, 1.6), 0.13, 0.03, mat('gauge', (0.88, 0.85, 0.75), rough=0.3), rot=(math.pi / 2, 0, 0))
    nd = empty(f'needle{g}', (7.4 + g * 0.5, 1.33, 1.6))
    box(f'nd{g}', (0, 0, 0.05), (0.008, 0.005, 0.1), mat('needle', (0.8, 0.05, 0.02)), 0, parent=nd)
    wobble(nd, 'rotation_euler[1]', 0.2 * (g - 1), 0.35, FR, cycles=1 + g % 2, phase=g * 0.2)
box('gauge_board', (7.9, 1.4, 1.6), (1.6, 0.04, 0.4), dark, 0.01)
leds('ctrl_led', 7.2, 8.6, 1.12, 1.2, 1.3, 14, FR)
screen('ctrl_scr', (7.9, 1.42, 2.1), (0.8, 0.4), (0.5, 1.0, 0.4), FR)
box('band', (4.8, 0.5, 0.005), (9.8, 0.25, 0.01), hazard, 0)
box('crate', (9.25, 0.75, 0.35), (0.9, 0.7, 0.7), mat('crate_w', (0.45, 0.32, 0.18), rough=0.75, grime=0.4, scale=12), 0.03)
for lx in (1.4, 5.0, 8.6):
    lamp_fixture(lx, 4.1, y=0.9, energy=420, color=(0.95, 0.95, 0.85))
area((5, -2, 3.5), 60, 6, (0.55, 0.65, 0.85), rot=(math.radians(70), 0, 0))
post()
camera()
render(out, FR, still)
