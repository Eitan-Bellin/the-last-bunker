# v2 floor 5: the components plant. Two hydraulic presses stamping in turn, a roller conveyor carrying parts past them,
# a welding robot with a flashing arc light and sparks, parts shelves and the drop crate.
import sys, os, math, random
sys.path.insert(0, os.path.dirname(__file__))
from lib import *

out, FR, still = args()
sc = reset()
shell(wall=(0.32, 0.30, 0.24), floor=(0.22, 0.20, 0.17))
steel = mat('steel', (0.38, 0.39, 0.4), metal=0.9, rough=0.32, grime=0.35)
olive = mat('olive', (0.30, 0.32, 0.18), metal=0.4, rough=0.5, grime=0.5, scale=5, bump=0.1)
yellow = mat('yellow', (0.72, 0.52, 0.08), metal=0.3, rough=0.45, grime=0.45)
dark = mat('dark', (0.05, 0.05, 0.05), metal=0.5, rough=0.6)
part_m = mat('part', (0.62, 0.6, 0.55), metal=1.0, rough=0.25)
bins = [mat('bin_r', (0.5, 0.12, 0.08), rough=0.5), mat('bin_b', (0.12, 0.25, 0.45), rough=0.5), yellow]

# presses (stamping in turn)
for k, px in enumerate((1.6, 4.4)):
    box(f'pr_base{k}', (px, 2.0, 0.35), (1.3, 1.0, 0.7), olive, 0.03)
    for cx in (px - 0.5, px + 0.5):
        box(f'pr_col{k}', (cx, 2.0, 1.55), (0.16, 0.5, 2.4), steel, 0.02)
    box(f'pr_top{k}', (px, 2.0, 2.85), (1.3, 0.9, 0.4), olive, 0.03)
    piston(f'pr{k}', (px, 2.0, 1.9), 0.7, 0.95, FR, yellow, steel, phase=k * 0.5)
    box(f'pr_die{k}', (px, 2.0, 0.75), (0.7, 0.6, 0.1), steel, 0.01)

# roller conveyor with parts sliding along (period = 1 spacing per loop)
box('conv', (3.0, 1.15, 0.55), (5.4, 0.6, 0.08), dark, 0.01)
for i in range(27):
    r = cyl(f'roll{i}', (0.35 + i * 0.2, 1.15, 0.6), 0.04, 0.58, steel, rot=(math.pi / 2, 0, 0))
    spin(r, 'y', 1, FR)
for k in range(4):
    box(f'conv_leg{k}', (0.4 + k * 1.75, 1.15, 0.27), (0.08, 0.5, 0.55), steel, 0.01)
SP = 0.9
for i in range(6):
    o = box(f'part{i}', (0, 1.15, 0.7), (0.22, 0.3, 0.08), part_m, 0.02)
    key_linear(o, 'location[0]', [(f, 0.4 + ((i * SP + SP * (f - 1) / FR) % (6 * SP))) for f in range(1, FR + 2)])

# welding robot: the torch bobs and sweeps, the arc flashes (emission + a real light), sparks fly
box('weld_table', (6.9, 1.9, 0.45), (1.2, 0.8, 0.9), steel, 0.02)
wh = empty('welder', (6.9, 1.9, 1.5))
box('w_arm', (0, 0, 0.3), (0.1, 0.1, 0.7), yellow, 0.02, parent=wh)
cyl('w_torch', (0, 0, -0.1), 0.03, 0.3, dark, parent=wh)
wobble(wh, 'location[2]', 1.45, 0.08, FR, cycles=2)
wobble(wh, 'location[0]', 6.9, 0.25, FR, cycles=1)
arc_m, arc_s = emissive('arc', (0.75, 0.85, 1.0), 30)
anim_value(arc_s, FR, lambda t: 40.0 if int(round(t * FR)) % 3 != 1 else 2.0)
sphere('arc', (0, 0, -0.27), 0.03, arc_m, parent=wh)
bpy.ops.object.light_add(type='POINT', location=(6.9, 1.6, 1.05))
arcL = bpy.context.object
arcL.data.color = (0.7, 0.85, 1.0)
arcL.data.shadow_soft_size = 0.05
for f in range(1, FR + 2):
    arcL.data.energy = 180 if (f - 1) % 3 != 1 else 10
    arcL.data.keyframe_insert('energy', frame=f)
spark_m = mat('spark', (1, 0.8, 0.3), emit=(1, 0.7, 0.2), emit_strength=25)
for s_ in range(10):
    o = sphere(f'spark{s_}', (6.9, 1.9, 1.05), 0.012, spark_m)
    vx, vz = random.uniform(-0.6, 0.6), random.uniform(0.3, 0.9)
    ph = random.random()
    for f in range(1, FR + 2):
        t = (((f - 1) / FR) * 2 + ph) % 1
        o.location = (6.9 + vx * t, 1.75, 1.05 + vz * t - 2.2 * t * t)
        o.keyframe_insert('location', frame=f)

# parts shelves
rack_shelf('shelf', 8.6, 2.75, 1.6, 0.5, 4, 0.7, steel)
for lv in range(4):
    for i in range(5):
        box(f'bin{lv}{i}', (8.0 + i * 0.3, 2.75, 0.45 + lv * 0.7), (0.24, 0.4, 0.16), random.choice(bins), 0.01)
dress_wall(5.6, 7.6, seed=4)
box('weld_col', (6.9, 2.35, 1.6), (0.18, 0.18, 2.4), steel, 0.01)
box('weld_beam', (6.9, 2.1, 2.75), (0.15, 0.6, 0.15), steel, 0.01)
box('crate', (9.25, 0.75, 0.35), (0.9, 0.7, 0.7), mat('crate_w', (0.48, 0.32, 0.17), rough=0.75, grime=0.45, scale=12), 0.03)
for lx in (1.4, 5.0, 8.6):
    lamp_fixture(lx, 4.0, y=1.0, energy=700)
area((5, -2, 3.5), 60, 6, (0.55, 0.65, 0.85), rot=(math.radians(70), 0, 0))
post()
camera()
render(out, FR, still)
